"""
Experiment 2: learning while chatting.

Meta-train each model on short conversations (T=256) in which the facts are new
every episode, then test on conversations up to 8x longer than anything seen in
training, including the case where a fact must be recalled long after it has
scrolled out of a transformer's context window.

    python train_memory.py --model fly --steps 2000
"""

import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from models import FlyMem, GRUBaseline, TransformerBaseline, n_params
from tasks import Vocab, batch_facts, batch_feedback, long_range_probe

HERE = os.path.dirname(os.path.abspath(__file__))
TRAIN_T = 256

MODELS = {
    "fly": lambda v: FlyMem(v.size, v.n_val),
    "fly_shuffled_pnkc": lambda v: FlyMem(v.size, v.n_val, pn="shuffled"),
    "fly_learned_expansion": lambda v: FlyMem(v.size, v.n_val, key_mode="learned_expansion"),
    "fly_no_expansion": lambda v: FlyMem(v.size, v.n_val, key_mode="dense"),
    "fly_no_apl": lambda v: FlyMem(v.size, v.n_val, kc_sparsity=1.0),
    "fly_frozen": lambda v: FlyMem(v.size, v.n_val, plastic=False),
    "gru": lambda v: GRUBaseline(v.size, v.n_val),
    "transformer": lambda v: TransformerBaseline(v.size, v.n_val, window=TRAIN_T),
}


def loss_acc(logits, tgt):
    m = tgt >= 0
    lo = logits[m]
    y = tgt[m]
    return F.cross_entropy(lo, y), (lo.argmax(-1) == y).float()


@torch.no_grad()
def evaluate(model, vocab, seed=1234):
    model.eval()
    res = {}
    # 1. streams of increasing length, accuracy by lag bucket
    buckets = [(0, 64), (64, 256), (256, 1024), (1024, 10 ** 9)]
    for T in [256, 1024, 2048]:
        correct = {b: [] for b in buckets}
        for i in range(4):
            toks, tgt, lag = batch_facts(vocab, 16, T, seed=seed + 100 * T + i)
            logits, _ = model(toks)
            m = tgt >= 0
            ok = (logits.argmax(-1) == tgt)[m]
            lg = lag[m]
            for b in buckets:
                sel = (lg >= b[0]) & (lg < b[1])
                correct[b] += ok[sel].float().tolist()
        res[f"stream_T{T}"] = {f"lag_{a}-{b if b < 1e9 else 'inf'}": (float(np.mean(c)) if c else None, len(c))
                               for (a, b), c in correct.items()}
    # 2. long-range probe: N facts, long silence, then all queries
    for T in [512, 1024, 2048]:
        for nf in [10, 40]:
            toks, tgt = long_range_probe(vocab, 32, T, nf, seed=seed + T + nf)
            logits, _ = model(toks)
            _, acc = loss_acc(logits, tgt)
            res[f"probe_T{T}_facts{nf}"] = float(acc.mean())
    # 3. capacity: many facts back to back, queried right after
    for nf in [25, 50, 100, 200, 350]:
        T = 5 * nf + 8
        toks, tgt = long_range_probe(vocab, 16, T, nf, seed=seed + 7 * nf)
        logits, _ = model(toks)
        _, acc = loss_acc(logits, tgt)
        res[f"capacity_facts{nf}"] = float(acc.mean())
    model.train()
    return res


@torch.no_grad()
def evaluate_feedback(model, vocab, n_opts=4, seed=4321):
    """Accuracy grouped by what the conversation has revealed so far about the
    queried entity, next to the ideal Bayesian observer."""
    model.eval()
    res = {}
    for T in [256, 1024]:
        groups = {}
        for i in range(8):
            toks, tgt, hist = batch_feedback(vocab, 16, T, seed=seed + 10 * T + i, n_opts=n_opts)
            logits, _ = model(toks)
            m = tgt >= 0
            ok = (logits.argmax(-1) == tgt)[m].float()
            for h, o in zip(hist[m].tolist(), ok.tolist()):
                groups.setdefault(h, []).append(o)
        res[f"feedback_T{T}"] = {
            ("confirmed" if h == 99 else f"rejected_{h}"): {
                "acc": float(np.mean(v)), "n": len(v),
                "ideal": 1.0 if h == 99 else 1.0 / (n_opts - h)}
            for h, v in sorted(groups.items())}
        allq = [o for v in groups.values() for o in v]
        ideal = [1.0 if h == 99 else 1.0 / (n_opts - h) for h, v in groups.items() for _ in v]
        res[f"feedback_T{T}"]["overall"] = {"acc": float(np.mean(allq)), "ideal": float(np.mean(ideal))}
    model.train()
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", default="facts", choices=["facts", "feedback"])
    ap.add_argument("--model", default="fly", choices=list(MODELS))
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--curriculum", action="store_true",
                    help="short conversations first (T=64, 4x batch) for the first half of training")
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)

    vocab = Vocab() if args.task == "facts" else Vocab(n_special=7)
    model = MODELS[args.model](vocab)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, args.lr, total_steps=args.steps, pct_start=0.05)
    print(f"{args.model}: {n_params(model)} params")

    log = []
    t0 = time.time()
    for step in range(args.steps):
        batch = batch_facts if args.task == "facts" else batch_feedback
        T, B = TRAIN_T, args.batch
        if args.curriculum and step < args.steps // 2:
            T, B = 64, 4 * args.batch
        toks, tgt, _ = batch(vocab, B, T, seed=args.seed * 10 ** 6 + step)
        logits, _ = model(toks)
        loss, acc = loss_acc(logits, tgt)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 50 == 0 or step == args.steps - 1:
            log.append((step, loss.item(), acc.mean().item()))
            print(f"step {step:5d} loss {loss.item():.3f} acc {acc.mean().item():.3f} ({time.time() - t0:.0f}s)", flush=True)

    res = evaluate(model, vocab) if args.task == "facts" else evaluate_feedback(model, vocab)
    res.update(model=args.model, params=n_params(model), steps=args.steps, seed=args.seed,
               train_log=log, train_seconds=time.time() - t0)
    print(json.dumps({k: v for k, v in res.items() if k != "train_log"}, indent=1))
    sub = "memory" if args.task == "facts" else "feedback"
    tag = "" if args.task == "facts" else "feedback_"
    os.makedirs(os.path.join(HERE, "results", sub), exist_ok=True)
    with open(os.path.join(HERE, "results", sub, f"{args.model}_s{args.seed}.json"), "w") as f:
        json.dump(res, f, indent=1)
    os.makedirs(os.path.join(HERE, "checkpoints"), exist_ok=True)
    torch.save(model.state_dict(), os.path.join(HERE, "checkpoints", f"{tag}{args.model}_s{args.seed}.pt"))


if __name__ == "__main__":
    main()
