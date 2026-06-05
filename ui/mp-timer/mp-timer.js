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
 * Multiplayer Toolkit - Competitive turn timer (component subclass).
 *
 * The engine only enforces None/Standard/Dynamic, so the custom "Competitive"
 * type is driven here, derived from the active Age's TURN_SEGMENT_SINGLEPHASE
 * numbers plus the MPT_TimerScaling values (data/timers/):
 *
 *   seconds = Base + PerCity*cities + PerUnit*units
 *           + PerHuman*humanPlayers + PerTurn*turnNumber
 *
 * Architecture: instead of proxying the action panel's event listener, the
 * panel COMPONENT itself is replaced. Controls.define supports priority-based
 * redefinition, and Controls.getDefinition exposes the base game's PanelAction
 * class, so MPT_PanelAction extends it - inheriting every piece of base logic
 * - and overrides only the timer path. The engine then constructs OUR panel:
 * no listener juggling, no render fighting, one render pipeline.
 *
 * Tiers: the engine hardcodes its red flash + per-second beeps below 20s, so
 * while remaining is above flashStart we clamp what it perceives to keep it
 * calm, then paint the tiers ourselves:
 *   orangeStart..flashStart+1  orange text, urgency beep every warnEverySeconds
 *   flashStart..0              engine's red flash + per-second beeps
 */
import { TIMER_TYPE, CONFIG, ENGINE } from './mp-timer-config.js';

const COMPETITIVE_HASH = Database.makeHash(TIMER_TYPE);
const DEFINE_RETRY_MS = 200;
const DEFINE_RETRIES = 50;

let MPT_PanelAction = null;

function log(message) {
  if (CONFIG.debug) console.log(`[MPT timer] ${message}`);
}

// ============================ Pure helpers ============================

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

/**
 * Competitive seconds for this turn; 0 if the segment data is unavailable.
 * Decimal scaling values are supported; the result is rounded to the nearest
 * roundToNearest multiple (never below one step, so a short turn stays timed).
 */
function computeSeconds() {
  const limit = segmentLimits();
  if (!limit) return 0;
  const { cities, units, humans } = playerTallies();
  const { perHuman, perTurn } = scalingValues();
  const raw = limit.base
    + (limit.perCity * cities)
    + (limit.perUnit * units)
    + (perHuman * humans)
    + (perTurn * Math.max(0, currentTurn()));
  if (raw <= 0) return 0;
  const step = CONFIG.roundToNearest >= 1 ? CONFIG.roundToNearest : 1;
  return Math.max(step, Math.round(raw / step) * step);
}

/** Engine-styled number, falling back to plain text when stylize fails. */
function setStyledNumber(el, styleClass, n) {
  try { el.innerHTML = Locale.stylize(`[STYLE:${styleClass}]${n}[/STYLE]`); }
  catch (e) { el.textContent = String(n); }
}

// ====================== Component redefinition ========================

/**
 * Retrieve the base game's PanelAction class and register a subclass in its
 * place. Everything the base panel does is inherited; only the turn timer
 * path is extended.
 */
