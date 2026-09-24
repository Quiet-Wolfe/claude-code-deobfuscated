"""Builds every figure in ./figures from ./data and ./results (skips what is missing)."""

import glob
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, "figures")
RES = os.path.join(HERE, "results")

# categorical slots, fixed order (validated default palette)
C = {"fly": "#2a78d6", "transformer": "#eb6834", "gru": "#1baf7a", "yellow": "#eda100",
     "magenta": "#e87ba4", "green": "#008300", "violet": "#4a3aa7", "red": "#e34948"}
INK, INK2, MUTED, GRID = "#0b0b0b", "#52514e", "#898781", "#e1e0d9"
C["fly_learned_expansion"] = C["violet"]
LABEL = {"fly": "FlyMem (plastic MB)", "gru": "GRU", "transformer": "Transformer (256-token window)",
         "fly_learned_expansion": "FlyMem, learned expansion"}

plt.rcParams.update({
    "font.family": "sans-serif", "font.size": 9, "axes.edgecolor": "#c3c2b7",
    "axes.labelcolor": INK2, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": GRID, "grid.linewidth": 0.6, "axes.titlesize": 10,
    "axes.titleweight": "bold", "axes.titlecolor": INK, "figure.facecolor": "#fcfcfb",
    "axes.facecolor": "#fcfcfb", "savefig.facecolor": "#fcfcfb", "legend.frameon": False,
    "lines.linewidth": 2, "lines.markersize": 5,
})


def load(pattern):
    out = {}
    for f in sorted(glob.glob(os.path.join(RES, pattern))):
        out[os.path.basename(f)[:-5]] = json.load(open(f))
    return out


def save(fig, name):
    os.makedirs(FIG, exist_ok=True)
    fig.savefig(os.path.join(FIG, name), dpi=160, bbox_inches="tight")
    plt.close(fig)
    print("wrote", name)


# ----------------------------------------------------------------------------
def fig_connectome():
    mb = np.load(os.path.join(HERE, "data", "mushroom_body_R.npz"))
    st = json.load(open(os.path.join(HERE, "data", "connectome_stats.json")))
    fig, ax = plt.subplots(1, 3, figsize=(13, 3.8), gridspec_kw={"width_ratios": [2.2, 1.2, 1]})
    G = mb["GLOM_KC"] >= 3
    order = np.argsort(mb["kc_type"], kind="stable")
    ax[0].imshow(G[:, order], aspect="auto", cmap="Blues", interpolation="nearest")
    ax[0].set_title("PN→KC wiring, right mushroom body (male CNS v1.0)")
    ax[0].set_xlabel(f"{G.shape[1]} Kenyon cells (sorted by KC type)")
    ax[0].set_ylabel(f"{G.shape[0]} olfactory glomeruli")
    ax[0].grid(False)
    comp = mb["COMP"]
    dan_o = np.argsort(mb["dan_inst"])
    mb_o = np.argsort(mb["mbon_inst"])
    ax[1].imshow(comp[dan_o][:, mb_o], aspect="auto", cmap="Blues", interpolation="nearest")
    ax[1].set_title("DAN × MBON compartments\n(from wiring alone)")
    ax[1].set_xlabel(f"{comp.shape[1]} MBONs")
    ax[1].set_ylabel(f"{comp.shape[0]} dopamine neurons")
    ax[1].grid(False)
    fan = mb["kc_fanin_glomeruli"]
    fan = fan[fan > 0]
    ax[2].hist(fan, bins=np.arange(0.5, fan.max() + 1.5), color=C["fly"], rwidth=0.85)
    ax[2].set_title("Glomeruli per Kenyon cell")
    ax[2].set_xlabel("distinct glomerular inputs (≥3 synapses)")
    ax[2].set_ylabel("Kenyon cells")
    g = st["global"]
    fig.text(0.01, -0.06,
             f"Whole male CNS: {g['neurons_traced']:,} traced neurons, {g['synapses_total']/1e6:.0f}M synapses. "
             f"{g['largest_strongly_connected_component_frac']:.0%} of neurons sit in one strongly-connected (recurrent) core; "
             f"reciprocal pairs are {g['reciprocity_enrichment']:.0f}× more common than chance (edges ≥5 synapses).",
             color=INK2, fontsize=8.5)
    save(fig, "connectome.png")


