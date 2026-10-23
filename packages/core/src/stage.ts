/**
 * Stage assignment: which real surface each section plays from.
 *
 * Detected planes have no labels, so surfaces are classified by orientation and height relative to the
 * floor and the seated listener: floor, table, ceiling, or a wall that is left / right / front / behind.
 * Each section has preferred roles (strings: left wall, winds: right wall, brass: front wall or ceiling,
 * percussion: table). Candidates are scored by role fit and size, and the best one-surface-per-section
 * assignment is found exhaustively (4 sections, a handful of surfaces). A section with no acceptable
 * surface gets a virtual "paper banner", labelled as such.
 */
import { add, clamp, horizontalAngle, norm, scale, sub, type Vec2, type Vec3 } from './math.js';
import { SECTIONS, type SectionId } from './piece.js';

export type SurfaceRole = 'floor' | 'table' | 'ceiling' | 'wall-left' | 'wall-right' | 'wall-front' | 'wall-behind' | 'other';

export interface Surface {
  id: string;
  /** 'plane' = a detected XRPlane; 'mesh-top' = the top face of a detected XRMesh (e.g. furniture). */
  source: 'plane' | 'mesh-top';
  orientation: 'horizontal' | 'vertical';
  /** World-space centroid (m). */
  center: Vec3;
  /** World-space unit normal (for horizontal surfaces, +Y for a table top, -Y for a ceiling). */
  normal: Vec3;
  /** Area in m². */
  area: number;
  /** Optional polygon in the plane's local x/z (for decals). */
  polygon?: Vec2[];
  /** Semantic label if the runtime gave one (meshes only). Not relied on. */
  label?: string;
}

export interface Listener {
  /** Head position (m). */
  position: Vec3;
  /** Horizontal facing direction. */
  forward: Vec3;
}

export interface SurfacePlacement {
  kind: 'surface';
  section: SectionId;
  surfaceId: string;
  role: SurfaceRole;
  score: number;
  /** Where the sound and the section's glow sit: the surface centroid. */
  anchor: Vec3;
  normal: Vec3;
}

export interface BannerPlacement {
  kind: 'banner';
  section: SectionId;
  /** Why there is no real surface (shown on the banner). */
  reason: string;
  anchor: Vec3;
  /** Faces the listener. */
  normal: Vec3;
  /** The role the banner stands in for. */
  role: SurfaceRole;
}

export type Placement = SurfacePlacement | BannerPlacement;

export interface StageResult {
  placements: Record<SectionId, Placement>;
  roles: Record<string, SurfaceRole>;
  floorY: number;
  realCount: number;
}

/** Role preferences per section (1 = ideal). */
export const ROLE_FIT: Record<SectionId, Partial<Record<SurfaceRole, number>>> = {
  strings: { 'wall-left': 1, 'wall-front': 0.45, ceiling: 0.2 },
  winds: { 'wall-right': 1, 'wall-front': 0.45, ceiling: 0.2 },
  brass: { 'wall-front': 1, ceiling: 0.8, 'wall-left': 0.3, 'wall-right': 0.3 },
  percussion: { table: 1, floor: 0.5 },
};

/** Banner directions (degrees from forward, positive = right) and height offsets from the head. */
const BANNER_SPOT: Record<SectionId, { angle: number; dist: number; dy: number; role: SurfaceRole }> = {
  strings: { angle: -70, dist: 1.6, dy: 0.15, role: 'wall-left' },
  winds: { angle: 70, dist: 1.6, dy: 0.15, role: 'wall-right' },
  brass: { angle: 0, dist: 2.2, dy: 0.3, role: 'wall-front' },
  percussion: { angle: 0, dist: 0.75, dy: -0.5, role: 'table' },
};

export const MIN_SCORE = 0.3;

export function estimateFloorY(surfaces: readonly Surface[], listener: Listener): number {
  let floor = Infinity;
  for (const s of surfaces) {
    if (s.orientation === 'horizontal' && s.normal[1] > 0.7 && s.center[1] < listener.position[1] - 0.9 && s.area > 1) {
      floor = Math.min(floor, s.center[1]);
    }
  }
  // no floor plane: assume a seated head ~1.2 m above the floor
  return Number.isFinite(floor) ? floor : listener.position[1] - 1.2;
}

