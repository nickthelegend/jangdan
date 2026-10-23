// Conduct with emulated hands. params: { bpm, seconds, raise?, left?, bpm2?, changeAt?, fistAfter?, fistHand? }
import { conduct, params } from './_page.mjs';
export default async function run({ frame, workspaceRoot }) {
  const p = params(workspaceRoot);
  const r = await conduct(frame, p);
  let fistAt = null;
  if (p.fistAfter !== undefined) {
    fistAt = await frame.evaluate(async ({ hand, hold }) => {
      const h = window.IWER_DEVICE.hands[hand];
      const t = window.__jangdan.audio().time;
      h.poseId = 'fist';
      await new Promise((res) => setTimeout(res, hold * 1000));
      return t;
    }, { hand: p.fistHand ?? 'right', hold: p.fistAfter });
  }
  const st = await frame.evaluate(() => ({
    status: window.__jangdan.status(),
    perf: window.__jangdan.perf(),
    audio: window.__jangdan.audio(),
    washes: window.__jangdan.washes(),
    log: window.__jangdan.log().filter((l) => l.type !== 'ictus').slice(-30),
    ictus: window.__jangdan.log('ictus').slice(-12),
  }));
  return { ...r, fistAt, ...st };
}
