/**
 * Beat (ictus) detection from the right wrist's height.
 *
 * The ictus is the moment the baton "hits" the beat. We find it as a peak in the wrist's downward vertical
 * velocity, with hysteresis: a stroke arms when the downward speed crosses an adaptive threshold, and fires
 * once the speed has fallen back below a fraction of that stroke's peak. The peak time is refined with
 * parabolic interpolation so 72 Hz sampling doesn't quantise the tempo. Intervals go through an outlier
 * filter (missed beats are split, double-triggers rejected) and the tempo is the mean of the last few accepted intervals.
 */
import { clamp, mean, median, stddev } from './math.js';

export interface BeatTrackerOptions {
  minBpm: number;
  maxBpm: number;
  /** Position low-pass time constant (s). */
  posTau: number;
  /** Velocity low-pass time constant (s). */
  velTau: number;
  /** Absolute minimum downward speed (m/s) that arms a stroke. */
  armSpeed: number;
  /** Adaptive arm threshold as a fraction of the running average stroke peak. */
  armFraction: number;
  /** A stroke fires when its speed drops below this fraction of its own peak (the hysteresis). */
  releaseFraction: number;
  /** Samples that jump further than this from the filtered height are tracking glitches and dropped (m). */
  maxJump: number;
  /** How many intervals the tempo median uses. */
  history: number;
}

export const DEFAULT_BEAT_OPTIONS: BeatTrackerOptions = {
  minBpm: 60,
  maxBpm: 160,
  posTau: 0.01,
  velTau: 0.025,
  armSpeed: 0.2,
  armFraction: 0.4,
  releaseFraction: 0.3,
  maxJump: 0.2,
  history: 4,
};

export interface Ictus {
  /** Refined time of the velocity peak (same clock as the samples). */
  time: number;
  /** Peak downward speed of the stroke (m/s). */
  speed: number;
  /** Seconds since the previous ictus, or null for the first one after a pause. */
  interval: number | null;
  /** Tempo estimate after this ictus, or null while there's no interval yet. */
  bpm: number | null;
  /** False when the interval was rejected as an outlier (the ictus still happened). */
  accepted: boolean;
}

export class BeatTracker {
  readonly opts: BeatTrackerOptions;
  private lastT: number | null = null;
  private yf = 0;
  private vf = 0;
  private armed = false;
  private peakSpeed = 0;
  private peakTime = 0;
  private prevSpeed = 0;
  private prevTime = 0;
  private peakPrevSpeed = 0;
  private peakNextSpeed: number | null = null;
  private peakDt = 1 / 72;
  private peakAvg = 0;
  private lastIctus: number | null = null;
  private intervals: number[] = [];
  private pending: number[] = [];
  /** Consecutive samples rejected as jumps. A one-frame spike stays at 1; a hand that moved stays high. */
  private glitchRun = 0;
  glitches = 0;

  constructor(opts: Partial<BeatTrackerOptions> = {}) {
    this.opts = { ...DEFAULT_BEAT_OPTIONS, ...opts };
  }

  reset(): void {
    this.lastT = null;
    this.armed = false;
    this.vf = 0;
    this.peakAvg = 0;
    this.lastIctus = null;
    this.intervals = [];
    this.pending = [];
    this.glitchRun = 0;
  }

  /** Current tempo estimate, or null before two ictuses. */
  get bpm(): number | null {
    if (this.intervals.length === 0) return null;
    // the mean of consecutive accepted intervals is the span over the count, so per-ictus timing noise
    // only enters at the two ends; outliers were already filtered out
    return clamp(60 / mean(this.intervals), this.opts.minBpm, this.opts.maxBpm);
  }

  /** Relative spread of recent intervals (0 = metronomic). Drawn as the tolerance ring. */
  get spread(): number {
    if (this.intervals.length < 2) return 1;
    return stddev(this.intervals) / median(this.intervals);
  }

  /** 0..1: how much to trust the tempo (needs a few steady beats). */
  get confidence(): number {
    if (this.intervals.length === 0) return 0;
    return clamp(1 - this.spread * 4, 0, 1) * Math.min(1, this.intervals.length / 3);
  }

  get lastIctusTime(): number | null {
    return this.lastIctus;
  }

  /** Smoothed vertical velocity (m/s, up positive). */
  get velocity(): number {
    return this.vf;
  }

