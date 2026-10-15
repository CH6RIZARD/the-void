#!/bin/bash
# Phone builds without this PC's memory: streams the committed void-app (git archive HEAD) to the
# Vast box, which runs /root/build.sh there (npm ci only when package-lock changed, then EAS).
#   bash scripts/remote-build.sh ios|android|all     (VAST_SSH="-p <port> root@<ip>")
set -e
cd "$(dirname "$0")/.."
SSH=${VAST_SSH:-"-p 44621 root@49.0.90.52"}
git log --oneline -1
git archive --format=tar HEAD void-app | ssh -T -i ~/.ssh/vast_ed25519 $SSH "/root/build.sh ${1:-ios}" 2>&1 | grep -vE "Welcome to vast|Have fun|git rev-parse"
