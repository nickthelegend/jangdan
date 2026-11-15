/**
 * The light show's rules, pure and testable: how loud a note looks, where on its surface it lands, how
 * far the colour floods at each dynamic, how the beat flashes every surface, and how big text must be to
 * stay readable at a given distance. The app's shaders and HUD read these numbers; nothing here touches
 * the DOM or WebGL.
 */
import { clamp, smoothstep } from './math.js';
import type { SectionId, Stroke } from './piece.js';
import { PALETTE } from './voices.js';

/**
 * Emission colour per section: the same Obangsaek hue as the brand colour, lifted so it reads as light
 * on a lit wall (the brand blue #1f4fbf is too dark to show up additively over passthrough).
 */
export const LIGHT_COLOR: Record<SectionId, string> = {
  strings: '#3f7bff',
  winds: '#ffc21a',
  brass: '#ff3d2e',
  percussion: '#fff1d6',
};

/** UI colours for each section stay the brand palette. */
export const UI_COLOR: Record<SectionId, string> = {
  strings: PALETTE.blue,
  winds: PALETTE.yellow,
  brass: PALETTE.red,
  percussion: PALETTE.hanji,
};

/** How far (as a fraction of the surface's half-diagonal) the steady colour floods: a pool at pp, the whole surface at ff. */
export function floodCoverage(dyn: number): number {
  return 0.3 + 1.1 * clamp(dyn, 0, 1);
}

/** Brightness of the steady flood at a dynamic level: dim at pp, bright at ff. */
export function floodGain(dyn: number): number {
  return 0.45 + 1.15 * clamp(dyn, 0, 1);
}

/** Strength of one note's bloom: louder notes and louder dynamics bloom brighter; calm light caps it. */
export function bloomStrength(vel: number, dyn: number, section: SectionId, calm: boolean): number {
  const base = clamp(vel, 0, 1.2) * (0.55 + 0.9 * clamp(dyn, 0, 1)) * (section === 'percussion' ? 1.15 : 1);
  return Math.min(calm ? 0.45 : 1.6, calm ? base * 0.35 : base);
}

/**
 * How fast (m/s) a note's ring travels so it sweeps the whole surface: about 0.85 s to the far edge,
 * never slower than 1.4 m/s on a small table.
 */
export function bloomSpeed(halfDiagonal: number): number {
  return Math.max(1.4, (2 * halfDiagonal) / 0.85);
}

/** Seconds a bloom stays visible (the shader drops older ones). */
export const BLOOM_LIFE = 1.6;

/** Radius (m) of a note's bloom ring `age` seconds after its onset. */
export function bloomRadius(age: number, halfDiagonal: number): number {
  return age <= 0 ? 0 : age * bloomSpeed(halfDiagonal);
}

/**
 * Where on its surface a note blooms (surface-local x, z): pitch runs low to high across the surface's
 * width, so a rising line climbs across the wall; janggu strokes land left (kung), right (deok) or both.
 */
export function notePosition(
  section: SectionId,
  midi: number,
  stroke: Stroke | undefined,
  time: number,
  center: { x: number; y: number },
  half: { x: number; y: number },
): [number, number] {
  let x = center.x;
  let z = center.y;
  if (section === 'percussion') {
    const h = Math.sin(time * 91.7) * 0.5;
    if (stroke === 'T' || stroke === 'R') {
      x += h * half.x;
      z += Math.cos(time * 57.3) * 0.4 * half.y;
    } else if (stroke === 'K') x -= 0.35 * half.x;
    else if (stroke === 'D') x += 0.35 * half.x;
  } else {
    const u = clamp((midi - 38) / 48, 0, 1);
    x += (u - 0.5) * 1.5 * half.x;
    z += Math.sin(midi * 1.7) * 0.35 * half.y;
  }
  return [clamp(x, center.x - half.x, center.x + half.x), clamp(z, center.y - half.y, center.y + half.y)];
}