export function classifySurface(s: Surface, listener: Listener, floorY: number): SurfaceRole {
  if (s.orientation === 'horizontal') {
    const h = s.center[1] - floorY;
    if (s.normal[1] < -0.7 || h > 1.9) return h > 1.6 ? 'ceiling' : 'other';
    if (h < 0.2) return 'floor';
    if (h >= 0.3 && h <= 1.25 && s.area >= 0.08) return 'table';
    return 'other';
  }
  const dir = sub(s.center, listener.position);
  const a = (horizontalAngle(listener.forward, dir) * 180) / Math.PI;
  if (Math.abs(a) <= 40) return 'wall-front';
  if (a < -40 && a >= -140) return 'wall-left';
  if (a > 40 && a <= 140) return 'wall-right';
  return 'wall-behind';
}

function sizeFit(role: SurfaceRole, area: number): number {
  const ideal = role === 'table' ? 0.6 : role === 'floor' ? 4 : 3;
  return clamp(area / ideal, 0.15, 1);
}

export function scoreSurface(section: SectionId, role: SurfaceRole, s: Surface, listener: Listener): number {
  const fit = ROLE_FIT[section][role] ?? 0;
  if (fit === 0) return 0;
  const d = Math.hypot(s.center[0] - listener.position[0], s.center[2] - listener.position[2]);
  const distFit = d > 6 ? 0.6 : 1;
  return fit * (0.65 + 0.35 * sizeFit(role, s.area)) * distFit;
}

function bannerFor(section: SectionId, listener: Listener, reason: string): BannerPlacement {
  const spot = BANNER_SPOT[section];
  const f = norm([listener.forward[0], 0, listener.forward[2]]);
  const r = (spot.angle * Math.PI) / 180;
  // rotate forward around +Y; right = forward x up = (-f.z, 0, f.x); positive angle = to the right
  const d = norm([f[0] * Math.cos(r) - f[2] * Math.sin(r), 0, f[2] * Math.cos(r) + f[0] * Math.sin(r)]);
  const anchor = add(add(listener.position, scale(d, spot.dist)), [0, spot.dy, 0]);
  const normal = section === 'percussion' ? ([0, 1, 0] as Vec3) : norm(scale(d, -1));
  return { kind: 'banner', section, reason, anchor, normal, role: spot.role };
}

export function assignStage(surfaces: readonly Surface[], listener: Listener): StageResult {
  const floorY = estimateFloorY(surfaces, listener);
  const roles: Record<string, SurfaceRole> = {};
  for (const s of surfaces) roles[s.id] = classifySurface(s, listener, floorY);

  // score matrix
  const sc: number[][] = SECTIONS.map((sec) => surfaces.map((s) => scoreSurface(sec, roles[s.id], s, listener)));

  // exhaustive best assignment (each surface used at most once; -1 = banner)
  let best: number[] = SECTIONS.map(() => -1);
  let bestTotal = -1;
  const cur: number[] = [];
  const used = new Set<number>();
  const rec = (i: number, total: number) => {
    if (i === SECTIONS.length) {
      if (total > bestTotal + 1e-9) {
        bestTotal = total;
        best = [...cur];
      }
      return;
    }
    cur[i] = -1;
    rec(i + 1, total);
    for (let k = 0; k < surfaces.length; k++) {
      if (used.has(k) || sc[i][k] < MIN_SCORE) continue;
      used.add(k);
      cur[i] = k;
      rec(i + 1, total + sc[i][k]);
      used.delete(k);
    }
  };
  rec(0, 0);

  const placements = {} as Record<SectionId, Placement>;
  let realCount = 0;
  SECTIONS.forEach((sec, i) => {
    const k = best[i];
    if (k >= 0) {
      const s = surfaces[k];
      realCount++;
      placements[sec] = {
        kind: 'surface',
        section: sec,
        surfaceId: s.id,
        role: roles[s.id],
        score: sc[i][k],
        anchor: s.center,
        normal: s.normal,
      };
    } else {
      const wanted = BANNER_SPOT[sec].role.replace('wall-', '') + (sec === 'percussion' ? '' : ' wall');
      placements[sec] = bannerFor(sec, listener, surfaces.length === 0 ? 'no surfaces detected' : `no ${wanted} found`);
    }
  });
  return { placements, roles, floorY, realCount };
}
