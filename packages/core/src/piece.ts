/**
 * Scores. A piece is JSON: rehearsal phrases (A, B, C...) with one notation line per section, played in the
 * order given by `form`. Notation, bars separated by `|`:
 *   pitched:    C4  F#3:0.5  Bb4:1/3  [D3 A3 D4]:4  r:2  ~:4 (tie: hold the previous notes)  E5>  (accent)
 *   percussion: D (deong, both heads)  K (kung, low head)  T (deok, stick)  R (deo-reo-reo roll)  B (jing gong)
 *               T' (ghost stroke)  r (rest)
 * Durations are in beats and sticky (a token without one reuses the previous duration).
 */
import type { ModeName } from './music.js';
import { MODES, parsePitch } from './music.js';

export type SectionId = 'strings' | 'winds' | 'brass' | 'percussion';
export const SECTIONS: readonly SectionId[] = ['strings', 'winds', 'brass', 'percussion'];
export type Stroke = 'D' | 'K' | 'T' | 'R' | 'B';

export interface PhraseJson {
  bars: number;
  /** Target dynamic level (0..1) per bar for listen mode; the last value carries. */
  dyn?: number[];
  strings?: string;
  winds?: string;
  brass?: string;
  percussion?: string;
}

export interface PieceJson {
  id: string;
  title: string;
  /** One line on the card. */
  subtitle?: string;
  /** The rhythmic cycle the percussion follows. */
  jangdan: string;
  key: string;
  mode: ModeName;
  bpm: number;
  beatsPerBar: number;
  phrases: Record<string, PhraseJson>;
  form: string[];
  /** Generated pieces carry their seed. */
  seed?: number;
}

export interface NoteEvent {
  beat: number;
  section: SectionId;
  /** MIDI pitch; 0 for percussion. */
  midi: number;
  /** Duration in beats. */
  dur: number;
  /** 0..1 */
  vel: number;
  stroke?: Stroke;
  /** Rehearsal letter of the phrase this note is in, and the bar number (1-based, whole piece). */
  phrase: string;
  bar: number;
}

export interface Entry {
  section: SectionId;
  beat: number;
  bar: number;
  phrase: string;
}

export interface CompiledPiece {
  json: PieceJson;
  notes: NoteEvent[];
  totalBeats: number;
  totalBars: number;
  /** Section entrances after a rest of at least a bar: the moments a conductor cues. */
  entries: Entry[];
  /** Rehearsal marks: phrase name and starting beat, in order. */
  marks: { phrase: string; beat: number; bar: number }[];
  /** Listen-mode dynamics per bar. */
  barDynamics: number[];
}

export class ScoreError extends Error {}

const DUR_RE = /^(\d+(?:\.\d+)?)(?:\/(\d+))?$/;

function parseDur(s: string, where: string): number {
  const m = DUR_RE.exec(s);
  if (!m) throw new ScoreError(`${where}: bad duration "${s}"`);
  const v = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  if (!(v > 0)) throw new ScoreError(`${where}: duration must be > 0`);
  return v;
}

/** Split a line into tokens, keeping [chords] together. */
function tokenize(bar: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]]*\](?::[\d./]+)?>?|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bar))) out.push(m[0]);
  return out;
}

interface ParsedLine {
  notes: Omit<NoteEvent, 'phrase' | 'bar' | 'section'>[];
  bars: number;
  barOfNote: number[];
}

export function parseLine(line: string, section: SectionId, beatsPerBar: number, where: string): ParsedLine {
  const bars = line
    .split('|')
    .map((b) => b.trim())
    .filter((b, i, arr) => !(b === '' && (i === arr.length - 1 || i === 0)));
  const notes: ParsedLine['notes'] = [];
  const barOfNote: number[] = [];
  let beat = 0;
  let dur = 1;
  let last: number[] = []; // indices of the notes the previous token started
  bars.forEach((bar, bi) => {
    const barStart = bi * beatsPerBar;
    if (Math.abs(beat - barStart) > 1e-6) throw new ScoreError(`${where}: bar ${bi} starts at beat ${beat}, expected ${barStart}`);
    for (const tok of tokenize(bar)) {
      const accent = tok.endsWith('>');
      let body = accent ? tok.slice(0, -1) : tok;
      let ghost = false;
      if (section === 'percussion' && body.includes("'")) {
        ghost = true;
        body = body.replace("'", '');
      }
      let head = body;
      const colon = body.lastIndexOf(':');
      if (colon > 0 && !body.endsWith(']')) {
        head = body.slice(0, colon);
        dur = parseDur(body.slice(colon + 1), `${where} bar ${bi + 1} "${tok}"`);
      }
      const vel = accent ? 1 : ghost ? 0.4 : 0.72;
      if (head === 'r') {
        last = [];
      } else if (head === '~') {
        if (last.length === 0) throw new ScoreError(`${where} bar ${bi + 1}: tie "~" with nothing to hold`);
        for (const i of last) notes[i].dur += dur;
      } else if (section === 'percussion') {
        if (!/^[DKTRB]$/.test(head)) throw new ScoreError(`${where} bar ${bi + 1}: unknown stroke "${head}" (use D K T R B r)`);
        last = [notes.length];
        notes.push({ beat, midi: 0, dur, vel, stroke: head as Stroke });
        barOfNote.push(bi);
      } else {
        const pitches = head.startsWith('[') ? head.slice(1, -1).trim().split(/\s+/) : [head];
        last = [];
        for (const p of pitches) {
          let midi: number;
          try {
            midi = parsePitch(p);
          } catch (e) {
            throw new ScoreError(`${where} bar ${bi + 1}: ${(e as Error).message}`);
          }
          last.push(notes.length);
          notes.push({ beat, midi, dur, vel });
          barOfNote.push(bi);
        }
      }
      beat += dur;
    }
    const end = (bi + 1) * beatsPerBar;
    if (Math.abs(beat - end) > 1e-6) {
      throw new ScoreError(`${where} bar ${bi + 1}: has ${+(beat - barStart).toFixed(4)} beats, expected ${beatsPerBar}`);
    }
    beat = end;
  });
  return { notes, bars: bars.length, barOfNote };
}

