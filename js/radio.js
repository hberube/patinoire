// « Les Ondes de la Patinoire »: the morning radio show player, under "La une".
// data/radio.json + data/radio.mp3 come from scripts/radio.py (Hugo's PC, each morning).
// Self-contained so it can be removed in one go; off switch: "features": {"radio": false}.
import { t, getLang } from "./i18n.js";
import { esc } from "./util.js";

const HOST = { sylvie: "Sylvie", jean: "Jean" };
const clean = line => line.replace(/\[[a-z ]+\]\s*/gi, "");  // audio cues are for the voices only
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function renderRadio(el, radio, { fmtDay, playHorn }) {
  // Only last night's show, like the recap (hidden once the evening after is over)
  const fresh = radio && Date.now() - new Date(`${radio.gameDay}T12:00:00`).getTime() < 36 * 3600 * 1000;
  if (!fresh || !radio.lines?.length) { el.innerHTML = ""; return; }
  const src = `data/radio.mp3?v=${encodeURIComponent(radio.generatedAt)}`;  // same file name every day
  el.innerHTML = `
    <article class="card radio">
      <div class="radio-head">
        <button class="radio-play" aria-label="${esc(t("radioPlay"))}"><span class="rp-icon">▶</span></button>
        <div class="grow">
          <div class="radio-kicker">🎙️ ${esc(t("radioTitle"))} · ${esc(fmtDay(radio.gameDay, true))}</div>
          <div class="radio-bar"><span></span></div>
          <div class="radio-time muted"><span class="cur">0:00</span> / ${mmss(radio.duration || 0)}${getLang() === "en" ? ` · ${esc(t("radioFrench"))}` : ""}</div>
        </div>
      </div>
      <details class="radio-text"><summary>${esc(t("radioTranscript"))}</summary>
        ${radio.lines.map((x, i) => `<p data-i="${i}"><b>${esc(HOST[x.host] || x.host)} :</b> ${esc(clean(x.line))}</p>`).join("")}
      </details>
      <audio preload="none" src="${esc(src)}"></audio>
    </article>`;
  const audio = el.querySelector("audio"), btn = el.querySelector(".radio-play"), bar = el.querySelector(".radio-bar span");
  let started = false;
  btn.addEventListener("click", () => {
    if (!audio.paused) { audio.pause(); return; }
    if (!started) { started = true; playHorn(); setTimeout(() => audio.play(), 1800); }  // the horn is the jingle
    else audio.play();
  });
  audio.addEventListener("play", () => { btn.querySelector(".rp-icon").textContent = "❚❚"; btn.setAttribute("aria-label", t("radioPause")); });
  audio.addEventListener("pause", () => { btn.querySelector(".rp-icon").textContent = "▶"; btn.setAttribute("aria-label", t("radioPlay")); });
  audio.addEventListener("timeupdate", () => {
    const total = audio.duration || radio.duration || 1;
    bar.style.width = `${(100 * audio.currentTime) / total}%`;
    el.querySelector(".cur").textContent = mmss(audio.currentTime);
  });
  // Tap the bar to jump
  el.querySelector(".radio-bar").addEventListener("click", e => {
    const r = e.currentTarget.getBoundingClientRect(), total = audio.duration || radio.duration;
    if (total) { audio.currentTime = ((e.clientX - r.left) / r.width) * total; if (audio.paused) btn.click(); }
  });
}
