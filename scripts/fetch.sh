#!/usr/bin/env bash
# Fetch the leaderboard for the Desert 1 map
# The server returns 403 unless the request carries the game's Origin header.
set -euo pipefail

# The Track ID of Desert 1 map
TRACK_ID="c20b4ee3cd517ca6cae7e43f047548757287fbd08ba81b97892a3ef520159a34"

# Send with polytrack as the origin
curl -sf -H "Origin: https://app-polytrack.kodub.com" \
  "https://vps.kodub.com/v6/leaderboard?version=0.6.3&trackId=${TRACK_ID}&skip=0&amount=10&onlyVerified=true" \
  | python3 -m json.tool

