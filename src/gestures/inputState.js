/* ============================================================================
   inputState.js — the ONLY stateful gesture module. Turns raw per-frame hand
   landmarks (from handTracker.js) AND face landmarks (from headTracker.js)
   into a single input struct consumed by the game layer:

     { moveForward, turn, aiming, firePressed, reloadPressed, debug }

   - moveForward, turn, aiming are LEVEL signals (true/number for as long as
     the condition holds). `turn` is a continuous [-1, 1] yaw-rate command
     from head tilt (positive = turn right), consumed by player.js.
   - firePressed, reloadPressed are EDGE signals (true for exactly the one
     frame the event is detected), so weapon.js can react with `if (firePressed)`
     without needing its own debouncing.
   - A missing hand/face resets that source's smoothing + gesture state, so
     it can never inherit stale state and fire a phantom action (mirrors the
     stale-hand-eviction guard in air-drums/index.html).

   Owns: EMA smoothing (landmarks for hands, the scalar tilt angle for the
   head), the stability hold for discrete gestures, the gun-pose latch (see
   config.gunPose — this is what keeps aim mode alive through the brief
   finger-curl of a trigger pull), the trigger edge detector + cooldown, and
   the head-tilt dead-zone for turning.
   ============================================================================ */

import { config } from '../config.js';
import { isFist, isOpenPalm, isGunPose, indexExtension, openPalmExtensionRatios } from './gestureClassifier.js';
import { headTiltDeg } from './faceClassifier.js';

/** Smooths a hand's 21 landmarks frame-to-frame with exponential smoothing.
 *  Resets (drops all history) the instant the hand disappears, so a
 *  reappearing hand starts fresh rather than snapping in from a stale
 *  position. */
class LandmarkSmoother {
  constructor(alpha) {
    this.alpha = alpha;
    this.prev = null;
  }
  update(raw) {
    if (!raw) {
      this.prev = null;
      return null;
    }
    if (!this.prev) {
      this.prev = raw;
      return raw;
    }
    const a = this.alpha;
    const next = raw.map((p, i) => ({
      x: this.prev[i].x + (p.x - this.prev[i].x) * a,
      y: this.prev[i].y + (p.y - this.prev[i].y) * a,
      z: this.prev[i].z + (p.z - this.prev[i].z) * a,
    }));
    this.prev = next;
    return next;
  }
  reset() {
    this.prev = null;
  }
}

/** Same idea as LandmarkSmoother but for a single scalar (the head-tilt
 *  angle) — no need to smooth all 478 face landmarks when only one derived
 *  number is actually consumed. Takes a function for alpha (rather than a
 *  fixed number) so a Settings-panel change to config.headTurn.smoothingAlpha
 *  takes effect immediately instead of only at the next InputState reset. */
class ScalarSmoother {
  constructor(getAlpha) {
    this.getAlpha = getAlpha;
    this.prev = null;
  }
  update(raw) {
    if (raw == null) {
      this.prev = null;
      return null;
    }
    this.prev = this.prev == null ? raw : this.prev + (raw - this.prev) * this.getAlpha();
    return this.prev;
  }
  reset() {
    this.prev = null;
  }
}

/** A boolean gesture must classify the same way continuously for `holdMs`
 *  before this gate's value flips — cuts single-frame flicker from noisy
 *  classification. */
class StableGate {
  constructor(holdMs) {
    this.holdMs = holdMs;
    this.value = false;
    this.candidate = false;
    this.since = 0;
  }
  update(raw, now) {
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = now;
    }
    if (now - this.since >= this.holdMs) this.value = this.candidate;
    return this.value;
  }
  reset() {
    this.value = false;
    this.candidate = false;
    this.since = 0;
  }
}

/** Rising-edge detector layered on a StableGate: true for exactly the frame
 *  the gated value transitions false -> true. */
class EdgeGate {
  constructor(holdMs) {
    this.gate = new StableGate(holdMs);
    this.prev = false;
  }
  update(raw, now) {
    const val = this.gate.update(raw, now);
    const edge = val && !this.prev;
    this.prev = val;
    return edge;
  }
  reset() {
    this.gate.reset();
    this.prev = false;
  }
}