/**
 * The beat flash: every surface's frame lights on each beat of the music and decays in 0.15 s, so the
 * tempo is visible as the flash rate. The downbeat flashes hardest.
 */
export function beatFlash(beatPhase: number, beatInBar: number, bpm: number): number {
  if (!(bpm > 0)) return 0;
  const sinceBeat = clamp(beatPhase, 0, 1) * (60 / bpm);
  return Math.exp(-sinceBeat / 0.15) * (beatInBar === 0 ? 1 : 0.6);
}

/** Where the bar's sweep line is across a surface, 0 (left edge) .. 1 (right edge). */
export function barSweep(beatInBar: number, beatPhase: number, beatsPerBar: number): number {
  return clamp((beatInBar + clamp(beatPhase, 0, 1)) / Math.max(1, beatsPerBar), 0, 1);
}

/** Tempo against the written tempo, in words the HUD can show. */
export function tempoTrend(bpm: number, written: number): { delta: number; word: string } {
  const delta = Math.round(bpm - written);
  if (!(bpm > 0) || !(written > 0)) return { delta: 0, word: '' };
  if (Math.abs(delta) < 4) return { delta, word: 'a tempo' };
  return { delta, word: delta > 0 ? `faster +${delta}` : `slower ${delta}` };
}

/** A hand's recent path (the baton trail): a fixed ring buffer of timed points. */
export class Trail {
  private readonly t: Float64Array;
  private readonly p: Float32Array;
  private head = 0;
  private count = 0;
  constructor(readonly capacity = 64) {
    this.t = new Float64Array(capacity);
    this.p = new Float32Array(capacity * 3);
  }
  push(time: number, x: number, y: number, z: number): void {
    this.t[this.head] = time;
    this.p.set([x, y, z], this.head * 3);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }
  clear(): void {
    this.count = 0;
  }
  /** Points newer than `window` seconds, oldest first, each with its age in seconds. */
  recent(now: number, window: number): { x: number; y: number; z: number; age: number }[] {
    const out: { x: number; y: number; z: number; age: number }[] = [];
    for (let i = this.count; i >= 1; i--) {
      const k = (this.head - i + this.capacity) % this.capacity;
      const age = now - this.t[k];
      if (age <= window && age >= 0) out.push({ x: this.p[k * 3], y: this.p[k * 3 + 1], z: this.p[k * 3 + 2], age });
    }
    return out;
  }
}

/** Legibility floor: body text cap height at least 18 mm for every metre of viewing distance. */
export const MIN_CAP_PER_METRE = 0.018;

/** Cap-height-to-font-size ratio of the brand fonts (Familjen Grotesk ~0.70, Kode Mono ~0.72). */
export const CAP_RATIO = 0.7;

/** Cap height in metres of `fontPx` text on a canvas `canvasPx` wide drawn on a quad `metersW` wide. */
export function capHeight(fontPx: number, canvasPx: number, metersW: number, capRatio = CAP_RATIO): number {
  return (fontPx * capRatio * metersW) / canvasPx;
}

/** Cap height scaled to its 1 m equivalent (what the 18 mm rule is written for). */
export function capAtOneMetre(cap: number, distance: number): number {
  return distance > 0 ? cap / distance : Infinity;
}

/** Quad width (m) that keeps `fontPx` text on a `canvasPx` canvas at `capPerMetre` for a reader `distance` m away. */
export function quadWidthFor(distance: number, fontPx: number, canvasPx: number, capPerMetre = MIN_CAP_PER_METRE * 1.15): number {
  return (capPerMetre * Math.max(distance, 0.3) * canvasPx) / (fontPx * CAP_RATIO);
}

/** Smooth 0..1 envelope for UI that grows in when shown (count-in numbers, results). */
export function popIn(age: number, duration = 0.25): number {
  return smoothstep(0, duration, age);
}
