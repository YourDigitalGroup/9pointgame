// =========================================================
// config.js — Supabase connection + shared game config
//
// FILL IN the two values below with YOUR project's values.
// Supabase dashboard -> Project Settings -> API:
//   SUPABASE_URL      = "Project URL"
//   SUPABASE_ANON_KEY = "anon / public" key (NOT service_role)
//
// The anon key is safe to expose publicly — that's what it's
// designed for. It's protected by Row Level Security in the DB.
// NEVER put the service_role key in this file.
// =========================================================

const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

// Shared game definitions, used by both setup and scoring.
const GAME_CONFIG = {
  "3p9": { label: "3-Man / 9-Point", players: 3, points: 9, table: [5, 3, 1] },
  "4p12": { label: "4-Man / 12-Point", players: 4, points: 12, table: [5, 4, 2, 1] },
  "5p15": { label: "5-Man / 15-Point", players: 5, points: 15, table: [5, 4, 3, 2, 1] },
};

const MATCH_LENGTH_CONFIG = {
  6: { label: "6-Hole Matches", matchCount: 3 },
  9: { label: "9-Hole Matches", matchCount: 2 },
  18: { label: "18-Hole Match", matchCount: 1 },
};

// Given a hole number (1-18) and a match length, which match is it in?
function matchNumberForHole(holeNumber, matchLength) {
  return Math.ceil(holeNumber / matchLength);
}

// List of { matchNumber, startHole, endHole } for a given match length.
function getMatchRanges(matchLength) {
  const { matchCount } = MATCH_LENGTH_CONFIG[matchLength];
  const ranges = [];
  for (let i = 0; i < matchCount; i++) {
    ranges.push({
      matchNumber: i + 1,
      startHole: i * matchLength + 1,
      endHole: (i + 1) * matchLength,
    });
  }
  return ranges;
}

// Expose to other scripts (they load as plain scripts / modules).
window.APP = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  GAME_CONFIG,
  MATCH_LENGTH_CONFIG,
  matchNumberForHole,
  getMatchRanges,
};
