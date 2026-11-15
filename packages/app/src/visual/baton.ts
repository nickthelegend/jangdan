/**
 * The baton trail: a ribbon of light that follows the conducting fingertip for the last 0.8 s, so the
 * beat pattern itself is drawn in the air. Each ictus flashes it yellow and widens it for a moment.
 * One mesh, one draw call; vertex buffers are rewritten in place each frame (no allocation).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from '@iwsdk/core';
import { PALETTE, Trail } from '@jangdan/core';

const SEG = 64;
const WINDOW = 0.8;

export class Baton {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly trail = new Trail(SEG);
  private readonly pos = new Float32Array(SEG * 2 * 3);
  private readonly col = new Float32Array(SEG * 2 * 4);
  private readonly base = new Color(PALETTE.hanji);
  private readonly hot = new Color(PALETTE.yellow);
  private readonly tmpC = new Color();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly t = new Vector3();
  private readonly side = new Vector3();
  private readonly toEye = new Vector3();

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 4));
    const idx: number[] = [];
    for (let i = 0; i < SEG - 1; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    const m = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.name = 'jangdan-baton';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** Rebuild the ribbon from the trail. `flash` 0..1 is the ictus glow; `eye` the head position. */
  update(now: number, eye: Vector3, flash: number, visible: boolean): void {
    const pts = visible ? this.trail.recent(now, WINDOW) : [];
    const g = this.mesh.geometry;
    if (pts.length < 2) {
      g.setDrawRange(0, 0);
      return;
    }
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const pa = pts[Math.max(0, i - 1)];
      const pb = pts[Math.min(n - 1, i + 1)];
      this.a.set(pa.x, pa.y, pa.z);
      this.b.set(pb.x, pb.y, pb.z);
      this.t.subVectors(this.b, this.a);
      if (this.t.lengthSq() < 1e-10) this.t.set(0, 1, 0);
      this.toEye.set(eye.x - p.x, eye.y - p.y, eye.z - p.z);
      this.side.crossVectors(this.t, this.toEye).normalize();
      const fresh = 1 - p.age / WINDOW;
      const w = (0.0025 + 0.0065 * fresh * fresh) * (1 + 0.9 * flash * fresh);
      this.pos[i * 6] = p.x + this.side.x * w;
      this.pos[i * 6 + 1] = p.y + this.side.y * w;
      this.pos[i * 6 + 2] = p.z + this.side.z * w;
      this.pos[i * 6 + 3] = p.x - this.side.x * w;
      this.pos[i * 6 + 4] = p.y - this.side.y * w;
      this.pos[i * 6 + 5] = p.z - this.side.z * w;
      this.tmpC.copy(this.base).lerp(this.hot, Math.min(1, flash * 1.2));
      const alpha = Math.pow(fresh, 1.4) * (0.75 + 0.25 * flash);
      for (const o of [0, 4]) {
        this.col[i * 8 + o] = this.tmpC.r;
        this.col[i * 8 + o + 1] = this.tmpC.g;
        this.col[i * 8 + o + 2] = this.tmpC.b;
        this.col[i * 8 + o + 3] = alpha;
      }
    }
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
  }
}
