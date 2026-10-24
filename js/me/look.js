// Personal look (signed-in): your colour, your goal horn, your confetti. Kept in this browser.
//   - accent: the main colour of your logo (or photo), read on a small canvas, toned for light and dark;
//     it replaces the red on everything marked "yours" (cards, duels, alerts, rows)
//   - horn: 3 goal horns made with Web Audio (no sound files); the choice also applies to the TV mode
//   - confetti in your colours when one of your players scores, while the page is open
// Off switch: config.features.look. Hook: applyLook() in renderAll(), celebrate() in refreshLive().
import { t } from "../i18n.js";
import { esc } from "../util.js";

const HORN_KEY = "patinoire_horn_kind", CONFETTI_KEY = "patinoire_confetti";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const on = D => D.S.config.features?.look !== false;
export const HORNS = ["classic", "freighter", "organ"];
export const hornKind = () => (HORNS.includes(store.get(HORN_KEY)) ? store.get(HORN_KEY) : "classic");
const confettiOn = () => store.get(CONFETTI_KEY) !== "off";

// ---------- Accent colour from the logo ----------
let accentFor = null, accentHs = null;
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), s, l];
}

// The logo's dominant colourful hue: pixels are binned by hue, weighted by saturation, ignoring
// near-white, near-black and grey pixels (backgrounds, outlines). Null for a black-and-white logo.
function dominantHue(img) {
  const c = document.createElement("canvas"), n = 40;
  c.width = c.height = n;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n).data, bins = new Array(36).fill(0), sat = new Array(36).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
    if (s < 0.3 || l < 0.12 || l > 0.9) continue;
    bins[Math.floor(h / 10)] += s; sat[Math.floor(h / 10)] += s * s;
  }
  const best = bins.indexOf(Math.max(...bins));
  if (bins[best] < 12) return null;  // under ~1 % of the picture is colourful: keep the site red
  return [best * 10 + 5, Math.min(0.85, Math.max(0.45, sat[best] / bins[best]))];
}

export function applyLook(D) {
  const root = document.documentElement, id = D.me()?.participantId;
  if (!id || !on(D)) { root.classList.remove("me-tinted"); accentFor = null; return; }
  if (accentFor === id) return root.classList.toggle("me-tinted", !!accentHs);
  accentFor = id; accentHs = null;
  const src = D.S.logos[id]?.logo || D.S.logos[id]?.face;
  if (!src) return;
  const img = new Image();
  img.onload = () => {
    if (accentFor !== id) return;
    try { accentHs = dominantHue(img); } catch { accentHs = null; }
    if (!accentHs) return;
    root.style.setProperty("--me-h", accentHs[0]);
    root.style.setProperty("--me-s", `${Math.round(accentHs[1] * 100)}%`);
    root.classList.add("me-tinted");
  };
  img.src = src;
}
export const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue("--me-acc").trim() || "#c8102e";

// ---------- Goal horns ----------
// classic: the original F-major arena horn; freighter: a deep two-tone ship horn; organ: the
// arena organ's "da-da-da-DAAA"
export function hornSound(audio, kind = hornKind()) {
  const now = audio.currentTime, out = audio.createGain(), lp = audio.createBiquadFilter();
  lp.type = "lowpass";
  lp.connect(out).connect(audio.destination);
  const tone = (f, type, start, stop) => {
    const o = audio.createOscillator();
    o.type = type; o.frequency.value = f;
    o.connect(lp); o.start(now + start); o.stop(now + stop);
    return o;
  };
  out.gain.setValueAtTime(0.0001, now);
  if (kind === "freighter") {
    lp.frequency.value = 700;
    out.gain.exponentialRampToValueAtTime(0.3, now + 0.25);
    out.gain.setValueAtTime(0.3, now + 2.2);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 3);
    for (const f of [87.3, 110, 130.8]) {
      const o = tone(f, "sawtooth", 0, 3.1), lfo = audio.createOscillator(), depth = audio.createGain();
      lfo.frequency.value = 5; depth.gain.value = f * 0.006;  // a slight wobble, like a real horn
      lfo.connect(depth).connect(o.frequency); lfo.start(now); lfo.stop(now + 3.1);
    }
  } else if (kind === "organ") {
    lp.frequency.value = 2600;
    out.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    out.gain.setValueAtTime(0.18, now + 1.6);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    [[523.3, 0], [659.3, 0.18], [784, 0.36], [1046.5, 0.54]].forEach(([f, at], i) => {
      const end = i === 3 ? 2.3 : at + 0.16;
      tone(f, "square", at, end); tone(f / 2, "triangle", at, end);
    });
  } else {
    lp.frequency.value = 1400;
    out.gain.exponentialRampToValueAtTime(0.25, now + 0.08);
    out.gain.setValueAtTime(0.25, now + 1.5);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    for (const f of [174.6, 220, 261.6]) tone(f, "sawtooth", 0, 2.3);  // F major chord, like an arena horn
  }
}

