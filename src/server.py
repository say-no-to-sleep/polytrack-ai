# Local server for the PolyTrack AI Replay mod.
#   python3 src/server.py
# Then add http://127.0.0.1:8780 as a mod URL in PolyModLoader.
#
# It does two jobs:
#   GET /manifest.json, /0.1.1/...    -> the mod files (polymodloader-mod/)
#   GET /champion?track=<map id>      -> the champion's recording, as JSON
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from decode_player import PROJECT, get_champion, save_run

PORT = 8780
MOD_DIR = os.path.join(PROJECT, "polymodloader-mod")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve files from the mod folder instead of the current folder
        super().__init__(*args, directory=MOD_DIR, **kwargs)

    def end_headers(self):
        # PolyModLoader runs on an https site; these let it read from localhost
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")  # always load the latest edit
        super().end_headers()

    def do_OPTIONS(self):
        # The browser asks permission first ("preflight") before calling localhost
        self.send_response(204)
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/champion":
            return super().do_GET()  # a mod file

        track = parse_qs(url.query).get("track", [""])[0]
        # A map id is a sha256 hash: exactly 64 hex characters.
        # Checking this stops anything else being pasted into the Kodub URL.
        if not re.fullmatch(r"[0-9a-f]{64}", track):
            return self.send_json(400, {"error": "track must be a 64-character map id"})

        try:
            toggles, run_id, recording, champion = get_champion(track)
        except ValueError as error:  # the map has no runs
            return self.send_json(404, {"error": str(error)})
        except Exception as error:  # Kodub unreachable, refused, etc.
            return self.send_json(502, {"error": f"leaderboard request failed: {error}"})

        save_run(run_id, recording, toggles)
        self.send_json(200, {
            "run_id": run_id,
            "nickname": champion["nickname"],
            "frames": champion["frames"],
            "recording": recording,
        })

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Mod URL: http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
