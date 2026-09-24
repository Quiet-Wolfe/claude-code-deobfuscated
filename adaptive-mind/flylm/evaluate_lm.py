"""Compare FlyLM and the GPT-2 baseline after training.

1. validation loss by token position in 1024-token windows (trained on 256)
2. in-context recall: a random 20-token string, a gap of ordinary story text,
   then the same string again; accuracy of predicting the repeat (tokens 2..20)
3. samples

    python flylm/evaluate_lm.py
"""

import json
import os
import sys

import numpy as np
import torch
from transformers import AutoModelForCausalLM, PreTrainedTokenizerFast

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)


def load(path):
    m = AutoModelForCausalLM.from_pretrained(path, trust_remote_code=True)
    return m.eval()


@torch.no_grad()
def token_losses(model, x, max_ctx=None):
    """Per-token next-token loss for (B,T). If max_ctx is set (GPT-2), positions
    beyond it are scored with a sliding window of max_ctx tokens."""
    B, T = x.shape
    if max_ctx is None or T <= max_ctx:
        lo = model(x).logits.float()
        return torch.nn.functional.cross_entropy(lo[:, :-1].transpose(1, 2), x[:, 1:], reduction="none")
    out = torch.zeros(B, T - 1)
    first = model(x[:, :max_ctx]).logits.float()
    out[:, :max_ctx - 1] = torch.nn.functional.cross_entropy(first[:, :-1].transpose(1, 2), x[:, 1:max_ctx], reduction="none")
    for t in range(max_ctx, T):
        lo = model(x[:, t - max_ctx + 1:t + 1]).logits[:, -1].float()
        out[:, t - 1] = torch.nn.functional.cross_entropy(lo, x[:, t], reduction="none")
    return out


def main():
    torch.set_num_threads(4)
    data = "/home/user/data/tinystories/tok"
    val = np.memmap(os.path.join(data, "valid.bin"), dtype=np.uint16, mode="r")
    tok = PreTrainedTokenizerFast.from_pretrained(os.path.join(ROOT, "flylm-tinystories"))
    models = {"FlyLM": (load(os.path.join(ROOT, "flylm-tinystories")), None),
              "GPT-2 (same size)": (load(os.path.join(ROOT, "gpt2-tinystories-baseline")), 512)}
    rng = np.random.default_rng(0)
    res = {}

    # 1. loss by position
    T = 1024
    starts = rng.integers(0, len(val) - T - 1, 24)
    x = torch.from_numpy(np.stack([val[s:s + T].astype(np.int64) for s in starts]))
    buckets = [(0, 64), (64, 256), (256, 512), (512, 1023)]
    for name, (m, ctx) in models.items():
        L = torch.cat([token_losses(m, b, ctx) for b in x.split(8)])
        res.setdefault("loss_by_position", {})[name] = {f"{a}-{b}": float(L[:, a:b].mean()) for a, b in buckets}
        print(name, res["loss_by_position"][name], flush=True)

    # 2. in-context recall of a random string
    res["recall"] = {}
    for gap in [32, 128, 384, 768]:
        seqs = []
        for i in range(24):
            r = rng.integers(1, len(tok), 20)
            pre = val[starts[i]:starts[i] + 16].astype(np.int64)
            filler = val[starts[i] + 100:starts[i] + 100 + gap].astype(np.int64)
            seqs.append(np.concatenate([pre, r, filler, r]))
        x2 = torch.from_numpy(np.stack(seqs))
        for name, (m, ctx) in models.items():
            with torch.no_grad():
                if ctx is None or x2.shape[1] <= ctx:
                    lo = m(x2).logits
                    pred = lo[:, -20:-1].argmax(-1)
                else:
                    pred = torch.stack([m(x2[:, t - ctx + 1:t + 1]).logits[:, -1].argmax(-1)
                                        for t in range(x2.shape[1] - 20, x2.shape[1] - 1)], 1)
            acc = float((pred == x2[:, -19:]).float().mean())
            res["recall"].setdefault(name, {})[gap] = acc
            print("recall gap", gap, name, acc, flush=True)

    # 3. samples
    res["samples"] = {}
    for name, (m, _) in models.items():
        torch.manual_seed(0)
        ids = tok("Once upon a time, there was a little girl named Lily.", return_tensors="pt").input_ids
        with torch.no_grad():
            out = m.generate(ids, max_new_tokens=120, do_sample=True, top_k=40, temperature=0.7, pad_token_id=0)
        res["samples"][name] = tok.decode(out[0])
        print(f"--- {name}\n{res['samples'][name]}\n", flush=True)

    os.makedirs(os.path.join(ROOT, "results", "lm"), exist_ok=True)
    with open(os.path.join(ROOT, "results", "lm", "evaluation.json"), "w") as f:
        json.dump(res, f, indent=1)


if __name__ == "__main__":
    main()
