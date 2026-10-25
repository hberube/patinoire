// « L'Aréna »: a full-screen jumbotron for the TV on game nights (the "Télé" tab, or the site at #tv).
// Live standings that re-rank as goals go in, a goal celebration, a rotating side panel and a
// score ticker, all from the data the page already loads (refreshed every 2 minutes by app.js).
// Self-contained so it can be removed in one go; off switch: "features": {"arena": false}.
import { t, locale } from "./i18n.js";
import { esc, headshot, teamLogo } from "./util.js";

let D = null;            // dependencies from app.js: { S, avatar, playHorn, bingoRace, gameState }
let root = null, rotateTimer = null, clockTimer = null, wakeLock = null, panel = 0;
const queue = [];        // goal celebrations waiting their turn
let celebrating = false;

const FINAL = new Set(["OFF", "FINAL"]);
const isOpen = () => !!root?.isConnected;

// Tonight's pool points per participant (goals and assists until games are final, like "Points ce soir")
function tonightPoints() {
  const { S } = D, sc = S.config.scoring, tonight = S.live?.players || {};
  const out = {};
  for (const s of S.board.standings) {
    let n = 0;
    for (const p of s.rosterStats) {
      const tl = tonight[String(p.id)];
      if (!tl) continue;
      const w = p.pos === "G" ? sc.goalie : sc.skater;
      n += tl.goals * (w.goals || 0) + tl.assists * (w.assists || 0);
    }
    out[s.participantId] = n;
  }
  return out;
}

// The standings were rebuilt after tonight's games already (late at night): don't count them twice
function tonightInStandings() {
  const { S } = D, games = S.live?.games || [];
  if (!games.length) return true;
  const lastStart = Math.max(...games.map(g => new Date(g.start).getTime()));
  return new Date(S.board.lastUpdated).getTime() > lastStart + 2 * 3600 * 1000;
}

function liveRows() {
  const { S } = D, add = tonightInStandings() ? {} : tonightPoints();
  const rows = S.board.standings.map(s => ({ s, tonight: add[s.participantId] || 0, total: s.totalPoints + (add[s.participantId] || 0) }));
  rows.sort((a, b) => b.total - a.total || a.s.rank - b.s.rank);
  rows.forEach((r, i) => { r.place = i && rows[i - 1].total === r.total ? rows[i - 1].place : i + 1; });
  return rows;
}

function renderStandings() {
  const list = root.querySelector(".ar-list");
  // FLIP: remember where each row was, re-render, then slide rows from there to their new place
  const before = new Map([...list.children].map(el => [el.dataset.id, el.getBoundingClientRect().top]));
  const rows = liveRows();
  list.innerHTML = rows.map(r => {
    const move = r.s.rank - r.place;
    return `<div class="ar-row ${r.tonight ? "hot" : ""}" data-id="${esc(r.s.participantId)}">
      <span class="ar-rank">${r.place}</span>${D.avatar(r.s, "av ar-av", "logo")}
      <span class="ar-team"><b>${esc(r.s.teamName)}</b> <small>${esc(r.s.participantName.split(" ")[0])}</small></span>
      <span class="ar-move ${move > 0 ? "up" : move < 0 ? "down" : ""}">${move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : ""}</span>
      <span class="ar-tonight">${r.tonight ? `+${r.tonight}` : ""}</span>
      <span class="ar-total">${r.total}</span></div>`;
  }).join("");
  for (const el of list.children) {
    const was = before.get(el.dataset.id);
    if (was == null) continue;
    const dy = was - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.style.transform = `translateY(${dy}px)`;
    el.style.transition = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ""; el.style.transform = ""; }));
  }
  root.querySelector(".ar-sub").textContent = tonightInStandings() ? t("arenaFinal") : t("arenaLiveNote");
}

function renderTicker() {
  const games = D.S.live?.games || [];
  const items = games.map(g => {
    const st = D.gameState(g);
    return `<span class="ar-game ${st.live ? "live" : ""}"><img src="${teamLogo(g.away.abbrev)}" alt="">${esc(g.away.abbrev)} <b>${g.away.score ?? ""}</b>
      <span class="ar-dash">–</span> <b>${g.home.score ?? ""}</b> ${esc(g.home.abbrev)}<img src="${teamLogo(g.home.abbrev)}" alt=""><small>${esc(st.label)}</small></span>`;
  }).join("");
  // Two copies side by side make the scroll seamless
  root.querySelector(".ar-ticker").innerHTML = games.length
    ? `<div class="ar-track" style="animation-duration:${Math.max(20, games.length * 7)}s">${items}${items}</div>`
    : `<div class="ar-none">${esc(t("arenaNoGames"))}</div>`;
}

