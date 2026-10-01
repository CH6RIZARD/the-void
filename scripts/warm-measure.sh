#!/bin/bash
# After ship.sh has launched the new build: stream breadcrumbs for 90s (never
# read logcat -d afterwards - the buffer is gone in seconds), let the wall
# settle to ~150s, then measure the three surfaces warm and take a screenshot.
OUT="$1"; ADB=/d/android-sdk/platform-tools/adb.exe; S=R5CYA0GF6FP
for i in $(seq 1 200); do grep -qE "^LAUNCHED|GRADLE EXIT=[1-9]" "$OUT" 2>/dev/null && break; sleep 15; done
grep -qE "GRADLE EXIT=[1-9]" "$OUT" 2>/dev/null && { echo "build failed"; tail -6 "$OUT"; exit 3; }
grep -q "^LAUNCHED" "$OUT" 2>/dev/null || { echo "never launched"; exit 3; }
echo "launched - streaming breadcrumbs 90s"
timeout 90 "$ADB" -s $S logcat 2>/dev/null | grep -E "\[fill\]|\[block\]|\[slow\]|\[fd\]" | tail -30
sleep 60
echo "=== warm stages (≈150s after launch) ==="
cd /d/void-audit && for s in globe wall reels; do node scripts/stage-of.mjs $s 2>&1 | grep -v '^JSON'; sleep 2; done
if "$ADB" -s $S shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q com.thevoid.app; then
  "$ADB" -s $S exec-out screencap -p > /d/void-audit/scripts/device-watch-shots/warm.png 2>/dev/null && echo "screenshot: scripts/device-watch-shots/warm.png"
fi
