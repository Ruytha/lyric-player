// Equalizer (••• → Equalizer…, or Settings → Playback): 10 bands with
// presets, for your own songs. Saved as "eqGains" (dB, comma-separated).

import { EQ_BANDS } from './audio-fx.js';

export const EQ_PRESETS = {
  flat: ['Flat', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  bass: ['Bass Booster', [6, 5, 4, 2.5, 1, 0, 0, 0, 0, 0]],
  bassless: ['Bass Reducer', [-6, -5, -4, -2.5, -1, 0, 0, 0, 0, 0]],
  treble: ['Treble Booster', [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6]],
  vocal: ['Vocal Booster', [-2, -2, -1, 1, 3, 4, 3.5, 2, 0, -1]],
  acoustic: ['Acoustic', [4, 4, 3, 1, 1.5, 1.5, 3, 3.5, 3, 2]],
  dance: ['Dance', [5, 6.5, 4.5, 0, 2, 3.5, 5, 4.5, 3.5, 0]],
  electronic: ['Electronic', [4.5, 4, 1.5, 0, -2, 2, 1, 1.5, 4, 5]],
  hiphop: ['Hip-Hop', [5, 4.5, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3]],
  rock: ['Rock', [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5]],
  pop: ['Pop', [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5]],
  latenight: ['Late Night', [4.5, 3, 1.5, -0.5, -1, 0.5, 1.5, 2.5, 3.5, 3]],
  small: ['Small Speakers', [5.5, 4, 3.5, 2.5, 1.5, 0, -1.5, -2.5, -3.5, -4]],
  loud: ['Loudness', [6, 4, 0, 0, -2, 0, -1, -5, 5, 1]],
};

export const parseGains = (s) => {
  const v = String(s || '').split(',').map(Number);
  return EQ_BANDS.map((_, i) => (Number.isFinite(v[i]) ? Math.max(-12, Math.min(12, v[i])) : 0));
};
export const formatGains = (g) => g.map((x) => Math.round(x * 2) / 2).join(',');
export const presetOf = (gains) => Object.keys(EQ_PRESETS).find((k) => EQ_PRESETS[k][1].every((v, i) => Math.abs(v - gains[i]) < 0.26)) || 'custom';

const label = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

/** h: { settings, toast, applies() → true when it affects what's playing } */
export function showEqualizer(h) {
  const { settings } = h;
  document.getElementById('eqDialog')?.remove();
  const root = document.createElement('div');
  root.className = 'lyric-search whats-new eq';
  root.id = 'eqDialog';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Equalizer');
  root.innerHTML = `
    <div class="ls-panel wn-panel eq-panel">
      <div class="card-head">
        <h2>Equalizer</h2>
        <input type="checkbox" class="set-switch eq-on" role="switch" aria-label="Equalizer on" title="Equalizer on or off">
        <button class="sheet-btn sheet-close" data-close type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="wn-body">
        <div class="eq-presets">${Object.entries(EQ_PRESETS).map(([k, [name]]) => `<button type="button" class="st-chip" data-preset="${k}">${name}</button>`).join('')}<button type="button" class="st-chip" data-preset="custom" disabled>Custom</button></div>
        <div class="eq-bands">
          <div class="eq-scale"><span>+12</span><span>0</span><span>−12</span></div>
          ${EQ_BANDS.map((f, i) => `<label class="eq-band"><output>0</output><input type="range" min="-12" max="12" step="0.5" value="0" data-band="${i}" aria-label="${label(f)} Hz"><span>${label(f)}</span></label>`).join('')}
        </div>
        <p class="eq-note" hidden></p>
      </div>
      <div class="acct-buttons wn-foot"><button class="pill pill-small pill-ghost" data-reset type="button">Reset</button><button class="pill pill-small" data-close type="button">Done</button></div>
    </div>`;
  document.body.appendChild(root);

  const inputs = [...root.querySelectorAll('[data-band]')];
  const onBox = root.querySelector('.eq-on');
  const sync = () => {
    const gains = parseGains(settings.get('eqGains'));
    inputs.forEach((inp, i) => {
      inp.value = gains[i];
      inp.previousElementSibling.textContent = `${gains[i] > 0 ? '+' : ''}${gains[i]}`;
      inp.style.setProperty('--p', `${((gains[i] + 12) / 24) * 100}%`);
    });
    onBox.checked = !!settings.get('eqOn');
    root.querySelector('.eq-bands').classList.toggle('off', !settings.get('eqOn'));
    const p = presetOf(gains);
    for (const b of root.querySelectorAll('[data-preset]')) b.setAttribute('aria-selected', String(b.dataset.preset === p));
    const note = root.querySelector('.eq-note');
    note.hidden = h.applies();
    note.textContent = 'The equalizer works on your own songs. Music from Spotify, Apple Music or a browser can’t be changed from here.';
  };
  const set = (gains) => { settings.set('eqGains', formatGains(gains)); if (!settings.get('eqOn')) settings.set('eqOn', true); sync(); };
  for (const inp of inputs) {
    inp.addEventListener('input', () => {
      const g = parseGains(settings.get('eqGains'));
      g[+inp.dataset.band] = +inp.value;
      set(g);
    });
    inp.addEventListener('dblclick', () => { const g = parseGains(settings.get('eqGains')); g[+inp.dataset.band] = 0; set(g); });
  }
  root.querySelector('.eq-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b && EQ_PRESETS[b.dataset.preset]) set(EQ_PRESETS[b.dataset.preset][1].slice());
  });
  onBox.addEventListener('change', () => { settings.set('eqOn', onBox.checked); sync(); });
  root.querySelector('[data-reset]').addEventListener('click', () => set(EQ_PRESETS.flat[1].slice()));
  const close = () => { root.classList.remove('open'); setTimeout(() => root.remove(), 250); };
  for (const b of root.querySelectorAll('[data-close]')) b.addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  sync();
  requestAnimationFrame(() => { root.classList.add('open'); root.querySelector('.pill[data-close]').focus(); });
}
