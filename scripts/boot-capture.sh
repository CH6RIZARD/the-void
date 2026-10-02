#!/bin/bash
# Ship, launch, and watch the first two minutes the way a user would.
ADB=/d/android-sdk/platform-tools/adb.exe; S=R5CYA0GF6FP; SH=/d/void-audit/scripts/device-watch-shots
bash /d/void-patch/ship.sh 2>&1 | tail -3
T0=$(date +%s)
( timeout 115 "$ADB" -s $S logcat 2>/dev/null | grep -E "\[boot\]|\[fill\]|\[block\]|\[slow\]|\[fd\]" > /d/void-patch/boot.log ) &
for t in 8 30 60 90; do
  while [ $(( $(date +%s) - T0 )) -lt $t ]; do sleep 1; done
  bash /d/void-audit/scripts/shot-if-void.sh "$SH/boot-plus-${t}s.png" "shot +${t}s"
done
wait
echo "=== breadcrumbs (first 115s, relative to launch) ==="
cat /d/void-patch/boot.log | sed 's/^[0-9-]* //' | cut -c1-200
sleep 30
echo "=== warm stages (≈150s) ==="
cd /d/void-audit && for s in globe wall reels; do node scripts/stage-of.mjs $s 2>&1 | grep -v '^JSON' | grep -v 'Broken pipe'; sleep 2; done
