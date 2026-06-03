/*
 * Multiplayer Toolkit - Competitive turn timer (enforcement + display).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine only enforces None/Standard/Dynamic, so the custom "Competitive"
 * type is driven here. When it is the selected timer, each client runs its own
 * countdown derived from the active Age's TURN_SEGMENT_SINGLEPHASE numbers
 * (the per-Age values in data/timers/<age>/CompetitiveTimer.sql) and ends the
 * local turn on expiry. Deterministic: all clients derive the same time from
 * synced state.
 *
 * The engine still paints its own fallback countdown for the unknown type, so
 * we overwrite that element with the real remaining time (a MutationObserver
 * re-asserts our value whenever the engine repaints it).
 */

const COMPETITIVE_HASH = Database.makeHash('MPT_TURNTIMER_COMPETITIVE');
const TIMER_ELEMENT_ID = 'action_panel__mp-turntimer';

let countdownHandle = 0;
let remaining = 0;
let displayObserver = null;

function isCompetitiveSelected() {
  try { return Configuration.getGame().turnTimerType === COMPETITIVE_HASH; }
  catch (e) { return false; }
}

/** TimeLimit_Base/PerCity/PerUnit for the active simultaneous segment. */
function segmentLimits() {
  try {
    const rows = Database.query('gameplay',
      "SELECT TimeLimit_Base AS base, TimeLimit_PerCity AS perCity, TimeLimit_PerUnit AS perUnit " +
      "FROM TurnSegments WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE'") ?? [];
    return rows[0] ?? null;
  } catch (e) { return null; }
}

/** Largest city and unit counts among living major players (synced globally). */
function maxCountsAcrossPlayers() {
  let cities = 0, units = 0;
  try {
    for (const entry of Players.getAlive()) {
      const player = (entry && entry.isMajor !== undefined) ? entry : Players.get(entry);
      if (!player || !player.isMajor) continue;
      cities = Math.max(cities, player.Cities?.getCities()?.length ?? 0);
      units = Math.max(units, player.Units?.getUnits()?.length ?? 0);
    }
  } catch (e) { /* fall back to zeros */ }
  return { cities, units };
}

/** Competitive seconds for this turn; 0 if the segment data is unavailable. */
function computeSeconds() {
  const limit = segmentLimits();
  if (!limit) return 0;
  const { cities, units } = maxCountsAcrossPlayers();
  return limit.base + (limit.perCity * cities) + (limit.perUnit * units);
}

/** Overwrite the engine's fallback countdown with our real remaining time. */
function paintTimer() {
  const el = document.getElementById(TIMER_ELEMENT_ID);
  if (!el || remaining <= 0) return;
  const text = String(remaining);
  if (el.textContent !== text) el.innerHTML = text;
}

/** Re-assert our value whenever the engine repaints the element. */
function watchDisplay() {
  if (displayObserver) return;
  const el = document.getElementById(TIMER_ELEMENT_ID);
  if (!el) return;
  try {
    displayObserver = new MutationObserver(paintTimer);
    displayObserver.observe(el, { childList: true, characterData: true, subtree: true });
  } catch (e) { /* observer unavailable; interval still repaints */ }
}

function stopCountdown() {
  if (countdownHandle) { clearInterval(countdownHandle); countdownHandle = 0; }
  remaining = 0;
}

function onLocalPlayerTurnBegin() {
  stopCountdown();
  if (!isCompetitiveSelected()) return;
  remaining = computeSeconds();
  if (remaining <= 0) return;
  watchDisplay();
  paintTimer();
  countdownHandle = setInterval(() => {
    remaining -= 1;
    paintTimer();
    if (remaining <= 0) {
      stopCountdown();
      try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
    }
  }, 1000);
}

engine.on('LocalPlayerTurnBegin', onLocalPlayerTurnBegin);
engine.on('LocalPlayerTurnEnd', stopCountdown);
