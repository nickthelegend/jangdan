/** Hand joints from WebXR (XRFrame.fillPoses), as flat x,y,z arrays in world space. */
import type { Matrix4 } from '@iwsdk/core';
import { JOINT_COUNT, JOINT_NAMES } from '@jangdan/core';

type Side = 'left' | 'right';

export class HandReader {
  readonly joints: Record<Side, Float32Array> = { left: new Float32Array(JOINT_COUNT * 3), right: new Float32Array(JOINT_COUNT * 3) };
  readonly tracked: Record<Side, boolean> = { left: false, right: false };
  private mats = new Float32Array(16 * JOINT_COUNT);
  private spaces = new WeakMap<object, XRJointSpace[]>();

  /** Runtimes without fillPoses: one getJointPose per joint. */
  private fallback(frame: XRFrame, spaces: XRJointSpace[], ref: XRReferenceSpace): boolean {
    for (let i = 0; i < spaces.length; i++) {
      const p = frame.getJointPose?.(spaces[i], ref);
      if (!p) return false;
      this.mats.set(p.transform.matrix, i * 16);
    }
    return true;
  }

  read(frame: XRFrame | undefined, ref: XRReferenceSpace | null, source: (side: Side) => XRInputSource | undefined, origin: Matrix4): void {
    for (const side of ['left', 'right'] as const) {
      this.tracked[side] = false;
      if (!frame || !ref) continue;
      const hand = source(side)?.hand;
      if (!hand) continue;
      let spaces = this.spaces.get(hand);
      if (!spaces) {
        spaces = JOINT_NAMES.map((n) => hand.get(n as XRHandJoint)!).filter(Boolean);
        this.spaces.set(hand, spaces);
      }
      if (spaces.length !== JOINT_COUNT) continue;
      let ok = false;
      try {
        const f = frame as XRFrame & { fillPoses?: (s: XRSpace[], b: XRSpace, out: Float32Array) => boolean };
        ok = f.fillPoses ? f.fillPoses(spaces, ref, this.mats) : this.fallback(frame, spaces, ref);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      const e = origin.elements;
      const j = this.joints[side];
      for (let i = 0; i < JOINT_COUNT; i++) {
        const x = this.mats[i * 16 + 12];
        const y = this.mats[i * 16 + 13];
        const z = this.mats[i * 16 + 14];
        j[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        j[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        j[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      this.tracked[side] = true;
    }
  }
}
