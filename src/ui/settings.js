/* ============================================================================
   settings.js — live tuning panel over config.js. Every threshold/dead-zone/
   debounce timing the game reads lives in one object (config.js); this panel
   just exposes a subset of it as sliders so sensitivity can be tuned per
   webcam/lighting setup without touching code, exactly as the plan's
   Milestone 10 calls for.
   ============================================================================ */

import { config } from '../config.js';

const $ = (id) => document.getElementById(id);

const SCHEMA = [
  { path: ['handedness', 'invert'], type: 'checkbox', label: 'Invert detected L/R hand' },
  { path: ['curl', 'curledThreshold'], type: 'range', label: 'Finger curl threshold', min: 0.02, max: 0.2, step: 0.01 },
  { path: ['curl', 'extendedThreshold'], type: 'range', label: 'Finger extended threshold', min: -0.15, max: -0.01, step: 0.01 },
  { path: ['openPalm', 'minExtensionRatio'], type: 'range', label: 'Open-palm extension', min: 0.2, max: 1.0, step: 0.05 },
  { path: ['gunPose', 'latchGraceMs'], type: 'range', label: 'Gun-pose latch (ms)', min: 100, max: 600, step: 20 },
  { path: ['trigger', 'armExtension'], type: 'range', label: 'Trigger arm extension', min: 0.15, max: 0.6, step: 0.02 },
  { path: ['trigger', 'firedExtension'], type: 'range', label: 'Trigger fired extension', min: 0.05, max: 0.4, step: 0.02 },
  { path: ['trigger', 'cooldownMs'], type: 'range', label: 'Fire cooldown (ms)', min: 100, max: 600, step: 20 },
  { path: ['headTurn', 'invert'], type: 'checkbox', label: 'Invert head-tilt turn direction' },
  { path: ['headTurn', 'deadZoneDeg'], type: 'range', label: 'Turn dead-zone (deg, higher = less sensitive)', min: 2, max: 20, step: 0.5 },
  { path: ['headTurn', 'maxTiltDeg'], type: 'range', label: 'Max useful tilt (deg)', min: 10, max: 40, step: 1 },
  { path: ['headTurn', 'turnSpeedDegPerSec'], type: 'range', label: 'Turn speed (deg/sec)', min: 15, max: 150, step: 5 },
  { path: ['headTurn', 'smoothingAlpha'], type: 'range', label: 'Turn smoothing (lower = smoother)', min: 0.03, max: 0.6, step: 0.01 },
  { path: ['smoothing', 'alpha'], type: 'range', label: 'Hand smoothing (higher = snappier)', min: 0.1, max: 0.9, step: 0.05 },
  { path: ['stability', 'holdMs'], type: 'range', label: 'Gesture stability hold (ms)', min: 50, max: 400, step: 10 },
];

function getAt(obj, path) {
  return path.reduce((o, k) => o[k], obj);
}
function setAt(obj, path, value) {
  const parent = path.slice(0, -1).reduce((o, k) => o[k], obj);
  parent[path[path.length - 1]] = value;
}

export class Settings {
  constructor() {
    this.toggleBtn = $('settings-toggle');
    this.panel = $('settings-panel');
    this.toggleBtn.style.display = 'block';
    this.toggleBtn.addEventListener('click', () => {
      this.panel.classList.toggle('open');
      // Mutually exclusive with the legend panel — both anchor to the same
      // top-right corner and would otherwise overlap.
      if (this.panel.classList.contains('open')) $('legend').hidden = true;
    });
    this._render();
  }

  _render() {
    this.panel.innerHTML = '<h3>Sensitivity Settings</h3>';
    for (const entry of SCHEMA) {
      const row = document.createElement('div');
      row.className = 'setting-row';
      const current = getAt(config, entry.path);

      if (entry.type === 'checkbox') {
        row.innerHTML = `<div class="checkbox-row"><input type="checkbox" ${current ? 'checked' : ''}/> <span>${entry.label}</span></div>`;
        const input = row.querySelector('input');
        input.addEventListener('change', () => setAt(config, entry.path, input.checked));
      } else {
        const valId = `val-${entry.path.join('-')}`;
        row.innerHTML = `
          <label><span>${entry.label}</span><span id="${valId}">${current}</span></label>
          <input type="range" min="${entry.min}" max="${entry.max}" step="${entry.step}" value="${current}" />
        `;
        const input = row.querySelector('input');
        const valEl = row.querySelector(`#${valId}`);
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          setAt(config, entry.path, v);
          valEl.textContent = v;
        });
      }
      this.panel.appendChild(row);
    }

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn secondary';
    resetBtn.style.cssText = 'margin-top:8px; width:100%; padding:8px; font-size:12px;';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', () => window.location.reload());
    this.panel.appendChild(resetBtn);
  }
}
