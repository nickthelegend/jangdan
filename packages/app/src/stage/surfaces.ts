/**
 * Read the room from IWSDK scene understanding: XRPlane entities (orientation + polygon, no labels)
 * and XRMesh entities (bounded furniture). Produces the core `Surface` list in world space.
 */
import { type Entity, Matrix4, Vector3, XRMesh, XRPlane } from '@iwsdk/core';
import { polygonArea, type Surface, type Vec2, type Vec3 } from '@jangdan/core';

const m = new Matrix4();
const v = new Vector3();
const n = new Vector3();

export interface PlaneSource {
  surface: Surface;
  /** World matrix of the plane space (local +Y = normal). */
  matrix: Matrix4;
  /** Polygon in local XZ. */
  polygon: Vec2[];
}

export function planeToSurface(e: Entity, index: number): PlaneSource | null {
  const plane = e.getValue(XRPlane, '_plane') as { polygon: DOMPointReadOnly[] } | undefined;
  const obj = e.object3D;
  if (!plane || !obj) return null;
  obj.updateWorldMatrix(true, false);
  m.copy(obj.matrixWorld);
  const pts: Vec2[] = [];
  for (const p of plane.polygon) {
    const q: Vec2 = [p.x, p.z];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-4) pts.push(q);
  }
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
  if (pts.length < 3) return null;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
  }
  cx /= pts.length;
  cz /= pts.length;
  v.set(cx, 0, cz).applyMatrix4(m);
  n.set(0, 1, 0).transformDirection(m);
  const center: Vec3 = [v.x, v.y, v.z];
  const normal: Vec3 = [n.x, n.y, n.z];
  // trust the geometry over the reported orientation
  const orientation: Surface['orientation'] = Math.abs(n.y) > 0.7 ? 'horizontal' : 'vertical';
  return {
    surface: { id: `plane-${index}`, source: 'plane', orientation, center, normal, area: polygonArea(pts), polygon: pts },
    matrix: m.clone(),
    polygon: pts,
  };
}

/** The top face of a bounded furniture mesh, if it is at table height. */
export function meshTopToSurface(e: Entity, index: number): PlaneSource | null {
  const obj = e.object3D;
  if (!obj) return null;
  const bounded = e.getValue(XRMesh, 'isBounded3D');
  if (!bounded) return null;
  const min = e.getVectorView(XRMesh, 'min');
  const max = e.getVectorView(XRMesh, 'max');
  const label = (e.getValue(XRMesh, 'semanticLabel') as string) || '';
  obj.updateWorldMatrix(true, false);
  const w = max[0] - min[0];
  const d = max[2] - min[2];
  if (!(w > 0.25 && d > 0.2)) return null;
  // top face centre in mesh-local space, then world
  m.copy(obj.matrixWorld);
  const top = new Matrix4().makeTranslation((min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2);
  const mat = m.clone().multiply(top);
  v.setFromMatrixPosition(mat);
  n.set(0, 1, 0).transformDirection(mat);
  if (n.y < 0.9) return null;
  const pts: Vec2[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return {
    surface: { id: `mesh-${index}${label ? `-${label}` : ''}`, source: 'mesh-top', orientation: 'horizontal', center: [v.x, v.y, v.z], normal: [0, 1, 0], area: w * d, polygon: pts, label },
    matrix: mat,
    polygon: pts,
  };
}
