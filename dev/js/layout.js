// Layout v2: the site in 5 sections (Accueil · Classement · Ce soir · Gazette · Mon équipe) instead of 10 tabs.
// Only active when window.POOL_LAYOUT === "v2" (the dev preview sets it, see scripts/dev_publish.sh); otherwise
// this module does nothing and the live layout is untouched.
// It rearranges the page once at start-up by MOVING the existing containers into the new panels, so every
// render function in app.js keeps finding its element by id. Old links (#bingo, #chart, #trades…) are
// mapped to the section that now holds them. Styles: the body.v2 block in css/style.css.
import { t, getLang } from "./i18n.js?v=20261026212540";
import { esc } from "./util.js?v=20261026212540";

export const V2 = globalThis.POOL_LAYOUT === "v2";
export const SECTIONS = ["home", "standings", "tonight", "gazette", "team"];
const NAV = [["home", "🏠", "navHome"], ["standings", "🏆", "standings"], ["tonight", "🏒", "tonight"], ["gazette", "📰", "gazette"], ["team", "🧊", "navTeam"]];
// Old tab -> [section, element to scroll to]
const ALIAS = {
  chart: ["standings", "lay-curve"], bingo: ["tonight", "lay-bingo"], tv: ["tonight", "lay-tv"],
  injuries: ["gazette", "lay-infirm"], teams: ["team", "lay-teams"], trades: ["team", "lay-trades"],
};
const $ = id => document.getElementById(id);
let curve = false;
export const curveShown = () => V2 && curve;

// ---------- Start-up: build the 5 panels from today's containers ----------
export function setupLayout() {
  if (!V2) return;
  document.body.classList.add("v2");
  const main = document.querySelector("main");
  const panel = (id, html = "") => {
    const p = Object.assign(document.createElement("section"), { className: "panel", id: `panel-${id}` });
    p.innerHTML = html;
    return p;
  };
  const move = (id, into) => { const el = $(id); if (el && into) into.append(el); return el; };
  const moveKids = (from, into) => { const el = $(from); if (el) into.append(...el.childNodes); };

  // 🏠 Accueil
  const home = panel("home", `<div id="home-tonight"></div><div id="home-mini"></div><div id="home-tiles"></div>`);
  home.prepend($("pour-toi"));
  home.append($("recap"), $("radio"));
  main.prepend(home);

  // 🏆 Classement: Tableau ⇄ Courbe (Trajectoire moves in)
  const standings = $("panel-standings"), table = $("standings-table").closest(".card");
  standings.querySelector(".section-head").insertAdjacentHTML("beforeend",
    `<div class="lay-toggle" role="group" id="lay-curve-toggle"><button class="btn btn-sm" data-curve="0"></button><button class="btn btn-sm" data-curve="1"></button></div>`);
  const curveBox = Object.assign(document.createElement("div"), { id: "lay-curve", hidden: true });
  table.after(curveBox);
  move("traj-chart", curveBox); move("chart-picker", curveBox);
  standings.querySelectorAll("[data-curve]").forEach(b => b.addEventListener("click", () => setCurve(b.dataset.curve === "1")));

  // 🏒 Ce soir: + Bingo du soir + Télé
  const tonight = $("panel-tonight");
  tonight.prepend(chips("tonight"));
  tonight.insertAdjacentHTML("beforeend", `<div id="lay-games-end"></div><section id="lay-bingo" class="lay-part"></section><section id="lay-tv" class="lay-part"></section>`);
  move("bingo-root", $("lay-bingo")); move("tv-root", $("lay-tv"));

  // 📰 Gazette: + l'infirmerie
  const gazette = $("panel-gazette");
  gazette.prepend(chips("gazette"));
  gazette.insertAdjacentHTML("beforeend", `<section id="lay-infirm" class="lay-part"></section>`);
  move("injuries-root", $("lay-infirm"));

  // 🧊 Mon équipe: your team and corner, Échanges, every team
  const team = panel("team", `<div id="lay-mine"></div><div id="lay-fiche"></div><div id="me-corner"></div><section id="lay-trades" class="lay-part"></section><section id="lay-teams" class="lay-part"></section>`);
  team.prepend(chips("team"));
  gazette.after(team);  // in the page first, so $() finds its boxes
  move("my-team", $("lay-mine")); move("lay-fiche", $("lay-mine")); move("cards-root", $("lay-mine"));
  moveKids("panel-trades", $("lay-trades"));
  moveKids("panel-teams", $("lay-teams"));

  for (const old of ["panel-chart", "panel-tv", "panel-bingo", "panel-injuries", "panel-trades", "panel-teams"]) $(old)?.remove();

  // Navigation: the 5 sections in the top bar (computers) and in a bottom bar (phones); FAQ behind "?"
  const buttons = NAV.map(([id, icon, key]) => `<button class="tab" role="tab" data-tab="${id}"><span class="ico">${icon}</span><span data-i18n="${key}"></span></button>`).join("");
  document.querySelector(".tabs").innerHTML = buttons;
  document.body.insertAdjacentHTML("beforeend", `<nav class="v2-bottom" aria-label="Sections">${buttons}</nav>`);
  document.querySelector(".topbar .actions").insertAdjacentHTML("afterbegin", `<button class="btn btn-sm btn-ghost tab v2-faq" data-tab="faq" aria-label="FAQ">?</button>`);
}

