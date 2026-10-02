#!/bin/bash
# Inject a tap ONLY if The Void is the resumed activity. Usage: tap-if-void.sh X Y [label]
# A capture script sent `input tap` after a failed build with another app in front
# (2026-10-01). Every input injection outside stage-of.mjs goes through here.
ADB=/d/android-sdk/platform-tools/adb.exe; S=${ANDROID_SERIAL:-R5CYA0GF6FP}
if "$ADB" -s $S shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q com.thevoid.app; then
  "$ADB" -s $S shell input tap "$1" "$2" && echo "tapped ${3:-$1,$2}"
else
  echo "REFUSED tap ${3:-$1,$2}: The Void is not in the foreground"; exit 2
fi
