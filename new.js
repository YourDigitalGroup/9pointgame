// new.js — round setup: pick game/length/players/bonuses, then create.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  GAME_CONFIG,
  MATCH_LENGTH_CONFIG,
  COURSES,
  WAGER_DEFAULTS,
  getMatchRanges,
} = window.APP;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Delete-on-load cleanup: remove rounds finalized more than 24h ago.
async function purgeStaleRounds() {
  const cutoff24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff48 = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  try {
    // Finished rounds: cleared 24h after the final hole.
    await supabase
      .from("rounds")
      .delete()
      .not("finalized_at", "is", null)
      .lt("finalized_at", cutoff24);
    // Abandoned rounds (never finished 18): cleared 48h after creation.
    await supabase
      .from("rounds")
      .delete()
      .is("finalized_at", null)
      .lt("created_at", cutoff48);
  } catch (e) {
    console.warn("purge skipped:", e);
  }
}
purgeStaleRounds();

// ---- State ----
const params = new URLSearchParams(window.location.search);
let gameType = params.get("game");
if (!(gameType in GAME_CONFIG)) gameType = "4p12";
let matchLength = 18;
let courseKey = "";

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
const courseSelect = document.getElementById("course-select");
const courseInfo = document.getElementById("course-info");
const courseInfoText = document.getElementById("course-info-text");
const wagerFields = document.getElementById("wager-fields");

