#!/bin/bash
# FlyLM first, then the same-size GPT-2 baseline on identical data and budget.
cd "$(dirname "$0")/.."
export OMP_WAIT_POLICY=PASSIVE
mkdir -p logs
python3 flylm/train_lm.py --arch flylm --steps 1500 --out flylm-tinystories > logs/lm_flylm.log 2>&1
python3 flylm/train_lm.py --arch gpt2 --steps 1500 --out gpt2-tinystories-baseline > logs/lm_gpt2.log 2>&1
