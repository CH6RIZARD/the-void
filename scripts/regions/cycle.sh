#!/bin/bash
# One round of the 5-region stream re-check. Runs on the always-on coordinator box (void-chat)
# from loop.sh every 2 hours: rent one cheap box per region, probe the master list there,
# keep a stream that played from any region, push the result to the proxy, destroy the boxes.
# Needs: vastai (with the account key), ~/.ssh/id_ed25519 registered with Vast, node,
# ~/.void/curator.key. State lives in this folder (state.json = the master list + strikes).
set -u
cd "$(dirname "$0")"
PROXY=${PROXY_BASE:-https://void-proxy-production.up.railway.app}
FILTER='reliability>0.97 inet_down>200 direct_port_count>=1 rentable=true disk_space>=10'
declare -A REGIONS=(
  [us]='US,CA' [eu]='GB,FR,DE,NL,SE,PL,ES,IT,CH,AT,CZ,PT' [asia]='JP,KR,TW,SG,HK'
  [oce]='AU,NZ' [sa]='AR,BR,CL,CO,MX,PE,UY'
)
log() { echo "$(date -u +%FT%TZ) $*"; }
SSH="ssh -T -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 -o LogLevel=ERROR"
: > ids.txt
trap 'while read -r i; do vastai destroy instance "$i" -y >/dev/null 2>&1; done < ids.txt' EXIT

info() { # id -> "status ip port"
  vastai show instance "$1" --raw 2>/dev/null | python3 -c "import sys,json
d=json.load(sys.stdin); p=((d.get('ports') or {}).get('22/tcp') or [{}])[0].get('HostPort')
print(d.get('actual_status'), d.get('public_ipaddr'), p)"
}

region() { # name countries: rent, probe, fetch alive-<name>.json. Two offers tried.
  local r=$1 q=$2 n off id st ip port ok
  for n in 0 1; do
    off=$(vastai search offers "geolocation in [$q] $FILTER" -o dph --raw 2>/dev/null | python3 -c "import sys,json
o=json.load(sys.stdin); print(o[$n]['id'] if len(o)>$n else '')")
    [ -z "$off" ] && { log "$r: no offer"; return; }
    id=$(vastai create instance "$off" --image node:22-bookworm --disk 10 --ssh --direct \
      --onstart-cmd 'touch /root/.no_auto_tmux' --label "void-recheck-$r" --raw 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('new_contract',''))")
    [ -z "$id" ] && { log "$r: create failed on $off"; continue; }
    echo "$id" >> ids.txt
    ok=
    for _ in $(seq 60); do   # up to 10 min to boot; slow image pulls get abandoned
      read -r st ip port < <(info "$id")
      if [ "$st" = running ] && [ "$port" != None ] && $SSH -p "$port" root@"$ip" true 2>/dev/null; then ok=1; break; fi
      sleep 10
    done
    if [ -n "$ok" ]; then
      tar czf - -C /root/regions/app scripts master.json | $SSH -p "$port" root@"$ip" 'mkdir -p /root/r && tar xzf - -C /root/r'
      $SSH -p "$port" root@"$ip" 'cd /root/r && timeout 1500 node scripts/regions/recheck.js master.json alive.json' 2>&1 | sed "s/^/$r: /"
      $SSH -p "$port" root@"$ip" 'cat /root/r/alive.json' > "alive-$r.json.tmp" 2>/dev/null && [ -s "alive-$r.json.tmp" ] && mv "alive-$r.json.tmp" "alive-$r.json"
    else
      log "$r: box $id never came up"
    fi
    vastai destroy instance "$id" -y >/dev/null 2>&1
    [ -s "alive-$r.json" ] && return
  done
}

log "round start"
rm -f alive-*.json
curl -s -m 60 "$PROXY/streams/pool" -o pool.json || log "proxy pool fetch failed"
node app/scripts/regions/merge.js prep state.json pool.json app/master.json
for r in "${!REGIONS[@]}"; do region "$r" "${REGIONS[$r]}" & done
wait
if node app/scripts/regions/merge.js apply state.json push.json alive-*.json; then
  curl -s -m 120 -X POST "$PROXY/streams/pool/ingest" -H 'content-type: application/json' \
    -H "x-curator-key: $(cat ~/.void/curator.key)" --data-binary @push.json | head -c 200; echo
fi
log "round end"
