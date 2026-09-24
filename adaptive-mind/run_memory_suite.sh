#!/bin/bash
# Experiment 2 exactly as run for the results in README.md (2 jobs x 2 threads).
# Fly variants converge in a few hundred steps and get 1000; baselines get more.
# The transformer needs a short-conversation curriculum to get past the
# induction-head plateau (without it: ~20% accuracy after 2000 steps at lr 2e-3,
# see results/memory/transformer_lr2e-3_attempt1.json.bak).
cd "$(dirname "$0")"
export OMP_WAIT_POLICY=PASSIVE
run() { python3 train_memory.py --threads 2 "$@" > logs/mem_$2.log 2>&1; }
mkdir -p logs
(run --model fly --steps 1000; run --model fly_shuffled_pnkc --steps 1000;
 run --model fly_no_apl --steps 1000; run --model fly_frozen --steps 1000) &
(run --model transformer --steps 4000 --lr 1e-3 --curriculum; run --model gru --steps 2000;
 run --model fly_learned_expansion --steps 1000; run --model fly_no_expansion --steps 1000) &
wait
