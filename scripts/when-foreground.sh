#!/bin/bash
# Wait for The Void to be the resumed activity, then measure. The phone is the
# user's daily driver - screenshots of it have caught a banking app and a mail
# inbox - so nothing here drives it until the app is genuinely in front.
ADB=/d/android-sdk/platform-tools/adb.exe
S=R5CYA0GF6FP
for i in $(seq 1 90); do
  if "$ADB" -s $S shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | grep -q com.thevoid.app; then
    echo "The Void is up after $((i*20))s - measuring"
    cd /d/void-audit && node scripts/stage-breakdown.mjs
    exit 0
  fi
  sleep 20
done
echo "The Void did not come to the foreground within 30 minutes."
exit 3
