// « Ta carte de hockey »: a collectible card per team for every week of the season.
// Built entirely from history.json (points gained Monday to Sunday), so the album needs no storage.
// Rarity from the week's rank: 1st Légendaire, 2nd-3rd Épique, 4th-8th Rare, the rest Commune.
// Self-contained so it can be removed in one go; off switch: "features": {"cards": false}.
import { t, locale } from "./i18n.js?v=20261026213240";
import { esc, asset } from "./util.js?v=20261026213240";

let D = null;  // dependencies from app.js: { S, avatar, standingOf, weekStart, weekScores, fmtDay, me }

const RARITY = [["legend", 1], ["epic", 3], ["rare", 8], ["common", Infinity]];
const rarityOf = place => RARITY.find(([, max]) => place <= max)[0];
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Every week of the season so far: { monday, current, cards: Map(id -> card) }
function weeks() {
  const { S } = D, h = S.history;
  if (!h?.dates?.length) return [];
  const out = [], latest = h.dates.at(-1), now = D.weekStart(latest);
  for (let m = D.weekStart(h.dates[0]), n = 1; m <= now; m = addDays(m, 7), n++) {
    const gain = D.weekScores(m), sunday = addDays(m, 6);
    const last = h.dates.filter(d => d <= sunday).length - 1;
    const ids = S.board.standings.map(s => s.participantId).filter(id => h.series[id]);
    const order = [...ids].sort((a, b) => (gain[b] ?? 0) - (gain[a] ?? 0));
    const cards = new Map();
    order.forEach((id, i) => {
      const place = i && gain[order[i - 1]] === gain[id] ? cards.get(order[i - 1]).place : i + 1;
      cards.set(id, { id, week: n, monday: m, gain: gain[id] ?? 0, place, total: h.series[id][last] ?? 0,
        rarity: rarityOf(place), current: m === now });
    });
    out.push({ monday: m, number: n, current: m === now, cards });
  }
  return out;
}

function star(id) {
  const s = D.standingOf(id);
  return s ? [...s.rosterStats].sort((a, b) => b.stats.points - a.stats.points)[0] : null;
}

function cardHtml(c, size = "") {
  const s = D.standingOf(c.id);
  if (!s) return "";
  const best = star(c.id);
  return `<div class="hcard r-${c.rarity} ${size}" data-card="${esc(c.id)}|${c.monday}" tabindex="0">
    <div class="hc-inner">
      <div class="hc-top"><span class="hc-rar">${esc(t(`card_${c.rarity}`))}</span><span class="hc-week">${esc(t("cardWeek", { n: c.week }))}</span></div>
      <div class="hc-img">${D.avatar(s, "av hc-av", "face")}</div>
      <div class="hc-name">${esc(s.teamName)}</div>
      <div class="hc-who">${esc(s.participantName)}</div>
      <div class="hc-stats">
        <div><b>+${c.gain}</b><small>${esc(t(c.current ? "cardGainNow" : "cardGain"))}</small></div>
        <div><b>${c.place}<sup>${c.place === 1 ? (locale() === "fr-CA" ? "er" : "st") : (locale() === "fr-CA" ? "e" : "")}</sup></b><small>${esc(t("cardPlace"))}</small></div>
        <div><b>${c.total}</b><small>${esc(t("cardTotal"))}</small></div>
      </div>
      ${best ? `<div class="hc-star">⭐ ${esc(best.name)} · ${best.stats.points} ${esc(t("pts"))}</div>` : ""}
      <div class="hc-foot">${esc(t("cardFoot", { date: D.fmtDay(c.monday) }))}${c.current ? ` · ${esc(t("cardLive"))}` : ""}</div>
    </div>
    <div class="hc-shine"></div>
  </div>`;
}

