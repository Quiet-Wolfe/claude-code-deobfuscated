"""
Experiment 4: connectome as architecture (not RL on a brain, a rebuild of one).

Take the 148 heading-circuit neurons of the male central complex exactly as
wired in the male CNS connectome (EPG, PEN_a, PEN_b, PEG, Delta7; synapse counts
and predicted transmitter signs), turn them into a rate RNN, and train only a
few hundred scalars:

    W_ij = sign(pre_i) * exp(s[type_i, type_j]) * synapses_ij / total_input_synapses_j
    trainable: 25 type-to-type scales s, 148 biases, input gains, a linear readout

Task: angular path integration in the dark. The fly sees a landmark for 5 steps,
then turns with random angular velocity; the network must keep track of heading
from self-motion alone, which is what this circuit does in real flies.

Controls with *identical* trainable parameters:
  * type_shuffled : edges rewired inside every (pre-type, post-type) block, so
                    cell-type-level wiring and synapse weights are preserved but
                    the neuron-level topographic map is destroyed
  * erdos_renyi   : same neurons, same number of edges and weights, random targets
And an unconstrained reference:
  * dense         : 148-neuron vanilla rate RNN with every weight trainable
  * dense_small   : 26-neuron vanilla rate RNN, parameter-matched (~860 params)

    python cx.py --steps 1500
"""

import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))


def load_cx():
    d = np.load(os.path.join(HERE, "data", "central_complex.npz"))
    return {k: d[k] for k in d.files}


def rewire(C, types, mode, seed=0):
    rng = np.random.default_rng(seed)
    C = C.copy()
    if mode == "connectome":
        return C
    if mode == "erdos_renyi":
        w = C[C > 0]
        R = np.zeros_like(C)
        n = C.shape[0]
        idx = rng.choice(n * n, len(w), replace=False)
        R.flat[idx] = rng.permutation(w)
        return R
    if mode == "type_shuffled":
        ut = sorted(set(types))
        R = np.zeros_like(C)
        for a in ut:
            for b in ut:
                ia, ib = np.where(types == a)[0], np.where(types == b)[0]
                blk = C[np.ix_(ia, ib)]
                w = blk[blk > 0]
                nb = np.zeros(blk.size, dtype=C.dtype)
                nb[rng.choice(blk.size, len(w), replace=False)] = rng.permutation(w)
                R[np.ix_(ia, ib)] = nb.reshape(blk.shape)
        return R
    raise ValueError(mode)


class ConnectomeRNN(nn.Module):
    def __init__(self, cx, mode="connectome", seed=0, alpha=0.3, substeps=2):
        super().__init__()
        types = cx["type"]
        self.ut = sorted(set(types))
        tid = np.array([self.ut.index(t) for t in types])
        self.dense = mode.startswith("dense")
        if mode == "dense_small":           # parameter-matched unconstrained RNN
            types = np.array(["EPG"] * 26)  # 26 neurons, all read out
        self.n = len(types)
        self.alpha, self.substeps = alpha, substeps
        if self.dense:
            self.W = nn.Parameter(torch.randn(self.n, self.n) / np.sqrt(self.n))
        else:
            C = rewire(cx["C"], types, mode, seed)
            sign = cx["sign"].copy()
            sign[sign == 0] = 1.0
            # each neuron's summed synaptic input normalised to 1 (type scales learn the gain)
            C = C / (C.sum(0, keepdims=True) + 1.0)
            self.register_buffer("C", torch.tensor(C, dtype=torch.float32))
            self.register_buffer("sign", torch.tensor(sign, dtype=torch.float32))
            self.register_buffer("tid", torch.tensor(tid))
            self.s = nn.Parameter(torch.zeros(len(self.ut), len(self.ut)))
        self.b = nn.Parameter(torch.zeros(self.n))
        pen = np.isin(types, ["PEN_a(PEN1)", "PEN_b(PEN2)"])
        epg = types == "EPG"
        self.register_buffer("pen", torch.tensor(pen, dtype=torch.float32))
        self.register_buffer("epg", torch.tensor(epg, dtype=torch.float32))
        # angular velocity (left/right turn channels) enters PENs only;
        # the landmark cue (cos, sin) enters EPGs only (as ring neurons do)
        self.w_vel = nn.Parameter(torch.randn(2, self.n) * 0.1)
        self.w_cue = nn.Parameter(torch.randn(2, self.n) * 0.1)
        self.read = nn.Linear(int(epg.sum()), 2)

    def weights(self):
        if self.dense:
            return self.W
        scale = torch.exp(self.s)[self.tid][:, self.tid]              # (pre, post)
        return self.sign[:, None] * scale * self.C

    def forward(self, omega, cue, return_rates=False):
        B, T = omega.shape
        W = self.weights()
        wv = self.w_vel if self.dense else self.w_vel * self.pen
        wc = self.w_cue if self.dense else self.w_cue * self.epg
        vel = torch.stack([F.relu(omega), F.relu(-omega)], -1) @ wv      # (B,T,n)
        cu = cue @ wc
        r = torch.zeros(B, self.n)
        outs, rates = [], []
        for t in range(T):
            for _ in range(self.substeps):
                r = (1 - self.alpha) * r + self.alpha * F.relu(r @ W + vel[:, t] + cu[:, t] + self.b)
            rates.append(r)
            outs.append(self.read(r[:, self.epg.bool()]))
        out = torch.stack(outs, 1)
        return (out, torch.stack(rates, 1)) if return_rates else out