function chips(section) {
  const sets = {
    tonight: [["tonight", "chipGames"], ["bingo", "bingo"], ["tv", "tv"]],
    gazette: [["gazette", "chipPaper"], ["injuries", "injuries"]],
    team: [["team", "navTeam"], ["trades", "trades"], ["teams", "chipAllTeams"]],
  };
  const nav = Object.assign(document.createElement("nav"), { className: "lay-chips" });
  nav.innerHTML = sets[section].map(([href, key]) => `<a class="lay-chip" href="#${href}" data-chip="${href}" data-i18n="${key}"></a>`).join("");
  return nav;
}

// ---------- Old links -> new sections ----------
// Returns { tab, anchor } for showTab(); unknown tabs land on Accueil
export function resolveTab(tab, hidden = []) {
  if (tab === "chart") curve = !hidden.includes("chart");
  if (tab === "standings") curve = curve && !hidden.includes("chart");
  const [section, anchor] = ALIAS[tab] || [tab, null];
  if (section === "faq" || SECTIONS.includes(section)) return { tab: section, anchor };
  return { tab: "home", anchor: null };
}

export function afterShow(anchor, renderTrajectory) {
  applyCurve(renderTrajectory);
  if (!anchor) { window.scrollTo({ top: 0 }); return; }
  requestAnimationFrame(() => $(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

let redraw = null;
function setCurve(on) { curve = on; applyCurve(redraw); }
function applyCurve(renderTrajectory) {
  redraw = renderTrajectory || redraw;
  const box = $("lay-curve"), table = $("standings-table")?.closest(".card");
  if (!box || !table) return;
  box.hidden = !curve; table.hidden = curve;
  document.querySelectorAll("[data-curve]").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.curve === "1") === curve)));
  if (curve && redraw) requestAnimationFrame(redraw);
}

// The admin's "Sections du site" (config.hiddenTabs), mapped onto the new parts
export const sectionHidden = (tab, cfg) => ["tonight", "gazette", "faq"].includes(tab) && (cfg?.hiddenTabs || []).includes(tab);
function applyHidden(cfg) {
  const hidden = new Set(cfg?.hiddenTabs || []);
  const parts = { chart: "lay-curve-toggle", bingo: "lay-bingo", injuries: "lay-infirm", trades: "lay-trades", teams: "lay-teams", tv: "lay-tv" };
  for (const [k, id] of Object.entries(parts)) $(id)?.classList.toggle("hidden", hidden.has(k) || (k === "tv" && cfg?.features?.arena === false));
  if (hidden.has("chart")) curve = false;
  document.querySelectorAll(".v2-faq").forEach(b => b.classList.toggle("hidden", hidden.has("faq")));
  document.querySelectorAll(".lay-chip").forEach(c => {
    const k = c.dataset.chip;
    c.classList.toggle("hidden", hidden.has(k) || (k === "tv" && cfg?.features?.arena === false));
  });
}

// ---------- Every render: labels, Accueil, Mon équipe ----------
export function renderLayout(D) {
  if (!V2) return;
  applyHidden(D.S.config);
  document.querySelectorAll("[data-curve]").forEach(b => { b.textContent = t(b.dataset.curve === "1" ? "layCurve" : "layTable"); });
  renderTonightTeaser(D);
  renderFiche(D);
  renderMini(D);
  renderTiles(D);
}

// Mon équipe: the full team window (regrets, Et si?, rink, achievements) is one tap away
function renderFiche(D) {
  const el = $("lay-fiche"), s = D.standingOf(D.me()?.participantId);
  if (!el) return;
  el.innerHTML = s ? `<button class="btn lay-fiche" data-team="${esc(s.participantId)}">📋 ${esc(t("layFiche"))}</button>` : "";
  D.bindTeamOpeners(el);
}

const timeOf = iso => new Date(iso).toLocaleTimeString(getLang() === "fr" ? "fr-CA" : "en-CA", { hour: "numeric", minute: "2-digit" });

