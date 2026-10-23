/**
 * Hand-shape gestures from WebXR hand joints: fist (cut-off), palm direction (menu, dynamics) and palm centre.
 * Joints are a flat Float32Array of 25 x,y,z positions in WebXR XRHand order.
 */
import { clamp, cross, dot, norm, type Vec3 } from './math.js';

export const JOINT_COUNT = 25;
export const J = {
  wrist: 0,
  thumbTip: 4,
  indexProximal: 6,
  indexTip: 9,
  middleProximal: 11,
  middleTip: 14,
  ringProximal: 16,
  ringTip: 19,
  pinkyProximal: 21,
  pinkyTip: 24,
} as const;

/** WebXR joint names in XRHand order (index = position in the flat array / 3). */
export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type Joints = Float32Array | number[];

export const joint = (j: Joints, i: number): Vec3 => [j[i * 3], j[i * 3 + 1], j[i * 3 + 2]];

function d(j: Joints, a: number, b: number): number {
  return Math.hypot(j[a * 3] - j[b * 3], j[a * 3 + 1] - j[b * 3 + 1], j[a * 3 + 2] - j[b * 3 + 2]);
}

/**
 * Extension ratio of each long finger: |tip - wrist| / |proximal knuckle - wrist|.
 * About 1.9 for a straight finger, about 1.0 when it is folded into the palm.
 */
export function fingerExtensions(j: Joints): [number, number, number, number] {
  const r = (tip: number, prox: number) => d(j, tip, J.wrist) / Math.max(1e-4, d(j, prox, J.wrist));
  return [
    r(J.indexTip, J.indexProximal),
    r(J.middleTip, J.middleProximal),
    r(J.ringTip, J.ringProximal),
    r(J.pinkyTip, J.pinkyProximal),
  ];
}

/** 0 = open hand, 1 = tight fist. */
export function fistness(j: Joints): number {
  const e = fingerExtensions(j);
  const m = (e[0] + e[1] + e[2] + e[3]) / 4;
  return clamp((1.75 - m) / 0.6, 0, 1);
}

export interface FistOptions {
  /** Mean extension below which (with every finger below `maxEnter`) the hand is a fist. */
  enter: number;
  maxEnter: number;
  /** Mean extension above which the fist is released (hysteresis). */
  exit: number;
  /** The shape must hold this long (s) before it counts, so a passing curl doesn't cut the orchestra off. */
  hold: number;
}

export const DEFAULT_FIST: FistOptions = { enter: 1.3, maxEnter: 1.5, exit: 1.55, hold: 0.06 };

export class FistDetector {
  readonly opts: FistOptions;
  private since: number | null = null;
  closed = false;
  constructor(opts: Partial<FistOptions> = {}) {
    this.opts = { ...DEFAULT_FIST, ...opts };
  }
  /** Returns true on the frame the fist is confirmed. */
  update(t: number, j: Joints): boolean {
    const e = fingerExtensions(j);
    const m = (e[0] + e[1] + e[2] + e[3]) / 4;
    const mx = Math.max(...e);
    if (this.closed) {
      if (m > this.opts.exit) {
        this.closed = false;
        this.since = null;
      }
      return false;
    }
    if (m < this.opts.enter && mx < this.opts.maxEnter) {
      if (this.since === null) this.since = t;
      if (t - this.since >= this.opts.hold) {
        this.closed = true;
        return true;
      }
    } else {
      this.since = null;
    }
    return false;
  }
  reset(): void {
    this.closed = false;
    this.since = null;
  }
}

/** Unit normal out of the palm. Right and left hands are mirror images, hence the handedness. */
export function palmNormal(j: Joints, handedness: 'left' | 'right'): Vec3 {
  const w = joint(j, J.wrist);
  const a = joint(j, J.indexProximal);
  const b = joint(j, J.pinkyProximal);
  const n = norm(cross([a[0] - w[0], a[1] - w[1], a[2] - w[2]], [b[0] - w[0], b[1] - w[1], b[2] - w[2]]));
  return handedness === 'right' ? n : [-n[0], -n[1], -n[2]];
}

/** Palm centre: between the wrist and the middle knuckle. */
export function palmCenter(j: Joints): Vec3 {
  return [
    (j[0] + j[J.middleProximal * 3]) / 2,
    (j[1] + j[J.middleProximal * 3 + 1]) / 2,
    (j[2] + j[J.middleProximal * 3 + 2]) / 2,
  ];
}

/** True when the palm faces up (the wrist-menu gesture). */
export function isPalmUp(j: Joints, handedness: 'left' | 'right', threshold = 0.65): boolean {
  return dot(palmNormal(j, handedness), [0, 1, 0]) > threshold;
}

/** Thumb-tip to index-tip distance (m). The app uses the runtime's pinch/select state; this is for tests and UI. */
export function pinchDistance(j: Joints): number {
  return d(j, J.thumbTip, J.indexTip);
}
