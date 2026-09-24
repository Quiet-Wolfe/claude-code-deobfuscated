#!/bin/bash
# Second wave: waits for the memory suite, then feedback task + pondering.
cd "$(dirname "$0")"
export OMP_WAIT_POLICY=PASSIVE
while pgrep -f run_memory_suite.sh > /dev/null; do sleep 30; done
fb() { python3 train_memory.py --task feedback --model $1 --steps 1500 --threads 2 > logs/fb_$1.log 2>&1; }
(fb fly; fb gru; fb transformer) &
(python3 ponder.py --only adaptive --steps 2500 --threads 2 > logs/ponder_adaptive.log 2>&1;
 python3 ponder.py --only fixed --steps 2500 --threads 2 > logs/ponder_fixed.log 2>&1;
 python3 ponder.py --only transformer --steps 2500 --threads 2 > logs/ponder_tf.log 2>&1) &
wait
