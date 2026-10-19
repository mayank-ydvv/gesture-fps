/* ============================================================================
   scene.js — Three.js renderer, scene, lighting, ground, arena walls.
   No look controls at all: the camera is fixed-forward (see the plan's
   resolved "look system" decision) — enemies are spread across a wide arc
   in front of the player instead, and strafing changes the player's angle
   on them so the arena still reads as 3D.
   ============================================================================ */

import * as THREE from 'three';
import { config } from '../config.js';

const SKY_COLOR = 0x101820;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  const { arenaHalfWidth, forwardLimit } = config.player;
  scene.fog = new THREE.Fog(SKY_COLOR, forwardLimit * 0.55, forwardLimit + 20);

  const camera = new THREE.PerspectiveCamera(config.weapon.hipFov, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, config.player.eyeHeight, 0);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- Lighting ----------
  scene.add(new THREE.HemisphereLight(0x88aaff, 0x223311, 0.85));
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const dirLight = new THREE.DirectionalLight(0xfff3d6, 1.1);
  dirLight.position.set(20, 35, -10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -arenaHalfWidth - 5;
  dirLight.shadow.camera.right = arenaHalfWidth + 5;
  dirLight.shadow.camera.top = forwardLimit + 5;
  dirLight.shadow.camera.bottom = -5;
  dirLight.shadow.camera.far = 120;
  scene.add(dirLight);

  // ---------- Ground ----------
  const groundGeo = new THREE.PlaneGeometry(arenaHalfWidth * 2 + 4, forwardLimit + 10);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2b3a2b, roughness: 0.95 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -(forwardLimit + 10) / 2 + 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Faint grid so motion/depth read clearly even with a plain ground.
  const grid = new THREE.GridHelper(Math.max(arenaHalfWidth * 2, forwardLimit), 24, 0x3a4a3a, 0x2a3a2a);
  grid.position.y = 0.01;
  scene.add(grid);

  // ---------- Arena walls (low, translucent — just a visual/physical boundary) ----------
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x3a4a5a,
    transparent: true,
    opacity: 0.35,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const wallHeight = 4;

  function addWall(width, x, z, rotY) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, wallHeight), wallMat);
    wall.position.set(x, wallHeight / 2, z);
    wall.rotation.y = rotY;
    scene.add(wall);
  }
  const depth = forwardLimit + 4;
  addWall(depth, -arenaHalfWidth, -forwardLimit / 2 + 2, Math.PI / 2);
  addWall(depth, arenaHalfWidth, -forwardLimit / 2 + 2, Math.PI / 2);
  addWall(arenaHalfWidth * 2, 0, -forwardLimit - 2, 0);
  addWall(arenaHalfWidth * 2, 0, 4, 0);

  // ---------- Backdrop skyline (cheap, non-interactive depth cue) ----------
  const skylineGroup = new THREE.Group();
  const skylineMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 1 });
  for (let i = 0; i < 14; i++) {
    const w = 3 + Math.random() * 5;
    const h = 8 + Math.random() * 26;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skylineMat);
    const x = (Math.random() - 0.5) * (arenaHalfWidth * 3);
    box.position.set(x, h / 2, -(forwardLimit + 15 + Math.random() * 20));
    skylineGroup.add(box);
  }
  scene.add(skylineGroup);

  return { renderer, scene, camera };
}
