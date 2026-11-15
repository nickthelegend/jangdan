/**
 * The light wash: an additive procedural shader drawn on the surface's own geometry. For a detected
 * plane that geometry is the plane's polygon, so the light stops exactly at the real wall's edge.
 * Local frame: +Y is the surface normal, the surface lies in local XZ.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  Mesh,
  OneFactor,
  ShaderMaterial,
  ShapeUtils,
  type Texture,
  Vector2,
  Vector4,
} from '@iwsdk/core';
import { bloomSpeed } from '@jangdan/core';

export const RIPPLES = 12;
/** Seconds a bloom stays visible (core/lightshow BLOOM_LIFE). */
const LIFE = '1.6';

const VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uDyn;
uniform float uCov;
uniform float uGain;
uniform float uTime;
uniform float uHover;
uniform float uCue;
uniform float uIdle;
uniform float uFlash;
uniform float uDark;
uniform float uSize;
uniform float uSpeed;
uniform float uBeat;
uniform float uSweep;
uniform float uSweepOn;
uniform float uHasMap;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform vec4 uRip[${RIPPLES}];
uniform sampler2D uMap;
varying vec2 vLocal;
void main() {
  vec2 p = vLocal;
  vec2 q = (p - uCenter) / max(uHalf, vec2(0.05));
  float d = length(p - uCenter) / uSize;
  float edge = max(abs(q.x), abs(q.y));
  // the steady flood: dynamics set how far the colour reaches (a pool at pp, the whole surface at ff)
  float pool = smoothstep(uCov, uCov * 0.3, d);
  float shimmer = 0.86 + 0.14 * sin(p.x * 6.0 + uTime * 1.7) * sin(p.y * 4.0 - uTime * 1.3);
  float body = uLevel * uGain * pool * (0.55 + 0.45 * (1.0 - min(d, 1.0))) * shimmer;
  // every note blooms: a hot core at the onset, then a ring that sweeps the whole surface
  float bloom = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age > 0.0 && age < ${LIFE} && r.w > 0.0) {
      float fade = 1.0 - age / ${LIFE};
      fade *= fade;
      float dist = length(p - r.xy);
      float rad = age * uSpeed;
      float w = 0.10 + age * 0.35;
      float x = dist - rad;
      float ring = exp(-(x * x) / (w * w)) * fade;
      float cr = 0.22 + age * 1.8;
      float core = exp(-(dist * dist) / (cr * cr)) * exp(-age * 3.5) * 1.5;
      float wake = (dist < rad ? 0.22 : 0.0) * fade * exp(-dist * 0.5);
      bloom += r.w * (ring + core + wake);
    }
  }
  bloom *= uFlash;
  // the beat: every surface's frame flashes on each beat (tempo = flash rate), the downbeat hardest
  float frame = uBeat * (smoothstep(0.8, 1.0, edge) * 0.95 + 0.10);
  // a faint frame marks each section's surface even between notes
  float rim = (0.10 + 0.25 * uLevel) * smoothstep(0.93, 1.0, edge);
  // the bar: a line of light crosses the surface once per bar
  float sx = -1.0 + 2.0 * uSweep;
  float sweep = uSweepOn * 0.32 * exp(-pow((q.x - sx) / 0.05, 2.0)) * (0.45 + 0.55 * uDyn);
  float idle = uIdle * (0.10 + 0.06 * sin(uTime * 1.1 + d * 5.0)) * smoothstep(1.1, 0.0, d);
  float hover = uHover * (0.08 * smoothstep(1.3, 0.2, d) + 0.5 * smoothstep(0.9, 1.0, edge));
  float cue = uCue * (smoothstep(1.4, 0.0, d) + 0.8 * smoothstep(0.8, 1.0, edge));
  float i = (body + bloom + frame * uFlash + rim + sweep + idle + hover + cue) * (1.0 - uDark);
  vec3 col = uColor * i + vec3(1.0) * pow(max(i - 0.85, 0.0), 1.5) * 0.45;
  vec4 paper = vec4(0.0);
  if (uHasMap > 0.5) {
    vec2 uv = vec2(p.x / (2.0 * uHalf.x) + 0.5, -p.y / (2.0 * uHalf.y) + 0.5);
    paper = texture2D(uMap, uv);
  }
  gl_FragColor = vec4(col * (1.0 - paper.a * 0.35) + paper.rgb * paper.a, clamp(i * 0.38 + paper.a, 0.0, 0.85));
}`;

export interface WashOptions {
  color: string;
  /** Polygon in local XZ (metres). */
  polygon: Vector2[];
  /** Paper banner texture (virtual surfaces only). */
  paper?: Texture;
}

export class Wash {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly material: ShaderMaterial;
  readonly center = new Vector2();
  readonly half = new Vector2();
  readonly size: number;
  readonly speed: number;
  private ripIndex = 0;

  constructor(opts: WashOptions, name: string) {
    const poly = opts.polygon;
    const tris = ShapeUtils.triangulateShape(poly, []);
    const pos = new Float32Array(poly.length * 3);
    poly.forEach((v, i) => pos.set([v.x, 0.004, v.y], i * 3));
    const idx: number[] = [];
    for (const t of tris) idx.push(t[0], t[1], t[2]);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    this.half.set((bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2);
    // centroid (area-weighted would be nicer; the bbox centre is stable for convex scans)
    this.center.set((bb.max.x + bb.min.x) / 2, (bb.max.z + bb.min.z) / 2);
    this.size = Math.max(0.25, Math.hypot(this.half.x, this.half.y));
    this.speed = bloomSpeed(this.size);
    const color = new Color(opts.color);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: color },
        uLevel: { value: 0 },
        uDyn: { value: 0.4 },
        uCov: { value: 0.7 },
        uGain: { value: 1 },
        uSpeed: { value: this.speed },
        uBeat: { value: 0 },
        uSweep: { value: 0 },
        uSweepOn: { value: 0 },
        uTime: { value: 0 },
        uHover: { value: 0 },
        uCue: { value: 0 },
        uIdle: { value: 1 },
        uFlash: { value: 1 },
        uDark: { value: 0 },
        uSize: { value: this.size },
        uHasMap: { value: opts.paper ? 1 : 0 },
        uCenter: { value: this.center },
        uHalf: { value: this.half },
        uRip: { value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, -99, 0)) },
        uMap: { value: opts.paper ?? null },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = name;
    this.mesh.renderOrder = 5;
  }

  /** Start a ripple at local (x, z). */
  ripple(x: number, z: number, time: number, strength: number): void {
    const r = (this.material.uniforms.uRip.value as Vector4[])[this.ripIndex];
    r.set(x, z, time, strength);
    this.ripIndex = (this.ripIndex + 1) % RIPPLES;
  }

  clearRipples(): void {
    for (const r of this.material.uniforms.uRip.value as Vector4[]) r.set(0, 0, -99, 0);
  }

  set(u: {
    level: number;
    dyn: number;
    cov: number;
    gain: number;
    time: number;
    hover: number;
    cue: number;
    idle: number;
    flash: number;
    dark: number;
    beat: number;
    sweep: number;
    sweepOn: number;
  }): void {
    const m = this.material.uniforms;
    m.uLevel.value = u.level;
    m.uDyn.value = u.dyn;
    m.uCov.value = u.cov;
    m.uGain.value = u.gain;
    m.uBeat.value = u.beat;
    m.uSweep.value = u.sweep;
    m.uSweepOn.value = u.sweepOn;
    m.uTime.value = u.time;
    m.uHover.value = u.hover;
    m.uCue.value = u.cue;
    m.uIdle.value = u.idle;
    m.uFlash.value = u.flash;
    m.uDark.value = u.dark;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
