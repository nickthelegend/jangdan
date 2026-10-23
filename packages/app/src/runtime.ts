/** Shared runtime state for the Jangdan systems (one world, one performance at a time). */
import type { SectionId, StageResult, Surface, RoomSize, ReverbParams } from '@jangdan/core';
import type { Entity, Mesh, Object3D } from '@iwsdk/core';
import type { AudioEngine } from './audio/engine.js';
import type { TextQuad } from './visual/text-quad.js';
import type { Wash } from './visual/wash.js';

export interface SectionView {
  section: SectionId;
  /** Real surface or paper banner. */
  banner: boolean;
  surfaceId: string | null;
  role: string;
  wash: Wash;
  /** Root object holding the wash in the surface's local frame. */
  root: Object3D;
  label: TextQuad;
  entity: Entity;
  anchor: [number, number, number];
  hover: number;
  cue: number;
  /** Hint pulse before an entry. */
  hint: number;
}

export interface StageView {
  result: StageResult;
  surfaces: Surface[];
  room: RoomSize;
  reverb: ReverbParams;
  sections: Record<SectionId, SectionView>;
  /** Wash meshes, for hand-sweep raycasts in listen mode. */
  meshes: Mesh[];
  readyAt: number;
}

export type Mode = 'conduct' | 'listen' | 'ghost';

export interface LogEntry {
  t: number;
  type: string;
  [k: string]: unknown;
}

export const rt = {
  engine: null as AudioEngine | null,
  stage: null as StageView | null,
  settings: {
    pieceIndex: 0,
    mode: 'conduct' as Mode,
    reducedFlash: false,
    oneHand: false,
    /** Measured ictus latency (s) from the calibration tap. */
    latency: 0,
  },
  /** Meta VR Glasses-style session (gaze granted): narrow-FoV layout. */
  glasses: false,
  log: [] as LogEntry[],
  push(type: string, data: Record<string, unknown> = {}): void {
    this.log.push({ t: performance.now() / 1000, type, ...data });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  },
};
