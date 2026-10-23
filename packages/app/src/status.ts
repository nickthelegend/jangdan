/** What the HUD shows; written by the conductor system each frame. */
import type { DynamicMark, TogethernessScore } from '@jangdan/core';

export type Phase = 'off' | 'scan' | 'ready' | 'raised' | 'countIn' | 'playing' | 'fermata' | 'results' | 'calibrate';

export const status = {
  phase: 'off' as Phase,
  pieceTitle: '',
  pieceSub: '',
  mode: 'conduct' as 'conduct' | 'listen' | 'ghost',
  caption: '',
  sub: '',
  /** Count-in number shown big (0 = none). */
  count: 0,
  countOf: 4,
  bpm: 0,
  mark: '',
  bar: 0,
  beatsPerBar: 4,
  /** 0..1 position inside the current beat, and the beat in the bar (0-based). */
  beatPhase: 0,
  beatInBar: 0,
  level: 0.5,
  dynMark: 'mf' as DynamicMark,
  /** Tolerance ring: relative spread of recent beats. */
  spread: 1,
  confidence: 0,
  /** Audio time of the last ictus (for the ring flash). */
  ictusAt: -1,
  /** Audio time of the last cut-off; the walls go dark at once. */
  cutAt: -1,
  results: null as null | { score: TogethernessScore | null; best: number | null; isBest: boolean; completed: boolean },
  menuOpen: false,
  handsSeen: false,
  /** Calibration progress. */
  cal: { taps: 0, of: 8 },
};
