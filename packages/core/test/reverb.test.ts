import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, generateIR, reverbParams, roomFromSurfaces } from '../src/reverb.js';
import { bigLoft, emptyRoom, fullRoom, homeOffice } from '../src/synthetic-rooms.js';

const energy = (a: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i++) e += a[i] * a[i];
  return e;
};

describe('reverb.ts: the room sets the reverb', () => {
  it('measures room dimensions from the detected surfaces', () => {
    const r = roomFromSurfaces(fullRoom());
    expect(r.measured).toBe(true);
    expect(r.dims[0]).toBeCloseTo(5, 0);
    expect(r.dims[1]).toBeCloseTo(2.6, 0);
    expect(r.dims[2]).toBeCloseTo(4, 0);
  });

  it('falls back to a labelled default room with too few surfaces', () => {
    expect(roomFromSurfaces(emptyRoom())).toEqual(DEFAULT_ROOM);
    expect(roomFromSurfaces(emptyRoom()).measured).toBe(false);
  });

  it('IR length, RT60 and wet level grow with room volume', () => {
    const rooms = [homeOffice(), fullRoom(), bigLoft()].map(roomFromSurfaces);
    expect(rooms[0].volume).toBeLessThan(rooms[1].volume);
    expect(rooms[1].volume).toBeLessThan(rooms[2].volume);
    const params = rooms.map(reverbParams);
    const irs = params.map((p) => generateIR(p, 48000, 3));
    for (let i = 1; i < 3; i++) {
      expect(params[i].rt60).toBeGreaterThan(params[i - 1].rt60);
      expect(params[i].wet).toBeGreaterThan(params[i - 1].wet);
      expect(irs[i][0].length).toBeGreaterThan(irs[i - 1][0].length);
    }
    // small room is dry and short; the loft is long and wet
    expect(params[0].rt60).toBeLessThan(0.8);
    expect(params[2].rt60).toBeGreaterThan(1.2);
  });

  it('the IR is deterministic per seed, stereo-decorrelated, and decays', () => {
    const p = reverbParams(roomFromSurfaces(fullRoom()));
    const [L1, R1] = generateIR(p, 48000, 7);
    const [L2] = generateIR(p, 48000, 7);
    expect(Array.from(L1.slice(0, 2000))).toEqual(Array.from(L2.slice(0, 2000)));
    let same = 0;
    for (let i = 5000; i < 6000; i++) if (Math.abs(L1[i] - R1[i]) < 1e-6) same++;
    expect(same).toBeLessThan(10);
    const n = L1.length;
    expect(energy(L1, Math.floor(n * 0.9), n)).toBeLessThan(energy(L1, 0, Math.floor(n * 0.1)) * 0.01);
  });
});
