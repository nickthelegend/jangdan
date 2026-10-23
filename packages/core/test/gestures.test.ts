import { describe, expect, it } from 'vitest';
import { DYNAMIC_MARKS, gainForLevel, levelForMark, levelFromPalmHeight, markForLevel, Smoother } from '../src/dynamics.js';
import { FistDetector, fingerExtensions, fistness, isPalmUp, palmNormal } from '../src/gestures.js';
import { handJoints } from './helpers.js';

const OPEN: [number, number, number, number] = [0, 0, 0, 0];
const FIST: [number, number, number, number] = [1, 1, 1, 1];
const POINT: [number, number, number, number] = [0, 1, 1, 1];
const RELAXED: [number, number, number, number] = [0.25, 0.3, 0.35, 0.4];

describe('gestures.ts: fist, palm', () => {
  it('measures straight fingers as extended and folded fingers as curled', () => {
    const open = fingerExtensions(handJoints({ curl: OPEN }));
    const fist = fingerExtensions(handJoints({ curl: FIST }));
    for (const e of open) expect(e).toBeGreaterThan(1.6);
    for (const e of fist) expect(e).toBeLessThan(1.3);
    expect(fistness(handJoints({ curl: FIST }))).toBeGreaterThan(0.8);
    expect(fistness(handJoints({ curl: OPEN }))).toBeLessThan(0.2);
  });

  it('confirms a fist only after the hold time, and only once until the hand opens', () => {
    const d = new FistDetector();
    const fist = handJoints({ curl: FIST });
    const open = handJoints({ curl: OPEN });
    expect(d.update(0, fist)).toBe(false);
    expect(d.update(0.03, fist)).toBe(false);
    expect(d.update(0.07, fist)).toBe(true);
    expect(d.update(0.1, fist)).toBe(false); // already closed
    expect(d.update(0.2, open)).toBe(false);
    expect(d.closed).toBe(false);
    expect(d.update(0.3, fist)).toBe(false);
    expect(d.update(0.4, fist)).toBe(true);
  });

  it('does not mistake a point, an open hand or a relaxed hand for a fist', () => {
    for (const curl of [OPEN, POINT, RELAXED]) {
      const d = new FistDetector();
      let fired = false;
      for (let t = 0; t < 1; t += 1 / 72) fired ||= d.update(t, handJoints({ curl }));
      expect(fired).toBe(false);
    }
  });

  it('a one-frame curl (passing through) does not cut off', () => {
    const d = new FistDetector();
    expect(d.update(0, handJoints({ curl: FIST }))).toBe(false);
    expect(d.update(1 / 72, handJoints({ curl: OPEN }))).toBe(false);
    expect(d.update(2 / 72, handJoints({ curl: FIST }))).toBe(false);
  });

  it('finds the palm normal for both hands, palm down and palm up', () => {
    for (const h of ['left', 'right'] as const) {
      const down = palmNormal(handJoints({ curl: OPEN, handedness: h }), h);
      expect(down[1]).toBeLessThan(-0.9);
      expect(isPalmUp(handJoints({ curl: OPEN, handedness: h }), h)).toBe(false);
      expect(isPalmUp(handJoints({ curl: OPEN, handedness: h, palmUp: true }), h)).toBe(true);
    }
  });
});

describe('dynamics.ts: left palm height to pp..ff', () => {
  it('maps a low palm to pp and a palm at eye level to ff', () => {
    expect(markForLevel(levelFromPalmHeight(1.2 - 0.65, 1.2))).toBe('pp');
    expect(markForLevel(levelFromPalmHeight(1.2, 1.2))).toBe('ff');
  });
  it('a palm held high reads at least f', () => {
    expect(levelFromPalmHeight(1.2 - 0.12, 1.2)).toBeGreaterThanOrEqual(levelForMark('f'));
  });
  it('marks are monotonic in height and gain spans 30 dB', () => {
    let prev = -1;
    for (let y = 0.4; y <= 1.3; y += 0.05) {
      const i = DYNAMIC_MARKS.indexOf(markForLevel(levelFromPalmHeight(y, 1.2)));
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
    expect(20 * Math.log10(gainForLevel(1) / gainForLevel(0))).toBeCloseTo(30, 5);
  });
  it('smooths: a step reaches 63% after one time constant', () => {
    const s = new Smoother(0, 0.25);
    for (let i = 0; i < 25; i++) s.update(1, 0.01);
    expect(s.value).toBeCloseTo(1 - Math.exp(-1), 2);
  });
});
