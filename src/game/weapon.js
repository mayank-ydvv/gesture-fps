/* ============================================================================
   weapon.js — hitscan raycasting, ammo/reload state, aim-mode FOV tween,
   and a small muzzle-flash light. Reacts to the EDGE flags (`firePressed`,
   `reloadPressed`) from the shared input struct, so it never needs its own
   debouncing — one edge in, at most one effect out.
   ============================================================================ */

import * as THREE from 'three';
import { config } from '../config.js';

export class Weapon {
  /** onEvent(type, payload) fires for: 'fire' | 'empty' | 'hit' | 'kill' |
   *  'reload-start' | 'reload-done'. Used by hud.js/audio to react without
   *  weapon.js knowing anything about the DOM or sound. */
  constructor(camera, scene, enemies, onEvent) {
    this.camera = camera;
    this.enemies = enemies;
    this.onEvent = onEvent || (() => {});
    this.raycaster = new THREE.Raycaster();

    this.ammo = config.weapon.magSize;
    this.reloading = false;
    this.reloadEndAt = 0;

    this.fov = config.weapon.hipFov;

    this.muzzleFlash = 0;
    this.muzzleLight = new THREE.PointLight(0xfff2b0, 0, 6, 2);
    scene.add(this.muzzleLight);
  }

  reset() {
    this.ammo = config.weapon.magSize;
    this.reloading = false;
    this.reloadEndAt = 0;
    this.fov = config.weapon.hipFov;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  startReload(now) {
    if (this.reloading || this.ammo === config.weapon.magSize) return;
    this.reloading = true;
    this.reloadEndAt = now + config.weapon.reloadMs;
    this.onEvent('reload-start');
  }

  update(input, now, dt) {
    // --- aim FOV tween (exponential approach, ~complete within fovTweenMs) ---
    // Skipped once converged so updateProjectionMatrix() (a real, if small,
    // per-call cost) doesn't run every single frame indefinitely while the
    // player just sits at a steady aim/hip FOV.
    const targetFov = input.aiming ? config.weapon.aimFov : config.weapon.hipFov;
    if (Math.abs(this.fov - targetFov) > 0.001) {
      const rate = Math.min(1, ((dt * 1000) / config.weapon.fovTweenMs) * 3);
      this.fov += (targetFov - this.fov) * rate;
      if (Math.abs(this.fov - targetFov) <= 0.001) this.fov = targetFov;
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- reload timer ---
    if (this.reloading && now >= this.reloadEndAt) {
      this.reloading = false;
      this.ammo = config.weapon.magSize;
      this.onEvent('reload-done');
    }
    if (input.reloadPressed) this.startReload(now);

    // --- fire ---
    if (input.firePressed) {
      if (this.reloading) {
        // ignored — mid-reload trigger pulls don't queue a shot
      } else if (this.ammo <= 0) {
        this.onEvent('empty');
      } else {
        this._fire(now);
      }
    }

    // --- muzzle flash decay + follow camera ---
    if (this.muzzleFlash > 0) this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 9);
    this.muzzleLight.intensity = this.muzzleFlash * 3.5;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.muzzleLight.position.copy(this.camera.position).addScaledVector(dir, 0.6);
  }

  _fire(now) {
    this.ammo -= 1;
    this.muzzleFlash = 1;
    this.onEvent('fire', { ammo: this.ammo });

    // The main loop calls weapon.update() (which can land here) BEFORE
    // renderer.render() each frame, and Object3D.matrixWorld is only
    // recomputed during that render traversal (or an explicit call) — so
    // without this, the raycast would use matrices from the END of the
    // PREVIOUS frame: the camera's (it's never added to `scene`, so
    // scene traversal alone wouldn't reach it) one frame stale relative to
    // the position/FOV set moments earlier this frame, and — the bug this
    // comment used to miss — every enemy's matrixWorld starting out as the
    // Object3D default identity until the first render ever runs, which is
    // what made a dead-center point-blank shot miss entirely in testing
    // before this fix. Both are cheap: single subtrees, not a full scene walk.
    this.camera.updateMatrixWorld();
    for (const enemy of this.enemies) enemy.group.updateMatrixWorld(true);

    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.raycaster.far = config.weapon.range;
    const targets = this.enemies.flatMap((e) => e.raycastTargets);
    const hits = this.raycaster.intersectObjects(targets, false);

    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      const enemy = hitMesh.userData.enemy;
      const headshot = hitMesh === enemy.headMesh;
      const damage = config.weapon.damage * (headshot ? 1.6 : 1);
      const killed = enemy.health - damage <= 0;
      enemy.hit(damage);
      this.onEvent('hit', { point: hits[0].point, headshot });
      if (killed) this.onEvent('kill', { headshot });
    }

    if (this.ammo <= 0) this.onEvent('mag-empty');
  }
}
