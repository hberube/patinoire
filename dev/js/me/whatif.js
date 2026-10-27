// "Et si?" simulator (your team window, signed-in): swap one of your players for another of the same
// round and see your points as if you'd had him all along, today's rank, and the projected finish
// (each team's points + its players' rest-of-season projection, js/me/advisor.js). Nothing is saved.
// Off switch: config.features.whatif.
import { t, getLang } from "../i18n.js?v=20261026213240";
import { esc } from "../util.js?v=20261026213240";
import { projector } from "./advisor.js?v=20261026213240";

const on = D => D.S.config.features?.whatif !== false;
const ord = n => (n === 1 && getLang() === "fr" ? "1er" : t("whatRank", { n }));

export const whatIfHtml = (s, D) => on(D) && D.me()?.participantId === s.participantId ? `<div id="me-whatif"></div>` : "";

export function renderWhatIf(el, s, D, pick = {}) {
  if (!el) return;
  const S = D.S, pts = id => S.pointsById.get(id) ?? 0;
  const out = s.rosterStats.find(p => p.id === pick.outId);
  const group = out && S.groups.find(g => g.group === out.group);
  const mine = new Set(s.rosterStats.map(p => p.id));
  const options = group ? group.players.filter(p => !mine.has(p.id)).sort((a, b) => pts(b.id) - pts(a.id)) : [];
  const inn = options.find(p => p.id === pick.inId);
  let result = "";
  if (out && inn) {
    const project = projector(D), teams = S.board.standings;
    const now = x => x.participantId === s.participantId ? x.totalPoints - out.stats.points + pts(inn.id) : x.totalPoints;
    const end = x => now(x) + x.rosterStats.reduce((n, p) => n + project(x.participantId === s.participantId && p.id === out.id ? inn : p).proj, 0);
    const endReal = x => x.totalPoints + x.rosterStats.reduce((n, p) => n + project(p).proj, 0);
    const rankBy = (f, id) => 1 + teams.filter(x => f(x) > f(teams.find(y => y.participantId === id))).length;
    const total = now(s), diff = total - s.totalPoints;
    const rankNow = rankBy(now, s.participantId), endA = rankBy(endReal, s.participantId), endB = rankBy(end, s.participantId);
    result = `<div class="wi-result">
      <div><b class="num">${total}</b><small>${esc(t("whatPts"))} <span class="${diff >= 0 ? "up" : "down"}">(${diff >= 0 ? "+" : ""}${diff})</span></small></div>
      <div><b class="num">${esc(ord(rankNow))}</b><small>${esc(t("whatToday", { real: ord(s.rank) }))}</small></div>
      <div><b class="num">${esc(ord(endB))}</b><small>${esc(t("whatEnd", { real: ord(endA) }))}</small></div>
    </div>
    <p class="me-small">${esc(t(diff > 0 ? "whatQuipUp" : diff < 0 ? "whatQuipDown" : "whatQuipSame", { a: inn.name, b: out.name, n: Math.abs(diff) }))}</p>`;
  }
  el.innerHTML = `<h3>🔮 ${esc(t("whatTitle"))}</h3>
    <p class="muted me-small">${esc(t("whatHint"))}</p>
    <div class="wi-pick">
      <select class="input" id="wi-out" aria-label="${esc(t("playerOut"))}"><option value="">${esc(t("whatOut"))}</option>
        ${[...s.rosterStats].sort((a, b) => a.group - b.group).map(p => `<option value="${p.id}" ${p.id === pick.outId ? "selected" : ""}>R${p.group} · ${esc(p.name)} (${p.stats.points})</option>`).join("")}</select>
      <span class="arrow" aria-hidden="true">➜</span>
      <select class="input" id="wi-in" aria-label="${esc(t("playerIn"))}" ${out ? "" : "disabled"}><option value="">${esc(t("whatIn"))}</option>
        ${options.map(p => `<option value="${p.id}" ${p.id === pick.inId ? "selected" : ""}>${esc(p.name)} (${pts(p.id)})</option>`).join("")}</select>
    </div>
    ${result}`;
  el.querySelector("#wi-out").addEventListener("change", e => renderWhatIf(el, s, D, { outId: Number(e.target.value) || null }));
  el.querySelector("#wi-in").addEventListener("change", e => renderWhatIf(el, s, D, { ...pick, inId: Number(e.target.value) || null }));
}
