import {
  MixinType,
  PolyMod,
} from "https://cdn.polymodloader.com/pml/PolyModLoader/0.6.2/PolyTypes.js";

// Our local Python server (src/server.py). It also serves this mod.
const SERVER = "http://127.0.0.1:8780";

// The page and the game's simulation worker talk over this channel.
//   page   -> worker: { recording: "<string>" | null }   arm or disarm a replay
//   worker -> page:   { status: "ready" | "armed" | "off" | "invalid" | "replaying" }
//                     { trackId: "<64 hex>" }             your car was created on this map
//                     { keys: <bits> }                    your car's inputs changed
const CHANNEL = "polytrack-ai-replay";

// Bit for each key in the { keys } message
const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;

// ---------------------------------------------------------------------------
// Code injected into the simulation worker (it runs in the worker, not here).
// Names like Qa, i and t are the game's own minified variables at that spot.
// ---------------------------------------------------------------------------

// Top of the worker's message handler: set up the channel once.
const workerSetup = `
if (!globalThis.__ptaiReplay) {
  const state = (globalThis.__ptaiReplay = {
    recording: null,  // the armed recording string, or null for keyboard driving
    playerId: null,   // carId of your car, so we only report its keys
    lastKeys: -1,     // last keys sent, so we only send changes
    channel: new BroadcastChannel(${JSON.stringify(CHANNEL)}),
  });
  state.channel.onmessage = (event) => {
    // Other workers' status messages arrive here too; only act on commands.
    if (!event.data || !("recording" in event.data)) return;
    const recording = event.data.recording;
    // Check it with the game's own decoder so a bad string cannot crash the race.
    if (recording !== null && Qa.deserialize(recording) == null) {
      state.channel.postMessage({ status: "invalid" });
      return;
    }
    state.recording = recording;
    state.channel.postMessage({ status: recording === null ? "off" : "armed" });

    // The game's restart key does nothing before the race starts, so a car still
    // on the start line (frame 0) gets its controls swapped in place instead.
    // e = the worker's list of cars; tr and jo = the game's recording and
    // keyboard control classes (the same ones CreateCar uses).
    const car = e.find((c) => c.id === state.playerId);
    if (car && car.frames === 0) {
      if (recording !== null) {
        car.controls = new tr(Qa.deserialize(recording));
        car.userControls = null;
        state.channel.postMessage({ status: "replaying" });
      } else if (car.userControls === null) {
        car.controls = new jo();
        car.userControls = { up: !1, right: !1, down: !1, left: !1, reset: !1, buffer: [] };
      }
    }
  };
  state.channel.postMessage({ status: "ready" });
}
`;

// Inside CreateCar, where the game reads the car's recording.
// t = the CreateCar message, i = the parsed track.
// Ghosts arrive with a recording; your car arrives with null. If a replay is
// armed, your car gets it instead, and the worker drives it like a ghost:
// exact inputs, one per 1 ms tick.
const workerCreateCar = `
const __ptai = globalThis.__ptaiReplay;
const a = t.carRecording ?? __ptai?.recording ?? null;
if (t.carRecording == null && __ptai) {
  __ptai.playerId = t.carId;
  __ptai.lastKeys = -1;
  __ptai.channel.postMessage({ trackId: i.getId() }); // same hash the leaderboard uses
  if (a != null) __ptai.channel.postMessage({ status: "replaying" });
}
`;

// Just before the realtime loop turns each tick's inputs into physics.
// i = this frame's list of { car, controls }, one entry per simulated tick.
const workerKeys = `
{
  const __ptai = globalThis.__ptaiReplay;
  if (__ptai) {
    for (const { car: __car, controls: __c } of i) {
      if (__car.id !== __ptai.playerId) continue;
      const keys = (__c.up ? ${UP} : 0) | (__c.right ? ${RIGHT} : 0) | (__c.down ? ${DOWN} : 0) | (__c.left ? ${LEFT} : 0);
      if (keys !== __ptai.lastKeys) {
        __ptai.lastKeys = keys;
        __ptai.channel.postMessage({ keys });
      }
    }
  }
}
`;

// Inside DeleteCar. i = the DeleteCar message. When your car goes away
// (you left the race, or restart is about to make a new one), tell the page.
const workerDeleteCar = `
const r = i.carId;
if (globalThis.__ptaiReplay && r === globalThis.__ptaiReplay.playerId) {
  globalThis.__ptaiReplay.playerId = null;
  globalThis.__ptaiReplay.channel.postMessage({ left: true });
}
`;

class PolyTrackAiReplayMod extends PolyMod {
  touchingPhysics = true;

