"""
Talk to the plastic mushroom-body model.

The model was meta-trained on abstract token streams. Here every new word you
use is bound on the fly to a fresh entity / value token, so everything you teach
it is, by construction, something it has never seen. Its only way to remember is
to change its own KC->MBON synapses while you talk. No gradient descent happens
here; `torch.no_grad()` is on for the whole session.

    python chat.py                       # uses checkpoints/fly_s0.pt
    python chat.py --script              # non-interactive demo

Grammar
    alice is red          teach a fact (or overwrite an old one)
    alice?                ask
    anything else         chatter (no facts, just noise in the conversation)
    :stats                show memory state      :reset   start a new conversation
"""

import argparse
import os
import re
import sys

import torch

from models import FlyMem
from tasks import Vocab, TELL, ASK

HERE = os.path.dirname(os.path.abspath(__file__))


class Session:
    def __init__(self, ckpt):
        self.vocab = Vocab()
        self.model = FlyMem(self.vocab.size, self.vocab.n_val)
        self.model.load_state_dict(torch.load(ckpt, map_location="cpu"))
        self.model.eval()
        self.reset()

    def reset(self):
        self.state = None
        self.ents, self.vals = {}, {}
        self.n_tokens = 0
        self.writes = []

    def _id(self, table, word, cap):
        if word not in table:
            if len(table) >= cap:
                raise RuntimeError("out of fresh tokens; :reset")
            table[word] = len(table)
        return table[word]

    @torch.no_grad()
    def feed(self, toks):
        x = torch.tensor([toks])
        logits, self.state, aux = self.model(x, self.state, return_aux=True)
        self.n_tokens += len(toks)
        return logits[0], aux

    def say(self, line):
        line = line.strip().lower()
        m = re.fullmatch(r"([\w']+) is ([\w']+)\.?", line)
        if m:
            e = self._id(self.ents, m.group(1), self.vocab.n_ent)
            v = self._id(self.vals, m.group(2), self.vocab.n_val)
            _, aux = self.feed([TELL, self.vocab.ent0 + e, self.vocab.val0 + v])
            g = aux["G"][0, -1].mean().item()
            self.writes.append(g)
            return f"(dopamine gate on write: {g:.2f})"
        m = re.fullmatch(r"(?:what is )?([\w']+) ?\?", line)
        if m:
            if m.group(1) not in self.ents:
                return "(never heard of that one)"
            e = self.ents[m.group(1)]
            logits, aux = self.feed([ASK, self.vocab.ent0 + e])
            p = logits[-1].softmax(-1)
            inv = {i: w for w, i in self.vals.items()}
            top = p.topk(3)
            guesses = ", ".join(f"{inv.get(i.item(), '<unused token>')} {q:.0%}"
                                for q, i in zip(top.values, top.indices))
            best = inv.get(top.indices[0].item(), "<unused token>")
            g = aux["G"][0, -1].mean().item()
            return f"{m.group(1)} is {best}.   [{guesses}; gate on read {g:.2f}]"
        words = line.split()
        toks = [self.vocab.chat0 + (hash(w) % self.vocab.n_chat) for w in words] or [self.vocab.chat0]
        self.feed(toks)
        return "(chatter)"

    def stats(self):
        if self.state is None:
            return "empty"
        W = self.state[1][0]
        active = (W.abs().sum(0) > 1e-4).sum().item()
        return (f"{self.n_tokens} tokens heard, {len(self.ents)} things, {len(self.vals)} values; "
                f"fast-weight norm {W.norm():.2f}; {active}/{W.shape[1]} Kenyon cells have "
                f"potentiated/depressed output synapses; memory size is constant: "
                f"{W.numel()} synapses")


DEMO = """alice is red
bob is blue
the weather is lovely today and i had a sandwich for lunch
carol is green
alice?
bob?
dave is red
eve is purple
lots of unrelated chatter so the facts get further and further away in the conversation
carol?
alice is yellow
alice?
bob?
eve?
dave?""".splitlines()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(HERE, "checkpoints", "fly_s0.pt"))
    ap.add_argument("--script", action="store_true")
    args = ap.parse_args()
    s = Session(args.ckpt)
    lines = DEMO if args.script else None
    print(__doc__.split("Grammar")[1] if not args.script else "")
    i = 0
    while True:
        if lines is not None:
            if i >= len(lines):
                break
            line = lines[i]
            i += 1
            print(f"> {line}")
        else:
            try:
                line = input("> ")
            except EOFError:
                break
        if line.strip() == ":stats":
            print(s.stats())
        elif line.strip() == ":reset":
            s.reset()
            print("new conversation, blank synapses")
        elif line.strip():
            print(s.say(line))
    print(s.stats())


if __name__ == "__main__":
    sys.exit(main())