  /** Feed one wrist-height sample. Returns an ictus when one completes on this sample. */
  push(t: number, y: number): Ictus | null {
    const o = this.opts;
    if (this.lastT === null) {
      this.lastT = t;
      this.yf = y;
      this.vf = 0;
      return null;
    }
    const dt = t - this.lastT;
    if (dt <= 0) return null;
    if (dt > 0.25) {
      // tracking was lost; restart the filters but keep the tempo history
      this.lastT = t;
      this.yf = y;
      this.vf = 0;
      this.armed = false;
      this.glitchRun = 0;
      return null;
    }
    if (Math.abs(y - this.yf) > o.maxJump) {
      // Drop the sample. A one-frame spike must not move the filter (the next sample is back).
      // A hand that stays at the new height is a real move: resync, or every later sample is
      // also a "glitch" and the beat tracker never fires again.
      this.glitches++;
      this.glitchRun++;
      if (this.glitchRun >= 3) {
        this.lastT = t;
        this.yf = y;
        this.vf = 0;
        this.armed = false;
        this.glitchRun = 0;
      }
      return null;
    }
    this.glitchRun = 0;
    this.lastT = t;
    const yPrev = this.yf;
    this.yf += (1 - Math.exp(-dt / o.posTau)) * (y - this.yf);
    const vRaw = (this.yf - yPrev) / dt;
    this.vf += (1 - Math.exp(-dt / o.velTau)) * (vRaw - this.vf);
    const speed = -this.vf; // downward speed
    let out: Ictus | null = null;

    const arm = Math.max(o.armSpeed, o.armFraction * this.peakAvg);
    if (!this.armed) {
      if (speed > arm) {
        this.armed = true;
        this.peakSpeed = speed;
        this.peakTime = t;
        this.peakPrevSpeed = this.prevSpeed;
        this.peakNextSpeed = null;
        this.peakDt = dt;
      }
    } else if (speed > this.peakSpeed) {
      this.peakSpeed = speed;
      this.peakTime = t;
      this.peakPrevSpeed = this.prevSpeed;
      this.peakNextSpeed = null;
      this.peakDt = dt;
    } else {
      if (this.peakNextSpeed === null) {
        this.peakNextSpeed = speed;
        this.peakDt = (this.peakDt + dt) / 2;
      }
      if (speed < o.releaseFraction * this.peakSpeed) {
        this.armed = false;
        out = this.fire();
      }
    }
    this.prevSpeed = speed;
    this.prevTime = t;
    return out;
  }

  private fire(): Ictus | null {
    const o = this.opts;
    // parabolic refinement of the peak time
    let time = this.peakTime;
    const s0 = this.peakSpeed;
    const sp = this.peakPrevSpeed;
    const sn = this.peakNextSpeed ?? s0;
    const denom = sp - 2 * s0 + sn;
    if (denom < -1e-9) {
      const off = clamp((0.5 * (sp - sn)) / denom, -0.5, 0.5);
      time += off * this.peakDt;
    }
    this.peakAvg = this.peakAvg === 0 ? s0 : 0.7 * this.peakAvg + 0.3 * s0;

    const minInterval = 60 / o.maxBpm / 1.15;
    const maxInterval = (60 / o.minBpm) * 1.6;
    const prev = this.lastIctus;
    if (prev !== null && time - prev < minInterval) {
      // a double trigger inside one beat: ignore it entirely
      return null;
    }
    this.lastIctus = time;
    if (prev === null || time - prev > maxInterval) {
      this.pending = [];
      return { time, speed: s0, interval: null, bpm: this.bpm, accepted: true };
    }
    const interval = time - prev;
    const accepted = this.acceptInterval(interval);
    return { time, speed: s0, interval, bpm: this.bpm, accepted };
  }

  private acceptInterval(interval: number): boolean {
    const h = this.intervals;
    const push = (x: number) => {
      h.push(x);
      while (h.length > this.opts.history) h.shift();
    };
    if (h.length < 2) {
      push(interval);
      this.pending = [];
      return true;
    }
    const ratio = interval / median(h);
    if (ratio >= 0.7 && ratio <= 1.43) {
      push(interval);
      this.pending = [];
      return true;
    }
    if (ratio >= 1.75 && ratio <= 2.3) {
      // one missed beat: count it as two
      push(interval / 2);
      push(interval / 2);
      this.pending = [];
      return true;
    }
    // outlier; but two consistent outliers in a row mean the tempo really changed
    this.pending.push(interval);
    if (this.pending.length >= 2) {
      const [a, b] = this.pending.slice(-2);
      if (Math.abs(a - b) / Math.max(a, b) < 0.15) {
        this.intervals = [a, b];
        this.pending = [];
        return true;
      }
      this.pending = this.pending.slice(-1);
    }
    return false;
  }
}
