# Jangdan testing

Latest verification: **25 Oct 2026, 14:11–14:18 UTC**, in the Loom `t-e2e2` worktree. No headset. One heavy slot, acquired before the IWSDK browser and released after the landing Chrome exited.

## Fresh verification

- `npm ci --no-audit --no-fund` in `packages/app` installed 258 packages from the existing lockfile. No dependency or lockfile changes.
- Unit, fresh: Vitest, 8 files, **60 passed**. `npx tsc --noEmit` in `packages/core` exit 0.
- Emulator: `npx iwsdk dev up --ai-mode agent --allow-browser-automation`, then `node e2e/run.mjs` for the four modes below, then `npx iwsdk dev down` (`stopped: true`). `iwsdk.config.json` is restored to `metaQuest3` / `sunlit_living_room`.
- Landing: Python static server on `127.0.0.1`, headless Chrome. `index.html` and `evidence.html` at 1280×800 and 375×812. `scrollWidth` equals `clientWidth` on both (1265 at 1280×800, where the other 15 px is the scrollbar; 375 at 375×812). Self-hosted woff2 requests returned 200. 0 console errors. No landing change.

## Unit (packages/core)

`npm test` — Vitest, 8 files, **60 passed**, 0 failed. `npx tsc --noEmit` exit 0.

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

## Emulator (packages/app)

One agent-mode dev server, one managed browser. `node e2e/run.mjs <mode> <room>`. IWSDK 1.1.0-rc.2, IWER, headless Chrome.

| Run | Result | CPU p95 | Draws | Triangles | Console errors |
|---|---|---|---|---|---|
| Quest 3 · sunlit_living_room | **23/23** | 0.3 ms | 48 | 18,736 | 0 |
| Quest 3 · home_office | **23/23** | 0.3 ms | 48 | 18,736 | 0 |
| Hands-only full piece · sunlit_living_room | **8/8** | 0.3 ms | 48 | 18,736 | 0 |
| Meta VR Glasses · sunlit_living_room | **9/9** | not sampled | not sampled | not sampled | 0 |

Gates from the spec: main-thread CPU p95 ≤ 4 ms, ≤ 60 draw calls, ≤ 80k triangles, 0 console errors. The three measured runs are inside them.

- Quest 3 · sunlit living room: tempo 95.85 after 8+ beats. Left palm reads ff. Hand ray + pinch cues strings. Fist silences every section and the caption is "your room is the hall". Offline RMS 0.124 while playing, 0 after the cut-off. Room volume 90 m³, RT60 0.80 s. Frame interval p95 18.6 ms.
- Quest 3 · home office: same loop. Room volume 42.5 m³, RT60 0.66 s. Frame interval p95 18.4 ms.
- Hands-only full piece: fermata reached, fist completed the piece. 112 ictus. Togetherness 61 (steadiness 0.81), saved to IndexedDB. Frame interval p95 18.5 ms.
- Meta VR Glasses: gaze + pinch cues brass and strings. Caption, score ring and section strip stay inside the FoV. Edge arrows for strings and winds.

The emulator is not a 72 fps headset.

## Landing

Served `packages/landing` with `python3 -m http.server` bound to `127.0.0.1`, then opened in headless Chrome.

| Viewport | Page | scrollWidth | clientWidth | Font requests | Console errors |
|---|---|---|---|---|---|
| 1280×800 | index.html, evidence.html | 1265 | 1265 | 200, no 404 | 0 |
| 375×812 | index.html, evidence.html | 375 | 375 | 200, no 404 | 0 |

Familjen Grotesk (400, 700) and Kode Mono (400, 600) loaded from `fonts/`. Weight 600 of Familjen Grotesk is not used on these pages, so it was not requested. No Google Fonts request.

## Clip

Not re-recorded this pass (`e2e/record.mjs` was not run). The existing clip remains:

- `grokbot/videos/jangdan/jangdan-whoa.mp4` — 24.0 s, 1441 frames, program audio muxed, no edits
- CPU p95 over the clip 0.2 ms, 48 draw calls, 18,736 triangles
- The landing uses a copy at `packages/landing/assets/jangdan-whoa.mp4` (sound off, captions on)

## Unverified on hardware

Quest Browser audio latency, real hand-tracking velocity noise, and a locked 72 fps. The wrist menu has a calibration tap for the latency. The Representative does the headset pass.
