/**
 * Cues and mixing on the section surfaces. Quest 3: point a hand ray at a section's surface and pinch.
 * Meta VR Glasses: look at it and pinch (eye gaze). Both arrive as IWSDK Hovered/Pressed on the same
 * RayInteractable target. A pinch cues the section; holding the pinch 0.6 s cycles solo -> muted -> back in.
 */
import { createSystem, type Entity, Hovered, Pressed } from '@iwsdk/core';
import type { SectionId } from '@jangdan/core';
import { SectionTarget } from '../components.js';
import { rt } from '../runtime.js';
import { actions } from './conductor-system.js';

export const HOLD_SECONDS = 0.6;

export class CueSystem extends createSystem({
  targets: { required: [SectionTarget] },
  hovered: { required: [SectionTarget, Hovered] },
  pressed: { required: [SectionTarget, Pressed] },
}) {
  private pressStart = new Map<Entity, number>();
  private held = new Set<Entity>();

  init(): void {
    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (e) => {
        this.pressStart.set(e, performance.now() / 1000);
        const s = e.getValue(SectionTarget, 'section') as SectionId;
        actions.cue(s);
      }),
      this.queries.pressed.subscribe('disqualify', (e) => {
        this.pressStart.delete(e);
        this.held.delete(e);
      }),
    );
  }

  update(dt: number): void {
    const st = rt.stage;
    if (!st) return;
    const k = 1 - Math.exp(-dt * 10);
    for (const e of this.queries.targets.entities) {
      const s = e.getValue(SectionTarget, 'section') as SectionId;
      const v = st.sections[s];
      if (!v) continue;
      const h = e.hasComponent(Hovered) ? 1 : 0;
      v.hover += (h - v.hover) * k;
    }
    const now = performance.now() / 1000;
    for (const [e, t] of this.pressStart) {
      if (!this.held.has(e) && now - t >= HOLD_SECONDS) {
        this.held.add(e);
        actions.cycleMix(e.getValue(SectionTarget, 'section') as SectionId);
      }
    }
  }
}
