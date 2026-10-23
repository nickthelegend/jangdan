/**
 * The togetherness score for a take: how steady the beat was, how well cues landed on the entries,
 * and how much dynamic range the conductor used. Plus the take record that ghost replay plays back.
 */
import { clamp, mean, median, percentile } from './math.js';
import type { SectionId } from './piece.js';

export interface CueRecord {
  section: SectionId;
  /** Beat the cue happened on. */
  beat: number;
  /** The entry it was matched to, or null. */
  entryBeat: number | null;
}

export interface TakeRecord {
  pieceId: string;
  mode: 'conduct' | 'listen';
  /** Ictus times (s, AudioContext clock) while the music played. */
  ictus: number[];
  /** Tempo per beat: [beat, bpm]. */
  tempo: [number, number][];
  /** Dynamics per beat: [beat, level 0..1]. */
  dyn: [number, number][];
  cues: CueRecord[];
  /** Entries that came up before the cut-off: [section, beat]. */
  entries: [SectionId, number][];
  /** True if the piece reached its last bar before the cut-off. */
  completed: boolean;
  /** ISO date. */
  date: string;
}

export interface TogethernessScore {
  steadiness: number;
  cueTiming: number;
  dynamicRange: number;
  total: number;
}

/** Steadiness: 1 minus the mean local relative deviation of intervals (each vs the median of its 4 neighbours), 15% = 0. */
export function steadiness(ictus: readonly number[]): number {
  if (ictus.length < 4) return 0;
  const iv: number[] = [];
  for (let i = 1; i < ictus.length; i++) iv.push(ictus[i] - ictus[i - 1]);
  const devs: number[] = [];
  for (let i = 0; i < iv.length; i++) {
    // neighbours only (not itself), so an alternating long-short beat can't hide behind its own median
    const win = [...iv.slice(Math.max(0, i - 2), i), ...iv.slice(i + 1, Math.min(iv.length, i + 3))];
    const m = median(win);
    devs.push(Math.abs(iv[i] - m) / m);
  }
  return clamp(1 - mean(devs) / 0.15, 0, 1);
}

/** Cue timing: each entry scores 1 - |delta|/2 for a cue within [-2, +1] beats of it, 0 if missed. */
export function cueTiming(cues: readonly CueRecord[], entries: readonly [SectionId, number][]): number {
  if (entries.length === 0) return 1;
  let total = 0;
  for (const [section, beat] of entries) {
    let best = 0;
    for (const c of cues) {
      if (c.section !== section) continue;
      const d = c.beat - beat;
      if (d >= -2 && d <= 1) best = Math.max(best, 1 - Math.abs(d) / 2);
    }
    total += best;
  }
  return total / entries.length;
}

export function dynamicRange(dyn: readonly [number, number][]): number {
  if (dyn.length < 2) return 0;
  const v = dyn.map((d) => d[1]);
  return clamp((percentile(v, 0.95) - percentile(v, 0.05)) / 0.55, 0, 1);
}

export function scoreTake(t: TakeRecord): TogethernessScore {
  const s = steadiness(t.ictus);
  const c = cueTiming(t.cues, t.entries);
  const r = dynamicRange(t.dyn);
  return { steadiness: s, cueTiming: c, dynamicRange: r, total: Math.round(100 * (0.45 * s + 0.3 * c + 0.25 * r)) };
}

/** Sample a [beat, value] series at a beat (step-wise, holding the last value). */
export function seriesAt(series: readonly [number, number][], beat: number, fallback: number): number {
  if (series.length === 0) return fallback;
  let v = series[0][1];
  for (const [b, x] of series) {
    if (b > beat) break;
    v = x;
  }
  return v;
}
