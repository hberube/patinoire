// Bingo du soir: one 3×3 card per participant per game night, ticked from live.json.
// Cards are built from (participant, game day) with a seeded shuffle, so every device draws
// the same card for everyone without a server. Squares only read live.json's games and goals
// (scripts/update_live.py). No page code here: app.js renders cards and labels them with t().

const FREE = 4;  // centre square
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const FINAL = new Set(["OFF", "FINAL"]);

export function makeRng(seedText) {
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

export function seededShuffle(items, seedText) {
  const rand = makeRng(seedText), a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- What happened tonight, as the squares need it ----------
function night(live) {
  const games = live.games || [], goals = live.goals || [];
  const gameOf = team => games.find(g => g.away.abbrev === team || g.home.abbrev === team);
  const isFinal = g => !!g && FINAL.has(g.state);
  const goalsIn = g => goals.filter(x => x.gameId === g.id);
  const teamGoals = (g, team) => goalsIn(g).filter(x => x.team === team).length;
  return { games, goals, gameOf, isFinal, goalsIn, teamGoals, allFinal: games.length > 0 && games.every(isFinal) };
}

// true = done, false = can't happen anymore, null = still open
const settle = (done, over) => (done ? true : over ? false : null);
const lastName = name => name.split(" ").slice(1).join(" ") || name;

// Night squares: [id, fewest games tonight for it to be drawn, events per game, count(night, ids)].
// A square needs about the number expected for tonight's games (rate × games, at least 1), so it
// lands about half the time on any night: one power-play goal is a given on an 11-game night,
// fourteen of them is not. Rates from the first nights of 2026-27 and NHL norms.
const NIGHT = [
  ["pp", 1, 1.25, n => n.goals.filter(x => x.strength === "pp").length],
  ["pool", 1, 1.8, (n, ids) => n.goals.filter(x => ids.has(x.playerId)).length],
  ["seven", 1, 0.5, n => n.games.filter(g => n.goalsIn(g).length >= 7).length],
  ["en", 2, 0.3, n => n.goals.filter(x => x.emptyNet).length],
  ["ot", 2, 0.25, n => n.games.filter(g => g.periodType === "OT" || g.periodType === "SO" || g.period > 3).length],
  ["sh", 2, 0.25, n => n.goals.filter(x => x.strength === "sh").length],
  ["fast", 3, 0.15, n => n.goals.filter(x => /^00:/.test(x.time || "")).length],
  ["otgoal", 3, 0.15, n => n.goals.filter(x => x.periodType === "OT").length],
  ["hat", 5, 0.1, n => {
    const count = {};
    for (const x of n.goals) count[x.playerId] = (count[x.playerId] || 0) + 1;
    return Object.values(count).filter(c => c >= 3).length;
  }],
  ["so", 5, 0.08, n => n.games.filter(g => g.periodType === "SO").length],
  ["shutout", 6, 0.07, n => n.games.filter(g => n.isFinal(g) && (g.away.score === 0 || g.home.score === 0)).length],
];
const needed = (rate, games) => Math.max(1, Math.round(rate * games));

const CHECKS = {
  goal: (n, v) => settle(n.goals.some(x => x.playerId === v.id), n.isFinal(n.gameOf(v.team)) || !n.gameOf(v.team)),
  point: (n, v) => settle(n.goals.some(x => x.playerId === v.id || x.assistIds?.includes(v.id)), n.isFinal(n.gameOf(v.team)) || !n.gameOf(v.team)),
  win: (n, v) => {
    const g = n.gameOf(v.team);
    if (!n.isFinal(g)) return null;
    const mine = g.away.abbrev === v.team ? g.away.score : g.home.score, theirs = g.away.abbrev === v.team ? g.home.score : g.away.score;
    return mine > theirs;
  },
  three: (n, v) => { const g = n.gameOf(v.team); return settle(!!g && n.teamGoals(g, v.team) >= 3, n.isFinal(g) || !g); },
  ...Object.fromEntries(NIGHT.map(([id, , , count]) => [id, (n, v) => settle(count(n, v.ids) >= v.n, n.allFinal)])),
};

/**
 * The participant's card for live.gameDay: 9 squares, centre free.
 * standing: a leaderboard row (participantId, rosterStats); poolIds: every rostered player id.
 * Each square is { kind, vars } (labels come from app.js: t(`bingo_${kind}`, vars)).
 */
export function makeCard(standing, live, poolIds) {
  const games = live?.games || [];
  if (!games.length) return null;
  const rand = makeRng(`${standing.participantId}|${live.gameDay}`);
  const pick = list => list.splice(Math.floor(rand() * list.length), 1)[0];
  const teams = games.flatMap(g => [g.away.abbrev, g.home.abbrev]);

  // Personal: the participant's skaters playing tonight (forwards: goal or point, defence: point),
  // minus the injured and suspended (live.out, frozen with the day's first live.json)
  const out = new Set(live.out || []);
  const mine = standing.rosterStats.filter(p => p.pos !== "G" && teams.includes(p.team) && !out.has(p.id));
  const personal = [];
  for (const p of seededShuffle(mine, `${standing.participantId}|${live.gameDay}|p`)) {
    const kind = p.pos === "F" && rand() < 0.5 ? "goal" : "point";
    personal.push({ kind, vars: { id: p.id, name: lastName(p.name), team: p.team } });
  }
  const teamSq = seededShuffle(teams, `${standing.participantId}|${live.gameDay}|t`)
    .map((team, i) => ({ kind: i % 2 ? "three" : "win", vars: { team } }));
  const nightSq = seededShuffle(NIGHT, `${standing.participantId}|${live.gameDay}|n`)
    .sort((a, b) => (games.length >= b[1]) - (games.length >= a[1]))  // drawable tonight first
    .map(([id, , rate]) => ({ kind: id, vars: { n: needed(rate, games.length) } }));

  // 3 personal, 2 team, 3 night; whatever runs short is filled from the others
  const chosen = [...personal.splice(0, 3), ...teamSq.splice(0, 2)];
  chosen.push(...nightSq.splice(0, 8 - chosen.length));
  for (const extra of [personal, teamSq, nightSq]) while (chosen.length < 8 && extra.length) chosen.push(extra.shift());
  const squares = [];
  while (chosen.length) squares.push(pick(chosen));
  squares.splice(FREE, 0, { kind: "free", vars: {} });
  return { participantId: standing.participantId, gameDay: live.gameDay, squares, poolIds };
}

/** States (true/false/null per square), completed lines, squares done, and lines still possible. */
export function evaluate(card, live) {
  const n = night(live);
  const states = card.squares.map(sq => (sq.kind === "free" ? true
    : CHECKS[sq.kind](n, { ...sq.vars, ids: card.poolIds })));
  const lines = LINES.filter(l => l.every(i => states[i] === true));
  return {
    states, lines,
    done: states.filter((s, i) => s === true && i !== FREE).length,
    alive: LINES.filter(l => l.every(i => states[i] !== false)).length,
    over: n.allFinal,
  };
}

/** Everyone's results, best first: most lines, then most squares. */
export function race(standings, live, poolIds) {
  const rows = standings.map(s => {
    const card = makeCard(s, live, poolIds);
    return card && { s, card, res: evaluate(card, live) };
  }).filter(Boolean);
  return rows.sort((a, b) => b.res.lines.length - a.res.lines.length || b.res.done - a.res.done || a.s.rank - b.s.rank);
}
