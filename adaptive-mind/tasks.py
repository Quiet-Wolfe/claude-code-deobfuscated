"""
Synthetic "conversation" streams for testing learning *during* inference.

Every episode is a fresh conversation with a fresh, random world: entity -> value
bindings are resampled per episode, so nothing about them can be stored in the
slow (trained) weights. The model has to pick them up while the stream is running.

Token layout
    PAD TELL ASK  | entities | values | chatter
Turns
    TELL e v      a fact (sometimes an *update* that overrides an earlier fact)
    ASK  e        the model must output the current value of e at the `e` position
    chatter       1-8 filler tokens (conversation noise that carries no facts)
"""

import numpy as np
import torch

PAD, TELL, ASK, LINK, QUERY = 0, 1, 2, 3, 4
YES, NO = 5, 6                     # only exist in Vocab(n_special=7)
N_SPECIAL = 5


class Vocab:
    def __init__(self, n_ent=400, n_val=64, n_chat=64, n_special=N_SPECIAL):
        self.n_ent, self.n_val, self.n_chat = n_ent, n_val, n_chat
        self.ent0 = n_special
        self.val0 = self.ent0 + n_ent
        self.chat0 = self.val0 + n_val
        self.size = self.chat0 + n_chat


def fact_stream(vocab, T, rng, p_tell=0.3, p_ask=0.3, p_update=0.15, max_facts=None):
    """One conversation of length T. Returns tokens, targets (value index or -1),
    and for every query its lag = tokens since the fact was (last) told."""
    toks = np.zeros(T, dtype=np.int64)
    tgt = np.full(T, -1, dtype=np.int64)
    lag = np.full(T, -1, dtype=np.int64)
    known = {}                      # entity -> (value, position told)
    ents = rng.permutation(vocab.n_ent)
    n_new = 0
    t = 0
    while t < T:
        r = rng.random()
        if r < p_tell and t + 3 <= T:
            if known and rng.random() < p_update:
                e = list(known)[rng.integers(len(known))]
            else:
                if max_facts is not None and n_new >= max_facts:
                    continue
                e = int(ents[n_new % vocab.n_ent]); n_new += 1
            v = int(rng.integers(vocab.n_val))
            toks[t:t + 3] = [TELL, vocab.ent0 + e, vocab.val0 + v]
            known[e] = (v, t + 2)
            t += 3
        elif r < p_tell + p_ask and known and t + 2 <= T:
            e = list(known)[rng.integers(len(known))]
            toks[t:t + 2] = [ASK, vocab.ent0 + e]
            tgt[t + 1] = known[e][0]
            lag[t + 1] = t + 1 - known[e][1]
            t += 2
        else:
            n = int(min(rng.integers(1, 9), T - t))
            toks[t:t + n] = vocab.chat0 + rng.integers(vocab.n_chat, size=n)
            t += n
    return toks, tgt, lag


def batch_facts(vocab, B, T, seed=None, **kw):
    rng = np.random.default_rng(seed)
    out = [fact_stream(vocab, T, rng, **kw) for _ in range(B)]
    toks, tgt, lag = (torch.from_numpy(np.stack(x)) for x in zip(*out))
    return toks, tgt, lag


def long_range_probe(vocab, B, T, n_facts, seed=None):
    """Hard test for "memory beyond the context window": all facts are told in
    the first part of the conversation, followed by a long stretch of chatter,
    and every fact is queried only at the very end."""
    rng = np.random.default_rng(seed)
    toks = np.zeros((B, T), dtype=np.int64)
    tgt = np.full((B, T), -1, dtype=np.int64)
    for b in range(B):
        ents = rng.choice(vocab.n_ent, n_facts, replace=False)
        vals = rng.integers(vocab.n_val, size=n_facts)
        seq = []
        for e, v in zip(ents, vals):
            seq += [TELL, vocab.ent0 + e, vocab.val0 + v]
        q = []
        qt = []
        for i in rng.permutation(n_facts):
            q += [ASK, vocab.ent0 + ents[i]]
            qt += [-1, vals[i]]
        gap = T - len(seq) - len(q)
        assert gap >= 0, "T too short"
        chat = list(vocab.chat0 + rng.integers(vocab.n_chat, size=gap))
        toks[b] = seq + chat + q
        tgt[b, T - len(q):] = qt
    return torch.from_numpy(toks), torch.from_numpy(tgt)


