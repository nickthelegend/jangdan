// Jangdan e2e against the IWER emulator in the IWSDK managed browser (headless agent mode).
//   node e2e/run.mjs quest <room>      Quest 3 hands profile: tempo, dynamics, cue, cut-off, decals, metrics, offline RMS
//   node e2e/run.mjs complete <room>   hands-only: conduct a whole piece from a cold load, then cut off
//   node e2e/run.mjs glasses <room>    Meta VR Glasses profile: gaze + pinch cues, FoV-safe HUD, edge arrows
// Needs: npx iwsdk dev up --ai-mode agent --allow-browser-automation (inside the heavy slot).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, Checks, cli, RESULTS, save, sleep, step } from './lib.mjs';

const [mode = 'quest', room = 'sunlit_living_room'] = process.argv.slice(2);
const device = mode === 'glasses' ? 'metaVRGlasses' : 'metaQuest3';
const tag = `${mode}-${room}`;
const C = new Checks(tag);

async function ensureConfig() {
  const p = join(APP, 'iwsdk.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  if (cfg.dev.emulator.device !== device || cfg.dev.emulator.environment !== room) {
    cfg.dev.emulator.device = device;
    cfg.dev.emulator.environment = room;
    writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
    await sleep(4000);
  }
  for (let i = 0; i < 60; i++) {
    const s = cli(['dev', 'status']);
    if (s?.data?.state?.browserCommandReady ?? s?.data?.browserCommandReady ?? s?.browserCommandReady) return;
    await sleep(1000);
  }
  throw new Error('dev server never became ready');
}

