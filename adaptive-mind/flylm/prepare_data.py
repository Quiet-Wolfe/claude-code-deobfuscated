"""Train a 4096-token byte-level BPE on TinyStories and tokenize train/valid to uint16.

    python flylm/prepare_data.py --src /path/to/tinystories --out /path/to/tokens
(src must contain train*.txt and valid.txt from roneneldan/TinyStories, V2-GPT4)
"""

import argparse
import glob
import os

import numpy as np
from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers
from transformers import PreTrainedTokenizerFast

EOT = "<|endoftext|>"


def stories(path):
    buf = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.strip() == EOT:
                if buf:
                    yield "".join(buf).strip()
                buf = []
            else:
                buf.append(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/home/user/data/tinystories")
    ap.add_argument("--out", default="/home/user/data/tinystories/tok")
    ap.add_argument("--vocab", type=int, default=4096)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    train = sorted(glob.glob(os.path.join(args.src, "train*.txt")))[0]

    tok = Tokenizer(models.BPE())
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(vocab_size=args.vocab, special_tokens=[EOT],
                                  initial_alphabet=pre_tokenizers.ByteLevel.alphabet())

    def sample(n=200_000):
        for i, s in enumerate(stories(train)):
            if i >= n:
                break
            yield s

    tok.train_from_iterator(sample(), trainer)
    hf = PreTrainedTokenizerFast(tokenizer_object=tok, eos_token=EOT, bos_token=EOT,
                                 unk_token=EOT, pad_token=EOT)
    hf.save_pretrained(os.path.join(args.out, "tokenizer"))
    eot = hf.convert_tokens_to_ids(EOT)
    assert eot == 0

    for name, path in [("valid", os.path.join(args.src, "valid.txt")), ("train", train)]:
        ids = []
        batch = []
        for s in stories(path):
            batch.append(s)
            if len(batch) == 4096:
                for e in tok.encode_batch(batch):
                    ids.extend(e.ids + [eot])
                batch = []
        for e in tok.encode_batch(batch):
            ids.extend(e.ids + [eot])
        arr = np.array(ids, dtype=np.uint16)
        arr.tofile(os.path.join(args.out, f"{name}.bin"))
        print(name, f"{len(arr):,} tokens")


if __name__ == "__main__":
    main()
