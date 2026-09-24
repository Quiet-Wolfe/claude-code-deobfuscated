"""
Experiment 3: adaptive recurrent effort.

During a conversation the model is told links `LINK a b`. Later it is asked
`QUERY a` = "where does the chain that starts at a end?". The number of hops is
never given. The model answers by *thinking in a loop*: each loop re-reads its
own plastic mushroom-body memory with the current thought as the cue, updates the
thought, and a learned halting unit decides whether it is done (PonderNet,
Banino et al. 2021). Nothing tells it how many loops to use.

Trained on chains of 1-4 hops, tested on 1-10 hops. Compared with:
  * the same model forced to use a fixed number of loops
  * a 4-layer transformer (fixed depth, full attention over the conversation)

    python ponder.py --steps 3000
"""

import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from models import TransformerBaseline, delta_memory, n_params
from tasks import Vocab, chain_episode, QUERY, PAD

HERE = os.path.dirname(os.path.abspath(__file__))


def curriculum(step, steps, max_len):
    """Chains of 1-2 hops for the first 40% of training, then 1..max_len (both models).
    (A 1-hop-only phase makes the halting unit collapse to 'always stop after
    one loop', after which later loops get almost no gradient.)"""
    return min(2, max_len) if step < 0.4 * steps else max_len


def make_batch(vocab, B, n_chains, max_len, rng, min_len=1):
    seqs, qs = [], []
    for _ in range(B):
        toks, queries = chain_episode(vocab, rng, n_chains, max_len, min_len=min_len)
        seqs.append(toks)
        qs.append(queries)
    T = max(map(len, seqs))
    toks = torch.full((B, T), PAD, dtype=torch.long)
    for b, s in enumerate(seqs):
        toks[b, T - len(s):] = torch.tensor(s)          # left-pad
    start = torch.tensor([[q[0] for q in qq] for qq in qs])
    end = torch.tensor([[q[1] for q in qq] for qq in qs])
    hops = torch.tensor([[q[2] for q in qq] for qq in qs])
    return toks, start, end, hops


class FlyPonder(nn.Module):
    """Plastic mushroom-body memory + a recurrent 'thinking' loop over it.

    As in the fly, the memory key is the *sensory* code of the cue: the token
    just perceived goes through PN -> KC (connectome) -> APL. At `LINK a b` the
    key is the KC code of `a` and the MBON target is a code for `b`; a GRU
    controller watches the stream and drives the dopamine neurons that decide
    when to write. While thinking, the current thought is turned back into a
    sensory-like PN pattern and used as the next cue, so a retrieved `b`
    becomes the probe for `b -> c`.
    """

    def __init__(self, vocab, d_emb=64, d_h=128):
        super().__init__()
        from models import load_mb, kwta
        self.vocab, self.kwta = vocab, kwta
        GK, COMP = load_mb("connectome")
        self.n_glom, self.n_kc = GK.shape
        self.n_dan, self.n_mbon = COMP.shape
        self.k = int(round(0.05 * self.n_kc))
        self.register_buffer("pn_kc", GK)
        comp = COMP.clamp(min=0)
        self.register_buffer("dan_mbon", comp / (comp.sum(0, keepdims=True) + 1e-6))
        self.emb = nn.Embedding(vocab.size, d_emb)
        self.ctrl = nn.GRU(d_emb, d_h, batch_first=True)
        self.to_pn = nn.Linear(d_emb, self.n_glom)         # sensory code -> glomeruli
        self.to_val = nn.Linear(d_emb, self.n_mbon)        # MBON target for the new item
        self.to_dan = nn.Linear(d_h + d_emb, self.n_dan)
        self.dan_bias = nn.Parameter(torch.full((self.n_mbon,), -2.0))
        self.cell = nn.GRUCell(self.n_mbon, d_emb)          # retrieved MBON pattern -> next thought
        self.halt = nn.Linear(d_emb + 1, 1)
        self.out = nn.Sequential(nn.Linear(d_emb, d_h), nn.GELU(), nn.Linear(d_h, vocab.n_ent))

    def keys(self, sensory):
        z = F.relu(self.to_pn(sensory)) @ self.pn_kc
        return F.normalize(self.kwta(z, self.k), dim=-1, eps=1e-6)

    def write(self, toks):
        x = self.emb(toks)
        h, _ = self.ctrl(x)
        prev = torch.cat([torch.zeros_like(x[:, :1]), x[:, :-1]], 1)
        K = self.keys(prev)                                   # cue = what was just seen
        V = self.to_val(x)
        dan = F.relu(self.to_dan(torch.cat([h, x], -1)))
        G = torch.sigmoid(dan @ self.dan_mbon * 4 + self.dan_bias)
        _, W = delta_memory(K, V, G)
        return W

    def think(self, W, start, n_loops):
        """Returns per-loop logits (n,B,Q,E) and halting probs lambda (n,B,Q)."""
        q = self.emb(start + self.vocab.ent0)                  # (B,Q,d)
        B, Q, d = q.shape
        logits, lam = [], []
        for _ in range(n_loops):
            r = torch.einsum("bmn,bqn->bqm", W, self.keys(q))   # MBON readout
            q = self.cell(r.reshape(B * Q, -1), q.reshape(B * Q, d)).view(B, Q, d)
            logits.append(self.out(q))
            lam.append(torch.sigmoid(self.halt(torch.cat([q, r.norm(dim=-1, keepdim=True)], -1)))[..., 0])
        return torch.stack(logits), torch.stack(lam)


def halting_dist(lam):
    """PonderNet: p_n = lambda_n * prod_{j<n}(1-lambda_j); last step takes the rest."""
    lam = lam.clone()
    lam[-1] = 1.0
    surv = torch.cumprod(torch.cat([torch.ones_like(lam[:1]), 1 - lam[:-1]]), 0)
    return lam * surv


