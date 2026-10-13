// Trade codes: base64url(JSON) built by participants, checked again by the admin panel
// and finally by scripts/execute_trade.py (the source of truth).
// Rule: a player can only be swapped for another player from the same round of the form.

export function windowOpen(config, now = new Date()) {
  return now >= new Date(config.tradeWindowStart);
}

export function tradesLeft(roster, config, pos) {
  return (config.maxTrades[pos] ?? 0) - (roster.tradesUsed?.[pos] ?? 0);
}

// Other players of the same round, excluding anyone already on this roster
export function roundOptions(groups, roster, outPlayer) {
  const group = groups.find(g => g.group === outPlayer.group);
  const mine = new Set(roster.players.map(p => p.id));
  return group ? group.players.filter(p => !mine.has(p.id)) : [];
}

export function encodeTrade({ participantId, pos, playerOut, playerIn }) {
  const payload = {
    v: 1,
    tradeId: `tr_${Date.now()}`,
    participantId,
    pos,
    outId: playerOut.id,
    inId: playerIn.id,
    outName: playerOut.name,
    inName: playerIn.name,
    ts: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Accepts the bare code or the whole message the participant sent
export function decodeTrade(text) {
  const tokens = text.trim().split(/\s+/).filter(tok => /^[A-Za-z0-9_-]{40,}$/.test(tok));
  const code = tokens.sort((a, b) => b.length - a.length)[0] || text.trim();
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const trade = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  for (const k of ["tradeId", "participantId", "pos", "outId", "inId"]) {
    if (!(k in trade)) throw new Error(`missing ${k}`);
  }
  return { trade, code };
}

// Returns a list of problems in French for the admin panel (empty = valid). Mirrors execute_trade.py.
export function validateTrade(trade, { config, rosters, groups, history }) {
  const errors = [];
  if (!windowOpen(config)) errors.push(`La période d'échanges ouvre le ${new Date(config.tradeWindowStart).toLocaleDateString("fr-CA", { dateStyle: "long" })}`);
  if (history.some(h => h.tradeId === trade.tradeId)) errors.push("Cet échange a déjà été traité");
  const roster = rosters.find(r => r.participantId === trade.participantId);
  if (!roster) return [...errors, `Participant inconnu : ${trade.participantId}`];
  if (!(trade.pos in config.maxTrades)) errors.push(`Position inconnue : ${trade.pos}`);
  else if (tradesLeft(roster, config, trade.pos) <= 0) errors.push(`Échange ${trade.pos} déjà utilisé`);
  const out = roster.players.find(p => p.id === trade.outId);
  if (!out || out.pos !== trade.pos) return [...errors, `Le joueur qui sort n'est pas un ${trade.pos} de cette équipe`];
  if (!roundOptions(groups, roster, out).some(p => p.id === trade.inId)) {
    errors.push(`Le joueur qui entre n'est pas dans la ronde ${out.group} (ou est déjà dans l'équipe)`);
  }
  return errors;
}
