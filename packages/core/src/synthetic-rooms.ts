/**
 * Synthetic rooms for tests: surfaces as the app extracts them from XRPlane / XRMesh.
 * Listener sits at the origin, head 1.2 m above the floor, facing -Z.
 */
import type { Vec2 } from './math.js';
import type { Listener, Surface } from './stage.js';

export const SEATED: Listener = { position: [0, 1.2, 0], forward: [0, 0, -1] };

const rect = (w: number, h: number): Vec2[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/** A 5 x 4 x 2.6 m living room with all four walls, floor, ceiling and a coffee table. */
export function fullRoom(): Surface[] {
  return [
    { id: 'floor', source: 'plane', orientation: 'horizontal', center: [0, 0, -0.5], normal: [0, 1, 0], area: 20, polygon: rect(5, 4) },
    { id: 'ceiling', source: 'plane', orientation: 'horizontal', center: [0, 2.6, -0.5], normal: [0, -1, 0], area: 20, polygon: rect(5, 4) },
    { id: 'wall-l', source: 'plane', orientation: 'vertical', center: [-2.5, 1.3, -0.5], normal: [1, 0, 0], area: 10.4, polygon: rect(4, 2.6) },
    { id: 'wall-r', source: 'plane', orientation: 'vertical', center: [2.5, 1.3, -0.5], normal: [-1, 0, 0], area: 10.4, polygon: rect(4, 2.6) },
    { id: 'wall-f', source: 'plane', orientation: 'vertical', center: [0, 1.3, -2.5], normal: [0, 0, 1], area: 13, polygon: rect(5, 2.6) },
    { id: 'wall-b', source: 'plane', orientation: 'vertical', center: [0, 1.3, 1.5], normal: [0, 0, -1], area: 13, polygon: rect(5, 2.6) },
    { id: 'table', source: 'plane', orientation: 'horizontal', center: [0.1, 0.45, -0.9], normal: [0, 1, 0], area: 0.6, polygon: rect(1, 0.6) },
  ];
}

/** Only two planes were scanned: the left wall and the table. */
export function twoPlaneRoom(): Surface[] {
  const all = fullRoom();
  return all.filter((s) => s.id === 'wall-l' || s.id === 'table');
}

/** Nothing detected (no room setup). */
export function emptyRoom(): Surface[] {
  return [];
}

/** A small home office: 2.6 x 3 x 2.4 m, desk to the front-right as a labelled mesh top, no left wall scan. */
export function homeOffice(): Surface[] {
  return [
    { id: 'floor', source: 'plane', orientation: 'horizontal', center: [0, 0, -0.3], normal: [0, 1, 0], area: 7.8, polygon: rect(2.6, 3) },
    { id: 'ceiling', source: 'plane', orientation: 'horizontal', center: [0, 2.4, -0.3], normal: [0, -1, 0], area: 7.8, polygon: rect(2.6, 3) },
    { id: 'wall-r', source: 'plane', orientation: 'vertical', center: [1.3, 1.2, -0.3], normal: [-1, 0, 0], area: 7.2, polygon: rect(3, 2.4) },
    { id: 'wall-f', source: 'plane', orientation: 'vertical', center: [0, 1.2, -1.8], normal: [0, 0, 1], area: 6.2, polygon: rect(2.6, 2.4) },
    { id: 'desk', source: 'mesh-top', orientation: 'horizontal', center: [0.5, 0.74, -1.3], normal: [0, 1, 0], area: 0.84, label: 'table', polygon: rect(1.4, 0.6) },
  ];
}

/** A big hall-like loft, 12 x 9 x 4.5 m. */
export function bigLoft(): Surface[] {
  return [
    { id: 'floor', source: 'plane', orientation: 'horizontal', center: [0, 0, -3], normal: [0, 1, 0], area: 108, polygon: rect(12, 9) },
    { id: 'ceiling', source: 'plane', orientation: 'horizontal', center: [0, 4.5, -3], normal: [0, -1, 0], area: 108, polygon: rect(12, 9) },
    { id: 'wall-l', source: 'plane', orientation: 'vertical', center: [-6, 2.25, -3], normal: [1, 0, 0], area: 40.5, polygon: rect(9, 4.5) },
    { id: 'wall-r', source: 'plane', orientation: 'vertical', center: [6, 2.25, -3], normal: [-1, 0, 0], area: 40.5, polygon: rect(9, 4.5) },
    { id: 'wall-f', source: 'plane', orientation: 'vertical', center: [0, 2.25, -7.5], normal: [0, 0, 1], area: 54, polygon: rect(12, 4.5) },
  ];
}
