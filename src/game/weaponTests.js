/* ============================================================================
   weaponTests.js — camera-free correctness harness for hitscan + enemy
   state, run via index.html?test=1 alongside the gesture classifier tests.

   This exists because of a real bug it caught during development: weapon.js
   raycasts against camera.matrixWorld and each enemy's matrixWorld, but
   those are only recomputed by Three.js during renderer.render()'s scene
   traversal. main.js's loop calls weapon.update() (where the raycast can
   happen) BEFORE renderer.render() each frame, so without an explicit
   updateMatrixWorld() call, a shot fires against a decidedly stale
   transform. In production this is normally masked (frame N's raycast uses
   frame N-1's already-correct matrices, and a stationary target's matrix
   doesn't change between frames) — but it's still a real correctness gap,
   and it was fully exposed by this deterministic point-blank test, which
   builds a real Scene/Camera/Enemy/Weapon and fires WITHOUT ever calling
   renderer.render(), so nothing is masking a stale/never-computed matrix.
   The fix lives in weapon.js's _fire(): explicit
   `camera.updateMatrixWorld()` + `enemy.group.updateMatrixWorld(true)` for
   every target, right before the raycast.
   ============================================================================ */

import { createScene } from './scene.js';
import { Enemy } from './enemy.js';
import { Weapon } from './weapon.js';
import { config } from '../config.js';

function assert(results, name, cond, detail = '') {
  results.push({ name, pass: cond, detail });
}

const idle = { aiming: false, firePressed: false, reloadPressed: false, moveForward: false, turn: 0 };
const fireOnce = { ...idle, aiming: true, firePressed: true };

export function runWeaponTests() {
  const results = [];
  const canvas = document.createElement('canvas'); // detached — never rendered, on purpose
  const { scene, camera } = createScene(canvas);

  // --- point-blank dead-ahead shot: must hit despite zero prior renders ---
  const enemy = new Enemy(scene);
  enemy.spawnAt({ x: 0, z: -10 });
  const events = [];
  const weapon = new Weapon(camera, scene, [enemy], (type, payload) => events.push({ type, payload }));

  const startAmmo = weapon.ammo;
  weapon.update(fireOnce, performance.now(), 0.016);

  assert(results, 'ammo decrements by 1 on fire', weapon.ammo === startAmmo - 1, `${startAmmo} -> ${weapon.ammo}`);
  assert(
    results,
    '[matrixWorld fix] a dead-center point-blank shot registers a hit with zero prior renders',
    events.some((e) => e.type === 'hit'),
    JSON.stringify(events.map((e) => e.type))
  );
  const hitEvent = events.find((e) => e.type === 'hit');
  assert(results, 'a hit at head height is scored as a headshot', !!hitEvent?.payload?.headshot);

  // --- a shot well off-target must NOT register ---
  const missEnemy = new Enemy(scene);
  missEnemy.spawnAt({ x: 8, z: -10 });
  const missEvents = [];
  new Weapon(camera, scene, [missEnemy], (type) => missEvents.push(type)).update(fireOnce, performance.now(), 0.016);
  assert(results, 'a shot aimed well off an enemy does not register as a hit', !missEvents.includes('hit'), JSON.stringify(missEvents));

  // --- repeated point-blank hits kill the enemy, then it respawns healthy ---
  const killEnemy = new Enemy(scene);
  killEnemy.spawnAt({ x: 0, z: -8 });
  const killEvents = [];
  const killWeapon = new Weapon(camera, scene, [killEnemy], (type) => killEvents.push(type));
  let guard = 0;
  while (killEnemy.state === 'alive' && guard < 20) {
    killWeapon.update(fireOnce, performance.now(), 0.016);
    if (killWeapon.ammo <= 0) killWeapon.startReload(performance.now() - config.weapon.reloadMs - 10); // force-complete instantly
    killWeapon.update(idle, performance.now(), 0.016);
    guard++;
  }
  assert(results, 'repeated point-blank hits eventually kill the enemy', killEnemy.state !== 'alive', `state=${killEnemy.state}, shots=${guard}`);
  assert(results, 'a kill event fires exactly when the enemy dies', killEvents.includes('kill'), JSON.stringify(killEvents));

  let now = performance.now();
  for (let i = 0; i < 200 && killEnemy.state !== 'alive'; i++) {
    now += 50;
    killEnemy.update(0.05, now);
  }
  assert(
    results,
    'a dead enemy respawns alive at full health after its death animation + respawn delay',
    killEnemy.state === 'alive' && killEnemy.health === killEnemy.maxHealth,
    `state=${killEnemy.state}, health=${killEnemy.health}`
  );

  // --- reload gates fire; empty mag doesn't fire; ammo is capped at magSize ---
  const gateEnemy = new Enemy(scene);
  gateEnemy.spawnAt({ x: 0, z: -10 });
  const gateEvents = [];
  const gateWeapon = new Weapon(camera, scene, [gateEnemy], (type) => gateEvents.push(type));
  for (let i = 0; i < config.weapon.magSize; i++) gateWeapon.update(fireOnce, performance.now(), 0.016);
  assert(results, 'mag is empty after magSize shots', gateWeapon.ammo === 0);
  gateWeapon.update(fireOnce, performance.now(), 0.016);
  assert(results, 'firing with an empty mag does not fire again (ammo stays 0)', gateWeapon.ammo === 0);
  assert(results, 'firing with an empty mag emits "empty" instead of another shot', gateEvents.filter((t) => t === 'empty').length >= 1);

  gateWeapon.update({ ...idle, reloadPressed: true }, performance.now(), 0.016);
  assert(results, 'reloadPressed with a non-full mag starts a reload', gateWeapon.reloading === true);
  gateWeapon.update(fireOnce, performance.now() + 10, 0.016);
  assert(results, 'a trigger pull mid-reload is ignored (no shot fires while reloading)', gateWeapon.ammo === 0);
  gateWeapon.update(idle, performance.now() + config.weapon.reloadMs + 50, 0.016);
  assert(results, 'ammo refills to magSize once the reload timer elapses', gateWeapon.ammo === config.weapon.magSize);

  return results;
}