  preInit = (pml) => {
    if (typeof pml?.registerSimWorkerMixin !== "function") {
      throw new Error("PolyTrack AI Replay needs PolyModLoader with simulation-worker mixins.");
    }

    // A token is an exact piece of the game's code to hook onto.
    // REPLACEBETWEEN with the same start and end token replaces just that token.
    const replace = (token, func) => pml.registerSimWorkerMixin({
      type: MixinType.REPLACEBETWEEN, tokenStart: token, tokenEnd: token, func,
    });

    pml.registerSimWorkerMixin({ type: MixinType.INSERT, token: "const r = i.data;", func: workerSetup });
    replace("const a = t.carRecording;", workerCreateCar);

    // The keyboard still sends inputs for a replayed car; drop them instead of crashing.
    replace('throw new Error("Tried to control uncontrollable car");', "return;");

    const keysToken = "for (const { car: t, controls: e } of i) r.push(n(t, e));";
    replace(keysToken, workerKeys + keysToken);
    replace("const r = i.carId;", workerDeleteCar);

    // A replayed lap must never upload as your own time.
    for (const token of [
      "submitLeaderboard(e, t, n, i, r, a, s, o) {",
      "submitUserProfile(e, t, n, i) {",
      "verifyRecordings(e, t, n, i, r) {",
    ]) {
      pml.registerGlobalMixin({
        type: MixinType.INSERT,
        token,
        func: 'return Promise.reject(new Error("PolyTrack AI Replay: uploads disabled"));',
      });
    }

    if (document.body) createUi();
    else addEventListener("DOMContentLoaded", createUi);
  };
}

// ---------------------------------------------------------------------------
// On-screen UI (runs on the page)
// ---------------------------------------------------------------------------

// Reuses the game's own CSS: the .button class (slanted edges, hover sweep),
// the --surface/--button color variables, and its ForcedSquare italic font.
// The fallbacks after each var() are the game's values, for pages without its CSS.
const STYLE = `
#ptai-panel {
  position: fixed; top: 16px; right: 16px; z-index: 1000; width: 300px;
  padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px;
  background: var(--surface-transparent-color, rgba(40, 52, 106, 0.5));
  clip-path: polygon(12px 0, 100% 0, 100% 100%, 0 100%, 0 12px);
  color: var(--text-color, #fff); font-size: 16px;
}
#ptai-panel h2 { margin: 0; font-size: 22px; }
#ptai-panel .ptai-info { font-size: 14px; opacity: 0.8; overflow-wrap: anywhere; }
#ptai-panel .ptai-row { display: flex; gap: 6px; }
#ptai-panel .button { flex: 1; font-size: 18px; padding: 6px 12px; }
#ptai-panel input[type="text"] { font-size: 14px; min-width: 0; flex: 1; }
#ptai-panel .ptai-danger { background-color: #6a1f2a; }
#ptai-panel [role="status"] { min-height: 1em; font-size: 14px; }

/* Bottom left, above the checkpoint counter, clear of the timer in the middle */
#ptai-keys {
  position: fixed; left: 16px; bottom: 72px; z-index: 1000;
  display: grid; grid-template-columns: repeat(3, 44px); gap: 4px; pointer-events: none;
}
#ptai-keys span {
  height: 44px; display: grid; place-items: center; font-size: 22px;
  color: var(--text-color, #fff);
  background: var(--surface-tertiary-color, #192042); opacity: 0.6;
  clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
}
#ptai-keys span.on { background: var(--text-color, #fff); color: var(--button-color, #112052); opacity: 1; }
#ptai-keys .w { grid-column: 2; }
#ptai-keys span:not(.w) { grid-row: 2; } /* A S D on the row under W */
#ptai-keys[hidden], #ptai-panel[hidden] { display: none; }
`;

