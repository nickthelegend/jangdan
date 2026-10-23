// Records the 20-second "whoa" from the emulator: CDP screencast frames + the program's real audio output
// (MediaRecorder on the AudioListener input). Frames and audio are written to params.outDir; record.mjs
// on the node side muxes them with ffmpeg. Nothing is edited: what the app renders and plays is what you get.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { params } from './_page.mjs';

export default async function run({ frame, cdp, workspaceRoot }) {
  const p = params(workspaceRoot);
  mkdirSync(p.outDir, { recursive: true });
  const frames = [];
  let n = 0;
  const onFrame = async ({ data, metadata, sessionId }) => {
    const file = `f${String(n++).padStart(5, '0')}.jpg`;
    writeFileSync(join(p.outDir, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {
      /* session closing */
    }
  };
  cdp.on('Page.screencastFrame', onFrame);
  const audio0 = await frame.evaluate(() => window.__jangdan.startCapture());
  const wall0 = Date.now() / 1000;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: p.width ?? 1280, maxHeight: p.height ?? 720, everyNthFrame: 1 });

  const timeline = await frame.evaluate(async (script) => {
    const d = window.IWER_DEVICE;
    const R = d.hands.right;
    const L = d.hands.left;
    const J = window.__jangdan;
    const marks = [];
    const t0 = performance.now();
    const hy = d.position.y;
    let phase = 0;
    let last = 0;
    let fisted = false;
    const yawAt = (t) => {
      // a slow look around the room: left wall, front, right wall, back to front
      for (let i = script.yaw.length - 1; i >= 0; i--) {
        const [ta, ya] = script.yaw[i];
        if (t >= ta) {
          const nx = script.yaw[i + 1];
          if (!nx) return ya;
          const [tb, yb] = nx;
          const u = Math.min(1, (t - ta) / (tb - ta));
          const s = u * u * (3 - 2 * u);
          return ya + (yb - ya) * s;
        }
      }
      return script.yaw[0][1];
    };
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        const yaw = (yawAt(t) * Math.PI) / 180;
        d.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
        const bpm = t < script.fast ? script.bpm : script.bpm2;
        phase += (t - last) * (bpm / 60);
        last = t;
        // the hands follow the body (head yaw) so they stay in view
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        let ry;
        if (t < script.raise) ry = hy - 0.45; // resting
        else if (t < script.drop) ry = hy - 0.45 + 0.4 * Math.min(1, (t - script.raise) / 0.5); // rises
        else if (t < script.cut) ry = hy - 0.17 + 0.12 * Math.cos(2 * Math.PI * (phase - script.phase0));
        else ry = hy - 0.2;
        if (t >= script.drop && script.phase0 === null) script.phase0 = phase;
        R.position.set(d.position.x + rx * 0.24 + fx * 0.38, ry, d.position.z + rz * 0.24 + fz * 0.38);
        const lp = t < script.cresc ? -0.5 : Math.min(-0.02, -0.5 + (t - script.cresc) * 0.16);
        L.position.set(d.position.x - rx * 0.26 + fx * 0.36, hy + lp, d.position.z - rz * 0.26 + fz * 0.36);
        if (!fisted && t >= script.cut) {
          fisted = true;
          R.poseId = 'fist';
          marks.push({ t, what: 'fist' });
        }
        if (t < script.total) requestAnimationFrame(tick);
        else resolve();
      };
      script.phase0 = null;
      tick();
    });
    return { marks, log: J.log().filter((l) => l.type !== 'ictus'), status: J.status(), metrics: J.metrics(2000) };
  }, p.script);

  await cdp.send('Page.stopScreencast');
  cdp.off?.('Page.screencastFrame', onFrame);
  const audio = await frame.evaluate(() => window.__jangdan.stopCapture());
  writeFileSync(join(p.outDir, 'audio.webm'), Buffer.from(audio.base64, 'base64'));
  writeFileSync(join(p.outDir, 'frames.json'), JSON.stringify({ wall0, frames, audio: { ...audio, base64: undefined }, audio0 }, null, 1));
  return { frames: frames.length, audioBytes: audio.bytes, audioSeconds: audio.seconds, ...timeline };
}
