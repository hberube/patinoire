// Signed-in features, phase 1 (only shown to the participant who's signed in):
//   Pour toi        a personal card at the top of Classement (rank change, tonight, duel, bingo,
//                   injuries, the game to watch, what it takes to catch the leader, the rival)
//   Mes joueurs     your players tonight in "Ce soir", with an optional notification when one scores
//   Mon rival       a participant you follow head-to-head (kept in this browser)
//   Mes regrets     in your team window: the best pick of each draft round against yours
// Everything is computed from data the page already has. The app passes its helpers in (D), so this
// module holds no copy of the site's logic. Off switches: config.features.{pourtoi,myGames,rival,regrets}.
import { t, getLang } from "../i18n.js";
import { esc } from "../util.js";
import { lookHtml, bindLook, confetti, accentColor } from "./look.js";  // feature: look
import { badgesRow, freshHtml, dismissFresh } from "./badges.js";  // feature: badges
import { wrappedButton, openWrapped } from "./wrapped.js";  // feature: wrapped

const on = (D, name) => D.S.config.features?.[name] !== false;
const rivalKey = id => `patinoire_rival_${id}`;
const NOTIFY_KEY = "patinoire_notify_mine", FOLD_KEY = "patinoire_pourtoi_folded";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export const rivalOf = id => store.get(rivalKey(id));

// ---------- Tonight: your players, the game to watch ----------
function tonight(D, s) {
  const live = D.S.live, games = live?.games || [];
  const teams = new Set(games.flatMap(g => [g.away.abbrev, g.home.abbrev]));
  const mine = s.rosterStats.filter(p => teams.has(p.team));
  return { live, games, mine };
}

function livePoints(D, p) {
  const l = D.S.live?.players?.[String(p.id)];
  if (!l) return 0;
  const w = p.pos === "G" ? D.S.config.scoring.goalie : D.S.config.scoring.skater;
  return l.goals * (w.goals || 0) + l.assists * (w.assists || 0);
}

// The game that matters most to you tonight: your players ×2, your rival's players, your bingo squares
function gameToWatch(D, s) {
  const { games } = tonight(D, s);
  const open = games.filter(g => !["OFF", "FINAL"].includes(g.state));
  if (!open.length) return null;
  const rival = D.standingOf(rivalOf(s.participantId));
  const card = D.bingoRace(D.S.live).find(r => r.s.participantId === s.participantId)?.card;
  const scored = open.map(g => {
    const inGame = p => p.team === g.away.abbrev || p.team === g.home.abbrev;
    const mine = s.rosterStats.filter(inGame).length;
    const theirs = rival ? rival.rosterStats.filter(inGame).length : 0;
    const squares = (card?.squares || []).filter(q => q.vars?.team === g.away.abbrev || q.vars?.team === g.home.abbrev).length;
    return { g, mine, theirs, squares, score: mine * 2 + theirs + squares };
  }).sort((a, b) => b.score - a.score);
  return scored[0].score ? scored[0] : null;
}

function watchLine(D, w) {
  const bits = [w.mine && t("meWatchMine", { n: w.mine }), w.squares && t("meWatchSquares", { n: w.squares }), w.theirs && t("meWatchRival", { n: w.theirs })].filter(Boolean);
  return `${esc(w.g.away.abbrev)} @ ${esc(w.g.home.abbrev)} · ${esc(D.gameState(w.g).label)} — ${esc(bits.join(", "))}`;
}

