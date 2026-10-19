/* ============================================================================
   faceClassifier.js — PURE functions over MediaPipe FaceLandmarker output
   (already mirrored into "selfie view" by headTracker.js, same convention
   as gestureClassifier.js uses for hands). Just one measurement: head tilt
   (roll), used to drive camera turning.
   ============================================================================ */

import { config } from '../config.js';

// Outer eye corners in MediaPipe's 468/478-point face landmark topology.
// MediaPipe documents landmark 33 as the LEFT eye's outer corner and 263 as
// the RIGHT — but that labeling assumes the raw (un-mirrored) image, and
// headTracker.js mirrors every landmark's x (x -> 1-x) on top of that, for
// consistency with how hand landmarks are mirrored. The net effect,
// confirmed by inspecting live landmark output against a real camera: after
// our mirroring, landmark 33 lands on the visually-RIGHT side and 263 on
// the visually-LEFT — the reverse of the raw-image labels. Assigning them
// by raw-image label (as an earlier version of this file did) produced a
// ~180° phase error — a level head read as ~180° instead of ~0° — which no
// amount of sign-flipping (config.headTurn.invert) could ever fix, since
// negating a value near 180° is still nowhere near 0°. These names are
// assigned to match the actual observed geometry, not the raw-image label.
const LEFT_EYE_OUTER = 263;
const RIGHT_EYE_OUTER = 33;

/**
 * Head tilt (roll) in degrees. With the landmark assignment above, a level
 * head reads ~0°, and tilting your head to your left reads negative —
 * matching "turn left" being negative in the shared input struct with no
 * further inversion needed. `config.headTurn.invert` is kept as an escape
 * hatch (flip if it ever turns out backwards on a different setup), but the
 * corrected assignment above is the fix for the actual observed bug: don't
 * reach for `invert` again without re-checking the raw landmark
 * coordinates first (see the debug panel's "head tilt" row, or inspect
 * headTracker output directly) — a phase error looks similar to a sign
 * error at small angles but is not fixed the same way.
 */
export function headTiltDeg(landmarks) {
  const left = landmarks[LEFT_EYE_OUTER];
  const right = landmarks[RIGHT_EYE_OUTER];
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (config.headTurn.invert) deg = -deg;
  return deg;
}
