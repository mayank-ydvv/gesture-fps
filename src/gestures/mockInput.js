/* ============================================================================
   mockInput.js — keyboard-driven stand-in for InputState, enabled via the
   ?mock=1 URL flag. Emits the EXACT same input struct shape as
   inputState.js, so every downstream system (player movement, turning,
   hitscan, ammo/reload, aim FOV, scoring, waves, HUD) is fully exercisable
   in an automated browser session with no webcam and no MediaPipe model
   download. This is the primary way the whole game (everything except the
   gesture layer itself) gets verified.

   Keys:
     W (hold)         -> moveForward
     A / D (hold)      -> turn left / right (stands in for tilting your head)
     Shift (hold)      -> aiming (stands in for a held gun pose)
     Space (press)      -> firePressed (edge), only while aiming — mirrors
                            the real trigger only working while aim-latched
     R (press)          -> reloadPressed (edge)
   ============================================================================ */

export class MockInputState {
  constructor() {
    this.keys = new Set();
    this._spacePrev = false;
    this._rPrev = false;
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  setNeutralTilt() {
    /* no-op: mock input has no head to calibrate */
  }

  recenterNow() {
    /* no-op: mock input has no head-tilt bias to recenter */
  }

  reset() {
    this.keys.clear();
    this._spacePrev = false;
    this._rPrev = false;
  }

  /** Signature matches InputState#update(hands, headLandmarks, now) so
   *  main.js can treat both interchangeably; the tracking args are ignored. */
  update(_hands, _headLandmarks, _now) {
    const moveForward = this.keys.has('KeyW');
    const left = this.keys.has('KeyA');
    const right = this.keys.has('KeyD');
    const turn = right && !left ? 1 : left && !right ? -1 : 0;
    const aiming = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const spaceDown = this.keys.has('Space');
    const firePressed = aiming && spaceDown && !this._spacePrev;
    this._spacePrev = spaceDown;

    const rDown = this.keys.has('KeyR');
    const reloadPressed = rDown && !this._rPrev;
    this._rPrev = rDown;

    return {
      moveForward,
      turn,
      aiming,
      firePressed,
      reloadPressed,
      debug: { mock: true, keys: [...this.keys] },
    };
  }
}
