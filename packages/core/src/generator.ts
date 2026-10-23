/**
 * Seeded generative pieces: a chord walk in a chosen mode and key, voice-led string pads (each chord
 * takes the voicing with the least total movement), a phrase-arched wind melody, brass roots and a
 * jangdan percussion cycle with fills. Output is a normal PieceJson, so it goes through the same compiler
 * as the authored scores. Same seed, same piece.
 */
import { MODES, type ModeName, keyPitchClass } from './music.js';
import type { PieceJson, PhraseJson } from './piece.js';
import { mulberry32, pick, weighted, type Rng } from './rng.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pitchName = (midi: number): string => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const fmtDur = (d: number): string => {
  const thirds = Math.round(d * 3);
  if (Math.abs(d * 3 - thirds) < 1e-6 && thirds % 3 !== 0 && Math.abs(d * 2 - Math.round(d * 2)) > 1e-6) return `${thirds}/3`;
  return `${+d.toFixed(4)}`;
};

export interface GeneratorOptions {
  key?: string;
  mode?: ModeName;
  beatsPerBar?: 3 | 4;
  bpm?: number;
}

export const GEN_MODES: readonly ModeName[] = ['pyeongjo', 'gyemyeonjo', 'dorian', 'mixolydian', 'aeolian'];
export const GEN_KEYS = ['C', 'D', 'Eb', 'E', 'F', 'G', 'A', 'Bb'] as const;

const RHYTHMS: Record<3 | 4, number[][]> = {
  4: [[1, 0.5, 0.5, 2], [1, 1, 2], [0.5, 0.5, 1, 1, 1], [2, 1, 1], [1.5, 0.5, 1, 1], [1, 1, 1, 1]],
  3: [[2, 1], [1, 1, 1], [1, 0.5, 0.5, 1], [1.5, 0.5, 1], [2 / 3, 1 / 3, 1, 1]],
};
const DRUMS: Record<3 | 4, { groove: string[]; fill: string[] }> = {
  4: {
    groove: ['D:1 T:0.5 T:0.5 K:1 T:1', 'D:1 T:1 K:0.5 T:0.5 T:1', "D:1 T':0.5 T:0.5 K:1 T:1"],
    fill: ['D:1 K:0.5 T:0.5 R:1 D:1', 'D:0.5 T:0.5 K:0.5 T:0.5 R:1 D:1>'],
  },
  3: {
    groove: ['D:1 T:2/3 T:1/3 K:1', 'D:1 K:2/3 T:1/3 T:1'],
    fill: ['D:1 K:2/3 T:1/3 R:1', 'R:1 D:1 D:1>'],
  },
};

/** Scale-index arithmetic: pitch of scale index i (can be negative or above one octave). */
function scalePitch(rootPc: number, steps: readonly number[], i: number, baseOctave: number): number {
  const n = steps.length;
  const oct = Math.floor(i / n);
  const idx = ((i % n) + n) % n;
  return (baseOctave + 1 + oct) * 12 + rootPc + steps[idx];
}

function chordPcs(rootPc: number, steps: readonly number[], degree: number): number[] {
  return [0, 2, 4].map((k) => (rootPc + steps[(degree + k) % steps.length]) % 12);
}

/** Choose 3 upper voices (ascending, within range) from the chord's pitch classes, nearest to the previous voicing. */
export function voiceLead(prev: number[], pcs: number[], lo: number, hi: number, rng: Rng): number[] {
  const cands: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) cands.push(m);
  let best: number[] = [];
  let bestCost = Infinity;
  for (let a = 0; a < cands.length; a++)
    for (let b = a + 1; b < cands.length; b++)
      for (let c = b + 1; c < cands.length; c++) {
        const v = [cands[a], cands[b], cands[c]];
        const covered = new Set(v.map((x) => x % 12)).size;
        if (covered < Math.min(3, new Set(pcs).size)) continue;
        if (v[2] - v[0] > 14) continue;
        let cost = 0;
        for (let i = 0; i < 3; i++) cost += Math.abs(v[i] - prev[i]);
        cost += rng() * 0.5; // tie-break, seeded
        if (cost < bestCost) {
          bestCost = cost;
          best = v;
        }
      }
  return best;
}

