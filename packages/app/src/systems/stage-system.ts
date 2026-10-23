/**
 * Builds the stage once the room is known: assigns sections to real surfaces (core/stage), draws a
 * light wash on each surface's own geometry, hangs labelled paper banners for missing ones, moves each
 * section's positional audio to its surface centroid, and sets the room-derived reverb.
 */
import {
  CanvasTexture,
  createSystem,
  Group,
  Matrix4,
  Quaternion,
  RayInteractable,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VisibilityState,
  XRMesh,
  XRPlane,
} from '@iwsdk/core';
import {
  assignStage,
  type BannerPlacement,
  hashString,
  type Listener,
  PALETTE,
  reverbParams,
  roomFromSurfaces,
  SECTION_COLOR,
  SECTION_LABEL,
  SECTIONS,
  type SectionId,
  type Surface,
} from '@jangdan/core';
import { SectionTarget } from '../components.js';
import { rt, type SectionView, type StageView } from '../runtime.js';
import { meshTopToSurface, planeToSurface, type PlaneSource } from '../stage/surfaces.js';
import { MONO, SANS } from '../visual/fonts.js';
import { roundRect, TextQuad } from '../visual/text-quad.js';
import { Wash } from '../visual/wash.js';

const ROLE_TEXT: Record<string, string> = {
  'wall-left': 'left wall',
  'wall-right': 'right wall',
  'wall-front': 'front wall',
  'wall-behind': 'back wall',
  ceiling: 'ceiling',
  table: 'table',
  floor: 'floor',
};

