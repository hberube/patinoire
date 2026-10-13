// Commissioner panel: review a participant's trade code and dispatch the trade workflow.
// The GitHub token never leaves this browser except in the request to api.github.com.
import { getSession, hashPin, newSalt } from "../js/auth.js";
import { decodeTrade, validateTrade } from "../js/trade.js";
import { esc, fetchJson, headshot } from "../js/util.js";

const OWNER = "hberube";
const REPO = "la-patinoire";
const TOKEN_KEY = "admin_gh_token";
const ACTIONS_URL = `https://github.com/${OWNER}/${REPO}/actions`;
const D = {};

const store = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
  set: v => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

document.addEventListener("DOMContentLoaded", async () => {
  if (getSession()?.role !== "admin") {
    document.getElementById("gate").classList.remove("hidden");
    return;
  }
  document.getElementById("admin").classList.remove("hidden");
  [D.config, D.rosters, D.groups, D.history, D.index] = await Promise.all([
    fetchJson("data/config.json", "../"), fetchJson("data/rosters.json", "../"),
    fetchJson("data/groups.json", "../"), fetchJson("data/trades_history.json", "../").catch(() => []),
    fetchJson("data/players_index.json", "../").catch(() => []),
  ]);
  D.points = new Map(D.index.map(p => [p.id, p.points]));

  document.getElementById("window").textContent =
    `Période d'échanges : à partir du ${new Date(D.config.tradeWindowStart).toLocaleString("fr-CA", { dateStyle: "long", timeStyle: "short" })}`;
  document.getElementById("config-view").textContent = JSON.stringify(D.config, null, 2);
  document.getElementById("edit-config").href = `https://github.com/${OWNER}/${REPO}/edit/main/data/config.json`;
  document.getElementById("actions-link").href = ACTIONS_URL;
  setupToken();
  setupTradeReview();
  setupPins();
});

// ---------- GitHub token & dispatch ----------
function setupToken() {
  const input = document.getElementById("gh-token");
  input.value = store.get();
  document.getElementById("save-token").addEventListener("click", () => {
    store.set(input.value.trim());
    status("Jeton enregistré dans ce navigateur.", true);
  });
  document.getElementById("forget-token").addEventListener("click", () => {
    store.set(""); input.value = "";
    status("Jeton effacé.", true);
  });
  document.getElementById("run-daily").addEventListener("click", async () => {
    const ok = await dispatch("daily-stats-update.yml", {});
    if (ok) status("Mise à jour lancée. Le site sera à jour dans 2-3 minutes.", true);
  });
}

function status(msg, ok) {
  const el = document.getElementById("token-status");
  el.textContent = msg;
  el.className = `status-line ${ok ? "ok" : "err"}`;
}

async function dispatch(workflow, inputs) {
  const token = store.get();
  if (!token) { status("Entrez et enregistrez d'abord votre jeton GitHub (section 2).", false); return false; }
  try {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs }),
    });
    if (res.status === 204) return true;
    const body = await res.json().catch(() => ({}));
    status(`GitHub a refusé (${res.status}) : ${body.message || "vérifiez les permissions du jeton"}`, false);
  } catch (err) {
    status(`Erreur réseau : ${err.message}`, false);
  }
  return false;
}

// ---------- Trade review ----------
function setupTradeReview() {
  const input = document.getElementById("trade-input");
  input.addEventListener("input", () => renderPreview(input.value));
  // Trade messages carry a link to admin/#code=…, so the trade opens ready to review
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("code");
  if (fromLink) { input.value = fromLink; renderPreview(fromLink); }
}

function renderPreview(text) {
  const el = document.getElementById("trade-preview");
  if (!text.trim()) { el.innerHTML = ""; return; }
  let decoded;
  try { decoded = decodeTrade(text); } catch {
    el.innerHTML = `<p class="issues" style="list-style:none;padding:0">Code illisible. Demandez à la personne de recopier le message au complet.</p>`;
    return;
  }
  const { trade, code } = decoded;
  const roster = D.rosters.find(r => r.participantId === trade.participantId);
  const out = roster?.players.find(p => p.id === trade.outId);
  const group = D.groups.find(g => g.group === out?.group);
  const inn = group?.players.find(p => p.id === trade.inId);
  const issues = validateTrade(trade, { config: D.config, rosters: D.rosters, groups: D.groups, history: D.history });
  const side = (cls, p, name) => `<div class="side ${cls}"><img class="mug mug-sm" src="${headshot(p?.id ?? 0)}" alt="" onerror="this.style.visibility='hidden'">
    <div><b>${esc(p?.name || name || "?")}</b><div class="muted" style="font-size:12px">${esc(p?.team || "")} · ${D.points.get(p?.id) ?? 0} pts cette saison</div></div></div>`;

  el.innerHTML = `<div class="preview">
    <div><b>${esc(roster?.teamName || "?")}</b> <span class="muted">· ${esc(roster?.participantName || trade.participantId)}
      · ${esc(trade.pos)}${out ? ` · ronde ${out.group}` : ""} · soumis ${trade.ts ? new Date(trade.ts).toLocaleString("fr-CA") : "?"}</span></div>
    <div class="swap">${side("out", out, trade.outName)}<span class="arrow">➜</span>${side("in", inn, trade.inName)}</div>
    ${issues.length ? `<ul class="issues">${issues.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="ok-line">✓ Échange valide.</p>`}
    <div class="form-row">
      <button class="btn btn-primary" id="approve" ${issues.length ? "disabled" : ""}>Approuver l'échange</button>
      <span class="muted" style="font-size:13px">Le classement se met à jour 2-3 minutes après.</span>
    </div>
    <p class="status-line" id="approve-status"></p>
  </div>`;
  el.querySelector("#approve").addEventListener("click", async e => {
    if (!confirm(`Approuver : ${roster.participantName} — ${out.name} ➜ ${inn.name} ?`)) return;
    e.target.disabled = true;
    const ok = await dispatch("process-trade.yml", { trade_code: code });
    const st = el.querySelector("#approve-status");
    if (ok) {
      st.className = "status-line ok";
      st.innerHTML = `Envoyé! <a href="${ACTIONS_URL}/workflows/process-trade.yml" target="_blank" rel="noopener">Suivre l'exécution ↗</a>`;
    } else {
      e.target.disabled = false;
      st.className = "status-line err";
      st.textContent = document.getElementById("token-status").textContent;
    }
  });
}

// ---------- PINs ----------
function setupPins() {
  const select = document.getElementById("pin-user");
  select.innerHTML = D.rosters.map(r => `<option value="${esc(r.participantId)}">${esc(r.participantName)}</option>`).join("");
  document.getElementById("pin-make").addEventListener("click", async () => {
    const r = D.rosters.find(x => x.participantId === select.value);
    const input = document.getElementById("pin-value");
    const pin = input.value.trim() || String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
    const salt = newSalt();
    const entry = {
      participantId: r.participantId,
      displayName: r.participantName,
      role: r.participantId === getSession().participantId ? "admin" : "participant",
      salt,
      pinHash: await hashPin(pin, salt),
    };
    const out = document.getElementById("pin-output");
    out.value = `NIP pour ${r.participantName} : ${pin}\n\n${JSON.stringify(entry, null, 2)}`;
    out.classList.remove("hidden");
    input.value = "";
  });
}
