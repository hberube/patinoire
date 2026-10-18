// A saved bingo night and the season so far, for the radio show (scripts/radio.py).
// Replays data/bingo.json with the site's own js/bingo.js, the same way the Bingo tab and the
// trophy case do (bingoHistory() in js/app.js), so the show and the site always agree.
//   node scripts/bingo_night.mjs <repo folder> <game day>     -> JSON on stdout
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [root, day] = process.argv.slice(2);
const read = path => readFileSync(join(root, path), "utf8");
// js/bingo.js is a browser module: load it as one whatever this Node treats .js files as
const { race } = await import(`data:text/javascript,${encodeURIComponent(read("js/bingo.js"))}`);
const nights = JSON.parse(read("data/bingo.json")).nights;
const board = JSON.parse(read("data/leaderboard.json")).standings;
const who = id => {
  const s = board.find(x => x.participantId === id);
  return s ? `${s.participantName.split(" ")[0]} (${s.teamName})` : id;
};

let rosters = null, tonight = null;
const season = {};
for (const n of nights) {
  if (n.day > day) break;
  rosters = n.rosters || rosters;
  if (!rosters) continue;
  const standings = Object.entries(rosters).map(([participantId, list]) => ({
    participantId, rank: board.find(x => x.participantId === participantId)?.rank ?? 99,
    rosterStats: list.map(([id, name, pos, team]) => ({ id, name, pos, team })),
  }));
  const live = { gameDay: n.day, games: n.games, out: n.out, goals: n.goals.map(([gameId, team, playerId, assistIds, period, periodType, time, strength, emptyNet]) =>
    ({ gameId, team, playerId, assistIds, period, periodType, time, strength, emptyNet })) };
  const rows = race(standings, live, new Set(standings.flatMap(s => s.rosterStats.map(p => p.id))));
  const top = rows[0]?.res;
  if (!top) continue;
  // Hugo's rule: no line, no winner (same as bingoHistory() in js/app.js)
  const winners = top.lines.length ? rows.filter(r => r.res.lines.length === top.lines.length && r.res.done === top.done) : [];
  for (const r of rows) {
    const x = season[r.s.participantId] ||= { wins: 0, lines: 0 };
    x.lines += r.res.lines.length;
    if (winners.includes(r)) x.wins++;
  }
  if (n.day === day) {
    const line = r => ({ who: who(r.s.participantId), lines: r.res.lines.length, squares: r.res.done });
    const nearMiss = rows.filter(r => !r.res.lines.length).sort((a, b) => b.res.done - a.res.done)[0];
    tonight = {
      winners: winners.map(line),
      noWinner: !winners.length,  // nobody completed a line: no winner, no trophy
      top3: rows.slice(0, 3).map(line),
      last: line(rows.at(-1)),
      nearMiss: nearMiss && nearMiss.res.done >= 4 ? line(nearMiss) : null,
      cards: rows.length,
    };
  }
}

const ranked = Object.entries(season).sort((a, b) => b[1].wins - a[1].wins || b[1].lines - a[1].lines);
console.log(JSON.stringify({
  night: day,
  tonight,
  season: { nights: nights.filter(n => n.day <= day).length,
    leaders: ranked.slice(0, 3).map(([id, x]) => ({ who: who(id), ...x })) },
  // Every team's season lines, for the points tie-breaker (same rule as applyBingoTiebreak in js/app.js)
  linesById: Object.fromEntries(Object.entries(season).map(([id, x]) => [id, x.lines])),
}));