// Holographic tilt: the card leans toward the pointer (or the phone's tilt) and the foil follows
function bindTilt(root) {
  for (const el of root.querySelectorAll(".hcard")) {
    const set = (x, y) => {  // x, y in 0..1
      el.style.setProperty("--rx", `${(0.5 - y) * 18}deg`);
      el.style.setProperty("--ry", `${(x - 0.5) * 22}deg`);
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
    };
    el.addEventListener("pointermove", e => { const r = el.getBoundingClientRect(); set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
    el.addEventListener("pointerleave", () => set(0.5, 0.5));
  }
}

let motionOn = false;
function startMotion(root) {
  if (motionOn) return;
  const go = () => {
    motionOn = true;
    window.addEventListener("deviceorientation", e => {
      if (e.gamma == null) return;
      const x = Math.min(1, Math.max(0, 0.5 + e.gamma / 60)), y = Math.min(1, Math.max(0, 0.5 + (e.beta - 45) / 60));
      for (const el of document.querySelectorAll(".hcard.big")) {
        el.style.setProperty("--rx", `${(0.5 - y) * 18}deg`); el.style.setProperty("--ry", `${(x - 0.5) * 22}deg`);
        el.style.setProperty("--mx", `${x * 100}%`); el.style.setProperty("--my", `${y * 100}%`);
      }
    });
  };
  // iPhone asks first (needs a tap); other phones just send the events
  if (typeof DeviceOrientationEvent?.requestPermission === "function") {
    root.addEventListener("click", () => DeviceOrientationEvent.requestPermission().then(r => r === "granted" && go()).catch(() => {}), { once: true });
  } else go();
}

// The card as a PNG (drawn on a canvas: team image, name, the week's numbers, rarity colours)
const COLORS = { legend: ["#f7d774", "#b7791f"], epic: ["#c4a1ff", "#6d28d9"], rare: ["#8ec5ff", "#1d4ed8"], common: ["#e2e8f0", "#64748b"] };
async function cardImage(c) {
  const s = D.standingOf(c.id), [light, dark] = COLORS[c.rarity], W = 600, H = 840;
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, light); grad.addColorStop(1, dark);
  g.fillStyle = grad; g.beginPath(); g.roundRect(0, 0, W, H, 36); g.fill();
  g.fillStyle = "#0d1b2a"; g.beginPath(); g.roundRect(24, 24, W - 48, H - 48, 24); g.fill();
  g.fillStyle = light; g.font = "800 30px 'Barlow Condensed', sans-serif"; g.textAlign = "left";
  g.fillText(t(`card_${c.rarity}`).toUpperCase(), 56, 84);
  g.textAlign = "right"; g.fillText(t("cardWeek", { n: c.week }), W - 56, 84);
  const imgs = D.S.logos[c.id] || {}, src = imgs.face || imgs.logo;
  g.save(); g.beginPath(); g.arc(W / 2, 290, 150, 0, Math.PI * 2); g.closePath(); g.fillStyle = "#1e3a5f"; g.fill(); g.clip();
  if (src) {
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = asset(src); });
      const k = Math.max(300 / img.width, 300 / img.height);
      g.drawImage(img, W / 2 - (img.width * k) / 2, 290 - (img.height * k) / 2, img.width * k, img.height * k);
    } catch { /* initials below */ }
  }
  g.restore();
  g.strokeStyle = light; g.lineWidth = 8; g.beginPath(); g.arc(W / 2, 290, 150, 0, Math.PI * 2); g.stroke();
  g.textAlign = "center"; g.fillStyle = "#fff"; g.font = "800 46px 'Barlow Condensed', sans-serif";
  g.fillText(s.teamName.length > 26 ? `${s.teamName.slice(0, 25)}…` : s.teamName, W / 2, 500);
  g.font = "500 26px Inter, sans-serif"; g.fillStyle = "#a9b8c7"; g.fillText(s.participantName, W / 2, 540);
  const cols = [[`+${c.gain}`, t(c.current ? "cardGainNow" : "cardGain")], [`#${c.place}`, t("cardPlace")], [String(c.total), t("cardTotal")]];
  cols.forEach(([big, small], i) => {
    const x = 110 + i * 190;
    g.fillStyle = light; g.font = "800 54px 'Barlow Condensed', sans-serif"; g.fillText(big, x, 640);
    g.fillStyle = "#a9b8c7"; g.font = "500 20px Inter, sans-serif"; g.fillText(small, x, 672);
  });
  const best = star(c.id);
  if (best) { g.fillStyle = "#fff"; g.font = "600 24px Inter, sans-serif"; g.fillText(`⭐ ${best.name} · ${best.stats.points} ${t("pts")}`, W / 2, 730); }
  g.fillStyle = "#6b7b8c"; g.font = "500 18px Inter, sans-serif"; g.fillText(t("cardFoot", { date: D.fmtDay(c.monday) }), W / 2, 785);
  return new Promise(ok => cv.toBlob(ok, "image/png"));
}

