"""
Models.

FlyMem  -- a recurrent controller with a mushroom-body memory whose KC->MBON
           synapses are *plastic at inference time*. The wiring comes from the male
           CNS connectome:
             controller state -> 58 glomerular PN channels
             -> 2045 Kenyon cells through the real PN->KC synapse-count matrix (fixed)
             -> APL: one global inhibitory neuron = k-winners-take-all sparsening
             -> 49 MBONs through fast weights W (start at zero every conversation)
             -> dopamine neurons (170) gate plasticity, and each DAN's reach onto
                MBONs is the connectome-measured DAN->KC / KC->MBON overlap.
           Plasticity is error-driven (delta rule), the standard reading of the
           MBON->DAN feedback loop:  W <- W + g (x) (v - W k) k^T.
           Nothing is fine-tuned at test time with backprop; the slow weights are
           meta-trained so that the fast synapses learn the right things by
           themselves.

GRUBaseline, TransformerBaseline -- conventional "memory in activations" and
           "memory in the context window" baselines.
"""

import math
import os

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))


# ----------------------------------------------------------------------------
# Connectome-derived fixed structure
# ----------------------------------------------------------------------------

def load_mb(kind="connectome", seed=0):
    """Returns (GLOM_KC [n_glom, n_kc] column-normalised, COMP [n_dan, n_mbon])."""
    mb = np.load(os.path.join(HERE, "data", "mushroom_body_R.npz"))
    G = mb["GLOM_KC"].astype(np.float32)
    G = np.where(G >= 3, G, 0)                      # real synapses only
    G = G[:, G.sum(0) > 0]                          # KCs with olfactory input
    comp = mb["COMP"].astype(np.float32)
    rng = np.random.default_rng(seed)
    if kind == "shuffled":
        # same per-KC fan-in and synapse weights, random glomeruli
        R = np.zeros_like(G)
        for j in range(G.shape[1]):
            w = G[:, j][G[:, j] > 0]
            R[rng.choice(G.shape[0], len(w), replace=False), j] = w
        G = R
    elif kind != "connectome":
        raise ValueError(kind)
    G = G / G.sum(0, keepdims=True)
    return torch.from_numpy(G), torch.from_numpy(comp)


def kwta(z, k):
    """APL-style global inhibition: only the k most driven KCs stay active."""
    if k is None or k >= z.shape[-1]:
        return z
    thr = z.topk(k, dim=-1).values[..., -1:]
    return z * (z >= thr)


def delta_memory(K, V, G, W0=None, chunk=32):
    """Chunk-parallel gated delta rule (exact, no approximation).

    K: (B,T,N) unit-norm keys    V: (B,T,M) targets    G: (B,T,M) gates in [0,1]
    W_t = W_{t-1} + g_t * (v_t - W_{t-1} k_t) k_t^T ;  read r_t = W_{t-1} k_t
    Returns reads R (B,T,M) and final fast weights W (B,M,N).
    Within a chunk the recurrence is a unit-lower-triangular linear system per
    MBON, so a whole chunk is solved at once (cf. DeltaNet's chunked form).
    """
    B, T, N = K.shape
    M = V.shape[-1]
    W = K.new_zeros(B, M, N) if W0 is None else W0
    out = []
    # torch.split (not slicing) so the backward pass concatenates instead of
    # zero-filling a full (B,T,N) gradient per chunk
    for k, v, g in zip(K.split(chunk, 1), V.split(chunk, 1), G.split(chunk, 1)):
        L = k.shape[1]
        r0 = k @ W.transpose(1, 2)                                   # (B,L,M)
        S = torch.tril(k @ k.transpose(1, 2), -1)                    # (B,L,L)
        A = torch.eye(L, device=K.device) + g.transpose(1, 2)[..., None] * S[:, None]
        rhs = (g * (v - r0)).transpose(1, 2)[..., None]              # (B,M,L,1)
        U = torch.linalg.solve_triangular(A, rhs, upper=False, unitriangular=True)
        U = U[..., 0].transpose(1, 2)                                # (B,L,M)
        out.append(r0 + S @ U)
        W = W + U.transpose(1, 2) @ k
    return torch.cat(out, 1), W