/**
 * Tracks "aiming" (gun pose held). Entry requires the raw gun pose to be
 * stable for `stability.holdMs` (avoids flicker turning aim mode on/off).
 * Once aiming, it LATCHES on for `gunPose.latchGraceMs` after the raw pose
 * was last true — this is the fix for gotcha #3: curling the index to fire
 * also curls it out of the gun-pose test for a few frames, and without this
 * latch that would cancel aim mode right as the trigger fires.
 */
class GunPoseTracker {
  constructor() {
    this.enterGate = new StableGate(config.stability.holdMs);
    this.lastRawTrueAt = -Infinity;
    this.aiming = false;
  }
  update(raw, now) {
    if (raw) this.lastRawTrueAt = now;
    const enterNow = this.enterGate.update(raw, now);
    if (!this.aiming) {
      if (enterNow) this.aiming = true;
    } else if (now - this.lastRawTrueAt > config.gunPose.latchGraceMs) {
      this.aiming = false;
    }
    return this.aiming;
  }
  reset() {
    this.enterGate.reset();
    this.lastRawTrueAt = -Infinity;
    this.aiming = false;
  }
}

/**
 * Edge-triggered trigger pull. "Arms" when the index is clearly extended,
 * then fires once if extension drops sharply within `trigger.windowMs` —
 * reads as a deliberate pull rather than a slow relax. Requires re-arming
 * (re-extending) before another shot, plus a hard cooldown, so holding the
 * curl can't full-auto spam shots. Only evaluated while `aiming` (the
 * latched gun pose) is true.
 */
class TriggerDetector {
  constructor() {
    this.armed = false;
    this.armedAt = 0;
    this.lastFireAt = -Infinity;
  }
  update(extension, aiming, now) {
    if (!aiming) {
      this.armed = false;
      return false;
    }
    if (extension >= config.trigger.armExtension) {
      this.armed = true;
      this.armedAt = now;
      return false;
    }
    if (this.armed && extension <= config.trigger.firedExtension) {
      const withinWindow = now - this.armedAt <= config.trigger.windowMs;
      const offCooldown = now - this.lastFireAt >= config.trigger.cooldownMs;
      this.armed = false; // must re-extend before the next shot can arm
      if (withinWindow && offCooldown) {
        this.lastFireAt = now;
        return true;
      }
    }
    return false;
  }
  reset() {
    this.armed = false;
    this.armedAt = 0;
    this.lastFireAt = -Infinity;
  }
}

/** Dead-zone + soft-max mapping from a raw signed offset to a continuous
 *  [-1, 1] value (0 inside the dead zone). Generic — used for head-tilt ->
 *  turn-rate. Analog rather than a flat -1/0/1 so drifting further from
 *  neutral turns proportionally faster, while still reading as three
 *  qualitative states: left / centered / right. */
export function deadZoneMap(offset, deadZone, maxOffset) {
  const span = Math.max(maxOffset - deadZone, 1e-6);
  if (offset > deadZone) return Math.min(1, (offset - deadZone) / span);
  if (offset < -deadZone) return -Math.min(1, (-offset - deadZone) / span);
  return 0;
}

export class InputState {
  constructor() {
    this.leftSmoother = new LandmarkSmoother(config.smoothing.alpha);
    this.rightSmoother = new LandmarkSmoother(config.smoothing.alpha);
    this.headTiltSmoother = new ScalarSmoother(() => config.headTurn.smoothingAlpha);

    this.leftOpenGate = new StableGate(config.stability.holdMs);
    this.gunPoseTracker = new GunPoseTracker();
    this.reloadEdge = new EdgeGate(config.stability.holdMs);
    this.triggerDetector = new TriggerDetector();

    // neutralTiltDeg changes ONLY via setNeutralTilt() (calibration) or
    // recenterNow() (the Recenter View button) — never automatically. Three
    // rounds of "smart" auto-correction here (gated, velocity-gated, then a
    // slow unconditional safety net) each fixed one bug and introduced
    // another: chasing a gradual tilt and canceling it before it registered,
    // then getting permanently stuck when the mismatch was too large to
    // ever satisfy its own gate, then still anchoring somewhere other than
    // where the player actually expected zero. All of that complexity is
    // gone. Deterministic beats clever here: what you calibrated (or last
    // pressed Recenter at) is what "straight" means, full stop, for as long
    // as you're playing — no background process can silently move it.
    this.neutralTiltDeg = 0; // set by calibration ("look straight ahead" step)
    this.currentTiltDeg = null; // most recent smoothed reading, for recenterNow()
    this.output = { moveForward: false, turn: 0, aiming: false, firePressed: false, reloadPressed: false, debug: {} };
  }

