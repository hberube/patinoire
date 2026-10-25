// Pool Wrapped (signed-in): your month as a full-screen story, like the music apps' year in review.
// Tap (or ←/→) to move between slides; they also advance on their own. The last slide saves a summary
// image. Opened from Pour toi: last month's from the 1st, or the month so far, plus every earlier month.
// Months follow the trophy case: the season's first few days (late September) count with October.
// Each player's monthly points come from data/months.json (insights.py snapshots each month's start).
// Off switch: config.features.wrapped.
import { t, getLang, locale } from "../i18n.js?v=20261025121518";
import { esc } from "../util.js?v=20261025121518";
import { rivalOf } from "./me.js?v=20261025121518";
import { achievements } from "./badges.js?v=20261025121518";
import { accentColor } from "./look.js?v=20261025121518";

const SLIDE_MS = 6500;
const on = D => D.S.config.features?.wrapped !== false;

// The season's months as history indexes, a stub of under 10 game days joined to the next month
export function months(D) {
  const h = D.S.history, out = [];
  if (!h?.dates?.length) return out;
  for (const m of new Set(h.dates.map(d => d.slice(0, 7)))) {
    const first = h.dates.findIndex(d => d.startsWith(m)), last = h.dates.findLastIndex(d => d.startsWith(m));
    const stub = out.at(-1)?.short;
    out.push({ key: m, first: stub ? out.pop().first : first, last, short: last - first + 1 < 10 });
  }
  const latest = h.dates.at(-1);
  return out.map((x, i) => {
    const [y, mo] = x.key.split("-").map(Number);
    return { ...x, season1: i === 0, done: latest >= new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) };
  });
}
const monthName = key => new Date(`${key}-15T12:00:00`).toLocaleDateString(locale(), { month: "long" });
const ofMonth = key => { const m = monthName(key); return getLang() === "fr" ? (/^[aeiou]/i.test(m) ? `d'${m}` : `de ${m}`) : m; };

function story(id, mo, D) {
  const S = D.S, h = S.history, ids = Object.keys(h.series);
  const at = (k, i) => (i < 0 ? 0 : h.series[k]?.[i] ?? 0);
  const rank = (k, i) => 1 + ids.filter(o => at(o, i) > at(k, i)).length;
  const gainOf = k => at(k, mo.last) - at(k, mo.first - 1);
  const gain = gainOf(id), place = 1 + ids.filter(o => gainOf(o) > gain).length;
  const nights = [];
  for (let i = mo.first; i <= mo.last; i++) nights.push({ date: h.dates[i], n: at(id, i) - at(id, i - 1) });
  const best = nights.reduce((a, b) => (b.n > a.n ? b : a), nights[0]);
  const worst = nights.reduce((a, b) => (b.n < a.n ? b : a), nights[0]);
  // Players: points this month = end snapshot (or now) − start snapshot (zero at the season's start)
  const all = months(D), next = all[all.findIndex(m => m.key === mo.key) + 1];
  const start = S.months?.[mo.key]?.players || (mo.season1 ? {} : null);
  const end = next ? S.months?.[next.key]?.players : null;
  const s = D.standingOf(id);
  let mvp = null, flop = null;
  if (start && (end || !mo.done || !next)) {
    const pts = p => (end ? end[String(p.id)] ?? 0 : S.pointsById.get(p.id) ?? 0) - (start[String(p.id)] ?? 0);
    const list = s.rosterStats.map(p => ({ p, n: pts(p) })).sort((a, b) => b.n - a.n);
    mvp = list[0]; flop = list.at(-1);
  }
  const bingo = D.bingoHistory().filter(n => n.day.startsWith(mo.key) || (mo.first === 0 && n.day < mo.key));
  const lines = bingo.reduce((n, x) => n + (x.results.find(r => r.id === id)?.lines || 0), 0);
  const wins = bingo.filter(x => x.winners.includes(id)).length;
  const duels = D.pastDuelWeeks().filter(w => w.monday.slice(0, 7) === mo.key || (mo.first === 0 && w.monday < mo.key)).map(w => w.results[id]);
  const r = D.standingOf(rivalOf(id));
  return {
    s, gain, place, total: ids.length, rankStart: mo.first > 0 ? rank(id, mo.first - 1) : null, rankEnd: rank(id, mo.last),
    best, worst, mvp, flop, nights: nights.length, bingo: { nights: bingo.length, lines, wins },
    duels: { w: duels.filter(x => x > 0).length, l: duels.filter(x => x < 0).length, t: duels.filter(x => x === 0).length },
    rival: r && { team: r.teamName, mine: gain, theirs: gainOf(r.participantId) },
    badges: achievements(id, D).filter(b => b.got), odds: S.insights?.odds?.teams?.[id],
  };
}

