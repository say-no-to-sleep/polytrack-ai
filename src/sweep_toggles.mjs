// Shift every toggle of every key by +-delta ticks and report what each shift does to the finish frame.
// usage: node src/sweep_toggles.mjs <map id> <recording file> [delta=1] [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { createSim } from "./headless_sim.mjs";

const KEYS = ["up", "right", "down", "left", "reset"];

// recording string = base64url(zlib(per key: u24 count, then u24 gaps between toggles)), little endian
export function decode(rec) {
  const raw = inflateSync(Buffer.from(rec, "base64url"));
  const toggles = {};
  let pos = 0;
  for (const k of KEYS) {
    const n = raw.readUIntLE(pos, 3); pos += 3;
    let frame = 0;
    toggles[k] = Array.from({ length: n }, () => (frame += raw.readUIntLE((pos += 3) - 3, 3)));
  }
  return toggles;
}

export function encode(toggles) {
  const parts = [];
  for (const k of KEYS) {
    const b = Buffer.alloc(3 + 3 * toggles[k].length);
    b.writeUIntLE(toggles[k].length, 0, 3);
    toggles[k].forEach((f, i) => b.writeUIntLE(f - (toggles[k][i - 1] ?? 0), 3 + 3 * i, 3));
    parts.push(b);
  }
  return deflateSync(Buffer.concat(parts), { level: 9 }).toString("base64url");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [mapId, recFile, d = "1", outFile = "output/toggle_sweep.json"] = process.argv.slice(2);
  const delta = +d;
  const base = decode(readFileSync(recFile, "utf8").trim());
  const sim = await createSim(mapId);
  const champ = sim(encode(base)); // also proves encode() round-trips
  console.log("baseline", champ);
  if (!champ.finished) throw new Error("re-encoded champion does not finish");

  const rows = [];
  for (const k of KEYS) {
    for (let i = 0; i < base[k].length; i++) {
      for (const s of [-delta, delta]) {
        const f = base[k][i] + s;
        // a shift must keep the toggle strictly between its neighbours
        if (f <= (base[k][i - 1] ?? -1) || f >= (base[k][i + 1] ?? Infinity) || f < 0) continue;
        const t = { ...base, [k]: base[k].map((x, j) => (j === i ? f : x)) };
        const r = sim(encode(t), champ.frames + 500); // cap: no point simulating far past the champion
        rows.push({ key: k, i, at: base[k][i], shift: s, frames: r.finished ? r.frames : null });
      }
    }
  }
  writeFileSync(outFile, JSON.stringify({ baseline: champ.frames, delta, rows }));

  const outcome = (r) => (r.frames === null ? "dnf" : r.frames < champ.frames ? "faster" : r.frames === champ.frames ? "same" : "slower");
  for (const k of KEYS) {
    const c = { same: 0, faster: 0, slower: 0, dnf: 0 };
    rows.filter((r) => r.key === k).forEach((r) => c[outcome(r)]++);
    console.log(k.padEnd(6), JSON.stringify(c));
  }
  console.log("faster:", rows.filter((r) => outcome(r) === "faster"));
  process.exit(0); // the worker shim leaves timers running
}
