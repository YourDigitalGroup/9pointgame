// round.js — live leaderboard + scorekeeper score entry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  GAME_CONFIG,
  getMatchRanges,
} = window.APP;
const { computeMatchLeaderboard } = window.SCORING;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Which round + am I the scorekeeper? ----
const params = new URLSearchParams(window.location.search);
const roomCode = (params.get("code") || "").toUpperCase();
const isScorekeeper = localStorage.getItem(`scorekeeper:${roomCode}`) === "1";

// ---- Elements ----
const codeEl = document.getElementById("round-code");
const metaEl = document.getElementById("round-meta");
const stackEl = document.getElementById("plaque-stack");
const loadingMsg = document.getElementById("loading-msg");
const shareBtn = document.getElementById("share-btn");
const scoreEntryEl = document.getElementById("score-entry");
const holeSection = document.getElementById("hole-section");
const holeSectionTitle = document.getElementById("hole-section-title");
const holeTable = document.getElementById("hole-table");

// ---- In-memory state ----
let round = null;
let config = null;
let players = [];
let holes = [];
let scoresByHole = {}; // { holeId: [{playerId, strokes}] }

// ---- Load everything ----
async function loadRound() {
  const { data: r, error } = await supabase
    .from("rounds")
    .select("*")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (error || !r) {
    loadingMsg.textContent = "Couldn't find that round. Check the code and try again.";
    return false;
  }
  round = r;

  const [{ data: cfg }, { data: pl }, { data: hl }] = await Promise.all([
    supabase.from("round_configs").select("*").eq("round_id", round.id).single(),
    supabase.from("players").select("*").eq("round_id", round.id).order("seat_order"),
    supabase.from("holes").select("*").eq("round_id", round.id).order("hole_number"),
  ]);
  config = cfg;
  players = pl || [];
  holes = hl || [];

  const holeIds = holes.map((h) => h.id);
  const { data: scoreRows } = await supabase
    .from("scores")
    .select("*")
    .in("hole_id", holeIds.length ? holeIds : ["none"]);

  scoresByHole = {};
  for (const s of scoreRows || []) {
    (scoresByHole[s.hole_id] ||= []).push({
      playerId: s.player_id,
      strokes: s.gross_strokes,
    });
  }
  return true;
}

// ---- Render leaderboard: one plaque per match ----
function currentMatchNumber() {
  // The first match that still has an unscored hole is "live".
  const ranges = getMatchRanges(round.match_length);
  for (const m of ranges) {
    const matchHoles = holes.filter(
      (h) => h.hole_number >= m.startHole && h.hole_number <= m.endHole
    );
    const allDone = matchHoles.every((h) => {
      const rows = scoresByHole[h.id] || [];
      return rows.length === players.length;
    });
    if (!allDone) return m.matchNumber;
  }
  return ranges[ranges.length - 1].matchNumber; // all done -> last match
}

function matchStatus(m, liveMatchNo) {
  const matchHoles = holes.filter(
    (h) => h.hole_number >= m.startHole && h.hole_number <= m.endHole
  );
  const anyScored = matchHoles.some((h) => (scoresByHole[h.id] || []).length > 0);
  const allDone =
    matchHoles.length > 0 &&
    matchHoles.every((h) => (scoresByHole[h.id] || []).length === players.length);

  if (allDone) return "final";
  if (m.matchNumber === liveMatchNo && anyScored) return "live";
  if (m.matchNumber === liveMatchNo) return "live";
  if (anyScored) return "live";
  return "upcoming";
}

function renderLeaderboard() {
  const gameLabel = GAME_CONFIG[round.game_type].label;
  const ranges = getMatchRanges(round.match_length);
  codeEl.textContent = round.room_code;
  metaEl.textContent =
    ranges.length === 1
      ? `${gameLabel} · 18-hole match`
      : `${gameLabel} · ${ranges.length} matches this round`;

  const liveMatchNo = currentMatchNumber();
  stackEl.innerHTML = "";

  for (const m of ranges) {
    const rows = computeMatchLeaderboard(
      players,
      holes,
      scoresByHole,
      config,
      m.startHole,
      m.endHole
    );
    const status = matchStatus(m, liveMatchNo);
    stackEl.appendChild(renderPlaque(m, rows, status));
  }

  renderHoleTable(liveMatchNo);
}

