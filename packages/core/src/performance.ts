/**
 * One performance of a piece: count-in, the conducted (or self-playing) music, the final fermata and the
 * cut-off. Pure and clock-agnostic: the app calls it with AudioContext times and plays what `tick` returns,
 * so the whole conductor loop runs in tests with a simulated clock.
 */
import { clamp } from './math.js';
import { type CompiledPiece, dynamicsAt, type Entry, type NoteEvent, SECTIONS, type SectionId } from './piece.js';
import { BeatClock, LookaheadScheduler } from './scheduler.js';
import type { CueRecord, TakeRecord } from './togetherness.js';
import { seriesAt } from './togetherness.js';

export type PerfMode = 'conduct' | 'listen';
export type PerfState = 'idle' | 'countIn' | 'playing' | 'fermata' | 'cutoff';
export type SectionMix = 'on' | 'solo' | 'muted';

export interface ScheduledNote {
  time: number;
  /** Seconds; held fermata notes get `held: true` and sound until the cut-off. */
  dur: number;
  held: boolean;
  note: NoteEvent;
  /** Final linear gain multiplier from the section mix (dynamics are applied by the synth). */
  mix: number;
}

export type PerfEvent =
  | { type: 'click'; time: number; count: number; of: number }
  | { type: 'start'; time: number }
  | { type: 'mark'; time: number; phrase: string; bar: number }
  | { type: 'entry-soon'; time: number; entry: Entry }
  | { type: 'fermata'; time: number }
  | { type: 'cutoff'; time: number; auto: boolean };

export interface PerformanceOptions {
  mode: PerfMode;
  lookahead: number;
  /** How long the final chord may ring before an automatic release (s). */
  fermataHold: number;
  /** How strongly a new tempo estimate pulls the clock (0..1). */
  tempoFollow: number;
  /** How much of the phase error a single ictus corrects (0..1). */
  phaseFollow: number;
  /** Ghost replay: tempo/dynamics from an earlier take (listen mode). */
  ghost?: TakeRecord;
}

const DEFAULTS: PerformanceOptions = { mode: 'conduct', lookahead: 0.12, fermataHold: 8, tempoFollow: 0.6, phaseFollow: 0.4 };

export class Performance {
  readonly opts: PerformanceOptions;
  state: PerfState = 'idle';
  clock: BeatClock | null = null;
  level = 0.55;
  readonly mix: Record<SectionId, SectionMix> = { strings: 'on', winds: 'on', brass: 'on', percussion: 'on' };
  readonly take: TakeRecord;
  cutoffTime: number | null = null;
  fermataTime: number | null = null;
  private notes: LookaheadScheduler<NoteEvent> | null = null;
  private countIn = 0;
  private clicksEmitted = 0;
  private marksEmitted = 0;
  private entriesEmitted = 0;
  private lastSampledBeat = -Infinity;
  private inFlight: ScheduledNote[] = [];
  private finalBeat: number;

  constructor(
    readonly piece: CompiledPiece,
    opts: Partial<PerformanceOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.take = {
      pieceId: piece.json.id,
      mode: this.opts.mode,
      ictus: [],
      tempo: [],
      dyn: [],
      cues: [],
      entries: [],
      completed: false,
      date: new Date(0).toISOString(),
    };
    // the fermata: the last onset of the piece
    let last = 0;
    for (const n of piece.notes) last = Math.max(last, n.beat);
    this.finalBeat = last;
  }

  get bpm(): number {
    return this.clock ? this.clock.baseBpm : this.piece.json.bpm;
  }

  get beatsPerBar(): number {
    return this.piece.json.beatsPerBar;
  }

  /** Current beat (negative during the count-in). */
  beatAt(time: number): number {
    return this.clock ? this.clock.beatAt(time) : -Infinity;
  }

