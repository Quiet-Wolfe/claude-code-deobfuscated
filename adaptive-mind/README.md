# adaptive-mind: a fly-wired model that learns while you talk to it

> Status: a weekend-scale research prototype, trained and evaluated on 4 CPU cores.
> Every number below comes from `results/` and can be regenerated with the commands at the end.

## The idea in one paragraph

Language models "learn" inside a chat only by keeping text in a context window
and attending over it. The fly does something different: it changes its
synapses. In the mushroom body, a dopamine pulse changes the strength of the
synapses between the few Kenyon cells that are active right now and the output
neurons. The fly doesn't keep a transcript. The experience is stored in the
wiring, the storage is constant-size, and it keeps working however long the
fly's "conversation" runs. This folder builds that mechanism with the actual
wiring measured in the new **Drosophila male CNS connectome** (Janelia FlyEM +
Cambridge + Google + FlyWire, v1.0, 2025/26). It meta-trains the few things
the connectome doesn't specify, and asks three questions:

1. **Can it learn during inference?** New facts, told mid-conversation, stored
   only in fast synapses, then recalled far beyond any context window.
2. **Can it decide how hard to think?** A recurrent "thinking loop" re-reads its
   own synaptic memory and learns when to stop (your idea #1 + #2).
3. **Does the fly's wiring itself carry function?** Rebuild the heading compass
   (central complex) neuron-for-neuron from the connectome, train only ~860
   scalars, and compare with rewired controls (your idea #3).

What is *not* new: fast weights (Hinton & Plaut 1987; Schmidhuber 1992; Ba et al.
2016), differentiable/neuromodulated plasticity (Miconi et al. 2018, 2019), the
delta-rule memory (DeltaNet; Schlag et al. 2021, Yang et al. 2024), and
test-time-learning memories (TTT layers, Titans 2024–25) are the ML ancestors. The
random sparse expansion reading of the mushroom body is the "fly hash" (Dasgupta
et al. 2017). ACT/PonderNet (Graves 2016; Banino et al. 2021) supplies the halting
rule. Connectome-constrained networks are Lappalainen et al. 2024 and Shiu et al.
2024. What *is* new here is putting these together with the real male-CNS
wiring, and treating a chat as the fly's lifetime.

---

## 0. What the connectome says (`connectome.py`)

![connectome](figures/connectome.png)

From 165,122 traced neurons and 124 M synapses:

* **The brain is overwhelmingly recurrent.** 95% of all neurons sit in a single
  strongly-connected component (edges ≥ 5 synapses). Reciprocal connections are
  **686× more common than chance**. A feed-forward stack is the wrong template.
* **The right mushroom body is an expansion coder:** 58 glomeruli → 148
  uniglomerular projection neurons → **2,045 Kenyon cells**. Each KC samples about **5**
  glomeruli (median 5), so the expansion is ×35.
* **One inhibitory neuron (APL) touches 99.95% of Kenyon cells**, and 99.95% of
  KCs talk back to it. That's global feedback inhibition, i.e. a k-winners-take-all.
* **170 dopamine neurons × 49 output neurons form compartments.** Their block
  structure falls out of the wiring alone (cosine of DAN→KC and KC→MBON profiles,
  middle panel). **MBON→DAN feedback** exists (3,420 synapses), so the learning
  circuit is itself a loop.
* The heading circuit (EPG, PEN_a/b, PEG, Δ7): 148 neurons, 8,910 edges,
  138k synapses, **69% of connections reciprocal**.

These numbers set the model's architecture directly: 58 PN channels, the real
2,045-column PN→KC synapse matrix, 5% KC activity via an APL-like k-WTA, 49
MBONs, 170 DANs whose reach onto MBONs is the measured compartment matrix.

## 1. FlyMem: learning at the synapse (`models.py`, `train_memory.py`)

```
token ─► GRU controller ─► 58 PN ─► [connectome PN→KC, fixed] ─► 2045 KC ─► APL k-WTA (5%)
                     │                                                       │ k (sparse key)
                     ├──► value v (49 MBON targets)                          ▼
                     └──► 170 DANs ─► [connectome DAN→MBON compartments] ─► gate g
             fast synapses  W ← W + g ⊙ (v − W k) kᵀ      (starts at 0 every conversation)
             readout        r = W k  ─► answer head
```

The slow weights (embeddings, controller, PN/DAN/value projections, head) are
meta-trained over many short conversations. Each conversation invents a fresh
world, so no fact can live in the slow weights. The fast synapses start empty in
every conversation and change *only* by the local, dopamine-gated rule while the
model reads. The update is exact and runs chunk-parallel (a unit-triangular solve
per MBON, see `delta_memory`), so training is fast even on a CPU.

RESULTS_MEMORY

## 2. What it learned to do with its dopamine

![dopamine](figures/dopamine_and_kc.png)

RESULTS_DOPAMINE

## 3. Learning from praise and correction only (`--task feedback`)

RESULTS_FEEDBACK

## 4. Adaptive recurrent effort: thinking in loops (`ponder.py`)

RESULTS_PONDER

## 5. Rebuilding the fly's compass from the male connectome (`cx.py`)

RESULTS_CX

---

## Try it

```bash
pip install torch numpy pandas pyarrow scipy matplotlib
python chat.py               # talk to it; teach it facts, overwrite them, ask later
python chat.py --script      # the canned demo
```

```
> alice is red
(dopamine gate on write: 0.93)
> bob is blue
> the weather is lovely today and i had a sandwich for lunch
> alice?
alice is red.   [red 100%, ...; gate on read 0.08]
> alice is yellow
> alice?
alice is yellow.
```

## Reproduce

```bash
# 0. connectome (≈570 MB download; the distilled circuits are already in data/)
B=https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome
for f in body-annotations-male-cns-v1.0-minconf-0.5.feather body-neurotransmitters-male-cns-v1.0.feather \
         connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather; do curl -O $B/$f; done
python connectome.py --src .
# 1-3. memory, ablations, feedback
./run_memory_suite.sh
python train_memory.py --task feedback --model fly --steps 1500
# 4. pondering
python ponder.py --steps 2500
# 5. central complex
python cx.py --steps 1500 --seeds 3
python make_figures.py
```

## Files

| file | what |
|---|---|
| `connectome.py` | male-CNS → circuit specs (`data/*.npz`, `data/connectome_stats.json`) |
| `models.py` | FlyMem, the chunk-parallel gated delta rule, GRU / transformer baselines |
| `tasks.py` | conversation streams: facts, feedback-only, chains |
| `train_memory.py` | experiments 1–3 |
| `ponder.py` | adaptive-effort experiment |
| `cx.py` | connectome-constrained heading circuit + controls |
| `chat.py` | interactive demo |
| `make_figures.py` | all figures |
