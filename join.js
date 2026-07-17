// join.js — validate a room code and send the viewer to the round page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