# ----------------------------------------------------------------------------
def fig_memory():
    R = load("memory/*.json")
    if not R:
        return
    main = [m for m in ("fly", "fly_learned_expansion", "gru", "transformer") if f"{m}_s0" in R]
    fig, ax = plt.subplots(1, 3, figsize=(13, 3.6))
    # (a) accuracy vs lag in 2048-token conversations
    buckets = ["lag_0-64", "lag_64-256", "lag_256-1024", "lag_1024-inf"]
    xl = ["<64", "64–256", "256–1024", ">1024"]
    x = np.arange(len(buckets))
    w = 0.8 / len(main)
    for i, m in enumerate(main):
        d = R[f"{m}_s0"]["stream_T2048"]
        ax[0].bar(x + (i - (len(main) - 1) / 2) * w, [d[b][0] or 0 for b in buckets], w * 0.92,
                  color=C[m], label=LABEL[m])
    ax[0].axvspan(1.5, 3.5, color=GRID, alpha=0.35, lw=0, zorder=0)
    ax[0].text(2.5, 1.04, "fact is older than the\ntransformer's context", ha="center", va="bottom", color=INK2, fontsize=8)
    ax[0].set_xticks(x, xl)
    ax[0].set_xlabel("tokens since the fact was told")
    ax[0].set_ylabel("recall accuracy")
    ax[0].set_ylim(0, 1.18)
    ax[0].set_yticks([0, .25, .5, .75, 1])
    ax[0].set_title("2048-token conversations (trained on 256)")
    handles = [plt.Rectangle((0, 0), 1, 1, color=C[m]) for m in main]
    fig.legend(handles, [LABEL[m] for m in main], loc="lower center", ncol=len(main),
               bbox_to_anchor=(0.5, -0.1), fontsize=8.5)
    # (b) long-range probe
    Ts = [512, 1024, 2048]
    for m in main:
        y = [R[f"{m}_s0"][f"probe_T{T}_facts40"] for T in Ts]
        ax[1].plot(Ts, y, "-o", color=C[m])
    ax[1].set_xscale("log", base=2)
    ax[1].set_xticks(Ts, [str(t) for t in Ts])
    ax[1].xaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax[1].set_xlim(440, 2400)
    ax[1].set_ylim(0, 1.05)
    ax[1].set_xlabel("conversation length (40 facts up front, questions at the end)")
    ax[1].set_ylabel("recall accuracy")
    ax[1].set_title("Remembering after a long silence")
    # (c) capacity
    nf = [25, 50, 100, 200, 350]
    for m in main:
        y = [R[f"{m}_s0"][f"capacity_facts{n}"] for n in nf]
        ax[2].plot(nf, y, "-o", color=C[m])
    ax[2].axvline(25, color=MUTED, lw=0.8, ls=":")
    ax[2].text(27, 0.3, "≈ facts per\ntraining\nepisode", color=INK2, fontsize=7.5)
    ax[2].set_xscale("log")
    ax[2].set_xticks(nf, [str(n) for n in nf])
    ax[2].xaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax[2].set_xlim(20, 420)
    ax[2].set_ylim(0, 1.05)
    ax[2].set_xlabel("facts told back-to-back")
    ax[2].set_ylabel("recall accuracy")
    ax[2].set_title("How much can be learned in one conversation")
    save(fig, "memory.png")

    # ablations
    abl = [("fly", "FlyMem (connectome PN→KC)"), ("fly_shuffled_pnkc", "random PN→KC, same fan-in"),
           ("fly_learned_expansion", "learned 2045-d expansion"), ("fly_no_expansion", "no expansion (58-d keys)"),
           ("fly_no_apl", "no APL inhibition (dense KCs)"), ("fly_frozen", "plasticity off"),
           ("gru", "GRU"), ("transformer", "Transformer (256 window)")]
    abl = [(k, l) for k, l in abl if f"{k}_s0" in R]
    metrics = [("capacity_facts200", "200 facts in a row"), ("probe_T2048_facts40", "40 facts, recalled 1.8k tokens later"),
               ("stream_T256", "normal 256-token chat")]
    fig, ax = plt.subplots(1, len(metrics), figsize=(13, 0.42 * len(abl) + 1.2), sharey=True)
    for j, (key, title) in enumerate(metrics):
        vals = []
        for k, _ in abl:
            r = R[f"{k}_s0"]
            if key == "stream_T256":
                d = r[key]
                num = sum((v[0] or 0) * v[1] for v in d.values())
                den = sum(v[1] for v in d.values())
                vals.append(num / max(den, 1))
            else:
                vals.append(r[key])
        y = np.arange(len(abl))[::-1]
        cols = [C["fly"] if k == "fly" else ("#86b6ef" if k.startswith("fly") else "#c3c2b7") for k, _ in abl]
        ax[j].barh(y, vals, color=cols, height=0.7)
        for yy, v in zip(y, vals):
            ax[j].text(v + 0.01, yy, f"{v:.0%}", va="center", color=INK2, fontsize=8)
        ax[j].set_xlim(0, 1.12)
        ax[j].set_title(title)
        ax[j].grid(axis="y", visible=False)
        if j == 0:
            ax[j].set_yticks(y, [l for _, l in abl])
    save(fig, "memory_ablations.png")


