// Emoji reactions (Settings → Fun): when a word like "fire", "love" or
// "money" is sung, a few matching emoji float up the screen.

const WORDS = [
  [/^(love[sd]?|loving|lover|heart(s|beat)?)$/, ['❤️', '💖', '💕']],
  [/^(heartbreak|heartbroken|broken)$/, ['💔']],
  [/^(fire|flames?|burn(ing|s)?|hot|lit)$/, ['🔥']],
  [/^(money|cash|rich|dollars?|paid|bands|racks)$/, ['💸', '💰', '🤑']],
  [/^(gold(en)?|diamonds?|ice)$/, ['💎', '✨']],
  [/^(stars?|starlight|shine|shining|sparkle)$/, ['⭐', '✨', '🌟']],
  [/^(moon(light)?)$/, ['🌙']],
  [/^(sun(shine|light)?|summer)$/, ['☀️', '😎']],
  [/^(rain(ing|y)?|storm)$/, ['🌧️', '💧']],
  [/^(snow(ing)?|winter|cold)$/, ['❄️', '⛄']],
  [/^(ocean|sea|waves?|beach)$/, ['🌊', '🏖️']],
  [/^(dance|dancing|dancer|dancefloor)$/, ['💃', '🕺']],
  [/^(party|celebrate|birthday)$/, ['🎉', '🥳', '🎊']],
  [/^(cry(ing)?|tears?|cried)$/, ['😢', '💧']],
  [/^(kiss(es|ed|ing)?|lips)$/, ['💋', '😘']],
  [/^(flowers?|roses?|bloom)$/, ['🌹', '🌸']],
  [/^(fly(ing)?|flew|levitating|wings?|sky)$/, ['🕊️', '☁️']],
  [/^(angels?|heaven)$/, ['😇', '👼']],
  [/^(devil|hell|demons?)$/, ['😈']],
  [/^(king|queen|crown)$/, ['👑']],
  [/^(music|song|sing(ing)?|melody)$/, ['🎶', '🎵']],
  [/^(phone|call(ing|ed)?|text(ed)?)$/, ['📱']],
  [/^(twitter|tweet(s|ed)?|bird)$/, ['🐦']],
  [/^(car|drive|driving|ride)$/, ['🚗', '💨']],
  [/^(crazy|insane|wild)$/, ['🤪', '🌀']],
  [/^(night|midnight|tonight)$/, ['🌃', '🌙']],
  [/^(ghost)$/, ['👻']],
  [/^(cat|kitty)$/, ['🐱']],
  [/^(dog|puppy)$/, ['🐶']],
  [/^(pizza)$/, ['🍕']],
  [/^(coffee)$/, ['☕']],
  [/^(magic)$/, ['🪄', '✨']],
  [/^(world|earth)$/, ['🌍']],
  [/^(rocket|space)$/, ['🚀']],
  [/^(lol|haha|laugh(ing)?)$/, ['😂']],
];

const clean = (w) => w.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function emojiFor(word) {
  for (const [re, list] of WORDS) if (re.test(word)) return list;
  return null;
}

/** Sung-word events [{ t, emoji[] }] for a parsed lyrics model, by time. */
export function reactionEvents(model) {
  const out = [];
  const add = (words) => {
    for (const w of words || []) {
      for (const part of clean(w.text || '').split(' ')) {
        const list = part && emojiFor(part);
        if (list && Number.isFinite(w.begin)) out.push({ t: w.begin, emoji: list });
      }
    }
  };
  for (const line of model?.lines || []) {
    add(line.words?.length ? line.words : [{ text: line.text, begin: line.begin }]);
    if (line.background) add(line.background.words);
  }
  return out.sort((a, b) => a.t - b.t);
}

export class EmojiReactions {
  constructor() {
    this.on = false;
    this.events = [];
    this.next = 0;
    this.lastT = null;
    this.lastBurst = 0;
    this.layer = document.createElement('div');
    this.layer.className = 'emoji-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.layer);
  }

  setEnabled(on) {
    this.on = !!on;
    if (!this.on) this.layer.textContent = '';
  }

  setModel(model) {
    this.events = model && model.timing !== 'none' ? reactionEvents(model) : [];
    this.lastT = null;
  }

  update(t, playing) {
    if (!this.on || !this.events.length) { this.lastT = t; return; }
    // Seeking: start from the new place without a burst for everything skipped.
    if (this.lastT == null || t < this.lastT - 0.05 || t - this.lastT > 1) {
      this.next = this.events.findIndex((e) => e.t > t);
      if (this.next < 0) this.next = this.events.length;
      this.lastT = t;
      return;
    }
    this.lastT = t;
    while (this.next < this.events.length && this.events[this.next].t <= t) {
      const e = this.events[this.next++];
      if (playing && !document.hidden) this.burst(e.emoji);
    }
  }

  burst(list) {
    const now = performance.now();
    if (now - this.lastBurst < 350) return; // a busy chorus shouldn't flood the screen
    this.lastBurst = now;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = calm ? 1 : 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('span');
      el.className = 'emoji-float';
      el.textContent = list[Math.floor(Math.random() * list.length)];
      const s = el.style;
      s.left = `${8 + Math.random() * 84}%`;
      s.setProperty('--size', `${28 + Math.random() * 34}px`);
      s.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
      s.setProperty('--spin', `${(Math.random() - 0.5) * 70}deg`);
      s.setProperty('--dur', `${2.6 + Math.random() * 1.6}s`);
      s.animationDelay = `${i * 70}ms`;
      el.addEventListener('animationend', () => el.remove(), { once: true });
      this.layer.appendChild(el);
    }
    while (this.layer.childElementCount > 60) this.layer.firstChild.remove();
  }
}
