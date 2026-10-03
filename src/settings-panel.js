// The settings sheet: sliders, switches and segmented controls built from
// SCHEMA in settings.js. Changes apply live.

import { SCHEMA } from './settings.js';

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export class SettingsPanel {
  /** custom: { key: (row) => void } builds the 'custom' rows. */
  constructor(sheet, settings, { onClose, custom = {} } = {}) {
    this.sheet = sheet;
    this.settings = settings;
    this.onClose = onClose;
    this.custom = custom;
    this.desktop = document.documentElement.classList.contains('desktop');
    this.mac = document.documentElement.classList.contains('mac');
    this.ios = document.documentElement.classList.contains('ios');
    this.controls = new Map();
    this.body = sheet.querySelector('.sheet-body');
    this.build();
    sheet.querySelector('[data-close]').addEventListener('click', () => this.close());
    sheet.querySelector('[data-reset]').addEventListener('click', () => settings.reset());
    sheet.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep sliders' arrow keys away from the player shortcuts
      if (e.key === 'Escape') this.close();
    });
    settings.subscribe((key, value) => {
      if (key === null) { for (const k of this.controls.keys()) this.sync(k); }
      else this.sync(key);
    });
  }

  get isOpen() { return !this.sheet.hidden; }

  open() {
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add('open'));
    this.sheet.querySelector('input, button')?.focus({ preventScroll: true });
  }

  close() {
    if (this.sheet.hidden) return;
    this.sheet.classList.remove('open');
    setTimeout(() => { if (!this.sheet.classList.contains('open')) this.sheet.hidden = true; }, 320);
    this.onClose?.();
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  build() {
    let group = null;
    for (const s of SCHEMA) {
      // Desktop-only rows; the iPhone app shows the ones marked ios.
      if (s.desktop && !this.desktop && !(s.ios && this.ios)) continue;
      if (s.mac && !this.mac) continue;
      if (s.ios === false && this.ios) continue;
      if (s.section) {
        this.body.appendChild(h('h3', 'sheet-section', (this.ios && s.iosSection) || s.section));
        group = h('div', 'sheet-group');
        this.body.appendChild(group);
        continue;
      }
      const row = h('div', `set-row set-${s.type}`);
      if (s.type === 'custom') {
        this.custom[s.key]?.(row);
        group.appendChild(row);
        continue;
      }
      const id = `set-${s.key}`;
      const label = h('label', 'set-label', (this.ios && s.iosLabel) || s.label);
      label.htmlFor = id;
      const head = h('div', 'set-head');
      head.appendChild(label);
      if (s.type === 'range') {
        const out = h('output', 'set-value');
        head.appendChild(out);
        row.appendChild(head);
        const input = h('input', 'set-slider');
        Object.assign(input, { type: 'range', id, min: s.min, max: s.max, step: s.step });
        input.addEventListener('input', () => this.settings.set(s.key, Number(input.value)));
        input.addEventListener('dblclick', () => this.settings.set(s.key, s.def));
        row.appendChild(input);
        this.controls.set(s.key, { s, input, out });
      } else if (s.type === 'toggle') {
        const input = h('input', 'set-switch');
        Object.assign(input, { type: 'checkbox', id });
        input.setAttribute('role', 'switch');
        input.addEventListener('change', () => this.settings.set(s.key, input.checked));
        head.appendChild(input);
        row.appendChild(head);
        this.controls.set(s.key, { s, input });
      } else if (s.type === 'text') {
        row.appendChild(head);
        const input = h('input', 'set-input');
        Object.assign(input, { type: s.secret ? 'password' : 'text', id, placeholder: s.placeholder || '', maxLength: s.max || 200, spellcheck: false, autocomplete: 'off' });
        let timer = 0;
        const commit = () => { clearTimeout(timer); this.settings.set(s.key, input.value.trim()); };
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(commit, 600); });
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); } });
        row.appendChild(input);
        this.controls.set(s.key, { s, input });
      } else if (s.type === 'choice') {
        row.appendChild(head);
        const seg = h('div', 'segmented');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', s.label);
        const buttons = s.options.map(([value, text]) => {
          const b = h('button', 'seg', text);
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.addEventListener('click', () => this.settings.set(s.key, value));
          seg.appendChild(b);
          return [value, b];
        });
        row.appendChild(seg);
        this.controls.set(s.key, { s, buttons });
      }
      const hint = (this.ios && s.iosHint) || s.hint;
      if (hint) row.appendChild(h('div', 'set-hint', hint));
      group.appendChild(row);
    }
  }

  sync(key) {
    const c = this.controls.get(key);
    if (!c) return;
    const v = this.settings.get(key);
    if (c.s.type === 'range') {
      c.input.value = String(v);
      c.out.textContent = c.s.fmt(v);
      const p = (v - c.s.min) / (c.s.max - c.s.min);
      c.input.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
    } else if (c.s.type === 'toggle') {
      c.input.checked = !!v;
    } else if (c.s.type === 'text') {
      if (document.activeElement !== c.input) c.input.value = v;
    } else if (c.s.type === 'choice') {
      for (const [value, b] of c.buttons) b.setAttribute('aria-checked', String(value === v));
    }
  }
}
