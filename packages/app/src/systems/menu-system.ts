/**
 * The palm-up wrist menu (UIKitML): turn the left palm up near your body and it opens above the palm.
 * Poke a button with the right index finger (or ray + pinch; gaze + pinch on Glasses).
 */
import { createSystem, type UIKitMLAsset, Vector3, VisibilityState } from '@iwsdk/core';
import { dailySeed, generatePiece, J, palmCenter, palmNormal, PIECES } from '@jangdan/core';
import { WristMenu } from '../components.js';
import { rt } from '../runtime.js';
import { status } from '../status.js';
import { actions, type ConductorSystem } from './conductor-system.js';

type El = { setProperties(p: Record<string, unknown>): void; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void; name: string };

export class MenuSystem extends createSystem({ menu: { required: [WristMenu] } }) {
  private panel: UIKitMLAsset | null = null;
  private conductor: ConductorSystem | null = null;
  private els = new Map<string, El>();
  private head = new Vector3();
  private lastKey = '';
  private openAmount = 0;

  setConductor(c: ConductorSystem): void {
    this.conductor = c;
  }

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('wrist-menu');
    if (!panel) {
      console.error('[jangdan] wrist menu panel missing from the scene');
      return;
    }
    this.panel = panel;
    panel.name = 'wrist-menu';
    panel.visible = false;
    const wire = (id: string, fn: () => void) => {
      const el = panel.getElementById(id) as unknown as El | undefined;
      if (!el) {
        console.error(`[jangdan] wrist menu element #${id} missing`);
        return;
      }
      el.name = id;
      const h = () => {
        rt.push('menu', { id });
        fn();
      };
      el.addEventListener('click', h);
      this.cleanupFuncs.push(() => el.removeEventListener('click', h));
      this.els.set(id, el);
    };
    for (let i = 0; i < 4; i++) wire(`btn-piece-${i}`, () => actions.selectPiece(i));
    wire('btn-conduct', () => actions.setMode('conduct'));
    wire('btn-listen', () => actions.setMode('listen'));
    wire('btn-ghost', () => actions.setMode('ghost'));
    wire('btn-flash', () => actions.toggleFlash());
    wire('btn-onehand', () => actions.toggleOneHand());
    wire('btn-calibrate', () => actions.calibrate());
    wire('btn-exit', () => this.world.exitXR());
    for (const id of ['menu-status', 'lbl-piece-3', 'lbl-flash', 'lbl-onehand']) {
      const el = panel.getElementById(id) as unknown as El | undefined;
      if (el) {
        el.name = id;
        this.els.set(id, el);
      }
    }
  }

  update(dt: number): void {
    const panel = this.panel;
    const c = this.conductor;
    if (!panel || !c) return;
    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    const open = immersive && status.menuOpen && c.hands.tracked.left;
    this.openAmount += ((open ? 1 : 0) - this.openAmount) * (1 - Math.exp(-dt * 14));
    panel.visible = this.openAmount > 0.05;
    if (!panel.visible) {
      panel.position.set(0, -10, 0);
      return;
    }
    // above the left palm, tilted to face the eyes
    const L = c.hands.joints.left;
    const pc = palmCenter(L);
    const n = palmNormal(L, 'left');
    panel.position.set(pc[0] + n[0] * 0.07, pc[1] + n[1] * 0.07 + 0.11, pc[2] + n[2] * 0.07);
    // shift toward the thumb side so the panel clears the fingers
    panel.position.x += (L[J.indexProximal * 3] - L[J.pinkyProximal * 3]) * 0.6;
    this.player.head.getWorldPosition(this.head);
    panel.lookAt(this.head);
    const s = 0.6 + 0.4 * this.openAmount;
    panel.scale.setScalar(s);
    this.refresh();
  }

  private refresh(): void {
    const set = rt.settings;
    const key = `${set.pieceIndex}|${set.mode}|${set.reducedFlash}|${set.oneHand}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ACTIVE = '#1f4fbf';
    const IDLE = '#24202a';
    for (let i = 0; i < 4; i++) this.els.get(`btn-piece-${i}`)?.setProperties({ backgroundColor: set.pieceIndex === i ? ACTIVE : IDLE });
    for (const m of ['conduct', 'listen', 'ghost'] as const) this.els.get(`btn-${m}`)?.setProperties({ backgroundColor: set.mode === m ? ACTIVE : IDLE });
    this.els.get('btn-flash')?.setProperties({ backgroundColor: set.reducedFlash ? ACTIVE : IDLE });
    this.els.get('btn-onehand')?.setProperties({ backgroundColor: set.oneHand ? ACTIVE : IDLE });
    const title = set.pieceIndex < PIECES.length ? PIECES[set.pieceIndex].title : generatePiece(dailySeed(new Date())).title;
    this.els.get('menu-status')?.setProperties({ text: `${title} · ${set.mode}${set.oneHand ? ' · one hand' : ''}` });
  }
}
