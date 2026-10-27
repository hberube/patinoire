// Trade advisor (Échanges tab, signed-in): for each of your players, the best player available in the
// same round, by projected points for the rest of the season:
//   pace (season points per team game) × the team's games left, minus the games an injury should cost
//   (the expected return date in injuries.json, at the league's ~0.45 game per day).
// "Proposer cet échange" fills the existing trade form. Off switch: config.features.advisor.
import { t, locale } from "../i18n.js?v=20261026213240";
import { esc } from "../util.js?v=20261026213240";
import { tradesLeft, roundOptions } from "../trade.js?v=20261026213240";

const SEASON_GAMES = 82, GAMES_PER_DAY = 0.45;

// Rest-of-season projection for any player (also used by the "Et si?" simulator, js/me/whatif.js)
export function projector(D) {
  const S = D.S, teamGp = {};
  for (const s of S.board.standings) for (const p of s.rosterStats) teamGp[p.team] = Math.max(teamGp[p.team] || 0, p.gp || 0);
  const known = Object.values(teamGp).sort((a, b) => a - b), typical = known[Math.floor(known.length / 2)] || 1;
  const hurt = new Map((S.injuries?.players || []).map(x => [x.id, x]));
  const now = Date.now();
  const project = p => {
    const gp = Math.max(1, teamGp[p.team] || typical), left = Math.max(0, SEASON_GAMES - gp);
    const pace = (S.pointsById.get(p.id) ?? 0) / gp, inj = hurt.get(p.id);
    let missed = 0;
    if (inj) missed = inj.returnDate ? Math.max(0, (new Date(`${inj.returnDate}T12:00:00`) - now) / 864e5 * GAMES_PER_DAY)
      : inj.status === "dtd" ? 1 : 10;  // no date: a day-to-day costs ~1 game, anything else ~10
    return { pace, proj: pace * Math.max(0, left - missed), inj, missed: Math.round(missed) };
  };
  return project;
}

export function advice(s, D) {
  const project = projector(D), cfg = D.S.config, out = [];
  for (const p of s.rosterStats) {
    if (tradesLeft(s, cfg, p.pos) <= 0) continue;
    const mine = project(p);
    const best = roundOptions(D.S.groups, { players: s.rosterStats }, p).map(c => ({ c, ...project(c) })).sort((a, b) => b.proj - a.proj)[0];
    if (best && best.proj - mine.proj >= 1) out.push({ p, mine, best, gain: best.proj - mine.proj });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

export function renderAdvisor(el, D, propose) {
  if (!el) return;
  const s = D.standingOf(D.me()?.participantId);
  if (!s || D.S.config.features?.advisor === false) { el.innerHTML = ""; return; }
  const list = advice(s, D).slice(0, 3);
  const one = n => n.toLocaleString(locale(), { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const hurtTag = x => x.inj ? ` <span class="tag inj-tag" title="${esc(x.inj.type || "")}">🚑 ${esc(t("advOut", { n: x.missed }))}</span>` : "";
  el.innerHTML = `<section class="card card-pad me-adv">
    <h3>🧠 ${esc(t("advTitle"))}</h3>
    <p class="me-small">${esc(t(list.length ? "advIntro" : "advNone"))}</p>
    ${list.length ? `<ol class="adv-list">${list.map((a, i) => `<li>
      <div class="adv-swap"><span class="tag">R${a.p.group}</span>
        <span class="adv-p">${D.mug(a.p, "mug mug-sm")}<span><b>${esc(a.p.name)}</b><small>${esc(t("advPace", { pace: one(a.mine.pace) }))}${hurtTag(a.mine)}</small></span></span>
        <span class="arrow">➜</span>
        <span class="adv-p">${D.mug(a.best.c, "mug mug-sm")}<span><b>${esc(a.best.c.name)}</b><small>${esc(t("advPace", { pace: one(a.best.pace) }))}${hurtTag(a.best)}</small></span></span></div>
      <div class="adv-foot"><span class="adv-gain">${esc(t("advGain", { n: Math.round(a.gain) }))}</span>
        <button type="button" class="btn btn-sm" data-adv="${i}">${esc(t("advPropose"))}</button></div></li>`).join("")}</ol>
      <p class="np-legend me-small">${esc(t("advHow"))}</p>` : ""}
  </section>`;
  el.querySelectorAll("[data-adv]").forEach(b => b.addEventListener("click", () => {
    const a = list[Number(b.dataset.adv)];
    propose(a.p.id, a.best.c.id);
  }));
}
