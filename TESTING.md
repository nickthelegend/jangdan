# Jangdan testing

Latest verification: **15 Nov 2026, 11:13–12:06 UTC**, on `main` after the light-show and legibility pass
(`docs/JUDGE-NOV15.md`). No headset. One heavy slot, acquired before the IWSDK dev server and released after
`npx iwsdk dev down` (`stopped: true`). `iwsdk.config.json` restored to `metaQuest3` / `sunlit_living_room`.

## Unit (packages/core)

`npm test` — Vitest, 9 files, **70 passed**, 0 failed. `npx tsc --noEmit` exit 0. `packages/app`: `npm run typecheck`
exit 0, `npx vite build` exit 0.

| File | What it locks |
|---|---|
| beat.test.ts | 72, 96 and 120 BPM within ±3 on sine and bounce trajectories, including jitter; a missed beat is not a halved tempo; a one-frame glitch does not add a beat; a hand that steps 35 cm and stays there recovers the beat |
| gestures.test.ts | Fist only after the hold, and not on a point or an open hand. Palm height maps pp at the lap to ff at eye level |
| scheduler.test.ts | No drift over 5 simulated minutes. Notes are handed out before they are due |
| generator.test.ts | Same seed, same piece. The daily seed is stable for one UTC day |
| stage.test.ts | Full room, two planes (labelled banners for the rest), no planes, and a home office with no left wall |
| reverb.test.ts | IR length, RT60 and wet level grow with room volume. The IR is deterministic |
| piece.test.ts | Three authored pieces, each 60–90 s, all four sections, cue entries |
| performance.test.ts | Count-in, fist within one beat, a full hands-only piece, listen mode, ghost replay, togetherness score |
| lightshow.test.ts (new, 10) | Light colours bright enough over a lit wall; the flood grows and brightens from pp to ff; louder notes bloom brighter and calm light caps every bloom; a note's ring crosses its whole surface within the bloom's life; notes land inside the surface, pitch climbs across it, janggu strokes split left/right; the beat flash fires every beat (downbeat hardest) and is gone before the next; the bar sweep crosses once per bar; tempo vs written in words; the baton trail ring buffer; quads sized by `quadWidthFor` keep text ≥ 18 mm cap height per metre (and the old 0.36 m label at 3 m did not) |

## Emulator (packages/app)

One agent-mode dev server, one managed browser. `node e2e/run.mjs <mode> <room>`. IWSDK 1.1.0-rc.2, IWER, headless Chrome.

| Run | Result | CPU p95 | Draws | Triangles | Console errors |
|---|---|---|---|---|---|
| Quest 3 · sunlit_living_room | **26/26** | 0.4 ms | 46 | 19,120 | 0 |
| Quest 3 · home_office | **26/26** | 0.4 ms | 46 | 19,120 | 0 |
| Hands-only full piece · sunlit_living_room | **8/8** | 0.3 ms | 46 | 19,120 | 0 |
| Meta VR Glasses · sunlit_living_room | **9/9** | not sampled | not sampled | not sampled | 0 |

**69/69** emulator checks. New in the Quest runs (3 checks each):

- *Notes bloom on their surfaces*: 36 blooms in the first ~10 s of music (one per scheduled note).
- *Full brightness at f/ff*: per-section peak wash intensity strings 1.46, winds 1.39, janggu 0.83, brass 0.39
  (brass is resting in that passage); the check is peak ≥ 1.
- *Legibility*: every visible HUD quad and section label, read back from the live app, has its smallest text at
  ≥ 18 mm cap height per metre of viewing distance: caption 20.0, stand 18.9, labels 20.7 mm/m. The wrist menu
  (measured with the panel open) is 50 mm/m.

Gates from the spec: main-thread CPU p95 ≤ 4 ms, ≤ 60 draw calls, ≤ 80k triangles, 0 console errors. The three measured runs are inside them. Draw calls went down from 48 to 46 although sparks and the baton trail were added: the four edge LineLoops were folded into the wash shader. With the wrist menu open the film takes peaked at 54.

- Quest 3 · sunlit living room: tempo 96.36 after 8+ beats. Left palm reads ff. Hand ray + pinch cues strings. Fist silences every section and the caption is "your room is the hall". Offline RMS 0.124 while playing, 0 after the cut-off. Room volume 90 m³, RT60 0.80 s. Frame interval p95 18.0 ms.
- Quest 3 · home office: same loop. Tempo 96.15. Room volume 42.5 m³, RT60 0.66 s. Frame interval p95 18.3 ms.
- Hands-only full piece: fermata reached, fist completed the piece. 112 ictus. Togetherness 63 (steadiness 0.85), saved to IndexedDB. Frame interval p95 18.3 ms.
- Meta VR Glasses: gaze + pinch cues brass and strings. Caption, score ring and section strip stay inside the FoV. Edge arrows for strings and winds.

The emulator is not a 72 fps headset.

## Landing

15 Nov: only content changed (the numbers above and a new 24 s clip + poster + captions); layout and CSS untouched, so the 25 Oct viewport run below still describes it. Not re-run in headless Chrome this pass.

Served `packages/landing` with `python3 -m http.server` bound to `127.0.0.1`, then opened in headless Chrome.

| Viewport | Page | scrollWidth | clientWidth | Font requests | Console errors |
|---|---|---|---|---|---|
| 1280×800 | index.html, evidence.html | 1265 | 1265 | 200, no 404 | 0 |
| 375×812 | index.html, evidence.html | 375 | 375 | 200, no 404 | 0 |

Familjen Grotesk (400, 700) and Kode Mono (400, 600) loaded from `fonts/`. Weight 600 of Familjen Grotesk is not used on these pages, so it was not requested. No Google Fonts request.

## Film takes (emulator)

`node e2e/film.mjs [take ...]` records the film's takes (script: `e2e/film-script.mjs`) at 1920×1080 with the
program's real audio, all input through emulated hands and gaze. Eight takes (launch, conduct, listen, comfort,
calibrate, daily, office, glasses), each with its app log and metrics in `grokbot/videos/jangdan/film-src/*.json`:
CPU p95 0.2 ms, frame p95 17.6–18.4 ms, draw calls ≤ 54, 0 console errors. The cut film:
`grokbot/videos/jangdan/jangdan-film.mp4` (2:51), shot list `jangdan-film.md`.

Found and fixed while filming: poking the wrist menu moved the right hand like a beat and could start the music
(now raise and ictus are ignored while the menu is open and for 0.6 s after). Known emulator quirk: an emulated
index-finger poke on the menu's bottom row (Calibrate, Exit) does not register; hand ray + pinch on the same
buttons does. Unverified on hardware.

The landing clip `packages/landing/assets/jangdan-whoa.mp4` (24 s, sound off, captions in the .vtt) is cut from the
conduct take.

## Unverified on hardware

Quest Browser audio latency, real hand-tracking velocity noise, and a locked 72 fps. The wrist menu has a calibration tap for the latency. The Representative does the headset pass.
