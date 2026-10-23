/**
 * The beat clock and the look-ahead scheduler (the "two clocks" pattern): a main-thread tick hands
 * every note that starts inside the next `lookahead` seconds to Web Audio with an exact AudioContext time.
 * Beat times come from an anchored linear map, so tempo changes re-anchor instead of accumulating error.
 */
export class BeatClock {
  anchorTime: number;
  anchorBeat: number;
  bpm: number;
  /** A pending phase bend: from `beat` on, the grid returns to `bpm`. */
  private restore: { beat: number; bpm: number } | null = null;
  constructor(startTime: number, bpm: number, startBeat = 0) {
    this.anchorTime = startTime;
    this.anchorBeat = startBeat;
    this.bpm = bpm;
  }
  /** The tempo the conductor set (a phase bend in progress doesn't change it). */
  get baseBpm(): number {
    return this.restore ? this.restore.bpm : this.bpm;
  }
  get secondsPerBeat(): number {
    return 60 / this.baseBpm;
  }
  private restoreTime(): number {
    return this.anchorTime + ((this.restore!.beat - this.anchorBeat) * 60) / this.bpm;
  }
  beatAt(time: number): number {
    if (this.restore) {
      const tr = this.restoreTime();
      if (time > tr) return this.restore.beat + ((time - tr) * this.restore.bpm) / 60;
    }
    return this.anchorBeat + ((time - this.anchorTime) * this.bpm) / 60;
  }
  timeAt(beat: number): number {
    if (this.restore && beat > this.restore.beat) {
      return this.restoreTime() + ((beat - this.restore.beat) * 60) / this.restore.bpm;
    }
    return this.anchorTime + ((beat - this.anchorBeat) * 60) / this.bpm;
  }
  /** Change tempo from `atTime` on; everything before stays where it was. Cancels a pending bend. */
  setTempo(bpm: number, atTime: number): void {
    const beat = this.beatAt(atTime);
    this.restore = null;
    this.anchorBeat = beat;
    this.anchorTime = atTime;
    this.bpm = bpm;
  }
  /**
   * Phase-lock to the conductor without jumps: stretch or squeeze the time left until the next whole
   * beat by `shift` seconds (clamped to a quarter beat), then return to the base tempo there.
   * Positive shift = the grid moves later. Beat position stays continuous and monotonic.
   */
  bend(shift: number, fromTime: number): void {
    const base = this.baseBpm;
    const spb = 60 / base;
    const s = Math.max(-0.25 * spb, Math.min(0.25 * spb, shift));
    const b0 = this.beatAt(fromTime);
    let target = Math.ceil(b0 + 1e-9);
    if (target - b0 < 0.5) target += 1;
    const remainingBeats = target - b0;
    const remainingTime = remainingBeats * spb;
    this.setTempo(base, fromTime);
    this.bpm = (remainingBeats * 60) / (remainingTime + s);
    this.restore = { beat: target, bpm: base };
  }
}

export interface Timed {
  beat: number;
}

/**
 * Walks a beat-sorted event list and emits each event exactly once, when its time enters the window.
 * Pure: the caller passes `now` (the AudioContext time in the app, a simulated clock in tests).
 */
export class LookaheadScheduler<T extends Timed> {
  private next = 0;
  /** Beat up to which events have been handed out (exclusive). */
  scheduledBeat: number;
  constructor(
    public clock: BeatClock,
    private events: readonly T[],
    public lookahead = 0.12,
    startBeat = -Infinity,
  ) {
    this.scheduledBeat = startBeat;
    while (this.next < events.length && events[this.next].beat < startBeat) this.next++;
  }
  get done(): boolean {
    return this.next >= this.events.length;
  }
  /** Events whose start time falls before now + lookahead, each paired with its absolute time. */
  tick(now: number, out: { event: T; time: number }[] = []): { event: T; time: number }[] {
    const horizonBeat = this.clock.beatAt(now + this.lookahead);
    while (this.next < this.events.length && this.events[this.next].beat < horizonBeat) {
      const e = this.events[this.next++];
      out.push({ event: e, time: this.clock.timeAt(e.beat) });
    }
    if (horizonBeat > this.scheduledBeat) this.scheduledBeat = horizonBeat;
    return out;
  }
  /** Jump (e.g. a restart): drop everything before `beat`. */
  seek(beat: number): void {
    this.next = 0;
    while (this.next < this.events.length && this.events[this.next].beat < beat) this.next++;
    this.scheduledBeat = beat;
  }
}
