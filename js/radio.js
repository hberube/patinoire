// « Les Ondes de la Patinoire »: the morning radio show, as a compact player on the front page.
// data/radio.json + data/radio.mp3 come from scripts/radio.py (Hugo's PC, each morning).
// One audio element for the whole visit, kept outside the page's content, so the show keeps
// playing while visitors move between tabs; a floating mini player takes over whenever the
// front-page player is out of view (another tab, or scrolled away).
// Self-contained so it can be removed in one go; off switch: "features": {"radio": false}.
import { t, getLang } from "./i18n.js";
import { esc, asset } from "./util.js";

const HOST = { sylvie: "Sylvie", jean: "Jean" };
const clean = line => line.replace(/\[[a-z ]+\]\s*/gi, "");  // audio cues are for the voices only
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

let audio = null, show = null, playHorn = () => {}, started = false, inlineVisible = true, observer = null;

function controls(kind) {
  return `<button class="rd-play" data-rd="play" aria-label="${esc(t("radioPlay"))}">▶</button>
    <span class="rd-label">🎙️ <b>${esc(t("radioTitle"))}</b>${kind === "inline" ? ` <span class="muted">· ${esc(show.day)}</span>` : ""}</span>
    <input class="rd-seek" data-rd="seek" type="range" min="0" max="${show.duration || 1}" step="1" value="0" aria-label="${esc(t("radioSeek"))}">
    <span class="rd-time muted" data-rd="time">0:00 / ${mmss(show.duration || 0)}</span>`;
}

// Every player on the page (front page and floating) shows the same state
function sync() {
  if (!audio) return;
  const total = audio.duration && isFinite(audio.duration) ? audio.duration : show?.duration || 0;
  for (const el of document.querySelectorAll("[data-rd]")) {
    const what = el.dataset.rd;
    if (what === "play") { el.textContent = audio.paused ? "▶" : "❚❚"; el.setAttribute("aria-label", t(audio.paused ? "radioPlay" : "radioPause")); }
    if (what === "seek" && !el.matches(":active")) { el.max = Math.round(total) || 1; el.value = Math.floor(audio.currentTime); }
    if (what === "time") el.textContent = `${mmss(audio.currentTime)} / ${mmss(total)}`;
  }
  const mini = document.getElementById("radio-float");
  if (mini) mini.classList.toggle("show", started && !inlineVisible);
}

function bind(root) {
  root.querySelectorAll('[data-rd="play"]').forEach(b => b.addEventListener("click", toggle));
  root.querySelectorAll('[data-rd="seek"]').forEach(r => r.addEventListener("input", () => {
    audio.currentTime = Number(r.value);
    if (!started) { started = true; audio.play(); }
    sync();
  }));
}

function toggle() {
  if (!audio.paused) { audio.pause(); return; }
  if (!started) { started = true; playHorn(); setTimeout(() => audio.play(), 1600); sync(); }  // the horn is the jingle
  else audio.play();
}

function ensureAudio() {
  const src = asset(`data/radio.mp3?v=${encodeURIComponent(show.generatedAt)}`);  // same file name every day
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    for (const ev of ["play", "pause", "timeupdate", "loadedmetadata", "ended"]) audio.addEventListener(ev, sync);
  }
  if (audio.dataset.src !== src) { audio.src = src; audio.dataset.src = src; }
}

function floating() {
  let el = document.getElementById("radio-float");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "radio-float", className: "radio-float" });
    document.body.append(el);
  }
  el.innerHTML = `${controls("float")}<button class="rd-close" aria-label="${esc(t("close"))}">✕</button>`;
  bind(el);
  el.querySelector(".rd-close").addEventListener("click", () => { audio.pause(); audio.currentTime = 0; started = false; sync(); });
}

export function renderRadio(el, radio, deps) {
  // Only last night's show, like the recap (hidden once the evening after is over)
  const fresh = radio && Date.now() - new Date(`${radio.gameDay}T12:00:00`).getTime() < 36 * 3600 * 1000;
  if (!fresh || !radio.lines?.length) { el.innerHTML = ""; document.getElementById("radio-float")?.remove(); return; }
  show = { ...radio, day: deps.fmtDay(radio.gameDay, true) };
  playHorn = deps.playHorn;
  ensureAudio();
  el.innerHTML = `<div class="card radio-inline">
      <div class="rd-row">${controls("inline")}</div>
      <details class="rd-text"><summary>${esc(t("radioTranscript"))}${getLang() === "en" ? ` (${esc(t("radioFrench"))})` : ""}</summary>
        ${radio.lines.map(x => `<p><b>${esc(HOST[x.host] || x.host)} :</b> ${esc(clean(x.line))}</p>`).join("")}</details>
    </div>`;
  bind(el);
  floating();
  // The floating player shows only while the front-page one can't be seen
  observer?.disconnect();
  observer = new IntersectionObserver(([entry]) => { inlineVisible = entry.isIntersecting; sync(); });
  observer.observe(el.querySelector(".radio-inline"));
  sync();
}
