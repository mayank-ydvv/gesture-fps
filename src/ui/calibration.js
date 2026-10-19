/* ============================================================================
   calibration.js — short onboarding that both teaches the four core hand
   poses and captures the neutral head tilt used to zero out turning. Each
   step validates against the LIVE classifier (the exact same functions the
   game uses) before advancing, so a threshold that's miscalibrated for the
   player's lighting/camera gets caught here instead of mid-match.
   ============================================================================ */

import { isFist, isOpenPalm, isGunPose } from '../gestures/gestureClassifier.js';
import { headTiltDeg } from '../gestures/faceClassifier.js';

const CAL_HOLD_MS = 700;

const STEPS = [
  {
    source: 'left',
    test: isFist,
    visual: '✊',
    label: 'Make a FIST with your LEFT hand',
    sub: 'This is how you stop moving.',
  },
  {
    source: 'left',
    test: isOpenPalm,
    visual: '🖐️',
    label: 'OPEN your LEFT hand',
    sub: 'This is how you walk forward.',
  },
  {
    source: 'right',
    test: isGunPose,
    visual: '👉',
    label: 'Point your RIGHT hand like a GUN',
    sub: 'Index finger out straight, other fingers curled — this aims.',
  },
  {
    source: 'right',
    test: isOpenPalm,
    visual: '🖐️',
    label: 'OPEN your RIGHT palm',
    sub: 'This reloads your weapon.',
  },
  {
    source: 'head',
    test: () => true, // just needs a face detected — there's no pose to check
    visual: '🙂',
    label: 'Look straight ahead, keep your head level',
    sub: "Hold still — we're capturing your neutral head tilt so turning is zeroed to your posture.",
    captureNeutral: true,
    sample: (lm) => headTiltDeg(lm),
    // Longer than the other steps: this is the ONLY step that averages a
    // measurement (not just checks a pose), and a longer window over more
    // samples gives a noticeably more reliable baseline — this is exactly
    // the value used to zero out turning, so it's worth the extra second.
    holdMs: 1500,
  },
];

const $ = (id) => document.getElementById(id);

export class Calibration {
  constructor(onComplete, onNeutralTilt) {
    this.onComplete = onComplete;
    this.onNeutralTilt = onNeutralTilt;

    this.overlay = $('calibration-overlay');
    this.stepCountEl = $('cal-step-count');
    this.visualEl = $('cal-visual');
    this.labelEl = $('cal-label');
    this.subEl = $('cal-sub');
    this.progressEl = $('cal-progress');
    this.skipBtn = $('cal-skip-btn');
    this.skipBtn.addEventListener('click', () => this.finish());

    this.stepIndex = 0;
    this.holdStart = null;
    this.neutralSamples = [];
    this.done = false;
  }

  start() {
    this.stepIndex = 0;
    this.holdStart = null;
    this.neutralSamples = [];
    this.done = false;
    this.overlay.hidden = false;
    this._renderStep();
  }

  _renderStep() {
    const step = STEPS[this.stepIndex];
    this.stepCountEl.textContent = `STEP ${this.stepIndex + 1} / ${STEPS.length}`;
    this.visualEl.textContent = step.visual;
    this.labelEl.textContent = step.label;
    this.subEl.textContent = step.sub;
    this.progressEl.style.width = '0%';
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.overlay.hidden = true;
    this.onComplete();
  }

  /** hands: { left, right } landmark arrays. headLandmarks: face
   *  landmarks|null. now: ms timestamp. Returns true once calibration is
   *  complete. */
  update(hands, headLandmarks, now) {
    if (this.done) return true;
    const step = STEPS[this.stepIndex];
    const lm = step.source === 'head' ? headLandmarks : hands[step.source];
    const ok = lm ? step.test(lm) : false;

    if (ok) {
      if (this.holdStart == null) {
        this.holdStart = now;
        this.neutralSamples = [];
      }
      if (step.captureNeutral && lm) this.neutralSamples.push(step.sample(lm));

      const holdMs = step.holdMs ?? CAL_HOLD_MS;
      const elapsed = now - this.holdStart;
      this.progressEl.style.width = `${Math.min(100, (elapsed / holdMs) * 100)}%`;

      if (elapsed >= holdMs) {
        if (step.captureNeutral && this.neutralSamples.length && this.onNeutralTilt) {
          const avg = this.neutralSamples.reduce((a, b) => a + b, 0) / this.neutralSamples.length;
          this.onNeutralTilt(avg);
        }
        this.stepIndex++;
        this.holdStart = null;
        this.neutralSamples = [];
        if (this.stepIndex >= STEPS.length) {
          this.finish();
          return true;
        }
        this._renderStep();
      }
    } else {
      this.holdStart = null;
      this.neutralSamples = [];
      this.progressEl.style.width = '0%';
    }
    return false;
  }
}