class FlyMem(nn.Module):
    def __init__(self, vocab_size, n_out, d_emb=64, d_h=128, pn="connectome",
                 kc_sparsity=0.05, plastic=True, key_mode="mb", seed=0):
        super().__init__()
        self.emb = nn.Embedding(vocab_size, d_emb)
        self.ctrl = nn.GRU(d_emb, d_h, batch_first=True)
        GK, COMP = load_mb(pn if pn != "learned" else "connectome", seed)
        self.n_glom, self.n_kc = GK.shape
        self.n_dan, self.n_mbon = COMP.shape
        self.key_mode = key_mode
        if key_mode == "mb":
            self.to_pn = nn.Linear(d_h, self.n_glom)
            self.register_buffer("pn_kc", GK)
            self.k = max(1, int(round(kc_sparsity * self.n_kc)))
        elif key_mode == "dense":             # no expansion: key = learned 58-d vector
            self.to_pn = nn.Linear(d_h, self.n_glom)
            self.k = None
        elif key_mode == "learned_expansion":  # 2045-d learned (not connectome) projection
            self.to_pn = nn.Linear(d_h, self.n_kc)
            self.k = max(1, int(round(kc_sparsity * self.n_kc)))
        self.to_val = nn.Linear(d_h + d_emb, self.n_mbon)
        self.to_dan = nn.Linear(d_h + d_emb, self.n_dan)
        comp = COMP.clamp(min=0)
        self.register_buffer("dan_mbon", comp / (comp.sum(0, keepdims=True) + 1e-6))
        self.dan_bias = nn.Parameter(torch.full((self.n_mbon,), -2.0))
        self.plastic = plastic
        self.head = nn.Sequential(nn.Linear(d_h + self.n_mbon, d_h), nn.GELU(), nn.Linear(d_h, n_out))

    def keys(self, h):
        p = self.to_pn(h)
        if self.key_mode == "mb":
            z = F.relu(p) @ self.pn_kc          # PN -> KC through the connectome
            z = kwta(z, self.k)                 # APL
        elif self.key_mode == "learned_expansion":
            z = kwta(F.relu(p), self.k)
        else:
            z = p
        return F.normalize(z, dim=-1, eps=1e-6)

    def gates(self, hx):
        dan = F.relu(self.to_dan(hx))                                   # DAN activity
        return torch.sigmoid(dan @ self.dan_mbon * 4 + self.dan_bias), dan

    def forward(self, toks, state=None, return_aux=False):
        x = self.emb(toks)
        h0, W0 = (None, None) if state is None else state
        h, hT = self.ctrl(x, h0)
        hx = torch.cat([h, x], -1)
        K = self.keys(h)
        V = self.to_val(hx)
        G, dan = self.gates(hx)
        if not self.plastic:
            G = G * 0
        R, W = delta_memory(K, V, G, W0)
        logits = self.head(torch.cat([h, R], -1))
        if return_aux:
            return logits, (hT, W), dict(K=K, G=G, dan=dan, R=R)
        return logits, (hT, W)


class GRUBaseline(nn.Module):
    def __init__(self, vocab_size, n_out, d_emb=64, d_h=256, n_layers=1):
        super().__init__()
        self.emb = nn.Embedding(vocab_size, d_emb)
        self.rnn = nn.GRU(d_emb, d_h, n_layers, batch_first=True)
        self.head = nn.Sequential(nn.Linear(d_h, d_h), nn.GELU(), nn.Linear(d_h, n_out))

    def forward(self, toks, state=None):
        h, s = self.rnn(self.emb(toks), state)
        return self.head(h), s


class TransformerBaseline(nn.Module):
    """Causal transformer with RoPE. `window` limits attention to the last
    `window` tokens, i.e. a finite context window."""

    def __init__(self, vocab_size, n_out, d=128, n_layers=3, n_heads=4, window=None):
        super().__init__()
        self.emb = nn.Embedding(vocab_size, d)
        self.layers = nn.ModuleList(Block(d, n_heads) for _ in range(n_layers))
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, n_out)
        self.window = window

    def forward(self, toks, state=None, window=None):
        T = toks.shape[1]
        w = window or self.window
        i = torch.arange(T)
        mask = i[None, :] <= i[:, None]
        if w:
            mask &= i[None, :] > i[:, None] - w
        x = self.emb(toks)
        for blk in self.layers:
            x = blk(x, mask)
        return self.head(self.norm(x)), None


def rope(x):
    B, H, T, D = x.shape
    f = 1.0 / (10000 ** (torch.arange(0, D, 2, dtype=torch.float32) / D))
    a = torch.arange(T, dtype=torch.float32)[:, None] * f[None]
    c, s = a.cos(), a.sin()
    x1, x2 = x[..., 0::2], x[..., 1::2]
    return torch.stack([x1 * c - x2 * s, x1 * s + x2 * c], -1).flatten(-2)


class Block(nn.Module):
    def __init__(self, d, h):
        super().__init__()
        self.h = h
        self.n1, self.n2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv = nn.Linear(d, 3 * d)
        self.o = nn.Linear(d, d)
        self.ff = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))

    def forward(self, x, mask):
        B, T, D = x.shape
        q, k, v = self.qkv(self.n1(x)).view(B, T, 3, self.h, D // self.h).permute(2, 0, 3, 1, 4)
        a = F.scaled_dot_product_attention(rope(q), rope(k), v, attn_mask=mask)
        x = x + self.o(a.transpose(1, 2).reshape(B, T, D))
        return x + self.ff(self.n2(x))


def n_params(m):
    return sum(p.numel() for p in m.parameters() if p.requires_grad)
