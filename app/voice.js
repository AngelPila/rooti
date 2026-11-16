// Rooti's voice: the server's Edge voice (the one it has on WhatsApp), fetched in the background as soon as a text
// shows, so the speaker button plays from memory. The browser's own voice is the fallback, since many phones and Linux
// browsers have no Spanish voice and stay silent.
const SILENCE = "data:audio/wav;base64,UklGRuYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgATElTVBoAAABJTkZPSVNGVA0AAABMYXZmNjMuMS4xMDIAAGRhdGGgAAAAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
const KEEP = 30;

export function createVoice({ lang, base, fallback, stopFallback }) {
  const player = new Audio(), ready = new Map();
  let on = false, turn = 0, soonTimer = 0;
  const key = (text) => `${lang()}|${text}`;
  const url = (text) => `${base()}/api/rooti/say?lang=${lang()}&text=${encodeURIComponent(text)}`;

  function warm(text) {
    if (!on || !text || ready.has(key(text))) return;
    const entry = { src: null };
    ready.set(key(text), entry);
    fetch(url(text)).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) entry.src = URL.createObjectURL(b); else ready.delete(key(text)); })
      .catch(() => ready.delete(key(text)));
    if (ready.size > KEEP) {
      const [old, e] = ready.entries().next().value;
      if (e.src && player.src !== e.src) URL.revokeObjectURL(e.src);
      ready.delete(old);
    }
  }
  // For text that changes while the farmer moves a slider: fetch only the one they stop on
  function soon(text) { clearTimeout(soonTimer); soonTimer = setTimeout(() => warm(text), 1200); }

  // iOS only lets a page play sound later (after an await) from an element it played during a tap
  function unlock() { if (!player.src) { player.src = SILENCE; player.play().catch(() => {}); } }
  function hush() { turn++; player.pause(); stopFallback(); }
  function say(text) {
    hush();
    const mine = turn;
    if (!on) return fallback(text);
    // Downloaded already: plays at once. Otherwise the audio element streams it, joining a download still running
    player.src = ready.get(key(text))?.src || url(text);
    player.play().catch((e) => { if (mine === turn) { console.warn("rooti: voice", e); fallback(text); } });
    warm(text);
  }

  return { warm, soon, say, hush, unlock, enable(v) { on = !!v; } };
}