export function compilePiece(json: PieceJson): CompiledPiece {
  if (!(json.beatsPerBar >= 2 && json.beatsPerBar <= 6)) throw new ScoreError(`${json.id}: beatsPerBar must be 2..6`);
  if (!(json.bpm >= 60 && json.bpm <= 160)) throw new ScoreError(`${json.id}: bpm must be 60..160`);
  if (!(json.mode in MODES)) throw new ScoreError(`${json.id}: unknown mode ${json.mode}`);
  const bpb = json.beatsPerBar;
  const notes: NoteEvent[] = [];
  const marks: CompiledPiece['marks'] = [];
  const barDynamics: number[] = [];
  let barCursor = 0;
  json.form.forEach((name, fi) => {
    const ph = json.phrases[name];
    if (!ph) throw new ScoreError(`${json.id}: form[${fi}] names unknown phrase "${name}"`);
    const startBeat = barCursor * bpb;
    marks.push({ phrase: name, beat: startBeat, bar: barCursor + 1 });
    for (const section of SECTIONS) {
      const line = ph[section];
      if (!line || !line.trim()) continue;
      const parsed = parseLine(line, section, bpb, `${json.id} ${name} ${section}`);
      if (parsed.bars !== ph.bars) {
        throw new ScoreError(`${json.id} ${name} ${section}: ${parsed.bars} bars, phrase has ${ph.bars}`);
      }
      parsed.notes.forEach((n, i) => {
        notes.push({ ...n, beat: n.beat + startBeat, section, phrase: name, bar: barCursor + parsed.barOfNote[i] + 1 });
      });
    }
    for (let b = 0; b < ph.bars; b++) {
      const d = ph.dyn && ph.dyn.length ? ph.dyn[Math.min(b, ph.dyn.length - 1)] : 0.55;
      barDynamics.push(d);
    }
    barCursor += ph.bars;
  });
  notes.sort((a, b) => a.beat - b.beat || SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.midi - b.midi);
  const totalBeats = barCursor * bpb;
  return { json, notes, totalBeats, totalBars: barCursor, entries: findEntries(notes, bpb), marks, barDynamics };
}

/** An entry is a section's first note after at least one silent bar (the downbeat at beat 0 doesn't need a cue). */
export function findEntries(notes: readonly NoteEvent[], beatsPerBar: number): Entry[] {
  const out: Entry[] = [];
  const soundingUntil: Record<SectionId, number> = { strings: 0, winds: 0, brass: 0, percussion: 0 };
  const seen: Record<SectionId, boolean> = { strings: false, winds: false, brass: false, percussion: false };
  for (const n of notes) {
    const gap = n.beat - soundingUntil[n.section];
    if (n.beat > 0 && (!seen[n.section] || gap >= beatsPerBar - 1e-6)) {
      if (!out.some((e) => e.section === n.section && Math.abs(e.beat - n.beat) < 1e-6)) {
        out.push({ section: n.section, beat: n.beat, bar: n.bar, phrase: n.phrase });
      }
    }
    seen[n.section] = true;
    soundingUntil[n.section] = Math.max(soundingUntil[n.section], n.beat + n.dur);
  }
  return out;
}

/** Listen-mode dynamic level at a (fractional) beat: linear between bar targets. */
export function dynamicsAt(piece: CompiledPiece, beat: number): number {
  const bpb = piece.json.beatsPerBar;
  const d = piece.barDynamics;
  if (d.length === 0) return 0.55;
  const x = Math.max(0, beat / bpb - 0.5);
  const i = Math.min(d.length - 1, Math.floor(x));
  const j = Math.min(d.length - 1, i + 1);
  const t = Math.min(1, x - i);
  return d[i] + (d[j] - d[i]) * t;
}

/** The rehearsal letter label for a phrase index ("A", "B", ...), used on the score ring and landing page. */
export function rehearsalLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
