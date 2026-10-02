#!/bin/bash
# Ship, launch, OPEN THE GLOBE TAB OURSELVES at +15s (the app starts on the feed;
# the user asked for launches to be done from here), and stream the first-fill
# breadcrumbs from that moment. Then measure the three surfaces warm.
ADB=/d/android-sdk/platform-tools/adb.exe; S=R5CYA0GF6FP; SH=/d/void-audit/scripts/device-watch-shots
bash /d/void-patch/ship.sh 2>&1 | tail -3 | tee /d/void-patch/ship.tail
# NOTHING RUNS AFTER A FAILED BUILD. A failed ship leaves the OLD build (or
# nothing) in front, and the previous version of this script tapped into
# whatever app the user had open. If the install did not land, stop here.
grep -q "^LAUNCHED" /d/void-patch/ship.tail || { echo "ship did not launch The Void - aborting capture"; exit 3; }
sleep 15
"$ADB" -s $S logcat -c
( timeout 80 "$ADB" -s $S logcat 2>/dev/null | grep -E "\[boot\]|\[fill\]|\[block\]|\[slow\]|\[fd\]" > /d/void-patch/globe-open.log ) &
bash /d/void-audit/scripts/tap-if-void.sh 240 1380 "GLOBE tab" || exit 2
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