  setNeutralTilt(deg) {
    this.neutralTiltDeg = deg;
  }

  /** Instantly zeroes out whatever head-tilt bias currently exists — the
   *  direct, no-guessing fix for "it keeps turning even when my head is
   *  straight": press Recenter while actually looking straight ahead. A
   *  no-op if no face has been seen yet (nothing to recenter to). */
  recenterNow() {
    if (this.currentTiltDeg != null) this.neutralTiltDeg = this.currentTiltDeg;
  }

  reset() {
    this.leftSmoother.reset();
    this.rightSmoother.reset();
    this.headTiltSmoother.reset();
    this.leftOpenGate.reset();
    this.gunPoseTracker.reset();
    this.reloadEdge.reset();
    this.triggerDetector.reset();
    this.currentTiltDeg = null;
  }

  /** hands: { left: landmarks|null, right: landmarks|null } from HandTracker.
   *  headLandmarks: face landmarks|null from HeadTracker.
   *  now: performance.now()-style timestamp in ms. */
  update(hands, headLandmarks, now) {
    const leftSmoothed = this.leftSmoother.update(hands.left);
    if (!leftSmoothed) this.leftOpenGate.reset();
    const leftOpenRaw = leftSmoothed ? isOpenPalm(leftSmoothed) : false;
    const leftFistRaw = leftSmoothed ? isFist(leftSmoothed) : false;
    // The weakest (usually shortest) finger decides whether isOpenPalm
    // passes at all, since it's an AND across all five digits — surfacing
    // just this minimum (rather than all five ratios) keeps the debug
    // panel readable while still showing exactly what's blocking it.
    const leftMinOpenRatio = leftSmoothed ? Math.min(...Object.values(openPalmExtensionRatios(leftSmoothed))) : null;
    const moveForward = this.leftOpenGate.update(leftOpenRaw, now);

    const rightSmoothed = this.rightSmoother.update(hands.right);
    if (!rightSmoothed) {
      this.gunPoseTracker.reset();
      this.reloadEdge.reset();
      this.triggerDetector.reset();
    }

    let aiming = false;
    let firePressed = false;
    let reloadPressed = false;
    const debug = {
      leftPresent: !!leftSmoothed,
      leftOpenRaw,
      leftFistRaw,
      leftMinOpenRatio,
      rightPresent: !!rightSmoothed,
      rightGunPoseRaw: false,
      rightOpenRaw: false,
      rightMinOpenRatio: null,
      indexExtension: null,
      headTiltRaw: null,
      headPresent: !!headLandmarks,
      neutralTiltDeg: this.neutralTiltDeg,
    };

    if (rightSmoothed) {
      const rawGun = isGunPose(rightSmoothed);
      const rawOpen = isOpenPalm(rightSmoothed);
      aiming = this.gunPoseTracker.update(rawGun, now);
      const ext = indexExtension(rightSmoothed);
      firePressed = this.triggerDetector.update(ext, aiming, now);
      reloadPressed = this.reloadEdge.update(rawOpen, now);

      debug.rightGunPoseRaw = rawGun;
      debug.rightOpenRaw = rawOpen;
      debug.rightMinOpenRatio = Math.min(...Object.values(openPalmExtensionRatios(rightSmoothed)));
      debug.indexExtension = ext;
    }

    // Head tilt -> turn. Independent of both hands, so it's evaluated
    // unconditionally rather than nested under the right-hand block above.
    // No auto-recentering of any kind — see the constructor's comment for
    // why. offset is simply (current reading) - (calibrated/manually-set
    // neutral), full stop.
    const rawTilt = headLandmarks ? headTiltDeg(headLandmarks) : null;
    const smoothedTilt = this.headTiltSmoother.update(rawTilt);
    this.currentTiltDeg = smoothedTilt; // for recenterNow()
    let turn = 0;
    if (smoothedTilt != null) {
      const offset = smoothedTilt - this.neutralTiltDeg;
      turn = deadZoneMap(offset, config.headTurn.deadZoneDeg, config.headTurn.maxTiltDeg);
      debug.headTiltRaw = smoothedTilt;
    }

    this.output = { moveForward, turn, aiming, firePressed, reloadPressed, debug };
    return this.output;
  }
}
