// Set emulated hand poses/positions directly. params: { right?: {poseId?, pos?}, left?: {...}, wait? }
import { params } from './_page.mjs';
export default async function run({ frame, workspaceRoot }) {
  const p = params(workspaceRoot);
  return frame.evaluate(async (p) => {
    const d = window.IWER_DEVICE;
    for (const side of ['left', 'right']) {
      const s = p[side];
      if (!s) continue;
      const h = d.hands[side];
      if (s.poseId) h.poseId = s.poseId;
      if (s.pos) h.position.set(d.position.x + s.pos[0], d.position.y + s.pos[1], d.position.z + s.pos[2]);
    }
    await new Promise((r) => setTimeout(r, (p.wait ?? 0.3) * 1000));
    return { status: window.__jangdan.status(), log: window.__jangdan.log().filter((l) => l.type !== 'ictus').slice(-10) };
  }, p);
}
