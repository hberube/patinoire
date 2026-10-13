// Commissioner panel: review a participant's trade code and dispatch the trade workflow.
// The GitHub token never leaves this browser except in the request to api.github.com.
import { getSession, hashPin, newSalt } from "../js/auth.js";
import { decodeTrade, validateTrade } from "../js/trade.js";
import { esc, fetchJson, headshot } from "../js/util.js";
import { parseContacts } from "./contacts.js";
import { prepareImage, blobToBase64 } from "../js/image.js";

// On GitHub Pages the address is https://<owner>.github.io/<repo>/admin/, so the repo the
// workflows live in is read from it; the fallback is for local testing.
const onPages = location.hostname.endsWith(".github.io");
const OWNER = onPages ? location.hostname.split(".")[0] : "hberube";
const REPO = onPages ? location.pathname.split("/")[1] : "patinoire";
const TOKEN_KEY = "admin_gh_token";
const CONTACTS_KEY = "admin_contacts";
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
  [D.config, D.rosters, D.groups, D.history, D.index, D.logos] = await Promise.all([
    fetchJson("data/config.json", "../"), fetchJson("data/rosters.json", "../"),
    fetchJson("data/groups.json", "../"), fetchJson("data/trades_history.json", "../").catch(() => []),
    fetchJson("data/players_index.json", "../").catch(() => []), fetchJson("data/logos.json", "../").catch(() => ({})),
  ]);
  D.points = new Map(D.index.map(p => [p.id, p.points]));

  document.getElementById("window").textContent =
    `Période d'échanges : à partir du ${new Date(D.config.tradeWindowStart).toLocaleString("fr-CA", { dateStyle: "long", timeStyle: "short" })}`;
  document.getElementById("config-view").textContent = JSON.stringify(D.config, null, 2);
  document.getElementById("edit-config").href = `https://github.com/${OWNER}/${REPO}/edit/main/data/config.json`;
  document.getElementById("actions-link").href = ACTIONS_URL;
  document.getElementById("repo-name").textContent = `${OWNER}/${REPO}`;
  setupToken();
  setupContacts();
  setupMail();
  setupTradeReview();
  setupPins();
  setupLogos();
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
  if (!token) { status("Entrez et enregistrez d'abord votre jeton GitHub (section 4).", false); return false; }
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
    ${senderCheck(roster)}
    <div class="form-row">
      <button class="btn btn-primary" id="approve" disabled>Approuver l'échange</button>
      <span class="muted" style="font-size:13px">Le classement se met à jour 2-3 minutes après.</span>
    </div>
    <p class="status-line" id="approve-status"></p>
  </div>`;
  // Approve needs a valid trade AND Hugo confirming who sent it
  const approve = el.querySelector("#approve"), sender = el.querySelector("#sender-ok");
  sender.addEventListener("change", () => { approve.disabled = issues.length > 0 || !sender.checked; });
  approve.addEventListener("click", async e => {
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

function senderCheck(roster) {
  if (!roster) return `<input type="checkbox" id="sender-ok" class="hidden">`;
  const email = loadContacts()[roster.participantId];
  const who = email
    ? `<b>${esc(email)}</b> (${esc(roster.participantName)})`
    : `<b>${esc(roster.participantName)}</b> <span class="muted">— chargez vos contacts (section 2) pour voir son adresse</span>`;
  return `<label class="sender-check"><input type="checkbox" id="sender-ok">
    <span>Le message vient bien de ${who}, par courriel ou texto.</span></label>`;
}

// ---------- Contacts (emails stay in this browser only) ----------
function loadContacts() {
  try { return JSON.parse(localStorage.getItem(CONTACTS_KEY)) || {}; } catch { return {}; }
}

function setupContacts() {
  const count = document.getElementById("contacts-count"), st = document.getElementById("contacts-status");
  const show = () => {
    const n = Object.keys(loadContacts()).length;
    count.textContent = n ? `${n} contacts chargés` : "Aucun contact chargé";
  };
  show();
  document.getElementById("contacts-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const known = new Map(D.rosters.map(r => [r.participantId, r.participantName]));
    const { contacts, unknown } = parseContacts(await file.text(), known);
    try { localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts)); } catch { /* private mode */ }
    e.target.value = "";
    show();
    const missing = [...known.keys()].filter(id => !contacts[id]).map(id => known.get(id));
    st.className = `status-line ${missing.length || unknown.length ? "err" : "ok"}`;
    st.textContent = `${Object.keys(contacts).length} courriels associés.`
      + (missing.length ? ` Sans courriel : ${missing.join(", ")}.` : "")
      + (unknown.length ? ` Noms non reconnus : ${unknown.join(", ")}.` : "");
    renderPreview(document.getElementById("trade-input").value);
    refreshMail();
  });
  document.getElementById("contacts-forget").addEventListener("click", () => {
    try { localStorage.removeItem(CONTACTS_KEY); } catch { /* ignore */ }
    show();
    st.className = "status-line ok";
    st.textContent = "Contacts effacés de ce navigateur.";
    renderPreview(document.getElementById("trade-input").value);
    refreshMail();
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

// ---------- Team images ----------
// workflow_dispatch inputs are limited to ~65k characters, so the image is kept under 44 KB
function setupLogos() {
  const select = document.getElementById("logo-user"), st = document.getElementById("logo-status");
  const publish = document.getElementById("logo-publish"), kindSel = document.getElementById("logo-kind");
  let prepared = null;
  select.innerHTML = D.rosters.map(r => `<option value="${esc(r.participantId)}">${esc(r.participantName)} — ${esc(r.teamName)}</option>`).join("");
  const showCurrent = () => {
    const src = D.logos[select.value]?.[kindSel.value];
    document.getElementById("logo-current").innerHTML = src
      ? `<img class="av av-lg" style="border-radius:${kindSel.value === "face" ? "50%" : "24%"}" src="../${esc(src)}" alt="">` : `<span class="muted">Aucune image</span>`;
  };
  select.addEventListener("change", showCurrent);
  kindSel.addEventListener("change", showCurrent);
  showCurrent();
  document.getElementById("logo-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      prepared = await prepareImage(file, 256, 44000);
      document.getElementById("logo-new").innerHTML = `<img class="av av-lg" src="${prepared.url}" alt="">`;
      publish.disabled = false;
      st.textContent = "";
    } catch {
      prepared = null;
      publish.disabled = true;
      st.className = "status-line err";
      st.textContent = "Image illisible. Essayez un fichier JPG ou PNG.";
    }
  });
  const run = async (inputs, okMsg) => {
    const ok = await dispatch("set-logo.yml", inputs);
    st.className = `status-line ${ok ? "ok" : "err"}`;
    st.textContent = ok ? okMsg : document.getElementById("token-status").textContent;
  };
  publish.addEventListener("click", async () => {
    publish.disabled = true;
    await run({ participant_id: select.value, kind: kindSel.value, image: await blobToBase64(prepared.blob) },
      "Image envoyée! Elle apparaîtra sur le site dans 2-3 minutes.");
  });
  document.getElementById("logo-remove").addEventListener("click", async () => {
    if (!confirm("Retirer cette image?")) return;
    await run({ participant_id: select.value, kind: kindSel.value, remove: "true" }, "Image retirée (2-3 minutes).");
  });
}

// ---------- Email to everyone (BCC), sent from Hugo's own Gmail or mail app ----------
let refreshMail = () => {};

function mailTemplates() {
  const site = new URL("../", location.href).href;
  const opens = new Date(D.config.tradeWindowStart).toLocaleDateString("fr-CA", { dateStyle: "long" });
  const { F, D: Dq, G } = D.config.maxTrades;
  return [
    { id: "launch", label: "Le nouveau site est en ligne",
      subject: "Le Pool à Hugo 2026-27 — le nouveau site est en ligne!",
      body: `Bonjour à tous!