function renderTonightTeaser(D) {
  const el = $("home-tonight");
  if (!el) return;
  const S = D.S, games = S.live?.games || [], s = D.standingOf(D.me()?.participantId);
  if (!games.length) { el.innerHTML = `<a class="card home-tonight" href="#tonight"><b>🏒 ${esc(t("homeNoGames"))}</b><span class="lay-go">${esc(t("homeSeeTonight"))} →</span></a>`; return; }
  const live = games.filter(g => D.gameState(g).live), done = games.filter(g => ["OFF", "FINAL"].includes(g.state));
  const next = games.filter(g => g.state === "FUT" || g.state === "PRE").map(g => g.start).sort()[0];
  const teams = new Set(games.flatMap(g => [g.away.abbrev, g.home.abbrev]));
  const mine = s ? s.rosterStats.filter(p => teams.has(p.team)).length : 0;
  const card = s && D.bingoRace(S.live).find(r => r.s.participantId === s.participantId);
  const status = live.length ? t("homeLive", { n: live.length }) : done.length === games.length ? t("homeAllDone") : next ? t("homeFirst", { time: timeOf(next) }) : "";
  const scores = [...live, ...done].slice(0, 6).map(g => `<span class="home-score${D.gameState(g).live ? " live" : ""}">${esc(g.away.abbrev)} ${g.away.score ?? 0}–${g.home.score ?? 0} ${esc(g.home.abbrev)}</span>`).join("");
  el.innerHTML = `<a class="card home-tonight" href="#tonight">
    <span class="home-kicker">🏒 ${esc(t("tonight"))}</span>
    <b>${esc(t("homeGames", { n: games.length }))}${status ? ` · ${esc(status)}` : ""}</b>
    ${s ? `<span class="muted">${esc(t("homeMine", { n: mine }))}${card ? ` · 🎱 ${esc(t("homeBingo", { done: card.res.done, lines: card.res.lines.length }))}` : ""}</span>` : ""}
    ${scores ? `<span class="home-scores">${scores}</span>` : ""}
    <span class="lay-go">${esc(t("homeSeeTonight"))} →</span></a>`;
}

function renderMini(D) {
  const el = $("home-mini");
  if (!el) return;
  const st = D.S.board.standings, mine = D.me()?.participantId, deltas = D.dayDeltas();
  const rows = st.slice(0, 5), me = st.find(s => s.participantId === mine);
  if (me && !rows.includes(me)) rows.push(me);
  const row = s => {
    const d = deltas[s.participantId];
    return `<li class="${s.participantId === mine ? "mine" : ""}${s === me && st.indexOf(s) >= 5 ? " gap" : ""}" data-team="${esc(s.participantId)}" tabindex="0">
      <span class="num rk">${s.rank}</span>${D.avatar(s, "av av-sm", "team")}<span class="grow">${esc(s.teamName)}</span>
      ${d ? `<span class="num muted">+${d}</span>` : ""}<b class="num">${s.totalPoints}</b></li>`;
  };
  el.innerHTML = `<section class="card home-mini"><div class="home-kicker">🏆 ${esc(t("standings"))}</div>
    <ol>${rows.map(row).join("")}</ol><a class="lay-go" href="#standings">${esc(t("homeFull"))} →</a></section>`;
  D.bindTeamOpeners(el);
}

function renderTiles(D) {
  const el = $("home-tiles");
  if (!el) return;
  const S = D.S, cfg = S.config, hidden = new Set(cfg.hiddenTabs || []), s = D.standingOf(D.me()?.participantId);
  const leader = S.board.standings[0];
  const card = s && D.bingoRace(S.live).find(r => r.s.participantId === s.participantId);
  const hurt = (S.injuries?.players || []);
  const myHurt = s ? hurt.filter(x => s.rosterStats.some(p => p.id === x.id)).length : 0;
  const goals = S.insights?.highlights?.length || 0;
  const tiles = [
    // Six tiles (two rows of three, three rows of two on phones); Échanges is inside Mon équipe
    ["standings", "🏆", t("standings"), s ? t(s.rank === 1 ? "tileRank1" : "tileRank", { rank: s.rank }) : t("tileLeader", { team: leader.teamName })],
    ["tonight", "🏒", t("tonight"), t("homeGames", { n: S.live?.games?.length || 0 })],
    !hidden.has("bingo") && ["bingo", "🎱", t("bingo"), card ? t("homeBingo", { done: card.res.done, lines: card.res.lines.length }) : t("tileBingo")],
    !hidden.has("gazette") && ["gazette", "📰", t("gazette"), goals ? t("tileGoals", { n: goals }) : t("tilePaper")],
    !hidden.has("injuries") && ["injuries", "🚑", t("injuries"), s ? t("tileMyHurt", { n: myHurt }) : t("tileHurt", { n: hurt.length })],
    ["team", "🧊", t("navTeam"), s ? t("tileMine") : t("tileTeams")],
  ].filter(Boolean);
  el.innerHTML = `<nav class="home-tiles">${tiles.map(([href, icon, name, hint]) => `<a class="card home-tile" href="#${href}">
      <span class="home-tile-ico" aria-hidden="true">${icon}</span><b>${esc(name)}</b><small>${esc(hint)}</small></a>`).join("")}</nav>`;
}