function slides(x, mo, D) {
  const sign = n => (n > 0 ? `+${n}` : String(n));
  const big = (v, label) => `<div class="wr-big"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
  const out = [
    `<div class="wr-kicker">${esc(t("wrKicker"))}</div>${D.avatar(x.s, "av wr-av", "team")}
      <h2>${esc(t("wrIntro", { month: ofMonth(mo.key) }))}</h2><p>${esc(x.s.teamName)}${mo.done ? "" : ` · ${esc(t("wrSoFar"))}`}</p>`,
    `<p>${esc(t("wrGainLead"))}</p>${big(sign(x.gain), t("pts"))}
      <p>${esc(t(x.place === 1 ? "wrPlace1" : "wrPlace", { n: x.place, total: x.total }))}</p>`,
    x.rankStart ? `<p>${esc(t("wrRankLead"))}</p><div class="wr-ranks"><b>${x.rankStart}</b><span>➜</span><b>${x.rankEnd}</b></div>
      <p>${esc(t(x.rankEnd < x.rankStart ? "wrRankUp" : x.rankEnd > x.rankStart ? "wrRankDown" : "wrRankSame", { n: Math.abs(x.rankStart - x.rankEnd) }))}</p>`
      : `<p>${esc(t("wrRankLead"))}</p>${big(`${x.rankEnd}`, t("wrRankNow"))}`,
    x.mvp && `<div class="wr-kicker">${esc(t("wrMvp"))}</div>${D.mug(x.mvp.p, "mug wr-mug")}<h2>${esc(x.mvp.p.name)}</h2>
      ${big(sign(x.mvp.n), t("wrMvpPts"))}${x.flop && x.flop.p.id !== x.mvp.p.id ? `<p class="wr-small">${esc(t("wrFlop", { name: x.flop.p.name, n: x.flop.n }))}</p>` : ""}`,
    x.best && `<div class="wr-kicker">${esc(t("wrNights"))}</div>${big(sign(x.best.n), D.fmtDay(x.best.date))}
      <p>${esc(t("wrBest"))}</p><p class="wr-small">${esc(t("wrWorst", { n: x.worst.n, date: D.fmtDay(x.worst.date) }))}</p>`,
    x.bingo.nights && `<div class="wr-kicker">🎱 ${esc(t("bingo"))}</div>${big(String(x.bingo.lines), t("wrLines"))}
      <p>${esc(t(x.bingo.wins ? "wrBingoWins" : "wrBingoNone", { n: x.bingo.wins, nights: x.bingo.nights }))}</p>`,
    `<div class="wr-kicker">🥊 ${esc(t("duels"))}</div><div class="wr-ranks"><b>${x.duels.w}</b><span>–</span><b>${x.duels.l}</b></div>
      <p>${esc(t("wrDuels", { t: x.duels.t }))}</p>
      ${x.rival ? `<p class="wr-small">${esc(t(x.rival.mine >= x.rival.theirs ? "wrRivalWin" : "wrRivalLose", { team: x.rival.team, a: x.rival.mine, b: x.rival.theirs }))}</p>` : ""}`,
    `<div class="wr-kicker">${esc(t("wrEnd"))}</div>
      <ul class="wr-sum"><li><b>${sign(x.gain)}</b> ${esc(t("pts"))}</li><li><b>#${x.place}</b> ${esc(t("wrOfMonth"))}</li>
        ${x.mvp ? `<li>⭐ ${esc(x.mvp.p.name)}</li>` : ""}<li>🎱 ${x.bingo.lines} · 🥊 ${x.duels.w}–${x.duels.l} · 🏅 ${x.badges.length}</li></ul>
      ${x.odds ? `<p class="wr-small">${esc(t("wrOdds", { win: D.fmtPct(x.odds.win) }))}</p>` : ""}
      <div class="wr-actions"><button type="button" class="btn" data-wr-save>💾 ${esc(t("wrSave"))}</button></div>
      <div class="wr-months">${months(D).map(m => `<button type="button" class="btn btn-sm" data-wr-month="${m.key}" aria-pressed="${m.key === mo.key}">${esc(monthName(m.key))}</button>`).join("")}</div>`,
  ];
  return out.filter(Boolean);
}

// The summary as a PNG (like the hockey cards in js/cards.js)
async function image(x, mo, D) {
  const W = 600, H = 840, acc = accentColor();
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0d1b2a"); grad.addColorStop(1, "#1e3a5f");
  g.fillStyle = grad; g.beginPath(); g.roundRect(0, 0, W, H, 36); g.fill();
  g.fillStyle = acc; g.fillRect(0, 0, W, 10);
  g.textAlign = "center"; g.fillStyle = acc; g.font = "800 30px 'Barlow Condensed', sans-serif";
  g.fillText(`${t("wrKicker")} · ${monthName(mo.key)}`.toUpperCase(), W / 2, 70);
  g.fillStyle = "#fff"; g.font = "800 48px 'Barlow Condensed', sans-serif";
  g.fillText(x.s.teamName.length > 24 ? `${x.s.teamName.slice(0, 23)}…` : x.s.teamName, W / 2, 130);
  g.font = "800 150px 'Barlow Condensed', sans-serif"; g.fillText(`${x.gain > 0 ? "+" : ""}${x.gain}`, W / 2, 300);
  g.font = "500 26px Inter, sans-serif"; g.fillStyle = "#a9b8c7";
  g.fillText(t(x.place === 1 ? "wrPlace1" : "wrPlace", { n: x.place, total: x.total }), W / 2, 345);
  const rows = [
    x.rankStart && `📊 ${t("wrRankLine", { a: x.rankStart, b: x.rankEnd })}`,
    x.mvp && `⭐ ${x.mvp.p.name} · +${x.mvp.n} ${t("pts")}`,
    x.best && `🔥 ${t("wrBestLine", { n: x.best.n, date: D.fmtDay(x.best.date) })}`,
    `🎱 ${x.bingo.lines} ${t("wrLines")} · 🥊 ${x.duels.w}–${x.duels.l} · 🏅 ${x.badges.length}`,
  ].filter(Boolean);
  g.fillStyle = "#fff"; g.font = "600 28px Inter, sans-serif";
  rows.forEach((r, i) => g.fillText(r, W / 2, 440 + i * 70));
  g.fillStyle = "#6b7b8c"; g.font = "500 18px Inter, sans-serif"; g.fillText(D.S.config.poolName || "Le Pool à Hugo", W / 2, H - 40);
  return new Promise(ok => cv.toBlob(ok, "image/png"));
}

async function save(x, mo, D) {
  const blob = await image(x, mo, D), file = new File([blob], `wrapped-${mo.key}-${x.s.participantId}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t("wrKicker") }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// The month Pour toi offers: last month from the 1st, or this month so far
