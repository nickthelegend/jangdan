import { AudioListener, World, VisibilityState } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AudioEngine } from './audio/engine.js';
import { installDebug, MetricsSystem, timeSystem } from './debug.js';
import { rt } from './runtime.js';
import { ConductorSystem } from './systems/conductor-system.js';
import { CueSystem } from './systems/cue-system.js';
import { HudSystem } from './systems/hud-system.js';
import { LightSystem } from './systems/light-system.js';
import { MenuSystem } from './systems/menu-system.js';
import { StageSystem } from './systems/stage-system.js';
import { loadFonts } from './visual/fonts.js';

const overlay = document.getElementById('intro') as HTMLDivElement;
const enter = document.getElementById('enter') as HTMLButtonElement;
const note = document.getElementById('intro-note') as HTMLParagraphElement;

function fail(msg: string): void {
  note.textContent = msg;
  note.classList.add('error');
}

async function main(): Promise<void> {
  await loadFonts().catch(() => fail('Fonts failed to load; text falls back to system fonts.'));
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions);

  // share IWSDK's AudioListener (on the head) so section panners and the listener agree
  const head = world.player.head;
  let listener = head.children.find((c) => (c as AudioListener).type === 'AudioListener') as AudioListener | undefined;
  if (!listener) {
    listener = new AudioListener();
    head.add(listener);
  }
  rt.engine = new AudioEngine(listener, world.scene);

  world.registerSystem(StageSystem);
  world.registerSystem(ConductorSystem);
  world.registerSystem(CueSystem);
  world.registerSystem(LightSystem);
  world.registerSystem(HudSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(MetricsSystem);
  const stage = world.getSystem(StageSystem)!;
  const conductor = world.getSystem(ConductorSystem)!;
  const light = world.getSystem(LightSystem)!;
  const hud = world.getSystem(HudSystem)!;
  const menu = world.getSystem(MenuSystem)!;
  light.setConductor(conductor);
  menu.setConductor(conductor);
  for (const s of [stage, conductor, world.getSystem(CueSystem)!, light, hud, menu]) timeSystem(s);
  installDebug(world, conductor, hud, stage);

  world.renderer.xr.addEventListener('sessionstart', () => {
    const session = world.renderer.xr.getSession();
    const feats = (session as unknown as { enabledFeatures?: string[] })?.enabledFeatures ?? [];
    rt.glasses = feats.includes('gaze-tracking');
    rt.push('session', { features: feats, glasses: rt.glasses });
    void rt.engine?.resume();
  });
  world.visibilityState.subscribe((vs) => {
    overlay.hidden = vs !== VisibilityState.NonImmersive;
  });

  if (!world.xrEnabled || !('xr' in navigator)) {
    enter.disabled = true;
    fail('Setup required: open this page in the Meta Quest Browser (Quest 3 or 3S, hand tracking on). WebXR is not available here.');
    return;
  }
  const supported = await navigator.xr!.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) {
    enter.disabled = true;
    fail('Setup required: this browser has WebXR but no mixed-reality (immersive-ar) sessions. Use the Meta Quest Browser.');
    return;
  }
  enter.disabled = false;
  enter.addEventListener('click', () => {
    void rt.engine?.resume();
    world.launchXR();
  });
}

main().catch((e) => {
  console.error('[jangdan] failed to start', e);
  fail(`Jangdan failed to start: ${(e as Error).message}`);
});
