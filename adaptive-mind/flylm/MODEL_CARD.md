---
library_name: transformers
pipeline_tag: text-generation
tags:
- connectome
- drosophila
- mushroom-body
- fast-weights
- recurrent
- delta-rule
- custom_code
datasets:
- roneneldan/TinyStories
---

# FlyLM-TinyStories

A small language model whose sequence mixer is the **mushroom body of the fruit
fly**, wired from the *Drosophila* male CNS connectome (Janelia FlyEM /
Cambridge / Google / FlyWire, v1.0). There is no attention anywhere. The model
remembers its context by **changing its own synapses while it reads**.

Trained from scratch on a CPU (4 cores) on TinyStories. It is a research
prototype: expect children's-story English, not an assistant.

## Use

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

tok = AutoTokenizer.from_pretrained("PATH_OR_REPO")
model = AutoModelForCausalLM.from_pretrained("PATH_OR_REPO", trust_remote_code=True)

ids = tok("Once upon a time, there was a little girl named Lily.", return_tensors="pt").input_ids
out = model.generate(ids, max_new_tokens=100, do_sample=True, top_k=40, temperature=0.7)
print(tok.decode(out[0]))
```

### Keep learning across calls

The generation cache is the synaptic state itself (`output.state`). It has a
constant size, however long the text gets. Pass it back in to continue from
everything the model has read so far:

```python
out = model(tok("Tom had a red kite called Zip.", return_tensors="pt").input_ids)
state = out.state                              # KC->MBON synapses after reading
nxt = model(tok(" Later, Tom flew", return_tensors="pt").input_ids, state=state)
```

## Architecture

Every layer (4 layers, hidden size 192):

```
x ─► causal depthwise conv (k=4)                 "PN temporal filtering"
  ─► for each Kenyon-cell lobe (γ 662 KCs, α/β 874, α'/β' 350; real counts):
       query/key drive onto 58 glomeruli (PN)
       ─► the lobe's real PN→KC synapse matrix (fixed buffer)
       ─► APL inhibition: 5% of KCs stay active (k-winners-take-all)
       value: 49 MBON targets
       170 DANs ─► connectome DAN→MBON compartments ─► plasticity gate per MBON
       fast synapses  W ← W + g ⊙ (v − W k) kᵀ     (dopamine-gated delta rule)
       read           r = W q
  ─► concat lobes ─► linear ─► residual ─► SwiGLU MLP ─► residual
```

* The connectome-fixed parts (PN→KC wiring per lobe, DAN→MBON compartments) are
  stored in `config.json` and as non-trainable buffers.
* The delta rule is computed exactly in chunks during training (unit-triangular
  solve per MBON) and one token at a time during generation.
* `num_loops` in the config repeats the layer stack with shared weights
  (recurrent depth). It is 1 in this checkpoint.

## Training

| | |
|---|---|
| data | TinyStories V2 (GPT-4 part), first 200 MB ≈ 52M tokens; BPE vocabulary 4,096 |
| budget | TRAIN_BUDGET |
| optimizer | AdamW (0.9, 0.95), wd 0.1, lr 2e-3 cosine, bf16 autocast, CPU |
| context during training | 256 tokens |

## Results

RESULTS_TABLE

## Limitations

* Tiny and briefly trained, on a synthetic children's-story corpus.
* Batched generation with left padding is not supported (the state is a
  recurrent memory, so pad tokens would be written into it). Generate one
  sequence at a time, or with equal-length prompts.
* Beam search is not supported (no cache reordering).

## Credit

Connectome: Drosophila male CNS v1.0, Janelia FlyEM, Cambridge Connectomics,
Google Research and FlyWire (public release `gs://flyem-male-cns`). Ideas
borrowed from fast weights, DeltaNet, differentiable plasticity and the
"fly hash" literature. Code: `adaptive-mind/flylm` in this repository.
