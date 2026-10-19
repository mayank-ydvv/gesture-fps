/* ============================================================================
   classifierTests.js — camera-free correctness harness for the gesture
   layer, run via index.html?test=1 (see main.js). Feeds handcrafted 21-point
   landmark arrays through the PURE classifier functions, plus a couple of
   deterministic time-driven checks against the stateful trackers in
   inputState.js, and asserts the expected results.

   The tilted-gun-pose case specifically proves gotcha #2 (curl detection
   must survive hand rotation, not just upright hands). The gun-pose-latch
   case specifically proves gotcha #3 (a trigger pull must not cancel the
   aim mode that gates it).
   ============================================================================ */

import { isFist, isOpenPalm, isGunPose, indexExtension } from './gestureClassifier.js';
import { headTiltDeg } from './faceClassifier.js';
import { InputState, deadZoneMap } from './inputState.js';
import { config } from '../config.js';

function pt(x, y) {
  return { x, y, z: 0 };
}

/** Synthetic face landmarks with just the two outer-eye-corner points set
 *  (indices 33/263 — see faceClassifier.js) — everything headTiltDeg reads. */
function faceWithEyes(leftEye, rightEye) {
  const lm = new Array(468).fill(null).map(() => pt(0, 0));
  // Matches faceClassifier.js's landmark assignment (263 = left, 33 =
  // right, in our mirrored coordinate space — see its comment for why
  // that's the reverse of MediaPipe's raw-image labels).
  lm[263] = leftEye;
  lm[33] = rightEye;
  return lm;
}

function rotate(landmarks, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // Rotate around the wrist (landmark 0) so it stays the origin of the hand.
  const origin = landmarks[0];
  return landmarks.map((p) => {
    const dx = p.x - origin.x, dy = p.y - origin.y;
    return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos, z: p.z };
  });
}

const MCP_X = { index: -0.3, middle: 0, ring: 0.3, pinky: 0.55 };

function fingerPoints(finger, state) {
  const x = MCP_X[finger];
  const mcp = pt(x, -1);
  const pip = pt(x, -1.75);
  const tip = state === 'extended' ? pt(x, -2.6) : pt(x, -0.9);
  return { mcp, pip, tip };
}

/** Builds a synthetic 21-landmark hand. `index` also accepts a number
 *  0..1 (extension fraction) instead of 'extended'/'curled', for the
 *  trigger-pull sequence test. */
function buildHand({ index = 'extended', middle = 'curled', ring = 'curled', pinky = 'curled', thumb = 'extended' } = {}) {
  const lm = new Array(21).fill(null).map(() => pt(0, 0));
  lm[0] = pt(0, 0); // wrist

  const thumbMcp = pt(-0.55, -0.85);
  const thumbTip = thumb === 'extended' ? pt(-1.7, -1.9) : pt(-0.6, -0.9);
  lm[1] = thumbMcp;
  lm[2] = pt(-0.7, -1.1);
  lm[3] = pt(-0.85, -1.3);
  lm[4] = thumbTip;

  const setFinger = (name, state, tipI, pipI, mcpI, dipI) => {
    let f;
    if (typeof state === 'number') {
      // Interpolate the tip along a straight line from the PIP itself
      // (t=0, fully curled — tip folded onto its own PIP, distance 0) to
      // the fully extended tip (t=1). This is what makes tip-to-PIP
      // distance strictly monotonic in t; interpolating between two fixed
      // tip endpoints on either side of a fixed PIP (an earlier version of
      // this test) let the tip sweep PAST the PIP and back out again,
      // which is exactly the non-monotonic bug this harness caught.
      const extended = fingerPoints(name, 'extended');
      const t = Math.max(0, Math.min(1, state));
      f = {
        mcp: extended.mcp,
        pip: extended.pip,
        tip: pt(
          extended.pip.x + (extended.tip.x - extended.pip.x) * t,
          extended.pip.y + (extended.tip.y - extended.pip.y) * t
        ),
      };
    } else {
      f = fingerPoints(name, state);
    }
    lm[mcpI] = f.mcp;
    lm[pipI] = f.pip;
    lm[dipI] = pt(f.pip.x, (f.pip.y + f.tip.y) / 2);
    lm[tipI] = f.tip;
  };

  setFinger('index', index, 8, 6, 5, 7);
  setFinger('middle', middle, 12, 10, 9, 11);
  setFinger('ring', ring, 16, 14, 13, 15);
  setFinger('pinky', pinky, 20, 18, 17, 19);

  return lm;
}

