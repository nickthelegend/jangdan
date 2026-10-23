/**
 * Head-locked HUD, kept inside the Meta VR Glasses field of view (37° each side, 25° up, 43° down):
 * the caption line, the score ring (beat position, tempo, dynamics, tolerance), the count-in, results,
 * and on Glasses a section strip plus edge arrows pointing at sections outside the view.
 */
import { createSystem, Group, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { PALETTE, SECTION_COLOR, SECTION_LABEL, SECTIONS, type SectionId } from '@jangdan/core';
import { rt } from '../runtime.js';
import { status } from '../status.js';
import { MONO, SANS } from '../visual/fonts.js';
import { roundRect, TextQuad } from '../visual/text-quad.js';

export const FOV = { side: 37, up: 25, down: 43 };
const MARGIN = 4;

export class HudSystem extends createSystem({}) {
  readonly group = new Group();
  private caption = new TextQuad(1024, 220, 0.6, 'hud-caption');
  private ring = new TextQuad(320, 320, 0.13, 'hud-ring');
  private strip = new TextQuad(1024, 110, 0.5, 'hud-sections');
  private arrows = {} as Record<SectionId, TextQuad>;
  private q = new Quaternion();
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private tmp = new Vector3();
  /** Last measured angles of HUD elements (deg), for the FoV assertion. */
  readonly angles: Record<string, { yaw: number; pitch: number; inView: boolean }> = {};

  init(): void {
    this.group.name = 'jangdan-hud';
    this.caption.mesh.position.set(0, -0.26, -1);
    this.ring.mesh.position.set(0, -0.1, -1);
    this.strip.mesh.position.set(0, -0.4, -1);
    this.group.add(this.caption.mesh, this.ring.mesh, this.strip.mesh);
    for (const s of SECTIONS) {
      const a = new TextQuad(128, 128, 0.07, `hud-arrow-${s}`);
      a.draw(s, (g, w, h) => {
        g.fillStyle = SECTION_COLOR[s];
        g.beginPath();
        g.moveTo(w * 0.85, h / 2);
        g.lineTo(w * 0.2, h * 0.15);
        g.lineTo(w * 0.35, h / 2);
        g.lineTo(w * 0.2, h * 0.85);
        g.closePath();
        g.fill();
        g.strokeStyle = PALETTE.ink;
        g.lineWidth = 6;
        g.stroke();
      });
      a.mesh.visible = false;
      this.arrows[s] = a;
      this.group.add(a.mesh);
    }
    this.group.visible = false;
    this.scene.add(this.group);
  }

  update(dt: number): void {
    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.group.visible = immersive && status.phase !== 'off';
    if (!this.group.visible) return;
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.matrixWorld.decompose(this.headPos, this.headQuat, this.tmp);
    // lazy follow: position locks to the head, rotation eases (comfort), so text never swims
    this.group.position.copy(this.headPos);
    const k = 1 - Math.exp(-dt * 7);
    this.q.copy(this.group.quaternion).slerp(this.headQuat, k);
    this.group.quaternion.copy(this.q);

    this.drawCaption();
    this.drawRing();
    this.drawGlasses();
    this.measure();
  }

  private drawCaption(): void {
    const r = status.results;
    const showResults = status.phase === 'results' && r;
    const key = showResults
      ? `R|${status.caption}|${r!.score?.total}|${r!.best}|${r!.isBest}|${r!.completed}`
      : `C|${status.caption}|${status.sub}|${status.phase === 'calibrate' ? status.cal.taps : ''}`;
    this.caption.draw(key, (g, w, h) => {
      const lines = showResults
        ? [
            status.caption,
            r!.score
              ? `togetherness ${r!.score.total}${r!.isBest ? ' · new best' : r!.best !== null ? ` · best ${r!.best}` : ''}`
              : r!.completed
                ? 'the end'
                : '',
          ]
        : [status.caption, status.phase === 'calibrate' ? `${status.sub} (${status.cal.taps}/${status.cal.of})` : status.sub];
      if (!lines[0] && !lines[1]) return;
      g.fillStyle = 'rgba(18,16,20,0.72)';
      roundRect(g, 6, 6, w - 12, h - 12, 40);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = PALETTE.hanji;
      g.font = showResults ? `600 74px ${SANS}` : `600 64px ${SANS}`;
      g.fillText(lines[0] ?? '', w / 2, lines[1] ? 92 : 128);
      if (lines[1]) {
        g.font = showResults ? `600 44px ${MONO}` : `400 40px ${SANS}`;
        g.fillStyle = showResults ? PALETTE.yellow : 'rgba(244,239,230,0.82)';
        g.fillText(lines[1], w / 2, 168, w - 60);
      }
    });
  }

  private drawRing(): void {
    const playing = status.phase === 'countIn' || status.phase === 'playing' || status.phase === 'fermata';
    const show = playing || status.phase === 'raised' || status.phase === 'ready' || status.phase === 'calibrate';
    this.ring.mesh.visible = show;
    if (!show) return;
    const now = rt.engine?.ctx.currentTime ?? 0;
    const flash = status.ictusAt > 0 && now - status.ictusAt < 0.12;
    const phaseQ = Math.round(status.beatPhase * 24);
    const tol = Math.round(Math.min(1, status.spread) * 10);
    const key = `${status.phase}|${status.count}|${phaseQ}|${status.beatInBar}|${Math.round(status.bpm)}|${status.dynMark}|${tol}|${flash}|${status.mark}`;
    this.ring.draw(key, (g, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const R = 120;
      g.fillStyle = 'rgba(18,16,20,0.7)';
      g.beginPath();
      g.arc(cx, cy, R + 34, 0, Math.PI * 2);
      g.fill();
      // tolerance: the steadier the beat, the thinner and brighter the ring
      g.lineWidth = 6 + tol * 2.2;
      g.strokeStyle = flash ? PALETTE.yellow : `rgba(244,239,230,${0.35 + 0.4 * (1 - tol / 10)})`;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.stroke();
      // beat dots around the ring, the current one filled; the sweep shows where in the beat we are
      const bpb = status.beatsPerBar;
      for (let i = 0; i < bpb; i++) {
        const a = -Math.PI / 2 + (i / bpb) * Math.PI * 2;
        g.fillStyle = playing && i === status.beatInBar ? PALETTE.red : 'rgba(244,239,230,0.45)';
        g.beginPath();
        g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, i === 0 ? 16 : 11, 0, Math.PI * 2);
        g.fill();
      }
      if (playing) {
        const a0 = -Math.PI / 2 + (status.beatInBar / bpb) * Math.PI * 2;
        g.strokeStyle = PALETTE.blue;
        g.lineWidth = 10;
        g.beginPath();
        g.arc(cx, cy, R - 22, a0, a0 + (status.beatPhase / bpb) * Math.PI * 2);
        g.stroke();
      }
      g.textAlign = 'center';
      g.fillStyle = PALETTE.hanji;
      if (status.count > 0) {
        g.font = `700 120px ${MONO}`;
        g.fillText(String(status.count), cx, cy + 42);
      } else {
        g.font = `600 64px ${MONO}`;
        g.fillText(String(Math.round(status.bpm || 0)), cx, cy + 6);
        g.font = `400 30px ${MONO}`;
        g.fillStyle = 'rgba(244,239,230,0.7)';
        g.fillText(`BPM · ${status.dynMark}${status.mark ? ` · ${status.mark}` : ''}`, cx, cy + 50);
      }
    });
  }

  /** Glasses: a section strip inside the view, and arrows at the edge of the view toward each section. */
  private drawGlasses(): void {
    const st = rt.stage;
    const on = rt.glasses && !!st;
    this.strip.mesh.visible = on;
    if (!on || !st) {
      for (const s of SECTIONS) this.arrows[s].mesh.visible = false;
      return;
    }
    const states = SECTIONS.map((s) => `${s}:${Math.round(st.sections[s].hover * 2)}`).join(',');
    this.strip.draw(states, (g, w, h) => {
      const cw = w / 4;
      SECTIONS.forEach((s, i) => {
        const hov = st.sections[s].hover > 0.5;
        g.fillStyle = hov ? 'rgba(244,239,230,0.95)' : 'rgba(18,16,20,0.75)';
        roundRect(g, i * cw + 6, 6, cw - 12, h - 12, 24);
        g.fill();
        g.fillStyle = SECTION_COLOR[s];
        g.beginPath();
        g.arc(i * cw + 36, h / 2, 12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hov ? PALETTE.ink : PALETTE.hanji;
        g.font = `600 40px ${SANS}`;
        g.fillText(SECTION_LABEL[s], i * cw + 58, h / 2 + 14);
      });
    });
    // edge arrows
    const inv = this.group.quaternion.clone().invert();
    for (const s of SECTIONS) {
      const a = this.arrows[s];
      const p = this.tmp.set(...st.sections[s].anchor).sub(this.group.position).applyQuaternion(inv);
      const behind = p.z > 0;
      const yaw = (Math.atan2(p.x, -p.z) * 180) / Math.PI;
      const pitch = behind ? 0 : (Math.atan2(p.y, -p.z) * 180) / Math.PI;
      const out = behind || Math.abs(yaw) > FOV.side - MARGIN || pitch > FOV.up - MARGIN || pitch < -(FOV.down - MARGIN);
      a.mesh.visible = out;
      if (!out) continue;
      // sit on the inside of the view's edge, pointing the way to turn
      const side = yaw >= 0 ? 1 : -1;
      const cyaw = behind ? side * (FOV.side - 8) : Math.max(-(FOV.side - 8), Math.min(FOV.side - 8, yaw));
      const cpitch = Math.max(-(FOV.down - 8), Math.min(FOV.up - 8, pitch));
      a.mesh.position.set(Math.tan((cyaw * Math.PI) / 180), Math.tan((cpitch * Math.PI) / 180), -1);
      const dx = behind ? side : yaw - cyaw;
      const dy = behind ? 0 : pitch - cpitch;
      a.mesh.rotation.set(0, 0, Math.atan2(dy, dx));
    }
  }

  /** Angles of each visible HUD element relative to the view axis (corners included). */
  private measure(): void {
    const items: [string, TextQuad][] = [
      ['caption', this.caption],
      ['ring', this.ring],
      ['strip', this.strip],
      ...SECTIONS.map((s) => [`arrow-${s}`, this.arrows[s]] as [string, TextQuad]),
    ];
    for (const [name, q] of items) {
      if (!q.mesh.visible) {
        delete this.angles[name];
        continue;
      }
      const hw = q.metersW / 2;
      const hh = (q.metersW * q.pxH) / q.pxW / 2;
      let worst = { yaw: 0, pitch: 0, inView: true };
      for (const [dx, dy] of [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ]) {
        const p = q.mesh.position;
        const yaw = (Math.atan2(p.x + dx, -p.z) * 180) / Math.PI;
        const pitch = (Math.atan2(p.y + dy, -p.z) * 180) / Math.PI;
        const inView = Math.abs(yaw) <= FOV.side && pitch <= FOV.up && pitch >= -FOV.down;
        if (Math.abs(yaw) >= Math.abs(worst.yaw) || !inView) worst = { yaw: +yaw.toFixed(1), pitch: +pitch.toFixed(1), inView: worst.inView && inView };
      }
      this.angles[name] = worst;
    }
  }
}
