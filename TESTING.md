# Jangdan testing

Recorded 25 Oct 2026 on this machine (IWER, headless Chrome, IWSDK 1.1.0-rc.2). No headset.

## Unit (packages/core)

`npm test` — Vitest, 8 files, **60 passed**, 0 failed.

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

`npx tsc --noEmit` in `packages/core` and `packages/app` passed.

## Emulator (packages/app)

One agent-mode dev server, one managed browser. `node e2e/run.mjs <mode> <room>`.

| Run | Result | CPU p95 | Draws | Triangles | Notes |
|---|---|---|---|---|---|
| Quest 3 · sunlit_living_room | **23/23** | 0.3 ms | 48 | 18,736 | Tempo 96.06 after 8+ beats. Left palm reads ff. Hand ray + pinch cues strings. Fist silences every section and the caption is "your room is the hall". Offline RMS 0.124 while playing, 0 after the cut-off. 0 console errors |
| Quest 3 · home_office | **23/23** | 0.3 ms | 48 | 18,736 | Same loop. Room volume 42.5 m³, RT60 0.66 s (the living room was 90 m³, RT60 0.80 s) |
| Hands-only full piece · sunlit_living_room | **8/8** | 0.3 ms | 48 | 18,736 | Fermata reached, fist completed the piece. 112 ictus. Togetherness 64 (steadiness 0.87), saved to IndexedDB |
| Meta VR Glasses · sunlit_living_room | **9/9** | not sampled | not sampled | not sampled | Gaze + pinch cues brass and strings. Caption, score ring and section strip stay inside the FoV. Edge arrows for strings and winds. 0 console errors |

Gates from the spec: main-thread CPU p95 ≤ 4 ms, ≤ 60 draw calls, ≤ 80k triangles, 0 console errors. All three measured runs are inside them. Frame interval p95 on the Quest runs was 17.6 ms (the emulator is not a 72 fps headset).

## Clip

`node e2e/record.mjs sunlit_living_room jangdan-whoa`

- `grokbot/videos/jangdan/jangdan-whoa.mp4` — 24.0 s, 1441 frames, program audio muxed, no edits
- CPU p95 over the clip 0.2 ms, 48 draw calls, 18,736 triangles
- The landing uses a copy at `packages/landing/assets/jangdan-whoa.mp4` (sound off, captions on)

## Unverified on hardware

Quest Browser audio latency, real hand-tracking velocity noise, and a locked 72 fps. The wrist menu has a calibration tap for the latency. The Representative does the headset pass.
