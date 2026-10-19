# Gesture Fire

A first-person 3D shooter with **no keyboard, no mouse** — every action is a hand
gesture or a head tilt read from your webcam via [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision)
(HandLandmarker + FaceLandmarker), rendered with [Three.js](https://threejs.org/).
Stand in an arena, turn with your head, aim with a finger-gun, and shoot
standing enemy targets.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5183`). The page requests
webcam access on Start — grant it, and the tracking models (a few MB each, for
hands and face) will download from a CDN on first load.

`npm run build` produces a static production build in `dist/`.

## Controls — the full gesture scheme

### Left hand — forward/stop only, never steers

| Gesture | Action |
|---|---|
| ✊ Closed fist | Stop moving forward |
| 🖐️ Open, relaxed palm | Move forward continuously |

### Head tilt — turning (look left/right)

| Gesture | Action |
|---|---|
| Tilt your head toward your left shoulder | Turn (look) left |
| Tilt your head toward your right shoulder | Turn (look) right |
| Head level (within the calibrated neutral) | Stop turning |

This is a real camera rotation — you can look all the way around the arena,
not just slide sideways. It runs off a **second** MediaPipe model
(FaceLandmarker) tracking your face independently of your hands, so it never
competes with the hand gestures below.

### Right hand — aim, fire, reload

| Gesture | Action |
|---|---|
| Relaxed / no recognized pose | Idle |
| 👉 Index finger extended straight, other fingers curled ("finger-gun") | **Aim**: FOV zooms in slightly, crosshair tightens |
| While aiming, curl the index finger sharply (like pulling a trigger) | **Fire** one shot — edge-triggered on the curl motion, not held down. Full-auto is deliberately impossible: firing requires re-extending the finger and a cooldown before the next shot arms |
| 🖐️ Whole palm fully open (all 5 fingers extended) | **Reload** |

The right wrist's *position* isn't tracked for anything — only the finger
pose matters, so resting your hand anywhere in frame is fine.

### Calibration

On first start (real camera mode only), a short 5-step onboarding walks
through each core pose — fist, open palm (left hand), finger-gun, open palm
(right hand), then a final "look straight ahead, keep your head level" step —
holding each for under a second. That last step captures your **neutral head
tilt**, since almost nobody's resting head position (or camera mount) is
perfectly level; turning is measured relative to that baseline, not to true
horizontal. You can skip calibration, but turning won't be zeroed to your
posture.

### On-screen UI

- **Controls** (top-right) — toggles a persistent gesture legend.
- **Settings** (top-right) — live sliders over every tunable threshold
  (curl sensitivity, open-palm extension, gun-pose latch time, fire cooldown,
  turn dead-zone/speed, smoothing, gesture stability hold), plus handedness-
  invert and turn-direction-invert checkboxes. Changes apply immediately, no
  reload needed.
- **Debug** (top-left) — shows the webcam feed with both hands' 21 tracked
  landmarks AND your two outer eye corners (the points the tilt angle is
  computed from) drawn on top, labeled by resolved handedness, plus a live
  boolean/numeric readout of every classified gesture and the head-tilt
  angle. Use this to check tracking and to see exactly why a gesture (or
  turning) isn't registering — including, for numeric thresholds like
  open-palm extension, *how close* you are, not just pass/fail.

## Verification / dev modes

- **`?mock=1`** — replaces the camera + MediaPipe pipeline with keyboard
  input emitting the identical input struct the real gesture layer produces:
  `W` hold = move forward, `A`/`D` hold = turn, `Shift` hold = aim,
  `Space` press = fire (only while aiming), `R` press = reload. Useful for
  testing the whole game with no webcam.
- **`?test=1`** — runs a camera-free correctness harness (handcrafted
  landmark arrays through the pure classifier functions, deterministic
  time-driven checks against the gesture-latch/trigger state machines, a
  point-blank hitscan/kill/respawn/reload-gating suite against the real game
  objects, and sign/math checks for the head-tilt-to-turn pipeline) and
  prints a pass/fail table instead of starting the game.

## Architecture

```
index.html                        HUD/overlay DOM + styles
src/
  main.js                         bootstrap, single requestAnimationFrame loop
  config.js                       every threshold/dead-zone/debounce timing, in one place
  gestures/
    handTracker.js                MediaPipe HandLandmarker wrapper (camera + inference)
    headTracker.js                MediaPipe FaceLandmarker wrapper, same video stream
    gestureClassifier.js          pure fns: isFist, isOpenPalm, isGunPose, indexExtension…
    faceClassifier.js             pure fn: headTiltDeg (head roll, for turning)
    inputState.js                 turns classified gestures into the shared input struct
    mockInput.js                  keyboard-driven stand-in for InputState (?mock=1)
    classifierTests.js            camera-free classifier/inputState test harness (?test=1)
  game/
    scene.js                      Three.js scene, lighting, arena, walls
    player.js                     camera rig: forward movement + head-tilt yaw turning + head bob
    weapon.js                     hitscan raycasting, ammo/reload, aim FOV tween, muzzle flash
    enemy.js                      enemy targets: spawn, health, hit reaction, death, respawn
    audio.js                      synthesized sound effects (Web Audio, no asset files)
    weaponTests.js                camera-free hitscan/kill/respawn/reload test harness (?test=1)
  ui/
    hud.js                        ammo, score, wave, crosshair, hit markers, legend
    calibration.js                5-step onboarding + neutral head-tilt capture
    settings.js                   live sensitivity/dead-zone tuning panel
    debugOverlay.js               landmark skeleton + eye-corner tilt line + gesture readout
```

Every frame, `main.js` calls (in order): `inputState.update()` to classify
this frame's gestures/tilt, `player.update()` to turn and move the camera,
`weapon.update()` to handle aim/fire/reload, `enemy.update()` on each target,
then `renderer.render()`.

### The shared input struct

Both `InputState` (real gestures) and `MockInputState` (`?mock=1`) produce the
exact same shape, so the entire game beyond the gesture layer never knows or
cares which one is driving it:

```js
{ moveForward, turn, aiming, firePressed, reloadPressed, debug }
```

`firePressed` and `reloadPressed` are **edge** flags (true for exactly one
frame); `moveForward`, `turn`, `aiming` are **level** signals. `turn` is a
continuous `[-1, 1]` yaw-rate command (positive = turn right).

## Design decisions worth knowing about

- **Head-tilt turning, not wrist-position strafing.** Movement direction was
  originally wrist-position-based (the right wrist's X offset from a
  calibrated neutral). It's now driven by tilting your head left/right
  instead, which actually rotates the camera (look-around) rather than
  sliding you sideways — the right wrist's position is no longer tracked for
  anything. This runs a second MediaPipe model (FaceLandmarker) alongside
  HandLandmarker against the same video stream.
- **Head-tilt sign is a documented, tested derivation — not yet
  camera-verified.** `headTiltDeg()` computes roll from the two outer-eye-
  corner landmarks (indices 33/263) in the mirrored ("selfie view")
  coordinate space; `player.js`'s yaw math is derived from Three.js's
  right-hand rotation convention. Both are worked through in code comments
  and covered by sign/math tests in `classifierTests.js`, but the actual
  MediaPipe-reported landmark semantics can only be confirmed against a real
  camera. If tilting your head left turns you right (backwards), flip
  **Settings → Invert head-tilt turn direction** — that's exactly what it's
  for.
- **Handedness mirroring.** MediaPipe's Left/Right label assumes a *mirrored*
  (selfie-view) input image; a raw `getUserMedia` frame is not mirrored, so
  the label is often inverted relative to your actual hand. `handTracker.js`
  mirrors every landmark's X once (`x -> 1 - x`) so all downstream code works
  in a consistent "selfie view" space (and `headTracker.js` does the same for
  the face), and `config.handedness.invert` (a Settings-panel checkbox)
  corrects the Left/Right label itself if the debug overlay shows your raised
  right hand labeled "Left" (or vice versa).
- **Rotation-invariant curl detection.** Finger curl is measured by
  projecting the fingertip and PIP joint onto a hand-local "up" axis (wrist →
  middle-finger MCP), not by comparing raw screen Y — so a tilted or rotated
  hand still classifies correctly. See `gestureClassifier.js`.
- **The gun-pose latch.** Curling the index finger to fire also curls it out
  of the "gun pose" test for a few frames (middle/ring/pinky read the same,
  but index is no longer "extended"). Without a fix, aim mode would drop
  right as you pull the trigger, and the shot would be rejected. `inputState.js`
  latches aim mode for `config.gunPose.latchGraceMs` after the raw pose is
  last seen, so a trigger pull never cancels the aim it depends on.
- **Open-palm/trigger thresholds are calibrated against real hand anatomy.**
  An earlier version compared a finger's full reach against the wrist-to-
  palm distance using a ratio (1.3) that's essentially unreachable by a real
  hand (realistic ratios run roughly 0.5–0.9). Fixed by recalibrating against
  actual hand proportions — see the comments in `config.js` — and by
  exposing the live numeric ratios (not just pass/fail) in the Debug panel
  so this class of problem is easy to diagnose without reading code.
- **Every threshold lives in `config.js`.** Curl thresholds, open-palm
  extension ratio, latch/cooldown timings, turn dead-zone/speed, smoothing
  alpha, gesture stability hold — nothing is a magic number scattered through
  the code, and the Settings panel edits this object live.

## Requirements

- A webcam and a browser that supports `getUserMedia` + WebGL2.
- Decent, even lighting on your face and hands for reliable tracking.
- Chrome/Edge are the best-tested targets for MediaPipe Tasks Vision.
- Running two MediaPipe models at once (hands + face) costs more per-frame
  inference than either alone — if framerate suffers on an older machine,
  that's the first thing to look at.
