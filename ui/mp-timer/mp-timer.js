/*
 * Multiplayer Toolkit - Competitive turn timer (enforcement + native display).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine only enforces None/Standard/Dynamic, so the custom "Competitive"
 * type is driven here, derived from the active Age's TURN_SEGMENT_SINGLEPHASE
 * numbers (the per-Age values in data/timers/<age>/CompetitiveTimer.sql).
 *
 * Design: we proxy the action panel's TurnTimerUpdated listener, substitute
 * our total for the engine's fallback 180, and let the engine's own renderer
 * draw the text, colour, flash and ring. Remaining time derives from the
 * engine's synced phase clock, with care taken around its quirks:
 *  - the clock is client-extrapolated and can be corrected backwards, so new
 *    turns are detected via Game.turn (never clock regression) and the
 *    display is pinned at zero once expired;
 *  - the ring meter only grows, so its latch is cleared per turn and whenever
 *    a stray render or ready-up delay reset desyncs it;
 *  - phases with large limits (age transition) are passed through untouched.
 */

const COMPETITIVE_HASH = Database.makeHash('MPT_TURNTIMER_COMPETITIVE');
const ENFORCE_RETRY_SECONDS = 2;
const GUARDIAN_MS = 200;
const FLASH_START = 20;        // engine flashes below this many seconds
const STEADY_FLASH = true;     // keep the flash colour on odd seconds (no white blink)
const MAX_PROXY_LIMIT = 600;   // pass through bigger phases (age transition = 3000s)
const CLOCK_JITTER_S = 1.0;    // backward corrections smaller than this are ignored
const DEBUG = true;

function log(message) {
  if (DEBUG) console.log(`[MPT timer] ${message}`);
}

let panelInstance = null;
let panelOriginalTimer = null;
let proxyInstalled = false;

let total = 0;
let lastTurn = -1;
let expiredAt = -1;
let lastEnforceAt = -Infinity;
let ringSetAt = Infinity;

function isCompetitiveSelected() {
  try { return Configuration.getGame().turnTimerType === COMPETITIVE_HASH; }
  catch (e) { return false; }
}

function currentTurn() {
  try { return Game.turn ?? -1; } catch (e) { return -1; }
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

function localPlayerTurnActive() {
  try {
    const player = Players.get(GameContext.localPlayerID);
    return !!(player && player.isTurnActive);
  } catch (e) { return false; }
}

/**
 * True when the ring no longer reflects our timer: a stray render re-sized it,
 * the ready-up handler reset its delay, or the clock was corrected back past
 * the point the ring was last synced.
 */
function ringDesynced(elapsed) {
  if (!panelInstance) return false;
  if (panelInstance.mpTimerMaxTime > total) return true;
  if (elapsed + CLOCK_JITTER_S < ringSetAt) return true;
  const ring = panelInstance.timerAnimationElements?.[0];
  if (!ring) return false;
  if (ring.style.animationDuration !== `${total}s`) return true;
  return elapsed > 1.5 && ring.style.animationDelay === '0s';
}

function clearRingLatch(elapsed) {
  if (!panelInstance) return;
  panelInstance.mpTimerMaxTime = 0;
  ringSetAt = elapsed;
}

/** Keep the flash colour on odd seconds; the engine leaves them unstyled. */
function steadyFlash(remainingFloat) {
  const remaining = Math.max(0, Math.round(remainingFloat));
  if (remaining >= FLASH_START || remaining % 2 === 0) return;
  if (!localPlayerTurnActive()) return;
  const el = document.getElementById('action_panel__mp-turntimer');
  if (!el || el.textContent !== String(remaining)) return;
  try {
    el.innerHTML = Locale.stylize(`[STYLE:screen-turntimer_text_turn_active_flash]${remaining}[/STYLE]`);
  } catch (e) { /* keep the engine's default */ }
}

/** Engine's timer handler, fed our total when Competitive is active. */
function timerProxy(data) {
  const limit = data?.phaseTimeLimit ?? 0;
  if (limit > 0 && limit <= MAX_PROXY_LIMIT && isCompetitiveSelected()) {
    const turn = currentTurn();
    if (turn !== lastTurn) {
      lastTurn = turn;
      total = computeSeconds();
      expiredAt = -1;
      lastEnforceAt = -Infinity;
      clearRingLatch(0);
      log(`turn ${turn}: total=${total}s`);
    }
    if (total > 0) {
      const elapsed = data.elapsedTime ?? 0;
      if (ringDesynced(elapsed)) {
        clearRingLatch(elapsed);
        log(`ring resync at ${Math.round(elapsed)}s elapsed`);
      }
      if (expiredAt < 0 && total - elapsed <= 0) expiredAt = elapsed;
      // Pin at zero once expired so backward clock corrections can't bounce
      // the display back up (e.g. 0 -> 2 -> 0).
      const effectiveElapsed = expiredAt >= 0 ? Math.max(elapsed, total) : elapsed;
      data = { ...data, phaseTimeLimit: total, elapsedTime: effectiveElapsed };
      if (expiredAt >= 0 && elapsed - lastEnforceAt >= ENFORCE_RETRY_SECONDS && localPlayerTurnActive()) {
        lastEnforceAt = elapsed;
        log(`time expired at ${Math.round(elapsed)}s - ending local turn`);
        try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
      }
      try { panelOriginalTimer.call(panelInstance, data); } catch (e) { /* ignore */ }
      if (STEADY_FLASH) steadyFlash(total - effectiveElapsed);
      return;
    }
  }
  try { panelOriginalTimer.call(panelInstance, data); } catch (e) { /* ignore */ }
}

/**
 * Keep the takeover in place: strip the engine's direct listener whenever a
 * panel (re)attach restores it, and follow the instance if it was recreated.
 */
function enforceTakeover() {
  const panel = document.querySelector('panel-action')?.maybeComponent;
  if (!panel || typeof panel.onTurnTimerUpdated !== 'function') return;
  if (panel !== panelInstance) {
    panelInstance = panel;
    panelOriginalTimer = panel.onTurnTimerUpdated;
    log('bound to action panel instance');
  }
  try { engine.off('TurnTimerUpdated', panelOriginalTimer, panelInstance); } catch (e) { /* not registered */ }
  if (!proxyInstalled) {
    try {
      engine.on('TurnTimerUpdated', timerProxy, panelInstance);
      proxyInstalled = true;
      log('timer takeover installed');
    } catch (e) { /* retry on next sweep */ }
  }
}

enforceTakeover();
setInterval(enforceTakeover, GUARDIAN_MS);
