import { describe, expect, it } from 'vitest';
import { compilePiece, dynamicsAt, parseLine, ScoreError } from '../src/piece.js';
import { PIECES } from '../src/pieces/index.js';

describe('piece.ts: the three authored scores', () => {
  it('ships three pieces', () => expect(PIECES.length).toBe(3));
  for (const json of PIECES) {
    it(`${json.id}: compiles, is 60–90 s at its tempo, uses all four sections and has cue entries`, () => {
      const p = compilePiece(json);
      const seconds = (p.totalBeats * 60) / json.bpm;
      expect(seconds).toBeGreaterThanOrEqual(60);
      expect(seconds).toBeLessThanOrEqual(90);
      for (const s of ['strings', 'winds', 'brass', 'percussion']) expect(p.notes.some((n) => n.section === s)).toBe(true);
      expect(p.entries.length).toBeGreaterThanOrEqual(2);
      expect(p.marks.map((m) => m.phrase)).toEqual(json.form);
      expect(p.barDynamics.length).toBe(p.totalBars);
      for (const n of p.notes) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat + n.dur).toBeLessThanOrEqual(p.totalBeats + 1e-9);
      }
    });
  }

  it('hanji-light: winds are cued at A and brass at B', () => {
    const p = compilePiece(PIECES[0]);
    expect(p.entries.find((e) => e.section === 'winds')!.phrase).toBe('A');
    expect(p.entries.find((e) => e.section === 'brass')!.phrase).toBe('B');
  });

  it('parses chords, ties, rests, thirds and accents', () => {
    const r = parseLine('[C4 E4 G4]:2 ~:1 r:1 | D4:2/3 E4:1/3 F4:1 G4> r', 'strings', 4, 't');
    expect(r.notes.length).toBe(7);
    expect(r.notes[0].dur).toBe(3);
    expect(r.notes[3].dur).toBeCloseTo(2 / 3);
    expect(r.notes[6].vel).toBe(1);
    expect(r.notes[6].beat).toBe(6);
    const perc = parseLine("D:1 T':0.5 T:0.5 R:1 B:1", 'percussion', 4, 'p');
    expect(perc.notes.map((n) => n.stroke)).toEqual(['D', 'T', 'T', 'R', 'B']);
    expect(perc.notes[1].vel).toBeLessThan(0.5);
  });

  it('rejects a bar of the wrong length with a readable message', () => {
    expect(() => parseLine('C4:1 D4:1 E4:1', 'winds', 4, 'x A winds')).toThrow(ScoreError);
    expect(() => parseLine('C4:1 D4:1 E4:1', 'winds', 4, 'x A winds')).toThrow(/bar 1: has 3 beats, expected 4/);
    expect(() => parseLine('H4:4', 'winds', 4, 'x')).toThrow(/not a pitch/);
    expect(() => parseLine('X:4', 'percussion', 4, 'x')).toThrow(/unknown stroke/);
  });

  it('listen-mode dynamics follow the bar targets', () => {
    const p = compilePiece(PIECES[0]);
    expect(dynamicsAt(p, 0)).toBeCloseTo(p.barDynamics[0]);
    expect(dynamicsAt(p, p.totalBeats)).toBeCloseTo(p.barDynamics[p.barDynamics.length - 1]);
  });
});
