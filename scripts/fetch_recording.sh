#!/usr/bin/env bash
# Save a leaderboard entry's recording string to recordings/<id>.txt
# Usage: ./fetch_recording.sh <entry id from fetch.sh>
set -euo pipefail

ID="${1:?usage: $0 <entry id>}"
mkdir -p recordings

# Send with polytrack as the origin
curl -sf -H "Origin: https://app-polytrack.kodub.com" \
  "https://vps.kodub.com/v6/recordings?version=0.6.3&ids=${ID}" \
  | python3 -c 'import json, sys; r = json.load(sys.stdin)[0]; sys.exit("no recording for that id") if r is None else print(r["recording"], end="")' \
  > "recordings/${ID}.txt"

echo "saved recordings/${ID}.txt"
