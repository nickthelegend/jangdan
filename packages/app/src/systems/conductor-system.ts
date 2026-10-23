/**
 * The conductor: hands in, music out. Right-hand ictus sets the tempo, left-palm height the dynamics,
 * a fist with either hand cuts off. Drives core/Performance on the AudioContext clock and plays what it
 * schedules through the audio engine. Also owns listen mode, ghost replay and the calibration tap.
 */
import { createSystem, VisibilityState } from '@iwsdk/core';
import {
  BeatTracker,
  compilePiece,
  type CompiledPiece,
  dailySeed,
  FistDetector,
  generatePiece,
  isPalmUp,
  J,
  levelFromPalmHeight,
  markForLevel,
  median,
  Performance,
  type PerfEvent,
  PIECES,
  scoreTake,
  SECTION_LABEL,
  type SectionId,
  Smoother,
} from '@jangdan/core';
import { HandReader } from '../hands.js';
import { rt } from '../runtime.js';
import { status } from '../status.js';
import { store } from '../store.js';

const ROLE_WORDS: Record<string, string> = {
  'wall-left': 'the left wall',
  'wall-right': 'the right wall',
  'wall-front': 'the front wall',
  'wall-behind': 'the back wall',
  ceiling: 'the ceiling',
  table: 'the table',
  floor: 'the floor',
};

export const actions = {
  selectPiece: (_i: number) => {},
  setMode: (_m: 'conduct' | 'listen' | 'ghost') => {},
  toggleFlash: () => {},
  toggleOneHand: () => {},
  calibrate: () => {},
  cue: (_s: SectionId) => {},
  cycleMix: (_s: SectionId) => {},
};

export function pieceAt(i: number): CompiledPiece {
  if (i < PIECES.length) return compilePiece(PIECES[i]);
  return compilePiece(generatePiece(dailySeed(new Date())));
}

export class ConductorSystem extends createSystem({}) {
  readonly hands = new HandReader();
  private tracker = new BeatTracker();
  private tapTracker = new BeatTracker({ armSpeed: 0.12, armFraction: 0.35, maxJump: 0.15 });
  private fistL = new FistDetector();
  private fistR = new FistDetector();
  private level = new Smoother(0.5, 0.25);
  perf: Performance | null = null;
  piece: CompiledPiece = pieceAt(0);
  private raisedSince = -1;
  private resultsUntil = 0;
  private listenNextAt = -1;
  private timeline: { time: number; run: () => void }[] = [];
  private offset = 0;
  private offsetInit = false;
  private calClicks: number[] = [];
  private calTaps: number[] = [];
  private calEnd = 0;
  private lastResume = 0;
  private palmUpSince = -1;

  init(): void {
    try {
      rt.settings.latency = Number(localStorage.getItem('jangdan.latency') ?? 0) || 0;
      rt.settings.reducedFlash = localStorage.getItem('jangdan.calm') === '1';
      rt.settings.oneHand = localStorage.getItem('jangdan.onehand') === '1';
    } catch {
      /* storage blocked: defaults */
    }
    actions.selectPiece = (i) => {
      rt.settings.pieceIndex = i;
      this.piece = pieceAt(i);
      this.abort();
      this.toReady();
      if (rt.settings.mode !== 'conduct') this.listenNextAt = this.audioNow() + 0.8;
    };
    actions.setMode = (m) => {
      rt.settings.mode = m;
      this.abort();
      this.toReady();
      if (m !== 'conduct') this.listenNextAt = this.audioNow() + 0.8;
    };
    actions.toggleFlash = () => {
      rt.settings.reducedFlash = !rt.settings.reducedFlash;
      this.save('jangdan.calm', rt.settings.reducedFlash ? '1' : '0');
    };
    actions.toggleOneHand = () => {
      rt.settings.oneHand = !rt.settings.oneHand;
      this.save('jangdan.onehand', rt.settings.oneHand ? '1' : '0');
      this.toReady();
    };
    actions.calibrate = () => this.startCalibration();
    actions.cue = (s) => this.cue(s);
    actions.cycleMix = (s) => this.cycleMix(s);
    this.cleanupFuncs.push(
      this.visibilityState.subscribe((vs) => {
        if (vs === VisibilityState.NonImmersive) {
          this.abort();
          status.phase = 'off';
        }
      }),
    );
  }

