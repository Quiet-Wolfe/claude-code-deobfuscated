"""Train FlyLM (or a same-size GPT-2 baseline) from scratch on TinyStories, on CPU.

    python flylm/train_lm.py --arch flylm --steps 2000 --out flylm-tinystories
    python flylm/train_lm.py --arch gpt2  --steps 2000 --out gpt2-tinystories-baseline

The output directory is a normal Hugging Face model folder:
    AutoModelForCausalLM.from_pretrained(out, trust_remote_code=True)
"""

import argparse
import json
import math
import os
import sys
import time

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def build(arch, vocab_size, seq):
    if arch == "flylm":
        from configuration_flylm import FlyLMConfig, connectome_fields
        from modeling_flylm import FlyLMForCausalLM
        cfg = FlyLMConfig(vocab_size=vocab_size,
                          **connectome_fields(os.path.join(HERE, "..", "data", "mushroom_body_R.npz")))
        return FlyLMForCausalLM(cfg)
    from transformers import GPT2Config, GPT2LMHeadModel
    cfg = GPT2Config(vocab_size=vocab_size, n_positions=2 * seq, n_embd=192, n_layer=4, n_head=4,
                     bos_token_id=0, eos_token_id=0, pad_token_id=0)
    return GPT2LMHeadModel(cfg)


def windows(data, n, seq, rng):
    ix = rng.integers(0, len(data) - seq - 1, n)
    return torch.from_numpy(np.stack([data[i:i + seq + 1].astype(np.int64) for i in ix]))


@torch.no_grad()
def val_loss(model, val, seq, n=64):
    model.eval()
    x = windows(val, n, seq, np.random.default_rng(0))
    losses = []
    for b in x.split(16):
        with torch.autocast("cpu", dtype=torch.bfloat16):
            losses.append(model(b, labels=b).loss.float().item())
    model.train()
    return float(np.mean(losses))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", default="flylm", choices=["flylm", "gpt2"])
    ap.add_argument("--data", default="/home/user/data/tinystories/tok")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "flylm-tinystories"))
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--seq", type=int, default=256)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--warmup", type=int, default=100)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--eval_every", type=int, default=250)
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    torch.manual_seed(0)

    from transformers import PreTrainedTokenizerFast
    tok = PreTrainedTokenizerFast.from_pretrained(os.path.join(args.data, "tokenizer"))
    train = np.memmap(os.path.join(args.data, "train.bin"), dtype=np.uint16, mode="r")
    val = np.memmap(os.path.join(args.data, "valid.bin"), dtype=np.uint16, mode="r")

    model = build(args.arch, len(tok), args.seq)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"{args.arch}: {n_params:,} trainable parameters", flush=True)
    decay = [p for n, p in model.named_parameters() if p.dim() >= 2]
    no_decay = [p for n, p in model.named_parameters() if p.dim() < 2]
    opt = torch.optim.AdamW([{"params": decay, "weight_decay": 0.1},
                             {"params": no_decay, "weight_decay": 0.0}], lr=args.lr, betas=(0.9, 0.95))
    lr_at = lambda s: args.lr * min(1, (s + 1) / args.warmup) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1, s / args.steps))))
    rng = np.random.default_rng(1)
    log = {"arch": args.arch, "params": n_params, "batch": args.batch, "seq": args.seq, "curve": []}
    t0 = time.time()
    for step in range(args.steps + 1):
        if step % args.eval_every == 0 or step == args.steps:
            vl = val_loss(model, val, args.seq)
            tokens = step * args.batch * args.seq
            log["curve"].append({"step": step, "tokens": tokens, "val_loss": vl, "seconds": time.time() - t0})
            print(f"step {step:5d}  tokens {tokens/1e6:6.2f}M  val_loss {vl:.3f}  ({time.time()-t0:.0f}s)", flush=True)
            os.makedirs(args.out, exist_ok=True)
            model.save_pretrained(args.out)
            tok.save_pretrained(args.out)
            with open(os.path.join(args.out, "training_log.json"), "w") as f:
                json.dump(log, f, indent=1)
        if step == args.steps:
            break
        for g in opt.param_groups:
            g["lr"] = lr_at(step)
        x = windows(train, args.batch, args.seq, rng)
        with torch.autocast("cpu", dtype=torch.bfloat16):
            loss = model(x, labels=x).loss
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % 25 == 0:
            print(f"  step {step} train_loss {loss.item():.3f} lr {lr_at(step):.2e}", flush=True)

    model.eval()
    prompt = "Once upon a time, there was a little"
    ids = tok(prompt, return_tensors="pt").input_ids
    with torch.no_grad():
        out = model.generate(ids, max_new_tokens=80, do_sample=True, top_k=40, temperature=0.8,
                             pad_token_id=0)
    print(tok.decode(out[0]))


if __name__ == "__main__":
    main()
