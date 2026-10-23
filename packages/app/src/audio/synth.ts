/**
 * Web Audio synthesis of the four light-orchestra voices. Every node is scheduled ahead on the
 * AudioContext clock, so the sound itself is computed on the audio thread; the main thread only
 * schedules. Works on a live AudioContext and on an OfflineAudioContext (for the e2e RMS check).
 */
import {
  type DrumVoice,
  type FmVoice,
  midiToHz,
  type ScheduledNote,
  type SectionId,
  VOICES,
  type WavetableVoice,
} from '@jangdan/core';

export interface Voicing {
  /** Release now and silence by `at + 0.1`. */
  stop(at: number): void;
}

const NOOP: Voicing = { stop: () => {} };

export class Synth {
  private wave: PeriodicWave;
  private noise: AudioBuffer;
  private lfo: Record<'strings' | 'winds' | 'brass', GainNode>;
  private lfoOscs: OscillatorNode[] = [];

  constructor(
    readonly ctx: BaseAudioContext,
    readonly outs: Record<SectionId, AudioNode>,
  ) {
    const strings = VOICES.strings as WavetableVoice;
    const real = new Float32Array(strings.harmonics.length + 1);
    const imag = new Float32Array(strings.harmonics.length + 1);
    strings.harmonics.forEach((a, i) => (imag[i + 1] = a));
    this.wave = ctx.createPeriodicWave(real, imag);
    // one second of seeded white noise (deterministic, so offline renders repeat)
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < d.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
    const mk = (sec: 'strings' | 'winds' | 'brass') => {
      const v = VOICES[sec] as WavetableVoice | FmVoice;
      const osc = ctx.createOscillator();
      osc.frequency.value = v.vibrato.rate;
      const g = ctx.createGain();
      g.gain.value = v.vibrato.depthCents;
      osc.connect(g);
      osc.start();
      this.lfoOscs.push(osc);
      return g;
    };
    this.lfo = { strings: mk('strings'), winds: mk('winds'), brass: mk('brass') };
  }

  dispose(): void {
    for (const o of this.lfoOscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
      o.disconnect();
    }
  }

  /** Play one scheduled note at the given dynamics level (0..1); returns a handle to cut it. */
  play(n: ScheduledNote, level: number): Voicing {
    const sec = n.note.section;
    const out = this.outs[sec];
    const vel = n.note.vel * n.mix;
    if (vel <= 0.001) return NOOP;
    const v = VOICES[sec];
    if (v.kind === 'wavetable') return this.wavetable(v, n, vel, level, out);
    if (v.kind === 'fm') return this.fm(v, n, vel, level, out, sec as 'winds' | 'brass');
    return this.drum(v, n, vel, out);
  }

