// Node-side helpers for the e2e run: the IWSDK CLI (xr/browser/ecs commands against the managed
// emulator session) and `browser run` steps that execute inside the page with emulated hands.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(APP, 'node_modules/@iwsdk/cli/dist/cli.js');
export const PARAMS = join(APP, 'e2e/.params.json');
export const RESULTS = join(APP, 'e2e/results');
mkdirSync(RESULTS, { recursive: true });

export function cli(args, input, timeout = 120000) {
  const a = [CLI, ...args];
  if (input !== undefined) a.push('--input-json', JSON.stringify(input));
  let out;
  try {
    out = execFileSync('node', a, { cwd: APP, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
    throw new Error(`iwsdk ${args.join(' ')} failed: ${msg.slice(0, 800)}`);
  }
  try {
    return JSON.parse(out);
  } catch {
    return out.trim();
  }
}

/** The `data` payload of a CLI call. */
export function cliData(args, input, timeout) {
  const r = cli(args, input, timeout);
  if (r && r.ok === false) throw new Error(`iwsdk ${args.join(' ')}: ${JSON.stringify(r.error).slice(0, 600)}`);
  return r?.data ?? r;
}

/** Run e2e/steps/<name>.mjs in the managed page; params go through a JSON file the step reads. */
export function step(name, params = {}, timeout = 60000) {
  writeFileSync(PARAMS, JSON.stringify(params));
  const r = cli(['browser', 'run', `e2e/steps/${name}.mjs`, '--timeout', String(timeout)], undefined, timeout + 30000);
  if (r && typeof r === 'object' && r.ok === false) throw new Error(`step ${name}: ${JSON.stringify(r.error).slice(0, 800)}`);
  return r?.data?.result ?? r?.result ?? r;
}

export function readParams() {
  return JSON.parse(readFileSync(PARAMS, 'utf8'));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function save(name, data) {
  writeFileSync(join(RESULTS, `${name}.json`), JSON.stringify(data, null, 2));
}

/** A tiny assertion log: every check is recorded with its value, failures are counted, nothing throws. */
export class Checks {
  constructor(name) {
    this.name = name;
    this.items = [];
  }
  ok(label, pass, value) {
    this.items.push({ label, pass: !!pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${value !== undefined ? `  -> ${JSON.stringify(value)}` : ''}`);
    return !!pass;
  }
  get failed() {
    return this.items.filter((i) => !i.pass).length;
  }
  summary() {
    return { name: this.name, passed: this.items.length - this.failed, failed: this.failed, items: this.items };
  }
}
