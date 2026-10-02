#!/bin/bash
# Ship, launch, OPEN THE GLOBE TAB OURSELVES at +15s (the app starts on the feed;
# the user asked for launches to be done from here), and stream the first-fill
# breadcrumbs from that moment. Then measure the three surfaces warm.
ADB=/d/android-sdk/platform-tools/adb.exe; S=R5CYA0GF6FP; SH=/d/void-audit/scripts/device-watch-shots
bash /d/void-patch/ship.sh 2>&1 | tail -3
sleep 15
"$ADB" -s $S logcat -c
( timeout 80 "$ADB" -s $S logcat 2>/dev/null | grep -E "\[boot\]|\[fill\]|\[block\]|\[slow\]|\[fd\]" > /d/void-patch/globe-open.log ) &
"$ADB" -s $S shell input tap 240 1380
T0=$(date +%s); echo "globe tab opened at +15s"
for t in 5 20 45 75; do
  while [ $(( $(date +%s) - T0 )) -lt $t ]; do sleep 1; done
  bash /d/void-audit/scripts/shot-if-void.sh "$SH/globe-plus-${t}s.png" "shot globe+${t}s"
done
wait
echo "=== breadcrumbs from the tap (80s) ==="
sed 's/^[0-9-]* //' /d/void-patch/globe-open.log | cut -c1-170
sleep 20
echo "=== warm stages ==="
cd /d/void-audit && for s in globe wall reels; do node scripts/stage-of.mjs $s 2>&1 | grep -v '^JSON' | grep -v 'Broken pipe'; sleep 2; done