function renderPlaque(match, rows, status) {
  const plaque = document.createElement("div");
  plaque.className = "plaque" + (status === "upcoming" ? " is-upcoming" : "");

  let statusHtml = "";
  if (status === "live") {
    statusHtml = `<span class="status status-live"><span class="live-dot"></span>Live</span>`;
  } else if (status === "final") {
    statusHtml = `<span class="status status-final">Final</span>`;
  } else {
    statusHtml = `<span class="status status-upcoming">Upcoming</span>`;
  }

  const head = `
    <div class="plaque-head">
      <div>
        <div class="plaque-title">Match ${match.matchNumber}</div>
        <div class="plaque-sub">Holes ${match.startHole}-${match.endHole}</div>
      </div>
      ${statusHtml}
    </div>
  `;

  const body = rows
    .map((row) => {
      const meta =
        status === "upcoming"
          ? "Not started"
          : `Thru ${row.thru} · +${row.lastHolePoints} last hole`;
      const leader = row.rank === 1 && row.total > 0 ? " is-leader" : "";
      return `
        <div class="plaque-row">
          <div class="rank-badge${leader}">${row.rank}</div>
          <div class="plaque-name">
            <div class="plaque-player">${escapeHtml(row.name)}</div>
            <div class="plaque-meta">${meta}</div>
          </div>
          <div class="plaque-total tabular">${formatPts(row.total)}</div>
        </div>
      `;
    })
    .join("");

  plaque.innerHTML = head + body;
  return plaque;
}

// ---- Hole-by-hole table for the live match ----
function renderHoleTable(liveMatchNo) {
  const ranges = getMatchRanges(round.match_length);
  const m = ranges.find((r) => r.matchNumber === liveMatchNo);
  if (!m) return;

  const matchHoles = holes
    .filter((h) => h.hole_number >= m.startHole && h.hole_number <= m.endHole)
    .sort((a, b) => a.hole_number - b.hole_number);

  const scoredHoles = matchHoles.filter(
    (h) => (scoresByHole[h.id] || []).length === players.length
  );
  if (scoredHoles.length === 0) {
    holeSection.hidden = true;
    return;
  }
  holeSection.hidden = false;
  holeSectionTitle.textContent = `Hole by Hole — Match ${liveMatchNo}`;

  const header =
    `<tr><th>Hole</th><th>Par</th>` +
    players.map((p) => `<th class="num">${escapeHtml(shortName(p.name))}</th>`).join("") +
    `</tr>`;

  const bodyRows = scoredHoles
    .map((h) => {
      const holeScores = players.map((p) => {
        const rows = scoresByHole[h.id] || [];
        const f = rows.find((r) => r.playerId === p.id);
        return { playerId: p.id, strokes: f ? f.strokes : null };
      });
      const pts = window.SCORING.computeHolePoints(holeScores, config, h.par);
      const byId = {};
      pts.forEach((r) => (byId[r.playerId] = r.total));
      const cells = players
        .map((p) => `<td class="num">${formatPts(byId[p.id] ?? 0)}</td>`)
        .join("");
      return `<tr><td>${h.hole_number}</td><td>${h.par}</td>${cells}</tr>`;
    })
    .join("");

  holeTable.innerHTML = `<thead>${header}</thead><tbody>${bodyRows}</tbody>`;
}

