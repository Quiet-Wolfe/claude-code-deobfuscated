#!/bin/bash
# Runs every model of experiment 2 (two at a time, 2 threads each).
# Fly variants converge in a few hundred steps and get 1000; baselines get 2000.
cd "$(dirname "$0")"
run() { python3 train_memory.py --model $1 --steps $2 --threads 2 > logs/mem_$1.log 2>&1; }
if [ -z "$SKIP_TRANSFORMER" ]; then TF="run transformer 2000;"; else TF="while kill -0 $SKIP_TRANSFORMER 2>/dev/null; do sleep 20; done;"; fi
(run fly 1000; run fly_shuffled_pnkc 1000; run fly_no_apl 1000; run fly_frozen 1000) &
(eval "$TF"; run gru 2000; run fly_learned_expansion 1000; run fly_no_expansion 1000) &
wait