# ----------------------------------------------------------------------------
def fig_dopamine():
    """What the trained FlyMem learned to do with its dopamine and Kenyon cells."""
    f = os.path.join(HERE, "checkpoints", "fly_s0.pt")
    if not os.path.exists(f):
        return
    import torch
    import torch.nn.functional as F
    from models import FlyMem
    from tasks import Vocab, batch_facts, TELL, ASK
    v = Vocab()
    m = FlyMem(v.size, v.n_val)
    m.load_state_dict(torch.load(f))
    m.eval()
    toks, tgt, _ = batch_facts(v, 16, 512, seed=77)
    with torch.no_grad():
        _, _, aux = m(toks, return_aux=True)
    g = aux["G"].mean(-1)
    prev = torch.cat([torch.zeros_like(toks[:, :1]), toks[:, :-1]], 1)
    prev2 = torch.cat([torch.zeros_like(toks[:, :2]), toks[:, :-2]], 1)
    roles = [("TELL", toks == TELL), ("entity (being told)", prev == TELL),
             ("value (being told)", prev2 == TELL), ("ASK", toks == ASK),
             ("entity (being asked)", prev == ASK), ("chatter", toks >= v.chat0)]
    vals = [g[msk].mean().item() for _, msk in roles]
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.4))
    y = np.arange(len(roles))[::-1]
    cols = [C["fly"] if "told" in r else "#c3c2b7" for r, _ in roles]
    ax[0].barh(y, vals, color=cols, height=0.65)
    for yy, val in zip(y, vals):
        ax[0].text(val + 0.01, yy, f"{val:.2f}", va="center", color=INK2, fontsize=8)
    ax[0].set_yticks(y, [r for r, _ in roles])
    ax[0].set_xlim(0, 1.1)
    ax[0].set_xlabel("mean plasticity gate (DAN → KC→MBON synapses)")
    ax[0].set_title("Learned dopamine release, by token role")
    ax[0].grid(axis="y", visible=False)
    # decorrelation by PN->KC expansion + APL, at the positions where memory is read
    with torch.no_grad():
        ent = torch.arange(v.n_ent) + v.ent0
        def state(seq):
            h, _ = m.ctrl(m.emb(seq))
            return h[:, -1]
        h_read = state(torch.stack([torch.full_like(ent, ASK), ent], 1))
        h_write = state(torch.stack([torch.full_like(ent, TELL), ent, torch.full_like(ent, v.val0 + 3)], 1))
        pn = F.normalize(F.relu(m.to_pn(h_read)), dim=-1)
        kc = m.keys(h_read)
        match = (kc * m.keys(h_write)).sum(-1).mean().item()
    off = ~torch.eye(v.n_ent, dtype=bool)
    sim_pn = (pn @ pn.T)[off].numpy()
    sim_kc = (kc @ kc.T)[off].numpy()
    bins = np.linspace(0, 1, 41)
    ax[1].hist(sim_pn, bins, color="#c3c2b7", label=f"58 PN channels (mean {sim_pn.mean():.2f})")
    ax[1].hist(sim_kc, bins, color=C["fly"], alpha=0.85, label=f"2045 KCs after APL (mean {sim_kc.mean():.2f})")
    ax[1].axvline(match, color=INK, lw=1, ls="--")
    ax[1].text(match - 0.01, ax[1].get_ylim()[1] * 0.9, f"same entity,\nwrite vs read\ncode: {match:.2f}",
               ha="right", va="top", color=INK2, fontsize=7.5)
    ax[1].set_xlabel("cosine similarity between memory keys of two different entities")
    ax[1].set_ylabel("entity pairs")
    ax[1].set_title("Expansion + inhibition pulls memories apart")
    ax[1].legend(fontsize=7.5)
    save(fig, "dopamine_and_kc.png")
    return dict(zip([r for r, _ in roles], vals)), float(sim_pn.mean()), float(sim_kc.mean()), match


