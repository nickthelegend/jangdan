/**
 * The four light-orchestra voices, as data the Web Audio synth reads, plus the obangsaek palette.
 * Strings: a two-oscillator detuned wavetable with slow attack and delayed vibrato. Winds: soft FM
 * (ratio 1, low index) with a breath noise. Brass: FM with a ratio-1 bright index envelope (the blat).
 * Percussion: a janggu, synthesised (membrane pitch-drop for kung, filtered click for deok).
 */
import type { SectionId } from './piece.js';

export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface WavetableVoice {
  kind: 'wavetable';
  /** Harmonic amplitudes for a PeriodicWave (index 0 = fundamental). */
  harmonics: number[];
  detuneCents: number;
  env: Envelope;
  vibrato: { rate: number; depthCents: number; delay: number };
  /** Low-pass cutoff = fundamental x (lo + (hi - lo) x level). */
  brightness: { lo: number; hi: number };
  gain: number;
}

export interface FmVoice {
  kind: 'fm';
  ratio: number;
  /** Modulation index at pp and at ff, and how fast it falls to `sustainIndex` of itself. */
  index: { pp: number; ff: number; decay: number; sustain: number };
  env: Envelope;
  vibrato: { rate: number; depthCents: number; delay: number };
  breath: number;
  gain: number;
}

export interface DrumVoice {
  kind: 'drum';
  /** kung: low membrane. */
  low: { startHz: number; endHz: number; drop: number; decay: number };
  /** deok: stick on the high head. */
  high: { bandHz: number; q: number; decay: number };
  gain: number;
}

export type Voice = WavetableVoice | FmVoice | DrumVoice;

export const VOICES: Record<SectionId, Voice> = {
  strings: {
    kind: 'wavetable',
    harmonics: [1, 0.52, 0.36, 0.22, 0.17, 0.11, 0.08, 0.05, 0.04, 0.025, 0.018, 0.012],
    detuneCents: 7,
    env: { attack: 0.18, decay: 0.4, sustain: 0.8, release: 0.45 },
    vibrato: { rate: 5.2, depthCents: 9, delay: 0.35 },
    brightness: { lo: 2.2, hi: 9 },
    gain: 0.11,
  },
  winds: {
    kind: 'fm',
    ratio: 1,
    index: { pp: 0.6, ff: 2.2, decay: 0.25, sustain: 0.7 },
    env: { attack: 0.06, decay: 0.2, sustain: 0.85, release: 0.18 },
    vibrato: { rate: 5.6, depthCents: 14, delay: 0.25 },
    breath: 0.05,
    gain: 0.16,
  },
  brass: {
    kind: 'fm',
    ratio: 1,
    index: { pp: 1.2, ff: 5.5, decay: 0.12, sustain: 0.55 },
    env: { attack: 0.045, decay: 0.15, sustain: 0.75, release: 0.22 },
    vibrato: { rate: 4.8, depthCents: 6, delay: 0.5 },
    breath: 0.015,
    gain: 0.14,
  },
  percussion: {
    kind: 'drum',
    low: { startHz: 150, endHz: 62, drop: 0.08, decay: 0.42 },
    high: { bandHz: 2400, q: 1.6, decay: 0.07 },
    gain: 0.5,
  },
};

/** Obangsaek (five directions) colours: one per section plus white. */
export const PALETTE = {
  ink: '#121014',
  hanji: '#f4efe6',
  blue: '#1f4fbf',
  red: '#d6322b',
  yellow: '#f2b705',
  white: '#ffffff',
} as const;

export const SECTION_COLOR: Record<SectionId, string> = {
  strings: PALETTE.blue,
  winds: PALETTE.yellow,
  brass: PALETTE.red,
  percussion: PALETTE.white,
};

export const SECTION_LABEL: Record<SectionId, string> = {
  strings: 'Strings',
  winds: 'Winds',
  brass: 'Brass',
  percussion: 'Janggu',
};

/** ADSR value at time t after note-on for a note held `held` seconds (for tests and the light washes). */
export function envelopeAt(env: Envelope, t: number, held: number): number {
  const sustainLevel = (tt: number) => {
    if (tt < env.attack) return tt / env.attack;
    const d = tt - env.attack;
    if (d < env.decay) return 1 - (1 - env.sustain) * (d / env.decay);
    return env.sustain;
  };
  if (t < 0) return 0;
  if (t <= held) return sustainLevel(t);
  const lv = sustainLevel(held);
  const r = t - held;
  return r >= env.release ? 0 : lv * (1 - r / env.release);
}
