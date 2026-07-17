// =========================================================
// scoring.js — the points engine
//
// Pure functions, no Supabase, no DOM. Given a hole's gross
// scores + the round config, it returns each player's points.
// This is the one piece of logic all three games share.
//
// Rules implemented:
//   1. Rank players by gross strokes (low = best).
//   2. Skunk (optional): if the sole leader beats EVERY other
//      player by 2+ strokes, they take all the hole's points.
//   3. Otherwise, walk the points table by rank; tied ranks
//      pool their point slots and split evenly.
//   4. Bonus points (optional): birdie/eagle/ace are added
//      ONLY to a player who also won the hole outright (single
//      lowest score). Off by default.
// =========================================================

/**
 * @param {Array<{playerId: string, strokes: number|null}>} scores
 *        One entry per player. strokes === null means not yet entered.
 * @param {Object} config  round_configs row (points_table, bonus flags…)
 * @param {number} par     par for this hole
 * @returns {Array<{playerId, basePoints, bonusPoints, total}>}
 *          Empty array if not every player has a score yet.
 */
function computeHolePoints(scores, config, par) {
  // Only score a hole once everyone has a stroke count.
  const entered = scores.filter((s) => s.strokes != null);
  if (entered.length !== scores.length || scores.length === 0) {
    return [];
  }

  const pointsTable = config.points_table; // { "1": 5, "2": 4, ... }

  // Sort ascending by strokes (best first).
  const sorted = [...scores].sort((a, b) => a.strokes - b.strokes);

  const lowest = sorted[0].strokes;
  const soleWinners = scores.filter((s) => s.strokes === lowest);
  const hasOutrightWinner = soleWinners.length === 1;

  // Init results.
  const result = {};
  for (const s of scores) {
    result[s.playerId] = { playerId: s.playerId, basePoints: 0, bonusPoints: 0, total: 0 };
  }

  // ---- Skunk check ----
  if (config.skunk_enabled && hasOutrightWinner) {
    const secondLowest = sorted[1].strokes;
    if (secondLowest - lowest >= 2) {
      const totalPoints = Object.values(pointsTable).reduce((a, b) => a + b, 0);
      const winnerId = soleWinners[0].playerId;
      result[winnerId].basePoints = totalPoints;
      // Bonuses still apply to the outright winner if enabled.
      addBonus(result[winnerId], scores.find((s) => s.playerId === winnerId).strokes, par, config);
      finalize(result);
      return Object.values(result);
    }
  }

  // ---- Normal base-point split with tie pooling ----
  // Group players by identical stroke value, in rank order.
  let rank = 1;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].strokes === sorted[i].strokes) {
      j++;
    }
    const groupSize = j - i; // how many players tied at this stroke count
    // Pool the point slots this group occupies: ranks `rank` .. `rank+groupSize-1`
    let pooled = 0;
    for (let r = rank; r < rank + groupSize; r++) {
      pooled += pointsTable[String(r)] ?? 0;
    }
    const share = pooled / groupSize;
    for (let k = i; k < j; k++) {
      result[sorted[k].playerId].basePoints = share;
    }
    rank += groupSize;
    i = j;
  }

  // ---- Bonus points, only for an outright hole winner ----
  if (hasOutrightWinner) {
    const winnerId = soleWinners[0].playerId;
    addBonus(result[winnerId], lowest, par, config);
  }

  finalize(result);
  return Object.values(result);
}

function addBonus(playerResult, strokes, par, config) {
  const toPar = strokes - par;
  if (strokes === 1 && config.bonus_ace_enabled) {
    playerResult.bonusPoints += config.bonus_ace_points;
  } else if (toPar <= -2 && config.bonus_eagle_enabled) {
    playerResult.bonusPoints += config.bonus_eagle_points;
  } else if (toPar === -1 && config.bonus_birdie_enabled) {
    playerResult.bonusPoints += config.bonus_birdie_points;
  }
}

function finalize(result) {
  for (const r of Object.values(result)) {
    r.total = r.basePoints + r.bonusPoints;
  }
}

/**
 * Sum points across a set of holes for each player, for one match
 * (a hole-number range). Returns leaderboard rows sorted by total desc.
 *
 * @param {Array} players       [{id, name}]
 * @param {Array} holes         [{id, hole_number, par}]
 * @param {Object} scoresByHole { holeId: [{playerId, strokes}] }
 * @param {Object} config       round_configs row
 * @param {number} startHole
 * @param {number} endHole
 */
function computeMatchLeaderboard(players, holes, scoresByHole, config, startHole, endHole) {
  const totals = {};
  const thru = {};
  const lastHolePoints = {};
  for (const p of players) {
    totals[p.id] = 0;
    thru[p.id] = 0;
    lastHolePoints[p.id] = 0;
  }

  const matchHoles = holes
    .filter((h) => h.hole_number >= startHole && h.hole_number <= endHole)
    .sort((a, b) => a.hole_number - b.hole_number);

  for (const hole of matchHoles) {
    const holeScores = players.map((p) => {
      const rows = scoresByHole[hole.id] || [];
      const found = rows.find((r) => r.playerId === p.id);
      return { playerId: p.id, strokes: found ? found.strokes : null };
    });

    const pts = computeHolePoints(holeScores, config, hole.par);
    if (pts.length === 0) continue; // hole not complete yet

    for (const r of pts) {
      totals[r.playerId] += r.total;
      thru[r.playerId] += 1;
      lastHolePoints[r.playerId] = r.total;
    }
  }

  const rows = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    total: totals[p.id],
    thru: thru[p.id],
    lastHolePoints: lastHolePoints[p.id],
  }));

  rows.sort((a, b) => b.total - a.total);

  // Assign ranks (ties share a rank).
  let rank = 0;
  let prevTotal = null;
  rows.forEach((row, idx) => {
    if (row.total !== prevTotal) {
      rank = idx + 1;
      prevTotal = row.total;
    }
    row.rank = rank;
  });

  return rows;
}

window.SCORING = { computeHolePoints, computeMatchLeaderboard };
