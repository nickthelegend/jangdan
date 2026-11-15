// Records one film segment from the emulator: CDP screencast frames (at the film's 1920x1080 viewport,
// emulator toolbar hidden) plus the program's real audio output, while an in-page driver moves the
// emulated head and hands along a script. Every interaction goes through the emulated hands (hand ray +
// pinch, index-finger poke, fist, palm up) or the emulated eye gaze; nothing calls the app's actions.
// params: { outDir, width, height, script: { total, look: [[t, yaw, pitch]], events: [[t, kind, args]] } }
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { params } from './_page.mjs';

export default async function run({ frame, cdp, workspaceRoot }) {
  const p = params(workspaceRoot);
  mkdirSync(p.outDir, { recursive: true });
  const W = p.width ?? 1920;
  const H = p.height ?? 1080;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // the emulator's own toolbar (Runtime / Editor switcher in the host page) is not part of the app: hide it
  await cdp.send('Runtime.evaluate', {
    expression: `(() => { const st = document.createElement('style'); st.id = 'film-hide-chrome'; st.textContent = ${JSON.stringify(`${p.hideSelector ?? '.workspace-view-switcher'} { display: none !important; }`)}; document.head.appendChild(st); return true; })()`,
  });
  // the film's view: a 16:9 frame at a 64° vertical field of view (horizontal ~96°, inside the Quest 3's
  // lenses), the way a headset capture is a crop of what the wearer sees; the default 90° vertical at 16:9
  // would be a 121° fisheye no headset shows
  if (p.fovy) await frame.evaluate((f) => (window.IWER_DEVICE.fovy = f), p.fovy);
  // enter the session from inside this step, while the film viewport is applied (the emulator sizes its
  // canvas when the session starts): tap Enter the hall, sit at 1.2 m, hands only, rebuild the stage
  if (p.enter) {
    const entered = await frame.evaluate(async () => {
      const d = window.IWER_DEVICE;
      const J = window.__jangdan;
      const wait = async (f, ms) => {
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          if (f()) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      };
      await wait(() => !document.getElementById('enter')?.disabled, 8000);
      // seat the emulated wearer before the session starts: moving the device afterwards would
      // offset the room's planes from the rendered room
      d.primaryInputMode = 'hand';
      d.position.set(0, 1.2, 0);
      d.quaternion.set(0, 0, 0, 1);
      await new Promise((r) => setTimeout(r, 2500));
      document.getElementById('enter')?.click();
      const ok = await wait(() => !!d.activeSession, 8000);
      d.position.set(0, 1.2, 0);
      d.quaternion.set(0, 0, 0, 1);
      await new Promise((r) => setTimeout(r, 1500));
      J.rescan();
      const staged = await wait(() => !!J.stage(), 8000);
      await new Promise((r) => setTimeout(r, 1800));
      return { ok, staged, canvas: d.canvasDimensions };
    });
    if (!entered.ok || !entered.staged) throw new Error(`could not enter the hall: ${JSON.stringify(entered)}`);
  }
  await new Promise((r) => setTimeout(r, 600));

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
  let audio0 = null;
  if (p.audio !== false) audio0 = await frame.evaluate(() => window.__jangdan.startCapture());
  const wall0 = Date.now() / 1000;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  const timeline = await frame.evaluate(async (script) => {
    const d = window.IWER_DEVICE;
    const J = window.__jangdan;
    const hands = { right: d.hands.right, left: d.hands.left };
    const marks = [];
    const t0 = performance.now();
    const base = { x: d.position.x, z: d.position.z };
    const ease = (u) => u * u * (3 - 2 * u);
    const lerp = (a, b, u) => a + (b - a) * u;
    const keyed = (keys, t, idx) => {
      for (let i = keys.length - 1; i >= 0; i--) {
        if (t >= keys[i][0]) {
          const nx = keys[i + 1];
          if (!nx) return keys[i][idx];
          const u = ease(Math.min(1, (t - keys[i][0]) / (nx[0] - keys[i][0])));
          return lerp(keys[i][idx], nx[idx], u);
        }
      }
      return keys[0][idx];
    };
    // quaternion that turns -Z toward dir (unit)
    const aimQ = (dx, dy, dz) => {
      const l = Math.hypot(dx, dy, dz) || 1;
      const bx = dx / l;
      const by = dy / l;
      const bz = dz / l;
      // a = (0,0,-1); q = (a x b, 1 + a.b) = (by, -bx, 0, 1 - bz), normalised
      const x = by;
      const y = -bx;
      const z = 0;
      const w = 1 - bz;
      if (w < 1e-4) return [0, 1, 0, 0];
      const m = Math.hypot(x, y, z, w);
      return [x / m, y / m, z / m, w / m];
    };
    const mulQ = (a, b) => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
    const axisQ = (ax, ay, az, ang) => [ax * Math.sin(ang / 2), ay * Math.sin(ang / 2), az * Math.sin(ang / 2), Math.cos(ang / 2)];

    // per-hand driver state
    const st = {
      right: { mode: 'rest', bpm: 92, phase: 0, phase0: null, since: 0, target: null, q: null },
      left: { mode: 'rest', from: -0.5, to: -0.5, t0: 0, dur: 1, target: null, q: null },
    };
    const pinchUntil = { left: -1, right: -1 };
    const events = script.events.slice().sort((a, b) => a[0] - b[0]);
    let ei = 0;
    let last = 0;
    let gazeTarget = null;
    const sectionAnchor = (s) => J.stage()?.sections[s]?.anchor ?? null;

    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        const dt = t - last;
        last = t;
        // events due
        while (ei < events.length && events[ei][0] <= t) {
          const [, kind, a = {}] = events[ei++];
          marks.push({ t: +t.toFixed(2), kind, ...a });
          if (kind === 'right' || kind === 'left') Object.assign(st[kind], a, { since: t, t0: t, phase0: null });
          else if (kind === 'pinch') {
            hands[a.hand].updatePinchValue(1);
            pinchUntil[a.hand] = t + (a.dur ?? 0.2);
          } else if (kind === 'pose') hands[a.hand].poseId = a.poseId;
          else if (kind === 'click') document.querySelector(a.selector)?.click();
          else if (kind === 'seat') {
            d.primaryInputMode = 'hand';
            d.position.set(base.x, a.y ?? 1.2, base.z);
          }
          else if (kind === 'gaze') gazeTarget = a.target;
        }
        for (const side of ['left', 'right']) {
          if (pinchUntil[side] > 0 && t >= pinchUntil[side]) {
            hands[side].updatePinchValue(0);
            pinchUntil[side] = -1;
          }
        }
        // head: yaw/pitch keys; the body (hand frame) follows the yaw
        const yawDeg = keyed(script.look, t, 1);
        const pitchDeg = keyed(script.look, t, 2) ?? 0;
        const yaw = (yawDeg * Math.PI) / 180;
        const pitch = (pitchDeg * Math.PI) / 180;
        const hq = mulQ(axisQ(0, 1, 0, yaw), axisQ(1, 0, 0, pitch));
        d.quaternion.set(hq[0], hq[1], hq[2], hq[3]);
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        const hy = d.position.y;
        const at = (side, fwd, up) => [base.x + rx * side + fx * fwd, hy + up, base.z + rz * side + fz * fwd];
        const setPos = (h, p) => h.position.set(p[0], p[1], p[2]);
        const bodyQ = axisQ(0, 1, 0, yaw);

        // eye gaze (Meta VR Glasses): aim the gaze ray at a section, in the head's frame
        if (gazeTarget && d.gaze) {
          const g = typeof gazeTarget === 'string' ? sectionAnchor(gazeTarget) : gazeTarget;
          if (g) {
            const wq = aimQ(g[0] - d.position.x, g[1] - d.position.y, g[2] - d.position.z);
            const inv = [-hq[0], -hq[1], -hq[2], hq[3]];
            const lq = mulQ(inv, wq);
            d.gaze.quaternion.set(lq[0], lq[1], lq[2], lq[3]);
          }
        }
        // right hand
        const R = st.right;
        const hR = hands.right;
        if (R.mode === 'rest') {
          setPos(hR, at(0.24, 0.3, -0.45));
          hR.quaternion.set(...bodyQ);
        } else if (R.mode === 'raise') {
          const u = Math.min(1, (t - R.since) / 0.5);
          setPos(hR, at(0.24, 0.38, -0.45 + 0.4 * ease(u)));
          hR.quaternion.set(...bodyQ);
        } else if (R.mode === 'conduct' || R.mode === 'tap') {
          R.phase += dt * (R.bpm / 60);
          if (R.phase0 === null) R.phase0 = R.phase;
          const c = Math.cos(2 * Math.PI * (R.phase - R.phase0));
          // a conductor's pattern: the ictus is the low point of each beat; the hand also travels sideways
          // across the bar so the baton trail draws loops, not a line
          const sway = 0.07 * Math.sin(Math.PI * (R.phase - R.phase0));
          if (R.mode === 'conduct') setPos(hR, at(0.24 + sway, 0.38, -0.17 + 0.12 * c));
          else setPos(hR, at(0.24, 0.38, -0.3 + 0.035 * c)); // one-hand: a small index tap
          hR.quaternion.set(...bodyQ);
        } else if (R.mode === 'aim' || R.mode === 'sweep') {
          setPos(hR, at(0.22, 0.32, -0.25));
          let tgt = R.target;
          if (typeof tgt === 'string') tgt = sectionAnchor(tgt);
          if (R.mode === 'sweep') {
            const s = Math.sin((t - R.since) * 2.6);
            tgt = [base.x + fx * 2.5 + rx * 2.2 * s, hy + 0.3 + 0.5 * Math.sin((t - R.since) * 1.7), base.z + fz * 2.5 + rz * 2.2 * s];
          }
          if (tgt) {
            const p0 = hR.position;
            hR.quaternion.set(...aimQ(tgt[0] - p0.x, tgt[1] - p0.y, tgt[2] - p0.z));
          }
        } else if (R.mode === 'poke') {
          const btn = J.menuButton(R.target);
          const tip = J.tip('right');
          if (btn && tip) {
            const head = [d.position.x, d.position.y, d.position.z];
            const tl = Math.hypot(head[0] - btn[0], head[1] - btn[1], head[2] - btn[2]) || 1;
            const toHead = [(head[0] - btn[0]) / tl, (head[1] - btn[1]) / tl, (head[2] - btn[2]) / tl];
            const age = t - R.since;
            const off = age < 0.45 ? 0.07 : age < 0.85 ? -0.012 : 0.09;
            const goal = [btn[0] + toHead[0] * off, btn[1] + toHead[1] * off, btn[2] + toHead[2] * off];
            const k = Math.min(1, dt * 14);
            hR.position.set(hR.position.x + (goal[0] - tip[0]) * k, hR.position.y + (goal[1] - tip[1]) * k, hR.position.z + (goal[2] - tip[2]) * k);
            hR.quaternion.set(...aimQ(-toHead[0], -toHead[1], -toHead[2]));
          }
        } else if (R.mode === 'rayAt') {
          // hand ray at a wrist-menu button (then a pinch event selects it)
          setPos(hR, at(0.15, 0.2, -0.25));
          const btn = J.menuButton(R.target);
          if (btn) {
            const p0 = hR.position;
            hR.quaternion.set(...aimQ(btn[0] - p0.x, btn[1] - p0.y, btn[2] - p0.z));
          }
        } else if (R.mode === 'hold') {
          /* keep the pose */
        }

        // left hand
        const L = st.left;
        const hL = hands.left;
        if (L.mode === 'rest') {
          setPos(hL, at(-0.26, 0.3, -0.5));
          hL.quaternion.set(...bodyQ);
        } else if (L.mode === 'height') {
          const u = Math.min(1, (t - L.t0) / Math.max(0.01, L.dur));
          setPos(hL, at(-0.26, 0.36, lerp(L.from, L.to, ease(u))));
          hL.quaternion.set(...bodyQ);
        } else if (L.mode === 'palmUp') {
          setPos(hL, at(-0.16, 0.3, -0.36));
          hL.quaternion.set(...mulQ(bodyQ, axisQ(0, 0, 1, L.roll ?? -Math.PI)));
        } else if (L.mode === 'aim' || L.mode === 'sweep') {
          setPos(hL, at(-0.22, 0.32, -0.25));
          let tgt = L.target;
          if (typeof tgt === 'string') tgt = sectionAnchor(tgt);
          if (L.mode === 'sweep') {
            const s = Math.sin((t - L.t0) * 2.1 + 1.3);
            tgt = [base.x + fx * 2.5 + rx * 2.2 * s, hy + 0.2 + 0.4 * Math.cos((t - L.t0) * 1.5), base.z + fz * 2.5 + rz * 2.2 * s];
          }
          if (tgt) {
            const p0 = hL.position;
            hL.quaternion.set(...aimQ(tgt[0] - p0.x, tgt[1] - p0.y, tgt[2] - p0.z));
          }
        }
        if (t < script.total) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    return {
      marks,
      log: J.log().filter((l) => l.type !== 'ictus'),
      status: J.status(),
      metrics: J.metrics(3000),
      legibility: J.legibility(),
      light: J.light(),
    };
  }, p.script);

  await cdp.send('Page.stopScreencast');
  cdp.off?.('Page.screencastFrame', onFrame);
  let audio = null;
  if (p.audio !== false) {
    audio = await frame.evaluate(() => window.__jangdan.stopCapture());
    writeFileSync(join(p.outDir, 'audio.webm'), Buffer.from(audio.base64, 'base64'));
  }
  writeFileSync(join(p.outDir, 'frames.json'), JSON.stringify({ wall0, frames, audio: audio && { ...audio, base64: undefined }, audio0 }, null, 1));
  return { frames: frames.length, audioBytes: audio?.bytes ?? 0, audioSeconds: audio?.seconds ?? 0, ...timeline };
}