function createUi() {
  const channel = new BroadcastChannel(CHANNEL);
  let armed = null;            // the recording we want; re-sent if the worker restarts
  let restartPending = false;  // restart once per click, however many workers reply
  let trackId = null;          // the map you are on, reported by the worker
  let replaying = false;       // true once the worker says your car is driving the recording
  let hideTimer = 0;           // pending hide after leaving a race
  let deleteArmed = false;     // Delete my record needs a second click to confirm

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  // ---- Panel ----
  const panel = document.createElement("div");
  panel.id = "ptai-panel";
  panel.hidden = true; // only shown in a race, so it never covers the game's menus
  panel.innerHTML = `
    <h2>AI Replay</h2>
    <div class="ptai-info" data-map>Map: enter a race</div>
    <div class="ptai-info" data-champion></div>
    <div class="ptai-row">
      <button type="button" class="button" data-action="champion">Replay champion</button>
      <button type="button" class="button" data-action="stop">Stop</button>
    </div>
    <div class="ptai-row">
      <input type="text" placeholder="Paste recording" aria-label="Recording string">
      <button type="button" class="button" data-action="paste">Replay</button>
    </div>
    <button type="button" class="button ptai-danger" data-action="delete">Delete my record</button>
    <span role="status">Off</span>`;
  const $ = (selector) => panel.querySelector(selector);
  const input = $("input");
  const status = $("[role=status]");

  // Typing in the box must not steer the car or restart the race.
  for (const type of ["keydown", "keyup", "keypress"]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }

  // Same as pressing the game's restart key (Backspace), so your car is recreated.
  const restartRace = () => {
    document.activeElement?.blur();
    for (const type of ["keydown", "keyup"]) {
      document.body.dispatchEvent(new KeyboardEvent(type, {
        key: "Backspace", code: "Backspace", keyCode: 8, which: 8, bubbles: true, cancelable: true,
      }));
    }
  };

  // Send a recording to the worker; it checks it and replies "armed" or "invalid".
  const arm = (recording) => {
    armed = recording;
    replaying = false;
    restartPending = true;
    status.textContent = "Checking…";
    channel.postMessage({ recording });
  };

  $("[data-action=paste]").addEventListener("click", () => {
    const recording = input.value.trim();
    if (recording === "") status.textContent = "Paste a recording first";
    else arm(recording);
  });

  $("[data-action=champion]").addEventListener("click", async () => {
    if (trackId === null) {
      status.textContent = "Enter a race first";
      return;
    }
    status.textContent = "Downloading champion…";
    try {
      const response = await fetch(`${SERVER}/champion?track=${trackId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      $("[data-champion]").textContent =
        `Champion: ${data.nickname}, ${(data.frames / 1000).toFixed(3)} s`;
      arm(data.recording);
    } catch (error) {
      // "Failed to fetch" almost always means src/server.py is not running
      status.textContent = `Champion failed: ${error.message}`;
    }
  });

  $("[data-action=stop]").addEventListener("click", () => {
    armed = null;
    restartPending = true;
    channel.postMessage({ recording: null });
  });

  // Removes your saved best time for this map, like the game's own
  // deleteAllRecordsForTrack: key polytrack_v5_prod_record_<profile>_<mode>_<map id>
  $("[data-action=delete]").addEventListener("click", () => {
    if (trackId === null) {
      status.textContent = "Enter a race first";
      return;
    }
    const button = $("[data-action=delete]");
    if (!deleteArmed) {
      // First click only asks; a second click within 4 s deletes.
      deleteArmed = true;
      button.textContent = "Click again to delete";
      setTimeout(() => {
        deleteArmed = false;
        button.textContent = "Delete my record";
      }, 4000);
      return;
    }
    deleteArmed = false;
    button.textContent = "Delete my record";
    const pattern = new RegExp(`^polytrack_v\\d+_\\w+?_record_\\d+_(default|undeterministic)_${trackId}$`);
    const keys = Object.keys(localStorage).filter((key) => pattern.test(key));
    for (const key of keys) localStorage.removeItem(key);
    // The game keeps records in memory too, so the screen updates after a reload.
    status.textContent = keys.length === 0
      ? "No saved record on this map"
      : "Record deleted. Reload the page to see it gone.";
  });

  // ---- WASD display ----
  const keysBox = document.createElement("div");
  keysBox.id = "ptai-keys";
  keysBox.setAttribute("aria-hidden", "true"); // visual only
  keysBox.hidden = true; // shown once you are in a race
  keysBox.innerHTML = '<span class="w">W</span><span>A</span><span>S</span><span>D</span>';
  const [w, a, s, d] = keysBox.querySelectorAll("span");
  const showKeys = (keys) => {
    w.classList.toggle("on", (keys & UP) !== 0);
    a.classList.toggle("on", (keys & LEFT) !== 0);
    s.classList.toggle("on", (keys & DOWN) !== 0);
    d.classList.toggle("on", (keys & RIGHT) !== 0);
  };

  // ---- Messages from the worker ----
  channel.onmessage = (event) => {
    const data = event.data ?? {};
    if ("keys" in data) {
      showKeys(data.keys);
      return;
    }
    if ("trackId" in data) {
      clearTimeout(hideTimer);
      trackId = data.trackId;
      panel.hidden = false;
      keysBox.hidden = false;
      $("[data-map]").textContent = `Map: ${trackId.slice(0, 12)}…`;
      $("[data-map]").title = trackId;
      return;
    }
    if ("left" in data) {
      // A restart deletes and recreates the car within the same moment, so wait
      // briefly: only hide if no new car (trackId) arrived in the meantime.
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        panel.hidden = true;
        keysBox.hidden = true;
      }, 300);
      return;
    }
    switch (data.status) {
      case "ready": // a new worker started; give it the current recording
        if (armed !== null) channel.postMessage({ recording: armed });
        break;
      case "armed":
        if (!replaying) status.textContent = "Armed, restarting race…";
        if (restartPending) restartRace();
        restartPending = false;
        break;
      case "invalid":
        armed = null;
        restartPending = false;
        status.textContent = "Not a valid recording";
        break;
      case "replaying":
        replaying = true;
        status.textContent = "Replaying: press W to start";
        break;
      case "off":
        replaying = false;
        status.textContent = "Off";
        if (restartPending) restartRace();
        restartPending = false;
        break;
    }
  };

  document.body.append(panel, keysBox);
}

export const polyMod = new PolyTrackAiReplayMod();
