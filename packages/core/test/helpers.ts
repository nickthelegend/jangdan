import { BeatTracker, type Ictus } from '../src/beat.js';
import { gaussian, mulberry32 } from '../src/rng.js';

/** Synthetic conducting: wrist height samples at ~72 Hz with timing jitter and position noise. */
export function wristTrajectory(opts: {
  bpm: number | ((t: number) => number);
  seconds: number;
  shape?: 'sine' | 'bounce';
  amplitude?: number;
  noise?: number;
  jitter?: number;
  seed?: number;
  fps?: number;
}): { t: number; y: number }[] {
  const rng = mulberry32(opts.seed ?? 7);
  const fps = opts.fps ?? 72;
  const A = opts.amplitude ?? 0.12;
  const out: { t: number; y: number }[] = [];
  let phase = 0;
  let t = 0;
  let lastT = 0;
  while (t < opts.seconds) {
    const bpm = typeof opts.bpm === 'function' ? opts.bpm(t) : opts.bpm;
    phase += (t - lastT) * (bpm / 60);
    lastT = t;
    const p = phase * 2 * Math.PI;
    const y =
      opts.shape === 'bounce'
        ? 1.25 + A * Math.abs(Math.cos(p / 2)) // sharp bottom once per beat
        : 1.25 + A * Math.cos(p);
    out.push({ t, y: y + gaussian(rng) * (opts.noise ?? 0.002) });
    t += 1 / fps + (rng() * 2 - 1) * (opts.jitter ?? 0.0015);
  }
  return out;
}

export function runTracker(samples: { t: number; y: number }[], tracker = new BeatTracker()): { tracker: BeatTracker; ictus: Ictus[] } {
  const ictus: Ictus[] = [];
  for (const s of samples) {
    const i = tracker.push(s.t, s.y);
    if (i) ictus.push(i);
  }
  return { tracker, ictus };
}

/** A synthetic hand: wrist at `at`, fingers pointing along `dir` (unit, horizontal), palm facing `palm` (+1 down, -1 up). */
export function handJoints(opts: { curl: [number, number, number, number]; at?: [number, number, number]; palmUp?: boolean; handedness?: 'left' | 'right' }): Float32Array {
  const at = opts.at ?? [0.2, 1.0, -0.3];
  const j = new Float32Array(75);
  const set = (i: number, x: number, y: number, z: number) => {
    j[i * 3] = at[0] + x;
    j[i * 3 + 1] = at[1] + (opts.palmUp ? -y : y);
    j[i * 3 + 2] = at[2] + z;
  };
  set(0, 0, 0, 0);
  // right hand palm down, fingers along -z: thumb on -x side. Mirror x for the left hand.
  const mx = opts.handedness === 'left' ? -1 : 1;
  const flip = opts.palmUp ? -1 : 1; // palm-up rotates the hand about z: x flips too
  const X = (x: number) => x * mx * flip;
  set(1, X(-0.025), -0.01, -0.02);
  set(2, X(-0.045), -0.01, -0.045);
  set(3, X(-0.06), -0.01, -0.07);
  set(4, X(-0.07), -0.01, -0.09);
  const fingerX = [-0.022, 0, 0.02, 0.038];
  const lengths = [0.045, 0.03, 0.022, 0.02];
  for (let f = 0; f < 4; f++) {
    const base = 5 + f * 5;
    const x = X(fingerX[f]);
    set(base, x * 0.5, 0, -0.035);
    const knuckleZ = -0.09 + Math.abs(fingerX[f]) * 0.3;
    set(base + 1, x, 0, knuckleZ);
    // curl: 0 = straight along -z, 1 = folded back under the palm
    let px = 0;
    let py = 0;
    let pz = knuckleZ;
    let ang = 0;
    for (let s = 0; s < 3; s++) {
      ang += opts.curl[f] * (Math.PI / 2) * 1.05;
      py -= Math.sin(ang) * lengths[s];
      pz -= Math.cos(ang) * lengths[s];
      set(base + 2 + s, x + px, py, pz);
    }
  }
  return j;
}