def make_batch(B, T, rng, cue_steps=5, dt=0.1, sigma=1.5, tau=1.0):
    """Heading theta_t integrates a smooth random angular velocity (OU process)."""
    th0 = rng.uniform(-np.pi, np.pi, B)
    om = np.zeros((B, T))
    w = np.zeros(B)
    for t in range(T):
        w = w - dt / tau * w + sigma * np.sqrt(2 * dt / tau) * rng.standard_normal(B)
        om[:, t] = w
    th = th0[:, None] + np.cumsum(om * dt, 1)
    cue = np.zeros((B, T, 2))
    cue[:, :cue_steps] = np.stack([np.cos(th[:, :cue_steps]), np.sin(th[:, :cue_steps])], -1)
    tgt = np.stack([np.cos(th), np.sin(th)], -1)
    f = lambda x: torch.tensor(x, dtype=torch.float32)
    return f(om * dt * 10), f(cue), f(tgt), th


def heading_error(out, th, cue_steps=5):
    pred = torch.atan2(out[..., 1], out[..., 0]).numpy()
    err = np.angle(np.exp(1j * (pred - th)))
    return np.degrees(np.abs(err[:, cue_steps:])).mean(0)


def train(mode, steps, seed, T=60):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    cx = load_cx()
    m = ConnectomeRNN(cx, mode, seed)
    lr = {"dense": 3e-3, "dense_small": 1e-2}.get(mode, 0.02)
    opt = torch.optim.Adam(m.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    t0 = time.time()
    for step in range(steps):
        om, cue, tgt, _ = make_batch(64, T, rng)
        out = m(om, cue)
        loss = F.mse_loss(out[:, 5:], tgt[:, 5:])
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(m.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 100 == 0:
            print(f"[{mode} s{seed}] step {step} loss {loss.item():.4f} ({time.time() - t0:.0f}s)", flush=True)
    return m


@torch.no_grad()
def evaluate(m, seed=4321, T=200):
    rng = np.random.default_rng(seed)
    om, cue, tgt, th = make_batch(256, T, rng)
    out = m(om, cue)
    err = heading_error(out, th)
    return {"err_deg_by_step": err.tolist(),
            "err_deg_train_horizon": float(err[:55].mean()),
            "err_deg_long_horizon": float(err[55:].mean()),
            "chance_deg": 90.0}


def n_params(m):
    return sum(p.numel() for p in m.parameters())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1500)
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--modes", default="connectome,type_shuffled,erdos_renyi,dense,dense_small")
    ap.add_argument("--T", type=int, default=60, help="training horizon (steps)")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    os.makedirs(os.path.join(HERE, "results", "cx"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "checkpoints"), exist_ok=True)
    for mode in args.modes.split(","):
        for seed in range(args.seeds):
            m = train(mode, args.steps, seed, T=args.T)
            r = evaluate(m)
            r.update(mode=mode + args.tag, seed=seed, params=n_params(m), train_T=args.T)
            print(mode, seed, r["err_deg_train_horizon"], r["err_deg_long_horizon"], flush=True)
            with open(os.path.join(HERE, "results", "cx", f"{mode}{args.tag}_s{seed}.json"), "w") as f:
                json.dump(r, f)
            torch.save(m.state_dict(), os.path.join(HERE, "checkpoints", f"cx_{mode}{args.tag}_s{seed}.pt"))


if __name__ == "__main__":
    main()
