/*
 * Multiplayer Toolkit - multiplayer quality-of-life features for Civilization VII.
 * Copyright (C) 2026  Zatygold
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Multiplayer Toolkit - Competitive turn timer (enforcement + native display).
 *
 * The engine only enforces None/Standard/Dynamic, so the custom "Competitive"
 * type is driven here, derived from the active Age's TURN_SEGMENT_SINGLEPHASE
 * numbers plus the MPT_TimerScaling values (data/timers/):
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
 * while remaining is above flashStart we clamp what it perceives to keep it
 * calm, then paint the tiers ourselves:
 *   orangeStart..flashStart+1  orange text, urgency beep every warnEverySeconds
 *   flashStart..0              engine's red flash + per-second beeps
 */
import { TIMER_TYPE, CONFIG, ENGINE } from './mp-timer-config.js';

const COMPETITIVE_HASH = Database.makeHash(TIMER_TYPE);

let panelInstance = null;
let panelOriginalTimer = null;
let proxyInstalled = false;

let total = 0;
let lastTurn = -1;
let expiredAt = -1;
let lastEnforceAt = -Infinity;
let ringSetAt = Infinity;
let lastWarnTick = Infinity;

function log(message) {
  if (CONFIG.debug) console.log(`[MPT timer] ${message}`);
}

function isCompetitiveSelected() {
  try { return Configuration.getGame().turnTimerType === COMPETITIVE_HASH; }
  catch (e) { return false; }
}

function currentTurn() {
  try { return Game.turn ?? -1; } catch (e) { return -1; }
}

function localPlayerTurnActive() {
  try {
    const player = Players.get(GameContext.localPlayerID);
    return !!(player && player.isTurnActive);
  } catch (e) { return false; }
}