// ---------- Rival: a head-to-head panel ----------
function rivalPanel(D, s) {
  const r = D.standingOf(rivalOf(s.participantId));
  const others = D.S.board.standings.filter(x => x.participantId !== s.participantId);
  const picker = `<select class="input me-rival-pick" aria-label="${esc(t("meRivalPick"))}">
    <option value="">${esc(t("meRivalNone"))}</option>${others.map(x => `<option value="${esc(x.participantId)}" ${r?.participantId === x.participantId ? "selected" : ""}>${esc(x.teamName)} · ${esc(x.participantName)}</option>`).join("")}</select>`;
  if (!r) return `<div class="me-sec"><div class="me-h">⚔️ ${esc(t("meRival"))}</div><p class="muted me-small">${esc(t("meRivalHint"))}</p>${picker}</div>`;
  const gap = s.totalPoints - r.totalPoints, w7 = D.gainOver(7);
  // Every finished week, whoever gained more "wins" it, as if you'd always been paired
  let wins = 0, losses = 0;
  for (const { monday } of D.pastDuelWeeks()) {
    const g = D.weekScores(monday), a = g[s.participantId], b = g[r.participantId];
    if (a > b) wins++; else if (a < b) losses++;
  }
  const tn = p => p.rosterStats.reduce((n, x) => n + livePoints(D, x), 0);
  return `<div class="me-sec">
    <div class="me-h">⚔️ ${esc(t("meRivalVs", { team: r.teamName }))}</div>
    <div class="me-rival-grid">
      <div><b class="num">${gap > 0 ? "+" : ""}${gap}</b><small>${esc(t(gap >= 0 ? "meRivalAhead" : "meRivalBehind"))}</small></div>
      <div><b class="num">${w7[s.participantId] ?? 0}–${w7[r.participantId] ?? 0}</b><small>${esc(t("meRival7"))}</small></div>
      <div><b class="num">${wins}–${losses}</b><small>${esc(t("meRivalWeeks"))}</small></div>
      <div><b class="num">${tn(s)}–${tn(r)}</b><small>${esc(t("meRivalTonight"))}</small></div>
    </div>
    <div class="me-rival-chart" id="me-rival-chart"></div>
    ${picker}
  </div>`;
}

// ---------- What it takes: odds and the pace needed to catch the leader ----------
function chaseLine(D, s) {
  const st = D.S.board.standings, leader = st[0], o = D.S.insights?.odds?.teams?.[s.participantId];
  const end = D.S.config.seasonEnd, days = end ? Math.max(1, Math.round((new Date(`${end}T12:00:00`) - Date.now()) / 864e5)) : 0;
  const pace = D.gainOver(14), mine = (pace[s.participantId] ?? 0) / 14, theirs = (pace[leader.participantId] ?? 0) / 14;
  const fmt = n => n.toLocaleString(getLang() === "fr" ? "fr-CA" : "en-CA", { maximumFractionDigits: 1 });
  const lines = [];
  if (o) lines.push(t("meOdds", { win: D.fmtPct(o.win), podium: D.fmtPct(o.podium) }));
  if (leader.participantId === s.participantId) lines.push(t("meLeading", { n: s.totalPoints - st[1].totalPoints }));
  else if (days) {
    const gap = leader.totalPoints - s.totalPoints, need = gap / days;
    lines.push(t("meChase", { gap, team: leader.teamName, need: fmt(need), date: D.fmtDay(end) }));
    lines.push(t("mePace", { mine: fmt(mine), theirs: fmt(theirs) }));
  }
  return lines.length ? `<div class="me-sec"><div class="me-h">🎯 ${esc(t("meChaseTitle"))}</div>${lines.map(l => `<p class="me-small">${esc(l)}</p>`).join("")}</div>` : "";
}

// ---------- L'horoscope du pool (scripts/horoscope.py, written at noon): today's only ----------
function horoscopeHtml(D, s) {
  const h = D.S.horoscope, mine = h?.signs?.[s.participantId];
  if (!mine || !on(D, "horoscope")) return "";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  if (h.day !== today) return "";
  const lang = getLang() === "en" ? "en" : "fr";
  return `<div class="me-sec me-horo"><div class="me-h">🔮 ${esc(t("meHoro"))}
      <span class="me-pucks" title="${esc(t("meHoroPucks", { n: mine.pucks }))}">${"●".repeat(mine.pucks)}<span>${"●".repeat(5 - mine.pucks)}</span></span></div>
    <p class="me-small">${esc(mine[lang])}</p>
    ${mine.lucky ? `<p class="me-small">🍀 ${esc(t("meHoroLucky", { name: mine.lucky }))}</p>` : ""}</div>`;
}

