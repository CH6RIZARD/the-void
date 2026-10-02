#!/bin/bash
# Wait for the build/install to land, then for the USER to open The Void (never
# launched from here), then stream the breadcrumbs through its first minute.
OUT="$1"; ADB=/d/android-sdk/platform-tools/adb.exe; S=R5CYA0GF6FP
for i in $(seq 1 120); do grep -qE "INSTALLED|^Success|LAUNCHED" "$OUT" 2>/dev/null && break; sleep 15; done
grep -qE "INSTALLED|^Success|LAUNCHED" "$OUT" 2>/dev/null || { echo "install never landed"; exit 3; }
echo "installed; waiting for The Void to be opened"
for i in $(seq 1 240); do
  "$ADB" -s $S shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q com.thevoid.app && break
  sleep 15
done
"$ADB" -s $S shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q com.thevoid.app || { echo "not opened within an hour"; exit 4; }
echo "The Void is up - capturing 75s"
timeout 75 "$ADB" -s $S logcat 2>/dev/null | grep -E "\[fill\]|\[block\]|\[slow\]|\[fd\]" | tail -40
