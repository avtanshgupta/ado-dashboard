#!/usr/bin/env bash
#
# token-pusher — keeps the hosted ADO PR Dashboard signed in as you.
#
# It periodically mints a fresh Azure DevOps access token from your local
# `az` session and pushes it to the dashboard's /api/auth/token endpoint, so
# the browser session never has to ask you to re-paste a token.
#
# Usage:
#   ./scripts/token-pusher.sh                 # loop forever (default)
#   ./scripts/token-pusher.sh --once          # push a single token and exit
#   DASHBOARD_URL=https://my-app.azurewebsites.net ./scripts/token-pusher.sh
#
# Env:
#   DASHBOARD_URL   Base URL of the deployed dashboard
#                   (default: https://ado-dashboard.azurewebsites.net)
#   INTERVAL_SEC    Seconds between refreshes (default: 3000 = 50 min)
#
set -euo pipefail

RESOURCE="499b84ac-1321-427f-aa17-267ca6975798"   # Azure DevOps resource id
DASHBOARD_URL="${DASHBOARD_URL:-https://ado-dashboard.azurewebsites.net}"
INTERVAL_SEC="${INTERVAL_SEC:-3000}"
ONCE="false"
[[ "${1:-}" == "--once" ]] && ONCE="true"

URL="${DASHBOARD_URL%/}/api/auth/token"

# Decode the JWT `exp` claim (epoch seconds) from an access token; empty on failure.
token_exp() {
  python3 - "$1" <<'PY' 2>/dev/null
import sys, base64, json
try:
    seg = sys.argv[1].split('.')[1]
    seg += '=' * (-len(seg) % 4)
    print(json.loads(base64.urlsafe_b64decode(seg))['exp'])
except Exception:
    pass
PY
}

# Mint a token and push it. On success, echoes the token's remaining lifetime
# (seconds) to stdout so the caller can schedule the next refresh precisely.
push_once() {
  local token http
  if ! token="$(az account get-access-token --resource "$RESOURCE" --query accessToken -o tsv 2>/dev/null)"; then
    echo "$(date '+%H:%M:%S') ✗ az could not get a token — run 'az login' first." >&2
    return 1
  fi
  http="$(curl -s -o /tmp/token-pusher.out -w '%{http_code}' \
            -X POST "$URL" -H 'Content-Type: application/json' \
            -d "$(printf '{"token":"%s"}' "$token")" || echo 000)"
  if [[ "$http" == "200" ]]; then
    local exp now life=""
    exp="$(token_exp "$token")"
    now="$(date +%s)"
    [[ -n "$exp" ]] && life=$(( exp - now ))
    echo "$(date '+%H:%M:%S') ✓ pushed fresh token to ${DASHBOARD_URL}${life:+ (valid ${life}s)}"
    [[ -n "$life" ]] && printf '%s\n' "$life" >/tmp/token-pusher.life
    return 0
  fi
  echo "$(date '+%H:%M:%S') ✗ push failed (HTTP $http): $(cat /tmp/token-pusher.out 2>/dev/null)" >&2
  return 1
}

if [[ "$ONCE" == "true" ]]; then
  push_once
  exit $?
fi

# Safety margin: always re-push at least this many seconds before the token expires.
MARGIN_SEC="${MARGIN_SEC:-600}"

echo "token-pusher → $URL  (refresh ≤${INTERVAL_SEC}s, and ≥${MARGIN_SEC}s before each token expires; Ctrl-C to stop)"
while true; do
  rm -f /tmp/token-pusher.life
  if push_once; then
    life="$(cat /tmp/token-pusher.life 2>/dev/null || echo '')"
    # Wake MARGIN_SEC before this token expires, but never later than INTERVAL_SEC
    # and never sooner than 60s. This closes the end-of-life gap that a fixed
    # interval leaves when `az` returns an already-aged cached token.
    if [[ -n "$life" ]]; then
      sleep_for=$(( life - MARGIN_SEC ))
      (( sleep_for > INTERVAL_SEC )) && sleep_for="$INTERVAL_SEC"
      (( sleep_for < 60 )) && sleep_for=60
    else
      sleep_for="$INTERVAL_SEC"
    fi
  else
    sleep_for=60   # retry soon on failure
  fi
  sleep "$sleep_for"
done
