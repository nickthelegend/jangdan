// Shared in-page helpers (serialised into frame.evaluate calls).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function params(workspaceRoot) {
  return JSON.parse(readFileSync(join(workspaceRoot, 'e2e/.params.json'), 'utf8'));
}

/** Waits in the page until `fnSrc` (an expression over window.__jangdan as J) is truthy. */
export async function waitFor(frame, expr, timeoutMs = 10000) {
  return frame.evaluate(
    async ({ expr, timeoutMs }) => {
      const J = window.__jangdan;
      const f = new Function('J', `return (${expr});`);
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs) {
        try {
          const v = f(J);
          if (v) return v;
        } catch {
          /* not ready */
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    },
    { expr, timeoutMs },
  );
}

/**
 * Conduct with the emulated right hand for `seconds`: the wrist rises and falls once per beat
 * (minimum-jerk-ish cosine), seated, in front of the right shoulder. `bpm` may change mid-way.
 * Optional left-palm height track (relative to the head) and a fist at the end.
 */
export async function conduct(frame, opts) {
  return frame.evaluate(async (o) => {
    const d = window.IWER_DEVICE;
    const R = d.hands.right;
    const L = d.hands.left;
    const head = d.position;
    const hy = head.y;
    const t0 = performance.now();
    let phase = 0;
    let last = 0;
    const bpmAt = (t) => (o.bpm2 && t >= o.changeAt ? o.bpm2 : o.bpm);
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        phase += (t - last) * (bpmAt(t) / 60);
        last = t;
        const lead = o.raise ?? 0.6;
        let y;
        if (t < lead) y = hy - 0.05; // raised, the preparation
        else y = hy - 0.17 + 0.12 * Math.cos(2 * Math.PI * (phase - (lead * o.bpm) / 60));
        R.position.set(head.x + 0.24, y, head.z - 0.38);
        if (o.left) {
          const ly = typeof o.left === 'number' ? o.left : o.left[0] + (o.left[1] - o.left[0]) * Math.min(1, t / o.seconds);
          L.position.set(head.x - 0.26, hy + ly, head.z - 0.36);
        }
        if (t < o.seconds) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    return { seconds: (performance.now() - t0) / 1000 };
  }, opts);
}