// ---- Scorekeeper entry ----
function renderScoreEntry() {
  if (!isScorekeeper) return;

  const nextHole = holes.find(
    (h) => (scoresByHole[h.id] || []).length < players.length
  );
  if (!nextHole) {
    scoreEntryEl.innerHTML = `
      <div class="setup-group bordered">
        <h2 class="setup-h">All 18 holes scored</h2>
        <p class="setup-sub">The round is complete. Final totals are above.</p>
      </div>`;
    return;
  }

  scoreEntryEl.innerHTML = `
    <div class="entry-card">
      <div class="entry-head">
        <div class="entry-hole">
          <span class="entry-hole-label">Now Scoring</span>
          <span class="entry-hole-num">Hole ${nextHole.hole_number}</span>
        </div>
        <label class="entry-par">
          Par
          <input type="number" id="par-input" class="entry-par-input"
            min="3" max="6" value="${nextHole.par}" inputmode="numeric" />
        </label>
      </div>

      <div class="entry-players">
        ${players
          .map(
            (p) => `
          <div class="entry-row">
            <span class="entry-name">${escapeHtml(p.name)}</span>
            <div class="stepper">
              <button type="button" class="step-btn step-minus"
                data-player="${p.id}" aria-label="Fewer strokes">&minus;</button>
              <input type="number" inputmode="numeric" min="1" max="20"
                class="step-value entry-strokes" data-player="${p.id}"
                placeholder="—" />
              <button type="button" class="step-btn step-plus"
                data-player="${p.id}" aria-label="More strokes">+</button>
            </div>
          </div>`
          )
          .join("")}
      </div>

      <p class="form-error" id="entry-error" hidden></p>

      <button type="button" class="btn btn-crimson btn-block btn-lg entry-save"
        id="save-hole">
        Save Hole ${nextHole.hole_number}
      </button>
    </div>
  `;

  // Stepper +/- buttons adjust the adjacent value.
  scoreEntryEl.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.player;
      const input = scoreEntryEl.querySelector(
        `.entry-strokes[data-player="${id}"]`
      );
      let v = parseInt(input.value, 10);
      if (Number.isNaN(v)) v = nextHole.par; // first tap seeds from par
      v += btn.classList.contains("step-plus") ? 1 : -1;
      if (v < 1) v = 1;
      if (v > 20) v = 20;
      input.value = v;
    });
  });

  document.getElementById("save-hole").addEventListener("click", () =>
    saveHole(nextHole)
  );
}

async function saveHole(hole) {
  const errEl = document.getElementById("entry-error");
  errEl.hidden = true;

  const inputs = [...document.querySelectorAll(".entry-strokes")];
  const par = Number(document.getElementById("par-input").value) || hole.par;

  const entries = inputs.map((el) => ({
    player_id: el.dataset.player,
    strokes: Number(el.value),
  }));

  if (entries.some((e) => !e.strokes || e.strokes < 1)) {
    errEl.textContent = "Enter strokes for every player before saving.";
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById("save-hole");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    // Update par if the scorekeeper changed it.
    if (par !== hole.par) {
      await supabase.from("holes").update({ par }).eq("id", hole.id);
    }
    const rows = entries.map((e) => ({
      hole_id: hole.id,
      player_id: e.player_id,
      gross_strokes: e.strokes,
    }));
    const { error } = await supabase.from("scores").insert(rows);
    if (error) throw error;
    // Realtime will refresh everyone, including us.
  } catch (err) {
    console.error(err);
    errEl.textContent = err.message || "Couldn't save. Try again.";
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = `Save Hole ${hole.hole_number}`;
  }
}

// ---- Realtime: refetch scores on any change to this round ----
function subscribeRealtime() {
  supabase
    .channel(`round-${round.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "scores" },
      async () => {
        await refreshScores();
        renderLeaderboard();
        renderScoreEntry();
      }
    )
    .subscribe();
}

async function refreshScores() {
  const holeIds = holes.map((h) => h.id);
  const { data: scoreRows } = await supabase
    .from("scores")
    .select("*")
    .in("hole_id", holeIds.length ? holeIds : ["none"]);
  scoresByHole = {};
  for (const s of scoreRows || []) {
    (scoresByHole[s.hole_id] ||= []).push({
      playerId: s.player_id,
      strokes: s.gross_strokes,
    });
  }
}

// ---- Share button ----
shareBtn.addEventListener("click", async () => {
  const url = window.location.href;
  const text = `Join my round on 9 Point Game — code ${roomCode}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "9 Point Game", text, url });
    } catch {}
  } else {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    shareBtn.textContent = "Copied";
    setTimeout(() => (shareBtn.textContent = "Share"), 1500);
  }
});

// ---- Small helpers ----
function shortName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}
function formatPts(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- Boot ----
(async function init() {
  if (!roomCode) {
    loadingMsg.textContent = "No round code in the link.";
    return;
  }
  const ok = await loadRound();
  if (!ok) return;
  renderLeaderboard();
  renderScoreEntry();
  subscribeRealtime();
})();