/** TimeLimit_Base/PerCity/PerUnit for the active simultaneous segment. */
function segmentLimits() {
  try {
    const rows = Database.query('gameplay',
      "SELECT TimeLimit_Base AS base, TimeLimit_PerCity AS perCity, TimeLimit_PerUnit AS perUnit " +
      `FROM TurnSegments WHERE TurnSegmentType = '${ENGINE.segmentType}'`) ?? [];
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

/** One pass over living major players: max cities/units and human count (synced). */
function playerTallies() {
  const tallies = { cities: 0, units: 0, humans: 0 };
  try {
    for (const entry of Players.getAlive()) {
      const player = (entry && entry.isMajor !== undefined) ? entry : Players.get(entry);
      if (!player || !player.isMajor) continue;
      tallies.cities = Math.max(tallies.cities, player.Cities?.getCities()?.length ?? 0);
      tallies.units = Math.max(tallies.units, player.Units?.getUnits()?.length ?? 0);
      if (player.isHuman) tallies.humans++;
    }
  } catch (e) { /* keep zeros */ }
  return tallies;
}

/** Competitive seconds for this turn; 0 if the segment data is unavailable. */
function computeSeconds() {
  const limit = segmentLimits();
  if (!limit) return 0;
  const { cities, units, humans } = playerTallies();
  const { perHuman, perTurn } = scalingValues();
  return limit.base
    + (limit.perCity * cities)
    + (limit.perUnit * units)
    + (perHuman * humans)
    + (perTurn * Math.max(0, currentTurn()));
}

/**
 * True when the ring no longer reflects our timer: a stray render re-sized it,
 * the ready-up handler reset its delay, or the clock was corrected back past
 * the point the ring was last synced.
 */
function ringDesynced(elapsed) {
  if (!panelInstance) return false;
  if (panelInstance.mpTimerMaxTime > total) return true;
  if (elapsed + CONFIG.clockJitterSeconds < ringSetAt) return true;
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

/** Engine-styled number, falling back to plain text when stylize fails. */
function setStyledNumber(el, styleClass, n) {
  try { el.innerHTML = Locale.stylize(`[STYLE:${styleClass}]${n}[/STYLE]`); }
  catch (e) { el.textContent = String(n); }
}

/**
 * Tier styling on top of the engine's render. While the engine is muzzled
 * (16..20s shows its clamped number) the text is always rewritten; the orange
 * tier uses an inline colour, and the red tier keeps a steady flash colour.
 */
function decorateText(n) {
  const el = document.getElementById(ENGINE.timerTextId);
  if (!el) return;
  const active = localPlayerTurnActive();
  const beforeExpiry = expiredAt < 0;
  if (active && beforeExpiry && n <= CONFIG.orangeStart && n > CONFIG.flashStart) {
    if (el.style.color !== CONFIG.orangeColor) el.style.color = CONFIG.orangeColor;
    if (el.textContent !== String(n) || el.firstElementChild) el.textContent = String(n);
    return;
  }
  if (el.style.color) el.style.color = '';
  const engineShowsClamp = beforeExpiry && n > CONFIG.flashStart && n < CONFIG.engineFlashHide;
  if (!active && engineShowsClamp) {
    setStyledNumber(el, ENGINE.styleInactive, n);
    return;
  }
  if (CONFIG.steadyFlash && active && n <= CONFIG.flashStart && n % 2 === 1 && el.textContent === String(n)) {
    setStyledNumber(el, ENGINE.styleActiveFlash, n);
  }
}

/**
 * Urgency beep through the orange tier (30/25/20). The engine itself beeps at
 * flashStart and below, so stopping above it avoids a double hit.
 */
function warnSounds(n) {
  if (expiredAt >= 0 || !localPlayerTurnActive()) return;
  if (n > CONFIG.orangeStart || n <= CONFIG.flashStart || n % CONFIG.warnEverySeconds !== 0) return;
  if (n >= lastWarnTick) return;
  lastWarnTick = n;
  try { UI.sendAudioEvent(ENGINE.audioUrgency); } catch (e) { /* no audio */ }
  log(`urgency beep at ${n}s`);
}

/** Ends the local turn once expired; repeats if the player unreadies at zero. */
function enforceExpiry(elapsed) {
  if (expiredAt < 0 || elapsed - lastEnforceAt < CONFIG.enforceRetrySeconds || !localPlayerTurnActive()) return;
  lastEnforceAt = elapsed;
  log(`time expired at ${Math.round(elapsed)}s - ending local turn`);
  try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
}

/**
 * Substituted event data + display seconds for the competitive timer, handling
 * new turns, ring resyncs, expiry pinning and enforcement. Null when the event
 * should pass through to the engine untouched.
 */
function competitiveContext(data) {
  const limit = data?.phaseTimeLimit ?? 0;
  if (limit <= 0 || limit > CONFIG.maxProxyLimit || !isCompetitiveSelected()) return null;
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
  if (total <= 0) return null;
  const elapsed = data.elapsedTime ?? 0;
  if (ringDesynced(elapsed)) {
    clearRingLatch(elapsed);
    log(`ring resync at ${Math.round(elapsed)}s elapsed`);
  }
  if (expiredAt < 0 && total - elapsed <= 0) expiredAt = elapsed;
  const n = expiredAt >= 0 ? 0 : Math.max(0, Math.round(total - elapsed));
  // Engine-perceived clock: pinned at zero once expired; clamped while the
  // remaining time is above flashStart so its hardcoded sub-20s flash and
  // beeps stay quiet until our red tier actually begins.
  let effectiveElapsed = elapsed;
  if (expiredAt >= 0) {
    effectiveElapsed = Math.max(elapsed, total);
  } else if (n > CONFIG.flashStart && total >= CONFIG.engineFlashHide + 1) {
    effectiveElapsed = Math.min(elapsed, total - CONFIG.engineFlashHide);
  }
  enforceExpiry(elapsed);
  return { data: { ...data, phaseTimeLimit: total, elapsedTime: effectiveElapsed }, n };
}

/** Engine's timer handler, fed our context when Competitive is active. */
function timerProxy(data) {
  const ctx = competitiveContext(data);
  try { panelOriginalTimer.call(panelInstance, ctx?.data ?? data); } catch (e) { /* ignore */ }
  if (ctx) {
    decorateText(ctx.n);
    warnSounds(ctx.n);
  }
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

/**
 * The ring is a wall-clock CSS animation, so it keeps depleting visually while
 * the game is paused even though the phase clock stops. Freeze it during pause
 * and force a resync on unpause to realign with the real clock.
 */
function onGamePauseChanged(data) {
  const paused = !!data && Number(data.data) === 1;
  const rings = panelInstance?.timerAnimationElements;
  if (rings) {
    for (const el of rings) el.style.animationPlayState = paused ? 'paused' : 'running';
  }
  if (!paused && total > 0) clearRingLatch(lastElapsedSeen);
  log(paused ? 'game paused - ring frozen' : 'game resumed - ring resynced');
}

engine.on('GamePauseStateChanged', onGamePauseChanged);
enforceTakeover();
setInterval(enforceTakeover, CONFIG.guardianMs);
