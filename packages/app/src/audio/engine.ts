/**
 * The live audio graph. Each section has a bus that feeds (a) a three.js PositionalAudio (an HRTF
 * PannerNode) sitting at the section's surface centroid, sharing IWSDK's AudioListener on the head,
 * and (b) a send into a ConvolverNode whose impulse response is generated from the room's size.
 */
import { type AudioListener, Object3D, PositionalAudio, type Scene } from '@iwsdk/core';
import {
  gainForLevel,
  generateIR,
  type ReverbParams,
  type ScheduledNote,
  SECTIONS,
  type SectionId,
  type Vec3,
} from '@jangdan/core';
import { Synth, type Voicing } from './synth.js';

export interface LightPulse {
  section: SectionId;
  time: number;
  /** Seconds; Infinity for a held fermata note. */
  dur: number;
  vel: number;
  midi: number;
  stroke?: string;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly synth: Synth;
  readonly buses = {} as Record<SectionId, GainNode>;
  readonly dyn = {} as Record<SectionId, GainNode>;
  readonly analysers = {} as Record<SectionId, AnalyserNode>;
  readonly positional = {} as Record<SectionId, PositionalAudio>;
  readonly anchors = {} as Record<SectionId, Object3D>;
  readonly convolver: ConvolverNode;
  readonly wet: GainNode;
  /** Non-positional effects (the cut-off bell) straight to the listener plus reverb. */
  readonly fx: GainNode;
  /** Count-in clicks come from the percussion surface. */
  readonly clickOut: GainNode;
  readonly pulses: LightPulse[] = [];
  private voices = new Map<ScheduledNote, { v: Voicing; end: number }>();
  private level = 0.55;
  private cut = false;
  reverb: ReverbParams | null = null;

  constructor(
    readonly listener: AudioListener,
    scene: Scene,
  ) {
    this.ctx = listener.context;
    const ctx = this.ctx;
    this.convolver = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.25;
    this.convolver.connect(this.wet).connect(listener.getInput());
    this.fx = ctx.createGain();
    this.fx.connect(listener.getInput());
    this.fx.connect(this.convolver);
    for (const s of SECTIONS) {
      const bus = ctx.createGain();
      const dyn = ctx.createGain();
      dyn.gain.value = gainForLevel(this.level);
      bus.connect(dyn);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      dyn.connect(an);
      const send = ctx.createGain();
      send.gain.value = 1;
      dyn.connect(send).connect(this.convolver);
      const pos = new PositionalAudio(listener);
      pos.setNodeSource(dyn as unknown as AudioBufferSourceNode);
      pos.panner.panningModel = 'HRTF';
      pos.setDistanceModel('inverse');
      pos.setRefDistance(1.2);
      pos.setRolloffFactor(0.5);
      const anchor = new Object3D();
      anchor.name = `audio-${s}`;
      anchor.add(pos);
      scene.add(anchor);
      this.buses[s] = bus;
      this.dyn[s] = dyn;
      this.analysers[s] = an;
      this.positional[s] = pos;
      this.anchors[s] = anchor;
    }
    this.clickOut = ctx.createGain();
    this.clickOut.connect(this.positional.percussion.panner);
    this.synth = new Synth(ctx, this.buses);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Room-derived reverb: generate the IR for this room and set the wet level. */
  setRoom(p: ReverbParams, seed = 1): void {
    const [L, R] = generateIR(p, this.ctx.sampleRate, seed);
    const buf = this.ctx.createBuffer(2, L.length, this.ctx.sampleRate);
    buf.copyToChannel(L as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
    this.convolver.buffer = buf;
    this.wet.gain.setTargetAtTime(p.wet, this.ctx.currentTime, 0.1);
    this.reverb = p;
  }

  placeSection(s: SectionId, p: Vec3): void {
    this.anchors[s].position.set(p[0], p[1], p[2]);
    this.anchors[s].updateMatrixWorld(true);
  }

  setLevel(level: number): void {
    this.level = level;
    if (this.cut) return;
    const g = gainForLevel(level);
    const now = this.ctx.currentTime;
    for (const s of SECTIONS) this.dyn[s].gain.setTargetAtTime(g, now, 0.06);
  }

  play(notes: readonly ScheduledNote[]): void {
    const now = this.ctx.currentTime;
    for (const n of notes) {
      // never schedule into the past by more than a frame: late notes start now
      const sn = n.time < now ? { ...n, time: now, dur: Math.max(0.05, n.dur - (now - n.time)) } : n;
      const v = this.synth.play(sn, this.level);
      this.voices.set(n, { v, end: n.held ? Infinity : sn.time + sn.dur + 1 });
      this.pulses.push({
        section: n.note.section,
        time: sn.time,
        dur: n.held ? Infinity : sn.dur,
        vel: n.note.vel * n.mix,
        midi: n.note.midi,
        stroke: n.note.stroke,
      });
    }
    if (this.pulses.length > 96) this.pulses.splice(0, this.pulses.length - 96);
    if (this.voices.size > 128) for (const [k, x] of this.voices) if (x.end < now) this.voices.delete(k);
  }

  click(time: number, accent: boolean): void {
    if (time < this.ctx.currentTime - 0.03) return; // a late click sounds sloppy; the count still shows
    this.synth.click(Math.max(time, this.ctx.currentTime), accent, this.clickOut);
  }

  /** Fist: silence every section now (15 ms release), stop all voices, then one bell. */
  cutoff(at: number): void {
    this.cut = true;
    const t = Math.max(at, this.ctx.currentTime);
    for (const s of SECTIONS) {
      const g = this.dyn[s].gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.015);
    }
    for (const { v } of this.voices.values()) v.stop(t);
    this.voices.clear();
    this.pulses.length = 0;
    this.synth.bell(t + 0.04, this.fx);
  }

  /** Ready for the next performance. */
  reopen(): void {
    this.cut = false;
    const now = this.ctx.currentTime;
    for (const s of SECTIONS) {
      this.dyn[s].gain.cancelScheduledValues(now);
      this.dyn[s].gain.setTargetAtTime(gainForLevel(this.level), now, 0.02);
    }
  }

  private buf = new Float32Array(512);
  /** RMS of a section's dry output right now. */
  rms(s: SectionId): number {
    const an = this.analysers[s];
    an.getFloatTimeDomainData(this.buf);
    let t = 0;
    for (let i = 0; i < this.buf.length; i++) t += this.buf[i] * this.buf[i];
    return Math.sqrt(t / this.buf.length);
  }
}
