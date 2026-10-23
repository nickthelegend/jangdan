/**
 * window.__jangdan: read-only state for the e2e harness (and for anyone debugging on a headset over
 * Chrome remote debugging). Nothing here changes how the experience behaves.
 */
import { createSystem, type World } from '@iwsdk/core';
import { percentile, SECTIONS } from '@jangdan/core';
import { renderExcerpt } from './audio/offline.js';
import { rt } from './runtime.js';
import { status } from './status.js';
import type { ConductorSystem } from './systems/conductor-system.js';
import type { HudSystem } from './systems/hud-system.js';
import type { StageSystem } from './systems/stage-system.js';

/** Per-frame samples: Jangdan's own main-thread time (all its systems), frame interval, draw calls. */
export const metrics = { cpuFrame: 0, cpu: [] as number[], frameMs: [] as number[], draws: [] as number[], tris: [] as number[] };

/** Registered last: closes the frame's sample. renderer.info holds the previous frame's render (both eyes). */
export class MetricsSystem extends createSystem({}) {
  update(delta: number): void {
    const info = this.renderer.info.render;
    metrics.cpu.push(metrics.cpuFrame);
    metrics.cpuFrame = 0;
    metrics.frameMs.push(delta * 1000);
    metrics.draws.push(info.calls);
    metrics.tris.push(info.triangles);
    for (const a of [metrics.cpu, metrics.frameMs, metrics.draws, metrics.tris]) if (a.length > 4000) a.splice(0, 2000);
  }
}

/** Wrap a system's update so its cost lands in this frame's Jangdan CPU sample. */
export function timeSystem(sys: { update(d: number, t: number): void }): void {
  const orig = sys.update.bind(sys);
  sys.update = (d: number, t: number) => {
    const t0 = performance.now();
    try {
      orig(d, t);
    } finally {
      metrics.cpuFrame += performance.now() - t0;
    }
  };
}

export function installDebug(world: World, c: ConductorSystem, hud: HudSystem, stage: StageSystem): void {
  void world;
  (window as unknown as { __jangdan: unknown }).__jangdan = {
    status: () => JSON.parse(JSON.stringify(status)),
    settings: () => ({ ...rt.settings }),
    log: (type?: string) => (type ? rt.log.filter((l) => l.type === type) : rt.log.slice()),
    stage: () => {
      const st = rt.stage;
      if (!st) return null;
      return {
        realCount: st.result.realCount,
        floorY: st.result.floorY,
        room: st.room,
        reverb: { rt60: st.reverb.rt60, wet: st.reverb.wet, length: st.reverb.length, irSeconds: rt.engine?.convolver.buffer?.duration ?? null },
        surfaces: st.surfaces.map((s) => ({ id: s.id, source: s.source, orientation: s.orientation, area: +s.area.toFixed(2), center: s.center.map((x) => +x.toFixed(2)), role: st.result.roles[s.id], label: s.label })),
        sections: Object.fromEntries(
          SECTIONS.map((s) => {
            const v = st.sections[s];
            const p = st.result.placements[s];
            return [s, { banner: v.banner, surfaceId: v.surfaceId, role: v.role, anchor: v.anchor.map((x) => +x.toFixed(2)), reason: p.kind === 'banner' ? p.reason : null, meshName: v.wash.mesh.name, audioAt: rt.engine?.anchors[s].position.toArray().map((x) => +x.toFixed(2)) }];
          }),
        ),
      };
    },
    perf: () => {
      const p = c.perf;
      return p ? { state: p.state, bpm: +p.bpm.toFixed(2), level: +p.level.toFixed(3), mix: { ...p.mix }, take: { ictus: p.take.ictus.length, cues: p.take.cues } } : null;
    },
    audio: () => {
      const e = rt.engine;
      if (!e) return null;
      return {
        state: e.ctx.state,
        time: e.ctx.currentTime,
        rms: Object.fromEntries(SECTIONS.map((s) => [s, e.rms(s)])),
        panning: Object.fromEntries(SECTIONS.map((s) => [s, e.positional[s].panner.panningModel])),
      };
    },
    hudAngles: () => JSON.parse(JSON.stringify(hud.angles)),
    glasses: () => rt.glasses,
    /** Sanity render through the real synth into an OfflineAudioContext. */
    renderExcerpt: (piece = 0) => renderExcerpt(piece),
    metrics: (lastN = 600) => {
      const cpu = metrics.cpu.slice(-lastN);
      const f = metrics.frameMs.slice(-lastN);
      const d = metrics.draws.slice(-lastN);
      const t = metrics.tris.slice(-lastN);
      return {
        samples: cpu.length,
        cpuP95: +percentile(cpu, 0.95).toFixed(3),
        cpuMax: +Math.max(...cpu).toFixed(3),
        frameP50: +percentile(f, 0.5).toFixed(2),
        frameP95: +percentile(f, 0.95).toFixed(2),
        drawCallsMax: Math.max(...d),
        drawCallsP95: percentile(d, 0.95),
        trianglesMax: Math.max(...t),
      };
    },
    resetMetrics: () => {
      for (const a of [metrics.cpu, metrics.frameMs, metrics.draws, metrics.tris]) a.length = 0;
    },
    rescan: () => stage.rescan(),
  };
}
