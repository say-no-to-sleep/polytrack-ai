// Runs PolyTrack's own simulation worker in Node, no browser: recording in, finish frame out.
//
//   node src/headless_sim.mjs <map id> <recording file>
//
// Needs vendor/polytrack/0.6.3 (the game files) and output/sim/ (the worker's Init message
// and the map's CreateCar message, captured once from the real game).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = resolve(root, "vendor/polytrack/0.6.3");
const workerFile = resolve(gameDir, "simulation_worker.bundle.js");

// Captured messages store typed arrays as {__t: "Float32Array", d: [...]}.
const revive = (k, v) => (v && v.__t ? new globalThis[v.__t](v.d) : v);
const loadJson = (p) => JSON.parse(readFileSync(p, "utf8"), revive);

let source = readFileSync(workerFile, "utf8");
// Verify only reports "finished exactly at targetFrames"; also report where it actually stopped.
const verifyResult = "result: A,";
if (!source.includes(verifyResult)) throw new Error("worker changed: Verify patch point not found");
source = source.replace(verifyResult, "result: A, frames: h.frames, finished: h.hasFinished,");
// Expose the worker's internals for frame-by-frame driving: wasm module, car setup/step, track and recording parsers.
const handlerSet = "(($o.length = 0), (onmessage = r));";
if (!source.includes(handlerSet)) throw new Error("worker changed: internals patch point not found");
source = source.replace(handlerSet, handlerSet +
  "self.__sim = { mod: t, setupCar: s, stepCar: n, isFinished: Xo, parseTrack: (d) => Ko.fromSaveString(d), parseRecording: (r) => new tr(Qa.deserialize(r)), Vec3: R };");

// The worker's globals: self, importScripts, postMessage, onmessage.
let reply = null;
globalThis.self = globalThis;
globalThis.addEventListener ??= () => {};
globalThis.onmessage = null;
globalThis.location = { href: pathToFileURL(workerFile).href };
globalThis.importScripts = (p) => vm.runInThisContext(readFileSync(resolve(gameDir, p), "utf8"));
globalThis.postMessage = (m) => (reply = m);
// Not a real Response on purpose: the worker swaps global Math mid-load, which breaks Node's
// streaming compile. The loader logs "wasm streaming compile failed" and falls back to arrayBuffer().
globalThis.fetch = async (url) => {
  const buf = readFileSync(fileURLToPath(url));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
// Init with isRealtime=false starts a setInterval stepping loop that we don't use.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;

// Hide `process` while loading so the bundled js-sha256 doesn't take its Node path (needs require()).
const realProcess = globalThis.process;
globalThis.process = undefined;
try {
  vm.runInThisContext(source, { filename: workerFile });
} finally {
  globalThis.process = realProcess;
}

// The worker queues messages until its physics wasm is ready, then swaps in the real handler.
const send = (data) => globalThis.onmessage({ data });
async function ready() {
  for (let i = 0; i < 1000 && globalThis.onmessage.toString().includes("push"); i++)
    await new Promise((r) => setTimeout(r, 5));
}

let carId = 0;
async function loadTrack(trackId) {
  await ready();
  if (!loadTrack.inited) {
    send(loadJson(resolve(root, "output/sim/init.json")));
    loadTrack.inited = true;
  }
  return loadJson(resolve(root, `output/sim/track_${trackId}.json`));
}

// A car you drive one frame at a time. All physics state lives in wasm memory, so
// snapshot() copies that memory and restore() writes it back: a full-sim checkpoint.
// Only one car should exist at a time; restore() rewinds every car in the sim.
export async function createCar(trackId) {
  const track = await loadTrack(trackId);
  const { mod, setupCar, stepCar, isFinished, parseTrack, Vec3 } = globalThis.__sim;
  const parsed = parseTrack(track.trackData);
  const o = track.mountainOffset;
  const car = { id: ++carId, frames: 0, finished: false };
  setupCar(car.id, track.mountainVertices, new Vec3(o.x, o.y, o.z), parsed, parsed.getStartTransform());
  return {
    get frames() { return car.frames; },
    get finished() { return car.finished; },
    // controls: {up, right, down, left, reset} booleans. Returns the raw 227-byte car state.
    step(controls) {
      const state = stepCar(car, controls);
      car.finished = isFinished(new Uint8Array(state));
      car.frames++;
      return state;
    },
    snapshot: () => ({ mem: mod.HEAPU8.slice(), frames: car.frames, finished: car.finished }),
    restore(s) {
      mod.HEAPU8.set(s.mem); // memory only grows, so the old image always fits
      car.frames = s.frames;
      car.finished = s.finished;
    },
    dispose: () => mod.ccall("deleteCarModel", "void", ["number"], [car.id]),
  };
}

// Per-frame controls of a recording string, read by the game's own decoder.
export async function recordingControls(recording) {
  await ready();
  return globalThis.__sim.parseRecording(recording);
}

export async function createSim(trackId) {
  const track = await loadTrack(trackId);
  // Returns { finished, frames } for a recording string.
  return (recording, maxFrames = 600000) => {
    reply = null;
    send({ ...track, messageType: 1, carId: ++carId, carRecording: recording, targetFrames: maxFrames });
    if (!reply) throw new Error("worker gave no VerifyResult");
    return { finished: reply.finished, frames: reply.frames };
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [trackId, recFile] = process.argv.slice(2);
  const sim = await createSim(trackId);
  const rec = readFileSync(recFile, "utf8").trim();
  const t0 = performance.now();
  const r = sim(rec);
  const ms = performance.now() - t0;
  console.log(r, `${ms.toFixed(0)} ms wall, ${(r.frames / ms).toFixed(1)}x real time`);
  globalThis.setInterval = realSetInterval;
}