  /** The conductor's downbeat: starts a one-bar count-in from `time`. */
  start(time: number, bpm?: number, dateIso = new Date().toISOString()): boolean {
    if (this.state !== 'idle') return false;
    this.countIn = this.beatsPerBar;
    const tempo = clamp(bpm ?? this.startTempo(), 60, 160);
    this.clock = new BeatClock(time, tempo, -this.countIn);
    this.notes = new LookaheadScheduler(this.clock, this.piece.notes, this.opts.lookahead, 0);
    this.state = 'countIn';
    this.take.date = dateIso;
    if (this.opts.mode === 'conduct') this.take.ictus.push(time);
    return true;
  }

  private startTempo(): number {
    const g = this.opts.ghost;
    return g && g.tempo.length ? g.tempo[0][1] : this.piece.json.bpm;
  }

  /** A conductor's ictus: follow its tempo and phase. */
  ictus(time: number, bpmEstimate: number | null): void {
    if (!this.clock || this.opts.mode !== 'conduct') return;
    if (this.state !== 'countIn' && this.state !== 'playing') return;
    this.take.ictus.push(time);
    if (bpmEstimate !== null) {
      const cur = this.clock.baseBpm;
      const next = clamp(cur + this.opts.tempoFollow * (bpmEstimate - cur), 60, 160);
      if (Math.abs(next - cur) > 0.05) this.clock.setTempo(next, time);
    }
    const b = this.clock.beatAt(time);
    const k = Math.round(b);
    const err = time - this.clock.timeAt(k);
    if (Math.abs(err) > 0.005) this.clock.bend(err * this.opts.phaseFollow, time);
  }

  /** Conductor dynamics (0..1). In listen mode the score's own dynamics win. */
  setLevel(level: number): void {
    if (this.opts.mode === 'conduct') this.level = clamp(level, 0, 1);
  }

  /** A cue at `time`: matched to the nearest upcoming/just-passed entry of that section. Unmutes it. */
  cue(section: SectionId, time: number): CueRecord {
    const beat = this.clock ? this.clock.beatAt(time) : 0;
    let entryBeat: number | null = null;
    let bestD = Infinity;
    for (const e of this.piece.entries) {
      if (e.section !== section) continue;
      const d = beat - e.beat;
      if (d >= -2 && d <= 1 && Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        entryBeat = e.beat;
      }
    }
    const rec = { section, beat, entryBeat };
    if (this.state === 'countIn' || this.state === 'playing') this.take.cues.push(rec);
    if (this.mix[section] === 'muted') this.mix[section] = 'on';
    return rec;
  }

  /** Pinch-hold: on -> solo -> muted -> on. Only one section can be solo. */
  cycleMix(section: SectionId): SectionMix {
    const next: SectionMix = this.mix[section] === 'on' ? 'solo' : this.mix[section] === 'solo' ? 'muted' : 'on';
    if (next === 'solo') for (const s of SECTIONS) if (this.mix[s] === 'solo') this.mix[s] = 'on';
    this.mix[section] = next;
    return next;
  }

  mixGain(section: SectionId): number {
    if (this.mix[section] === 'muted') return 0;
    const anySolo = SECTIONS.some((s) => this.mix[s] === 'solo');
    if (anySolo && this.mix[section] !== 'solo') return 0.12;
    return 1;
  }

  /** Fist: everything stops now. Returns the notes that must be cut (they were already handed to the synth). */
  cutoff(time: number, auto = false): { releaseAt: number; cut: ScheduledNote[]; event: PerfEvent } | null {
    if (this.state === 'idle' || this.state === 'cutoff') return null;
    const wasPlaying = this.state;
    this.state = 'cutoff';
    this.cutoffTime = time;
    const cut = this.inFlight.filter((n) => n.held || n.time + n.dur > time);
    this.inFlight = [];
    if (this.clock) {
      const b = this.clock.beatAt(time);
      this.take.completed = wasPlaying === 'fermata' || b >= this.finalBeat;
      for (const e of this.piece.entries) if (e.beat <= b) this.take.entries.push([e.section, e.beat]);
    }
    return { releaseAt: time, cut, event: { type: 'cutoff', time, auto } };
  }

