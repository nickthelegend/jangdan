// Record a whoa clip: node e2e/record.mjs <room> <name>
// Writes grokbot/videos/jangdan/<name>.mp4 (screencast + real program audio, muxed, no edits) and a .json log.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, cli, sleep, step } from './lib.mjs';

const [room = 'sunlit_living_room', name = 'jangdan-whoa'] = process.argv.slice(2);
const VIDEOS = join(APP, '../../../../videos/jangdan');
const out = join(APP, 'e2e/results/rec', name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(VIDEOS, { recursive: true });

const cfgPath = join(APP, 'iwsdk.config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
if (cfg.dev.emulator.device !== 'metaQuest3' || cfg.dev.emulator.environment !== room) {
  cfg.dev.emulator.device = 'metaQuest3';
  cfg.dev.emulator.environment = room;
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  await sleep(5000);
}
cli(['browser', 'reload']);
await sleep(2500);
cli(['xr', 'set-input-mode'], { mode: 'hand' });
cli(['xr', 'enter']);
// seated: head at 1.2 m
cli(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 } });
step('state', { read: ['rescan'] });

const script = {
  total: 24,
  raise: 3.2,
  drop: 3.8,
  fast: 10,
  cresc: 8.5,
  cut: 16.5,
  bpm: 92,
  bpm2: 118,
  yaw: [
    [0, 28],
    [2.6, 0],
    [5, -25],
    [8, -25],
    [11, 20],
    [14.5, 0],
  ],
};
const r = step('record', { outDir: out, script, width: 1280, height: 720 }, 120000);
writeFileSync(join(VIDEOS, `${name}.json`), JSON.stringify({ room, script, ...r, recordedAt: new Date().toISOString() }, null, 2));

// frames -> constant 30 fps video using each frame's real timestamp, then mux the real audio
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
const mp4 = join(VIDEOS, `${name}.mp4`);
// audio started before the first frame: trim the lead-in so they line up
const lead = Math.max(0, meta.frames[0].t - meta.wall0);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, 'frames.txt'), '-ss', lead.toFixed(3), '-i', join(out, 'audio.webm'), '-vf', 'fps=30,scale=1280:-2:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', mp4], { stdio: 'inherit' });
console.log(JSON.stringify({ mp4, frames: meta.frames.length, audioSeconds: r.audioSeconds, marks: r.marks, metrics: r.metrics }, null, 1));
