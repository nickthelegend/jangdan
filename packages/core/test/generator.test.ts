import { describe, expect, it } from 'vitest';
import { generatePiece, voiceLead } from '../src/generator.js';
import { compilePiece } from '../src/piece.js';
import { dailySeed, mulberry32 } from '../src/rng.js';
import { MODES, keyPitchClass } from '../src/music.js';

describe('generator.ts: seeded generative pieces', () => {
  it('is deterministic per seed', () => {
    for (const seed of [1, 2, 0xdeadbeef, dailySeed(new Date('2026-11-01T12:00:00Z'))]) {
      expect(JSON.stringify(generatePiece(seed))).toBe(JSON.stringify(generatePiece(seed)));
    }
  });
  it('different seeds give different pieces', () => {
    const a = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(generatePiece(i + 1).phrases)));
    expect(a.size).toBe(20);
  });
  it('every generated piece compiles, stays in its mode, and has entries to cue', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const json = generatePiece(seed);
      const p = compilePiece(json);
      const root = keyPitchClass(json.key);
      const pcs = new Set(MODES[json.mode].map((s) => (root + s) % 12));
      for (const n of p.notes) if (n.section !== 'percussion') expect(pcs.has(n.midi % 12)).toBe(true);
      expect(p.entries.length).toBeGreaterThanOrEqual(1);
      const secs = (p.totalBeats * 60) / json.bpm;
      expect(secs).toBeGreaterThan(40);
      expect(secs).toBeLessThan(110);
    }
  });
  it('the daily seed is the same all UTC day and changes the next day', () => {
    expect(dailySeed(new Date('2026-11-03T00:01:00Z'))).toBe(dailySeed(new Date('2026-11-03T23:59:00Z')));
    expect(dailySeed(new Date('2026-11-03T12:00:00Z'))).not.toBe(dailySeed(new Date('2026-11-04T12:00:00Z')));
  });
  it('voice leading picks the nearest voicing', () => {
    // C E G -> F A C: nearest is C F A (C stays, E->F, G->A)
    const v = voiceLead([60, 64, 67], [5, 9, 0], 52, 74, mulberry32(1));
    expect(v).toEqual([60, 65, 69]);
  });
});
