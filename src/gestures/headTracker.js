/* ============================================================================
   headTracker.js — MediaPipe FaceLandmarker wrapper, for head-tilt-based
   turning. Structurally identical to handTracker.js (same pinned-CDN /
   GPU-CPU-fallback / new-frame-only-inference / strictly-increasing-
   timestamp pattern) — see that file's header comment for why each of
   those pieces exists. The only real difference is what's tracked: one
   face instead of two hands, and every landmark's x is mirrored the exact
   same way so face and hand coordinates live in the same space.

   Runs as a SECOND MediaPipe model alongside HandLandmarker, on the same
   video element/stream — this roughly doubles per-frame inference cost,
   which is the tradeoff for real head-tracked look/turn control.
   ============================================================================ */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

function mirrorLandmarks(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

export class HeadTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    /** Most recent face landmarks (478 points), or null if no face seen. */
    this.landmarks = null;
    this.ready = false;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
    };
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    } catch (gpuErr) {
      console.warn('[headTracker] GPU delegate unavailable, falling back to CPU:', gpuErr);
      options.baseOptions.delegate = 'CPU';
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    }
    this.ready = true;
  }

  /** Call once per rAF frame, same contract as HandTracker#update. */
  update(now) {
    if (!this.ready) return this.landmarks;
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) {
      return this.landmarks;
    }
    this.lastVideoTime = this.video.currentTime;
    const ts = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    this.lastTimestamp = ts;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, ts);
    } catch (err) {
      console.warn('[headTracker] detectForVideo failed on this frame:', err);
      return this.landmarks;
    }

    const face = result?.faceLandmarks?.[0];
    this.landmarks = face ? mirrorLandmarks(face) : null;
    return this.landmarks;
  }
}