  /** Advance to `now`: returns notes to synthesise and events to show. */
  tick(now: number): { notes: ScheduledNote[]; events: PerfEvent[] } {
    const notes: ScheduledNote[] = [];
    const events: PerfEvent[] = [];
    if (!this.clock || !this.notes || this.state === 'idle' || this.state === 'cutoff') return { notes, events };
    const clock = this.clock;
    const horizon = now + this.opts.lookahead;

    // listen mode (and ghost replay) drive tempo and dynamics from the score / the earlier take
    if (this.opts.mode === 'listen') {
      const b = clock.beatAt(now);
      const g = this.opts.ghost;
      const target = g ? seriesAt(g.tempo, b, this.piece.json.bpm) : this.listenTempo(b);
      if (Math.abs(target - clock.baseBpm) > 0.05) clock.setTempo(target, now);
      this.level = g ? seriesAt(g.dyn, b, 0.55) : dynamicsAt(this.piece, b);
    }

    // count-in clicks
    while (this.clicksEmitted < this.countIn) {
      const beat = -this.countIn + this.clicksEmitted;
      const t = clock.timeAt(beat);
      if (t >= horizon) break;
      events.push({ type: 'click', time: t, count: this.clicksEmitted + 1, of: this.countIn });
      this.clicksEmitted++;
    }
    if (this.state === 'countIn' && clock.timeAt(0) < horizon) {
      this.state = 'playing';
      events.push({ type: 'start', time: clock.timeAt(0) });
    }
    if (this.state === 'countIn') return { notes, events };

    // rehearsal marks and entry hints (one beat early)
    const marks = this.piece.marks;
    while (this.marksEmitted < marks.length && clock.timeAt(marks[this.marksEmitted].beat) < horizon) {
      const m = marks[this.marksEmitted++];
      events.push({ type: 'mark', time: clock.timeAt(m.beat), phrase: m.phrase, bar: m.bar });
    }
    const entries = this.piece.entries;
    while (this.entriesEmitted < entries.length && clock.timeAt(entries[this.entriesEmitted].beat - 1) < horizon) {
      const e = entries[this.entriesEmitted++];
      events.push({ type: 'entry-soon', time: clock.timeAt(e.beat - 1), entry: e });
    }

    // notes
    for (const { event: n, time } of this.notes.tick(now)) {
      const held = n.beat >= this.finalBeat - 1e-6;
      const dur = held ? 3600 : clock.timeAt(n.beat + n.dur) - time;
      const s: ScheduledNote = { time, dur, held, note: n, mix: this.mixGain(n.section) };
      notes.push(s);
      this.inFlight.push(s);
    }
    if (this.inFlight.length > 64) this.inFlight = this.inFlight.filter((n) => n.held || n.time + n.dur > now);

    // per-beat take samples
    const b = Math.floor(clock.beatAt(now));
    if (b > this.lastSampledBeat && b >= 0) {
      this.lastSampledBeat = b;
      this.take.tempo.push([b, +clock.baseBpm.toFixed(2)]);
      this.take.dyn.push([b, +this.level.toFixed(3)]);
    }

    // the final fermata
    if (this.state === 'playing' && this.notes.done && now >= clock.timeAt(this.finalBeat)) {
      this.state = 'fermata';
      this.fermataTime = now;
      events.push({ type: 'fermata', time: now });
    }
    if (this.state === 'fermata' && this.fermataTime !== null) {
      const hold = this.opts.mode === 'listen' ? 3 : this.opts.fermataHold;
      if (now - this.fermataTime >= hold) {
        const r = this.cutoff(now, true);
        if (r) events.push(r.event);
      }
    }
    return { notes, events };
  }

  /** Listen mode tempo: the score tempo, with a gentle ritardando over the last two bars. */
  private listenTempo(beat: number): number {
    const bpm = this.piece.json.bpm;
    const ritStart = this.piece.totalBeats - 2 * this.beatsPerBar;
    if (beat < ritStart) return bpm;
    const t = clamp((beat - ritStart) / (2 * this.beatsPerBar), 0, 1);
    return bpm * (1 - 0.18 * t);
  }
}