async function saveCard(c) {
  const blob = await cardImage(c), s = D.standingOf(c.id);
  const file = new File([blob], `carte-${s.participantId}-semaine-${c.week}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t("cardsTitle") }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function bindSave(root, all) {
  root.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", () => {
    const [id, monday] = b.dataset.save.split("|");
    saveCard(all.find(w => w.monday === monday).cards.get(id));
  }));
}

// Album of one team: every week so far, newest first, plus a few locked weeks to come
export function openAlbum(id, deps) {
  D = deps;
  const all = weeks(), s = D.standingOf(id);
  if (!s || !all.length) return;
  let dlg = document.getElementById("cards-modal");
  if (!dlg) {
    dlg = Object.assign(document.createElement("dialog"), { id: "cards-modal" });
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
  }
  const counts = { legend: 0, epic: 0, rare: 0, common: 0 };
  for (const w of all) if (!w.current) counts[w.cards.get(id)?.rarity]++;
  dlg.innerHTML = `<div class="album">
      <div class="album-head"><h2>📒 ${esc(t("cardsAlbum", { team: s.teamName }))}</h2>
        <div class="album-counts">${Object.entries(counts).filter(([, n]) => n).map(([r, n]) => `<span class="tag r-${r}">${esc(t(`card_${r}`))} ×${n}</span>`).join("")}</div></div>
      <div class="album-grid">${[...all].reverse().map(w => `<div class="album-slot">${cardHtml(w.cards.get(id), "small")}
          <button class="btn btn-sm" data-save="${esc(id)}|${w.monday}">💾 ${esc(t("cardSave"))}</button></div>`).join("")}
        ${[1, 2, 3].map(() => `<div class="album-slot"><div class="hcard small locked"><div class="hc-inner"><span>🔒</span><small>${esc(t("cardLocked"))}</small></div></div></div>`).join("")}</div>
      <div style="text-align:right;margin-top:12px"><button class="btn" id="album-close">${esc(t("close"))}</button></div>
    </div>`;
  dlg.querySelector("#album-close").addEventListener("click", () => dlg.close());
  bindTilt(dlg); bindSave(dlg, all);
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Teams tab: this week's card (yours when signed in, else last week's legendary card)
export function renderCards(el, deps) {
  D = deps;
  const all = weeks(), mine = D.me()?.participantId;
  if (!all.length) { el.innerHTML = ""; return; }
  const now = all.at(-1), done = all.filter(w => !w.current).at(-1);
  let card, title;
  if (mine && now.cards.get(mine)) { card = now.cards.get(mine); title = t("cardsMine"); }
  else if (done) { card = [...done.cards.values()].find(c => c.place === 1); title = t("cardsLegend"); }
  else { card = [...now.cards.values()].find(c => c.place === 1); title = t("cardsLeader"); }
  if (!card) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="section-head"><h2>🃏 ${esc(title)}</h2><span class="muted">${esc(t("cardsHint"))}</span></div>
    <div class="cards-hero">${cardHtml(card, "big")}
      <div class="cards-side">
        <p class="muted" style="margin:0">${esc(t("cardsRarity"))}</p>
        <button class="btn btn-primary" id="cards-album">📒 ${esc(t(mine ? "cardsMyAlbum" : "cardsAlbumOf", { team: D.standingOf(card.id)?.teamName }))}</button>
        <button class="btn" data-save="${esc(card.id)}|${card.monday}">💾 ${esc(t("cardSave"))}</button>
      </div></div>`;
  el.querySelector("#cards-album").addEventListener("click", () => openAlbum(card.id, deps));
  bindTilt(el); bindSave(el, all); startMotion(el);
}