# ----------------------------------------------------------------------------
def fig_ponder():
    R = {}
    for f in glob.glob(os.path.join(RES, "ponder", "ponder_*_s0.json")):
        R.update(json.load(open(f)))
    if not R:
        return
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.6))
    series = []
    if "adaptive" in R:
        series.append(("FlyMem + learned halting", R["adaptive"], C["fly"], "-"))
    if "fixed4" in R:
        series.append(("fixed 4 loops", R["fixed4"]["eval_loops=4"], C["transformer"], "-"))
        series.append(("fixed-4 model run for 10 loops", R["fixed4"]["eval_loops=10"], C["transformer"], ":"))
    if "transformer" in R:
        series.append(("4-layer transformer", R["transformer"], C["gru"], "-"))
    for name, d, col, ls in series:
        h = sorted(int(k) for k in d)
        y = [d[str(k)]["acc"] for k in h]
        ax[0].plot(h, y, ls, marker="o", color=col, label=name)
    ax[0].axvspan(0.5, 4.5, color=GRID, alpha=0.4, lw=0, zorder=0)
    ax[0].text(2.5, 0.03, "trained on 1–4 hops", ha="center", color=INK2, fontsize=8)
    ax[0].set_xlabel("hops needed (never given to the model)")
    ax[0].set_ylabel("answer accuracy")
    ax[0].set_ylim(0, 1.05)
    ax[0].set_title("Following a chain of facts learned in-conversation")
    ax[0].legend(fontsize=7.5, loc="upper right")
    if "adaptive" in R:
        d = R["adaptive"]
        h = sorted(int(k) for k in d)
        ax[1].plot(h, [d[str(k)]["loops"] for k in h], "-o", color=C["fly"])
        ax[1].plot(h, [k + 1 for k in h], "--", color=MUTED, lw=1)
        ax[1].text(h[-1], h[-1] + 1, " hops + 1", color=MUTED, fontsize=8, va="bottom", ha="right")
        ax[1].axvspan(0.5, 4.5, color=GRID, alpha=0.4, lw=0, zorder=0)
        ax[1].set_xlabel("hops needed")
        ax[1].set_ylabel("thinking loops used (halt when p>0.5)")
        ax[1].set_title("It decides how long to think")
    save(fig, "ponder.png")


# ----------------------------------------------------------------------------
def fig_feedback():
    R = load("feedback/*.json")
    if not R:
        return
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.6), sharey=True)
    for j, T in enumerate([256, 1024]):
        cats = ["rejected_0", "rejected_1", "rejected_2", "rejected_3", "confirmed"]
        xl = ["nothing yet", "1 NO", "2 NOs", "3 NOs", "heard YES"]
        x = np.arange(len(cats))
        models = [m for m in ("fly", "fly_learned_expansion", "gru", "transformer") if f"{m}_s0" in R]
        w = 0.8 / len(models)
        for i, m in enumerate(models):
            d = R[f"{m}_s0"][f"feedback_T{T}"]
            ax[j].bar(x + (i - (len(models) - 1) / 2) * w, [d.get(c, {"acc": 0})["acc"] for c in cats],
                      w * 0.92, color=C[m], label=LABEL[m].replace(" (256-token window)", ""))
        ideal = [R[f"{models[0]}_s0"][f"feedback_T{T}"].get(c, {"ideal": np.nan})["ideal"] for c in cats]
        ax[j].plot(x, ideal, "_", ms=26, mew=2, color=INK, label="ideal observer")
        ax[j].set_xticks(x, xl)
        ax[j].set_ylim(0, 1.08)
        ax[j].set_title(f"{T}-token conversations" + (" (training length)" if T == 256 else " (4× longer)"))
        ax[j].set_xlabel("what the conversation has revealed about this item (4 options)")
        if j == 0:
            ax[j].set_ylabel("accuracy of next answer")
            ax[j].legend(fontsize=7.5, loc="upper left")
    save(fig, "feedback.png")