function defineMptPanelAction(attempts) {
  let base = null;
  try { base = Controls.getDefinition('panel-action'); } catch (e) { base = null; }
  if (!base?.createInstance) {
    if (attempts > 0) setTimeout(() => defineMptPanelAction(attempts - 1), DEFINE_RETRY_MS);
    else log('panel-action definition never appeared; competitive timer inactive');
    return;
  }
  const PanelAction = base.createInstance;

  MPT_PanelAction = class MPT_PanelAction extends PanelAction {
    // --- competitive timer state (per panel instance) ---
    mptTotal = 0;
    mptLastTurn = -1;
    mptExpiredAt = -1;
    mptLastEnforceAt = -Infinity;
    mptRingSetAt = Infinity;
    mptLastWarnTick = Infinity;
    mptLastElapsed = 0;
    mptPauseListener = (data) => this.mptOnGamePauseChanged(data);

    onAttach() {
      super.onAttach();
      engine.on('GamePauseStateChanged', this.mptPauseListener);
    }
    onDetach() {
      engine.off('GamePauseStateChanged', this.mptPauseListener);
      super.onDetach();
    }

    /** Single override point: feed the base renderer our clock. */
    onTurnTimerUpdated(data) {
      const ctx = this.mptContext(data);
      super.onTurnTimerUpdated(ctx ? ctx.data : data);
      if (ctx) {
        this.mptDecorateText(ctx.n);
        this.mptWarnSounds(ctx.n);
      }
    }

    /**
     * Substituted event data + display seconds for the competitive timer,
     * handling new turns, ring resyncs, expiry pinning and enforcement.
     * Null when the event should pass through to the base panel untouched.
     */
    mptContext(data) {
      const limit = data?.phaseTimeLimit ?? 0;
      if (limit <= 0 || limit > CONFIG.maxProxyLimit || !isCompetitiveSelected()) return null;
      const turn = currentTurn();
      if (turn !== this.mptLastTurn) {
        this.mptLastTurn = turn;
        this.mptTotal = computeSeconds();
        this.mptExpiredAt = -1;
        this.mptLastEnforceAt = -Infinity;
        this.mptLastWarnTick = Infinity;
        this.mptClearRingLatch(0);
        log(`turn ${turn}: total=${this.mptTotal}s`);
      }
      if (this.mptTotal <= 0) return null;
      const total = this.mptTotal;
      const elapsed = data.elapsedTime ?? 0;
      this.mptLastElapsed = elapsed;
      if (this.mptRingDesynced(elapsed)) {
        this.mptClearRingLatch(elapsed);
        log(`ring resync at ${Math.round(elapsed)}s elapsed`);
      }
      if (this.mptExpiredAt < 0 && total - elapsed <= 0) this.mptExpiredAt = elapsed;
      const n = this.mptExpiredAt >= 0 ? 0 : Math.max(0, Math.round(total - elapsed));
      // Engine-perceived clock: pinned at zero once expired; clamped while the
      // remaining time is above flashStart so the inherited sub-20s flash and
      // beeps stay quiet until our red tier actually begins.
      let effectiveElapsed = elapsed;
      if (this.mptExpiredAt >= 0) {
        effectiveElapsed = Math.max(elapsed, total);
      } else if (n > CONFIG.flashStart && total >= CONFIG.engineFlashHide + 1) {
        effectiveElapsed = Math.min(elapsed, total - CONFIG.engineFlashHide);
      }
      this.mptEnforceExpiry(elapsed);
      return { data: { ...data, phaseTimeLimit: total, elapsedTime: effectiveElapsed }, n };
    }

    /**
     * True when the ring no longer reflects our timer: a stale latch from the
     * fallback 180, a ready-up delay reset, or a clock correction back past
     * the point the ring was last synced. The ring re-sizes via the inherited
     * startMPTimerAnimation, which we own through this.mpTimerMaxTime.
     */
    mptRingDesynced(elapsed) {
      if (this.mpTimerMaxTime > this.mptTotal) return true;
      if (elapsed + CONFIG.clockJitterSeconds < this.mptRingSetAt) return true;
      const ring = this.timerAnimationElements?.[0];
      if (!ring) return false;
      if (ring.style.animationDuration !== `${this.mptTotal}s`) return true;
      return elapsed > 1.5 && ring.style.animationDelay === '0s';
    }

    mptClearRingLatch(elapsed) {
      this.mpTimerMaxTime = 0;
      this.mptRingSetAt = elapsed;
    }

    /**
     * Tier styling on top of the inherited render. While the engine view is
     * muzzled (16..20s shows its clamped number) the text is always rewritten;
     * the orange tier uses an inline colour, and the red tier keeps a steady
     * flash colour.
     */
    mptDecorateText(n) {
      const el = this.turnTimerElement ?? document.getElementById(ENGINE.timerTextId);
      if (!el) return;
      const active = localPlayerTurnActive();
      const beforeExpiry = this.mptExpiredAt < 0;
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
     * Urgency beep through the orange tier (30/25/20). The inherited renderer
     * beeps at flashStart and below, so stopping above it avoids a double hit.
     */
    mptWarnSounds(n) {
      if (this.mptExpiredAt >= 0 || !localPlayerTurnActive()) return;
      if (n > CONFIG.orangeStart || n <= CONFIG.flashStart || n % CONFIG.warnEverySeconds !== 0) return;
      if (n >= this.mptLastWarnTick) return;
      this.mptLastWarnTick = n;
      try { UI.sendAudioEvent(ENGINE.audioUrgency); } catch (e) { /* no audio */ }
      log(`urgency beep at ${n}s`);
    }

    /** Ends the local turn once expired; repeats if the player unreadies at zero. */
    mptEnforceExpiry(elapsed) {
      if (this.mptExpiredAt < 0 || elapsed - this.mptLastEnforceAt < CONFIG.enforceRetrySeconds || !localPlayerTurnActive()) return;
      this.mptLastEnforceAt = elapsed;
      log(`time expired at ${Math.round(elapsed)}s - ending local turn`);
      try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
    }

    /**
     * The ring is a wall-clock CSS animation, so it keeps depleting visually
     * while the game is paused even though the phase clock stops. Freeze it
     * during pause and force a resync on unpause.
     */
    mptOnGamePauseChanged(data) {
      const paused = !!data && Number(data.data) === 1;
      const rings = this.timerAnimationElements;
      if (rings) {
        for (const el of rings) el.style.animationPlayState = paused ? 'paused' : 'running';
      }
      if (!paused && this.mptTotal > 0) this.mptClearRingLatch(this.mptLastElapsed);
      log(paused ? 'game paused - ring frozen' : 'game resumed - ring resynced');
    }
  };

  Controls.define('panel-action', {
    ...base,
    createInstance: MPT_PanelAction,
    description: (base.description ?? '') + ' (Multiplayer Toolkit competitive timer)',
    priority: (base.priority ?? 0) + 1
  });
  log('panel-action redefined as MPT_PanelAction');

  // If the HUD already built the panel with the base class, our subclass only
  // applies to future creations - surface that loudly for testing.
  const existing = document.querySelector('panel-action')?.maybeComponent;
  if (existing && !(existing instanceof MPT_PanelAction)) {
    log('WARNING: an existing panel-action predates the redefinition; timer inactive until it is recreated');
  }
}

defineMptPanelAction(DEFINE_RETRIES);

export { MPT_PanelAction };
