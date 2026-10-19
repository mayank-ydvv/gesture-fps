/* ============================================================================
   hud.js — ammo, score, wave, crosshair, hit markers, reload prompt, move
   indicator chips, kill feed, and the gesture legend panel. Pure DOM
   wiring; takes plain values in, never reaches into game/gesture internals.
   ============================================================================ */

import { config } from '../config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.ammoCount = $('ammo-count');
    this.reloadTrack = $('reload-bar-track');
    this.reloadFill = $('reload-bar-fill');
    this.scoreValue = $('score-value');
    this.waveValue = $('wave-value');
    this.crosshair = $('crosshair');
    this.hitMarker = $('hit-marker');
    this.killFeed = $('kill-feed');
    this.reloadPrompt = $('reload-prompt');
    this.vignette = $('vignette');
    this.fpsCounter = $('fps-counter');

    this.chipMove = $('chip-move');
    this.chipTurnL = $('chip-turn-l');
    this.chipTurnR = $('chip-turn-r');
    this.chipAim = $('chip-aim');

    this.legendToggle = $('legend-toggle');
    this.legend = $('legend');
    this.legendToggle.addEventListener('click', () => {
      this.legend.hidden = !this.legend.hidden;
      // Mutually exclusive with the settings panel — both anchor to the
      // same top-right corner and would otherwise overlap.
      if (!this.legend.hidden) $('settings-panel').classList.remove('open');
    });

    this._killFeedTimer = null;
    this._hitMarkerTimer = null;
    this._vignetteTimer = null;

    this._fpsFrames = 0;
    this._fpsWindowStart = performance.now();
  }

  updateAmmo(ammo, reloading, reloadProgress) {
    this.ammoCount.textContent = `${Math.max(0, ammo)} / ${config.weapon.magSize}`;
    this.ammoCount.classList.toggle('empty', ammo <= 0);
    this.ammoCount.classList.toggle('low', ammo > 0 && ammo <= 2);
    this.reloadTrack.classList.toggle('active', reloading);
    this.reloadFill.style.width = `${Math.round(reloadProgress * 100)}%`;
  }

  showReloadPrompt(show) {
    this.reloadPrompt.classList.toggle('show', show);
  }

  updateScore(score) {
    this.scoreValue.textContent = String(score);
  }

  updateWave(wave) {
    this.waveValue.textContent = String(wave);
  }

  updateInputChips(input) {
    this.chipMove.classList.toggle('active', input.moveForward);
    this.chipTurnL.classList.toggle('active', input.turn < -0.05);
    this.chipTurnR.classList.toggle('active', input.turn > 0.05);
    this.chipAim.classList.toggle('active', input.aiming);
    this.crosshair.classList.toggle('aiming', input.aiming);
  }

  flashHit(headshot) {
    this.hitMarker.classList.remove('show');
    // Force reflow so the animation restarts even on rapid repeated hits.
    void this.hitMarker.offsetWidth;
    this.hitMarker.classList.add('show');
    this.crosshair.classList.add('hit-flash');
    clearTimeout(this._hitMarkerTimer);
    this._hitMarkerTimer = setTimeout(() => this.crosshair.classList.remove('hit-flash'), 140);
  }

  showKillFeed(text) {
    this.killFeed.textContent = text;
    this.killFeed.classList.remove('show');
    void this.killFeed.offsetWidth;
    this.killFeed.classList.add('show');
  }

  /** Brief tinted pulse — repurposed here as dry-fire ("empty mag") feedback
   *  rather than player damage, since standing targets don't shoot back. */
  flashEmpty() {
    this.vignette.classList.add('show');
    clearTimeout(this._vignetteTimer);
    this._vignetteTimer = setTimeout(() => this.vignette.classList.remove('show'), 220);
  }

  tickFps(now) {
    this._fpsFrames++;
    const elapsed = now - this._fpsWindowStart;
    if (elapsed >= 500) {
      const fps = Math.round((this._fpsFrames * 1000) / elapsed);
      this.fpsCounter.textContent = `${fps} fps`;
      this.fpsCounter.style.color = fps < 30 ? 'var(--warn-amber)' : '';
      this._fpsFrames = 0;
      this._fpsWindowStart = now;
    }
  }
}