// ---------- Confetti ----------
export function confetti(colors) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = Object.assign(document.createElement("canvas"), { className: "me-confetti" });
  c.setAttribute("aria-hidden", "true");
  document.body.append(c);
  const dpr = devicePixelRatio || 1, W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr, ctx = c.getContext("2d");
  const bits = Array.from({ length: 140 }, (_, i) => ({
    x: W * (i % 2 ? 0.1 : 0.9), y: H * 0.9, vx: (i % 2 ? 1 : -1) * (2 + Math.random() * 9) * dpr, vy: -(10 + Math.random() * 12) * dpr,
    r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, w: (5 + Math.random() * 6) * dpr, h: (3 + Math.random() * 4) * dpr,
    color: colors[i % colors.length],
  }));
  const start = performance.now();
  (function frame(now) {
    const age = now - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1800) / 700);
    for (const b of bits) {
      b.vy += 0.35 * dpr; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2))); ctx.restore();
    }
    age < 2500 ? requestAnimationFrame(frame) : c.remove();
  })(start);
}

// Called by refreshLive() with the new pool goals: confetti when one of them is yours
export function celebrate(goals, D) {
  const s = D.standingOf(D.me()?.participantId);
  if (!s || !on(D) || !confettiOn() || !goals?.some(g => s.rosterStats.some(p => p.id === g.id))) return;
  confetti([accentColor(), "#ffffff", "#f5b301", accentColor()]);
}

// ---------- The "Mon look" settings, at the bottom of Pour toi ----------
export function lookHtml(D) {
  if (!on(D)) return "";
  const kind = hornKind();
  return `<details class="me-sec me-look"><summary class="me-h">🎨 ${esc(t("meLook"))}</summary>
    <p class="me-small">${esc(t("meLookHint"))}</p>
    <div class="me-look-row"><span class="me-small">${esc(t("meHorn"))}</span>
      ${HORNS.map(k => `<button type="button" class="btn btn-sm" data-horn="${k}" aria-pressed="${k === kind}">${esc(t(`meHorn_${k}`))}</button>`).join("")}</div>
    <div class="me-look-row"><span class="me-small">${esc(t("meConfetti"))}</span>
      <button type="button" class="btn btn-sm" data-confetti aria-pressed="${confettiOn()}">${esc(t(confettiOn() ? "meConfettiOn" : "meConfettiOff"))}</button></div>
  </details>`;
}

// Wires the settings; playHorn is the app's own (it unlocks audio and checks the horn choice)
export function bindLook(el, D, playHorn) {
  const box = el.querySelector(".me-look");
  if (!box) return;
  box.addEventListener("click", e => {
    const horn = e.target.closest("[data-horn]");
    if (horn) {
      store.set(HORN_KEY, horn.dataset.horn);
      box.querySelectorAll("[data-horn]").forEach(b => b.setAttribute("aria-pressed", String(b === horn)));
      playHorn(horn.dataset.horn);
    }
    const conf = e.target.closest("[data-confetti]");
    if (conf) {
      store.set(CONFETTI_KEY, confettiOn() ? "off" : "on");
      conf.setAttribute("aria-pressed", String(confettiOn()));
      conf.textContent = t(confettiOn() ? "meConfettiOn" : "meConfettiOff");
      if (confettiOn()) confetti([accentColor(), "#ffffff", "#f5b301", accentColor()]);
    }
  });
}
