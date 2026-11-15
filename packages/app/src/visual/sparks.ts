/**
 * Light motes: each note throws a few sparks of its section's colour off its surface into the room, so
 * the light leaves the wall and reaches the listener. One Points object for all four sections (one draw
 * call); motion is computed in the vertex shader from each mote's birth time, so a spawn only rewrites a
 * few slots of the buffers.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Vector3,
} from '@iwsdk/core';

const N = 480;
const LIFE = 1.5;

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aBirth;
attribute vec3 aColor;
attribute float aSize;
uniform float uTime;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float age = uTime - aBirth;
  float alive = step(0.0, age) * step(age, ${LIFE.toFixed(2)});
  // drag: fast off the surface, then drifting up like warm air
  float k = 1.0 - exp(-age * 2.2);
  vec3 p = position + aVel * (k / 2.2) + vec3(0.0, 0.05 * age * age, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = 1.0 - age / ${LIFE.toFixed(2)};
  vAlpha = alive * fade * fade;
  vColor = aColor;
  gl_PointSize = alive * aSize * (0.6 + 0.4 * fade) * uPx * projectionMatrix[1][1] / max(-mv.z, 0.2);
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float glow = exp(-r * r * 4.0) + 0.6 * exp(-r * r * 30.0);
  if (vAlpha <= 0.0 || r > 1.0) discard;
  vec3 col = vColor * glow + vec3(1.0) * exp(-r * r * 40.0) * 0.5;
  gl_FragColor = vec4(col * vAlpha, glow * vAlpha * 0.5);
}`;

export class Sparks {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly pos = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly birth = new Float32Array(N).fill(-99);
  private readonly color = new Float32Array(N * 3);
  private readonly size = new Float32Array(N);
  private next = 0;
  private dirty = false;
  private seed = 1;
  private c = new Color();

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aVel', new BufferAttribute(this.vel, 3));
    g.setAttribute('aBirth', new BufferAttribute(this.birth, 1));
    g.setAttribute('aColor', new BufferAttribute(this.color, 3));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1));
    const m = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uPx: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, m);
    this.points.name = 'jangdan-sparks';
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Throw `count` motes from world point `at`, mostly along `normal` (toward the room). */
  spawn(at: Vector3, normal: Vector3, color: string, count: number, strength: number, time: number): void {
    this.c.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      const sp = (0.35 + 0.9 * this.rand()) * (0.6 + 0.6 * strength);
      const jx = (this.rand() - 0.5) * 0.9;
      const jy = (this.rand() - 0.5) * 0.9;
      const jz = (this.rand() - 0.5) * 0.9;
      this.pos.set([at.x + jx * 0.25, at.y + jy * 0.25, at.z + jz * 0.25], i * 3);
      this.vel.set([(normal.x + jx) * sp, (normal.y + jy) * sp + 0.1, (normal.z + jz) * sp], i * 3);
      this.birth[i] = time + this.rand() * 0.05;
      this.color.set([this.c.r, this.c.g, this.c.b], i * 3);
      this.size[i] = 0.035 + 0.05 * this.rand() * strength;
    }
    this.dirty = true;
  }

  clear(): void {
    this.birth.fill(-99);
    this.dirty = true;
  }

  update(time: number, pxPerUnit: number): void {
    const u = this.points.material.uniforms;
    u.uTime.value = time;
    u.uPx.value = pxPerUnit;
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.points.geometry;
    for (const n of ['position', 'aVel', 'aBirth', 'aColor', 'aSize']) (g.getAttribute(n) as BufferAttribute).needsUpdate = true;
  }
}
