#!/bin/bash
# Every 2 hours, one 5-region round (cycle.sh). Started by the box's onstart.sh, so it
# survives a reboot. Log: /root/regions/cycle.log
cd "$(dirname "$0")"
while true; do
  t0=$(date +%s)
  bash cycle.sh >> cycle.log 2>&1
  left=$((7200 - ($(date +%s) - t0)))
  [ "$left" -gt 0 ] && sleep "$left"
done
