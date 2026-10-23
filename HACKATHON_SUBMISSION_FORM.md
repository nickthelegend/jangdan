# Jangdan · Meta VR Start Developer Competition 2026 · submission draft

Draft for the team's Representative to adapt and submit on Devpost (deadline Nov 18, 2026 12:00 PM PST = 20:00 UTC;
target Nov 17 18:00 UTC). Freeze the app and its URL after submitting, until winners are announced (~Dec 11).
Rules digest: `grokbot/specs/meta-vr/RULES.md`.

| Field | Value |
|---|---|
| Project name | Jangdan |
| Tagline (≤ 140) | Conduct a light orchestra with your hands: four sections play from your real walls and table, and your room sets the reverb. |
| Track | Entertainment |
| Division | New Experience (repo created Oct 24, 2026, inside the window; no pre-existing code) |
| Also eligible for | Judge's Choice (secondary target) |
| Platform | Immersive Web SDK (WebXR), submitted as a public URL opened in the Meta Quest Browser |
| Hands-first | Yes: the whole experience, menu included, works with hands only; no controller paths exist |
| Target launch date | (Representative decides; the build is a web URL, so "at submission" is honest) |
| Video | < 3 min, public on YouTube or Vimeo, with sound, real footage (emulator footage is allowed by the rules) |
| Team | Representative: (name, email, role: composer, voice tuning, playtesting, owner of repo/URL/video/submission). Nick (nickthelegend): non-Representative member, engineering. |

## Description (≈ 480 words)

**Inspiration.** A *jangdan* is a Korean rhythmic cycle, the heartbeat a janggu drummer keeps for a whole ensemble. We
wanted the feeling of standing in front of an orchestra without leaving the couch, and we wanted the room you are
already sitting in to be the hall. Not a virtual stage pasted in front of you: your left wall, your right wall, your
coffee table.

**What it is.** Raise your right hand and drop it. A one-bar count-in clicks from your table, and four sections of a
light orchestra start playing from the surfaces of your real room: strings on the left wall, winds on the right, brass
on the far wall, a synthesised janggu on the table. Your right hand's beat sets the tempo, your left palm's height sets
the dynamics, and every note washes over the wall it plays from, stopping exactly at the wall's real edge. Point at a
wall and pinch to cue that section; hold the pinch to solo or mute it. Close your fist and the orchestra stops on the
spot: the walls go dark and one bell rings. Each take earns a togetherness score (beat steadiness, cue timing, dynamic
range), saved per piece, and Ghost mode replays your last take. Listen mode turns it into a lean-back concert where
your hands only paint light.

**How we built it.** IWSDK on WebXR. Scene understanding gives unlabelled planes, so Jangdan classifies each one by
orientation and height relative to you and searches for the best surface for each section; missing walls become
clearly labelled paper banners. Each light wash is a procedural additive shader drawn on the plane's own polygon. Each
section is an HRTF-panned source at its surface's centroid, sharing IWSDK's audio listener, and the room's measured
volume sets a convolution reverb whose impulse response we generate in code with Sabine's formula: a small office
sounds dry, a loft sounds wet. Beat detection reads WebXR hand joints: an ictus is a peak in the wrist's downward
velocity with hysteresis, filtered for missed beats and tracking glitches. Music is Web Audio synthesis scheduled ahead
on the audio clock (wavetable strings, FM winds and brass, a synthesised janggu and jing), from three original pieces in
Korean pentatonic modes plus a seeded generative piece that changes every day. On Meta VR Glasses, cues use real eye
gaze and the HUD stays inside the narrower field of view, with arrows pointing at sections outside it.

**What's next.** A headset pass for audio latency and beat feel (a calibration tap is built in), more pieces written by
our composer, and two-person duets where one conducts and one plays the janggu on the table.

## How hand interactions are implemented (optional field)

Right-wrist height sampled from `XRFrame.fillPoses` each frame drives a beat tracker (velocity peak + hysteresis,
parabolic peak refinement, interval outlier filter, 60–160 BPM). Left-palm height (wrist + middle knuckle) maps to
*pp–ff* with a 0.25 s smoother. A fist is detected from finger extension ratios (tip-to-wrist over knuckle-to-wrist)
held 60 ms. Cues use IWSDK `RayInteractable` targets on each surface (hand ray + pinch on Quest, gaze + pinch on
Glasses); a 0.6 s pinch-hold cycles solo and mute. The palm-up wrist menu is UIKitML with ≥ 4 cm poke targets.

## Judging criteria map

| Criterion (25% each) | Jangdan |
|---|---|
| Innovation & Creativity | Your room's geometry decides where every section sits, how it is lit and how it sounds (reverb from room volume). Daily seeded pieces and a saved togetherness score drive repeat play |
| Experience Design | Music in under 10 s (raise, drop). Seated, within arm's reach. Lean-back Listen mode for Entertainment. Passthrough is purposeful: walls host the sections. Captions for cues, calm-light and one-hand modes |
| Technical Implementation | Beat detection from WebXR hand joints, a look-ahead AudioContext scheduler, plane-clipped light decals, HRTF sources at plane centroids, room-derived generated IR, Glasses gaze cueing with a FoV-aware HUD. Emulator metrics in TESTING.md |
| Polish & Presentation | Obangsaek palette (one colour per section plus white), four crafted synth voices, honest video with sound |

## What the Representative must do (from the spec)

1. Be eligible and a VR Start member; join Devpost; create the team; add Nick as a non-Representative member.
2. Genuinely own part of the build: compose (or rewrite) the three pieces as JSON scores, tune the four voices in
   `packages/core/src/voices.ts`, playtest the conducting feel.
3. Own the repo, the public URL (e.g. GitHub Pages from `packages/app/dist`), the video (with audio) and the submission.
4. With a Quest 3/3S: check audio latency and beat feel, run the calibration tap, and do one real room pass.
