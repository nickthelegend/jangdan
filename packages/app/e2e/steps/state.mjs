// Read state; optionally wait for an expression first. params: { waitFor?, timeout?, read: [names] }
import { params, waitFor } from './_page.mjs';
export default async function run({ frame, workspaceRoot }) {
  const p = params(workspaceRoot);
  let waited = null;
  if (p.waitFor) waited = await waitFor(frame, p.waitFor, p.timeout ?? 10000);
  const read = await frame.evaluate((names) => {
    const J = window.__jangdan;
    const out = {};
    for (const n of names) {
      try {
        out[n] = typeof J[n] === 'function' ? J[n]() : null;
      } catch (e) {
        out[n] = { error: String(e) };
      }
    }
    return out;
  }, p.read ?? ['status']);
  return { waited: !!waited, ...read };
}
