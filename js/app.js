import { t, getLang, setLang, applyStatic, fmtDate, locale } from "./i18n.js";
import { esc, fetchJson, headshot, teamLogo } from "./util.js";
import { getSession, login, logout } from "./auth.js";
import { windowOpen, tradesLeft, roundOptions, encodeTrade } from "./trade.js";
import { renderChart } from "./chart.js";
import { prepareImage } from "./image.js";
import { faqContent } from "./faq.js";
import { seededShuffle, makeCard, evaluate, race } from "./bingo.js";

const S = {
  tab: "standings",
  chartPicks: null,
  trade: { outId: null, inId: null, code: null },
};
const TABS = ["standings", "gazette", "teams", "chart", "tonight", "bingo", "trades", "faq"];
const POS_ICON = { F: "🏒", D: "🛡️", G: "🥅" };

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  bindChrome();
  try {
    const opt = p => fetchJson(p).catch(() => null);
    [S.config, S.board, S.history, S.live, S.groups, S.trades, S.index, S.logos, S.insights, S.recap] = await Promise.all([
      fetchJson("data/config.json"), fetchJson("data/leaderboard.json"), opt("data/history.json"),
      fetchLive(), fetchJson("data/groups.json"), opt("data/trades_history.json"),
      opt("data/players_index.json"), opt("data/logos.json"), opt("data/insights.json"), opt("data/recap.json"),
    ]);
  } catch (err) {
    document.querySelector("main").innerHTML = `<div class="card empty">${esc(t("loadError"))}</div>`;
    return;
  }
  S.trades ||= [];
  S.logos ||= {};
  S.pointsById = new Map((S.index || []).map(p => [p.id, p.points]));
  S.owners = new Map();
  for (const s of S.board.standings) for (const p of s.rosterStats) S.owners.set(p.id, (S.owners.get(p.id) || 0) + 1);
  showTab(location.hash.slice(1));
  renderAll();
  // Live scores: refresh every 2 minutes while the page is visible
  setInterval(refreshLive, 120000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshLive(); });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { fitTopbar(); if (S.tab === "chart") renderTrajectory(); }, 150);
  });
});

// live.json lives on the `live` branch (updated every 2 min on game nights without rebuilding
// the site). GitHub's API serves it fresh but allows 60 requests/hour per network; the raw file
// server has no such limit but can lag up to 5 minutes. Locally, data/live.json is used.
async function fetchLive() {
  if (location.hostname.endsWith(".github.io")) {
    const owner = location.hostname.split(".")[0], repo = location.pathname.split("/")[1];
    const sources = [
      [`https://api.github.com/repos/${owner}/${repo}/contents/live.json?ref=live`, { headers: { Accept: "application/vnd.github.raw" } }],
      [`https://raw.githubusercontent.com/${owner}/${repo}/live/live.json`, {}],
    ];
    for (const [url, opts] of sources) {
      try {
        const res = await fetch(url, { cache: "no-store", ...opts });
        if (res.ok) return await res.json();
      } catch { /* try the next source */ }
    }
    return null;
  }
  return fetchJson("data/live.json").catch(() => null);
}

let liveBusy = false;
async function refreshLive() {
  if (liveBusy || document.visibilityState !== "visible" || !S.board) return;
  liveBusy = true;
  try {
    const live = await fetchLive();
    if (live && live.updated !== S.live?.updated) {
      const goals = newPoolGoals(S.live, live), bingo = bingoNews(S.live, live);
      S.live = live;
      renderTonight();
      renderBingo();
      // Bingo news first (it's yours), then the goals; one tap opens the matching tab
      const parts = [bingo, goals.length && goalRows(goals)].filter(Boolean);
      if (parts.length) showToast(parts.join(""), bingo ? "bingo" : "tonight");
    }
  } finally { liveBusy = false; }
}

// ---------- Goal alert: banner (and optional horn) when a refresh brings new pool goals ----------
const HORN_KEY = "patinoire_goal_horn";
const hornOn = () => { try { return localStorage.getItem(HORN_KEY) === "on"; } catch { return false; } };

function newPoolGoals(before, after) {
  if (!before || before.gameDay !== after.gameDay) return [];  // first load or a new night: nothing is "new"
  const out = [];
  for (const [id, line] of Object.entries(after.players || {})) {
    const n = line.goals - (before.players?.[id]?.goals || 0);
    if (n > 0 && S.owners.has(Number(id))) out.push({ id: Number(id), n });
  }
  return out;
}

function showToast(html, tab) {
  let box = document.getElementById("goal-toast");
  if (!box) {
    box = Object.assign(document.createElement("div"), { id: "goal-toast", role: "status" });
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  box.innerHTML = `<button class="goal-toast" title="${esc(t(tab))}">${html}</button>`;
  box.querySelector("button").addEventListener("click", () => { box.innerHTML = ""; showTab(tab); });
  clearTimeout(box.timer);
  box.timer = setTimeout(() => { box.innerHTML = ""; }, 15000);
  if (hornOn()) playHorn();
}

function goalRows(goals) {
  const mine = me()?.participantId, N = S.board.standings.length;
  const playerOf = id => S.board.standings.flatMap(s => s.rosterStats).find(p => p.id === id);
  const ownersOf = id => S.board.standings.filter(s => s.rosterStats.some(p => p.id === id));
  // Your players first, then the most-owned
  goals.sort((a, b) => ownersOf(b.id).some(s => s.participantId === mine) - ownersOf(a.id).some(s => s.participantId === mine)
    || ownersOf(b.id).length - ownersOf(a.id).length);
  const shown = goals.slice(0, 3);
  return `${shown.map(g => {
      const p = playerOf(g.id), owners = ownersOf(g.id), isMine = owners.some(s => s.participantId === mine);
      const names = owners.map(s => s.teamName);
      const who = owners.length === N ? t("goalForAll", { n: g.n })
        : owners.length > 4 ? t("goalForMany", { n: g.n, k: owners.length })
        : t("goalFor", { n: g.n, teams: names.length > 3 ? t("andMore", { list: names.slice(0, 2).join(", "), n: names.length - 2 }) : names.join(", ") });
      return `<span class="gt-row ${isMine ? "mine" : ""}">${mug(p, "mug mug-sm")}
        <span class="grow"><b>🚨 ${esc(t("goalAlert", { name: p.name, team: p.team }))}${g.n > 1 ? ` ×${g.n}` : ""}</b>
          <span class="gt-sub">${isMine ? `<b>${esc(t("goalMine"))}</b> ` : ""}${esc(who)}</span></span></span>`;
    }).join("")}
    ${goals.length > 3 ? `<span class="gt-sub">${esc(t("moreGoals", { n: goals.length - 3 }))}</span>` : ""}`;
}

// A short goal horn made on the fly (no sound file); browsers only allow it after a tap on the page,
// which turning the horn on provides
let audio;
function playHorn() {
  try {
    audio ||= new AudioContext();
    audio.resume();
    const now = audio.currentTime, out = audio.createGain(), lp = audio.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 1400;
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.25, now + 0.08);
    out.gain.setValueAtTime(0.25, now + 1.5);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    lp.connect(out).connect(audio.destination);
    for (const f of [174.6, 220, 261.6]) {  // F major chord, like an arena horn
      const o = audio.createOscillator();
      o.type = "sawtooth"; o.frequency.value = f;
      o.connect(lp); o.start(now); o.stop(now + 2.3);
    }
  } catch { /* no Web Audio: banner only */ }
}

function renderHornToggle() {
  const btn = document.getElementById("horn-toggle");
  if (!btn) return;  // tolerate a cached older index.html right after a deploy
  btn.hidden = false;
  btn.textContent = t(hornOn() ? "hornOn" : "hornOff");
  btn.title = t("hornHint");
  btn.setAttribute("aria-pressed", String(hornOn()));
  btn.onclick = () => {
    try { localStorage.setItem(HORN_KEY, hornOn() ? "off" : "on"); } catch { /* private mode */ }
    if (hornOn()) playHorn();  // a sample, and unlocks audio for later alerts
    renderHornToggle();
  };
}

function bindChrome() {
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.querySelector(".tabs").addEventListener("scroll", updateTabFade, { passive: true });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
  document.getElementById("btn-lang").addEventListener("click", () => {
    setLang(getLang() === "fr" ? "en" : "fr");
    renderAll();
  });
  const modal = document.getElementById("login-modal");
  document.getElementById("login-cancel").addEventListener("click", () => modal.close());
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("login-submit"), err = document.getElementById("login-error");
    btn.disabled = true; err.textContent = "";
    const session = await login(document.getElementById("login-user").value, document.getElementById("login-pin").value)
      .catch(() => null);
    btn.disabled = false;
    if (!session) { err.textContent = t("badPin"); return; }
    modal.close();
    renderAll();
  });
  for (const d of document.querySelectorAll("dialog")) {
    d.addEventListener("click", e => { if (e.target === d) d.close(); });  // click backdrop to close
  }
}

// On computers nothing in the top bar may hide off-screen (a mouse can't swipe the tab row):
// if the tabs don't fit beside the buttons (e.g. logged in as admin), drop the icons and the
// name chip, and if that's still not enough, let the tabs wrap onto a second line.
// Phones keep their own swipeable tab row (see the 720px rules in style.css).
function fitTopbar() {
  const bar = document.querySelector(".topbar"), tabs = document.querySelector(".tabs");
  if (!bar || !tabs) return;
  bar.classList.remove("compact", "wrap");
  if (window.matchMedia("(max-width: 720px)").matches) return;
  const overflows = () => tabs.scrollWidth > tabs.clientWidth + 1;
  if (overflows()) bar.classList.add("compact");
  if (overflows()) bar.classList.add("wrap");
}

