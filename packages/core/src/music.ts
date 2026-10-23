/** Pitch, key and mode helpers. Korean pentatonic modes plus a few heptatonic ones for the generator. */
export const MODES = {
  /** 평조 pyeongjo: sol-la-do-re-mi feel, the bright major pentatonic. */
  pyeongjo: [0, 2, 4, 7, 9],
  /** 계면조 gyemyeonjo: the plaintive minor pentatonic. */
  gyemyeonjo: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const;
export type ModeName = keyof typeof MODES;

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type KeyName = (typeof KEYS)[number];

/** Parse "C4", "F#3", "Bb5" into a MIDI number. Throws a readable error for anything else. */
export function parsePitch(token: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(token);
  if (!m) throw new Error(`not a pitch: "${token}" (expected e.g. C4, F#3, Bb5)`);
  let pc = NOTE_INDEX[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (Number(m[3]) + 1) * 12 + pc;
}

export function keyPitchClass(key: string): number {
  const m = /^([A-G])([#b]?)$/.exec(key);
  if (!m) throw new Error(`not a key: "${key}"`);
  let pc = NOTE_INDEX[m[1]];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (pc + 12) % 12;
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** All MIDI notes of a key+mode within [lo, hi], ascending. */
export function scaleNotes(key: string, mode: ModeName, lo: number, hi: number): number[] {
  const root = keyPitchClass(key);
  const steps = MODES[mode];
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) {
    const pc = (((m - root) % 12) + 12) % 12;
    if ((steps as readonly number[]).includes(pc)) out.push(m);
  }
  return out;
}

/** Scale degree (0-based, can exceed the mode length for higher octaves) to MIDI, from a base octave. */
export function degreeToMidi(key: string, mode: ModeName, degree: number, octave: number): number {
  const steps = MODES[mode];
  const n = steps.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return (octave + 1 + oct) * 12 + keyPitchClass(key) + steps[idx];
}
