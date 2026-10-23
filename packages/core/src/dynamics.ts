/** Dynamics from the left palm's height, pp..ff, smoothed. */
import { clamp } from './math.js';

export const DYNAMIC_MARKS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const;
export type DynamicMark = (typeof DYNAMIC_MARKS)[number];

export interface DynamicsCalibration {
  /** Palm height relative to the head that means pp (m, negative = below the eyes). */
  low: number;
  /** Palm height relative to the head that means ff. */
  high: number;
}

/** Seated defaults: palm resting near the lap is pp, palm at eye level is ff. */
export const DEFAULT_DYNAMICS_CAL: DynamicsCalibration = { low: -0.6, high: -0.02 };

export function levelFromPalmHeight(palmY: number, headY: number, cal = DEFAULT_DYNAMICS_CAL): number {
  return clamp((palmY - headY - cal.low) / (cal.high - cal.low), 0, 1);
}

export function markForLevel(level: number): DynamicMark {
  const i = clamp(Math.floor(level * DYNAMIC_MARKS.length), 0, DYNAMIC_MARKS.length - 1);
  return DYNAMIC_MARKS[i];
}

/** Lowest level that reads as the given mark. */
export function levelForMark(mark: DynamicMark): number {
  return DYNAMIC_MARKS.indexOf(mark) / DYNAMIC_MARKS.length;
}

/** Linear gain for a level: -30 dB at pp to 0 dB at ff. */
export function gainForLevel(level: number): number {
  return Math.pow(10, (clamp(level, 0, 1) * 30 - 30) / 20);
}

/** One-pole smoother with a time constant in seconds. */
export class Smoother {
  value: number;
  constructor(
    initial: number,
    public tau = 0.25,
  ) {
    this.value = initial;
  }
  update(target: number, dt: number): number {
    if (dt > 0) this.value += (1 - Math.exp(-dt / this.tau)) * (target - this.value);
    return this.value;
  }
}