# ----------------------------------------------------------------------------
# Learning from praise and correction only
# ----------------------------------------------------------------------------

def feedback_stream(vocab, T, rng, n_opts=4, p_try=0.45, n_active=12):
    """Nobody ever tells the model the answer. Each turn someone *tries* an answer
    and hears YES or NO:   ASK e g YES|NO
    At every `e` the model must predict the correct value from the feedback heard
    so far. Guesses are an exploring agent's: random among options not yet
    rejected for e. Returns tokens, targets, and n_rejected / confirmed state per
    query so accuracy can be compared with the ideal Bayesian observer
    (1 / (n_opts - n_rejected), or 1 once a YES was heard)."""
    toks = np.zeros(T, dtype=np.int64)
    tgt = np.full(T, -1, dtype=np.int64)
    hist = np.full(T, -1, dtype=np.int64)      # n rejected, or 99 = confirmed
    opts = rng.choice(vocab.n_val, n_opts, replace=False)
    ents = rng.choice(vocab.n_ent, n_active, replace=False)
    answer = {e: int(rng.choice(opts)) for e in ents}
    rejected = {e: set() for e in ents}
    confirmed = set()
    t = 0
    while t < T:
        if rng.random() < p_try and t + 4 <= T:
            e = int(rng.choice(ents))
            cand = [o for o in opts if o not in rejected[e]]
            g = answer[e] if e in confirmed else int(rng.choice(cand))
            ok = g == answer[e]
            toks[t:t + 4] = [ASK, vocab.ent0 + e, vocab.val0 + g, YES if ok else NO]
            tgt[t + 1] = answer[e]
            hist[t + 1] = 99 if e in confirmed else len(rejected[e])
            if ok:
                confirmed.add(e)
            else:
                rejected[e].add(g)
            t += 4
        else:
            n = int(min(rng.integers(1, 9), T - t))
            toks[t:t + n] = vocab.chat0 + rng.integers(vocab.n_chat, size=n)
            t += n
    return toks, tgt, hist


def batch_feedback(vocab, B, T, seed=None, **kw):
    rng = np.random.default_rng(seed)
    out = [feedback_stream(vocab, T, rng, **kw) for _ in range(B)]
    return tuple(torch.from_numpy(np.stack(x)) for x in zip(*out))


# ----------------------------------------------------------------------------
# Chains, for the adaptive-effort experiment
# ----------------------------------------------------------------------------

def chain_episode(vocab, rng, n_chains, max_len, chatter=(0, 4), min_len=1):
    """Facts are links `LINK a b`. Entities form disjoint chains a1->a2->...->ak.
    Query `QUERY a1` asks for the *last* element of a1's chain. The number of
    hops is never given; the model must decide how long to think."""
    n_need = sum(max_len + 1 for _ in range(n_chains))
    ents = rng.choice(vocab.n_ent, size=min(n_need, vocab.n_ent), replace=False)
    chains, links, p = [], [], 0
    for _ in range(n_chains):
        L = int(rng.integers(min_len, max_len + 1))  # number of hops
        c = ents[p:p + L + 1]; p += L + 1
        chains.append(c)
        links += [(c[i], c[i + 1]) for i in range(L)]
    toks = []
    for j in rng.permutation(len(links)):
        a, b = links[j]
        toks += [LINK, vocab.ent0 + a, vocab.ent0 + b]
        n = int(rng.integers(*chatter)) if chatter[1] > 0 else 0
        toks += list(vocab.chat0 + rng.integers(vocab.n_chat, size=n))
    queries = [(c[0], c[-1], len(c) - 1) for c in chains]
    return toks, queries