# ----------------------------------------------------------------------------
def fig_cx():
    R = load("cx/*.json")
    if not R:
        return
    modes = [("connectome", "male-CNS wiring", C["fly"]), ("type_shuffled", "same cell-type wiring, map scrambled", C["transformer"]),
             ("erdos_renyi", "random wiring", C["gru"]), ("dense_small", "unconstrained 26-neuron RNN", C["yellow"]),
             ("dense", "unconstrained 148-neuron RNN", C["magenta"])]
    fig = plt.figure(figsize=(14, 4.2))
    gs = fig.add_gridspec(1, 3, width_ratios=[1.35, 1.3, 1.3], wspace=0.42)
    ax = fig.add_subplot(gs[0])
    for mode, lab, col in modes:
        runs = [r for k, r in R.items() if r["mode"] == mode]
        if not runs:
            continue
        e = np.array([r["err_deg_by_step"] for r in runs])
        t = np.arange(e.shape[1]) + 5
        ax.plot(t, e.mean(0), color=col, lw=1.6, label=f"{lab} ({runs[0]['params']:,} params)")
        if len(runs) > 1:
            ax.fill_between(t, e.min(0), e.max(0), color=col, alpha=0.12, lw=0)
    ax.axhline(90, color=MUTED, ls=":", lw=1)
    ax.text(5, 91, "chance", color=MUTED, fontsize=8, ha="left", va="bottom")
    ax.axvline(60, color=MUTED, lw=0.8)
    ax.text(62, 62, "trained horizon →\n tested beyond", color=INK2, fontsize=7.5)
    ax.set_ylim(0, 100)
    ax.set_xlabel("time steps in darkness")
    ax.set_ylabel("heading error (deg)")
    ax.set_title("Path integration, mean ± range of 3 seeds")
    ax.legend(fontsize=7, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=1)
    # bump plots
    try:
        import torch
        from cx import ConnectomeRNN, load_cx, make_batch
        cx = load_cx()
        epg = cx["type"] == "EPG"
        gl = cx["glom"][epg]
        pos = np.array([(-int(g[1:]) if g[0] == "L" else int(g[1:])) for g in gl])
        order = np.argsort(pos, kind="stable")
        for j, mode in enumerate(["connectome", "type_shuffled"]):
            f = os.path.join(HERE, "checkpoints", f"cx_{mode}_s0.pt")
            if not os.path.exists(f):
                continue
            m = ConnectomeRNN(cx, mode, 0)
            m.load_state_dict(torch.load(f))
            rng = np.random.default_rng(7)
            om, cue, tgt, th = make_batch(1, 120, rng)
            with torch.no_grad():
                out, rates = m(om, cue, return_rates=True)
            r = rates[0][:, torch.tensor(epg)].numpy()[:, order].T
            a = fig.add_subplot(gs[j + 1])
            a.imshow(r / (r.max() + 1e-9), aspect="auto", cmap="Blues", interpolation="nearest")
            a.set_yticks(np.arange(len(order))[::6], [gl[o] for o in order][::6])
            if j == 0:
                a.set_ylabel("EPG neurons, by protocerebral-bridge glomerulus")
            a.set_xlabel("time")
            a.grid(False)
            a.set_title(["male-CNS wiring: EPG activity", "scrambled map: EPG activity"][j])
            ax2 = a.twinx()
            ax2.plot(np.degrees(np.angle(np.exp(1j * th[0]))), color=C["transformer"], lw=1.2)
            pred = np.degrees(np.arctan2(out[0, :, 1], out[0, :, 0]).numpy())
            ax2.plot(pred, color=INK, lw=0.8, ls="--")
            ax2.set_ylim(-180, 180)
            ax2.set_yticks([-180, 0, 180] if j == 1 else [])
            ax2.grid(False)
            ax2.spines["right"].set_visible(True)
            if j == 1:
                ax2.set_ylabel("heading (deg): true (orange), decoded (dashed)", color=INK2, fontsize=8)
    except Exception as ex:          # figure still useful without the heatmaps
        print("bump plot skipped:", ex)
    save(fig, "cx.png")


if __name__ == "__main__":
    fig_connectome()
    fig_memory()
    print(fig_dopamine())
    fig_ponder()
    fig_feedback()
    fig_cx()
