import { describe, expect, it } from 'vitest';
import {
  barSweep,
  beatFlash,
  bloomRadius,
  bloomSpeed,
  bloomStrength,
  BLOOM_LIFE,
  capAtOneMetre,
  capHeight,
  floodCoverage,
  floodGain,
  LIGHT_COLOR,
  MIN_CAP_PER_METRE,
  notePosition,
  quadWidthFor,
  tempoTrend,
  Trail,
} from '../src/lightshow.js';
import { SECTIONS } from '../src/piece.js';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

describe('lightshow.ts: the light follows the music', () => {
  it('every section emits a light colour bright enough to read over a lit wall', () => {
    for (const s of SECTIONS) expect(lum(LIGHT_COLOR[s])).toBeGreaterThan(0.25);
  });

  it('dynamics: the flood grows from a pool at pp to the whole surface at ff, and brightens', () => {
    expect(floodCoverage(0)).toBeLessThan(0.4);
    expect(floodCoverage(1)).toBeGreaterThan(1.2);
    expect(floodGain(1) / floodGain(0)).toBeGreaterThan(3);
    for (let d = 0; d < 1; d += 0.1) {
      expect(floodCoverage(d + 0.1)).toBeGreaterThan(floodCoverage(d));
      expect(floodGain(d + 0.1)).toBeGreaterThan(floodGain(d));
    }
  });

  it('a louder note at a louder dynamic blooms brighter; calm light caps every bloom', () => {
    expect(bloomStrength(0.9, 1, 'strings', false)).toBeGreaterThan(bloomStrength(0.9, 0.1, 'strings', false) * 2);
    expect(bloomStrength(1, 1, 'brass', false)).toBeGreaterThan(bloomStrength(0.4, 1, 'brass', false));
    for (const s of SECTIONS) expect(bloomStrength(1.2, 1, s, true)).toBeLessThanOrEqual(0.45);
  });

  it("a note's ring crosses its whole surface within the bloom's life", () => {
    for (const half of [0.4, 1.2, 2.5, 4]) {
      // from the centre, the ring reaches the farthest corner (one half-diagonal) before it fades
      expect(bloomRadius(BLOOM_LIFE * 0.75, half)).toBeGreaterThanOrEqual(half);
    }
    expect(bloomSpeed(0.3)).toBe(1.4);
    expect(bloomRadius(0, 2)).toBe(0);
  });

  it('notes land inside the surface; pitch climbs across it; janggu strokes split left and right', () => {
    const c = { x: 0.2, y: -0.1 };
    const h = { x: 1.8, y: 1.2 };
    let prevX = -Infinity;
    for (let midi = 30; midi <= 100; midi += 5) {
      const [x, z] = notePosition('strings', midi, undefined, 1, c, h);
      expect(x).toBeGreaterThanOrEqual(c.x - h.x);
      expect(x).toBeLessThanOrEqual(c.x + h.x);
      expect(Math.abs(z - c.y)).toBeLessThanOrEqual(h.y);
      expect(x).toBeGreaterThanOrEqual(prevX);
      prevX = x;
    }
    const [kx] = notePosition('percussion', 0, 'K', 2, c, h);
    const [dx] = notePosition('percussion', 0, 'D', 2, c, h);
    expect(kx).toBeLessThan(c.x);
    expect(dx).toBeGreaterThan(c.x);
  });

  it('the beat flash fires on every beat, hardest on the downbeat, and is gone before the next beat', () => {
    expect(beatFlash(0, 0, 96)).toBeCloseTo(1, 5);
    expect(beatFlash(0, 2, 96)).toBeCloseTo(0.6, 5);
    expect(beatFlash(0.9, 1, 96)).toBeLessThan(0.02);
    // the flash lasts the same time at any tempo, so a faster tempo means more flashes per second
    expect(beatFlash(0.2, 0, 120)).toBeGreaterThan(beatFlash(0.2, 0, 60));
    expect(beatFlash(0, 0, 0)).toBe(0);
  });

  it('the bar sweep crosses each surface once per bar', () => {
    expect(barSweep(0, 0, 4)).toBe(0);
    expect(barSweep(2, 0, 4)).toBe(0.5);
    expect(barSweep(3, 1, 4)).toBe(1);
    expect(barSweep(1, 0.5, 3)).toBeCloseTo(0.5, 5);
  });

  it('tempo against the written tempo reads in words', () => {
    expect(tempoTrend(90, 88).word).toBe('a tempo');
    expect(tempoTrend(118, 92)).toEqual({ delta: 26, word: 'faster +26' });
    expect(tempoTrend(70, 88)).toEqual({ delta: -18, word: 'slower -18' });
    expect(tempoTrend(0, 88).word).toBe('');
  });

  it('the baton trail keeps the last points in order and drops old ones', () => {
    const t = new Trail(8);
    for (let i = 0; i < 12; i++) t.push(i * 0.1, i, 0, 0);
    const r = t.recent(1.1, 0.35);
    expect(r.map((p) => p.x)).toEqual([8, 9, 10, 11]);
    expect(r[0].age).toBeCloseTo(0.3, 5);
    expect(t.recent(1.1, 10)).toHaveLength(8);
    t.clear();
    expect(t.recent(1.1, 10)).toHaveLength(0);
  });

  it('legibility: quads sized by quadWidthFor keep text at or above 18 mm cap height per metre', () => {
    for (const d of [0.45, 1, 2.2, 3.5, 5]) {
      const w = quadWidthFor(d, 40, 640);
      const cap = capHeight(40, 640, w);
      expect(capAtOneMetre(cap, d)).toBeGreaterThanOrEqual(MIN_CAP_PER_METRE);
    }
    // the old 0.36 m section label at 3 m was well below the floor
    expect(capAtOneMetre(capHeight(54, 640, 0.36), 3)).toBeLessThan(MIN_CAP_PER_METRE);
  });
});