def ponder_loss(logits, lam, target, beta=0.05, prior=0.2):
    p = halting_dist(lam)                                           # (n,B,Q)
    n = logits.shape[0]
    ce = F.cross_entropy(logits.flatten(0, 2), target.expand(n, -1, -1).flatten(), reduction="none")
    rec = (p.flatten() * ce).sum() / target.numel()
    geo = prior * (1 - prior) ** torch.arange(n, dtype=torch.float32)
    geo = geo / geo.sum()
    kl = (p * (torch.log(p + 1e-9) - torch.log(geo)[:, None, None])).sum(0).mean()
    return rec + beta * kl


@torch.no_grad()
def ponder_predict(model, W, start, n_max):
    logits, lam = model.think(W, start, n_max)
    halted = torch.zeros_like(lam[0], dtype=torch.bool)
    steps = torch.full_like(lam[0], n_max, dtype=torch.long)
    pred = logits[-1].argmax(-1)
    for i in range(n_max):
        now = (lam[i] > 0.5) & ~halted
        pred = torch.where(now, logits[i].argmax(-1), pred)
        steps = torch.where(now, torch.full_like(steps, i + 1), steps)
        halted |= now
    return pred, steps


def train_fly(vocab, steps, seed, max_len=4, n_chains=6, fixed=None, B=32, lr=2e-3, n_max=8):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = FlyPonder(vocab)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=steps, pct_start=0.05)
    t0 = time.time()
    for step in range(steps):
        toks, start, end, hops = make_batch(vocab, B, n_chains, curriculum(step, steps, max_len), rng)
        W = model.write(toks)
        if fixed:
            logits, _ = model.think(W, start, fixed)
            loss = F.cross_entropy(logits[-1].flatten(0, 1), end.flatten())
        else:
            logits, lam = model.think(W, start, n_max)
            loss = ponder_loss(logits, lam, end)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 100 == 0:
            print(f"[fly fixed={fixed}] step {step} loss {loss.item():.3f} ({time.time() - t0:.0f}s)", flush=True)
    return model


def train_transformer(vocab, steps, seed, max_len=4, n_chains=6, B=32, lr=1e-3, n_layers=4):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = TransformerBaseline(vocab.size, vocab.n_ent, n_layers=n_layers)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=steps, pct_start=0.05)
    for step in range(steps):
        toks, start, end, hops = make_batch(vocab, B, n_chains, curriculum(step, steps, max_len), rng)
        logits, tgt = transformer_forward(model, vocab, toks, start, end)
        loss = F.cross_entropy(logits.flatten(0, 1), tgt.flatten())
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 100 == 0:
            print(f"[transformer] step {step} loss {loss.item():.3f}", flush=True)
    return model


def transformer_forward(model, vocab, toks, start, end):
    """Appends `QUERY a` for every chain; the answer is read at each `a`."""
    B, Q = start.shape
    q = torch.stack([torch.full_like(start, QUERY), start + vocab.ent0], -1).view(B, 2 * Q)
    logits, _ = model(torch.cat([toks, q], 1))
    return logits[:, toks.shape[1] + 1::2], end


@torch.no_grad()
def evaluate(vocab, fly=None, fixed=None, tf=None, seed=999, n_max=16, hops_range=range(1, 11)):
    rng = np.random.default_rng(seed)
    out = {}
    for h in hops_range:
        accs, steps_used = [], []
        for _ in range(4):
            toks, start, end, hops = make_batch(vocab, 32, 6, h, rng, min_len=h)
            if fly is not None:
                W = fly.write(toks)
                if fixed:
                    logits, _ = fly.think(W, start, fixed)
                    pred = logits[-1].argmax(-1)
                else:
                    pred, st = ponder_predict(fly, W, start, n_max)
                    steps_used.append(st.float().mean().item())
            else:
                logits, _ = transformer_forward(tf, vocab, toks, start, end)
                pred = logits.argmax(-1)
            accs.append((pred == end).float().mean().item())
        out[h] = {"acc": float(np.mean(accs))}
        if steps_used:
            out[h]["loops"] = float(np.mean(steps_used))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--only", default="all")
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    vocab = Vocab()
    res = {}
    os.makedirs(os.path.join(HERE, "results", "ponder"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "checkpoints"), exist_ok=True)
    if args.only in ("all", "adaptive", "eval_adaptive"):
        ck = os.path.join(HERE, "checkpoints", f"ponder_adaptive_s{args.seed}.pt")
        if args.only == "eval_adaptive":
            m = FlyPonder(vocab)
            m.load_state_dict(torch.load(ck))
        else:
            m = train_fly(vocab, args.steps, args.seed)
            torch.save(m.state_dict(), ck)
        res["adaptive"] = evaluate(vocab, fly=m)
        res["params_fly"] = n_params(m)
        print("adaptive", json.dumps(res["adaptive"]))
    if args.only in ("all", "fixed"):
        m = train_fly(vocab, args.steps, args.seed, fixed=4)
        res["fixed4"] = {f"eval_loops={n}": evaluate(vocab, fly=m, fixed=n) for n in (4, 10)}
        print("fixed4", json.dumps(res["fixed4"]))
    if args.only in ("all", "transformer"):
        m = train_transformer(vocab, args.steps, args.seed)
        res["transformer"] = evaluate(vocab, tf=m)
        res["params_transformer"] = n_params(m)
        print("transformer", json.dumps(res["transformer"]))
    tag = args.only.replace("eval_", "")
    with open(os.path.join(HERE, "results", "ponder", f"ponder_{tag}_s{args.seed}.json"), "w") as f:
        json.dump(res, f, indent=1)


if __name__ == "__main__":
    main()
