// new.js — round setup: pick game/length/players/bonuses, then create.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  GAME_CONFIG,
  MATCH_LENGTH_CONFIG,
  getMatchRanges,
} = window.APP;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- State ----
const params = new URLSearchParams(window.location.search);
let gameType = params.get("game");
if (!(gameType in GAME_CONFIG)) gameType = "4p12";
let matchLength = 18;

// ---- Elements ----
const titleEl = document.getElementById("game-title");
const descEl = document.getElementById("game-desc");
const gameChips = document.getElementById("game-chips");
const lengthChips = document.getElementById("length-chips");
const lengthSummary = document.getElementById("length-summary");
const playersSub = document.getElementById("players-sub");
const playerList = document.getElementById("player-list");
const createBtn = document.getElementById("create-btn");
const errorEl = document.getElementById("setup-error");

// ---- Render helpers ----
function renderGameHeader() {
  const c = GAME_CONFIG[gameType];
  titleEl.textContent = c.label;
  descEl.textContent = `${c.points} points split each hole · base table ${c.table.join("-")}`;
  playersSub.textContent = `You'll be the scorekeeper. Add the other ${c.players - 1} golfers — they'll join as live viewers with the round code.`;

  [...gameChips.children].forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.game === gameType);
  });
}

function renderLength() {
  [...lengthChips.children].forEach((chip) => {
    chip.classList.toggle("is-active", Number(chip.dataset.length) === matchLength);
  });

  const c = GAME_CONFIG[gameType];
  const ranges = getMatchRanges(matchLength);
  const count = MATCH_LENGTH_CONFIG[matchLength].matchCount;

  if (count === 1) {
    lengthSummary.textContent = `One match · holes 1–18 · single ${c.points}-point winner`;
  } else {
    const list = ranges
      .map((m) => `Match ${m.matchNumber} (${m.startHole}-${m.endHole})`)
      .join(" · ");
    lengthSummary.textContent = `${count} matches, each a standalone ${c.points}-point game: ${list}`;
  }
}

function renderPlayers() {
  const c = GAME_CONFIG[gameType];
  playerList.innerHTML = "";
  for (let i = 0; i < c.players; i++) {
    const row = document.createElement("div");
    row.className = "field";
    row.innerHTML = `
      <span class="field-num">${i + 1}</span>
      <input
        type="text"
        class="field-input player-name"
        placeholder="${i === 0 ? "You (scorekeeper)" : "Player " + (i + 1)}"
        autocomplete="off"
      />
    `;
    playerList.appendChild(row);
  }
}

function renderAll() {
  renderGameHeader();
  renderLength();
  renderPlayers();
}

// ---- Interactions ----
gameChips.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-game]");
  if (!chip) return;
  gameType = chip.dataset.game;
  renderAll();
});

lengthChips.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-length]");
  if (!chip) return;
  matchLength = Number(chip.dataset.length);
  renderLength();
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

// Human-friendly room code, e.g. "GLF-4827".
function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let a = "";
  for (let i = 0; i < 3; i++) a += letters[Math.floor(Math.random() * letters.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${a}-${n}`;
}

createBtn.addEventListener("click", async () => {
  errorEl.hidden = true;

  const names = [...document.querySelectorAll(".player-name")].map((el, i) =>
    el.value.trim() || (i === 0 ? "Scorekeeper" : `Player ${i + 1}`)
  );

  const config = GAME_CONFIG[gameType];
  const pointsTable = {};
  config.table.forEach((pts, idx) => {
    pointsTable[String(idx + 1)] = pts;
  });

  createBtn.disabled = true;
  createBtn.textContent = "Creating…";

  try {
    // 1. Round (retry a couple times on the tiny chance of a code clash).
    let round = null;
    for (let attempt = 0; attempt < 3 && !round; attempt++) {
      const roomCode = makeRoomCode();
      const { data, error } = await supabase
        .from("rounds")
        .insert({
          room_code: roomCode,
          game_type: gameType,
          match_length: matchLength,
          status: "active",
        })
        .select()
        .single();
      if (!error) round = data;
      else if (!String(error.message).includes("duplicate")) throw error;
    }
    if (!round) throw new Error("Could not generate a unique room code. Try again.");

    // 2. Config
    const { error: cfgErr } = await supabase.from("round_configs").insert({
      round_id: round.id,
      points_table: pointsTable,
      tie_rule: "combine_split_even",
      bonus_birdie_enabled: document.getElementById("bonus-birdie").checked,
      bonus_eagle_enabled: document.getElementById("bonus-eagle").checked,
      bonus_ace_enabled: document.getElementById("bonus-ace").checked,
      skunk_enabled: document.getElementById("bonus-skunk").checked,
    });
    if (cfgErr) throw cfgErr;

    // 3. Players (first is scorekeeper)
    const playerRows = names.map((name, i) => ({
      round_id: round.id,
      name,
      role: i === 0 ? "scorekeeper" : "viewer",
      seat_order: i + 1,
    }));
    const { error: plErr } = await supabase.from("players").insert(playerRows);
    if (plErr) throw plErr;

    // 4. Holes 1-18, default par 4 (scorekeeper can adjust during play).
    const holeRows = [];
    for (let h = 1; h <= 18; h++) {
      holeRows.push({ round_id: round.id, hole_number: h, par: 4 });
    }
    const { error: hErr } = await supabase.from("holes").insert(holeRows);
    if (hErr) throw hErr;

    // Mark this browser as the scorekeeper for this round.
    localStorage.setItem(`scorekeeper:${round.room_code}`, "1");

    window.location.href = `round.html?code=${encodeURIComponent(round.room_code)}`;
  } catch (err) {
    console.error(err);
    showError(err.message || "Something went wrong creating the round.");
    createBtn.disabled = false;
    createBtn.textContent = "Create Round & Get Code";
  }
});

renderAll();
