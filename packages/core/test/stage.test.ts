import { describe, expect, it } from 'vitest';
import { assignStage, classifySurface, estimateFloorY } from '../src/stage.js';
import { bigLoft, emptyRoom, fullRoom, homeOffice, SEATED, twoPlaneRoom } from '../src/synthetic-rooms.js';
import { horizontalAngle, sub } from '../src/math.js';

const surfaceOf = (r: ReturnType<typeof assignStage>, s: 'strings' | 'winds' | 'brass' | 'percussion') => {
  const p = r.placements[s];
  return p.kind === 'surface' ? p.surfaceId : 'banner';
};

describe('stage.ts: sections on real surfaces', () => {
  it('classifies a full room by orientation and height (planes have no labels)', () => {
    const room = fullRoom();
    const floorY = estimateFloorY(room, SEATED);
    expect(floorY).toBe(0);
    const roles = Object.fromEntries(room.map((s) => [s.id, classifySurface(s, SEATED, floorY)]));
    expect(roles).toEqual({
      floor: 'floor',
      ceiling: 'ceiling',
      'wall-l': 'wall-left',
      'wall-r': 'wall-right',
      'wall-f': 'wall-front',
      'wall-b': 'wall-behind',
      table: 'table',
    });
  });

  it('full room: strings left, winds right, brass front, percussion on the table', () => {
    const r = assignStage(fullRoom(), SEATED);
    expect(surfaceOf(r, 'strings')).toBe('wall-l');
    expect(surfaceOf(r, 'winds')).toBe('wall-r');
    expect(surfaceOf(r, 'brass')).toBe('wall-f');
    expect(surfaceOf(r, 'percussion')).toBe('table');
    expect(r.realCount).toBe(4);
  });

  it('two planes only: two real sections and two labelled paper banners', () => {
    const r = assignStage(twoPlaneRoom(), SEATED);
    expect(r.realCount).toBe(2);
    expect(surfaceOf(r, 'strings')).toBe('wall-l');
    expect(surfaceOf(r, 'percussion')).toBe('table');
    for (const s of ['winds', 'brass'] as const) {
      const p = r.placements[s];
      expect(p.kind).toBe('banner');
      if (p.kind === 'banner') expect(p.reason).toMatch(/no (right|front) wall found/);
    }
    // banners stand where the missing walls would be
    const w = r.placements.winds;
    expect(horizontalAngle(SEATED.forward, sub(w.anchor, SEATED.position))).toBeGreaterThan(0.9);
  });

  it('no planes: four banners around the listener, all marked "no surfaces detected"', () => {
    const r = assignStage(emptyRoom(), SEATED);
    expect(r.realCount).toBe(0);
    for (const p of Object.values(r.placements)) {
      expect(p.kind).toBe('banner');
      if (p.kind === 'banner') expect(p.reason).toBe('no surfaces detected');
    }
    // banners face the listener
    const s = r.placements.strings;
    const toListener = sub(SEATED.position, s.anchor);
    expect(s.normal[0] * toListener[0] + s.normal[2] * toListener[2]).toBeGreaterThan(0);
  });

  it('home office (no left wall scanned): real surfaces beat banners, so strings take the front wall and brass the ceiling', () => {
    const r = assignStage(homeOffice(), SEATED);
    expect(surfaceOf(r, 'percussion')).toBe('desk');
    expect(surfaceOf(r, 'winds')).toBe('wall-r');
    expect(surfaceOf(r, 'strings')).toBe('wall-f');
    expect(surfaceOf(r, 'brass')).toBe('ceiling');
    expect(r.realCount).toBe(4);
  });

  it('never uses the wall behind the seated listener or the floor for a wall section', () => {
    for (const room of [fullRoom(), homeOffice(), bigLoft()]) {
      const r = assignStage(room, SEATED);
      for (const p of Object.values(r.placements)) {
        if (p.kind !== 'surface') continue;
        expect(p.role).not.toBe('wall-behind');
        if (p.section !== 'percussion') expect(p.role).not.toBe('floor');
      }
    }
  });

  it('turning the listener turns the stage', () => {
    const facingLeftWall = { position: SEATED.position, forward: [-1, 0, 0] as [number, number, number] };
    const r = assignStage(fullRoom(), facingLeftWall);
    expect(surfaceOf(r, 'brass')).toBe('wall-l');
    expect(surfaceOf(r, 'strings')).toBe('wall-b');
    expect(surfaceOf(r, 'winds')).toBe('wall-f');
  });

  it('no table: brass may move to the ceiling only if the front wall is missing', () => {
    const noFront = fullRoom().filter((s) => s.id !== 'wall-f' && s.id !== 'table');
    const r = assignStage(noFront, SEATED);
    expect(surfaceOf(r, 'brass')).toBe('ceiling');
    expect(r.placements.percussion.kind).toBe('surface'); // the floor, as a last resort
  });
});
