/**
 * Room-derived reverb. The bounding box of the detected surfaces gives the room's dimensions; Sabine's
 * formula (RT60 = 0.161 V / (S a)) gives the decay time; the impulse response is generated in code:
 * first-order early reflections from the three room dimensions, then a seeded, decorrelated stereo noise
 * tail that decays at the RT60 and darkens over time. Small room: short and dry. Big room: long and wet.
 */
import { clamp } from './math.js';
import { mulberry32 } from './rng.js';
import type { Surface } from './stage.js';

export interface RoomSize {
  dims: [number, number, number];
  volume: number;
  surfaceArea: number;
  /** False when there were too few surfaces and a default room was assumed. */
  measured: boolean;
}

export const DEFAULT_ROOM: RoomSize = { dims: [4, 2.6, 4], volume: 41.6, surfaceArea: 2 * (16 + 10.4 + 10.4), measured: false };

/**
 * Room box from the surfaces. Height comes from the floor/ceiling planes when both exist; the horizontal
 * extent from wall positions (along their normals) and from every surface's half-size along its in-plane axes.
 */
export function roomFromSurfaces(surfaces: readonly Surface[]): RoomSize {
  if (surfaces.length < 2) return DEFAULT_ROOM;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const grow = (i: number, a: number, b: number) => {
    lo[i] = Math.min(lo[i], a);
    hi[i] = Math.max(hi[i], b);
  };
  const horizontals = surfaces.filter((s) => s.orientation === 'horizontal');
  const hy = horizontals.map((s) => s.center[1]);
  const heightFromPlanes = hy.length >= 2 && Math.max(...hy) - Math.min(...hy) > 1.8;
  for (const s of surfaces) {
    const r = Math.sqrt(s.area) / 2;
    for (const i of [0, 2]) {
      const pad = Math.abs(s.normal[i]) > 0.7 ? 0 : r;
      grow(i, s.center[i] - pad, s.center[i] + pad);
    }
    if (heightFromPlanes) {
      if (s.orientation === 'horizontal') grow(1, s.center[1], s.center[1]);
    } else {
      const pad = s.orientation === 'vertical' ? r : 0;
      grow(1, s.center[1] - pad, s.center[1] + pad);
    }
  }
  const dims: [number, number, number] = [
    clamp(hi[0] - lo[0], 1.5, 40),
    clamp(hi[1] - lo[1], 2.2, 15),
    clamp(hi[2] - lo[2], 1.5, 40),
  ];
  const [w, h, d] = dims;
  return { dims, volume: w * h * d, surfaceArea: 2 * (w * d + w * h + h * d), measured: true };
}

export interface ReverbParams {
  rt60: number;
  /** Seconds before the first reflection (mean free path / c). */
  preDelay: number;
  /** Dry/wet send level 0..1. */
  wet: number;
  /** IR length in seconds. */
  length: number;
  /** Early reflection delays (s) and gains. */
  early: { t: number; g: number }[];
}

/** Average absorption of a furnished room: lively enough that rooms sound different. */
export const ABSORPTION = 0.14;
const C = 343;

export function reverbParams(room: RoomSize): ReverbParams {
  const rt60 = clamp((0.161 * room.volume) / (room.surfaceArea * ABSORPTION), 0.25, 3.5);
  const mfp = (4 * room.volume) / room.surfaceArea;
  const preDelay = clamp(mfp / C, 0.002, 0.06);
  const wet = clamp(0.1 + 0.22 * Math.log10(room.volume / 10), 0.08, 0.5);
  const early = room.dims.flatMap((dim, i) => [
    { t: dim / C, g: 0.55 / (1 + i * 0.2) },
    { t: (2 * dim) / C, g: 0.3 / (1 + i * 0.2) },
  ]);
  early.sort((a, b) => a.t - b.t);
  return { rt60, preDelay, wet, length: rt60 * 1.15 + preDelay, early };
}

/** Generate a stereo IR. Deterministic for a seed. */
export function generateIR(p: ReverbParams, sampleRate: number, seed = 1): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(p.length * sampleRate));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rngL = mulberry32(seed);
  const rngR = mulberry32(seed ^ 0x9e3779b9);
  const pre = Math.round(p.preDelay * sampleRate);
  const k = 6.907755 / p.rt60; // ln(1000): -60 dB at rt60
  let lpL = 0;
  let lpR = 0;
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sampleRate;
    const env = Math.exp(-k * t);
    // the tail darkens: the low-pass coefficient falls with time
    const a = clamp(0.85 - 0.6 * (t / p.rt60), 0.12, 0.85);
    lpL += a * (rngL() * 2 - 1 - lpL);
    lpR += a * (rngR() * 2 - 1 - lpR);
    const fadeIn = Math.min(1, t / 0.01);
    L[i] = lpL * env * fadeIn * 0.5;
    R[i] = lpR * env * fadeIn * 0.5;
  }
  for (const e of p.early) {
    const i = Math.round(e.t * sampleRate);
    if (i < n) {
      L[i] += e.g * 0.6;
      R[Math.min(n - 1, i + Math.round(0.0007 * sampleRate))] += e.g * 0.6;
    }
  }
  return [L, R];
}