// The fade on the tab bar's right edge hints "more tabs"; drop it once scrolled to the end
function updateTabFade() {
  const bar = document.querySelector(".tabs");
  if (bar) bar.classList.toggle("at-end", bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4);
}

function showTab(tab) {
  S.tab = TABS.includes(tab) ? tab : "standings";
  if (location.hash.slice(1) !== S.tab) history.replaceState(null, "", `#${S.tab}`);
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  // Keep the active tab visible in the sideways-scrolling tab bar on phones
  // (next frame, once the translated labels have their final widths)
  requestAnimationFrame(() => {
    const tab = document.querySelector(`.tab[data-tab="${S.tab}"]`), bar = tab?.parentElement;
    if (bar) bar.scrollLeft = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
    updateTabFade();
  });
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${S.tab}`));
  if (S.tab === "chart" && S.board) renderTrajectory();
}

function renderAll() {
  applyStatic();
  document.getElementById("btn-lang").textContent = getLang() === "fr" ? "EN" : "FR";
  document.getElementById("pool-name").textContent = S.config.poolName || "Le Pool à Hugo";
  document.title = S.config.poolName || "Le Pool à Hugo";
  const stamp = fmtDate(S.board.lastUpdated, { dateStyle: "medium", timeStyle: "short" });
  for (const id of ["last-updated", "last-updated-m"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = stamp;  // tolerate a cached older index.html right after a deploy
  }
  renderAuth();
  fitTopbar();
  document.fonts?.ready.then(fitTopbar);  // widths change once the web font arrives
  renderRecap();
  renderStandings();
  renderTeams();
  if (S.tab === "chart") renderTrajectory();
  renderTonight();
  renderBingo();
  renderGazette();
  renderFaq();
  renderTrades();
}

// ---------- Helpers ----------
const me = () => getSession();
const standingOf = id => S.board.standings.find(s => s.participantId === id);
const fmtDay = (iso, long) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(),
  long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
const posLabel = pos => t({ F: "posF", D: "posD", G: "posG" }[pos]);

function mug(p, cls = "mug") {
  return `<img class="${cls}" src="${headshot(p.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

function logo(abbrev) {
  return abbrev ? `<img class="logo" src="${teamLogo(abbrev)}" alt="${esc(abbrev)}" title="${esc(abbrev)}" loading="lazy" onerror="this.remove()">` : "";
}

// Avatars combine the owner's face (round) and the team logo (rounded square):
//   "team"   logo first, face in a corner bubble (standings, team cards)
//   "face"   face first, logo in a corner bubble (podium, team window, my team)
//   "person" face only (small stacks)
//   "logo"   team logo only (standings table)
// Coloured initials when there's no image.
function avatar(s, cls = "av", mode = "team") {
  return avatarFrom(S.logos[s.participantId] || {}, s, cls, mode);
}

function avatarFrom(imgs, s, cls, mode = "team") {
  const { face, logo } = imgs;
  const main = mode === "logo" ? logo : mode === "team" ? logo || face : face || logo;
  if (!main) {
    const initials = s.participantName.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
    let hue = 0;
    for (const ch of s.participantId) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="${cls} av-initials" style="--h:${hue}" aria-hidden="true">${esc(initials)}</span>`;
  }
  const shape = main === face ? "round" : "square";
  const other = main === face ? logo : face;
  const badge = (mode === "team" || mode === "face") && other
    ? `<img class="badge ${other === face ? "round" : "square"}" src="${esc(other)}" alt="" loading="lazy">` : "";
  return `<span class="${cls} avs ${shape}"><img class="main" src="${esc(main)}" alt="" loading="lazy">${badge}</span>`;
}

function dayDeltas() {
  const h = S.history;
  if (!h || h.dates.length < 2) return {};
  const out = {};
  for (const [id, vals] of Object.entries(h.series)) {
    const a = vals[vals.length - 1], b = vals[vals.length - 2];
    if (a != null && b != null) out[id] = a - b;
  }
  return out;
}

function gainOver(days) {
  const h = S.history;
  if (!h || h.dates.length < 2) return {};
  const out = {};
  for (const [id, vals] of Object.entries(h.series)) {
    const end = vals[vals.length - 1], start = vals[Math.max(0, vals.length - 1 - days)];
    if (end != null && start != null) out[id] = end - start;
  }
  return out;
}

// ---------- Auth ----------
function renderAuth() {
  const box = document.getElementById("auth-controls"), session = me();
  if (session) {
    box.innerHTML = `
      <span class="user-chip">${esc(session.displayName)}</span>
      ${session.role === "admin" ? `<a class="btn btn-sm" href="admin/">${esc(t("admin"))}</a>` : ""}
      <button class="btn btn-sm" id="btn-logout">${esc(t("logout"))}</button>`;
    box.querySelector("#btn-logout").addEventListener("click", () => { logout(); renderAll(); });
  } else {
    box.innerHTML = `<button class="btn btn-sm btn-primary" id="btn-login">${esc(t("login"))}</button>`;
    box.querySelector("#btn-login").addEventListener("click", openLogin);
  }
}

function openLogin() {
  const select = document.getElementById("login-user");
  const people = [...S.board.standings].sort((a, b) => a.participantName.localeCompare(b.participantName, "fr"));
  select.innerHTML = people.map(s => `<option value="${esc(s.participantId)}">${esc(s.participantName)} — ${esc(s.teamName)}</option>`).join("");
  document.getElementById("login-pin").value = "";
  document.getElementById("login-error").textContent = "";
  document.getElementById("login-modal").showModal();
}

// ---------- Morning recap ("La une", written by scripts/recap.py) ----------
// Holds the game day whose recap this visitor collapsed (key name kept from the old ✕ button,
// so anyone who closed today's recap now sees it collapsed instead). A new recap opens again.
const RECAP_KEY = "patinoire_recap_closed";

function renderRecap() {
  const el = document.getElementById("recap"), r = S.recap, text = r?.[getLang()];
  if (!el) return;  // tolerate a cached older index.html right after a deploy
  // Only last night's recap: hide it once the evening after is over (~36 h after the game day's noon)
  const fresh = r && Date.now() - new Date(`${r.gameDay}T12:00:00`).getTime() < 36 * 3600 * 1000;
  if (!text || !fresh) { el.innerHTML = ""; return; }
  let collapsed = false;
  try { collapsed = localStorage.getItem(RECAP_KEY) === r.gameDay; } catch { /* private mode */ }
  const img = r.image?.[getLang()];
  const src = img && `${img.src}?v=${encodeURIComponent(r.generatedAt)}`;  // same file name every day
  el.innerHTML = `
    <article class="card recap${img ? " has-img" : ""}">
      <button class="recap-head" aria-expanded="true">
        <span class="recap-kicker">📰 ${esc(t("recapTitle"))} · ${esc(fmtDay(r.gameDay, true))}</span>
        <span class="recap-title">${esc(text.title)}</span>
        <span class="recap-toggle" aria-hidden="true"></span>
      </button>
      <div class="recap-body">
        <ul class="recap-list">${text.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
        ${img ? `<a class="recap-img" href="${esc(src)}" target="_blank" rel="noopener">
          <img src="${esc(src)}" alt="${esc(img.alt)}" width="720" height="720" onerror="this.parentElement.remove()"></a>` : ""}
      </div>
    </article>`;
  const card = el.querySelector(".recap"), head = card.querySelector(".recap-head");
  const show = isCollapsed => {
    card.classList.toggle("collapsed", isCollapsed);
    head.setAttribute("aria-expanded", String(!isCollapsed));
    head.title = t(isCollapsed ? "expand" : "collapse");
  };
  show(collapsed);
  head.addEventListener("click", () => {
    const now = !card.classList.contains("collapsed");
    try { now ? localStorage.setItem(RECAP_KEY, r.gameDay) : localStorage.removeItem(RECAP_KEY); } catch { /* private mode */ }
    show(now);
  });
}

// ---------- Standings ----------
// Chances of winning (insights.json, from scripts/odds.py)
const pct = v => v >= 99.5 ? ">99" : v >= 1 ? String(Math.round(v)) : v > 0 ? "<1" : "0";
const fmtPct = v => `${pct(v)}${getLang() === "fr" ? "\u00a0%" : "%"}`;

function oddsCell(id) {
  const o = S.insights.odds.teams[id], before = S.insights.odds.before?.[id];
  if (!o) return "—";
  const move = before == null ? 0 : Math.round(o.win - before);
  return `<span class="odds">${fmtPct(o.win)}</span>${move ? `<span class="move ${move > 0 ? "up" : "down"}" title="${esc(t("oddsMove",
    { d: `${move > 0 ? "+" : "−"}${Math.abs(move)}` }))}">${move > 0 ? "▲" : "▼"}${Math.abs(move)}</span>` : ""}`;
}

function renderStandings() {
  const st = S.board.standings, deltas = dayDeltas(), mine = me()?.participantId;
  const odds = S.insights?.odds?.teams && Object.keys(S.insights.odds.teams).length ? S.insights.odds : null;
  const medals = ["🥇", "🥈", "🥉"], cls = ["first", "second", "third"];
  const podium = st.slice(0, 3).map((s, i) => ({ s, i }));
  // Visual podium order on wide screens: 2nd, 1st, 3rd
  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;
  document.getElementById("podium").innerHTML = order.map(({ s, i }) => `
    <button class="card step ${cls[i]}" data-team="${esc(s.participantId)}">
      <div class="av-wrap">${avatar(s, "av av-xl", "face")}<span class="medal">${medals[i]}</span></div>
      <div><div class="team">${esc(s.teamName)}</div><div class="who">${esc(s.participantName)}</div></div>
      <div class="pts num" data-count="${s.totalPoints}">${s.totalPoints}</div>
    </button>`).join("");

  // Awards
  const awards = [];
  const bestDay = Object.entries(deltas).sort((a, b) => b[1] - a[1])[0];
  if (bestDay && bestDay[1] > 0) {
    const s = standingOf(bestDay[0]);
    awards.push(["🔥", t("awardBestDay"), s.teamName, t("ptsIn", { n: bestDay[1], when: fmtDay(S.history.dates.at(-1)) })]);
  }
  const hot = Object.entries(gainOver(7)).sort((a, b) => b[1] - a[1])[0];
  if (hot && hot[1] > 0) {
    awards.push(["📈", t("awardHot"), standingOf(hot[0]).teamName, t("ptsLast7", { n: hot[1] })]);
  }
  const mvp = st.flatMap(s => s.rosterStats).sort((a, b) => b.stats.points - a.stats.points)[0];
  if (mvp) awards.push(["⭐", t("awardMvp"), mvp.name, t("mvpSub", { n: mvp.stats.points, k: S.owners.get(mvp.id) })]);
  document.getElementById("awards").innerHTML = awards.map(([icon, label, value, sub]) => `
    <div class="card award"><div class="icon">${icon}</div>
      <div><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>
    </div>`).join("");

  document.getElementById("standings-table").innerHTML = `
    <thead><tr>
      <th class="l">${esc(t("rank"))}</th><th class="l">${esc(t("team"))}</th>
      <th class="opt" title="${esc(t("goalsLong"))}">${esc(t("goals"))}</th>
      <th class="opt" title="${esc(t("assistsLong"))}">${esc(t("assists"))}</th>
      <th class="opt" title="${esc(t("winsLong"))}">${esc(t("wins"))}</th>
      <th class="opt spark-col">${esc(t("trend"))}</th><th class="opt">${esc(t("gapLeader"))}</th><th>${esc(t("yesterdayShort"))}</th>
      ${odds ? `<th class="odds-col" title="${esc(t("oddsLong"))}">${esc(t("oddsShort"))}</th>` : ""}<th>${esc(t("pts"))}</th>
    </tr></thead>
    <tbody>${st.map(s => {
      const mv = s.previousRank ? s.previousRank - s.rank : 0;
      const d = deltas[s.participantId];
      return `<tr class="clickable ${s.participantId === mine ? "me" : ""}" data-team="${esc(s.participantId)}" tabindex="0">
        <td class="l rank num">${s.rank}${mv ? `<span class="move ${mv > 0 ? "up" : "down"}">${mv > 0 ? "▲" : "▼"}${Math.abs(mv)}</span>` : ""}</td>
        <td class="l team-cell"><div class="team-flex">${avatar(s, "av av-row", "logo")}<div><div class="name">${esc(s.teamName)}</div><div class="who">${esc(s.participantName)}</div></div></div></td>
        <td class="opt num">${s.totalGoals}</td><td class="opt num">${s.totalAssists}</td><td class="opt num">${s.goalieWins}</td>
        <td class="opt spark-col">${sparkline(S.history?.series[s.participantId])}</td>
        <td class="opt num muted">${s.rank === 1 ? "—" : `−${st[0].totalPoints - s.totalPoints}`}</td>
        <td class="num"><span class="delta ${d ? "" : "zero"}">${d == null ? "—" : d > 0 ? `+${d}` : d}</span></td>
        ${odds ? `<td class="num odds-col">${oddsCell(s.participantId)}</td>` : ""}
        <td class="pts-cell num"><span data-count="${s.totalPoints}">${s.totalPoints}</span>${odds?.teams[s.participantId]
          ? `<span class="odds-sub" title="${esc(t("oddsLong"))}">🏆 ${fmtPct(odds.teams[s.participantId].win)}</span>` : ""}</td>
      </tr>`;
    }).join("")}</tbody>`;
  bindTeamOpeners(document.getElementById("panel-standings"));
  if (!S.counted) { S.counted = true; countUp(document.getElementById("panel-standings")); }
}

// Numbers roll up from 0 on first load (skipped for reduced-motion users)
function countUp(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const els = [...root.querySelectorAll("[data-count]")];
  const start = performance.now(), dur = 900;
  const tick = now => {
    const k = Math.min(1, (now - start) / dur), ease = 1 - Math.pow(1 - k, 3);
    for (const el of els) el.textContent = Math.round(Number(el.dataset.count) * ease);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Last 14 game days of cumulative points, scaled per row so the shape (slope) is what reads
function sparkline(vals) {
  const v = (vals || []).filter(x => x != null).slice(-14);
  if (v.length < 2) return "";
  const W = 110, H = 28, min = v[0], max = Math.max(...v), span = Math.max(1, max - min);
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((x - min) / span) * (H - 6)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${pts.join(" ")}"/><circle cx="${pts.at(-1).split(",")[0]}" cy="${pts.at(-1).split(",")[1]}" r="2.5"/></svg>`;
}

function bindTeamOpeners(root) {
  root.querySelectorAll("[data-team]").forEach(el => {
    el.addEventListener("click", () => openTeam(el.dataset.team));
    el.addEventListener("keydown", e => { if (e.key === "Enter") openTeam(el.dataset.team); });
  });
}

// ---------- Teams ----------
function renderTeams() {
  const mine = me()?.participantId;
  renderMyTeam();
  const list = [...S.board.standings].sort((a, b) => (b.participantId === mine) - (a.participantId === mine) || a.rank - b.rank);
  document.getElementById("teams-grid").innerHTML = list.map(s => {
    // "Edge" players: points weighted by how few other teams own them
    const N = S.board.standings.length;
    const edge = p => p.stats.points * (N - (S.owners.get(p.id) || 1)) / N;
    const stars = [...s.rosterStats].sort((a, b) => edge(b) - edge(a) || b.stats.points - a.stats.points).slice(0, 3);
    const unique = s.rosterStats.filter(p => S.owners.get(p.id) === 1).length;
    return `<button class="card team-card" data-team="${esc(s.participantId)}">
      <div class="top">
        <div class="team-flex">${avatar(s, "av av-lg", "team")}<div><div class="rk">#${s.rank}${s.participantId === mine ? ` · ${esc(t("myTeam"))}` : ""}</div>
          <div style="font-weight:700;line-height:1.25">${esc(s.teamName)}</div>
          <div class="muted" style="font-size:13px">${esc(s.participantName)}</div></div></div>
        <div class="pts num">${s.totalPoints}</div>
      </div>
      <div class="edge-label">${esc(t("edgePlayers"))}</div>
      <div class="stars">${stars.map(p => `<div class="star" title="${esc(`${p.name} · ${t("ownedBy", { n: S.owners.get(p.id) })}`)}">${mug(p, "mug mug-sm")}<span class="sn">${esc(p.name.split(" ").slice(-1)[0])}</span><b class="num">${p.stats.points}</b><span class="own">×${S.owners.get(p.id)}</span></div>`).join("")}</div>
      <div class="card-foot">${unique ? `<span class="tag unique">★ ${esc(t(unique === 1 ? "uniqueOne" : "uniqueCount", { n: unique }))}</span>` : `<span class="muted">${esc(t("noUnique"))}</span>`}</div>
    </button>`;
  }).join("");
  bindTeamOpeners(document.getElementById("panel-teams"));
}

function renderMyTeam() {
  const el = document.getElementById("my-team"), s = standingOf(me()?.participantId);
  if (!s) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="card card-pad my-team">
    ${avatar(s, "av av-xl", "face")}
    <div style="flex:1;min-width:0"><div class="rk muted" style="font-size:13px">${esc(t("myTeam"))} · #${s.rank}</div>
      <div style="font-weight:800;font-size:18px;line-height:1.2">${esc(s.teamName)}</div></div>
    <button class="btn" id="btn-image">${esc(t("changeImage"))}</button>
  </div>`;
  el.querySelector("#btn-image").addEventListener("click", () => openImageDialog(s));
}

// Participants pick a photo or logo; it's sent to Hugo, who publishes it from the admin page
function openImageDialog(s) {
  const modal = document.getElementById("image-modal");
  let prepared = null, kind = "logo";
  const current = S.logos[s.participantId] || {};
  const preview = () => {
    const imgs = prepared ? { ...current, [kind]: prepared.url } : current;
    modal.querySelector("#img-big").innerHTML = avatarFrom(imgs, s, "av av-xl", "face");
    modal.querySelector("#img-small").innerHTML = avatarFrom(imgs, s, "av");
  };
  modal.innerHTML = `<div class="login-form">
    <h2>${esc(t("newImage"))}</h2>
    <p class="muted" style="margin:0;font-size:14px">${esc(t("imageHint"))}</p>
    <div class="seg" role="radiogroup">
      <label><input type="radio" name="img-kind" value="logo" checked> ${esc(t("kindLogo"))}</label>
      <label><input type="radio" name="img-kind" value="face"> ${esc(t("kindFace"))}</label>
    </div>
    <label class="btn" style="justify-self:start">${esc(t("chooseImage"))}
      <input type="file" id="img-file" accept="image/*" class="hidden"></label>
    <div class="img-preview">
      <span id="img-big">${avatar(s, "av av-xl", "face")}</span>
      <div class="card card-pad team-flex" style="flex:1">${`<span id="img-small">${avatar(s, "av")}</span>`}
        <div><div style="font-weight:700">${esc(s.teamName)}</div><div class="muted" style="font-size:13px">${esc(s.participantName)}</div></div></div>
    </div>
    <p class="error-text" id="img-error"></p>
    <div id="img-after" class="hidden" style="display:grid;gap:8px"></div>
    <div class="actions" style="justify-content:flex-end">
      <button class="btn" id="img-cancel">${esc(t("close"))}</button>
      <button class="btn btn-primary" id="img-send" disabled>${esc(t("sendToHugo"))}</button>
    </div>
  </div>`;
  const $ = sel => modal.querySelector(sel);
  $("#img-cancel").addEventListener("click", () => modal.close());
  $("#img-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    $("#img-error").textContent = "";
    if (!file) return;
    try {
      prepared = await prepareImage(file, 512, 2 * 1024 * 1024);
    } catch {
      prepared = null;
      $("#img-error").textContent = t("imageError");
      $("#img-send").disabled = true;
      return;
    }
    preview();
    $("#img-send").disabled = false;
  });
  modal.querySelectorAll('input[name="img-kind"]').forEach(r => r.addEventListener("change", () => {
    kind = r.value;
    preview();
  }));
  $("#img-send").addEventListener("click", async () => {
    const ext = prepared.type.split("/")[1].replace("jpeg", "jpg");
    const file = new File([prepared.blob], `${s.participantId}-${kind}.${ext}`, { type: prepared.type });
    const text = t("imageMsg", { name: s.participantName, team: s.teamName, kind: t(kind === "face" ? "kindFace" : "kindLogo") });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: t("newImage"), text }); modal.close(); return; }
      catch (err) { if (err.name === "AbortError") return; }
    }
    // No file sharing (most desktops): save the image, then email it as an attachment
    const a = Object.assign(document.createElement("a"), { href: prepared.url, download: file.name });
    a.click();
    const after = $("#img-after");
    after.classList.remove("hidden");
    after.innerHTML = `<p style="margin:0;font-size:14px">${esc(t("imageSaved", { file: file.name }))}</p>
      <a class="btn" style="justify-self:start" href="mailto:hugo.berube@gmail.com?subject=${encodeURIComponent(t("imageSubject", { team: s.teamName }))}&body=${encodeURIComponent(text)}">${esc(t("email"))}</a>`;
  });
  modal.showModal();
}

function openTeam(id) {
  const s = standingOf(id);
  if (!s) return;
  const sc = S.config.scoring;
  const goalieCols = Object.keys(sc.goalie).includes("wins");
  const row = p => `<tr>
    <td class="rd num">${p.group ?? ""}</td>
    <td class="l"><div class="player">${mug(p, "mug mug-sm")}<div style="min-width:0"><div class="pname">${esc(p.name)}${formBadge(p)}</div>
      <div class="pmeta">${logo(p.team)}${S.owners.get(p.id) === 1
        ? `<span class="tag unique" title="${esc(t("uniqueHint"))}">★ ${esc(t("uniquePick"))}</span>`
        : `<span title="${esc(t("ownedBy", { n: S.owners.get(p.id) }))}">×${S.owners.get(p.id)}</span>`}</div></div></div></td>
    <td class="num opt">${p.gp ?? ""}</td>
    <td class="num">${p.stats.goals}</td><td class="num">${p.stats.assists}</td>
    ${goalieCols ? `<td class="num opt">${p.pos === "G" ? p.stats.wins : ""}</td><td class="num opt">${p.pos === "G" ? p.stats.shutouts : ""}</td>` : ""}
    <td class="num pp">${p.stats.points}</td></tr>`;
  const head = `<thead><tr><th class="l">${esc(t("roundShort"))}</th><th class="l">${esc(t("player"))}</th><th class="opt">${esc(t("gp"))}</th>
    <th>${esc(t("goals"))}</th><th>${esc(t("assists"))}</th>
    ${goalieCols ? `<th class="opt">${esc(t("wins"))}</th><th class="opt">${esc(t("shutouts"))}</th>` : ""}<th>${esc(t("pts"))}</th></tr></thead>`;
  const section = (title, players) => players.length
    ? `<h3>${esc(title)}</h3><div class="table-wrap"><table class="roster">${head}<tbody>${players.map(row).join("")}</tbody></table></div>` : "";
  const byPos = pos => s.rosterStats.filter(p => p.pos === pos);
  const former = (s.formerStats || []).map(p => `<div class="trade-row">${mug(p, "mug mug-sm")}<div style="flex:1"><b>${esc(p.name)}</b>
    <div class="muted" style="font-size:12px">${esc(t("droppedOn", { date: fmtDate(p.droppedOn) }))}</div></div><b class="num">${p.stats.points} ${esc(t("pts"))}</b></div>`).join("");

  const won = trophies()?.won[id], o = S.insights?.odds?.teams?.[id];
  const extras = [won && trophyChips(won) && `<span class="trophies">${trophyChips(won)}</span>`,
    o && `<span class="muted">${esc(t("oddsLine", { win: fmtPct(o.win), podium: fmtPct(o.podium), proj: o.projected }))}</span>`].filter(Boolean).join("");
  const modal = document.getElementById("team-modal");
  modal.innerHTML = `
    <div class="modal-head">
      <div class="team-flex">${avatar(s, "av av-xl", "face")}<div><div class="muted" style="font-size:13px">#${s.rank} · ${esc(s.participantName)}</div>
        <div style="font-weight:800;font-size:20px;line-height:1.2">${esc(s.teamName)}</div></div></div>
      <div style="text-align:right"><div class="big num">${s.totalPoints}</div><div class="muted" style="font-size:12px">${esc(t("pts"))}</div></div>
    </div>
    <div class="modal-body">
      ${extras ? `<div class="team-extras">${extras}</div>` : ""}
      ${section(t("forwards"), byPos("F"))}${section(t("defense"), byPos("D"))}${section(t("goalies"), byPos("G"))}
      ${former ? `<h3>${esc(t("former"))}</h3>${former}` : ""}
      <p class="muted" style="font-size:13px;margin:14px 0 0">${esc(t("pointsRule"))}</p>
      <div style="text-align:right;margin-top:12px"><button class="btn" id="close-team">${esc(t("close"))}</button></div>
    </div>`;
  modal.querySelector("#close-team").addEventListener("click", () => modal.close());
  modal.showModal();
  // showModal focuses the Close button at the bottom; open at the top instead
  modal.querySelector("#close-team").blur();
  modal.scrollTop = 0;
  modal.querySelector(".modal-body").scrollTop = 0;
}

// ---------- Trajectory ----------
function renderTrajectory() {
  const el = document.getElementById("traj-chart"), h = S.history;
  if (!h || h.dates.length < 2) { el.innerHTML = `<div class="empty">${esc(t("noHistory"))}</div>`; return; }
  const series = S.board.standings.map(s => ({ id: s.participantId, label: s.teamName, who: s.participantName, values: h.series[s.participantId] || [] }));
  if (!S.chartPicks) {
    const lead = S.board.standings[0]?.participantId, mine = me()?.participantId;
    S.chartPicks = [...new Set([mine, lead, S.board.standings[1]?.participantId].filter(Boolean))].slice(0, 3);
  }
  const used = renderChart(el, { dates: h.dates, series, highlighted: S.chartPicks, fmtDay, labelFor: s => s.label });
  const colorOf = new Map(used.map(u => [u.id, u.color]));
  const picker = document.getElementById("chart-picker");
  picker.innerHTML = S.board.standings.map(s => {
    const on = S.chartPicks.includes(s.participantId);
    return `<button class="chip" aria-pressed="${on}" data-id="${esc(s.participantId)}" ${!on && S.chartPicks.length >= 3 ? "disabled" : ""}>
      ${on ? `<span class="swatch" style="background:${colorOf.get(s.participantId)}"></span>` : ""}${esc(s.teamName)}</button>`;
  }).join("");
  picker.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.id;
    S.chartPicks = S.chartPicks.includes(id) ? S.chartPicks.filter(x => x !== id) : [...S.chartPicks, id].slice(0, 3);
    renderTrajectory();
  }));
}

// ---------- Tonight ----------
function gameState(g) {
  if (g.state === "FUT" || g.state === "PRE") {
    return { live: false, label: new Date(g.start).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }) };
  }
  if (g.state === "LIVE" || g.state === "CRIT") {
    const per = g.periodType === "OT" ? "OT" : g.periodType === "SO" ? "TB" : `P${g.period}`;
    return { live: true, label: g.intermission ? `${t("intermission")} ${per}` : `${per} · ${g.clock}` };
  }
  return { live: false, label: `${t("final")}${g.periodType && g.periodType !== "REG" ? ` (${g.periodType})` : ""}` };
}

function renderTonight() {
  const live = S.live, gamesEl = document.getElementById("games");
  const anyLive = !!live?.games?.some(g => g.state === "LIVE" || g.state === "CRIT");
  document.getElementById("live-pill").classList.toggle("hidden", !anyLive);
  renderHornToggle();
  if (!live || !live.games?.length) {
    gamesEl.innerHTML = `<div class="card empty" style="grid-column:1/-1">${esc(t("noGames"))}</div>`;
    document.getElementById("tonight-rank").innerHTML = "";
    return;
  }
  document.getElementById("tonight-title").textContent = `${t("tonight")} · ${fmtDay(live.gameDay, true)}`;
  document.getElementById("tonight-updated").textContent = live.updated ? `${t("updated")} ${fmtDate(live.updated, { timeStyle: "short" })}` : "";

  // Pool players by NHL team (from current rosters)
  const byTeam = new Map();
  for (const s of S.board.standings) for (const p of s.rosterStats) {
    if (!byTeam.has(p.team)) byTeam.set(p.team, new Map());
    byTeam.get(p.team).set(p.id, p);
  }
  const tonight = live.players || {};
  const mineIds = new Set(standingOf(me()?.participantId)?.rosterStats.map(p => p.id) || []);
  gamesEl.innerHTML = live.games.map(g => {
    const st = gameState(g);
    const pool = [...(byTeam.get(g.away.abbrev)?.values() || []), ...(byTeam.get(g.home.abbrev)?.values() || [])]
      .sort((a, b) => (S.owners.get(b.id) || 0) - (S.owners.get(a.id) || 0));
    const side = (team, alignRight) => `<div class="side" ${alignRight ? 'style="flex-direction:row-reverse"' : ""}>${logo(team.abbrev)}<span>${esc(team.abbrev)}</span>
      <span class="sc num">${team.score ?? ""}</span></div>`;
    return `<div class="card game">
      <div class="score-line">${side(g.away)}<div class="state ${st.live ? "live" : ""}">${esc(st.label)}</div>${side(g.home, true)}</div>
      ${pool.length ? `<div class="pool-players">${pool.map(p => {
        const tl = tonight[String(p.id)];
        const pts = tl ? `${tl.goals ? `${tl.goals}${t("goals")}` : ""}${tl.assists ? ` ${tl.assists}${t("assists")}` : ""}` : "";
        return `<span class="pp-chip ${tl ? "scored" : ""} ${mineIds.has(p.id) ? "mine" : ""}" title="${esc(t("ownedBy", { n: S.owners.get(p.id) }))}">${esc(p.name)}${pts ? ` · ${esc(pts.trim())}` : ""}<span class="own">×${S.owners.get(p.id)}</span></span>`;
      }).join("")}</div>` : ""}
      ${stakesRow(g)}
    </div>`;
  }).join("");

  // Points tonight per participant (goals/assists only until games are final);
  // each line opens to show which of their players scored
  const sc = S.config.scoring, mine = me()?.participantId;
  const gameOf = new Map(live.games.map(g => [g.id, g]));
  const rows = S.board.standings.map(s => {
    const scorers = [];
    for (const p of s.rosterStats) {
      const tl = tonight[String(p.id)];
      if (!tl) continue;
      const w = p.pos === "G" ? sc.goalie : sc.skater;
      const pts = tl.goals * (w.goals || 0) + tl.assists * (w.assists || 0);
      if (pts > 0) scorers.push({ p, tl, pts });
    }
    scorers.sort((a, b) => b.pts - a.pts || b.tl.goals - a.tl.goals);
    return { s, scorers, pts: scorers.reduce((n, x) => n + x.pts, 0) };
  }).filter(r => r.pts > 0).sort((a, b) => b.pts - a.pts || (b.s.participantId === mine) - (a.s.participantId === mine));
  const open = new Set([...document.querySelectorAll("#tonight-rank details[open]")].map(d => d.dataset.id));
  const statLine = tl => [tl.goals && `${tl.goals} ${t("goals")}`, tl.assists && `${tl.assists} ${t("assists")}`].filter(Boolean).join(" · ");
  const vs = (p, tl) => {
    const g = gameOf.get(tl.gameId);
    if (!g) return "";
    return `${esc(p.team)} ${p.team === g.home.abbrev ? "vs" : "@"} ${esc(p.team === g.home.abbrev ? g.away.abbrev : g.home.abbrev)}`;
  };
  // Link to the bingo with the signed-in participant's score
  const myBingo = bingoRace(live).find(r => r.s.participantId === mine);
  const bingoLink = myBingo ? `<a class="card bingo-link" href="#bingo">🎱 <span class="grow">${esc(t("bingoMine"))}</span>
    <span class="muted">${esc(bingoScore(myBingo.res))}</span> →</a>` : "";
  document.getElementById("tonight-rank").innerHTML = bingoLink + (rows.length ? `
    <div class="card card-pad" style="margin-bottom:12px"><h3>${esc(t("tonightPoints"))}</h3>
      <div class="tonight-list">${rows.map(r => `
        <details data-id="${esc(r.s.participantId)}" class="${r.s.participantId === mine ? "me" : ""}" ${open.has(r.s.participantId) ? "open" : ""}>
          <summary>
            <span class="team-flex">${avatar(r.s, "av", "logo")}<span style="min-width:0"><span class="name">${esc(r.s.teamName)}</span>
              <span class="who"> · ${esc(r.s.participantName)}</span></span></span>
            <span class="muted tl-count">${esc(t("scorersCount", { n: r.scorers.length }))}</span>
            <span class="pts-cell num">+${r.pts}</span>
          </summary>
          <ul class="tl-scorers">${r.scorers.map(x => `
            <li>${mug(x.p, "mug mug-sm")}<span class="grow"><b>${esc(x.p.name)}</b>
              <span class="muted">${vs(x.p, x.tl)}</span></span>
              <span class="tl-line">${esc(statLine(x.tl))}</span><b class="num">+${x.pts}</b></li>`).join("")}</ul>
        </details>`).join("")}</div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">${esc(t("tonightNote"))}</p></div>` : "");
}

// ---------- Bingo du soir (cards and scoring in bingo.js) ----------
const poolIds = () => (S.poolIds ||= new Set(S.board.standings.flatMap(s => s.rosterStats.map(p => p.id))));
const bingoRace = live => (live?.games?.length ? race(S.board.standings, live, poolIds()) : []);
const squareLabel = sq => t(`bingo_${sq.kind}${sq.vars.n > 1 && sq.kind !== "pool" ? "_n" : ""}`, sq.vars);

// What a refresh changed on the signed-in participant's card: newly ticked squares and new lines
function bingoNews(before, after) {
  const s = standingOf(me()?.participantId);
  if (!s || !before || before.gameDay !== after.gameDay) return "";
  const card = makeCard(s, after, poolIds());
  if (!card) return "";
  const a = evaluate(card, before), b = evaluate(card, after);
  const ticked = card.squares.filter((sq, i) => b.states[i] === true && a.states[i] !== true);
  if (!ticked.length) return "";
  const lines = b.lines.length - a.lines.length;
  return `<span class="gt-row mine"><span class="bingo-ball" aria-hidden="true">🎱</span><span class="grow">
    <b>${esc(lines > 0 ? t("bingoLine", { n: b.lines.length }) : t("bingoTicked"))}</b>
    <span class="gt-sub">${esc(ticked.map(squareLabel).join(" · "))}</span></span></span>`;
}

function bingoCard(row) {
  const { card, res } = row, inLine = new Set(res.lines.flat());
  return `<div class="bingo-card" role="grid" aria-label="${esc(t("bingo"))}">${card.squares.map((sq, i) => {
    const st = res.states[i], cls = sq.kind === "free" ? "free" : st === true ? "done" : st === false ? "dead" : "open";
    const mark = sq.kind === "free" ? "⭐" : st === true ? "✅" : st === false ? "✗" : "";
    return `<div class="bsq ${cls} ${inLine.has(i) ? "line" : ""}" role="gridcell">
      ${mark ? `<span class="bmark" aria-hidden="true">${mark}</span>` : ""}<span>${esc(sq.kind === "free" ? t("bingoFree") : squareLabel(sq))}</span></div>`;
  }).join("")}</div>`;
}

const bingoScore = res => t("bingoScore", { lines: res.lines.length, squares: res.done });

function renderBingo() {
  const el = document.getElementById("bingo-root");
  if (!el) return;  // tolerate a cached older index.html right after a deploy
  const live = S.live, rows = bingoRace(live), mine = me()?.participantId;
  if (!rows.length) { el.innerHTML = `<div class="card empty">${esc(t("bingoNone"))}</div>`; return; }
  const over = rows[0].res.over, top = rows[0].res;
  const winners = over ? rows.filter(r => r.res.lines.length === top.lines.length && r.res.done === top.done) : [];
  S.bingoPick = rows.some(r => r.s.participantId === S.bingoPick) ? S.bingoPick : mine || rows[0].s.participantId;
  const shown = rows.find(r => r.s.participantId === S.bingoPick);
  const myRank = rows.findIndex(r => r.s.participantId === mine) + 1;

  el.innerHTML = `
    <div class="section-head"><h2>${esc(t(over ? "bingoOf" : "bingoTonight", { date: fmtDay(live.gameDay, true) }))}</h2>
      <span class="muted">${esc(t("bingoHow"))}</span></div>
    ${winners.length ? `<div class="card card-pad bingo-winner">🏆 ${esc(t(winners.length > 1 ? "bingoWinners" : "bingoWinner",
      { teams: winners.map(r => r.s.teamName).join(", "), lines: top.lines.length, squares: top.done }))}</div>` : ""}
    <div class="bingo-layout">
      <div class="card card-pad">
        ${!mine ? `<p class="bingo-login muted">${esc(t("bingoLogin"))} <button class="btn btn-sm btn-primary" id="bingo-login">${esc(t("login"))}</button></p>` : ""}
        ${shown ? `<div class="bingo-head">${avatar(shown.s, "av av-md")}<div style="min-width:0;flex:1">
            <div class="duel-name">${esc(shown.s.participantId === mine ? t("bingoMine") : shown.s.teamName)}</div>
            <div class="muted" style="font-size:13px">${esc(bingoScore(shown.res))}${shown.s.participantId === mine && myRank ? ` · ${esc(t("bingoRank", { n: myRank, k: rows.length }))}` : ""}</div></div></div>
          ${bingoCard(shown)}` : ""}
      </div>
      <div class="card card-pad"><h3>${esc(t("bingoRace"))}</h3>
        <div class="bingo-race">${rows.map((r, i) => `
          <button class="brow ${r.s.participantId === S.bingoPick ? "shown" : ""} ${r.s.participantId === mine ? "me" : ""}" data-pick="${esc(r.s.participantId)}">
            <span class="num muted brank">${i + 1}</span>${avatar(r.s, "av", "logo")}
            <span class="grow"><span class="name">${esc(r.s.teamName)}</span><span class="who"> · ${esc(r.s.participantName)}</span></span>
            <span class="blines num" title="${esc(bingoScore(r.res))}">${r.res.lines.length ? `🎱 ${r.res.lines.length}` : ""}</span>
            <span class="bsquares num">${r.res.done}/8</span></button>`).join("")}</div>
      </div>
    </div>`;
  el.querySelector("#bingo-login")?.addEventListener("click", openLogin);
  el.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => {
    S.bingoPick = b.dataset.pick;
    renderBingo();
    if (matchMedia("(max-width: 720px)").matches) el.querySelector(".bingo-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}

// ---------- Trades ----------
function renderTrades() {
  const cfg = S.config, open = windowOpen(cfg);
  const opens = fmtDate(cfg.tradeWindowStart);
  document.getElementById("window-status").innerHTML = `<span class="status ${open ? "open" : "closed"}">${esc(open ? t("windowOpen") : t("windowClosed", { date: opens }))}</span>`;
  document.getElementById("rules").innerHTML = [
    t("rule1", { f: cfg.maxTrades.F, d: cfg.maxTrades.D, g: cfg.maxTrades.G }),
    t("rule2"), t("rule3", { date: opens }), t("rule4"), t("rule5"),
  ].map(r => `<li>${esc(r)}</li>`).join("");

  document.getElementById("trade-history").innerHTML = S.trades.length
    ? [...S.trades].reverse().map(tr => {
      const s = standingOf(tr.participantId);
      return `<div class="trade-row"><span class="tag">${esc(tr.pos)} · R${tr.group ?? ""}</span>
        <b>${esc(s?.teamName || tr.participantName)}</b>
        <span>${esc(tr.playerOut.name)}</span><span class="arrow">➜</span><b>${esc(tr.playerIn.name)}</b>
        <span class="muted" style="margin-left:auto;font-size:13px">${esc(fmtDate(tr.approvedAt))}</span></div>`;
    }).join("")
    : `<div class="empty" style="padding:8px">${esc(t("noTrades"))}</div>`;
  renderTradeBuilder();
}

function renderTradeBuilder() {
  const el = document.getElementById("trade-builder"), session = me();
  if (!session) {
    el.innerHTML = `<div class="card card-pad" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span>${esc(t("loginToSee"))}</span><button class="btn btn-primary" id="tb-login">${esc(t("login"))}</button></div>`;
    el.querySelector("#tb-login").addEventListener("click", openLogin);
    return;
  }
  const s = standingOf(session.participantId);
  if (!s) { el.innerHTML = ""; return; }
  const cfg = S.config, open = windowOpen(cfg), tr = S.trade;
  const out = s.rosterStats.find(p => p.id === tr.outId);
  const options = out ? roundOptions(S.groups, { players: s.rosterStats }, out) : [];
  const inn = options.find(p => p.id === tr.inId);

  const quota = ["F", "D", "G"].map(pos => {
    const left = tradesLeft(s, cfg, pos);
    return `<span class="q ${left <= 0 ? "used" : ""}">${POS_ICON[pos]} ${esc(posLabel(pos))} <b class="num">${left}</b>/${cfg.maxTrades[pos]}</span>`;
  }).join("");

  const outList = s.rosterStats.map(p => {
    const blocked = tradesLeft(s, cfg, p.pos) <= 0;
    return `<button class="pick" data-out="${p.id}" aria-pressed="${p.id === tr.outId}" ${blocked ? "disabled" : ""}>
      <span class="tag">R${p.group}</span>${mug(p, "mug mug-sm")}
      <span class="grow"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(posLabel(p.pos))} · ${esc(p.team)}</div></span>
      <span class="pp num">${p.stats.points}</span></button>`;
  }).join("");

  const inList = out ? (options.length ? options.map(p => `
    <button class="pick" data-in="${p.id}" aria-pressed="${p.id === tr.inId}">
      ${mug(p, "mug mug-sm")}<span class="grow"><b>${esc(p.name)}</b>
      <div class="muted" style="font-size:12px">${esc(p.team)} · ${esc(t("ownedBy", { n: S.owners.get(p.id) || 0 }))}</div></span>
      <span class="pp num" title="${esc(t("seasonPts"))}">${S.pointsById.get(p.id) ?? 0}</span></button>`).join("")
    : `<div class="empty">${esc(t("noOptions"))}</div>`)
    : `<div class="empty">${esc(t("pickOutFirst"))}</div>`;

  const message = tr.code && out && inn ? t("tradeMsg", { name: s.participantName, team: s.teamName, pos: posLabel(out.pos), round: out.group, out: out.name, in: inn.name, code: tr.code,
    link: new URL(`admin/#code=${tr.code}`, location.href.split("#")[0]).href }) : "";

  el.innerHTML = `
    <div class="section-head"><h2>${esc(t("proposeTrade"))}</h2><div class="quota">${quota}</div></div>
    <div class="steps">
      <div class="card card-pad"><h3>1. ${esc(t("playerOut"))}</h3><div class="pick-list pick-grid">${outList}</div></div>
      <div class="card card-pad"><h3>2. ${esc(t("playerIn"))}${out ? ` — ${esc(t("round"))} ${out.group}` : ""}</h3>
        <p class="muted" style="font-size:13px;margin:0 0 8px">${esc(t("seasonPtsHint"))}</p>
        <div class="pick-list pick-grid">${inList}</div>
        <div style="margin-top:14px">
          ${!open ? `<p class="muted" style="font-size:13px">${esc(t("windowClosed", { date: fmtDate(cfg.tradeWindowStart) }))}</p>` : ""}
          <button class="btn btn-primary" id="tb-generate" ${out && inn && open ? "" : "disabled"}>${esc(t("generate"))}</button>
        </div>
        ${message ? `<div style="margin-top:14px;display:grid;gap:8px">
          <p style="margin:0;font-size:14px">${esc(t("codeReady"))}</p>
          <textarea class="input code-box" id="tb-message" readonly>${esc(message)}</textarea>
          <div class="actions"><button class="btn" id="tb-copy">${esc(t("copy"))}</button>
            ${navigator.share ? `<button class="btn" id="tb-share">${esc(t("share"))}</button>` : ""}
            <a class="btn" href="mailto:hugo.berube@gmail.com?subject=${encodeURIComponent(t("tradeSubject"))}&body=${encodeURIComponent(message)}">${esc(t("email"))}</a></div>
        </div>` : ""}
      </div>
    </div>`;

  el.querySelectorAll("[data-out]").forEach(b => b.addEventListener("click", () => {
    S.trade = { outId: Number(b.dataset.out), inId: null, code: null };
    renderTradeBuilder();
  }));
  el.querySelectorAll("[data-in]").forEach(b => b.addEventListener("click", () => {
    S.trade = { ...S.trade, inId: Number(b.dataset.in), code: null };
    renderTradeBuilder();
  }));
  el.querySelector("#tb-generate")?.addEventListener("click", () => {
    S.trade.code = encodeTrade({ participantId: s.participantId, pos: out.pos, playerOut: out, playerIn: inn });
    renderTradeBuilder();
    el.querySelector("#tb-message")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  el.querySelector("#tb-copy")?.addEventListener("click", async e => {
    const text = el.querySelector("#tb-message").value;
    try { await navigator.clipboard.writeText(text); } catch { el.querySelector("#tb-message").select(); document.execCommand("copy"); }
    e.target.textContent = t("copied");
  });
  el.querySelector("#tb-share")?.addEventListener("click", () => {
    navigator.share({ text: el.querySelector("#tb-message").value }).catch(() => {});
  });
}

// ---------- Tonight's stakes: which families have players in this game ----------
function stakesRow(g) {
  const teams = new Set([g.away.abbrev, g.home.abbrev]), mine = me()?.participantId;
  const stakes = S.board.standings
    .map(s => ({ s, n: s.rosterStats.filter(p => teams.has(p.team)).length }))
    .filter(x => x.n).sort((a, b) => b.n - a.n);
  if (!stakes.length) return "";
  return `<div class="stakes"><span class="muted">${esc(t("atStake"))}</span>${stakes.map(x => `
    <span class="stake ${x.s.participantId === mine ? "mine" : ""}" title="${esc(t("stakeTitle", { name: x.s.participantName, n: x.n }))}">
      ${avatar(x.s, "av av-xs", "person")}<b class="num">${x.n}</b></span>`).join("")}</div>`;
}

// 🔥 / 🧊 from the last 5 games (insights.json)
function formBadge(p) {
  const f = S.insights?.form?.[String(p.id)];
  if (!f) return "";
  if (f.dry >= 4) return ` <span class="form cold" title="${esc(t("coldTitle", { n: f.dry }))}">🧊</span>`;
  if (f.last5 >= (p.pos === "G" ? 6 : 5)) return ` <span class="form hot" title="${esc(t("hotTitle", { n: f.last5 }))}">🔥</span>`;
  return "";
}

// ---------- Gazette ----------
function renderGazette() {
  renderHighlights();
  renderDuels();
  renderTrophies();
  renderBadges();
  renderMilestones();
}

function ownerStack(ids, max = 5) {
  const list = ids.map(standingOf).filter(Boolean);
  return `<span class="owner-stack">${list.slice(0, max).map(s => avatar(s, "av av-xs", "person")).join("")}${list.length > max ? `<span class="more">+${list.length - max}</span>` : ""}</span>`;
}

function renderHighlights() {
  const el = document.getElementById("highlights"), ins = S.insights;
  document.getElementById("hl-day").textContent = ins ? fmtDay(ins.gameDay, true) : "";
  if (!ins?.highlights?.length) { el.innerHTML = `<div class="card empty">${esc(t("noHighlights"))}</div>`; return; }
  el.innerHTML = ins.highlights.map(h => {
    const clip = getLang() === "fr" ? (h.clipFr || h.clipEn) : (h.clipEn || h.clipFr);
    const strength = h.strength === "pp" ? ` · ${t("ppGoal")}` : h.strength === "sh" ? ` · ${t("shGoal")}` : "";
    return `<div class="card hl">
      <div class="team-flex">${mug({ id: h.playerId }, "mug")}
        <div style="min-width:0"><div class="pname">${esc(h.name)}</div>
          <div class="muted" style="font-size:12px">${logo(h.team)} vs ${esc(h.opp)} · P${h.period} ${esc(h.time || "")}${esc(strength)}</div></div></div>
      ${h.poolAssists.length ? `<div class="muted" style="font-size:12px">${esc(t("assistBy", { names: h.poolAssists.join(", ") }))}</div>` : ""}
      <div class="hl-foot">${h.scorerOwned ? ownerStack(h.ownerIds) : `<span class="muted" style="font-size:12px">${esc(t("assistOnly"))}</span>`}
        ${clip ? `<a class="btn btn-sm" href="${esc(clip)}" target="_blank" rel="noopener">▶ ${esc(t("watchGoal"))}</a>` : ""}</div>
    </div>`;
  }).join("");
}

// Weekly duels: pairs drawn from the week's date (same for everyone), scored on points
// gained Monday→Sunday from history.json. An odd team out faces the pool average ("ghost").
function weekStart(iso) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function weekScores(monday) {
  const h = S.history, end = new Date(`${monday}T12:00:00`);
  end.setDate(end.getDate() + 6);
  const sunday = end.toISOString().slice(0, 10);
  const before = h.dates.filter(d => d < monday).length - 1;
  const last = h.dates.filter(d => d <= sunday).length - 1;
  const gain = {};
  for (const [id, vals] of Object.entries(h.series)) {
    gain[id] = last >= 0 ? (vals[last] ?? 0) - (before >= 0 ? vals[before] ?? 0 : 0) : 0;
  }
  return gain;
}

function weekDuels(monday) {
  const ids = S.board.standings.map(s => s.participantId).sort();
  const order = seededShuffle(ids, monday), gain = weekScores(monday);
  const avg = Math.round(Object.values(gain).reduce((a, b) => a + b, 0) / Math.max(1, ids.length));
  const duels = [];
  for (let i = 0; i < order.length; i += 2) duels.push([order[i], order[i + 1] ?? null]);
  return { duels, gain, avg };
}

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Every completed week (before the current one), oldest first: { monday, results: {id: 1 won, -1 lost, 0 tie} }
function pastDuelWeeks() {
  const h = S.history, weeks = [];
  if (!h?.dates?.length) return weeks;
  const current = weekStart(h.dates.at(-1));
  for (let m = weekStart(h.dates[0]); m < current; m = addDays(m, 7)) {
    const { duels, gain, avg } = weekDuels(m), results = {};
    for (const [a, b] of duels) {
      const ga = gain[a], gb = b ? gain[b] : avg;
      results[a] = Math.sign(ga - gb);
      if (b) results[b] = Math.sign(gb - ga);
    }
    weeks.push({ monday: m, results });
  }
  return weeks;
}

function renderDuels() {
  const el = document.getElementById("duels"), h = S.history;
  if (!h?.dates?.length) { el.innerHTML = `<div class="card empty">${esc(t("noHistory"))}</div>`; return; }
  const latest = h.dates.at(-1), monday = weekStart(latest);
  const dayN = Math.round((new Date(`${latest}T12:00:00`) - new Date(`${monday}T12:00:00`)) / 864e5) + 1;
  document.getElementById("duel-week").textContent = t("weekOf", { date: fmtDay(monday), day: dayN });

  // Season record from every completed week before this one
  const record = {};
  for (const { results } of pastDuelWeeks()) {
    for (const [id, r] of Object.entries(results)) {
      record[id] ||= { w: 0, l: 0 };
      if (r > 0) record[id].w++; else if (r < 0) record[id].l++;
    }
  }

  const { duels, gain, avg } = weekDuels(monday), mine = me()?.participantId;
  duels.sort((x, y) => (y.includes(mine)) - (x.includes(mine)));
  el.innerHTML = duels.map(([a, b]) => {
    const A = standingOf(a), B = b ? standingOf(b) : null;
    const ga = gain[a], gb = b ? gain[b] : avg;
    const total = Math.max(1, ga + gb), pa = Math.round((ga / total) * 100);
    const side = (s, g, lead, right) => `<div class="duel-side ${lead ? "lead" : ""} ${right ? "right" : ""}">
      ${s ? avatar(s, "av av-md") : `<span class="av av-md av-initials" style="--h:220">👻</span>`}
      <div style="min-width:0"><div class="duel-name" title="${esc(s ? s.teamName : t("ghost"))}">${esc(s ? s.teamName : t("ghost"))}</div>
        <div class="muted" style="font-size:12px">${s ? esc(s.participantName) : esc(t("ghostSub"))}${s && record[s.participantId] ? ` · ${record[s.participantId].w}-${record[s.participantId].l}` : ""}</div></div>
      <div class="duel-pts num">${g}</div></div>`;
    return `<div class="card duel ${[a, b].includes(mine) ? "mine" : ""}">
      ${side(A, ga, ga > gb, false)}
      <div class="duel-bar"><span style="width:${ga + gb ? pa : 50}%"></span></div>
      ${side(B, gb, gb > ga, true)}
    </div>`;
  }).join("");
}

// ---------- Trophy case and pool records (all from history.json: points after each game day) ----------
const TROPHIES = [["month", "🏆"], ["duel", "🥊"], ["star", "⭐"], ["crown", "👑"]];

function trophies() {
  const h = S.history;
  if (!h?.dates?.length) return null;
  if (S.trophies?.of === h) return S.trophies;
  const ids = S.board.standings.map(s => s.participantId).filter(id => h.series[id]);
  const at = (id, i) => (i < 0 ? 0 : h.series[id][i] ?? 0);
  const won = Object.fromEntries(ids.map(id => [id, { month: 0, duel: 0, star: 0, crown: 0 }]));
  const records = [];
  const best = (rows, key) => rows.reduce((top, r) => (!top || r[key] > top[key] ? r : top), null);  // earliest wins ties

  // Each night: ⭐ to the biggest gain, 👑 to whoever is first; ranks for the biggest climb
  const nights = [], climbs = [], reign = {};
  let longest = null;
  h.dates.forEach((date, i) => {
    const gains = ids.map(id => ({ id, date, n: at(id, i) - at(id, i - 1) }));
    const top = Math.max(...gains.map(g => g.n));
    if (top > 0) for (const g of gains) if (g.n === top) won[g.id].star++;
    nights.push(best(gains, "n"));
    const lead = Math.max(...ids.map(id => at(id, i)));
    for (const id of ids) {
      if (at(id, i) === lead) {
        won[id].crown++;
        reign[id] = (reign[id] || 0) + 1;
        if (!longest || reign[id] > longest.n) longest = { id, n: reign[id], now: i === h.dates.length - 1 };
      } else reign[id] = 0;
    }
    if (i > 0) {
      const rank = (id, k) => 1 + ids.filter(o => at(o, k) > at(id, k)).length;
      climbs.push(best(ids.map(id => ({ id, date, n: rank(id, i - 1) - rank(id, i) })), "n"));
    }
  });

  // 🏆 Each finished calendar month, to the biggest gain over the month; the current month is a race.
  // A stub of fewer than 10 game days (the season's last days of September) joins the next month.
  const months = [];
  for (const m of new Set(h.dates.map(d => d.slice(0, 7)))) {
    const first = h.dates.findIndex(d => d.startsWith(m)), last = h.dates.findLastIndex(d => d.startsWith(m));
    const stub = months.at(-1)?.short;
    months.push({ m, first: stub ? months.pop().first : first, last, short: last - first + 1 < 10 });
  }
  const latest = h.dates.at(-1);
  let race = null;
  for (const { m, first, last } of months) {
    const gains = ids.map(id => ({ id, n: at(id, last) - at(id, first - 1) }));
    const [y, mo] = m.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const top = Math.max(...gains.map(g => g.n));
    if (latest >= monthEnd) { for (const g of gains) if (g.n === top && top > 0) won[g.id].month++; }
    else if (top > 0) race = { ...best(gains, "n"), month: m };
  }

  // 🥊 Duels from completed weeks, with the longest winning streak
  let streak = null;
  const run = {};
  for (const { results } of pastDuelWeeks()) {
    for (const id of ids) {
      if (results[id] > 0) {
        won[id].duel++;
        run[id] = (run[id] || 0) + 1;
        if (!streak || run[id] > streak.n) streak = { id, n: run[id] };
      } else run[id] = 0;
    }
  }
  const weeks = [];
  for (let m = weekStart(h.dates[0]); m <= latest; m = addDays(m, 7)) {
    const gain = weekScores(m);
    weeks.push(best(ids.map(id => ({ id, n: gain[id], date: m })), "n"));
  }

  const night = best(nights.filter(Boolean), "n"), climb = best(climbs.filter(Boolean), "n"), week = best(weeks.filter(Boolean), "n");
  if (night?.n > 0) records.push({ icon: "🔥", key: "rec_night", ...night });
  if (week?.n > 0) records.push({ icon: "📅", key: "rec_week", ...week });
  if (climb?.n > 1) records.push({ icon: "🚀", key: "rec_climb", ...climb });
  if (streak?.n > 1) records.push({ icon: "🥊", key: "rec_streak", ...streak });
  if (longest?.n > 1) records.push({ icon: "👑", key: longest.now ? "rec_reignNow" : "rec_reign", ...longest });
  S.trophies = { of: h, won, records, race };
  return S.trophies;
}

function trophyChips(won) {
  return TROPHIES.filter(([k]) => won[k]).map(([k, icon]) =>
    `<span class="trophy" title="${esc(`${t(`tr_${k}`)} (${won[k]})`)}">${icon}<b class="num">${won[k]}</b></span>`).join("");
}

function renderTrophies() {
  const el = document.getElementById("trophies"), recEl = document.getElementById("records");
  if (!el || !recEl) return;  // tolerate a cached older index.html right after a deploy
  const tr = trophies(), mine = me()?.participantId;
  const weight = w => w.month * 100 + w.duel * 10 + w.star * 3 + w.crown;
  const rows = tr ? S.board.standings.filter(s => tr.won[s.participantId] && weight(tr.won[s.participantId]) > 0)
    .sort((a, b) => weight(tr.won[b.participantId]) - weight(tr.won[a.participantId]) || a.rank - b.rank) : [];
  el.innerHTML = rows.length ? `<div class="trophy-grid">${rows.map(s => `
      <button class="card trophy-card ${s.participantId === mine ? "mine" : ""}" data-team="${esc(s.participantId)}">
        ${avatar(s, "av av-md")}<span class="grow"><span class="duel-name">${esc(s.teamName)}</span>
        <span class="trophies">${trophyChips(tr.won[s.participantId])}</span></span></button>`).join("")}</div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">${esc(t("trophyLegend"))}</p>`
    : `<div class="card empty">${esc(t("noTrophies"))}</div>`;
  bindTeamOpeners(el);

  const items = (tr?.records || []).map(r => `<li><span class="ms-icon">${r.icon}</span><span>${esc(t(r.key, {
    team: standingOf(r.id)?.teamName, n: r.n, date: r.date ? fmtDay(r.date) : "" }))}</span></li>`);
  if (tr?.race) {
    const month = new Date(`${tr.race.month}-15T12:00:00`).toLocaleDateString(locale(), { month: "long" });
    items.unshift(`<li><span class="ms-icon">🏆</span><span>${esc(t("monthRace", { month, team: standingOf(tr.race.id)?.teamName, n: tr.race.n }))}</span></li>`);
  }
  recEl.innerHTML = items.length ? `<ul class="ms-list">${items.join("")}</ul>` : `<div class="empty" style="padding:8px">${esc(t("noTrophies"))}</div>`;
}

function renderBadges() {
  const el = document.getElementById("badges"), aw = S.insights?.awards;
  if (!aw) { el.innerHTML = `<div class="card empty">${esc(t("noInsights"))}</div>`; return; }
  const cards = [];
  if (aw.goldenPick) cards.push(["🌟", t("goldenPick"), aw.goldenPick, t("goldenSub", { n: aw.goldenPick.points, k: aw.goldenPick.owners })]);
  if (aw.iceAnchor) cards.push(["🧊", t("iceAnchor"), aw.iceAnchor, t("anchorSub", { n: aw.iceAnchor.dry, k: aw.iceAnchor.owners })]);
  if (aw.snub) cards.push(["🤦", t("snub"), aw.snub, t("snubSub", { n: aw.snub.points, g: aw.snub.group })]);
  el.innerHTML = cards.map(([icon, label, p, sub]) => `
    <div class="card award">${mug(p, "mug")}
      <div><div class="label">${icon} ${esc(label)}</div><div class="value">${esc(p.name)} ${logo(p.team)}</div><div class="sub">${esc(sub)}</div></div>
    </div>`).join("");
}

function renderMilestones() {
  const el = document.getElementById("milestones"), st = S.board.standings, rows = [];
  // Pool races: close gaps to the team just above
  for (let i = 1; i < st.length; i++) {
    const gap = st[i - 1].totalPoints - st[i].totalPoints;
    if (gap > 0 && gap <= 3) rows.push({ icon: "🏁", sort: gap, html: esc(t("chaseAbove", { team: st[i].teamName, n: gap, other: st[i - 1].teamName, rank: st[i - 1].rank })) });
  }
  // Player milestones from insights
  for (const m of S.insights?.milestones || []) {
    const left = m.target - m.value;
    rows.push({ icon: { goals: "🚨", points: "🎯", wins: "🥅" }[m.stat], sort: left + 0.5,
      html: `${esc(t(`ms_${m.stat}`, { name: m.name, n: left, target: m.target }))} <span class="muted">· ${esc(t("ownedBy", { n: m.owners }))}</span>` });
  }
  rows.sort((a, b) => a.sort - b.sort);
  el.innerHTML = rows.length
    ? `<ul class="ms-list">${rows.slice(0, 12).map(r => `<li><span class="ms-icon">${r.icon}</span><span>${r.html}</span></li>`).join("")}</ul>`
    : `<div class="empty" style="padding:8px">${esc(t("noMilestones"))}</div>`;
}

// ---------- FAQ ----------
function renderFaq() {
  const cfg = S.config, fr = getLang() === "fr";
  const labels = fr
    ? { goals: "But", assists: "Passe", wins: "Victoire d'un gardien", shutouts: "Blanchissage", otl: "Défaite en prolongation (gardien)", soGoals: "But en fusillade" }
    : { goals: "Goal", assists: "Assist", wins: "Goalie win", shutouts: "Shutout", otl: "Overtime loss (goalie)", soGoals: "Shootout goal" };
  const pts = n => fr ? `${n} point${n > 1 ? "s" : ""}` : `${n} point${n > 1 ? "s" : ""}`;
  const lines = [];
  for (const [k, v] of Object.entries(cfg.scoring.skater)) if (v) lines.push(`${labels[k] || k} : ${pts(v)}`);
  for (const [k, v] of Object.entries(cfg.scoring.goalie)) {
    if (!v || k in cfg.scoring.skater) continue;
    lines.push(`${labels[k] || k} : ${k === "shutouts" && cfg.scoring.goalie.wins ? "+" : ""}${pts(v)}`);
  }
  if (["goals", "assists"].every(k => cfg.scoring.goalie[k])) {
    lines.push(fr ? "Les gardiens reçoivent aussi les points de leurs buts et passes" : "Goalies also get points for their goals and assists");
  }
  const vars = {
    f: esc(cfg.maxTrades.F), d: esc(cfg.maxTrades.D), g: esc(cfg.maxTrades.G),
    opens: esc(fmtDate(cfg.tradeWindowStart)),
    scoring: lines.map(l => `<li>${esc(fr ? l : l.replace(" : ", ": "))}</li>`).join(""),
    teamsButton: `<a class="btn btn-sm" href="#teams">${esc(t("teams"))} →</a>`,
    tradesButton: `<a class="btn btn-sm" href="#trades">${esc(t("trades"))} →</a>`,
  };
  // Keep answers open across re-renders; ?q=<section>-<question> opens one from a shared link
  const open = new Set([...document.querySelectorAll("#faq-root details[open]")].map(d => d.dataset.key));
  const linked = new URLSearchParams(location.search).get("q");
  if (linked && !S.faqLinkDone) { open.add(linked); S.faqLinkDone = true; }
  document.getElementById("faq-root").innerHTML = faqContent(getLang(), vars).map((sec, i) => `
    <h3 class="faq-section">${esc(sec.section)}</h3>
    <div class="card faq-list">${sec.items.map((it, j) => `
      <details data-key="${i}-${j}" ${open.has(`${i}-${j}`) ? "open" : ""}>
        <summary>${esc(it.q)}</summary>
        <div class="faq-a">${it.a}</div>
      </details>`).join("")}</div>`).join("");
}
