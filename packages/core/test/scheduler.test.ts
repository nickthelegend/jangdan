import { describe, expect, it } from 'vitest';
import { BeatClock, LookaheadScheduler } from '../src/scheduler.js';
import { mulberry32 } from '../src/rng.js';

describe('scheduler.ts: beat clock and look-ahead scheduler', () => {
  it('does not drift over 5 simulated minutes of jittery 25 ms ticks', () => {
    const bpm = 96;
    const start = 1.5;
    const clock = new BeatClock(start, bpm);
    const beats = Array.from({ length: Math.ceil((300 * bpm) / 60) + 1 }, (_, i) => ({ beat: i }));
    const sched = new LookaheadScheduler(clock, beats, 0.1);
    const rng = mulberry32(42);
    const seen: { beat: number; time: number }[] = [];
    let now = 0;
    while (now < start + 300) {
      for (const { event, time } of sched.tick(now)) seen.push({ beat: event.beat, time });
      now += 0.025 + (rng() * 2 - 1) * 0.012; // setTimeout jitter
    }
    // every beat exactly once, in order, at its exact analytic time
    const expected = beats.filter((b) => start + (b.beat * 60) / bpm < now + 0.1);
    expect(seen.length).toBe(expected.length);
    let maxErr = 0;
    seen.forEach((s, i) => {
      expect(s.beat).toBe(i);
      maxErr = Math.max(maxErr, Math.abs(s.time - (start + (i * 60) / bpm)));
    });
    expect(maxErr).toBeLessThan(1e-9);
    // and nothing is ever handed out late or too early
    expect(seen[seen.length - 1].time - (start + 300)).toBeLessThan(0.1 + 0.6);
  });

  it('hands each note out before it is due (never in the past)', () => {
    const clock = new BeatClock(0, 120);
    const events = Array.from({ length: 200 }, (_, i) => ({ beat: i / 2 }));
    const sched = new LookaheadScheduler(clock, events, 0.12);
    for (let now = 0; now < 60; now += 0.03) {
      for (const { time } of sched.tick(now)) expect(time).toBeGreaterThanOrEqual(now - 1e-9);
    }
  });

  it('a tempo change re-anchors: past beats stay put, later beats use the new tempo', () => {
    const c = new BeatClock(0, 60);
    expect(c.timeAt(4)).toBeCloseTo(4);
    c.setTempo(120, 4);
    expect(c.timeAt(4)).toBeCloseTo(4);
    expect(c.timeAt(6)).toBeCloseTo(5);
    expect(c.beatAt(5)).toBeCloseTo(6);
  });

  it('a phase bend is continuous, monotonic and returns to the base tempo at the next beat', () => {
    for (const shift of [0.08, -0.08, 0.5, -0.5]) {
      const c = new BeatClock(0, 100);
      const at = 3.1;
      const before = c.beatAt(at);
      c.bend(shift, at);
      expect(c.beatAt(at)).toBeCloseTo(before, 9);
      expect(c.baseBpm).toBe(100);
      let prev = -Infinity;
      for (let t = at; t < at + 4; t += 0.01) {
        const b = c.beatAt(t);
        expect(b).toBeGreaterThan(prev);
        prev = b;
      }
      // after the target beat, beats are 0.6 s apart again
      expect(c.timeAt(10) - c.timeAt(9)).toBeCloseTo(0.6, 9);
      const clamped = Math.max(-0.15, Math.min(0.15, shift));
      expect(c.timeAt(9) - (9 * 0.6 + clamped)).toBeCloseTo(0, 9);
    }
  });
});
