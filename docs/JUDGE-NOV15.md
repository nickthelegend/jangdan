# Jangdan: headset-judge pass, 15 Nov 2026

Judged the way a Meta VR Start judge would see it: the production build in the IWER emulator (Quest 3 profile,
`sunlit_living_room`, seated at 1.2 m, emulated hands), frames taken from the user's eye, plus the existing 24 s clip
(`grokbot/videos/jangdan/jangdan-whoa.mp4`). Four equal criteria, scored out of 10, no inflation.

## Before (commit 7d913fb, the Oct 25 build)

| Criterion | Score | Why |
|---|---|---|
| Innovation & Creativity | 7.0 | The idea is strong and unusual: your real walls are the sections, the room's volume sets the reverb. But on screen it reads as "a living room with a HUD", so the idea doesn't land. |
| Experience Design | 6.0 | Music in under 10 s (raise, drop) and good captions. But the feedback loop is broken: you change tempo and dynamics and the room barely answers. Tempo shows only as a number on a 13 cm ring. |
| Technical Implementation | 7.5 | Beat tracker from hand joints, a look-ahead scheduler, plane-clipped decals, HRTF sources at plane centroids, a generated room IR, 60 unit tests and 4 emulator suites. All solid, and almost none of it is visible. |
| Polish & Presentation | 4.5 | The light is close to invisible: the blue strings wash adds almost nothing over the wall. Text is tiny. The clip is square, 24 s long, shows the emulator toolbar and covers one feature. |
| **Mean** | **6.25** | |

### The five biggest problems

1. **The light orchestra is barely visible.** Washes used the dark brand hues (blue `#1f4fbf`, red `#d6322b`) additively at
   about 40 % alpha. Note ripples moved at 1.25 m/s with a fast decay, so they stayed small rings near the surface's
   centre. While the music plays, the room looks empty.
2. **Tempo and dynamics aren't on screen.** The only readout was a 0.13 m ring with 8.5 mm "BPM · mf" text. Speeding up
   or swelling to *ff* changed nothing you could point at.
3. **The UI is too small.** Caption sub-line cap height 16 mm at 1 m, ring label 8.5 mm, wall labels about 8 mm per metre
   of distance (0.36 m quads 2–3 m away), wrist-menu body text 1.35 units. The floor is 18 mm per metre.
4. **No visual link between the hands and the beat.** The conducting hand showed no trace, so a viewer can't see that
   the hand is setting the beat.
5. **The presentation undersells it.** One 24 s square clip with the emulator chrome, no story of the features
   (cues, solo/mute, Listen, Ghost, comfort modes, Glasses, other rooms) and no film.

### What I will fix (highest impact first)

1. Make every note bloom across its whole surface: a hot core at the onset, then a ring that crosses the wall within
   0.85 s and leaves a glowing wake, in lifted light colours (`LIGHT_COLOR`), plus light motes thrown off the surface.
2. Make tempo and dynamics obvious: every surface's frame flashes on each beat (downbeat hardest), a line of light
   crosses each surface once per bar, the steady flood grows from a pool at *pp* to the whole wall at *ff*, a baton
   trail follows the conducting fingertip and flashes on each ictus, and a large conductor's stand on the HUD shows
   BPM, "faster +26" against the written tempo, the dynamic mark and a hairpin meter.
3. Bigger UI everywhere, sized by rule (`quadWidthFor`, `capHeight` in core): HUD text ≥ 18.5 mm cap height at 1 m,
   wall labels scaled to their distance and moved high on the wall, wrist menu body text 1.8 units with 5.4-unit buttons.
4. Lock it with tests: unit tests for the light rules and legibility, plus e2e checks that notes bloom, the
   light reaches full brightness at *f*, and every visible text is ≥ 18 mm per metre.
5. Cut a full walkthrough film (< 3:00, 1920×1080, no emulator chrome) that shows the whole experience.

## After (15 Nov, same emulator, same seat)

What changed is in commits `d017f30`, `ddb1fcb`, `025d595` and the film tooling after them. Evidence: TESTING.md
(70 unit, 69/69 emulator checks) and `grokbot/videos/jangdan/jangdan-film.mp4` (2:51).

| Criterion | Before | After | Why |
|---|---|---|---|
| Innovation & Creativity | 7.0 | 7.5 | The idea now reads on screen: each wall is visibly a section, notes climb across it with pitch, and a second room shows the stage and reverb following the walls. Still one core trick, no social or two-person mode. |
| Experience Design | 6.0 | 7.5 | The loop answers you: palm up floods the walls, a faster beat flashes them faster, the baton trail draws your beat, the stand reads BPM, "faster +30" and the dynamic mark. Fixed a real bug found while filming (poking the menu could start the music). Held back: the head-locked stand sits low over the table, and nothing is verified on a headset. |
| Technical Implementation | 7.5 | 8.0 | Same engine plus a tested light-show module, live legibility read-back in the e2e, more effects on fewer draw calls (48 → 46), an emulator film rig that drives hands and gaze, not app calls. |
| Polish & Presentation | 4.5 | 7.0 | Bright, legible light on every note, UI text ≥ 18 mm per metre everywhere, a captioned 2:51 film covering every feature at 1920×1080 with no emulator chrome. Held back: emulator footage only, synthesised voices (no composer pass yet), the brass wall keeps a red rim whenever a hand ray rests on it, and the wrist menu reads large and slanted at palm distance. |
| **Mean** | **6.25** | **7.5** | |

### Still open (honest)

1. **No headset pass.** Quest Browser audio latency, real hand-tracking noise and 72 fps are unverified. The light
   intensities were tuned on emulator frames, not passthrough; they may need to come down on a real Quest.
2. In the emulator an index-finger poke on the wrist menu's bottom row (Calibrate, Exit) does not register; hand
   ray + pinch does. Check on hardware before calling the menu poke-complete.
3. Hover feedback (the rim) shows on whichever wall the resting hand ray points at, usually the front wall.
4. The three pieces and four voices are still the build agent's drafts; the Representative owns composing them.