async function enterXR() {
  cli(['browser', 'reload']);
  await sleep(2500);
  cli(['xr', 'enter']);
  for (let i = 0; i < 20; i++) {
    const s = cli(['xr', 'status']);
    if (s?.data?.sessionActive ?? s?.sessionActive) break;
    await sleep(500);
  }
  cli(['xr', 'set-input-mode'], { mode: 'hand' });
  // seated: head 1.2 m above the floor, facing -Z; rebuild the stage from that seat
  cli(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  step('state', { read: ['rescan'] });
  await sleep(800);
  const st = cli(['xr', 'status']);
  const d = st?.data ?? st;
  C.ok('XR session active', d.sessionActive === true, { device: d.deviceName, features: d.enabledFeatures });
  return d;
}

function errors() {
  const logs = cli(['browser', 'logs'], { count: 400 });
  const list = (logs?.data?.logs ?? logs?.logs ?? []).filter((l) => (l.level ?? l.type) === 'error');
  return list.map((l) => String(l.text ?? l.message).slice(0, 300));
}

async function stage() {
  const r = step('state', { waitFor: 'J.stage()', timeout: 9000, read: ['stage', 'decalCheck', 'status', 'log'] });
  C.ok('stage built from the room', r.waited, r.stage && { real: r.stage.realCount, surfaces: r.stage.surfaces.length });
  return r;
}

async function quest() {
  await ensureConfig();
  await enterXR();
  const s = await stage();
  const st = s.stage;
  const roles = Object.fromEntries(Object.entries(st.sections).map(([k, v]) => [k, v.banner ? `banner (${v.reason})` : v.role]));
  C.ok('every section placed (real surface or labelled banner)', Object.keys(st.sections).length === 4, roles);
  C.ok('at least two sections on real surfaces', st.realCount >= 2, st.realCount);
  const decals = s.decalCheck;
  const real = Object.entries(decals).filter(([, v]) => v);
  C.ok('light decals lie inside their real planes (every wash vertex on the plane)', real.length > 0 && real.every(([, v]) => v.inside === v.vertices && v.maxOffPlane < 0.01), decals);
  C.ok('reverb IR generated from the room', st.reverb.irSeconds > 0.2, { volume: +st.room.volume.toFixed(1), rt60: +st.reverb.rt60.toFixed(2), ir: st.reverb.irSeconds });
  step('state', { read: ['resetMetrics'] });

  // tempo: raise, drop, then 96 BPM for 12 beats
  const b = step('conduct', { bpm: 96, seconds: 0.6 + 12 * 0.625, raise: 0.6, left: -0.35 }, 60000);
  const started = b.log.find((l) => l.type === 'start');
  C.ok('raise + drop starts the count-in', !!started, started);
  C.ok('music started from the walls after the count-in', b.log.some((l) => l.type === 'music'), b.status.phase);
  C.ok('ECS tempo is 96 ± 4 after 8+ beats', b.perf && Math.abs(b.perf.bpm - 96) <= 4, b.perf?.bpm);
  C.ok('audio context running and sections sounding', b.audio.state === 'running' && Object.values(b.audio.rms).some((x) => x > 1e-4), b.audio);
  C.ok('positional sources use HRTF', Object.values(b.audio.panning).every((p) => p === 'HRTF'), b.audio.panning);

  // dynamics: left palm high while conducting
  const d = step('conduct', { bpm: 96, seconds: 2.5, raise: 0, left: -0.03 }, 30000);
  C.ok('left palm high reads at least f', d.status.level >= 4 / 6 && ['f', 'ff'].includes(d.status.dynMark), { level: d.status.level, mark: d.status.dynMark });
  const shot = join(RESULTS, `${tag}-playing.png`);
  cli(['browser', 'screenshot'], { outputFile: shot });

  // cue: point the left hand's ray at the strings' surface and pinch
  const a = st.sections.strings.anchor;
  cli(['xr', 'look-at'], { device: 'hand-left', target: { x: a[0], y: a[1], z: a[2] } });
  await sleep(300);
  cli(['xr', 'select'], { device: 'hand-left' });
  await sleep(300);
  const c = step('state', { read: ['log', 'perf'] });
  const cue = c.log.filter((l) => l.type === 'cue');
  C.ok('hand ray + pinch at the strings fires cue.strings', cue.some((l) => l.section === 'strings'), cue.slice(-2));

  // cut-off: fist
  const f = step('conduct', { bpm: 96, seconds: 1.2, raise: 0, left: -0.3, fistAfter: 0.6 }, 30000);
  const cut = f.log.find((l) => l.type === 'cutoff' && !l.auto);
  const beat = 60 / (b.perf?.bpm ?? 96);
  C.ok('a fist cuts off within one beat', cut && cut.time - f.fistAt <= beat, { fistAt: f.fistAt, cutoff: cut?.time, beat });
  C.ok('all sections silent after the cut-off', Object.values(f.audio.rms).every((x) => x < 1e-4), f.audio.rms);
  C.ok('walls dark at once', Object.values(f.washes).every((w) => w.dark >= 0.99 && w.level === 0), f.washes);
  C.ok('caption reads "your room is the hall"', f.status.caption === 'your room is the hall', f.status.caption);

  const m = step('state', { read: ['metrics'] }).metrics;
  C.ok('Jangdan main-thread CPU p95 <= 4 ms (incl. audio scheduling)', m.cpuP95 <= 4, m);
  C.ok('<= 60 draw calls per frame (both eyes)', m.drawCallsMax <= 60, m.drawCallsMax);
  C.ok('<= 80k triangles per frame', m.trianglesMax <= 80000, m.trianglesMax);

  cli(['browser', 'set-muted'], { muted: true });
  const o = step('offline', {}, 60000);
  C.ok('OfflineAudioContext: RMS > 0 while playing', o.rmsPlaying > 1e-3, o);
  C.ok('OfflineAudioContext: RMS = 0 after the cut-off', o.rmsAfterCutoff < 1e-5, o.rmsAfterCutoff);
  const errs = errors();
  C.ok('zero console errors', errs.length === 0, errs.slice(0, 5));
  save(tag, { ...C.summary(), stage: st, metrics: m, screenshot: shot });
}

async function complete() {
  await ensureConfig();
  await enterXR();
  await stage();
  step('state', { read: ['resetMetrics'] });
  // Hanji Light: 112 beats; at 96 BPM that is 70 s, plus the count-in and the fermata
  const seconds = 0.6 + (4 + 112) * 0.625 + 2.5;
  const r = step('conduct', { bpm: 96, seconds, raise: 0.6, left: [-0.5, -0.05], fistAfter: 0.8 }, 200000);
  const fermata = r.log.find((l) => l.type === 'fermata');
  const cut = r.log.find((l) => l.type === 'cutoff');
  const score = r.log.find((l) => l.type === 'score');
  C.ok('reached the final fermata hands-only', !!fermata);
  C.ok('the fist cut the fermata off and the piece counts as completed', cut && !cut.auto && cut.completed, cut);
  C.ok('togetherness score computed and saved', !!score, score);
  const m = step('state', { read: ['metrics'] }).metrics;
  C.ok('Jangdan main-thread CPU p95 <= 4 ms over the whole piece', m.cpuP95 <= 4, m);
  C.ok('<= 60 draw calls per frame over the whole piece', m.drawCallsMax <= 60, m.drawCallsMax);
  const errs = errors();
  C.ok('zero console errors', errs.length === 0, errs.slice(0, 5));
  save(tag, { ...C.summary(), metrics: m });
}

async function glasses() {
  await ensureConfig();
  const x = await enterXR();
  C.ok('Meta VR Glasses profile with gaze granted', x.deviceName === 'Meta VR Glasses' && (x.enabledFeatures ?? []).includes('gaze-tracking'), x.deviceName);
  const s = await stage();
  const g = step('state', { read: ['glasses'] });
  C.ok('app switched to the narrow-FoV layout', g.glasses === true);
  // look at the brass section and pinch (eye gaze picks, either hand's pinch selects)
  for (const sec of ['brass', 'strings']) {
    const a = s.stage.sections[sec].anchor;
    cli(['xr', 'look-at'], { device: 'gaze', target: { x: a[0], y: a[1], z: a[2] } });
    await sleep(400);
    cli(['xr', 'select'], { device: 'hand-right' });
    await sleep(300);
  }
  const c = step('state', { read: ['log', 'hudAngles', 'stage'] });
  const cues = c.log.filter((l) => l.type === 'cue').map((l) => l.section);
  C.ok('gaze + pinch cues brass', cues.includes('brass'), cues);
  C.ok('gaze + pinch cues strings', cues.includes('strings'), cues);
  // face forward again and check what the HUD shows
  cli(['xr', 'look-at'], { device: 'gaze', target: { x: 0, y: 1.2, z: -2 } });
  cli(['xr', 'set-transform'], { device: 'headset', orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(900);
  const h = step('state', { read: ['hudAngles'] }).hudAngles;
  const fixed = ['caption', 'ring', 'strip'].filter((k) => h[k]);
  C.ok('caption, score ring and section strip are inside the Glasses FoV (corners)', fixed.length >= 2 && fixed.every((k) => h[k].inView), h);
  const arrows = Object.keys(h).filter((k) => k.startsWith('arrow-'));
  C.ok('edge arrows drawn for sections outside the FoV, inside the FoV themselves', arrows.length > 0 && arrows.every((k) => h[k].inView), arrows);
  const shot = join(RESULTS, `${tag}-fov.png`);
  cli(['browser', 'screenshot'], { outputFile: shot });
  const errs = errors();
  C.ok('zero console errors', errs.length === 0, errs.slice(0, 5));
  save(tag, { ...C.summary(), hud: h, screenshot: shot });
}

const run = { quest, complete, glasses }[mode];
if (!run) throw new Error(`unknown mode ${mode}`);
run()
  .catch((e) => {
    C.ok(`run finished without an exception`, false, String(e.message ?? e).slice(0, 600));
    save(tag, C.summary());
  })
  .finally(() => {
    console.log(`\n${tag}: ${C.items.length - C.failed}/${C.items.length} checks passed`);
    process.exitCode = C.failed ? 1 : 0;
  });
