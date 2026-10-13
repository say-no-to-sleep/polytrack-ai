import base64 # The run file is stored as base64
import zlib # Decompress
import json
import urllib.request # Download from the leaderboard server
import os

# The project folder (one level above src/), so files land in the same place
# no matter which folder you run the script from
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Read one 3 byte number
# Little endian
# b"\x03\x00\x00" -> 3
# b"\xd4\x39\x00" -> 0x39d4 = 14804
def read_u24(raw, pos):
    return int.from_bytes(raw[pos:pos+3], "little")

"""
Layout

[count] [delta] [delta] ... [delta]

The layout repeat 5 times, in the order up, right, down, left, reset
delta are gaps since the key's previous toggle. Keep running total to
turn into absolute frame numbers
"""

KEYS = ("up", "right", "down", "left", "reset")

def parse_recording(raw):
    # Toggles store when that key changed frame.
    toggles, pos = {}, 0
    for key in KEYS:
        # For each 5 keys
        # Read this once at the start for each key
        count = read_u24(raw, pos)
        pos += 3
        frames, frame = [], 0
        for _ in range(count):
            # Loop (count) times for this key
            delta = read_u24(raw, pos)
            pos += 3 # increase to next byte
            frame += delta # global frame number
            frames.append(frame)
        toggles[key] = frames
    return toggles


def get_champion(map_id):

    # Ask the leaderboard for the top 1 verified run on this map
    url = f"https://vps.kodub.com/v6/leaderboard?version=0.6.3&trackId={map_id}&skip=0&amount=1&onlyVerified=true"
    # The server returns 403 unless we say we're the game
    request = urllib.request.Request(url, headers={"Origin": "https://app-polytrack.kodub.com"})
    response = urllib.request.urlopen(request)
    leaderboard = json.loads(response.read())

    # Some maps have no verified runs, so fall back to unverified ones
    if len(leaderboard["entries"]) == 0:
        print("No verified runs on this map, using unverified runs instead")
        url = url.replace("onlyVerified=true", "onlyVerified=false")
        request = urllib.request.Request(url, headers={"Origin": "https://app-polytrack.kodub.com"})
        response = urllib.request.urlopen(request)
        leaderboard = json.loads(response.read())

    if len(leaderboard["entries"]) == 0:
        raise ValueError("No runs at all on this map. Check the map ID.")

    champion = leaderboard["entries"][0]
    run_id = champion["id"]
    print("Champion:", champion["nickname"], champion["frames"] / 1000, "s, run_id", run_id)

    # Download the champion's recording (same Origin trick)
    url = f"https://vps.kodub.com/v6/recordings?version=0.6.3&ids={run_id}"
    request = urllib.request.Request(url, headers={"Origin": "https://app-polytrack.kodub.com"})
    response = urllib.request.urlopen(request)
    recordings = json.loads(response.read())
    s = recordings[0]["recording"]

    # Works out how many padding is missing
    # adds the padding to the end
    # Turn them back into bytes (url safe which the game uses)
    compressed = base64.urlsafe_b64decode(s+ "=" * (-len(s) % 4))

    # 78 da 1d 91cd+

    print(len(compressed), compressed[:2].hex())

    # length 315, first 2 bytes 78 da

    # Decompress
    raw = zlib.decompress(compressed)
    print(len(raw), raw[:12].hex())

    # champion also has nickname and frames, which the mod's panel shows
    return parse_recording(raw), run_id, s, champion


def save_run(run_id, recording_string, toggles):
    # Save the raw recording text, like fetch_recording.sh did
    path = os.path.join(PROJECT, "recordings", f"{run_id}.txt")
    with open(path, "w") as file:
        file.write(recording_string)

    # Save the decoded key toggles so you can read them
    path = os.path.join(PROJECT, "output", f"run_{run_id}.json")
    with open(path, "w") as file:
        file.write(json.dumps(toggles))


# Only runs when you start this file directly, not when another file imports it
if __name__ == "__main__":
    map_id = input("Input Map ID Here: ").strip()
    output, run_id, recording_string, champion = get_champion(map_id)
    save_run(run_id, recording_string, output)
