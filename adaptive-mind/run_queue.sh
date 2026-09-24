#!/bin/bash
# Priority job queue: 2 slots x 2 threads (4 cores). Waits for whatever is already running.
cd "$(dirname "$0")"
export OMP_WAIT_POLICY=PASSIVE
while [ "$(pgrep -fc 'python3 train_memory.py')" -gt 1 ]; do sleep 20; done
cat > logs/jobs.txt <<'JOBS'
python3 ponder.py --only adaptive --steps 2500 --threads 2 > logs/ponder_adaptive.log 2>&1
python3 train_memory.py --task feedback --model fly --steps 1500 --threads 2 > logs/fb_fly.log 2>&1
python3 ponder.py --only transformer --steps 2500 --threads 2 > logs/ponder_tf.log 2>&1
python3 train_memory.py --task feedback --model transformer --steps 3000 --lr 1e-3 --curriculum --threads 2 > logs/fb_transformer.log 2>&1
python3 train_memory.py --task feedback --model gru --steps 1500 --threads 2 > logs/fb_gru.log 2>&1
python3 ponder.py --only fixed --steps 2500 --threads 2 > logs/ponder_fixed.log 2>&1
python3 train_memory.py --model fly_no_apl --steps 1000 --threads 2 > logs/mem_fly_no_apl.log 2>&1
python3 train_memory.py --model fly_frozen --steps 1000 --threads 2 > logs/mem_fly_frozen.log 2>&1
python3 train_memory.py --model fly_no_expansion --steps 1000 --threads 2 > logs/mem_fly_no_expansion.log 2>&1
JOBS
tr '\n' '\0' < logs/jobs.txt | xargs -0 -P 2 -I{} bash -c '{}'
