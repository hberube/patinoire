// Achievements ("Succès"): badges earned from the season's shared data (history.json, bingo.json,
// the weekly duels, the trophy case), so everyone sees the same ones in each team window.
// The signed-in participant also gets a count in Pour toi and a celebration the first time they
// see a new one (remembered in this browser). Off switch: config.features.badges.
import { t } from "../i18n.js?v=20261025121518";
import { esc } from "../util.js?v=20261025121518";

const on = D => D.S.config.features?.badges !== false;
const seenKey = id => `patinoire_badges_seen_${id}`;

// [key, icon, need]: each test returns how far along you are (have), earned when have >= need
const BADGES = [
  ["bingo", "🎱", 1], ["lines3", "🎯", 3], ["fire", "🔥", 20], ["volcano", "🌋", 30],
  ["star", "⭐", 1], ["climb", "🚀", 3], ["streak", "📈", 10], ["podium", "🥉", 1],
  ["summit", "👑", 1], ["boxer", "🥊", 5], ["month", "🏆", 1], ["flair", "💎", 15],
  ["century", "💯", 100], ["v250", "🎖️", 250],
];

function measure(id, D) {
  const S = D.S, h = S.history, ids = Object.keys(h?.series || {});
  const at = (k, i) => (i < 0 ? 0 : h.series[k]?.[i] ?? 0);
  const rank = (k, i) => 1 + ids.filter(o => at(o, i) > at(k, i)).length;
  const m = Object.fromEntries(BADGES.map(([k]) => [k, 0]));
  if (h?.dates?.length && h.series[id]) {
    let run = 0;
    h.dates.forEach((date, i) => {
      const gain = at(id, i) - at(id, i - 1), r = rank(id, i);
      m.fire = m.volcano = Math.max(m.fire, gain);
      run = gain > 0 ? run + 1 : 0;
      m.streak = Math.max(m.streak, run);
      if (r <= 3) m.podium = 1;
      if (r === 1) m.summit = 1;
      if (i > 0) m.climb = Math.max(m.climb, rank(id, i - 1) - r);
    });
  }
  for (const n of D.bingoHistory()) {
    if (n.winners.includes(id)) m.bingo = 1;
    m.lines3 = Math.max(m.lines3, n.results.find(r => r.id === id)?.lines || 0);
  }
  const won = D.trophies()?.won?.[id];
  m.star = won?.star || 0;
  m.boxer = won?.duel || 0;
  m.month = won?.month || 0;
  // 💎 a player only you own, by his points this season
  const s = D.standingOf(id), owners = new Map();
  for (const x of S.board.standings) for (const p of x.rosterStats) owners.set(p.id, (owners.get(p.id) || 0) + 1);
  for (const p of s?.rosterStats || []) if (owners.get(p.id) === 1) m.flair = Math.max(m.flair, S.pointsById.get(p.id) ?? 0);
  m.century = m.v250 = s?.totalPoints || 0;
  return m;
}

// Every badge with its progress, earned first
export function achievements(id, D) {
  const m = measure(id, D);
  return BADGES.map(([key, icon, need]) => ({ key, icon, need, have: Math.min(m[key], need), got: m[key] >= need }));
}

const tile = b => `<li class="bdg${b.got ? " got" : ""}" title="${esc(t(`bdg_${b.key}_d`, { n: b.need }))}">
    <span class="bdg-icon" aria-hidden="true">${b.icon}</span><b>${esc(t(`bdg_${b.key}`))}</b>
    <small>${b.got ? esc(t(`bdg_${b.key}_d`, { n: b.need })) : `${b.have}/${b.need}`}</small></li>`;

// The team window: everyone's badges (earned ones first, then the closest to being earned)
export function badgesHtml(s, D) {
  if (!on(D)) return "";
  const list = achievements(s.participantId, D), got = list.filter(b => b.got).length;
  const order = [...list].sort((a, b) => b.got - a.got || b.have / b.need - a.have / a.need);
  return `<h3>🏅 ${esc(t("bdgTitle", { n: got, total: list.length }))}</h3><ul class="bdg-grid">${order.map(tile).join("")}</ul>`;
}

// Pour toi: the count, the closest one to earn, and any badge you haven't seen yet
let fresh = null;
export function badgesRow(s, D) {
  if (!on(D)) return null;
  const list = achievements(s.participantId, D), got = list.filter(b => b.got);
  const next = list.filter(b => !b.got).sort((a, b) => b.have / b.need - a.have / a.need)[0];
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(seenKey(s.participantId)) || "null"); } catch { /* private mode */ }
  const news = got.filter(b => !seen?.includes(b.key));
  if (news.length) {
    fresh = { id: s.participantId, list: news };
    try { localStorage.setItem(seenKey(s.participantId), JSON.stringify(got.map(b => b.key))); } catch { /* private mode */ }
  }
  const text = t("bdgRow", { n: got.length, total: list.length }) + (next ? ` · ${t("bdgNext", { name: t(`bdg_${next.key}`), have: next.have, need: next.need })}` : "");
  return { text, fresh: fresh?.id === s.participantId ? fresh.list : null, burst: news.length > 0 };
}

// The "new badge" banner, shown until it's tapped (the confetti plays once, when it's earned)
export function freshHtml(list) {
  if (!list?.length) return "";
  return `<button type="button" class="bdg-new" id="bdg-new"><span>🎉 ${esc(t(list.length > 1 ? "bdgNewMany" : "bdgNew", { n: list.length }))}</span>
    <span class="bdg-new-icons">${list.map(b => `<span title="${esc(t(`bdg_${b.key}`))}">${b.icon} ${esc(t(`bdg_${b.key}`))}</span>`).join("")}</span></button>`;
}
export function dismissFresh() { fresh = null; }
