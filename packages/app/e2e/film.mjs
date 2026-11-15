// Record the film's segments from the emulator: node e2e/film.mjs [segment ...]
// Each segment is a scripted take (e2e/film-script.mjs) recorded by steps/film.mjs: 1920x1080 screencast
// with the emulator toolbar hidden, plus the program's real audio, muxed without edits to
// grokbot/videos/jangdan/film-src/<segment>.mp4 (+ .json with the app's own log and metrics).
import { execFileSync as exec0 } from 'node:child_process';

// ffmpeg has been killed mid-mux under memory pressure: retry once before giving up
function execFileSync(cmd, args, opts) {
  try {
    return exec0(cmd, args, opts);
  } catch (e) {
    console.log(`${cmd} failed (${e.status}), retrying once`);
    return exec0(cmd, args, opts);
  }
}
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROBES, SEGMENTS } from './film-script.mjs';
import { APP, cli, sleep, step } from './lib.mjs';

const VIDEOS = join(APP, '../../../../videos/jangdan/film-src');
mkdirSync(VIDEOS, { recursive: true });
const wanted = process.argv.slice(2);
const list = wanted.length ? [...SEGMENTS, ...PROBES].filter((s) => wanted.includes(s.name)) : SEGMENTS;

async function configure(device, room) {
  const p = join(APP, 'iwsdk.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  if (cfg.dev.emulator.device === device && cfg.dev.emulator.environment === room) return false;
  cfg.dev.emulator.device = device;
  cfg.dev.emulator.environment = room;
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
  await sleep(5000);
  for (let i = 0; i < 60; i++) {
    const s = cli(['dev', 'status']);
    if (s?.data?.state?.browserCommandReady ?? s?.data?.browserCommandReady) return true;
    await sleep(1000);
  }
  throw new Error('dev server never became ready');
}

async function ready() {
  for (let i = 0; i < 60; i++) {
    const s = cli(['dev', 'status']);
    if (s?.data?.state?.browserCommandReady ?? s?.data?.browserCommandReady) return;
    if (i === 20) cli(['browser', 'reload']);
    await sleep(1000);
  }
  throw new Error('browser bridge never came back');
}

async function enterSeated() {
  cli(['xr', 'enter']);
  for (let i = 0; i < 20; i++) {
    const s = cli(['xr', 'status']);
    if (s?.data?.sessionActive ?? s?.sessionActive) break;
    await sleep(500);
  }
  cli(['xr', 'set-input-mode'], { mode: 'hand' });
  cli(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  step('state', { read: ['rescan'] });
  await sleep(1500);
}

for (const seg of list) {
  console.log(`\n== ${seg.name}`);
  await configure(seg.device ?? 'metaQuest3', seg.room ?? 'sunlit_living_room');
  if (seg.reload !== false) {
    // every reloaded take starts from default settings (calm light, one-hand and latency persist in storage)
    try {
      step('eval', { code: "for (const k of ['jangdan.calm', 'jangdan.onehand', 'jangdan.latency']) localStorage.removeItem(k); return true;" });
    } catch (e) {
      console.log('settings reset failed:', String(e.message).slice(0, 120));
    }
    for (let k = 0; ; k++) {
      try {
        cli(['browser', 'reload']);
        break;
      } catch (e) {
        if (k >= 3) throw e;
        console.log('reload retry:', String(e.message).slice(0, 120));
        await sleep(4000);
      }
    }
    await sleep(3000);
    await ready();
  }
  // a reloaded take enters the session inside the film step, so the canvas is sized to the film frame
  const enterInStep = seg.reload !== false && seg.enter !== false;
  if (seg.reload === false && seg.enter !== false) await enterSeated();
  if (seg.before) for (const s of seg.before) step(s.step, s.params ?? {}, 60000);
  const out = join(APP, 'e2e/results/film', seg.name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const r = step('film', { outDir: out, script: seg.script, width: 1920, height: 1080, audio: seg.audio, hideSelector: seg.hideSelector, fovy: seg.fovy ?? 1.117, enter: enterInStep }, 100000);
  if (!r || typeof r !== 'object' || !r.frames) {
    console.log('segment failed', JSON.stringify(r).slice(0, 800));
    continue;
  }
  writeFileSync(join(VIDEOS, `${seg.name}.json`), JSON.stringify({ segment: seg.name, device: seg.device ?? 'metaQuest3', room: seg.room ?? 'sunlit_living_room', script: seg.script, ...r, recordedAt: new Date().toISOString() }, null, 2));
  const meta = JSON.parse(readFileSync(join(out, 'frames.json'), 'utf8'));
  const lines = [];
  for (let i = 0; i < meta.frames.length; i++) {
    const f = meta.frames[i];
    const nx = meta.frames[i + 1];
    lines.push(`file '${f.file}'`);
    lines.push(`duration ${nx ? Math.max(0.001, nx.t - f.t).toFixed(4) : '0.0333'}`);
  }
  lines.push(`file '${meta.frames[meta.frames.length - 1].file}'`);
  writeFileSync(join(out, 'frames.txt'), lines.join('\n'));
  const mp4 = join(VIDEOS, `${seg.name}.mp4`);
  const vf = 'fps=30,scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p';
  if (meta.audio) {
    const lead = Math.max(0, meta.frames[0].t - meta.wall0);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, 'frames.txt'), '-ss', lead.toFixed(3), '-i', join(out, 'audio.webm'), '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4], { stdio: 'inherit' });
  } else {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, 'frames.txt'), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-shortest', mp4], { stdio: 'inherit' });
  }
  // the screencast frames are big: keep only the muxed take
  rmSync(out, { recursive: true, force: true });
  console.log(JSON.stringify({ mp4, frames: meta.frames.length, legibility: r.legibility, light: r.light, metrics: r.metrics, marks: r.marks.length }));
}
