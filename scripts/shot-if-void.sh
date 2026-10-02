#!/bin/bash
# Take a screenshot ONLY if The Void is the resumed activity. Usage: shot-if-void.sh <out.png> [label]
# A timed screenshot loop without this check photographed the user's finance app
# on 2026-10-01 when they switched apps mid-capture. Every screencap goes through here.
ADB=/d/android-sdk/platform-tools/adb.exe; S=${ANDROID_SERIAL:-R5CYA0GF6FP}
if "$ADB" -s $S shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q com.thevoid.app; then
  "$ADB" -s $S exec-out screencap -p > "$1" 2>/dev/null && echo "shot ${2:-$1}"
else
  echo "skipped shot ${2:-$1}: The Void is not in the foreground"
fi