// ---------- Pour toi: the personal card ----------
export function renderPourToi(el, D) {
  const s = D.standingOf(D.me()?.participantId);
  if (!el) return;
  if (!s || !on(D, "pourtoi")) { el.innerHTML = ""; return; }
  const move = s.previousRank ? s.previousRank - s.rank : 0, last = D.dayDeltas()[s.participantId];
  const { mine } = tonight(D, s);
  const h = D.S.history, monday = h?.dates?.length ? D.weekStart(h.dates.at(-1)) : null;
  let duel = "";
  if (monday) {
    const { duels, gain, avg } = D.weekDuels(monday), pair = duels.find(d => d.includes(s.participantId));
    if (pair) {
      const other = pair.find(id => id && id !== s.participantId), o = other ? D.standingOf(other) : null;
      const a = gain[s.participantId], b = other ? gain[other] : avg;
      duel = t(a > b ? "meDuelLead" : a < b ? "meDuelTrail" : "meDuelTie", { me: a, them: b, team: o ? o.teamName : t("ghost") });
    }
  }
  const bingo = D.bingoRace(D.S.live).find(r => r.s.participantId === s.participantId);
  const hurt = (D.S.injuries?.players || []).filter(x => s.rosterStats.some(p => p.id === x.id));
  const watch = gameToWatch(D, s), badges = badgesRow(s, D);
  const rows = [
    [`📊`, t("meRank", { rank: s.rank, move: move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "=", pts: last == null ? "—" : (last > 0 ? `+${last}` : last) }), "standings"],
    mine.length && [`🏒`, t("meTonight", { n: mine.length }), "tonight"],
    watch && [`📺`, watchLine(D, watch), "tonight", true],
    duel && [`🥊`, duel, "gazette"],
    bingo && [`🎱`, t("meBingo", { lines: bingo.res.lines.length, squares: bingo.res.done }), "bingo"],
    badges && [`🏅`, badges.text, "teams"],
    hurt.length && [`🚑`, t("meHurt", { names: hurt.map(x => x.name.split(" ").slice(1).join(" ")).join(", ") }), "injuries"],
  ].filter(Boolean);
  const folded = store.get(FOLD_KEY) === "1";
  el.innerHTML = `<section class="card me-card${folded ? " folded" : ""}">
    <button type="button" class="me-head" aria-expanded="${!folded}" title="${esc(t(folded ? "expand" : "collapse"))}">${D.avatar(s, "av av-md", "team")}
      <span class="me-head-text"><span class="me-kicker">${esc(t("meTitle"))}</span><span class="me-team">${esc(s.teamName)}</span>
        <span class="me-sum">${esc(rows[0][1])}</span></span>
      <span class="recap-toggle" aria-hidden="true"></span></button>
    <div class="me-body">
    ${freshHtml(badges?.fresh)}
    <ul class="me-rows">${rows.map(([icon, text, tab, raw]) => `<li><a href="#${tab}"><span>${icon}</span><span>${raw ? text : esc(text)}</span></a></li>`).join("")}</ul>
    ${wrappedButton(D)}
    ${horoscopeHtml(D, s)}
    ${on(D, "pourtoi") ? chaseLine(D, s) : ""}
    ${on(D, "rival") ? rivalPanel(D, s) : ""}
    ${lookHtml(D)}
    </div>
  </section>`;
  el.querySelector("[data-wrapped]")?.addEventListener("click", e => openWrapped(s.participantId, e.currentTarget.dataset.wrapped, D));
  el.querySelector("#bdg-new")?.addEventListener("click", () => { dismissFresh(); renderPourToi(el, D); });
  // A moment later, once your logo's colour has loaded
  if (badges?.burst && !folded) setTimeout(() => confetti([accentColor(), "#ffffff", "#f5b301", accentColor()]), 700);
  el.querySelector(".me-head").addEventListener("click", () => { store.set(FOLD_KEY, folded ? null : "1"); renderPourToi(el, D); });
  bindLook(el, D, D.playHorn);
  el.querySelector(".me-rival-pick")?.addEventListener("change", e => { store.set(rivalKey(s.participantId), e.target.value || null); renderPourToi(el, D); });
  const chartEl = el.querySelector("#me-rival-chart"), r = D.standingOf(rivalOf(s.participantId));
  if (chartEl && r && D.S.history?.dates?.length > 1) {
    const series = [s, r].map(x => ({ id: x.participantId, label: x.teamName, who: x.participantName, values: D.S.history.series[x.participantId] || [] }));
    // Drawn once the card has its width (it has none while Classement is still hidden), and again when it changes
    let width = 0;
    new ResizeObserver(() => {
      if (!chartEl.clientWidth || chartEl.clientWidth === width) return;
      width = chartEl.clientWidth;
      D.renderChart(chartEl, { dates: D.S.history.dates, series, highlighted: [s.participantId, r.participantId], fmtDay: D.fmtDay, labelFor: x => x.label });
    }).observe(chartEl);
  }
}

