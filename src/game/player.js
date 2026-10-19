/* ============================================================================
   player.js — camera rig: forward movement (along the direction the camera
   is currently facing), head-tilt-driven yaw turning, and head bob.

   Yaw sign derivation (see config.headTurn's comment for the head-tilt side
   of this): Three.js's camera.rotation.y follows the standard right-hand
   rule around +Y. Starting from the fixed-forward vector (0,0,-1), rotating
   by +yaw gives forward = (-sin(yaw), 0, -cos(yaw)) — at small positive yaw
   that shifts the forward vector toward -X, i.e. toward the player's LEFT
   (since +X is "player's right" by the same right-handed convention this
   project already uses for the world). So: positive yaw = facing left, and
   to turn RIGHT (in response to a positive `input.turn`) yaw must DECREASE.
   That's the `this.yaw -= input.turn * ...` below — it's not an arbitrary
   sign choice, it falls out of that derivation.
   ============================================================================ */

import { config } from '../config.js';

const DEG2RAD = Math.PI / 180;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.bobPhase = 0;
    this.bobY = 0;
  }

  reset() {
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.bobPhase = 0;
    this.bobY = 0;
    this._apply();
  }

  /** input: the shared input struct { moveForward, turn, ... }. dt: seconds. */
  update(input, dt) {
    const { moveSpeed, arenaHalfWidth, forwardLimit, headBobAmplitude, headBobSpeed } = config.player;
    const { turnSpeedDegPerSec } = config.headTurn;

    this.yaw -= input.turn * turnSpeedDegPerSec * DEG2RAD * dt;
    // Keep yaw bounded to (-pi, pi] rather than letting it grow without limit
    // over a long play session, which would eventually lose float precision
    // in the sin/cos below. atan2(sin,cos) wraps to an equivalent angle.
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));

    if (input.moveForward) {
      // Move along the direction the camera currently faces, not always -Z —
      // turning actually changes where "forward" goes now.
      this.x += -Math.sin(this.yaw) * moveSpeed * dt;
      this.z += -Math.cos(this.yaw) * moveSpeed * dt;
    }

    this.x = clamp(this.x, -arenaHalfWidth + 0.6, arenaHalfWidth - 0.6);
    this.z = clamp(this.z, -forwardLimit + 0.6, 0);

    if (input.moveForward) {
      this.bobPhase += dt * headBobSpeed;
      this.bobY = Math.sin(this.bobPhase) * headBobAmplitude;
    } else {
      // Settle back toward neutral rather than snapping, so stopping never
      // looks like a jarring pop.
      this.bobY *= Math.max(0, 1 - dt * 8);
    }

    this._apply();
  }

  _apply() {
    this.camera.position.set(this.x, config.player.eyeHeight + this.bobY, this.z);
    this.camera.rotation.y = this.yaw;
  }
}
