/* ============================================================================
   main.js — app bootstrap and the single requestAnimationFrame render loop.

   Three URL-driven modes:
     (default)  real webcam + MediaPipe gesture control (two models run
                side by side against the same video: HandLandmarker for
                movement/aim/fire/reload, FaceLandmarker for head-tilt turning)
     ?mock=1    keyboard-driven MockInputState — no camera/model, used to
                verify every downstream system (movement, turning, hitscan,
                ammo, reload, aim FOV, scoring, HUD) without a webcam
     ?test=1    runs the classifier/inputState correctness harness and
                prints a pass/fail table instead of starting the game
   ============================================================================ */

import { config } from './config.js';
import { HandTracker, initCamera, stopCamera } from './gestures/handTracker.js';
import { HeadTracker } from './gestures/headTracker.js';
import { InputState } from './gestures/inputState.js';
import { MockInputState } from './gestures/mockInput.js';
import { createScene } from './game/scene.js';
import { Player } from './game/player.js';
import { Weapon } from './game/weapon.js';
import { createEnemyField } from './game/enemy.js';
import { AudioEngine } from './game/audio.js';
import { Hud } from './ui/hud.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { Calibration } from './ui/calibration.js';
import { Settings } from './ui/settings.js';
import { runClassifierTests, runStatefulTests } from './gestures/classifierTests.js';
import { runWeaponTests } from './game/weaponTests.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const MOCK = params.has('mock');
const TEST = params.has('test');

if (TEST) {
  runTestMode();
} else {
  boot();
}

