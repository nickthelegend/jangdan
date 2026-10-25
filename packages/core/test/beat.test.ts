import { describe, expect, it } from 'vitest';
import { BeatTracker } from '../src/beat.js';
import { runTracker, wristTrajectory } from './helpers.js';

describe('beat.ts: tempo from wrist ictus', () => {
  for (const bpm of [72, 96, 120]) {
    for (const shape of ['sine', 'bounce'] as const) {
      it(`estimates ${bpm} BPM within ±3 from a ${shape} trajectory with jitter and noise`, () => {
        const { tracker, ictus } = runTracker(wristTrajectory({ bpm, seconds: 12, shape, seed: bpm }));
        expect(tracker.bpm).not.toBeNull();
        expect(Math.abs(tracker.bpm! - bpm)).toBeLessThanOrEqual(3);
        // one ictus per beat (allow the first to be missed while the filter settles)
        const expected = (12 * bpm) / 60;
        expect(ictus.length).toBeGreaterThanOrEqual(expected - 2);
        expect(ictus.length).toBeLessThanOrEqual(expected + 1);
      });
    }
  }

  it('estimates tempo within ±3 BPM at every seed for 96 BPM (robustness sweep)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { tracker } = runTracker(wristTrajectory({ bpm: 96, seconds: 8, seed, noise: 0.003, jitter: 0.002 }));
      expect(Math.abs(tracker.bpm! - 96)).toBeLessThanOrEqual(3);
    }
  });

  it('follows a speed-up from 96 to 120 BPM within a few beats', () => {
    const traj = wristTrajectory({ bpm: (t) => (t < 6 ? 96 : 120), seconds: 10, seed: 3 });
    const tracker = new BeatTracker();
    let at8: number | null = null;
    for (const s of traj) {
      tracker.push(s.t, s.y);
      if (s.t >= 6 && s.t < 6.05) expect(Math.abs(tracker.bpm! - 96)).toBeLessThanOrEqual(3);
      if (s.t >= 8 && at8 === null) at8 = tracker.bpm;
    }
    expect(Math.abs(at8! - 120)).toBeLessThanOrEqual(4);
    expect(Math.abs(tracker.bpm! - 120)).toBeLessThanOrEqual(3);
  });

  it('treats one missed beat as two intervals, not a halved tempo', () => {
    const traj = wristTrajectory({ bpm: 96, seconds: 10, seed: 9 });
    // flatten the motion for one beat around t = 5 s (the conductor skipped a stroke)
    const flat = traj.map((s) => (s.t > 4.95 && s.t < 5.55 ? { t: s.t, y: 1.37 } : s));
    const { tracker } = runTracker(flat);
    expect(Math.abs(tracker.bpm! - 96)).toBeLessThanOrEqual(3);
  });

  it('recovers the beat after the hand steps up and stays there', () => {
    const traj = wristTrajectory({ bpm: 96, seconds: 8, seed: 4 });
    const shifted = traj.map((s) => (s.t > 2 ? { t: s.t, y: s.y + 0.35 } : s));
    const { tracker, ictus } = runTracker(shifted);
    const late = ictus.filter((i) => i.time > 3.5);
    expect(late.length).toBeGreaterThan(4);
    expect(Math.abs(tracker.bpm! - 96)).toBeLessThanOrEqual(4);
  });

  it('drops tracking glitches (a 40 cm jump for one frame) instead of firing a beat', () => {
    const traj = wristTrajectory({ bpm: 96, seconds: 8, seed: 11 });
    const glitchy = traj.map((s, i) => (i % 97 === 50 ? { t: s.t, y: s.y - 0.4 } : s));
    const clean = runTracker(traj);
    const dirty = runTracker(glitchy);
    expect(dirty.tracker.glitches).toBeGreaterThan(0);
    expect(dirty.ictus.length).toBe(clean.ictus.length);
    expect(Math.abs(dirty.tracker.bpm! - 96)).toBeLessThanOrEqual(3);
  });

  it('ignores a still hand and small tremor (no ictus)', () => {
    const { ictus } = runTracker(wristTrajectory({ bpm: 96, seconds: 6, amplitude: 0.004, noise: 0.002 }));
    expect(ictus.length).toBe(0);
  });

  it('clamps to the valid range 60–160 BPM', () => {
    const fast = runTracker(wristTrajectory({ bpm: 175, seconds: 8, amplitude: 0.08 }));
    if (fast.tracker.bpm !== null) expect(fast.tracker.bpm).toBeLessThanOrEqual(160);
    const slow = runTracker(wristTrajectory({ bpm: 52, seconds: 12, amplitude: 0.15 }));
    if (slow.tracker.bpm !== null) expect(slow.tracker.bpm).toBeGreaterThanOrEqual(60);
  });

  it('reports a tight tolerance ring for a steady beat and full confidence', () => {
    const { tracker } = runTracker(wristTrajectory({ bpm: 96, seconds: 8, seed: 5 }));
    expect(tracker.spread).toBeLessThan(0.05);
    expect(tracker.confidence).toBeGreaterThan(0.7);
  });
});
