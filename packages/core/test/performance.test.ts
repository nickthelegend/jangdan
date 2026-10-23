import { describe, expect, it } from 'vitest';
import { BeatTracker } from '../src/beat.js';
import { compilePiece } from '../src/piece.js';
import { PIECES } from '../src/pieces/index.js';
import { Performance, type PerfEvent, type ScheduledNote } from '../src/performance.js';
import { scoreTake } from '../src/togetherness.js';
import { wristTrajectory } from './helpers.js';

/** Drive a whole conducted performance from a synthetic wrist trajectory, like the app does each frame. */
function conduct(pieceIdx: number, bpm: number, seconds: number, fistAt?: number) {
  const piece = compilePiece(PIECES[pieceIdx]);
  const perf = new Performance(piece, { mode: 'conduct' });
  const tracker = new BeatTracker();
  const notes: ScheduledNote[] = [];
  const events: PerfEvent[] = [];
  let cut: ReturnType<Performance['cutoff']> = null;
  const traj = wristTrajectory({ bpm, seconds, seed: 4 });
  for (const s of traj) {
    const now = s.t;
    if (fistAt !== undefined && now >= fistAt && !cut) {
      cut = perf.cutoff(now);
      continue;
    }
    const ic = tracker.push(s.t, s.y);
    if (ic) {
      if (perf.state === 'idle') perf.start(ic.time, tracker.bpm ?? undefined);
      else perf.ictus(ic.time, tracker.bpm);
    }
    perf.setLevel(0.5 + 0.3 * Math.sin(now / 4));
    const r = perf.tick(now);
    notes.push(...r.notes);
    events.push(...r.events);
  }
  return { perf, notes, events, cut, piece };
}

describe('performance.ts: the conductor loop', () => {
  it('a downbeat starts a one-bar count-in, then the music, at the conducted tempo (96 ± 4)', () => {
    const { perf, events } = conduct(0, 96, 12);
    const clicks = events.filter((e) => e.type === 'click');
    expect(clicks.length).toBe(4);
    const start = events.find((e) => e.type === 'start')!;
    expect(start.time - clicks[0].time).toBeCloseTo((4 * 60) / perf.bpm, 0);
    expect(Math.abs(perf.bpm - 96)).toBeLessThanOrEqual(4);
  });

  it('a fist cuts the orchestra off within one beat and nothing plays after it', () => {
    const fistAt = 9.3;
    const { perf, notes, cut } = conduct(0, 96, 14, fistAt);
    expect(cut).not.toBeNull();
    expect(cut!.releaseAt - fistAt).toBeLessThanOrEqual(60 / perf.bpm);
    expect(cut!.releaseAt - fistAt).toBeLessThan(0.02);
    expect(notes.every((n) => n.time <= cut!.releaseAt + 0.12)).toBe(true);
    // every note that would still sound is in the cut list
    for (const n of notes) if (n.time + n.dur > cut!.releaseAt) expect(cut!.cut).toContain(n);
    expect(perf.tick(20).notes.length).toBe(0);
    expect(perf.state).toBe('cutoff');
  });

  it('hands-only completion: conducting through the whole piece reaches the fermata, and the fist ends it', () => {
    const piece = compilePiece(PIECES[0]);
    const secs = (piece.totalBeats * 60) / 96 + 6;
    const { perf, events, cut } = conduct(0, 96, secs + 2, secs);
    expect(events.some((e) => e.type === 'fermata')).toBe(true);
    expect(cut).not.toBeNull();
    expect(perf.take.completed).toBe(true);
    const score = scoreTake(perf.take);
    expect(score.steadiness).toBeGreaterThan(0.75);
    expect(score.total).toBeGreaterThan(40);
  });

  it('every note of the piece is scheduled exactly once in order', () => {
    const piece = compilePiece(PIECES[2]);
    const secs = (piece.totalBeats * 60) / 132 + 3;
    const { notes } = conduct(2, 132, secs);
    expect(notes.length).toBe(piece.notes.length);
    for (let i = 1; i < notes.length; i++) expect(notes[i].time).toBeGreaterThanOrEqual(notes[i - 1].time - 1e-9);
  });

  it('cues match entries; pinch-hold cycles on -> solo -> muted -> on', () => {
    const piece = compilePiece(PIECES[0]);
    const perf = new Performance(piece);
    perf.start(0, 88);
    for (let t = 0; t < 10; t += 0.02) perf.tick(t);
    const windsEntry = piece.entries.find((e) => e.section === 'winds')!;
    const rec = perf.cue('winds', perf.clock!.timeAt(windsEntry.beat - 0.5));
    expect(rec.entryBeat).toBe(windsEntry.beat);
    expect(perf.cycleMix('brass')).toBe('solo');
    expect(perf.mixGain('strings')).toBeCloseTo(0.12);
    expect(perf.mixGain('brass')).toBe(1);
    expect(perf.cycleMix('brass')).toBe('muted');
    expect(perf.mixGain('brass')).toBe(0);
    perf.cue('brass', 5);
    expect(perf.mix.brass).toBe('on');
  });

  it('listen mode plays the whole piece by itself and releases the final chord', () => {
    const piece = compilePiece(PIECES[1]);
    const perf = new Performance(piece, { mode: 'listen' });
    perf.start(0);
    const events: PerfEvent[] = [];
    let n = 0;
    for (let t = 0; t < 120; t += 0.025) {
      const r = perf.tick(t);
      n += r.notes.length;
      events.push(...r.events);
    }
    expect(n).toBe(piece.notes.length);
    expect(events.some((e) => e.type === 'cutoff' && e.auto)).toBe(true);
    // the score's own dynamics drove the level
    const levels = perf.take.dyn.map((d) => d[1]);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.3);
  });

  it('ghost replay reuses the tempo of an earlier take', () => {
    const piece = compilePiece(PIECES[0]);
    const { perf } = conduct(0, 112, 30);
    const ghost = perf.take;
    const replay = new Performance(piece, { mode: 'listen', ghost });
    replay.start(0);
    for (let t = 0; t < 20; t += 0.025) replay.tick(t);
    expect(Math.abs(replay.bpm - 112)).toBeLessThanOrEqual(4);
  });
});

describe('togetherness.ts', () => {
  it('rewards a steady beat, timely cues and dynamic range; punishes the opposite', async () => {
    const { scoreTake: s } = await import('../src/togetherness.js');
    const steady = Array.from({ length: 40 }, (_, i) => i * 0.625);
    const shaky = steady.map((t, i) => t + (i % 2 ? 0.12 : -0.1));
    const base = { pieceId: 'x', mode: 'conduct' as const, tempo: [], completed: true, date: '' };
    const good = s({ ...base, ictus: steady, cues: [{ section: 'winds', beat: 7.5, entryBeat: 8 }], entries: [['winds', 8]], dyn: [[0, 0.2], [10, 0.5], [20, 0.9]] });
    const bad = s({ ...base, ictus: shaky, cues: [], entries: [['winds', 8]], dyn: [[0, 0.5], [10, 0.52], [20, 0.5]] });
    expect(good.total).toBeGreaterThan(80);
    expect(bad.total).toBeLessThan(30);
    expect(good.cueTiming).toBeCloseTo(0.75);
  });
});