export function wrappedMonth(D) {
  const all = months(D);
  return all.findLast(m => m.done) && new Date().getDate() <= 7 ? all.findLast(m => m.done) : all.at(-1);
}

export function wrappedButton(D) {
  const mo = on(D) && wrappedMonth(D);
  return mo ? `<button type="button" class="btn btn-sm me-wrapped" data-wrapped="${mo.key}">🎁 ${esc(t(mo.done ? "wrOpen" : "wrOpenSoFar", { month: ofMonth(mo.key) }))}</button>` : "";
}

export function openWrapped(id, key, D) {
  const mo = months(D).find(m => m.key === key);
  if (!mo) return;
  document.querySelector(".wr-overlay")?.close();  // another month picked on the last slide
  const x = story(id, mo, D), list = slides(x, mo, D);
  const box = Object.assign(document.createElement("div"), { className: "wr-overlay" });
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", t("wrKicker"));
  box.innerHTML = `<div class="wr-bars">${list.map(() => `<span><i></i></span>`).join("")}</div>
    <button type="button" class="wr-close" aria-label="${esc(t("close"))}">✕</button>
    ${list.map((html, i) => `<section class="wr-slide" data-i="${i}">${html}</section>`).join("")}
    <button type="button" class="wr-tap wr-prev" aria-label="←"></button><button type="button" class="wr-tap wr-next" aria-label="→"></button>`;
  document.body.append(box);
  document.body.classList.add("wr-open");
  let i = 0, timer;
  const show = n => {
    i = Math.max(0, Math.min(list.length - 1, n));
    box.querySelectorAll(".wr-slide").forEach(s => s.classList.toggle("on", Number(s.dataset.i) === i));
    box.querySelectorAll(".wr-bars span").forEach((b, k) => { b.className = k < i ? "done" : k === i ? "now" : ""; });
    clearTimeout(timer);
    if (i < list.length - 1) timer = setTimeout(() => show(i + 1), SLIDE_MS);
  };
  const close = () => { clearTimeout(timer); box.remove(); document.body.classList.remove("wr-open"); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") show(i + 1); if (e.key === "ArrowLeft") show(i - 1); };
  document.addEventListener("keydown", onKey);
  box.close = close;
  box.querySelector(".wr-close").addEventListener("click", close);
  box.querySelector(".wr-prev").addEventListener("click", () => show(i - 1));
  box.querySelector(".wr-next").addEventListener("click", () => show(i + 1));
  box.querySelector("[data-wr-save]")?.addEventListener("click", () => save(x, mo, D));
  box.querySelectorAll("[data-wr-month]").forEach(b => b.addEventListener("click", () => openWrapped(id, b.dataset.wrMonth, D)));
  box.style.setProperty("--slide-ms", `${SLIDE_MS}ms`);
  show(0);
}