/** Hanji paper banner texture for a section with no real surface. */
function paperTexture(section: SectionId, reason: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 720;
  const g = c.getContext('2d')!;
  g.fillStyle = PALETTE.hanji;
  g.fillRect(0, 0, 512, 720);
  // paper fibres, seeded so every banner of a section looks the same
  let s = hashString(section);
  const r = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  g.strokeStyle = 'rgba(120,100,70,0.10)';
  for (let i = 0; i < 260; i++) {
    const x = r() * 512;
    const y = r() * 720;
    const a = r() * Math.PI;
    const l = 8 + r() * 40;
    g.lineWidth = 0.5 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.fillStyle = SECTION_COLOR[section] === PALETTE.white ? PALETTE.ink : SECTION_COLOR[section];
  g.fillRect(0, 0, 512, 22);
  g.fillStyle = PALETTE.ink;
  g.font = `600 30px ${MONO}`;
  g.fillText('PAPER BANNER', 40, 90);
  g.font = `700 86px ${SANS}`;
  g.fillText(SECTION_LABEL[section], 40, 200);
  g.font = `400 30px ${SANS}`;
  g.fillStyle = '#4a4248';
  g.fillText('virtual: hung because', 40, 600);
  g.fillText(reason, 40, 640);
  return Object.assign(new CanvasTexture(c), { colorSpace: SRGBColorSpace });
}

function drawLabel(q: TextQuad, view: { section: SectionId; banner: boolean; role: string }, state: string): void {
  q.draw(`${view.section}|${state}|${view.banner}`, (g, w, h) => {
    const col = SECTION_COLOR[view.section];
    g.fillStyle = 'rgba(18,16,20,0.78)';
    roundRect(g, 4, 4, w - 8, h - 8, 26);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.arc(52, h / 2, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PALETTE.hanji;
    g.font = `700 54px ${SANS}`;
    g.fillText(SECTION_LABEL[view.section], 88, 74);
    g.font = `400 30px ${MONO}`;
    g.fillStyle = 'rgba(244,239,230,0.7)';
    const where = view.banner ? 'paper banner' : ROLE_TEXT[view.role] ?? view.role;
    g.fillText(state ? `${where} · ${state}` : where, 90, 116);
  });
}

export function setLabelState(view: SectionView, state: string): void {
  drawLabel(view.label, view, state);
}

export class StageSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private sessionStart = -1;
  private lastCount = -1;
  private stableSince = 0;
  private group = new Group();

  init(): void {
    this.group.name = 'jangdan-stage';
    this.scene.add(this.group);
    this.cleanupFuncs.push(
      this.visibilityState.subscribe((vs) => {
        if (vs === VisibilityState.NonImmersive) this.teardown();
      }),
    );
  }

  /**
   * Test helper: are the light decals inside the real planes? Each wash vertex of a real-plane section is
   * cast back onto IWSDK's own plane mesh (built independently from the same XRPlane polygon).
   */
  decalCheck(): Record<string, { vertices: number; inside: number; maxOffPlane: number } | null> {
    const st = rt.stage;
    const out: Record<string, { vertices: number; inside: number; maxOffPlane: number } | null> = {};
    if (!st) return out;
    const ray = new Raycaster();
    const planes = [...this.queries.planes.entities].map((e) => e.object3D!).filter(Boolean);
    for (const sec of SECTIONS) {
      const v = st.sections[sec];
      if (v.banner || !v.surfaceId?.startsWith('plane-')) {
        out[sec] = null;
        continue;
      }
      v.root.updateWorldMatrix(true, true);
      const nrm = new Vector3(0, 1, 0).transformDirection(v.root.matrixWorld);
      const plane = planes.find((p) => p.getWorldPosition(new Vector3()).distanceTo(v.root.getWorldPosition(new Vector3())) < 0.005);
      if (!plane) {
        out[sec] = { vertices: 0, inside: 0, maxOffPlane: Infinity };
        continue;
      }
      const pos = v.wash.mesh.geometry.getAttribute('position');
      let inside = 0;
      let maxOff = 0;
      const w = new Vector3();
      const c = new Vector3(v.wash.center.x, 0, v.wash.center.y).applyMatrix4(v.root.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        w.fromBufferAttribute(pos, i).applyMatrix4(v.wash.mesh.matrixWorld);
        // nudge 1 mm toward the centre so a vertex exactly on the edge counts as on the plane
        const p = w.clone().lerp(c, 0.002);
        ray.set(p.clone().addScaledVector(nrm, 0.05), nrm.clone().negate());
        const hit = ray.intersectObject(plane, false)[0];
        if (hit && hit.distance < 0.07) {
          inside++;
          maxOff = Math.max(maxOff, Math.abs(hit.distance - 0.05));
        }
      }
      out[sec] = { vertices: pos.count, inside, maxOffPlane: +maxOff.toFixed(4) };
    }
    return out;
  }

  /** Force a fresh assignment (menu: none yet; also used by tests). */
  rescan(): void {
    this.teardown();
    this.sessionStart = -1;
  }

  update(_dt: number, time: number): void {
    if (this.visibilityState.peek() === VisibilityState.NonImmersive) return;
    if (rt.stage) return;
    if (this.sessionStart < 0) {
      this.sessionStart = time;
      this.lastCount = -1;
    }
    const count = this.queries.planes.entities.size + this.queries.meshes.entities.size;
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.stableSince = time;
    }
    const waited = time - this.sessionStart;
    const stable = time - this.stableSince;
    // build once the room has stopped changing for a moment, or give up waiting and use banners
    if ((count > 0 && stable > 0.8 && waited > 0.6) || waited > 3.5) this.build(time);
  }

  private listener(): Listener {
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    const p = new Vector3().setFromMatrixPosition(head.matrixWorld);
    const f = new Vector3(0, 0, -1).transformDirection(head.matrixWorld);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    return { position: [p.x, p.y, p.z], forward: [f.x, f.y, f.z] };
  }

  private build(time: number): void {
    const sources: PlaneSource[] = [];
    let i = 0;
    for (const e of this.queries.planes.entities) {
      const s = planeToSurface(e, i++);
      if (s) sources.push(s);
    }
    i = 0;
    for (const e of this.queries.meshes.entities) {
      const s = meshTopToSurface(e, i++);
      if (s) sources.push(s);
    }
    const surfaces: Surface[] = sources.map((s) => s.surface);
    const listener = this.listener();
    const result = assignStage(surfaces, listener);
    const room = roomFromSurfaces(surfaces);
    const reverb = reverbParams(room);
    const engine = rt.engine;
    if (engine) engine.setRoom(reverb, hashString(JSON.stringify(room.dims)));

    const sections = {} as Record<SectionId, SectionView>;
    const meshes: StageView['meshes'] = [];
    for (const sec of SECTIONS) {
      const p = result.placements[sec];
      const root = new Group();
      root.name = `section-${sec}`;
      // the cue target is the section's surface (ray + pinch on Quest, gaze + pinch on Glasses); create the
      // entity before posing the root so the Transform starts from the pose we set below
      const entity = this.world.createTransformEntity(root);
      entity.addComponent(RayInteractable);
      entity.addComponent(SectionTarget, { section: sec, banner: p.kind === 'banner' });
      let wash: Wash;
      if (p.kind === 'surface') {
        const src = sources.find((s) => s.surface.id === p.surfaceId)!;
        src.matrix.decompose(root.position, root.quaternion, root.scale);
        wash = new Wash({ color: SECTION_COLOR[sec], polygon: src.polygon.map(([x, z]) => new Vector2(x, z)) }, `wash-${sec}`);
      } else {
        const bp = p as BannerPlacement;
        const vertical = Math.abs(bp.normal[1]) < 0.7;
        const w = vertical ? 0.62 : 0.6;
        const h = vertical ? 0.87 : 0.42;
        root.position.set(bp.anchor[0], bp.anchor[1], bp.anchor[2]);
        // local +Y = normal; local -Z = world up for a hanging banner
        const Y = new Vector3(...bp.normal).normalize();
        // texture "up" (local -Z): world up on a wall banner, away from the listener on the table mat
        const up = vertical ? new Vector3(0, 1, 0) : new Vector3(listener.forward[0], 0, listener.forward[2]).normalize();
        const X = new Vector3().crossVectors(up, Y).normalize();
        const Z = new Vector3().crossVectors(X, Y).normalize();
        root.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
        if (!vertical) {
          // the percussion mat tilts its far edge up, toward the listener's eyes
          root.quaternion.premultiply(new Quaternion().setFromAxisAngle(X, -0.6));
        }
        const poly = [new Vector2(-w / 2, -h / 2), new Vector2(w / 2, -h / 2), new Vector2(w / 2, h / 2), new Vector2(-w / 2, h / 2)];
        wash = new Wash({ color: SECTION_COLOR[sec], polygon: poly, paper: paperTexture(sec, bp.reason) }, `banner-${sec}`);
      }
      root.add(wash.mesh);
      root.updateMatrixWorld(true);
      meshes.push(wash.mesh);

      const label = new TextQuad(640, 150, 0.36, `label-${sec}`);
      const anchorWorld = new Vector3(...p.anchor);
      const nrm = new Vector3(...p.normal);
      // labels sit just off the surface toward the listener, a little above the wash centre
      const toListener = new Vector3(...listener.position).sub(anchorWorld).normalize();
      label.mesh.position.copy(anchorWorld).addScaledVector(nrm.dot(toListener) >= 0 ? nrm : nrm.clone().negate(), 0.06);
      label.mesh.position.y += p.kind === 'banner' ? (Math.abs(p.normal[1]) < 0.7 ? 0.56 : 0.3) : 0.18;
      this.group.add(label.mesh);

      engine?.placeSection(sec, p.anchor);
      const view: SectionView = {
        section: sec,
        banner: p.kind === 'banner',
        surfaceId: p.kind === 'surface' ? p.surfaceId : null,
        role: p.role,
        wash,
        root,
        label,
        entity,
        anchor: p.anchor,
        hover: 0,
        cue: 0,
        hint: 0,
      };
      setLabelState(view, '');
      sections[sec] = view;
    }
    rt.stage = { result, surfaces, room, reverb, sections, meshes, readyAt: time };
    rt.push('stage', {
      surfaces: surfaces.length,
      real: result.realCount,
      roles: Object.fromEntries(SECTIONS.map((s) => [s, result.placements[s].kind === 'surface' ? result.placements[s].role : 'banner'])),
      volume: +room.volume.toFixed(1),
      rt60: +reverb.rt60.toFixed(2),
    });
  }

  private teardown(): void {
    const st = rt.stage;
    if (!st) return;
    for (const v of Object.values(st.sections)) {
      v.root.removeFromParent();
      v.wash.dispose();
      if (v.entity.active) v.entity.destroy();
      v.label.mesh.removeFromParent();
      v.label.dispose();
    }
    rt.stage = null;
  }
}
