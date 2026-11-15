// Debug helper: run params.code (an async function body) in the page and return its result.
import { params } from './_page.mjs';
export default async function run({ frame, workspaceRoot }) {
  const p = params(workspaceRoot);
  return frame.evaluate(async (code) => {
    const f = new Function('J', 'd', `return (async () => { ${code} })();`);
    return f(window.__jangdan, window.IWER_DEVICE);
  }, p.code);
}