Le nouveau site du pool est en ligne :
${site}

Vous y trouverez le classement (mis à jour chaque matin), la Gazette avec les buts de vos joueurs, les duels de la semaine et les matchs de ce soir.

Pour vous connecter, touchez « Connexion », choisissez votre nom et entrez votre NIP (je vous l'envoie séparément).

Vous voulez changer votre photo ou le logo de votre équipe? Tout est expliqué ici :
${site}?q=0-0#faq

Bon pool!
Hugo` },
    { id: "trades", label: "La période d'échanges est ouverte",
      subject: "Le Pool à Hugo — la période d'échanges est ouverte!",
      body: `Bonjour à tous!

La période d'échanges est ouverte depuis le ${opens}. Chaque équipe a droit à ${F} échange d'attaquant, ${Dq} de défenseur et ${G} de gardien, toujours contre un joueur de la même ronde.

Comment faire, étape par étape :
${site}?q=1-1#faq

Envoyez-moi le message généré par le site à partir de votre propre courriel ou téléphone.

Hugo` },
    { id: "blank", label: "Message libre", subject: "Le Pool à Hugo", body: `Bonjour à tous!\n\n\n\nHugo\n${site}` },
  ];
}

function setupMail() {
  const $ = id => document.getElementById(id);
  const templates = mailTemplates();
  $("mail-template").innerHTML = templates.map(tp => `<option value="${tp.id}">${esc(tp.label)}</option>`).join("");
  const applyTemplate = () => {
    const tp = templates.find(x => x.id === $("mail-template").value);
    $("mail-subject").value = tp.subject;
    $("mail-body").value = tp.body;
    updateLinks();
  };
  const selected = () => [...document.querySelectorAll("#mail-recipients input:checked")].map(i => i.value);

  function updateLinks() {
    const bcc = selected(), subject = $("mail-subject").value, body = $("mail-body").value;
    const ready = bcc.length > 0;
    $("mail-count").textContent = ready ? `${bcc.length} destinataire${bcc.length > 1 ? "s" : ""}` : "";
    $("mail-recipients-summary").textContent = `Destinataires (${bcc.length})`;
    const q = new URLSearchParams({ view: "cm", fs: "1", bcc: bcc.join(","), su: subject, body });
    $("mail-gmail").href = ready ? `https://mail.google.com/mail/?${q}` : "#";
    $("mail-app").href = ready
      ? `mailto:?bcc=${encodeURIComponent(bcc.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : "#";
    for (const id of ["mail-gmail", "mail-app"]) $(id).classList.toggle("disabled", !ready);
  }

  refreshMail = () => {
    const contacts = loadContacts();
    const people = D.rosters.filter(r => contacts[r.participantId])
      .sort((a, b) => a.participantName.localeCompare(b.participantName, "fr"));
    $("mail-recipients").innerHTML = people.length ? people.map(r => `
      <label class="recipient"><input type="checkbox" value="${esc(contacts[r.participantId])}" checked>
        <span><b>${esc(r.participantName)}</b> <span class="muted">${esc(contacts[r.participantId])}</span></span></label>`).join("")
      : `<p class="muted" style="margin:0">Aucun contact : chargez d'abord <code>roster_2027.txt</code> à la section 2.</p>`;
    $("mail-status").className = "status-line err";
    $("mail-status").textContent = people.length ? "" : "Chargez vos contacts (section 2) pour pouvoir écrire à tout le monde.";
    if (people.length) $("mail-recipients-summary").parentElement.open = false;
    updateLinks();
  };

  $("mail-template").addEventListener("change", applyTemplate);
  for (const id of ["mail-subject", "mail-body"]) $(id).addEventListener("input", updateLinks);
  $("mail-recipients").addEventListener("change", updateLinks);
  $("mail-all").addEventListener("click", () => { document.querySelectorAll("#mail-recipients input").forEach(i => { i.checked = true; }); updateLinks(); });
  $("mail-none").addEventListener("click", () => { document.querySelectorAll("#mail-recipients input").forEach(i => { i.checked = false; }); updateLinks(); });
  for (const id of ["mail-gmail", "mail-app"]) {
    $(id).addEventListener("click", e => { if ($(id).classList.contains("disabled")) e.preventDefault(); });
  }
  $("mail-copy").addEventListener("click", async () => {
    const list = selected().join(", ");
    if (!list) return;
    try { await navigator.clipboard.writeText(list); } catch { prompt("Adresses :", list); return; }
    $("mail-status").className = "status-line ok";
    $("mail-status").textContent = "Adresses copiées : collez-les dans le champ CCI de votre courriel.";
  });
  applyTemplate();
  refreshMail();
}
