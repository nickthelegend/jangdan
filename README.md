# Jangdan (장단)

*Jangdan* is Korean for a rhythmic cycle.

**Raise your hands and your room becomes a concert hall.** Four sections of a light orchestra take their places on your
real walls and table. Your right hand sets the tempo, your left sets the dynamics, and every note washes over the surface
it plays from. The size of your room sets the reverb.

Meta VR Start Developer Competition 2026 · Track: **Entertainment** (music visualisation, spatial audio) · Division:
**New Experience** · secondary target: Judge's Choice · IWSDK (WebXR), hands only, seated.

| | |
|---|---|
| Spec | `grokbot/specs/meta-vr/jangdan.md` |
| Test recordings (emulator) | `grokbot/videos/jangdan/` |
| Tests | [TESTING.md](TESTING.md) |
| Submission draft | [HACKATHON_SUBMISSION_FORM.md](HACKATHON_SUBMISSION_FORM.md) |

## How it plays

| Action | Quest 3 / 3S | Meta VR Glasses |
|---|---|---|
| Start | Raise the right hand, drop it: one-bar count-in, then the music | same |
| Tempo | Right-hand beat. Ictus = a peak in the wrist's downward velocity, with hysteresis; 60–160 BPM | same |
| Dynamics | Left-palm height, smoothed: *pp* at the lap, *ff* at eye level | same |
| Cue a section | Point a hand ray at its surface and pinch | **look** at it and pinch (eye gaze) |
| Solo / mute | Keep the pinch 0.6 s: solo, again: muted, again: back in | gaze + pinch-hold |
| Cut off | A fist with either hand: silence, dark walls, one bell | same |
| Menu | Left palm up: piece, Conduct / Listen / Ghost, calm light, one hand, calibrate, exit (buttons ≥ 4 cm, poke or ray) | gaze + pinch |

**Gaze, honestly:** Quest 3 has no eye tracking, so on Quest cueing uses the hand ray. Only on Meta VR Glasses does "look
at the strings and pinch" use real eye gaze. Both go to the same IWSDK `RayInteractable` targets.

**Listen mode** (lean-back): the orchestra conducts itself through the pieces as a concert; small hand sweeps paint light
where your hand points. **Ghost** replays your last take of the piece (its tempo and dynamics). **One-hand mode**: tap
down with the right index finger for the beat; the same hand's height sets the dynamics. **Calm light** caps ripples and
flashes. Captions show every cue.

## Why the real room matters

- `packages/core/src/stage.ts` assigns the four sections to real surfaces. Planes have no labels, so each one is
  classified by orientation and height (floor, table, ceiling, left/right/front/back wall relative to the seated
  listener) and scored by role fit and size; the best one-surface-per-section assignment is searched exhaustively.
  Real surfaces beat banners: in a room without a left wall the strings move to the front wall and the brass to the
  ceiling.
- Each surface gets an **additive light wash drawn on that plane's own polygon** (so the light stops at the real wall's
  edge) and an **HRTF positional source at its centroid** (sound comes from that wall).
- A room with missing surfaces gets **paper banners**, hung virtually where the missing wall would be and labelled
  "paper banner ... no right wall found".
- **The room sets the reverb**: the surfaces' bounding box gives a volume; Sabine's formula (absorption 0.14) gives the
  RT60; the stereo impulse response is generated in code (early reflections from the three room dimensions plus a
  seeded, darkening noise tail). A 19 m³ home office rings for about half a second; a 560 m³ loft for 1.4 s.

## Music

Three original pieces (Hanji Light, Semachi Rain, Hwimori Lanterns; 65–80 s each) written as JSON scores in a compact
notation (`packages/core/src/pieces/*.json`; rehearsal phrases A, B, C... with one line per section), plus a **Daily**
generative piece: a seeded voice-led generator (Korean pentatonic *pyeongjo* / *gyemyeonjo* and three church modes) that
is the same for everyone on a UTC day. The v1 pieces were drafted by the build agent so the loop works end to end; the
team's Representative owns composing and tuning them (see Submission form).

All sound is Web Audio synthesis, scheduled ahead on the AudioContext clock (the "two clocks" look-ahead scheduler):
strings are a detuned two-oscillator wavetable, winds and brass are FM voices, the janggu is synthesised (membrane
pitch-drop for *kung*, filtered noise for *deok*, a jing gong for the finale), and the cut-off bell is an FM bell.
No samples.

## Repository

```
packages/core     pure TypeScript, no DOM: beat tracker, dynamics, gestures, look-ahead scheduler, score
                  notation + compiler, generator, stage assignment, room reverb, performance loop, togetherness
                  score. Vitest.
packages/app      the IWSDK app: stage (planes -> surfaces -> washes + banners + audio), conductor (hands ->
                  performance -> synth), cues (ray/gaze + pinch), light, head-locked HUD, wrist menu, e2e harness.
packages/landing  overture laid out as an orchestral full score (static HTML/CSS). The method,
                  the pieces, and the emulator numbers live on evidence.html.
```

## Run it

### On a Quest 3 / 3S (how Nick or the Representative runs it later)

Requirements: Node ≥ 20.19 (or 22.12+, 24+), a Quest 3/3S with hand tracking enabled and Space Setup done.

```sh
cd packages/app
npm install
npm run dev                      # IWSDK dev server (HTTPS, self-signed) + managed browser
npx iwsdk dev status             # shows data.runtimeUrls.network, e.g. https://192.168.1.20:8081/
```

- **Same Wi-Fi:** open the `runtimeUrls.network` URL in the Meta Quest Browser, accept the certificate warning, tap
  **Enter the hall**, allow hand tracking and spatial data.
- **USB (adb reverse):** `adb reverse tcp:8081 tcp:8081`, then open `https://localhost:8081/` in the Quest Browser.
  To avoid the certificate warning, set `iwsdkDev({ https: false })` in `vite.config.ts` and open
  `http://localhost:8081/` (localhost over adb reverse is a secure context).
- Sit down, put the controllers away, raise your right hand.

No hosting or deploys are part of this repo yet; the team publishes the public URL (GitHub Pages / Vercel) for the
submission. `npm run build` produces a static `dist/`.

### Tests

```sh
cd packages/core && npm install && npm test      # unit tests
cd packages/app && npm run typecheck && npm run build
# e2e (emulator): needs the dev server in agent mode
npx iwsdk dev up --ai-mode agent --allow-browser-automation
node e2e/run.mjs quest sunlit_living_room
node e2e/run.mjs quest home_office
node e2e/run.mjs complete sunlit_living_room
node e2e/run.mjs glasses sunlit_living_room
node e2e/record.mjs sunlit_living_room jangdan-whoa   # 20-40 s clip with the program's real audio
npx iwsdk dev down
```

## Honest status

- Everything above is verified in the IWER emulator with emulated hands (see [TESTING.md](TESTING.md) for the counts).
- **Unverified on hardware:** Quest Browser audio latency (beats need to feel tight; there is a calibration tap),
  real hand-tracking velocity noise, and 72 fps on Quest.
- Fonts: Familjen Grotesk and Kode Mono (SIL OFL, from `@fontsource`). No other external assets.

## License

MIT, see [LICENSE](LICENSE).
