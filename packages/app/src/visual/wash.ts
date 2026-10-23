/**
 * The light wash: an additive procedural shader drawn on the surface's own geometry. For a detected
 * plane that geometry is the plane's polygon, so the light stops exactly at the real wall's edge.
 * Local frame: +Y is the surface normal, the surface lies in local XZ.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  OneFactor,
  ShaderMaterial,
  ShapeUtils,
  type Texture,
  Vector2,
  Vector4,
} from '@iwsdk/core';

export const RIPPLES = 8;

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
uniform float uTime;
uniform float uHover;
uniform float uCue;
uniform float uIdle;
uniform float uFlash;
uniform float uDark;
uniform float uSize;
uniform float uHasMap;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform vec4 uRip[${RIPPLES}];
uniform sampler2D uMap;
varying vec2 vLocal;
void main() {
  vec2 p = vLocal;
  float d = length(p - uCenter) / uSize;
  // dynamics set how far the colour floods: a pool at pp, the whole surface at ff
  float cov = 0.22 + 1.05 * uDyn;
  float pool = smoothstep(cov, cov * 0.35, d);
  float body = uLevel * pool * (0.55 + 0.45 * (1.0 - min(d, 1.0)));
  float rings = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age > 0.0 && age < 2.4 && r.w > 0.0) {
      float rad = age * 1.25;
      float w = 0.05 + age * 0.06;
      float x = length(p - r.xy) - rad;
      rings += r.w * exp(-(x * x) / (w * w)) * exp(-age * 1.5);
    }
  }
  rings *= uFlash;
  float idle = uIdle * (0.07 + 0.05 * sin(uTime * 1.1 + d * 5.0)) * smoothstep(1.1, 0.0, d);
  float hover = uHover * 0.22 * smoothstep(1.3, 0.2, d);
  float cue = uCue * smoothstep(1.4, 0.0, d);
  float i = (body + rings + idle + hover + cue) * (1.0 - uDark);
  vec3 col = uColor * i + vec3(1.0) * pow(max(i - 0.9, 0.0), 2.0) * 0.6;
  vec4 paper = vec4(0.0);
  if (uHasMap > 0.5) {
    vec2 uv = vec2(p.x / (2.0 * uHalf.x) + 0.5, -p.y / (2.0 * uHalf.y) + 0.5);
    paper = texture2D(uMap, uv);
  }
  gl_FragColor = vec4(col * (1.0 - paper.a * 0.35) + paper.rgb * paper.a, clamp(i * 0.42 + paper.a, 0.0, 1.0));
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
  readonly outline: LineLoop<BufferGeometry, LineBasicMaterial>;
  readonly material: ShaderMaterial;
  readonly center = new Vector2();
  readonly half = new Vector2();
  readonly size: number;
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
    const color = new Color(opts.color);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: color },
        uLevel: { value: 0 },
        uDyn: { value: 0.4 },
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
    const lpos = new Float32Array(poly.length * 3);
    poly.forEach((v, i) => lpos.set([v.x, 0.006, v.y], i * 3));
    const lgeo = new BufferGeometry();
    lgeo.setAttribute('position', new BufferAttribute(lpos, 3));
    this.outline = new LineLoop(
      lgeo,
      new LineBasicMaterial({ color, transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false }),
    );
    this.outline.name = `${name}-edge`;
    this.mesh.add(this.outline);
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

  set(u: { level: number; dyn: number; time: number; hover: number; cue: number; idle: number; flash: number; dark: number }): void {
    const m = this.material.uniforms;
    m.uLevel.value = u.level;
    m.uDyn.value = u.dyn;
    m.uTime.value = u.time;
    m.uHover.value = u.hover;
    m.uCue.value = u.cue;
    m.uIdle.value = u.idle;
    m.uFlash.value = u.flash;
    m.uDark.value = u.dark;
    this.outline.material.opacity = Math.min(1, (0.18 + 0.5 * u.hover + 0.7 * u.cue + 0.35 * u.level) * (1 - u.dark));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }
}