  private envelope(g: GainNode, t0: number, peak: number, a: number, d: number, sus: number, end: number | null, rel: number) {
    const p = g.gain;
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + a);
    p.setTargetAtTime(peak * sus, t0 + a, d / 3);
    if (end !== null) {
      p.cancelScheduledValues(Math.max(end, t0 + a + 0.001));
      p.setTargetAtTime(0, Math.max(end, t0 + a + 0.001), rel / 3);
    }
  }

  private cutter(env: GainNode, srcs: AudioScheduledSourceNode[], nodes: AudioNode[], t0: number): Voicing {
    let stopped = false;
    const cleanup = () => {
      for (const n of nodes) n.disconnect();
    };
    if (srcs.length) srcs[0].onended = cleanup;
    return {
      stop: (at: number) => {
        if (stopped) return;
        stopped = true;
        const when = Math.max(at, this.ctx.currentTime);
        env.gain.cancelScheduledValues(when);
        if (when >= t0) env.gain.setTargetAtTime(0, when, 0.012);
        for (const s of srcs) s.stop(when + 0.1);
      },
    };
  }

  private wavetable(v: WavetableVoice, n: ScheduledNote, vel: number, level: number, out: AudioNode): Voicing {
    const ctx = this.ctx;
    const t0 = n.time;
    const f = midiToHz(n.note.midi);
    const end = n.held ? null : t0 + n.dur;
    const env = ctx.createGain();
    env.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = Math.min(16000, f * (v.brightness.lo + (v.brightness.hi - v.brightness.lo) * level));
    filt.Q.value = 0.6;
    const oscs: OscillatorNode[] = [];
    for (const det of [-v.detuneCents, v.detuneCents]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = f;
      o.detune.value = det;
      this.lfo.strings.connect(o.detune);
      o.connect(filt);
      o.start(t0);
      if (end !== null) o.stop(end + v.env.release * 2.5);
      oscs.push(o);
    }
    filt.connect(env).connect(out);
    this.envelope(env, t0, vel * v.gain, v.env.attack, v.env.decay, v.env.sustain, end, v.env.release);
    return this.cutter(env, oscs, [filt, env, ...oscs], t0);
  }

  private fm(v: FmVoice, n: ScheduledNote, vel: number, level: number, out: AudioNode, sec: 'winds' | 'brass'): Voicing {
    const ctx = this.ctx;
    const t0 = n.time;
    const f = midiToHz(n.note.midi);
    const end = n.held ? null : t0 + n.dur;
    const stopAt = end === null ? null : end + v.env.release * 2.5;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * v.ratio;
    const modGain = ctx.createGain();
    const index = v.index.pp + (v.index.ff - v.index.pp) * level;
    const dev = index * f * v.ratio * (0.6 + 0.4 * vel);
    modGain.gain.setValueAtTime(dev, t0);
    modGain.gain.setTargetAtTime(dev * v.index.sustain, t0 + 0.01, v.index.decay);
    mod.connect(modGain).connect(car.frequency);
    this.lfo[sec].connect(car.detune);
    const env = ctx.createGain();
    env.gain.value = 0;
    car.connect(env).connect(out);
    this.envelope(env, t0, vel * v.gain, v.env.attack, v.env.decay, v.env.sustain, end, v.env.release);
    const srcs: AudioScheduledSourceNode[] = [car, mod];
    const nodes: AudioNode[] = [car, mod, modGain, env];
    if (v.breath > 0) {
      const b = ctx.createBufferSource();
      b.buffer = this.noise;
      b.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(12000, f * 2);
      bp.Q.value = 1.2;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0, t0);
      bg.gain.linearRampToValueAtTime(v.breath * vel, t0 + 0.02);
      bg.gain.setTargetAtTime(v.breath * vel * 0.15, t0 + 0.02, 0.06);
      b.connect(bp).connect(bg).connect(env);
      b.start(t0);
      srcs.push(b);
      nodes.push(b, bp, bg);
    }
    car.start(t0);
    mod.start(t0);
    if (stopAt !== null) for (const s of srcs) s.stop(stopAt);
    return this.cutter(env, srcs, nodes, t0);
  }

  private kung(t: number, vel: number, v: DrumVoice, out: AudioNode, nodes: AudioNode[], srcs: AudioScheduledSourceNode[]) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(v.low.startHz, t);
    o.frequency.exponentialRampToValueAtTime(v.low.endHz, t + v.low.drop);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel * v.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + v.low.decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + v.low.decay + 0.05);
    nodes.push(o, g);
    srcs.push(o);
  }

  private deok(t: number, vel: number, v: DrumVoice, out: AudioNode, nodes: AudioNode[], srcs: AudioScheduledSourceNode[]) {
    const ctx = this.ctx;
    const b = ctx.createBufferSource();
    b.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = v.high.bandHz;
    bp.Q.value = v.high.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel * v.gain * 0.9, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + v.high.decay);
    b.connect(bp).connect(g).connect(out);
    b.start(t, (t * 0.37) % 0.8);
    b.stop(t + v.high.decay + 0.03);
    nodes.push(b, bp, g);
    srcs.push(b);
  }

  /** Jing (gong): inharmonic partials with a long decay and a slight upward wobble. */
  private jing(t: number, vel: number, out: AudioNode, nodes: AudioNode[], srcs: AudioScheduledSourceNode[]) {
    const ctx = this.ctx;
    const base = 98;
    const partials: [number, number, number][] = [
      [1, 1, 4.5],
      [1.47, 0.45, 3.2],
      [2.09, 0.35, 2.4],
      [2.56, 0.22, 1.8],
      [3.18, 0.14, 1.2],
    ];
    for (const [ratio, amp, decay] of partials) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base * ratio, t);
      o.frequency.linearRampToValueAtTime(base * ratio * 1.012, t + 1.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel * amp * 0.22, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
      nodes.push(o, g);
      srcs.push(o);
    }
  }

  private drum(v: DrumVoice, n: ScheduledNote, vel: number, out: AudioNode): Voicing {
    const t = n.time;
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    switch (n.note.stroke) {
      case 'D':
        this.kung(t, vel, v, out, nodes, srcs);
        this.deok(t, vel * 0.8, v, out, nodes, srcs);
        break;
      case 'K':
        this.kung(t, vel, v, out, nodes, srcs);
        break;
      case 'T':
        this.deok(t, vel, v, out, nodes, srcs);
        break;
      case 'R': {
        const step = Math.min(0.11, n.dur / 3);
        this.deok(t, vel * 0.7, v, out, nodes, srcs);
        this.deok(t + step, vel * 0.55, v, out, nodes, srcs);
        this.deok(t + 2 * step, vel * 0.85, v, out, nodes, srcs);
        break;
      }
      case 'B':
        this.jing(t, vel, out, nodes, srcs);
        break;
    }
    // drums are short; a cut silences any that haven't sounded yet
    return {
      stop: (at: number) => {
        for (const s of srcs) {
          try {
            s.stop(Math.max(at, this.ctx.currentTime));
          } catch {
            /* ended */
          }
        }
      },
    };
  }

  /** Count-in click (woodblock): a pitched blip plus a tick. */
  click(t: number, accent: boolean, out: AudioNode): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.25, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.08);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  /** The cut-off bell: a classic FM bell (inharmonic ratio), one clear strike. */
  bell(t: number, out: AudioNode): void {
    const ctx = this.ctx;
    const f = 784; // G5
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 3.5 * 4, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 2.2);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 3.4);
    car.connect(g).connect(out);
    car.start(t);
    mod.start(t);
    car.stop(t + 3.5);
    mod.stop(t + 3.5);
    car.onended = () => {
      for (const nd of [car, mod, mg, g]) nd.disconnect();
    };
  }
}