async function runTestMode() {
  const el = $('test-results');
  el.classList.add('show');
  el.textContent = 'Running classifier tests…\n';
  const pure = runClassifierTests();
  const stateful = await runStatefulTests();
  const weaponResults = runWeaponTests();
  const all = [...pure, ...stateful, ...weaponResults];
  const lines = all.map((r) => `${r.pass ? '✅ PASS' : '❌ FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const passCount = all.filter((r) => r.pass).length;
  const report = `Gesture Classifier Test Results\n${'='.repeat(48)}\n\n${lines.join('\n')}\n\n${passCount}/${all.length} passed.`;
  el.textContent = report;
  console.log(report);
}

function boot() {
  const startOverlay = $('start-overlay');
  const loadingOverlay = $('loading-overlay');
  const loadingText = $('loading-text');
  const errorOverlay = $('error-overlay');
  const errorMessage = $('error-message');
  const errorDetail = $('error-detail');
  const startBtn = $('start-btn');
  const errorRetryBtn = $('error-retry-btn');
  const mockNote = $('mock-note');
  const video = $('webcam');
  const debugToggleBtn = $('debug-toggle');
  const recenterBtn = $('recenter-btn');

  if (MOCK) {
    mockNote.style.display = 'block';
    debugToggleBtn.style.display = 'none'; // nothing to show without a camera
  } else {
    recenterBtn.addEventListener('click', () => {
      inputState.recenterNow();
      recenterBtn.classList.remove('flash');
      void recenterBtn.offsetWidth; // restart the flash animation on repeat clicks
      recenterBtn.classList.add('flash');
    });
  }

  // ---------------- scene + game objects (built once, up front, so the
  // arena is visible behind the start/loading overlays) ----------------
  const canvas = $('game-canvas');
  const { renderer, scene, camera } = createScene(canvas);
  const player = new Player(camera);
  const enemies = createEnemyField(scene);
  const audio = new AudioEngine();
  const hud = new Hud();
  new Settings();

  let score = 0;
  let wave = 1;
  let killsThisWave = 0;
  hud.updateScore(score);
  hud.updateWave(wave);

  function onWeaponEvent(type, payload) {
    if (type === 'fire') {
      audio.playShot();
    } else if (type === 'empty') {
      audio.playEmpty();
      hud.flashEmpty();
    } else if (type === 'hit') {
      audio.playHit(payload.headshot);
      hud.flashHit(payload.headshot);
      score += payload.headshot ? 20 : 10;
      hud.updateScore(score);
    } else if (type === 'kill') {
      score += payload.headshot ? 100 : 50;
      hud.updateScore(score);
      hud.showKillFeed(payload.headshot ? 'HEADSHOT!' : 'TARGET DOWN');
      killsThisWave++;
      if (killsThisWave >= config.enemy.count) {
        killsThisWave = 0;
        wave++;
        hud.updateWave(wave);
      }
    } else if (type === 'reload-start') {
      audio.playReloadStart();
    } else if (type === 'reload-done') {
      audio.playReloadDone();
    } else if (type === 'mag-empty') {
      audio.playLowAmmoBeep();
    }
  }
  const weapon = new Weapon(camera, scene, enemies, onWeaponEvent);

  let inputState = null;
  let handTracker = null;
  let headTracker = null;
  let cameraStream = null; // stopped/replaced on every (re)start so a failed
  // model load followed by "Try Again" never leaves an orphaned webcam track
  // running in the background (see stopCamera call below).
  let debugOverlay = null;
  let calibration = null;
  let gameState = 'start'; // 'start' | 'loading' | 'error' | 'calibration' | 'playing'

  function showOverlay(which) {
    startOverlay.hidden = which !== 'start';
    loadingOverlay.hidden = which !== 'loading';
    errorOverlay.classList.toggle('show', which === 'error');
  }

  function showError(message, detail) {
    errorMessage.textContent = message;
    errorDetail.textContent = detail || '';
    showOverlay('error');
    gameState = 'error';
  }

  function startCalibration() {
    calibration = new Calibration(
      () => startGame(),
      (neutralTiltDeg) => inputState.setNeutralTilt(neutralTiltDeg)
    );
    calibration.start();
    gameState = 'calibration';
  }

  function startGame() {
    player.reset();
    weapon.reset();
    gameState = 'playing';
    if (!MOCK) recenterBtn.classList.add('show'); // nothing to recenter in mock mode
  }

  startBtn.addEventListener('click', async () => {
    audio.ensure(); // must happen inside a user-gesture handler
    startBtn.disabled = true;

    if (MOCK) {
      inputState = new MockInputState();
      startOverlay.hidden = true;
      startGame();
      return;
    }

    showOverlay('loading');
    loadingText.textContent = 'Requesting camera access…';
    stopCamera(cameraStream); // release any stream from a previous failed attempt before requesting a new one
    cameraStream = null;
    try {
      cameraStream = await initCamera(video);
    } catch (err) {
      showError('Camera access was denied or unavailable.', String((err && err.message) || err));
      return;
    }

    // Two MediaPipe models against the same video stream: hands (movement/
    // aim/fire/reload) and face (head-tilt turning). Loaded in parallel —
    // each downloads/initializes independently, so there's no reason to
    // serialize them.
    loadingText.textContent = 'Loading hand + head tracking models…';
    handTracker = new HandTracker(video);
    headTracker = new HeadTracker(video);
    try {
      await Promise.all([handTracker.init(), headTracker.init()]);
    } catch (err) {
      showError(
        'The hand/head-tracking models failed to load. Check your connection and try again.',
        String((err && err.message) || err)
      );
      return;
    }

    debugOverlay = new DebugOverlay(video);
    inputState = new InputState();
    startOverlay.hidden = true;
    loadingOverlay.hidden = true;
    startCalibration();
  });

  errorRetryBtn.addEventListener('click', () => {
    startBtn.disabled = false;
    gameState = 'start';
    showOverlay('start');
  });

  // ---------------- main loop ----------------
  const emptyHands = { left: null, right: null };
  const idleInput = { moveForward: false, turn: 0, aiming: false, firePressed: false, reloadPressed: false, debug: {} };
  let lastFrameTime = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    const hands = handTracker ? handTracker.update(now) : emptyHands;
    const head = headTracker ? headTracker.update(now) : null;

    if (gameState === 'calibration') {
      calibration.update(hands, head, now);
      if (debugOverlay) debugOverlay.render(hands, head, idleInput);
      renderer.render(scene, camera);
      return;
    }

    if (gameState !== 'playing') {
      renderer.render(scene, camera);
      return;
    }

    const input = inputState.update(hands, head, now);

    player.update(input, dt);
    weapon.update(input, now, dt);
    for (const enemy of enemies) enemy.update(dt, now);

    const reloadProgress = weapon.reloading
      ? Math.min(1, (now - (weapon.reloadEndAt - config.weapon.reloadMs)) / config.weapon.reloadMs)
      : 0;
    hud.updateAmmo(weapon.ammo, weapon.reloading, reloadProgress);
    hud.showReloadPrompt(weapon.ammo <= 2 && !weapon.reloading);
    hud.updateInputChips(input);
    hud.tickFps(now);

    if (debugOverlay) debugOverlay.render(hands, head, input);

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
