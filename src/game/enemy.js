/* ============================================================================
   enemy.js — standing capsule enemy targets: spawn placement across a wide
   arc in front of the player, health, hit reaction (flash), death (sink +
   fade), and timed respawn at a new random spot in the arc.
   ============================================================================ */

import * as THREE from 'three';
import { config } from '../config.js';

const DEATH_ANIM_S = 0.45;
const SPAWN_ANIM_S = 0.35;
const FLASH_DECAY_PER_S = 10;
const BODY_RADIUS = 0.35;
const BODY_LENGTH = 0.9;
const BODY_HEIGHT = BODY_LENGTH + BODY_RADIUS * 2;
const HEAD_RADIUS = 0.22;

// Minimum center-to-center distance between two enemies' spawn points (body
// diameter is 0.7, so this leaves clear space beyond simple mesh contact).
const MIN_SPAWN_SEPARATION = 3;

/** Random spawn point somewhere across enemy.spawnArcDeg, centered on the
 *  player's forward direction (-Z), at a random distance in
 *  [minDistance, maxDistance]. Returns { x, z, angleDeg } (angleDeg kept for
 *  the debug/legend view).
 *
 *  `avoid` is a list of { x, z } points (other live enemies) the new point
 *  should keep clear of — without this, two targets could spawn overlapping
 *  or standing on top of each other. Rejection-samples a few times and
 *  falls back to the last attempt if the arc is too crowded to satisfy. */
export function randomSpawnPoint(avoid = []) {
  const { spawnArcDeg, minDistance, maxDistance } = config.enemy;
  const halfArc = (spawnArcDeg * Math.PI) / 180 / 2;
  const MAX_ATTEMPTS = 20;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const angle = (Math.random() * 2 - 1) * halfArc;
    const distance = minDistance + Math.random() * (maxDistance - minDistance);
    const point = {
      x: Math.sin(angle) * distance,
      z: -Math.cos(angle) * distance,
      angleDeg: (angle * 180) / Math.PI,
    };
    const tooClose = avoid.some((p) => Math.hypot(p.x - point.x, p.z - point.z) < MIN_SPAWN_SEPARATION);
    if (!tooClose || attempt === MAX_ATTEMPTS - 1) return point;
  }
}

export class Enemy {
  /** siblings: the shared array of all Enemy instances in the field (this
   *  one included), used only to keep this enemy's spawn/respawn point away
   *  from the others — see randomSpawnPoint's `avoid` param. */
  constructor(scene, siblings = []) {
    this.scene = scene;
    this.siblings = siblings;
    this.group = new THREE.Group();

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xb33b3b, roughness: 0.6, transparent: true });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xd98c6b, roughness: 0.7, transparent: true });

    const bodyGeo = new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 10);
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.bodyMesh.position.y = BODY_HEIGHT / 2;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.userData.enemy = this;

    const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 16, 12);
    this.headMesh = new THREE.Mesh(headGeo, this.headMat);
    this.headMesh.position.y = BODY_HEIGHT + HEAD_RADIUS * 0.7;
    this.headMesh.castShadow = true;
    this.headMesh.userData.enemy = this;

    this.group.add(this.bodyMesh, this.headMesh);
    scene.add(this.group);

    this.maxHealth = config.enemy.health;
    this.health = this.maxHealth;
    this.state = 'alive'; // 'alive' | 'dying' | 'hidden' | 'spawning'
    this.stateT = 0;
    this.hiddenUntil = 0;
    this.flash = 0;

    this.spawnAt(randomSpawnPoint(this._siblingPositions()));
  }

  /** { x, z } of every OTHER currently-visible sibling, for spawn separation. */
  _siblingPositions() {
    return this.siblings
      .filter((e) => e !== this && e.state !== 'hidden')
      .map((e) => ({ x: e.group.position.x, z: e.group.position.z }));
  }

  spawnAt({ x, z }) {
    this.group.position.set(x, 0, z);
    this.group.scale.setScalar(1);
    this.health = this.maxHealth;
    this.state = 'alive';
    this.stateT = 0;
    this.bodyMat.opacity = 1;
    this.headMat.opacity = 1;
    this.flash = 0;
  }

  get raycastTargets() {
    return this.state === 'alive' ? [this.bodyMesh, this.headMesh] : [];
  }

  /** Returns true if the hit was accepted (enemy was alive to take it). */
  hit(damage) {
    if (this.state !== 'alive') return false;
    this.health -= damage;
    this.flash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'dying';
      this.stateT = 0;
      return true;
    }
    return true;
  }

  update(dt, now) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * FLASH_DECAY_PER_S);
    const flashColor = this.flash > 0;
    this.bodyMat.emissive = flashColor ? new THREE.Color(1, 1, 1).multiplyScalar(this.flash) : new THREE.Color(0, 0, 0);
    this.headMat.emissive = this.bodyMat.emissive;

    if (this.state === 'dying') {
      this.stateT += dt;
      const t = Math.min(1, this.stateT / DEATH_ANIM_S);
      this.group.position.y = -t * 1.1;
      this.group.scale.setScalar(1 - t * 0.25);
      this.bodyMat.opacity = 1 - t;
      this.headMat.opacity = 1 - t;
      if (t >= 1) {
        this.state = 'hidden';
        this.hiddenUntil = now + config.enemy.respawnDelayMs;
      }
    } else if (this.state === 'hidden') {
      if (now >= this.hiddenUntil) {
        this.spawnAt(randomSpawnPoint(this._siblingPositions()));
        this.state = 'spawning';
        this.stateT = 0;
        this.bodyMat.opacity = 0;
        this.headMat.opacity = 0;
        this.group.position.y = -1.1;
      }
    } else if (this.state === 'spawning') {
      this.stateT += dt;
      const t = Math.min(1, this.stateT / SPAWN_ANIM_S);
      this.group.position.y = -1.1 * (1 - t);
      this.group.scale.setScalar(0.75 + t * 0.25);
      this.bodyMat.opacity = t;
      this.headMat.opacity = t;
      if (t >= 1) this.state = 'alive';
    }
  }
}

export function createEnemyField(scene) {
  const enemies = [];
  // Passing the same (mutating) array as `siblings` to every enemy means
  // each new one spawns clear of every enemy already placed before it.
  for (let i = 0; i < config.enemy.count; i++) enemies.push(new Enemy(scene, enemies));
  return enemies;
}
