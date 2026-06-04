/*
 * Multiplayer Toolkit - Competitive turn timer (enforcement + native display).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine only enforces None/Standard/Dynamic, so the custom "Competitive"
 * type is driven here, derived from the active Age's TURN_SEGMENT_SINGLEPHASE
 * numbers plus the MPT_TimerScaling values (both set per Age in
 * data/timers/<age>/CompetitiveTimer.sql):
 *
 *   seconds = Base + PerCity*cities + PerUnit*units
 *           + PerHuman*humanPlayers + PerTurn*turnNumber
 *
 * Design: we proxy the action panel's TurnTimerUpdated listener, substitute
 * our total for the engine's fallback 180, and let the engine's own renderer
 * draw the text and ring. Remaining time derives from the engine's synced
 * phase clock (new turns detected via Game.turn, never clock regression;
 * display pinned at zero once expired; large phases like age transition are
 * passed through untouched).
 *
 * Tiers: the engine hardcodes its red flash + per-second beeps below 20s, so
 * while remaining is above FLASH_START we clamp what it perceives to keep it
 * calm, then paint the tiers ourselves:
 *   ORANGE_START..FLASH_START+1  orange text, warning sound every 5s
 *   FLASH_START..0               engine's red flash + per-second beeps
 */

const COMPETITIVE_HASH = Database.makeHash('MPT_TURNTIMER_COMPETITIVE');
const ENFORCE_RETRY_SECONDS = 2;
const GUARDIAN_MS = 200;
const ORANGE_START = 30;        // orange tier begins at this many seconds
const FLASH_START = 15;         // red flash + per-second beeps begin here
const WARN_EVERY = 5;           // orange-tier warning sound cadence
const ORANGE_COLOR = 'rgb(255, 155, 40)';
const ENGINE_FLASH_HIDE = 21;   // perceived remaining while muzzling the engine (its threshold is 20)
const STEADY_FLASH = true;      // keep the flash colour on odd seconds (no white blink)
const MAX_PROXY_LIMIT = 600;    // pass through bigger phases (age transition = 3000s)
const CLOCK_JITTER_S = 1.0;     // backward corrections smaller than this are ignored
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
let lastWarnTick = Infinity;

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

/** PerHuman/PerTurn scaling for the active Age; zeros when absent. */
function scalingValues() {
  try {
    const rows = Database.query('gameplay',
      "SELECT PerHuman AS perHuman, PerTurn AS perTurn FROM MPT_TimerScaling") ?? [];
    return rows[0] ?? { perHuman: 0, perTurn: 0 };
  } catch (e) { return { perHuman: 0, perTurn: 0 }; }
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

/** Living human major players (synced globally). */
function humanMajorCount() {
  let humans = 0;
  try {
    for (const entry of Players.getAlive()) {
      const player = (entry && entry.isHuman !== undefined) ? entry : Players.get(entry);
      if (player && player.isHuman && player.isMajor) humans++;
    }
  } catch (e) { /* fall back to zero */ }
  return humans;
}

/** Competitive seconds for this turn; 0 if the segment data is unavailable. */
function computeSeconds() {
  const limit = segmentLimits();
  if (!limit) return 0;
  const { cities, units } = maxCountsAcrossPlayers();
  const { perHuman, perTurn } = scalingValues();
  return limit.base
    + (limit.perCity * cities)
    + (limit.perUnit * units)
    + (perHuman * humanMajorCount())
    + (perTurn * Math.max(0, currentTurn()));
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

/**
 * Tier styling on top of the engine's render. While the engine is muzzled
 * (16..20s shows its clamped number) the text is always rewritten; the orange
 * tier uses an inline colour, and the red tier keeps a steady flash colour.
 */
function decorateText(n) {
  const el = document.getElementById('action_panel__mp-turntimer');
  if (!el) return;
  const active = localPlayerTurnActive();
  const beforeExpiry = expiredAt < 0;
  if (active && beforeExpiry && n <= ORANGE_START && n > FLASH_START) {
    if (el.style.color !== ORANGE_COLOR) el.style.color = ORANGE_COLOR;
    if (el.textContent !== String(n) || el.firstElementChild) el.textContent = String(n);
    return;
  }
  if (el.style.color) el.style.color = '';
  const engineShowsClamp = beforeExpiry && n > FLASH_START && n < ENGINE_FLASH_HIDE;
  if (!active && engineShowsClamp) {
    try { el.innerHTML = Locale.stylize(`[STYLE:screen-turntimer_text_turn_inactive]${n}[/STYLE]`); }
    catch (e) { el.textContent = String(n); }
    return;
  }
  if (STEADY_FLASH && active && n < FLASH_START && n % 2 === 1 && el.textContent === String(n)) {
    try { el.innerHTML = Locale.stylize(`[STYLE:screen-turntimer_text_turn_active_flash]${n}[/STYLE]`); }
    catch (e) { /* keep the engine's default */ }
  }
}

/** Warning sound at 30/25/20/15 while in the orange tier. */
function warnSounds(n) {
  if (expiredAt >= 0 || !localPlayerTurnActive()) return;
  if (n > ORANGE_START || n < FLASH_START || n % WARN_EVERY !== 0) return;
  if (n >= lastWarnTick) return;
  lastWarnTick = n;
  try { UI.sendAudioEvent('turn-timer-warning'); } catch (e) { /* no audio */ }
  log(`warning sound at ${n}s`);
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
      lastWarnTick = Infinity;
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
      const n = expiredAt >= 0 ? 0 : Math.max(0, Math.round(total - elapsed));
      // Engine-perceived clock: pinned at zero once expired; clamped while the
      // remaining time is above FLASH_START so its hardcoded sub-20s flash and
      // beeps stay quiet until our red tier actually begins.
      let effectiveElapsed = elapsed;
      if (expiredAt >= 0) {
        effectiveElapsed = Math.max(elapsed, total);
      } else if (n > FLASH_START && total >= ENGINE_FLASH_HIDE + 1) {
        effectiveElapsed = Math.min(elapsed, total - ENGINE_FLASH_HIDE);
      }
      data = { ...data, phaseTimeLimit: total, elapsedTime: effectiveElapsed };
      if (expiredAt >= 0 && elapsed - lastEnforceAt >= ENFORCE_RETRY_SECONDS && localPlayerTurnActive()) {
        lastEnforceAt = elapsed;
        log(`time expired at ${Math.round(elapsed)}s - ending local turn`);
        try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
      }
      try { panelOriginalTimer.call(panelInstance, data); } catch (e) { /* ignore */ }
      decorateText(n);
      warnSounds(n);
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
