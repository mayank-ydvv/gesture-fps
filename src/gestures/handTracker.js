/* ============================================================================
   handTracker.js — MediaPipe HandLandmarker wrapper.

   Ported from air-drums/index.html's working MediaPipe integration:
     - pinned CDN wasm path + pinned model asset (never "latest", so a CDN
       bump can't silently break this page)
     - GPU delegate with a CPU fallback for machines without usable WebGL
     - detectForVideo is only called when the video actually produced a new
       frame (video.currentTime changed), with a strictly-increasing
       timestamp — calling it twice with the same/decreasing timestamp
       throws
     - per-hand state keyed by MediaPipe's handedness label, with stale
       hands evicted the frame they leave the view (so a re-appearing hand
       can never inherit another hand's old state)

   New in this project: every landmark's x is mirrored (x -> 1 - x) right
   here, once, so everything downstream (classifier, debug overlay, video
   drawing) works in one consistent "selfie view" coordinate space — moving
   your real right hand to your right moves it right on screen too.
   ============================================================================ */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { config } from '../config.js';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function mirrorLandmarks(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    /** Most recent classified frame: { left: landmarks|null, right: landmarks|null } */
    this.hands = { left: null, right: null };
    this.ready = false;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch (gpuErr) {
      console.warn('[handTracker] GPU delegate unavailable, falling back to CPU:', gpuErr);
      options.baseOptions.delegate = 'CPU';
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    }
    this.ready = true;
  }

  /** Call once per rAF frame. Runs inference only when the camera produced a
   *  new frame (cheap no-op otherwise); returns the cached { left, right }
   *  either way, so callers never need to know whether inference actually
   *  ran this tick. */
  update(now) {
    if (!this.ready) return this.hands;
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) {
      return this.hands;
    }
    this.lastVideoTime = this.video.currentTime;
    const ts = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    this.lastTimestamp = ts;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, ts);
    } catch (err) {
      console.warn('[handTracker] detectForVideo failed on this frame:', err);
      return this.hands;
    }

    const next = { left: null, right: null };
    const list = result?.landmarks ?? [];
    for (let i = 0; i < list.length; i++) {
      let label = result.handedness?.[i]?.[0]?.categoryName; // "Left" | "Right"
      if (!label) continue;
      if (config.handedness.invert) {
        label = label === 'Left' ? 'Right' : 'Left';
      }
      const key = label === 'Left' ? 'left' : 'right';
      next[key] = mirrorLandmarks(list[i]);
    }
    this.hands = next;
    return this.hands;
  }
}

export async function initCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  if (!videoEl.videoWidth) {
    await new Promise((resolve) => videoEl.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}
