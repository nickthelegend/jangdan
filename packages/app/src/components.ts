import { createComponent, defineComponents, Types } from '@iwsdk/core';

export const SectionEnum = { strings: 'strings', winds: 'winds', brass: 'brass', percussion: 'percussion' } as const;

/** A section's light surface (a real plane, a furniture top or a paper banner): the ray/gaze cue target. */
export const SectionTarget = createComponent('SectionTarget', {
  section: { type: Types.Enum, enum: SectionEnum, default: SectionEnum.strings },
  banner: { type: Types.Boolean, default: false },
});

/** Tag for the palm-up wrist menu panel. */
export const WristMenu = createComponent('WristMenu', {});

export default defineComponents([SectionTarget, WristMenu]);
