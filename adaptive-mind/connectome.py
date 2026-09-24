"""
Connectome analysis of the Drosophila male CNS (Janelia FlyEM / Cambridge / Google,
male-cns v1.0, public bucket gs://flyem-male-cns).

This script does not "run" the fly. It reads the wiring diagram and distills it
into *architecture specifications* that the models in this folder are built from:

  1. whole-CNS statistics that motivate recurrence (reciprocity, strongly
     connected core, E/I balance by predicted neurotransmitter)
  2. the mushroom body (MB): the fly's in-life learning circuit
       PN -> KC expansion (real synapse-count matrix, right hemisphere)
       APL global inhibition, DAN -> compartment -> MBON organisation,
       MBON -> DAN feedback (the MB is itself recurrent)
  3. the central-complex heading circuit (EPG / PEN / PEG / Delta7) as a signed
     neuron-level graph, for the connectome-as-architecture experiment.

Outputs small .npz / .json files in ./data so every experiment can be re-run
without the 570 MB download.

Usage:
    python connectome.py --src /path/to/mcns   # dir with the three v1.0 feather files
"""

import argparse
import json
import os
import re
from collections import Counter

import numpy as np
import pandas as pd
import pyarrow.feather as pf
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

ANN = "body-annotations-male-cns-v1.0-minconf-0.5.feather"
NT = "body-neurotransmitters-male-cns-v1.0.feather"
W = "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather"

# Sign convention used in connectome-constrained fly models
# (e.g. Lappalainen et al. 2024, Shiu et al. 2024): ACh excitatory,
# GABA and glutamate (via GluCl) inhibitory, amines treated as modulatory (0 here).
NT_SIGN = {"acetylcholine": 1.0, "gaba": -1.0, "glutamate": -1.0}


def load(src):
    ann = pd.read_feather(os.path.join(src, ANN))
    ann = ann[ann.status == "Traced"].set_index("bodyId")
    nt = pd.read_feather(os.path.join(src, NT), columns=["body", "consensus_nt"]).set_index("body")
    ann["nt"] = nt.consensus_nt.reindex(ann.index)
    t = pf.read_table(os.path.join(src, W), columns=["body_pre", "body_post", "weight"])
    edges = t.to_pandas()
    keep = edges.body_pre.isin(ann.index) & edges.body_post.isin(ann.index)
    return ann, edges[keep].reset_index(drop=True)


def global_stats(ann, edges, min_w=5):
    ids = ann.index.values
    idx = pd.Series(np.arange(len(ids)), index=ids)
    e = edges[edges.weight >= min_w]
    i = idx[e.body_pre.values].values
    j = idx[e.body_post.values].values
    A = sp.csr_matrix((np.ones(len(i), dtype=np.int8), (i, j)), shape=(len(ids), len(ids)))
    recip = A.multiply(A.T).nnz / A.nnz
    density = A.nnz / (len(ids) ** 2)
    n_scc, lab = connected_components(A, directed=True, connection="strong")
    biggest = np.bincount(lab).max()
    ntc = ann.nt.fillna("unknown").value_counts(normalize=True).round(4).to_dict()
    return {
        "neurons_traced": int(len(ids)),
        "edges_all_weights": int(len(edges)),
        "synapses_total": int(edges.weight.sum()),
        "min_weight_for_graph_stats": min_w,
        "edges_at_min_weight": int(A.nnz),
        "reciprocity": float(recip),
        "reciprocity_if_random": float(density),
        "reciprocity_enrichment": float(recip / density),
        "largest_strongly_connected_component_frac": float(biggest / len(ids)),
        "neurotransmitter_fraction": ntc,
    }


def to_str(a):
    return np.array([str(x) for x in a], dtype=str)


def compartment_of(instance):
    m = re.search(r"\(([^)]*)\)", instance or "")
    return m.group(1) if m else None