export function generatePiece(seed: number, opts: GeneratorOptions = {}): PieceJson {
  const rng = mulberry32(seed);
  const mode = opts.mode ?? pick(rng, GEN_MODES);
  const key = opts.key ?? pick(rng, GEN_KEYS);
  const bpb: 3 | 4 = opts.beatsPerBar ?? weighted(rng, [[4, 3], [3, 2]] as const);
  const bpm = opts.bpm ?? Math.round(72 + rng() * 44);
  const steps = MODES[mode];
  const n = steps.length;
  const rootPc = keyPitchClass(key);

  // chord walk: tonic-anchored, moving by thirds and fourths in scale steps
  const walk = (bars: number, end: number): number[] => {
    const out = [0];
    while (out.length < bars - 1) {
      const prev = out[out.length - 1];
      const move = weighted(rng, [[2, 3], [n - 2, 3], [1, 1.5], [n - 1, 1.5], [3 % n, 1]] as const);
      out.push((prev + move) % n);
    }
    out.push(end);
    return out;
  };
  const progA = walk(8, 0);
  const progB = walk(8, Math.min(n - 1, 3)).map((d, i) => (i === 0 ? (2 % n) : d));

  let voicing = [scalePitch(rootPc, steps, 0, 3), scalePitch(rootPc, steps, 2, 3), scalePitch(rootPc, steps, 4, 3)].sort((a, b) => a - b);
  const stringsBar = (deg: number, dur: number): string => {
    voicing = voiceLead(voicing, chordPcs(rootPc, steps, deg), 52, 74, rng);
    const bass = 40 + ((rootPc + steps[deg] - 40 + 120) % 12);
    return `[${[bass, ...voicing].map(pitchName).join(' ')}]:${fmtDur(dur)}`;
  };

  // melody: arch contour, chord tone on each downbeat
  let melodyIdx = 2 * n; // scale index around the middle register
  const melodyBar = (deg: number, barInPhrase: number, phraseBars: number, sparse: boolean): string => {
    if (sparse && barInPhrase % 2 === 0) return `r:${bpb}`;
    const last = barInPhrase === phraseBars - 1;
    const rhythm = last ? [bpb] : pick(rng, RHYTHMS[bpb]);
    const rising = barInPhrase < phraseBars / 2;
    const toks: string[] = [];
    rhythm.forEach((dur, k) => {
      if (k === 0) {
        // nearest chord tone to where the line is
        const chordIdx = [deg, deg + 2, deg + 4];
        let best = melodyIdx;
        let bestD = Infinity;
        for (let o = -2; o <= 3; o++)
          for (const c of chordIdx) {
            const idx = c + o * n;
            const dd = Math.abs(idx - melodyIdx);
            if (dd < bestD) {
              bestD = dd;
              best = idx;
            }
          }
        melodyIdx = best;
      } else {
        const step = weighted(rng, [[1, 4], [2, 1.5], [-1, 3], [-2, 1]] as const) * (rising ? 1 : -1) * (rng() < 0.2 ? -1 : 1);
        melodyIdx += step;
      }
      melodyIdx = Math.max(n + 2, Math.min(3 * n + 2, melodyIdx));
      toks.push(`${pitchName(scalePitch(rootPc, steps, melodyIdx, 3))}:${fmtDur(dur)}`);
    });
    return toks.join(' ');
  };

  const brassBar = (deg: number, fanfare: boolean): string => {
    const root = scalePitch(rootPc, steps, deg, 2);
    const fifth = scalePitch(rootPc, steps, deg + 3 >= n ? deg + 3 - n : deg + 3, 2);
    if (fanfare) return bpb === 4 ? `${pitchName(root)}:1> ${pitchName(fifth)}:1 ${pitchName(root + 12)}:2` : `${pitchName(root)}:1> ${pitchName(root + 12)}:2`;
    return `${pitchName(root)}:${bpb}`;
  };

  const drums = DRUMS[bpb];
  const groove = pick(rng, drums.groove);
  const percBar = (i: number, bars: number) => (i % 4 === 3 || i === bars - 1 ? pick(rng, drums.fill) : groove);

  const phrase = (prog: number[], parts: { winds?: 'full' | 'sparse'; brass?: 'hold' | 'fanfare' }, dyn: number[]): PhraseJson => ({
    bars: prog.length,
    dyn,
    strings: prog.map((d) => stringsBar(d, bpb)).join(' | '),
    winds: parts.winds ? prog.map((d, i) => melodyBar(d, i, prog.length, parts.winds === 'sparse')).join(' | ') : undefined,
    brass: parts.brass ? prog.map((d, i) => brassBar(d, parts.brass === 'fanfare' && i % 4 === 0)).join(' | ') : undefined,
    percussion: prog.map((_, i) => percBar(i, prog.length)).join(' | '),
  });

  const introBars = bpb === 3 ? 4 : 2;
  const intro = phrase(Array.from({ length: introBars }, (_, i) => (i % 2 ? (2 % n) : 0)), {}, [0.35, 0.4, 0.45, 0.5].slice(0, introBars));
  const A = phrase(progA, { winds: 'full' }, [0.45, 0.5, 0.55, 0.55, 0.6, 0.6, 0.55, 0.5]);
  const B = phrase(progB, { winds: 'sparse', brass: 'hold' }, [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.75, 0.7]);
  const A2 = phrase(progA, { winds: 'full', brass: 'fanfare' }, [0.8, 0.85, 0.85, 0.8, 0.9, 0.85, 0.75, 0.65]);
  const codaBars = introBars;
  const tonic = [scalePitch(rootPc, steps, 0, 2), scalePitch(rootPc, steps, 0, 3), scalePitch(rootPc, steps, 2, 3), scalePitch(rootPc, steps, 4, 3), scalePitch(rootPc, steps, 0, 4)];
  const holdBars = (first: string) => [first, ...Array(codaBars - 1).fill(`~:${bpb}`)].join(' | ');
  const coda: PhraseJson = {
    bars: codaBars,
    dyn: [0.6, 0.5, 0.45, 0.4].slice(0, codaBars),
    strings: holdBars(`[${tonic.map(pitchName).join(' ')}]:${bpb}`),
    winds: holdBars(`${pitchName(scalePitch(rootPc, steps, 2 * n, 3))}:${bpb}`),
    brass: holdBars(`${pitchName(scalePitch(rootPc, steps, 0, 2))}:${bpb}`),
    percussion: [`D:1> r:${bpb - 1}`, ...Array(codaBars - 2).fill(`r:${bpb}`), `B:${bpb}`].join(' | '),
  };
  const modeTitle: Record<ModeName, string> = {
    pyeongjo: 'Pyeongjo',
    gyemyeonjo: 'Gyemyeonjo',
    dorian: 'Dorian',
    mixolydian: 'Mixolydian',
    aeolian: 'Aeolian',
  };
  return {
    id: `gen-${seed.toString(16)}`,
    title: `Daily ${key} ${modeTitle[mode]}`,
    subtitle: `Generated from seed ${seed.toString(16)}: ${key} ${mode}, ${bpb} beats, ${bpm} BPM.`,
    jangdan: bpb === 3 ? 'semachi-like (three)' : 'gutgeori-like (four)',
    key,
    mode,
    bpm,
    beatsPerBar: bpb,
    seed,
    form: ['Intro', 'A', 'B', 'A2', 'Coda'],
    phrases: { Intro: intro, A, B, A2, Coda: coda },
  };
}
