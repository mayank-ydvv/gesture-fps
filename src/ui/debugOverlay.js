/* ============================================================================
   debugOverlay.js — Milestone 1+2 visual verification: draws both hands'
   21 landmarks (skeleton) AND the two face landmarks used for head-tilt
   turning, over the mirrored webcam feed, labeled by resolved handedness,
   plus a live boolean/numeric readout of every classified gesture. This is
   how you (a) confirm left/right handedness is correct after mirroring
   (see config.handedness.invert), (b) confirm which way head tilt turns you
   (see config.headTurn.invert), and (c) see exactly why a gesture isn't
   registering, without reading any code.
   ============================================================================ */

import { config } from '../config.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [5, 9], [9, 10], [10, 11], [11, 12],  // middle
  [9, 13], [13, 14], [14, 15], [15, 16],// ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17],                              // palm base
];

// Same pair faceClassifier.js uses for the roll/tilt calculation — the
// assignment must match that file's (263 = left, 33 = right, in our
// mirrored coordinate space) or this overlay's LEFT/RIGHT label reads
// backwards relative to what actually drives turning.
const LEFT_EYE_OUTER = 263;
const RIGHT_EYE_OUTER = 33;

const HAND_COLOR = { left: '#3ba7ff', right: '#ff9a3b' };
const HEAD_COLOR = '#4fdc7a';

const $ = (id) => document.getElementById(id);

export class DebugOverlay {
  constructor(video) {
    this.video = video;
    this.canvas = $('landmark-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.camPip = $('cam-pip');
    this.panel = $('debug-panel');
    this.toggleBtn = $('debug-toggle');

    // The small camera + hand-skeleton preview is on by default — it's the
    // main way to see your own tracking, not just a debug tool. The
    // "Debug" button instead toggles the extra technical panel (live
    // boolean readout of every classified gesture).
    this.camPip.classList.add('visible');
    this.showPanel = false;
    this.toggleBtn.addEventListener('click', () => this.setPanelVisible(!this.showPanel));
  }

  setPanelVisible(v) {
    this.showPanel = v;
    this.panel.classList.toggle('open', v);
  }

  _resizeCanvas() {
    if (this.video.videoWidth && this.canvas.width !== this.video.videoWidth) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
    }
  }

  _drawHand(landmarks, color, label) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
      ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    }
    ctx.stroke();
    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const wrist = landmarks[0];
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(label, wrist.x * w - 10, wrist.y * h + 26);
  }

  /** Draws just the two outer-eye-corner points and the line between them —
   *  the exact geometry the tilt angle is computed from — rather than the
   *  full 478-point face mesh, so it's obvious at a glance what's driving
   *  the turn signal. */
  _drawHead(landmarks, tiltDeg) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    const left = landmarks[LEFT_EYE_OUTER];
    const right = landmarks[RIGHT_EYE_OUTER];
    ctx.strokeStyle = HEAD_COLOR;
    ctx.fillStyle = HEAD_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left.x * w, left.y * h);
    ctx.lineTo(right.x * w, right.y * h);
    ctx.stroke();
    for (const p of [left, right]) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`tilt ${tiltDeg.toFixed(1)}°`, left.x * w - 10, left.y * h - 14);
  }

  /** hands: { left, right } landmark arrays (already mirrored). headLandmarks:
   *  face landmarks|null (already mirrored). input: the current frame's
   *  shared input struct (for the boolean panel). */
  render(hands, headLandmarks, input) {
    this._resizeCanvas();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (hands.left) this._drawHand(hands.left, HAND_COLOR.left, 'LEFT');
    if (hands.right) this._drawHand(hands.right, HAND_COLOR.right, 'RIGHT');
    if (headLandmarks && input.debug?.headTiltRaw != null) this._drawHead(headLandmarks, input.debug.headTiltRaw);

    if (!this.showPanel) return; // skip building the technical readout when it's hidden

    const d = input.debug || {};
    const b = (v) => `<span class="${v ? 'bool-true' : 'bool-false'}">${v ? 'YES' : 'no'}</span>`;
    const fmt = (v, digits = 2) => (v == null ? '—' : v.toFixed(digits));
    // Shows the actual ratio next to the threshold it's compared against —
    // when a gesture won't register, this is what tells you whether to
    // nudge the Settings slider (close but not quite) or that something
    // else is wrong (way off, or stuck at a suspicious constant value).
    const vsThreshold = (v, threshold, digits = 2) =>
      v == null ? '—' : `<span class="${v >= threshold ? 'bool-true' : 'bool-false'}">${v.toFixed(digits)}</span> / ${threshold}`;
    this.panel.innerHTML = `
      <div class="row"><span>Left hand present</span>${b(d.leftPresent)}</div>
      <div class="row"><span>Left fist (raw)</span>${b(d.leftFistRaw)}</div>
      <div class="row"><span>Left open (raw)</span>${b(d.leftOpenRaw)}</div>
      <div class="row"><span>left min finger ratio</span><span>${vsThreshold(d.leftMinOpenRatio, config.openPalm.minExtensionRatio)}</span></div>
      <div class="row"><span>→ moveForward</span>${b(input.moveForward)}</div>
      <hr style="opacity:0.15">
      <div class="row"><span>Right hand present</span>${b(d.rightPresent)}</div>
      <div class="row"><span>Right gun pose (raw)</span>${b(d.rightGunPoseRaw)}</div>
      <div class="row"><span>Right open (raw)</span>${b(d.rightOpenRaw)}</div>
      <div class="row"><span>right min finger ratio</span><span>${vsThreshold(d.rightMinOpenRatio, config.openPalm.minExtensionRatio)}</span></div>
      <div class="row"><span>→ aiming (latched)</span>${b(input.aiming)}</div>
      <div class="row"><span>index extension</span><span>${fmt(d.indexExtension)} (arm ${config.trigger.armExtension} / fire ${config.trigger.firedExtension})</span></div>
      <div class="row"><span>→ firePressed</span>${b(input.firePressed)}</div>
      <div class="row"><span>→ reloadPressed</span>${b(input.reloadPressed)}</div>
      <hr style="opacity:0.15">
      <div class="row"><span>Face present</span>${b(d.headPresent)}</div>
      <div class="row"><span>head tilt (smoothed)</span><span>${fmt(d.headTiltRaw, 1)}° (neutral ${fmt(d.neutralTiltDeg, 1)}°)</span></div>
      <div class="row"><span>→ turn</span><span>${fmt(input.turn)}</span></div>
    `;
  }
}
