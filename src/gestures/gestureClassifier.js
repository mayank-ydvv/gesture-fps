/* ============================================================================
   gestureClassifier.js — PURE functions only: no timers, no history, no DOM,
   no mutation. Each function takes a single hand's 21 landmarks (already
   mirrored into "selfie view" x, see handTracker.js) and returns a plain
   value. This is what makes the whole gesture layer unit-testable without a
   webcam (see test/classifier.test.js, run via index.html?test=1).

   Landmark index reference (MediaPipe Hands):
     0 wrist
     1-4   thumb  (CMC, MCP, IP, TIP)
     5-8   index  (MCP, PIP, DIP, TIP)
     9-12  middle (MCP, PIP, DIP, TIP)
     13-16 ring   (MCP, PIP, DIP, TIP)
     17-20 pinky  (MCP, PIP, DIP, TIP)
   ============================================================================ */

import { config } from '../config.js';

const WRIST = 0;
const THUMB_MCP = 1, THUMB_TIP = 4;
const MIDDLE_MCP = 9;

const FINGER_TIPS = { index: 8, middle: 12, ring: 16, pinky: 20 };
const FINGER_PIPS = { index: 6, middle: 10, ring: 14, pinky: 18 };
const FINGER_MCPS = { index: 5, middle: 9, ring: 13, pinky: 17 };

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Builds a per-frame, rotation-invariant hand frame: an origin (the wrist), a
 * unit "up" axis pointing from wrist toward the middle-finger MCP (i.e.
 * "into the fingers" no matter how the hand is rotated on screen), and a
 * scale (palm length) used to normalize every other distance so thresholds
 * don't silently retune themselves as the player moves closer/farther from
 * the camera.
 */
export function handBasis(lm) {
  const origin = lm[WRIST];
  const toMiddle = { x: lm[MIDDLE_MCP].x - origin.x, y: lm[MIDDLE_MCP].y - origin.y };
  const scale = Math.hypot(toMiddle.x, toMiddle.y) || 1e-6;
  const up = { x: toMiddle.x / scale, y: toMiddle.y / scale };
  return { origin, up, scale };
}

function projectAlongUp(point, basis) {
  const v = { x: point.x - basis.origin.x, y: point.y - basis.origin.y };
  return (v.x * basis.up.x + v.y * basis.up.y) / basis.scale;
}

/**
 * Curl margin for one finger: how far the fingertip sits BEHIND its PIP
 * joint along the hand's local up axis, normalized by palm scale. Positive
 * = curled (tip has folded back past the PIP, toward the palm). Using a
 * projection onto a hand-local axis (rather than raw screen y) is what
 * keeps this working when the hand is tilted, rotated, or upside down.
 */
export function fingerCurlMargin(lm, basis, finger) {
  const tip = lm[FINGER_TIPS[finger]];
  const pip = lm[FINGER_PIPS[finger]];
  return projectAlongUp(pip, basis) - projectAlongUp(tip, basis);
}

export function isFingerCurled(lm, basis, finger) {
  return fingerCurlMargin(lm, basis, finger) > config.curl.curledThreshold;
}

export function isFingerExtended(lm, basis, finger) {
  return fingerCurlMargin(lm, basis, finger) < config.curl.extendedThreshold;
}

/** Straight-line fingertip-to-MCP distance, normalized by palm scale. Used
 *  for the distance-based open-palm test (per spec) rather than the
 *  projection-based curl test, since a fully splayed finger is better
 *  captured by raw reach than by curl angle. */
export function fingerExtensionRatio(lm, basis, tipIdx, mcpIdx) {
  return dist(lm[tipIdx], lm[mcpIdx]) / basis.scale;
}

/** Fist: index/middle/ring/pinky all curled (thumb ignored, per spec — a
 *  tucked thumb is unreliable to classify and the four-finger test alone is
 *  robust). */
export function isFist(lm) {
  const basis = handBasis(lm);
  return ['index', 'middle', 'ring', 'pinky'].every((f) => isFingerCurled(lm, basis, f));
}

/** Every digit's extension ratio, for the open-palm test. Exposed
 *  separately (not just the boolean isOpenPalm result) so the debug panel
 *  can show *how close* a hand is — essential for tuning
 *  config.openPalm.minExtensionRatio against a real hand, since the AND
 *  across five digits means the single shortest one (usually the pinky)
 *  decides whether the gesture registers at all. */
export function openPalmExtensionRatios(lm) {
  const basis = handBasis(lm);
  const ratios = { thumb: fingerExtensionRatio(lm, basis, THUMB_TIP, THUMB_MCP) };
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    ratios[f] = fingerExtensionRatio(lm, basis, FINGER_TIPS[f], FINGER_MCPS[f]);
  }
  return ratios;
}

/** Open palm: all four fingers AND the thumb reach clearly beyond their MCP
 *  joints. Deliberately stricter than "not a fist" so a merely relaxed hand
 *  can't be mistaken for the reload gesture. */
export function isOpenPalm(lm) {
  const r = openPalmExtensionRatios(lm);
  const fingersOpen = ['index', 'middle', 'ring', 'pinky'].every((f) => r[f] >= config.openPalm.minExtensionRatio);
  const thumbOpen = r.thumb >= config.openPalm.minExtensionRatio * 0.75;
  return fingersOpen && thumbOpen;
}

/** Gun pose: index extended straight, middle/ring/pinky curled. Thumb
 *  position is ignored (per spec — it can point up or tuck in, both read as
 *  "gun"). */
export function isGunPose(lm) {
  const basis = handBasis(lm);
  const indexExtended = isFingerExtended(lm, basis, 'index');
  const othersCurled = ['middle', 'ring', 'pinky'].every((f) => isFingerCurled(lm, basis, f));
  return indexExtended && othersCurled;
}

/** Normalized index fingertip-to-PIP distance — shrinks fast during a
 *  trigger pull, independent of hand distance from camera. Consumed by
 *  inputState.js's edge-triggered fire detector. */
export function indexExtension(lm) {
  const basis = handBasis(lm);
  return dist(lm[FINGER_TIPS.index], lm[FINGER_PIPS.index]) / basis.scale;
}

export const LANDMARKS = { WRIST, THUMB_MCP, THUMB_TIP, MIDDLE_MCP, FINGER_TIPS, FINGER_PIPS, FINGER_MCPS };
