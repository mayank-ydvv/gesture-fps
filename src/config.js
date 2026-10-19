/* ============================================================================
   config.js — every tunable threshold/dead-zone/debounce timing in one place.
   The settings panel (src/ui/settings.js) mutates this object live, so
   nothing downstream should cache these values — always read config.xxx.yyy
   fresh each frame.
   ============================================================================ */

export const config = {
  // Determined empirically in Milestone 1 (see README "Calibrating handedness").
  // MediaPipe's Left/Right label assumes a MIRRORED (selfie-view) image; a raw
  // getUserMedia frame is NOT mirrored, so the label is frequently inverted
  // relative to the player's actual hand. Flip this if the debug overlay shows
  // your raised right hand labeled "Left" (or vice versa).
  handedness: {
    invert: false,
  },

  // Per-finger curl test: project fingertip & PIP onto the hand-local "up"
  // axis (wrist -> middle-MCP), normalized by palm scale. Curl = tip sits
  // below the PIP (closer to the wrist) along that axis by more than this
  // fraction of palm scale. Rotation-invariant, so a tilted hand still works.
  curl: {
    curledThreshold: 0.08,   // tip-below-pip margin (fraction of palm scale) to call it curled
    extendedThreshold: -0.05, // tip-above-pip margin required to call it extended (hysteresis gap)
  },

  // Open palm: all 5 fingertips must extend at least this far (fraction of
  // palm scale, i.e. wrist-to-middle-MCP distance) beyond their OWN MCP
  // joint. Calibrated against real hand proportions, not just synthetic
  // test geometry: a finger is typically *shorter* than the palm, so this
  // ratio realistically tops out around 0.5 (pinky, the shortest finger —
  // and the binding constraint, since ALL FOUR fingers must clear it) to
  // ~0.9 (middle finger). An earlier default of 1.3 was essentially
  // unreachable by a real hand, so open palm never registered.
  openPalm: {
    minExtensionRatio: 0.55,
  },

  // Gun pose = index extended, middle/ring/pinky curled.
  gunPose: {
    // How long (ms) the gun pose is "remembered" after the raw pose is lost —
    // needed because curling the index to fire also curls it out of the
    // gun-pose test for a few frames. Without this latch, trigger pulls
    // would be rejected because aim mode drops right as you fire.
    latchGraceMs: 300,
  },

  // Trigger pull: index fingertip-to-PIP distance (normalized by palm scale)
  // dropping fast = a pull. Edge-triggered with a cooldown so holding the
  // curl doesn't full-auto spam shots.
  trigger: {
    // Extension distance must fall below this (fraction of palm scale)
    // within `windowMs` of being above `armExtension` to count as a pull.
    // This measures a shorter, two-phalanx segment (index TIP to PIP) than
    // openPalm's full tip-to-MCP reach, so it needs its own, smaller
    // calibration: a real straightened index finger realistically reaches
    // ~0.35-0.45 here, not the 0.55 an earlier default required — which
    // many hands could never physically arm.
    armExtension: 0.35,
    firedExtension: 0.15,
    windowMs: 220,
    cooldownMs: 260,
  },

  // Head TILT (roll — ear-toward-shoulder), relative to a calibrated
  // neutral captured during calibration. Drives camera yaw (look left/
  // right), replacing the earlier wrist-based strafe. Degrees, not a
  // normalized fraction, since head tilt is naturally thought about that way.
  //
  // Sign convention: headTiltDeg() (faceClassifier.js) computes roll from
  // the two outer-eye-corner landmarks in the already-mirrored ("selfie
  // view") coordinate space; player.js's yaw math maps a positive turn
  // value to "turn right". With the landmark assignment fixed (see
  // faceClassifier.js's comment — a real bug: they were assigned by
  // MediaPipe's raw-image label, but our mirroring flips which side each
  // one actually lands on, causing a ~180° phase error), tilting your head
  // left correctly comes out negative and needs no further inversion.
  headTurn: {
    // No automatic neutral-adjustment of any kind — three rounds of it
    // (a gated correction, then velocity-gated, then a slow unconditional
    // safety net on top) each fixed one bug and introduced another: it
    // could cancel a gradual tilt before it registered, get permanently
    // stuck once badly wrong, or settle somewhere the player didn't
    // expect. neutralTiltDeg now changes ONLY via calibration or the
    // Recenter View button (inputState.js) — fully deterministic. If
    // turning ever feels wrong, the fix is: recalibrate, or press Recenter
    // View while actually looking straight ahead — never "wait and see".
    deadZoneDeg: 13,          // +/- degrees of tilt around neutral treated as "not turning"
    maxTiltDeg: 30,           // tilt (beyond dead zone) at which turn rate maxes out
    turnSpeedDegPerSec: 45,   // camera yaw rate at max tilt (lower = less sensitive)
    // Separate from (and heavier than) config.smoothing.alpha, which is
    // tuned for hand gestures that need to react within ~150ms. Head tilt
    // only ever needs to react on a "turn to look" timescale, so smoothing
    // it harder trades a little responsiveness for a lot less jitter —
    // lower = smoother/less sensitive.
    smoothingAlpha: 0.12,
    // The real fix for the direction bug was correcting which landmark is
    // "left"/"right" in faceClassifier.js (a 180° phase error, not a sign
    // error) — with that fixed, no inversion is needed. Kept as an escape
    // hatch for a different setup, not as the primary fix.
    invert: false,
  },

  // Exponential smoothing applied to raw landmark positions before any
  // classification, to cut per-frame jitter.
  smoothing: {
    alpha: 0.45, // higher = less smoothing / more responsive
  },

  // A discrete gesture (fist/open palm/gun pose) must classify the same way
  // for this many ms before it is allowed to change the input state — avoids
  // single noisy frames flickering actions on/off.
  stability: {
    holdMs: 180,
  },

  weapon: {
    magSize: 8,
    reloadMs: 1200,
    range: 80,
    damage: 34,
    aimFov: 50,
    hipFov: 75,
    fovTweenMs: 180,
  },

  enemy: {
    count: 5,
    spawnArcDeg: 95,   // enemies spread across this arc in front of the player
    minDistance: 14,
    maxDistance: 26,
    health: 100,
    respawnDelayMs: 1800,
  },

  player: {
    eyeHeight: 1.7,
    moveSpeed: 3.2,
    // Arena is a rectangle: [-arenaHalfWidth, +arenaHalfWidth] on X, and the
    // player can walk forward (camera looks down -Z) up to forwardLimit.
    // Sized so enemies at the far edge of enemy.spawnArcDeg *and*
    // enemy.maxDistance still land inside the walls (edge case: half-arc
    // 47.5deg @ 26 units -> x ~= 19.2, z ~= 17.6 — see README "Arena sizing").
    arenaHalfWidth: 22,
    forwardLimit: 34,
    headBobAmplitude: 0.045,
    headBobSpeed: 9,
  },
};
