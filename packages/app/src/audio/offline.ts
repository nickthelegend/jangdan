/**
 * Offline sanity check of the real synth: render an excerpt of a piece through the same Synth into an
 * OfflineAudioContext, cut it off with the same Performance.cutoff path, and measure RMS before and
 * after the cut-off. Used by the e2e run (muted browser), not by the experience.
 */
import { compilePiece, Performance, PIECES, SECTIONS, type SectionId } from '@jangdan/core';
import { Synth } from './synth.js';

export async function renderExcerpt(pieceIndex = 0, playSeconds = 5, tailSeconds = 1.5): Promise<{
  rmsPlaying: number;
  rmsAfterCutoff: number;
  notes: number;
  cutoffAt: number;
}> {
  const sr = 48000;
  const total = 0.2 + playSeconds + tailSeconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const outs = {} as Record<SectionId, AudioNode>;
  for (const s of SECTIONS) {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    outs[s] = g;
  }
  const synth = new Synth(ctx, outs);
  const perf = new Performance(compilePiece(PIECES[pieceIndex]), { mode: 'listen' });
  perf.start(0.1);
  const handles: { stop(at: number): void }[] = [];
  let notes = 0;
  const cutoffAt = 0.1 + playSeconds;
  for (let t = 0; t < cutoffAt; t += 1 / 72) {
    const r = perf.tick(t);
    for (const n of r.notes) {
      handles.push(synth.play(n, perf.level));
      notes++;
    }
    for (const e of r.events) if (e.type === 'click') synth.click(e.time, e.count === 1, outs.percussion);
  }
  perf.cutoff(cutoffAt);
  for (const h of handles) h.stop(cutoffAt);
  const buf = await ctx.startRendering();
  synth.dispose();
  const rms = (from: number, to: number) => {
    let s = 0;
    let n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = Math.floor(from * sr); i < Math.min(d.length, Math.floor(to * sr)); i++) {
        s += d[i] * d[i];
        n++;
      }
    }
    return Math.sqrt(s / Math.max(1, n));
  };
  // measure the music (after the one-bar count-in) and the silence after the 15 ms release
  const musicStart = perf.clock!.timeAt(0);
  return {
    rmsPlaying: rms(Math.min(cutoffAt - 0.5, musicStart + 0.1), cutoffAt),
    rmsAfterCutoff: rms(cutoffAt + 0.2, total),
    notes,
    cutoffAt,
  };
}
