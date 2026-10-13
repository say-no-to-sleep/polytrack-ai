# polytrack-ai

This repository aims to train an AI on playing PolyTrack, the (popular?) web-based game that is (not) a clone of Trackmania, definitely.

Please read [the master plan](the_master_plan.md) for more insight on, well obviously the master plan.

IMPORTANT IMPORTANT IMPORTANT This mod automatically blocks leaderboard uploading. I don't endorse cheating behaviour.
If this repo miraculously solved all the problems and had a breakthrough in the master plan, you will see me work at big tech instead of winning and get banned at low poly games.

## Progress

| Step | Status |
|---|---|
| 1. Groundwork: fetch + decode champion runs | Done |
| 2. Replay mod (frame-perfect: Desert 1 replayed matches champion to the millisecond) | Done |
| 3. Standing on the shoulders of giants (optimize the champion) | YOU'RE NEXT |
| 4. Electric Boogaloo (multi-track agent that imagines) | Coming to a hot single near you Soon (TM) |

## The Calm Before the Storm

Before any of that plan stuff, we need 2 things:
- The Champion's exact inputs
- A way to play any input sequence back in the real game

### Stage 1: Fetching the champion

**Map ID.**:
- The leaderboard don't know track names, it only knows each track by a SHA-256 hash of its layout so that if they decide to rename a track the leaderboard gets kept while moving a block gives it a new one.
- For example, Desert 1 is, get this,
    - `c20b4ee3cd517ca6cae7e43f047548757287fbd08ba81b97892a3ef520159a34`
- To find any track ID, open leaderboard with the browser Network tab open and copy `trackId=` from request.
- The mod also does it automatically.

**The leaderboard API.**: Two GET endpoints which are the same ones the game uses:

```
https://vps.kodub.com/v6/leaderboard?version=0.6.3&trackId=<map id>&skip=0&amount=1&onlyVerified=true
https://vps.kodub.com/v6/recordings?version=0.6.3&ids=<run id>
```

> Both return `403 Forbidden` unless the request carries the game's origin, `Origin: https://app-polytrack.kodub.com`. Run IDs are global across all tracks instead of per map. Some maps have no verified runs, like some community clipboard-shared tracks, so the script falls back to unverified ones.

**The recording format.**: A recording is a ~400-character string. It's built in three layers:

1. **base64url text** (`-` and `_`, no `=` padding)
2. **zlib compression** (level 9; the bytes start with `78 da`)
3. **five lists**: one per key, in the order `up, right, down, left, reset`. Each list is a 3-byte little-endian count, then that many 3-byte little-endian deltas

Each delta is the gap in ticks since that key's last toggle. Every key start released of course, and each toggle flips it. So a key is held at time tick t when an odd number of its toggle happened at/before t.
> One tick is 1ms.

[`src/decode_player.py`](src/decode_player.py) does all of this: give it a map ID and it downloads the champion and saves `recordings/<run id>.txt` (the raw string) and `output/run_<run id>.json` (the decoded toggles).

### Stage 2: The replay mod

[`polymodloader-mod/`](polymodloader-mod/) is a [PolyModLoader](https://web.polymodloader.com/) mod that adds an in-race panel, styled with the game's own CSS:

- **Replay champion**: asks the local server for this map's champion run and drives your car with it, exactly.
- **Paste recording**: plays any recording string, which is how our own runs will get tested later.
- **W/A/S/D display**: shows your car's inputs live, whether you or a recording is driving.
- **Delete my record**: removes your saved personal best for this map (click twice to confirm).

So, Polytrack runs all its physics in a background simulation worker. The ghosts are cars driven by a recording. This mod patches the worker so that your car is driven like a ghost. Now hold your horses (or ghostbusters squad or smth) because this is entirely deterministic. The game's decoder feeds it one input per 1ms tick, with no keyboard timing involved.
- Additionally the mod also read the map ID with the game's own functions.
- The mod can also delete your current record if you're tired of winning.

## Quickstart

You need Python 3 (which was already installed from the last time you made a to-do list) and a modern browser (This author have not tested this with IE, or Netscape. Use at own risk)

Seriously though:

1. Start the local server. It serves the mod and fetches champion runs
   ```bash
   python3 src/server.py
   ```
2. Open [web.polymodloader.com](https://web.polymodloader.com/) -> **Mods** -> **Add**. Enter `http://127.0.0.1:8780` as the mod URL, turn **Auto Update** on, and click **Import**. Select **PolyTrack AI Replay**, click **Load**, then **Apply**
3. Start a race, press **Replay champion**, then tap W to start.

To decode a champion without the game:

```bash
python3 src/decode_player.py
```

## Repo layout

```
src/decode_player.py      fetch a map's champion, decode it, save it
src/server.py             local server: serves the mod + GET /champion?track=<map id>
polymodloader-mod/        the PolyModLoader mod (manifest.json + one folder per version)
scripts/                  early curl experiments (fetch.sh, fetch_recording.sh)
the_master_plan.md        the why
```

Not in the repo:

- `vendor/`: PolyTrack's own game files
- `recordings/` and `output/`: downloaded leaderboard runs
- `references/`: other projects kept around for reference, e.g. [michael201110/poly-bot](https://github.com/michael201110/poly-bot).