  private save(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }

  audioNow(): number {
    return rt.engine ? rt.engine.ctx.currentTime : performance.now() / 1000;
  }

  /** Map this frame's wall-clock time onto the AudioContext clock. */
  private frameAudioTime(): number {
    const ctx = rt.engine!.ctx;
    const pnow = performance.now() / 1000;
    const ts = ctx.getOutputTimestamp?.();
    let off: number;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      off = ts.contextTime - ts.performanceTime / 1000;
    } else {
      off = ctx.currentTime - pnow;
    }
    if (!this.offsetInit) {
      this.offset = off;
      this.offsetInit = true;
    } else {
      this.offset += 0.05 * (off - this.offset);
    }
    return pnow + this.offset;
  }

  private abort(): void {
    if (this.perf && this.perf.state !== 'idle' && this.perf.state !== 'cutoff' && rt.engine) {
      rt.engine.cutoff(this.audioNow());
    }
    this.perf = null;
    this.timeline = [];
    status.count = 0;
  }

  private toReady(): void {
    rt.engine?.reopen();
    status.phase = rt.stage ? 'ready' : 'scan';
    status.results = null;
    status.mark = '';
    status.count = 0;
    this.raisedSince = -1;
    this.tracker.reset();
    this.tapTracker.reset();
    status.pieceTitle = this.piece.json.title;
    status.pieceSub = this.piece.json.subtitle ?? '';
    status.mode = rt.settings.mode;
    status.beatsPerBar = this.piece.json.beatsPerBar;
  }

  private cue(s: SectionId): void {
    const now = this.audioNow();
    const view = rt.stage?.sections[s];
    if (view) view.cue = 1;
    if (!this.perf || this.perf.state === 'idle' || this.perf.state === 'cutoff') {
      rt.push('cue', { section: s, beat: null, entry: null });
      status.sub = `${SECTION_LABEL[s]} ready`;
      return;
    }
    const rec = this.perf.cue(s, now);
    rt.push('cue', { section: s, beat: +rec.beat.toFixed(2), entry: rec.entryBeat });
    if (rec.entryBeat !== null) {
      const d = rec.beat - rec.entryBeat;
      status.sub = `${SECTION_LABEL[s]} cued ${Math.abs(d) < 0.5 ? 'on time' : d < 0 ? `${(-d).toFixed(1)} beats early` : `${d.toFixed(1)} beats late`}`;
    } else {
      status.sub = `${SECTION_LABEL[s]} cued`;
    }
  }

  private cycleMix(s: SectionId): void {
    if (!this.perf) return;
    const m = this.perf.cycleMix(s);
    rt.push('mix', { section: s, mix: m });
    status.sub = `${SECTION_LABEL[s]}: ${m === 'on' ? 'back in' : m}`;
  }

  private startPerformance(time: number, bpm?: number): void {
    const mode = rt.settings.mode;
    rt.engine!.reopen();
    const opts: ConstructorParameters<typeof Performance>[1] = { mode: mode === 'conduct' ? 'conduct' : 'listen' };
    this.perf = new Performance(this.piece, opts);
    this.perf.start(time, bpm);
    status.phase = 'countIn';
    status.results = null;
    rt.push('start', { piece: this.piece.json.id, mode, bpm: +this.perf.bpm.toFixed(1), time: +time.toFixed(3) });
  }

  private async startGhost(time: number): Promise<void> {
    const take = await store.lastTake(this.piece.json.id);
    if (!take || take.tempo.length < 4) {
      status.sub = 'No take of this piece yet: conduct it once, then Ghost replays you';
      rt.settings.mode = 'listen';
      status.mode = 'listen';
      this.startPerformance(time);
      return;
    }
    rt.engine!.reopen();
    this.perf = new Performance(this.piece, { mode: 'listen', ghost: take });
    this.perf.start(time);
    status.phase = 'countIn';
    status.sub = 'Ghost: your last take, replayed';
    rt.push('start', { piece: this.piece.json.id, mode: 'ghost', bpm: +this.perf.bpm.toFixed(1) });
  }

  private startCalibration(): void {
    this.abort();
    const now = this.audioNow() + 1.0;
    const spb = 60 / 90;
    this.calClicks = Array.from({ length: 8 }, (_, i) => now + i * spb);
    this.calTaps = [];
    this.calEnd = now + 8 * spb + 0.4;
    for (const [i, t] of this.calClicks.entries()) rt.engine?.click(t, i % 4 === 0);
    status.phase = 'calibrate';
    status.cal = { taps: 0, of: 8 };
    status.caption = 'Calibrate: beat along with the clicks';
    status.sub = 'Drop your right hand on each click';
  }

  private finishCalibration(): void {
    const offs: number[] = [];
    for (const t of this.calTaps) {
      let best = Infinity;
      for (const c of this.calClicks) if (Math.abs(t - c) < Math.abs(best)) best = t - c;
      if (Math.abs(best) < 0.25) offs.push(best);
    }
    if (offs.length >= 4) {
      rt.settings.latency = Math.max(-0.2, Math.min(0.2, median(offs.slice(2))));
      this.save('jangdan.latency', String(rt.settings.latency));
      status.sub = `Latency ${(rt.settings.latency * 1000).toFixed(0)} ms, saved`;
    } else {
      status.sub = 'Too few beats caught, latency unchanged';
    }
    rt.push('calibrated', { taps: offs.length, latency: rt.settings.latency });
    this.toReady();
  }

  private onPerfEvent(e: PerfEvent): void {
    const eng = rt.engine!;
    switch (e.type) {
      case 'click':
        eng.click(e.time, e.count === 1);
        this.at(e.time, () => {
          status.count = e.count;
          status.countOf = e.of;
        });
        break;
      case 'start':
        this.at(e.time, () => {
          status.phase = 'playing';
          status.count = 0;
          rt.push('music', { time: +e.time.toFixed(3) });
        });
        break;
      case 'mark':
        this.at(e.time, () => {
          status.mark = e.phrase.replace(/2$/, "'");
          status.bar = e.bar;
        });
        break;
      case 'entry-soon': {
        const s = e.entry.section;
        this.at(e.time, () => {
          const v = rt.stage?.sections[s];
          if (v) v.hint = 1;
          if (rt.settings.mode === 'conduct') {
            const where = v ? (v.banner ? 'its banner' : ROLE_WORDS[v.role] ?? 'its surface') : 'its surface';
            status.sub = `Cue the ${SECTION_LABEL[s].toLowerCase()}: point at ${where} and pinch`;
          }
          rt.push('entry', { section: s, beat: e.entry.beat });
        });
        break;
      }
      case 'fermata':
        status.phase = 'fermata';
        status.caption = rt.settings.mode === 'conduct' ? 'Hold it... then close your fist' : '';
        rt.push('fermata', {});
        break;
      case 'cutoff':
        this.cutoff(e.time, true);
        break;
    }
  }

  private at(time: number, run: () => void): void {
    this.timeline.push({ time, run });
  }

  private cutoff(time: number, auto: boolean): void {
    const perf = this.perf;
    if (!perf) return;
    const r = auto ? { releaseAt: time } : perf.cutoff(time);
    if (!r) return;
    rt.engine!.cutoff(r.releaseAt);
    status.cutAt = r.releaseAt;
    status.phase = 'results';
    status.count = 0;
    status.caption = 'your room is the hall';
    this.timeline = [];
    rt.push('cutoff', { time: +r.releaseAt.toFixed(3), auto, beat: +perf.beatAt(r.releaseAt).toFixed(2), completed: perf.take.completed });
    const mode = rt.settings.mode;
    if (mode === 'conduct' && perf.take.ictus.length >= 4) {
      const score = scoreTake(perf.take);
      status.results = { score, best: null, isBest: false, completed: perf.take.completed };
      void store.saveTake(perf.take, score).then(({ previous, isBest }) => {
        if (status.results) {
          status.results.best = previous?.total ?? null;
          status.results.isBest = isBest;
        }
        rt.push('score', { total: score.total, steadiness: +score.steadiness.toFixed(2), cue: +score.cueTiming.toFixed(2), range: +score.dynamicRange.toFixed(2), isBest });
      });
    } else {
      status.results = { score: null, best: null, isBest: false, completed: perf.take.completed };
    }
    this.resultsUntil = this.audioNow() + 6;
    if (mode !== 'conduct') {
      // listen mode is a concert: the next piece follows
      this.listenNextAt = this.audioNow() + 6.5;
      if (perf.take.completed) {
        rt.settings.pieceIndex = (rt.settings.pieceIndex + 1) % (PIECES.length + 1);
        this.piece = pieceAt(rt.settings.pieceIndex);
      }
    }
    this.perf = null;
  }

  update(): void {
    const t0 = performance.now();
    if (this.visibilityState.peek() === VisibilityState.NonImmersive || !rt.engine) return;
    const eng = rt.engine;
    if (eng.ctx.state !== 'running') {
      // browsers only start audio after a user gesture; an XR pinch counts as one
      const sel = (this.input.xr as unknown as { getSelectState(h: 'left' | 'right'): { start: boolean } });
      const pinched = sel.getSelectState?.('left')?.start || sel.getSelectState?.('right')?.start;
      if (pinched || t0 - this.lastResume > 1000) {
        this.lastResume = t0;
        void eng.resume();
      }
    }
    const frame = this.xrFrame as XRFrame | undefined;
    const ref = this.renderer.xr.getReferenceSpace();
    const xr = this.input.xr as unknown as { getPrimaryInputSource(h: 'left' | 'right'): XRInputSource | undefined };
    this.player.updateWorldMatrix(true, false);
    this.hands.read(frame, ref, (s) => xr.getPrimaryInputSource(s), this.player.matrixWorld);
    const now = eng.ctx.currentTime;
    const ft = this.frameAudioTime();
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    const headY = head.matrixWorld.elements[13];
    status.handsSeen ||= this.hands.tracked.left || this.hands.tracked.right;

    // run due timeline items (visuals that follow the audio clock)
    if (this.timeline.length) {
      this.timeline.sort((a, b) => a.time - b.time);
      while (this.timeline.length && this.timeline[0].time <= now) this.timeline.shift()!.run();
    }

    if (eng.ctx.state !== 'running') {
      status.phase = 'scan';
      status.caption = 'Pinch to start the sound';
      status.sub = 'The browser holds audio until you interact';
      return;
    }
    if (!rt.stage) {
      status.phase = 'scan';
      status.caption = 'Finding your walls...';
      status.sub = '';
      return;
    }
    if (status.phase === 'scan' || status.phase === 'off') this.toReady();

    const R = this.hands.joints.right;
    const L = this.hands.joints.left;
    const oneHand = rt.settings.oneHand;

    // wrist menu: left palm up, near the body, held briefly (never mid-phrase by accident)
    const playing = this.perf && (this.perf.state === 'playing' || this.perf.state === 'countIn');
    const palmUp = this.hands.tracked.left && isPalmUp(L, 'left') && Math.hypot(L[0] - head.matrixWorld.elements[12], L[2] - head.matrixWorld.elements[14]) < 0.6;
    if (palmUp) {
      if (this.palmUpSince < 0) this.palmUpSince = now;
    } else this.palmUpSince = -1;
    status.menuOpen = palmUp && now - this.palmUpSince > (playing ? 1.0 : 0.25);

    // dynamics: left palm height (one-hand mode: the right palm)
    const dynHand = oneHand ? R : L;
    const dynTracked = oneHand ? this.hands.tracked.right : this.hands.tracked.left;
    if (dynTracked && !status.menuOpen) {
      const palmY = (dynHand[1] + dynHand[J.middleProximal * 3 + 1]) / 2;
      this.level.update(levelFromPalmHeight(palmY, headY), 1 / 72);
    }
    status.level = this.perf && this.perf.opts.mode === 'listen' ? this.perf.level : this.level.value;
    status.dynMark = markForLevel(status.level);
    this.perf?.setLevel(this.level.value);
    eng.setLevel(status.level);

    // beats: right wrist height (one-hand mode: the index fingertip's tap)
    let ictus: ReturnType<BeatTracker['push']> = null;
    const tracker = oneHand ? this.tapTracker : this.tracker;
    if (this.hands.tracked.right) {
      const y = oneHand ? R[J.indexTip * 3 + 1] : R[1];
      ictus = tracker.push(ft, y);
      if (ictus) {
        status.ictusAt = now;
        rt.push('ictus', { t: +ictus.time.toFixed(3), bpm: tracker.bpm ? +tracker.bpm.toFixed(1) : null, accepted: ictus.accepted });
      }
    }
    status.spread = tracker.spread;
    status.confidence = tracker.confidence;

    // fist: either hand cuts off
    const fist = (this.hands.tracked.left && this.fistL.update(now, L)) || (this.hands.tracked.right && this.fistR.update(now, R));
    if (fist) rt.push('fist', { t: +now.toFixed(3) });

    const ictusTime = ictus ? ictus.time - rt.settings.latency : 0;
    const mode = rt.settings.mode;

    switch (status.phase) {
      case 'calibrate':
        if (ictus) {
          this.calTaps.push(ictus.time);
          status.cal.taps = this.calTaps.length;
        }
        if (now > this.calEnd) this.finishCalibration();
        break;
      case 'ready':
      case 'raised': {
        if (mode !== 'conduct') {
          status.caption = mode === 'ghost' ? 'Ghost replay' : 'Listen';
          status.sub ||= 'Sit back. Sweep a hand to paint light.';
          if (this.listenNextAt > 0 && now >= this.listenNextAt) {
            this.listenNextAt = -1;
            if (mode === 'ghost') void this.startGhost(now + 0.1);
            else this.startPerformance(now + 0.1);
          } else if (this.listenNextAt < 0) this.listenNextAt = now + 1.2;
          break;
        }
        const raised = this.hands.tracked.right && R[1] > headY - 0.32;
        if (raised) {
          if (this.raisedSince < 0) this.raisedSince = now;
        } else if (!ictus) this.raisedSince = -1;
        if (oneHand) {
          status.caption = 'Tap down with your index finger to begin';
          status.sub = 'One-hand mode: the same hand sets the dynamics';
          if (ictus) this.startPerformance(ictusTime, tracker.bpm ?? undefined);
        } else if (status.phase === 'ready') {
          status.caption = this.hands.tracked.right ? 'Raise your right hand' : 'Show your hands';
          status.sub ||= `${this.piece.json.title} · ${this.piece.json.bpm} BPM · palm up for the menu`;
          if (this.raisedSince >= 0 && now - this.raisedSince > 0.12) {
            status.phase = 'raised';
            rt.push('raised', {});
          }
        } else {
          status.caption = '...and drop it on the beat';
          if (ictus) this.startPerformance(ictusTime, tracker.bpm ?? undefined);
          else if (this.raisedSince < 0 && !this.hands.tracked.right) status.phase = 'ready';
        }
        break;
      }
      case 'countIn':
      case 'playing':
      case 'fermata': {
        if (status.phase !== 'fermata') status.caption = status.count ? '' : status.mark ? `${this.piece.json.title}` : '';
        if (ictus && this.perf) this.perf.ictus(ictusTime, tracker.bpm);
        if (fist) this.cutoff(now, false);
        break;
      }
      case 'results':
        if (now > this.resultsUntil) {
          status.sub = '';
          this.toReady();
        }
        break;
    }

    if (this.perf) {
      const r = this.perf.tick(now);
      if (r.notes.length) eng.play(r.notes);
      for (const e of r.events) this.onPerfEvent(e);
      if (this.perf) {
        const b = this.perf.beatAt(now);
        status.bpm = this.perf.bpm;
        status.beatPhase = b - Math.floor(b);
        const bpb = this.perf.beatsPerBar;
        status.beatInBar = ((Math.floor(b) % bpb) + bpb) % bpb;
      }
    } else {
      status.bpm = tracker.bpm ?? this.piece.json.bpm;
    }
  }
}