function assert(results, name, pass, detail = '') {
  results.push({ name, pass, detail });
}

export function runClassifierTests() {
  const results = [];

  const fistHand = buildHand({ index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled', thumb: 'curled' });
  const openHand = buildHand({ index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended', thumb: 'extended' });
  const gunHand = buildHand({ index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled', thumb: 'extended' });
  const tiltedGunHand = rotate(gunHand, 47); // rotated ~47deg — must still classify as gun pose

  assert(results, 'isFist(fist) === true', isFist(fistHand) === true);
  assert(results, 'isFist(open) === false', isFist(openHand) === false);
  assert(results, 'isFist(gun) === false', isFist(gunHand) === false);

  assert(results, 'isOpenPalm(open) === true', isOpenPalm(openHand) === true);
  assert(results, 'isOpenPalm(fist) === false', isOpenPalm(fistHand) === false);
  assert(results, 'isOpenPalm(gun) === false', isOpenPalm(gunHand) === false);

  assert(results, 'isGunPose(gun) === true', isGunPose(gunHand) === true);
  assert(results, 'isGunPose(fist) === false', isGunPose(fistHand) === false);
  assert(results, 'isGunPose(open) === false', isGunPose(openHand) === false);
  assert(
    results,
    '[gotcha #2] isGunPose survives a 47deg tilt (rotation-invariant curl test)',
    isGunPose(tiltedGunHand) === true
  );

  // Trigger-pull sequence: index extension should monotonically decrease as
  // the finger curls from fully extended (1.0) toward fully curled (0.0).
  const extAtFractions = [1, 0.7, 0.4, 0.1, 0].map((f) => indexExtension(buildHand({ index: f })));
  const monotonicDecreasing = extAtFractions.every((v, i) => i === 0 || v <= extAtFractions[i - 1] + 1e-9);
  assert(
    results,
    'indexExtension decreases monotonically through a trigger pull',
    monotonicDecreasing,
    `values: ${extAtFractions.map((v) => v.toFixed(3)).join(' -> ')}`
  );
  assert(
    results,
    'indexExtension: fully extended is clearly above config.trigger.armExtension',
    extAtFractions[0] > config.trigger.armExtension,
    `extended=${extAtFractions[0].toFixed(3)} (need > ${config.trigger.armExtension})`
  );
  assert(
    results,
    'indexExtension: fully curled is clearly below config.trigger.firedExtension',
    extAtFractions[4] < config.trigger.firedExtension,
    `curled=${extAtFractions[4].toFixed(3)} (need < ${config.trigger.firedExtension})`
  );

  // --- headTiltDeg (head-tracking turn control) ---
  const levelFace = faceWithEyes(pt(0.4, 0.5), pt(0.6, 0.5));
  const tiltA = faceWithEyes(pt(0.4, 0.45), pt(0.6, 0.55)); // right eye lower than left
  const tiltB = faceWithEyes(pt(0.4, 0.55), pt(0.6, 0.45)); // mirror image of tiltA

  const invertBefore = config.headTurn.invert;
  config.headTurn.invert = false;
  const levelDeg = headTiltDeg(levelFace);
  const tiltADeg = headTiltDeg(tiltA);
  const tiltBDeg = headTiltDeg(tiltB);
  assert(results, 'headTiltDeg: level eyes read as ~0 degrees', Math.abs(levelDeg) < 0.01, `${levelDeg.toFixed(3)}deg`);
  assert(
    results,
    'headTiltDeg: two mirror-image tilts produce equal-magnitude, opposite-sign angles',
    Math.abs(tiltADeg + tiltBDeg) < 0.01 && Math.sign(tiltADeg) !== Math.sign(tiltBDeg),
    `tiltA=${tiltADeg.toFixed(2)}deg, tiltB=${tiltBDeg.toFixed(2)}deg`
  );
  config.headTurn.invert = true;
  const invertedDeg = headTiltDeg(tiltA);
  assert(
    results,
    'headTiltDeg: config.headTurn.invert flips the sign',
    Math.abs(invertedDeg + tiltADeg) < 0.01,
    `normal=${tiltADeg.toFixed(2)}deg, inverted=${invertedDeg.toFixed(2)}deg`
  );
  config.headTurn.invert = invertBefore; // don't leak state into other tests

  // --- deadZoneMap (generic dead-zone -> [-1,1] mapping, used for turn rate) ---
  assert(results, 'deadZoneMap: inside the dead zone reads as exactly 0', deadZoneMap(3, 5, 20) === 0);
  assert(results, 'deadZoneMap: at the dead-zone edge reads as 0', deadZoneMap(-5, 5, 20) === 0);
  assert(results, 'deadZoneMap: beyond maxOffset clamps to 1', deadZoneMap(50, 5, 20) === 1);
  assert(results, 'deadZoneMap: beyond -maxOffset clamps to -1', deadZoneMap(-50, 5, 20) === -1);
  assert(
    results,
    'deadZoneMap: halfway between deadZone and maxOffset reads as ~0.5',
    Math.abs(deadZoneMap(12.5, 5, 20) - 0.5) < 1e-9,
    `${deadZoneMap(12.5, 5, 20)}`
  );

  return results;
}

/** Stateful checks against inputState.js's time-driven trackers — still
 *  fully deterministic/camera-free, just synthetic timestamps instead of a
 *  synthetic hand pose. Proves gotcha #3: a trigger pull's brief pose loss
 *  must not cancel the aim latch, but a genuinely dropped hand should. */
export function runStatefulTests() {
  const results = [];

  const gunHand = buildHand({ index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' });
  const curledHand = buildHand({ index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' });

  const input = new InputState();
  let t = 0;
  const step = (hand, dtMs, headLandmarks = null) => {
    t += dtMs;
    return input.update({ left: null, right: hand }, headLandmarks, t);
  };

  // Hold gun pose past the stability hold -> aiming should latch on.
  let last;
  for (let i = 0; i < 6; i++) last = step(gunHand, 40); // 240ms of gun pose
  assert(results, 'aiming turns on after holding gun pose past stability hold', last.aiming === true);

  // Simulate the trigger curl: pose briefly reads as curled (not gun pose)
  // for less than gunPose.latchGraceMs — aiming must NOT drop.
  const dipMs = Math.min(120, config.gunPose.latchGraceMs - 60);
  last = step(curledHand, dipMs);
  assert(
    results,
    '[gotcha #3] aiming survives a brief trigger-curl dip shorter than the latch grace window',
    last.aiming === true,
    `dip=${dipMs}ms, latchGraceMs=${config.gunPose.latchGraceMs}ms`
  );

  // Now let the pose stay lost well past the latch grace window -> aiming
  // should finally drop (this is what proves it's a grace window, not an
  // infinite latch).
  last = step(curledHand, config.gunPose.latchGraceMs + 200);
  assert(
    results,
    'aiming drops once the pose has been lost longer than the latch grace window',
    last.aiming === false
  );

  // --- end-to-end head-tilt -> turn, through the real calibrate-then-play flow ---
  const turnInput = new InputState();
  let tt = 0;
  const stepHead = (face, dtMs) => {
    tt += dtMs;
    return turnInput.update({ left: null, right: null }, face, tt);
  };
  // A neutral face with a slight natural tilt (as if the camera/posture
  // isn't perfectly level) — calibration should zero this out.
  const restingFace = faceWithEyes(pt(0.4, 0.51), pt(0.6, 0.49));
  const restingTiltDeg = headTiltDeg(restingFace);
  turnInput.setNeutralTilt(restingTiltDeg);

  const atNeutral = stepHead(restingFace, 16);
  assert(results, 'turn is ~0 when the head is at the calibrated neutral tilt', Math.abs(atNeutral.turn) < 1e-6, `turn=${atNeutral.turn}`);

  // Tilt further than the neutral by more than maxTiltDeg -> should clamp to
  // full turn. Smoothing needs a few frames to catch up to a step change,
  // so step it forward repeatedly rather than asserting on the first frame.
  const farTiltFace = faceWithEyes(pt(0.4, 0.51 + 0.3), pt(0.6, 0.49 - 0.3));
  let farResult;
  for (let i = 0; i < 30; i++) farResult = stepHead(farTiltFace, 16);
  assert(
    results,
    'turning the head well past maxTiltDeg clamps turn to +-1',
    Math.abs(farResult.turn) === 1,
    `turn=${farResult.turn}`
  );

  // --- recenterNow(): the direct, user-triggered fix for "keeps turning
  // even when my head is straight" (an uncalibrated or drifted baseline) ---
  const recenterInput = new InputState();
  let rt = 0;
  const stepRecenter = (face, dtMs) => {
    rt += dtMs;
    return recenterInput.update({ left: null, right: null }, face, rt);
  };
  const biasedFace = faceWithEyes(pt(0.4, 0.53), pt(0.6, 0.47)); // ~13deg raw tilt, no calibration applied
  const beforeRecenter = stepRecenter(biasedFace, 16);
  assert(
    results,
    '[recenter setup] an uncalibrated bias produces nonzero turn',
    beforeRecenter.turn !== 0,
    `turn=${beforeRecenter.turn}`
  );
  recenterInput.recenterNow();
  const afterRecenter = stepRecenter(biasedFace, 16);
  assert(
    results,
    'recenterNow() immediately zeroes turn for the same head position it was called at',
    Math.abs(afterRecenter.turn) < 1e-6,
    `turn=${afterRecenter.turn}`
  );

  // --- determinism: neutral must be changeable ONLY by an explicit call
  // (setNeutralTilt / recenterNow), never on its own — this is the whole
  // point of removing all auto-recentering. Verified two ways: (1) neutral
  // is bit-for-bit unchanged no matter how long a biased reading is held,
  // and (2) the resulting turn for a given reading is exactly reproducible
  // frame to frame, not settling toward some different value over time. ---
  const staticInput = new InputState();
  staticInput.setNeutralTilt(7); // arbitrary fixed reference
  let staticNow = 0;
  const biasedReading = faceWithEyes(pt(0.4, 0.54), pt(0.6, 0.46)); // ~23deg raw, well past the dead zone from neutral=7
  let staticResult;
  for (let i = 0; i < 600; i++) staticResult = staticInput.update({ left: null, right: null }, biasedReading, (staticNow += 100)); // 60 simulated seconds
  assert(
    results,
    '[determinism] neutral never changes on its own, no matter how long a biased reading is held',
    staticInput.neutralTiltDeg === 7,
    `neutral=${staticInput.neutralTiltDeg} after 60s (must stay exactly 7)`
  );
  assert(
    results,
    '[determinism] turn stays exactly the same value after settling, not decaying or drifting over time',
    staticResult.turn === deadZoneMap(staticResult.debug.headTiltRaw - 7, config.headTurn.deadZoneDeg, config.headTurn.maxTiltDeg),
    `turn=${staticResult.turn}`
  );

  return results;
}
