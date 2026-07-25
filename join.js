// join.js — validate a room code and send the viewer to the round page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

if (!window.APP) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="margin:24px;padding:16px;border:2px solid #c8202f;border-radius:8px;color:#c8202f;font-weight:600;font-family:sans-serif;">This page can\'t load its configuration (config.js). Re-upload config.js, then hard-refresh.</div>';
  });
  throw new Error("Missing window.APP");
}

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP;
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

const form = document.getElementById("join-form");
const input = document.getElementById("code-input");
const errorEl = document.getElementById("join-error");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const code = input.value.trim().toUpperCase();
  if (!code) {
    showError("Enter a round code to join.");
    return;
  }

  // Confirm the round exists before navigating.
  const { data, error } = await supabase
    .from("rounds")
    .select("room_code")
    .eq("room_code", code)
    .maybeSingle();

  if (error) {
    showError("Couldn't reach the server. Check your connection and try again.");
    return;
  }
  if (!data) {
    showError("No round found with that code. Double-check it with your scorekeeper.");
    return;
  }

  window.location.href = `round.html?code=${encodeURIComponent(code)}`;
});