def mushroom_body(ann, edges, side="R"):
    """Right-hemisphere MB circuit as dense synapse-count matrices."""
    s = ann[ann.somaSide == side]
    pn = s[(s["class"] == "ALPN") & s.type.fillna("").str.match(r"^[A-Z0-9a-z+]+_(l|ad|v|lv)PN$")]
    kc = s[s["class"] == "Kenyon_Cell"]
    mbon = s[s["class"] == "MBON"]
    dan = s[s["class"] == "DAN"]
    apl = s[s.type == "APL"]

    def mat(pre, post):
        e = edges[edges.body_pre.isin(pre.index) & edges.body_post.isin(post.index)]
        r = pd.Series(np.arange(len(pre)), index=pre.index)
        c = pd.Series(np.arange(len(post)), index=post.index)
        M = np.zeros((len(pre), len(post)), dtype=np.float32)
        M[r[e.body_pre].values, c[e.body_post].values] = e.weight.values
        return M

    PN_KC = mat(pn, kc)
    KC_MBON = mat(kc, mbon)
    DAN_KC = mat(dan, kc)
    DAN_MBON = mat(dan, mbon)
    MBON_DAN = mat(mbon, dan)
    MBON_MBON = mat(mbon, mbon)
    KC_APL = mat(kc, apl).sum(1)
    APL_KC = mat(apl, kc).sum(0)

    # KC fan-in in distinct *glomeruli* (PN types), the quantity the fly literature
    # uses (~6-7 claws per KC).
    glom = pn.type.str.replace(r"_(l|ad|v|lv)PN$", "", regex=True).values
    ug = sorted(set(glom))
    G = np.zeros((len(ug), len(pn)), dtype=np.float32)
    for a, g in enumerate(glom):
        G[ug.index(g), a] = 1
    GLOM_KC = G @ PN_KC
    fanin = (GLOM_KC >= 3).sum(0)

    # DAN x MBON compartment co-innervation, estimated purely from wiring:
    # cosine(DAN->KC profile, KC->MBON profile). Block structure = compartments.
    a = DAN_KC / (np.linalg.norm(DAN_KC, axis=1, keepdims=True) + 1e-9)
    b = KC_MBON / (np.linalg.norm(KC_MBON, axis=0, keepdims=True) + 1e-9)
    COMP = a @ b

    out = dict(
        PN_KC=PN_KC, GLOM_KC=GLOM_KC, KC_MBON=KC_MBON, DAN_KC=DAN_KC,
        DAN_MBON=DAN_MBON, MBON_DAN=MBON_DAN, MBON_MBON=MBON_MBON,
        KC_APL=KC_APL, APL_KC=APL_KC, COMP=COMP, kc_fanin_glomeruli=fanin,
        pn_type=to_str(pn.type), glomeruli=to_str(ug), kc_type=to_str(kc.type),
        mbon_inst=to_str(mbon.instance), dan_inst=to_str(dan.instance),
        mbon_nt=to_str(mbon.nt.fillna("unknown")),
    )
    stats = {
        "side": side,
        "n_uniglomerular_PN": int(len(pn)), "n_glomeruli": int(len(ug)),
        "n_KC": int(len(kc)), "n_MBON": int(len(mbon)), "n_DAN": int(len(dan)), "n_APL": int(len(apl)),
        "expansion_ratio_KC_per_glomerulus": float(len(kc) / len(ug)),
        "kc_fanin_glomeruli_mean": float(fanin[fanin > 0].mean()),
        "kc_fanin_glomeruli_median": float(np.median(fanin[fanin > 0])),
        "kc_with_pn_input_frac": float((fanin > 0).mean()),
        "kc_to_apl_frac": float((KC_APL > 0).mean()),
        "apl_to_kc_frac": float((APL_KC > 0).mean()),
        "mbon_compartments": sorted({c for c in map(compartment_of, mbon.instance) if c}),
        "dan_compartments": sorted({c for c in map(compartment_of, dan.instance) if c}),
        "mbon_to_dan_synapses": int(MBON_DAN.sum()),
        "mbon_to_dan_frac_pairs_connected": float((MBON_DAN >= 3).mean()),
        "mbon_nt": dict(Counter(out["mbon_nt"].tolist())),
    }
    return out, stats


CX_TYPES = ["EPG", "PEN_a(PEN1)", "PEN_b(PEN2)", "PEG", "Delta7"]


def central_complex(ann, edges):
    """Signed neuron-level heading circuit (both hemispheres)."""
    cx = ann[ann.type.isin(CX_TYPES)].copy()
    cx = cx.sort_values(["type", "instance"])
    ids = cx.index.values
    r = pd.Series(np.arange(len(ids)), index=ids)
    e = edges[edges.body_pre.isin(ids) & edges.body_post.isin(ids)]
    C = np.zeros((len(ids), len(ids)), dtype=np.float32)
    C[r[e.body_pre].values, r[e.body_post].values] = e.weight.values
    sign = cx.nt.map(NT_SIGN).fillna(0.0).values.astype(np.float32)
    # PB glomerulus label from instance, e.g. "EPG(PB08)_R8" -> "R8"
    glom = cx.instance.str.extract(r"_([LR]\d)$")[0].fillna("").values
    stats = {
        "n_neurons": int(len(ids)),
        "types": cx.type.value_counts().to_dict(),
        "n_edges": int((C > 0).sum()),
        "n_synapses": int(C.sum()),
        "nt_by_type": cx.groupby("type").nt.agg(lambda s: s.value_counts().index[0]).to_dict(),
        "reciprocity": float(((C > 0) & (C.T > 0)).sum() / (C > 0).sum()),
    }
    return dict(C=C, sign=sign, type=to_str(cx.type), instance=to_str(cx.instance),
                glom=to_str(glom), body=ids), stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/home/user/data/mcns")
    args = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)

    print("loading ...")
    ann, edges = load(args.src)
    print(f"{len(ann)} traced neurons, {len(edges)} edges")

    stats = {"source": "male-cns v1.0 (minconf 0.5, traced-only)"}
    stats["global"] = global_stats(ann, edges)
    print(json.dumps(stats["global"], indent=1))

    mb, stats["mushroom_body"] = mushroom_body(ann, edges)
    np.savez_compressed(os.path.join(DATA, "mushroom_body_R.npz"), **mb)
    print(json.dumps(stats["mushroom_body"], indent=1))

    cx, stats["central_complex"] = central_complex(ann, edges)
    np.savez_compressed(os.path.join(DATA, "central_complex.npz"), **cx)
    print(json.dumps(stats["central_complex"], indent=1))

    with open(os.path.join(DATA, "connectome_stats.json"), "w") as f:
        json.dump(stats, f, indent=1)


if __name__ == "__main__":
    main()
