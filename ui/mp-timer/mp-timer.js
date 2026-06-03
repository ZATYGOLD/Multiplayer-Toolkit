/*
 * Multiplayer Toolkit - Competitive turn timer (enforcement + native display).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine only enforces None/Standard/Dynamic, so the custom "Competitive"
 * type is driven here, derived from the active Age's TURN_SEGMENT_SINGLEPHASE
 * numbers (the per-Age values in data/timers/<age>/CompetitiveTimer.sql).
 *
 * Design: the engine's TurnTimerUpdated event carries its own synced phase
 * clock (elapsedTime), which runs continuously for the whole simultaneous
 * phase regardless of players readying/unreadying. We proxy the action
 * panel's TurnTimerUpdated listener, substitute our total for the fallback
 * 180, and let the engine's own renderer draw the text, colour, flash and
 * ring. Remaining time is total minus the engine's elapsed clock, so action
 * button interaction cannot desync the countdown. When the clock crosses
 * zero, the local turn is ended (and re-ended if the player unreadies).
 *
 * The action panel can re-attach when the player interacts with the HUD,
 * which re-registers the engine's original listener and re-poisons the ring
 * latch. A periodic guardian keeps the takeover in place, and the proxy
 * self-heals the ring whenever the latch exceeds our total.
 */

const COMPETITIVE_HASH = Database.makeHash('MPT_TURNTIMER_COMPETITIVE');
const ENFORCE_RETRY_SECONDS = 2;
const GUARDIAN_MS = 300;

let panelInstance = null;
let panelOriginalTimer = null;
let proxyInstalled = false;

let total = 0;
let lastElapsed = Infinity;
let lastEnforceAt = -Infinity;

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

function localPlayerTurnActive() {
  try {
    const player = Players.get(GameContext.localPlayerID);
    return !!(player && player.isTurnActive);
  } catch (e) { return false; }
}

/** Engine's timer handler, fed our total when Competitive is active. */
function timerProxy(data) {
  if ((data?.phaseTimeLimit ?? 0) > 0 && isCompetitiveSelected()) {
    const elapsed = data.elapsedTime ?? 0;
    if (elapsed < lastElapsed) {
      // Phase clock restarted -> new turn: retune and re-size the ring.
      total = computeSeconds();
      if (panelInstance) panelInstance.mpTimerMaxTime = 0;
      lastEnforceAt = -Infinity;
    }
    lastElapsed = elapsed;
    if (total > 0) {
      // Self-heal: a stray engine render can re-latch the ring to 180; the
      // latch only grows, so clear it and the next draw re-sizes to our total
      // at the correct fill position.
      if (panelInstance && panelInstance.mpTimerMaxTime > total) {
        panelInstance.mpTimerMaxTime = 0;
      }
      data = { ...data, phaseTimeLimit: total };
      const expired = total - elapsed <= 0;
      if (expired && elapsed - lastEnforceAt >= ENFORCE_RETRY_SECONDS && localPlayerTurnActive()) {
        lastEnforceAt = elapsed;
        try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
      }
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
  }
  try { engine.off('TurnTimerUpdated', panelOriginalTimer, panelInstance); } catch (e) { /* not registered */ }
  if (!proxyInstalled) {
    try {
      engine.on('TurnTimerUpdated', timerProxy, panelInstance);
      proxyInstalled = true;
    } catch (e) { /* retry on next sweep */ }
  }
}

enforceTakeover();
setInterval(enforceTakeover, GUARDIAN_MS);