// ---- Course picker ----
function populateCourses() {
  for (const [key, c] of Object.entries(COURSES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${c.name} — ${c.location}`;
    courseSelect.appendChild(opt);
  }
}

function renderCourseInfo() {
  if (!courseKey || !COURSES[courseKey]) {
    courseInfo.hidden = true;
    return;
  }
  const c = COURSES[courseKey];
  const total = c.par.reduce((a, b) => a + b, 0);
  courseInfoText.textContent = `${c.name} · par ${total} · stroke index loaded`;
  courseInfo.hidden = false;
}

courseSelect.addEventListener("change", () => {
  courseKey = courseSelect.value;
  renderCourseInfo();
});

// ---- Wager fields (depend on game type) ----
function renderWager() {
  const d = WAGER_DEFAULTS[gameType];
  if (gameType === "3p9") {
    wagerFields.innerHTML = `
      <label class="wager-row">
        <span class="wager-label">Wager <span class="wager-note">last pays 1st</span></span>
        <span class="wager-input-wrap">$
          <input type="number" min="0" step="1" class="wager-input" id="wager-t1"
            inputmode="numeric" value="${d.tier1}" />
        </span>
      </label>`;
  } else {
    wagerFields.innerHTML = `
      <label class="wager-row">
        <span class="wager-label">Tier 1 <span class="wager-note">${gameType === "4p12" ? "4th→1st" : "5th→1st"}</span></span>
        <span class="wager-input-wrap">$
          <input type="number" min="0" step="1" class="wager-input" id="wager-t1"
            inputmode="numeric" value="${d.tier1}" />
        </span>
      </label>
      <label class="wager-row">
        <span class="wager-label">Tier 2 <span class="wager-note">${gameType === "4p12" ? "3rd→2nd" : "4th→2nd"}</span></span>
        <span class="wager-input-wrap">$
          <input type="number" min="0" step="1" class="wager-input" id="wager-t2"
            inputmode="numeric" value="${d.tier2}" />
        </span>
      </label>`;
  }
}

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
    row.className = "field field-player";
    row.innerHTML = `
      <span class="field-num">${i + 1}</span>
      <input
        type="text"
        class="field-input player-name"
        placeholder="${i === 0 ? "You (scorekeeper)" : "Player " + (i + 1)}"
        autocomplete="off"
      />
      <input
        type="number"
        class="player-hcp"
        inputmode="numeric"
        min="0"
        max="54"
        placeholder="HCP"
        aria-label="Handicap"
      />
    `;
    playerList.appendChild(row);
  }
  renderHcpNote();
}

// Explain how the entered handicap will be applied for the chosen length.
function renderHcpNote() {
  const note = document.getElementById("hcp-note");
  if (!note) return;
  if (matchLength === 6) {
    note.textContent =
      "Enter each player's handicap in the box on the right. In 6-hole matches the handicap is split across the 3 matches, so it must be a multiple of 3 (a 6 → 2 per match).";
  } else if (matchLength === 9) {
    note.textContent =
      "Enter each player's handicap in the box on the right. The full handicap applies to each 9-hole match, landing on the hardest holes.";
  } else {
    note.textContent =
      "Enter each player's handicap in the box on the right. The full handicap applies over all 18 holes, landing on the hardest holes.";
  }
}

function renderAll() {
  renderGameHeader();
  renderLength();
  renderPlayers();
  renderWager();
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
  renderHcpNote();
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
  const handicaps = [...document.querySelectorAll(".player-hcp")].map(
    (el) => Math.min(54, Math.max(0, parseInt(el.value, 10) || 0))
  );

  const config = GAME_CONFIG[gameType];
  const pointsTable = {};
  config.table.forEach((pts, idx) => {
    pointsTable[String(idx + 1)] = pts;
  });

  // 6-hole games split the handicap across 3 matches, so each handicap must
  // be a multiple of 3 (no fractional strokes). Block and explain if not.
  if (matchLength === 6) {
    const bad = [];
    handicaps.forEach((h, i) => {
      if (h > 0 && h % 3 !== 0) bad.push(`${names[i]} (${h})`);
    });
    if (bad.length) {
      errorEl.textContent =
        `6-hole matches divide the handicap by 3, so each must be a multiple of 3 (0, 3, 6, 9, 12…). Fix: ${bad.join(", ")}.`;
      errorEl.hidden = false;
      return;
    }
  }

  createBtn.disabled = true;
  createBtn.textContent = "Creating…";

  try {
    const course = courseKey ? COURSES[courseKey] : null;
    const wagerT1 = Number(document.getElementById("wager-t1")?.value) || 0;
    const wagerT2 = Number(document.getElementById("wager-t2")?.value) || 0;

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
          course_name: course ? course.name : null,
          wager_tier1: wagerT1,
          wager_tier2: wagerT2,
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

    // 3. Players (first is scorekeeper). Return rows so we get their IDs.
    const playerRows = names.map((name, i) => ({
      round_id: round.id,
      name,
      role: i === 0 ? "scorekeeper" : "viewer",
      seat_order: i + 1,
    }));
    const { data: insertedPlayers, error: plErr } = await supabase
      .from("players")
      .insert(playerRows)
      .select();
    if (plErr) throw plErr;

    // 3b. Per-match handicap strokes, derived from each player's handicap.
    //     6-hole game (3 matches): handicap ÷ 3 = strokes per match. Must
    //       divide evenly — non-multiples of 3 are blocked at validation.
    //     9-hole & 18-hole: no division — the full handicap applies to each
    //       match, and strokes land on the hardest holes by stroke index.
    const ranges = getMatchRanges(matchLength);
    const strokeRows = [];
    // insertedPlayers come back in insert order = seat_order order.
    const bySeat = [...insertedPlayers].sort(
      (a, b) => a.seat_order - b.seat_order
    );
    bySeat.forEach((p, i) => {
      const hcp = handicaps[i] || 0;
      const perMatch = matchLength === 6 ? hcp / 3 : hcp;
      if (perMatch > 0) {
        for (const m of ranges) {
          strokeRows.push({
            round_id: round.id,
            player_id: p.id,
            match_number: m.matchNumber,
            strokes: perMatch,
          });
        }
      }
    });
    if (strokeRows.length > 0) {
      const { error: msErr } = await supabase
        .from("match_strokes")
        .insert(strokeRows);
      if (msErr) throw msErr;
    }

    // 4. Holes 1-18 — par + stroke index from the chosen course.
    //    If no course was picked, default par 4 and stroke index in hole order.
    const holeRows = [];
    for (let h = 1; h <= 18; h++) {
      holeRows.push({
        round_id: round.id,
        hole_number: h,
        par: course ? course.par[h - 1] : 4,
        stroke_index: course ? course.si[h - 1] : h,
      });
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

populateCourses();
renderAll();
