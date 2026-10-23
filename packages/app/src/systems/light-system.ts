/**
 * Light follows sound: every scheduled note becomes a ripple on its section's surface (pitch sets where
 * across the surface it lands), each section glows with the energy of its sounding notes, and the
 * conductor's dynamics set how far the colour floods. The walls go dark at once on the cut-off.
 */
import { createSystem, Raycaster, Vector3, VisibilityState } from '@iwsdk/core';
import { palmCenter, SECTIONS, type SectionId, smoothstep } from '@jangdan/core';
import type { LightPulse } from '../audio/engine.js';
import { rt } from '../runtime.js';
import { status } from '../status.js';
import { setLabelState } from './stage-system.js';
import type { ConductorSystem } from './conductor-system.js';

const ENV: Record<SectionId, { a: number; sus: number; tauD: number; rel: number; k: number }> = {
  strings: { a: 0.18, sus: 0.75, tauD: 0.5, rel: 0.5, k: 0.32 },
  winds: { a: 0.05, sus: 0.65, tauD: 0.25, rel: 0.25, k: 0.85 },
  brass: { a: 0.04, sus: 0.6, tauD: 0.2, rel: 0.3, k: 0.75 },
  percussion: { a: 0.004, sus: 0, tauD: 0.12, rel: 0.1, k: 0.9 },
};

function pulseLevel(p: LightPulse, now: number): number {
  const e = ENV[p.section];
  const t = now - p.time;
  if (t < 0) return 0;
  const att = Math.min(1, t / e.a);
  const sustained = e.sus + (1 - e.sus) * Math.exp(-Math.max(0, t - e.a) / e.tauD);
  let v = att * sustained;
  if (t > p.dur) v *= Math.exp(-(t - p.dur) / (e.rel / 2));
  return v * p.vel * e.k * (p.stroke === 'B' ? 1.6 : 1);
}

export class LightSystem extends createSystem({}) {
  private done = new WeakSet<LightPulse>();
  private level: Record<SectionId, number> = { strings: 0, winds: 0, brass: 0, percussion: 0 };
  private settled = new Set<SectionId>();
  private head = new Vector3();
  private ray = new Raycaster();
  private lastPaint = { left: 0, right: 0 };
  private prevPalm = { left: new Vector3(), right: new Vector3() };
  private tmp = new Vector3();
  private conductor: ConductorSystem | null = null;
  setConductor(c: ConductorSystem): void {
    this.conductor = c;
  }

  update(dt: number, time: number): void {
    const st = rt.stage;
    const eng = rt.engine;
    if (!st || !eng || this.visibilityState.peek() === VisibilityState.NonImmersive) {
      this.settled.clear();
      return;
    }
    const now = eng.ctx.currentTime;
    const calm = rt.settings.reducedFlash;
    this.player.head.getWorldPosition(this.head);

    // per-section energy from sounding notes; new onsets become ripples
    const sum: Record<SectionId, number> = { strings: 0, winds: 0, brass: 0, percussion: 0 };
    for (const p of eng.pulses) {
      if (p.time > now) continue;
      sum[p.section] += pulseLevel(p, now);
      if (!this.done.has(p)) {
        this.done.add(p);
        const v = st.sections[p.section];
        if (!v) continue;
        const w = v.wash;
        let x = w.center.x;
        let z = w.center.y;
        if (p.section === 'percussion') {
          const h = Math.sin(p.time * 91.7) * 0.5;
          if (p.stroke === 'T' || p.stroke === 'R') {
            x += h * w.half.x;
            z += Math.cos(p.time * 57.3) * 0.4 * w.half.y;
          } else if (p.stroke === 'K') x -= 0.35 * w.half.x;
        } else {
          const u = Math.max(0, Math.min(1, (p.midi - 38) / 48));
          x += (u - 0.5) * 1.5 * w.half.x;
          z += Math.sin(p.midi * 1.7) * 0.35 * w.half.y;
        }
        const strength = Math.min(1.2, p.vel * (p.section === 'percussion' ? 1.1 : 0.8)) * (calm ? 0.35 : 1);
        w.ripple(x, z, p.time, strength);
      }
    }
    const tau = calm ? 0.25 : 0.05;
    const k = 1 - Math.exp(-dt / tau);
    const cutAge = status.cutAt >= 0 ? now - status.cutAt : Infinity;
    const dark = cutAge < 0 ? 0 : cutAge < 1.2 ? 1 : 1 - smoothstep(1.2, 3.2, cutAge);
    const dyn = status.level;

    SECTIONS.forEach((s, i) => {
      const v = st.sections[s];
      if (!v) return;
      // settle: the four glows arrive one after another when the stage is built
      const t0 = st.readyAt + i * 0.28;
      const idleIn = smoothstep(t0, t0 + 1.4, time);
      if (!this.settled.has(s)) {
        this.settled.add(s);
        v.wash.ripple(v.wash.center.x, v.wash.center.y, now + i * 0.28, calm ? 0.4 : 1);
      }
      const mixDim = this.conductor?.perf ? this.conductor.perf.mixGain(s) : 1;
      this.level[s] += (Math.min(1.3, sum[s]) * (0.4 + 0.6 * mixDim) - this.level[s]) * k;
      if (dark >= 1) this.level[s] = 0;
      v.cue *= Math.exp(-dt * 2.2);
      v.hint *= Math.exp(-dt * 0.8);
      const hintPulse = v.hint > 0.02 ? v.hint * (0.5 + 0.5 * Math.sin(now * 10)) * 0.35 : 0;
      v.wash.set({
        level: this.level[s] * (0.35 + 0.65 * dyn),
        dyn,
        time: now,
        hover: v.hover,
        cue: (v.cue * 0.9 + hintPulse) * (calm ? 0.5 : 1),
        idle: idleIn * (status.phase === 'playing' ? 0.6 : 1),
        flash: calm ? 0.4 : 1,
        dark,
      });
      if (dark >= 1) v.wash.clearRipples();
      // labels face the listener
      v.label.mesh.lookAt(this.head);
      const mix = this.conductor?.perf?.mix[s] ?? 'on';
      setLabelState(v, mix !== 'on' ? mix : v.hint > 0.3 ? 'cue!' : '');
    });

    // listen mode: small hand sweeps paint light where the hand's ray meets a surface
    if (this.conductor?.perf?.opts.mode === 'listen' && this.conductor) {
      for (const side of ['left', 'right'] as const) {
        if (!this.conductor.hands.tracked[side]) continue;
        const j = this.conductor.hands.joints[side];
        const pc = palmCenter(j);
        this.tmp.set(pc[0], pc[1], pc[2]);
        const speed = this.tmp.distanceTo(this.prevPalm[side]) / Math.max(dt, 1e-3);
        this.prevPalm[side].copy(this.tmp);
        if (speed < 0.45 || now - this.lastPaint[side] < 0.12) continue;
        const rs = this.player.raySpaces[side];
        rs.updateWorldMatrix(true, false);
        this.ray.ray.origin.setFromMatrixPosition(rs.matrixWorld);
        this.ray.ray.direction.set(0, 0, -1).transformDirection(rs.matrixWorld);
        const hit = this.ray.intersectObjects(st.meshes, false)[0];
        if (!hit) continue;
        this.lastPaint[side] = now;
        const view = Object.values(st.sections).find((x) => x.wash.mesh === hit.object);
        if (!view) continue;
        const local = view.wash.mesh.worldToLocal(hit.point.clone());
        view.wash.ripple(local.x, local.z, now, Math.min(1, speed / 1.5) * (calm ? 0.35 : 0.9));
      }
    }
  }
}