// ---------- Mes joueurs ce soir (in "Ce soir") ----------
export function renderMyGames(el, D) {
  const s = D.standingOf(D.me()?.participantId);
  if (!el) return;
  if (!s || !on(D, "myGames")) { el.innerHTML = ""; return; }
  const { games, mine } = tonight(D, s);
  if (!games.length || !mine.length) { el.innerHTML = ""; return; }
  const gameOf = p => games.find(g => g.away.abbrev === p.team || g.home.abbrev === p.team);
  const notifyOn = store.get(NOTIFY_KEY) === "on" && typeof Notification !== "undefined" && Notification.permission === "granted";
  const watch = gameToWatch(D, s);
  // Who scored first, then by puck drop
  mine.sort((a, b) => livePoints(D, b) - livePoints(D, a) || String(gameOf(a).start).localeCompare(String(gameOf(b).start)));
  const list = players => `<ul class="me-players">${players.map(p => {
    const g = gameOf(p), st = D.gameState(g), pts = livePoints(D, p), opp = g.away.abbrev === p.team ? `@ ${g.home.abbrev}` : `vs ${g.away.abbrev}`;
    return `<li class="${pts ? "scored" : ""}">${D.mug(p, "mug mug-sm")}<span class="grow"><b>${esc(p.name)}</b> <span class="muted">${esc(p.team)} ${esc(opp)} · ${esc(st.label)}</span></span>
      <b class="num">${pts ? `+${pts}` : ""}</b></li>`;
  }).join("")}</ul>`;
  el.innerHTML = `<section class="card card-pad me-games">
    <div class="me-games-head"><h3>${esc(t("meMyGames", { n: mine.length }))}</h3>
      ${typeof Notification !== "undefined" ? `<button class="btn btn-sm" id="me-notify" aria-pressed="${notifyOn}">${esc(t(notifyOn ? "meNotifyOn" : "meNotifyOff"))}</button>` : ""}</div>
    ${watch ? `<p class="me-small">📺 <b>${esc(t("meWatchTitle"))}</b> ${watchLine(D, watch)}</p>` : ""}
    ${list(mine.slice(0, 6))}
    ${mine.length > 6 ? `<details class="me-more"><summary class="me-small">${esc(t("meMore", { n: mine.length - 6 }))}</summary>${list(mine.slice(6))}</details>` : ""}</section>`;
  el.querySelector("#me-notify")?.addEventListener("click", async () => {
    if (store.get(NOTIFY_KEY) === "on") { store.set(NOTIFY_KEY, null); return renderMyGames(el, D); }
    const ok = Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
    store.set(NOTIFY_KEY, ok ? "on" : null);
    renderMyGames(el, D);
  });
}

// Called by refreshLive() with the new pool goals: a system notification for yours (if turned on)
export function notifyMyGoals(goals, D) {
  const s = D.standingOf(D.me()?.participantId);
  if (!s || !goals?.length || store.get(NOTIFY_KEY) !== "on" || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  for (const g of goals) {
    const p = s.rosterStats.find(x => x.id === g.id);
    if (p) new Notification(t("meNotifyTitle", { name: p.name }), { body: t("meNotifyBody", { team: s.teamName }),
      icon: (D.S.logos[s.participantId]?.logo || D.S.logos[s.participantId]?.face || "").split("?")[0] || undefined, tag: `goal-${g.id}-${Date.now()}` });
  }
}

// ---------- Mes regrets (your team window): the best pick of each round against yours ----------
export function regretsHtml(s, D) {
  if (!on(D, "regrets") || D.me()?.participantId !== s.participantId) return "";
  const pts = id => D.S.pointsById.get(id) ?? 0;
  const rows = [];
  for (const p of s.rosterStats) {
    const g = D.S.groups.find(x => x.group === p.group);
    if (!g) continue;
    const best = [...g.players].sort((a, b) => pts(b.id) - pts(a.id))[0];
    if (best && best.id !== p.id && pts(best.id) > pts(p.id)) rows.push({ round: g.group, mine: p, best, lost: pts(best.id) - pts(p.id) });
  }
  if (!rows.length) return `<h3>😌 ${esc(t("meRegrets"))}</h3><p class="muted">${esc(t("meNoRegrets"))}</p>`;
  rows.sort((a, b) => b.lost - a.lost);
  const total = rows.reduce((n, r) => n + r.lost, 0);
  return `<h3>😩 ${esc(t("meRegrets"))}</h3><p class="muted me-small">${esc(t("meRegretsTotal", { n: total }))}</p>
    <ul class="me-regrets">${rows.slice(0, 6).map(r => `<li><span class="tag">R${r.round}</span>
      <span class="grow">${esc(t("meRegretLine", { best: r.best.name, mine: r.mine.name }))}</span><b class="num">−${r.lost}</b></li>`).join("")}</ul>`;
}
