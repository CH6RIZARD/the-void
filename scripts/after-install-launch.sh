#!/bin/bash
# After the running build installs: launch The Void (the user asked for this to
# be done here rather than waiting for them), capture the first 75s of
# breadcrumbs, then measure globe, wall and reels by stage, then ship the next
# build - serialised so there are never two Gradles.
OUT="$1"; ADB=/d/android-sdk/platform-tools/adb.exe; S=R5CYA0GF6FP
for i in $(seq 1 160); do grep -qE "INSTALLED|^Success|LAUNCHED|GRADLE EXIT=[1-9]" "$OUT" 2>/dev/null && break; sleep 15; done
grep -qE "GRADLE EXIT=[1-9]" "$OUT" 2>/dev/null && { echo "build failed - not launching"; tail -8 "$OUT"; exit 3; }
grep -qE "INSTALLED|^Success|LAUNCHED" "$OUT" 2>/dev/null || { echo "install never landed"; exit 3; }
echo "installed - launching The Void"
"$ADB" -s $S logcat -c
"$ADB" -s $S shell am force-stop com.thevoid.app
"$ADB" -s $S shell monkey -p com.thevoid.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo "=== first 75s of breadcrumbs ==="
timeout 75 "$ADB" -s $S logcat 2>/dev/null | grep -E "\[fill\]|\[block\]|\[slow\]|\[fd\]" | tail -40
echo "=== stages by surface ==="
cd /d/void-audit && for s in globe wall reels; do node scripts/stage-of.mjs $s 2>&1 | grep -v '^JSON' ; sleep 2; done
echo "=== shipping the stall-clock build ==="
echo "java: $(tasklist 2>/dev/null | grep -c java.exe)"
bash /d/void-patch/ship.sh 2>&1 | tail -4