function renderPanel() {
  const { S } = D, el = root.querySelector(".ar-panel");
  const panels = [];
  const race = D.bingoRace(S.live).slice(0, 5);
  if (race.length) panels.push([`🎱 ${t("arenaBingo")}`, race.map((r, i) => `<div class="ar-p-row"><span>${i + 1}</span>${D.avatar(r.s, "av ar-av-sm", "logo")}
    <b>${esc(r.s.teamName)}</b><em>${r.res.lines.length ? `🎱 ${r.res.lines.length} · ` : ""}${r.res.done}/8</em></div>`).join("")]);
  const scorers = Object.entries(S.live?.players || {}).map(([id, l]) => ({ id: Number(id), ...l, pts: l.goals + l.assists }))
    .filter(x => x.pts && S.owners.has(x.id)).sort((a, b) => b.goals - a.goals || b.pts - a.pts).slice(0, 5);
  const player = id => S.board.standings.flatMap(s => s.rosterStats).find(p => p.id === id);
  if (scorers.length) panels.push([`⭐ ${t("arenaStars")}`, scorers.map(x => { const p = player(x.id);
    return `<div class="ar-p-row"><img class="ar-mug" src="${headshot(x.id)}" alt=""><b>${esc(p?.name || "")}</b>
      <em>${[x.goals && `${x.goals} ${t("goals")}`, x.assists && `${x.assists} ${t("assists")}`].filter(Boolean).join(" · ")} · ×${S.owners.get(x.id)}</em></div>`; }).join("")]);
  const next = (S.live?.games || []).filter(g => g.state === "FUT" || g.state === "PRE").slice(0, 5);
  if (next.length) panels.push([`🕖 ${t("arenaNext")}`, next.map(g => `<div class="ar-p-row"><img class="ar-logo" src="${teamLogo(g.away.abbrev)}" alt="">
    <b>${esc(g.away.abbrev)} @ ${esc(g.home.abbrev)}</b><img class="ar-logo" src="${teamLogo(g.home.abbrev)}" alt=""><em>${esc(D.gameState(g).label)}</em></div>`).join("")]);
  if (!panels.length) { el.innerHTML = ""; return; }
  const [title, body] = panels[panel % panels.length];
  el.innerHTML = `<h3>${esc(title)}</h3><div class="ar-p-body">${body}</div>
    <div class="ar-dots">${panels.map((_, i) => `<i class="${i === panel % panels.length ? "on" : ""}"></i>`).join("")}</div>`;
}

function celebrate() {
  if (celebrating || !queue.length || !isOpen()) return;
  celebrating = true;
  const g = queue.shift(), { S } = D;
  const p = S.board.standings.flatMap(s => s.rosterStats).find(x => x.id === g.id);
  const owners = S.board.standings.filter(s => s.rosterStats.some(x => x.id === g.id));
  const box = root.querySelector(".ar-goal");
  box.innerHTML = `<div class="ar-goal-card">
      <div class="ar-goal-word">${esc(t("arenaGoal"))}</div>
      <img class="ar-goal-mug" src="${headshot(g.id)}" alt="">
      <div class="ar-goal-name">${esc(p?.name || "")}${g.n > 1 ? ` ×${g.n}` : ""}</div>
      <div class="ar-goal-team"><img src="${teamLogo(p?.team)}" alt=""> ${esc(p?.team || "")}</div>
      <div class="ar-goal-owners">${owners.slice(0, 8).map(s => D.avatar(s, "av ar-av", "person")).join("")}
        <span>${esc(t("goalFor", { n: g.n, teams: owners.length === S.board.standings.length ? t("arenaEveryone") : t("arenaTeams", { k: owners.length }) }))}</span></div>
    </div>`;
  box.classList.add("show");
  D.playHorn();
  setTimeout(() => { box.classList.remove("show"); setTimeout(() => { celebrating = false; renderStandings(); celebrate(); }, 600); }, 6500);
}

export function arenaUpdate(goals) {
  if (!isOpen()) return;
  renderTicker();
  renderPanel();
  if (goals?.length) { queue.push(...goals); celebrate(); } else renderStandings();
}

export function openArena(deps) {
  D = deps;
  if (isOpen()) return;
  root = document.createElement("div");
  root.className = "arena";
  root.setAttribute("role", "dialog");
  root.innerHTML = `
    <header class="ar-head"><span class="ar-brand">🏒 ${esc(t("arenaTitle"))}</span>
      <span class="ar-clock"></span>
      <button class="ar-btn ar-full">⛶ ${esc(t("arenaFull"))}</button><button class="ar-btn ar-close" aria-label="${esc(t("close"))}">✕</button></header>
    <div class="ar-main">
      <section class="ar-board"><h2>${esc(t("arenaStandings"))} <small class="ar-sub"></small></h2><div class="ar-list"></div></section>
      <aside class="ar-panel"></aside>
    </div>
    <footer class="ar-ticker"></footer>
    <div class="ar-goal"></div>`;
  document.body.append(root);
  document.body.classList.add("arena-open");
  const tick = () => { root.querySelector(".ar-clock").textContent = new Date().toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }); };
  tick();
  clockTimer = setInterval(tick, 15000);
  rotateTimer = setInterval(() => { panel++; renderPanel(); }, 20000);
  root.querySelector(".ar-close").addEventListener("click", closeArena);
  root.querySelector(".ar-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener("keydown", onKey);
  navigator.wakeLock?.request("screen").then(l => { wakeLock = l; }).catch(() => {});  // keep the TV awake
  renderStandings();
  renderTicker();
  renderPanel();
}

function onKey(e) { if (e.key === "Escape" && !document.fullscreenElement) closeArena(); }

export function closeArena() {
  if (!root) return;
  clearInterval(rotateTimer); clearInterval(clockTimer);
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  document.removeEventListener("keydown", onKey);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  root.remove(); root = null;
  document.body.classList.remove("arena-open");
  queue.length = 0; celebrating = false;
  if (location.hash === "#arena") history.replaceState(null, "", "#tv");
}
