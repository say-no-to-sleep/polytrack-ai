import base64 # The run file is stored as base64
import zlib # Decompress
import json
import urllib.request # Download from the leaderboard server

map_id = input("Input Map ID Here: ").strip()

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
    print("No runs at all on this map. Check the map ID.")
    exit()

champion = leaderboard["entries"][0]
run_id = champion["id"]
print("Champion:", champion["nickname"], champion["frames"] / 1000, "s, run_id", run_id)

# Download the champion's recording (same Origin trick)
url = f"https://vps.kodub.com/v6/recordings?version=0.6.3&ids={run_id}"
request = urllib.request.Request(url, headers={"Origin": "https://app-polytrack.kodub.com"})
response = urllib.request.urlopen(request)
recordings = json.loads(response.read())
s = recordings[0]["recording"]

# Save the raw recording text, like fetch_recording.sh did
path = f"./recordings/{run_id}.txt"
with open(path, "w") as file:
    file.write(s)

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


# Write
output = parse_recording(raw)

filename = f"./output/run_{run_id}.json"

with open(filename, "w") as file:
    file.write(json.dumps(output))

