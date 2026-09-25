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
 * Clock: the countdown runs on WALL TIME, not the engine's elapsedTime field.
 * The engine freezes/rewinds elapsedTime for this custom type when certain
 * screens open (e.g. a settlement's production panel), which would stop and
 * then reset the countdown - letting a player extend a turn indefinitely by
 * opening and closing a panel. Anchoring on wall time (frozen only for a real
 * multiplayer pause) makes the clock immune to that. The state lives at MODULE
 * scope (see CLOCK) so it also survives the panel being torn down and rebuilt,
 * and an independent enforcement tick ends the turn on time even while no timer
 * events are firing (panel open). Timer events remain the render trigger.
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
// Timer events (TurnTimerUpdated) stop firing while some screens are open (e.g.
// a settlement's details/production). When they have been silent this long, the
// wall-clock enforcement sweep takes over the beeps so the audible cue never
// stops even though the on-screen number is frozen behind the open panel.
const STALE_EVENT_MS = 1200;

let MPT_PanelAction = null;
let mptEnforcementStarted = false;
let mptLastEventMs = 0;   // last time a competitive TurnTimerUpdated was handled

function log(message) {
  if (CONFIG.debug) console.log(`[MPT timer] ${message}`);
}

// ============================ Pure helpers ============================

function isCompetitiveSelected() {
  try { return Configuration.getGame().turnTimerType === COMPETITIVE_HASH; }
  catch (e) { return false; }
}

/** The configured timer type, or undefined while the configuration is unreadable. */
function configuredTimerType() {
  try { return Configuration.getGame().turnTimerType; } catch (e) { return undefined; }
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

/**
 * TimeLimit_Base/PerCity/PerUnit from the mod-owned MPT_TurnSegments table,
 * keeping the Competitive numbers fully separate from the Dynamic timer's
 * (the game's TurnSegments is never modified).
 */
function segmentLimits() {
  try {
    const rows = Database.query('gameplay',
      "SELECT TimeLimit_Base AS base, TimeLimit_PerCity AS perCity, TimeLimit_PerUnit AS perUnit " +
      `FROM MPT_TurnSegments WHERE TurnSegmentType = '${ENGINE.segmentType}'`) ?? [];
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

// ======================= Wall-clock turn timer ========================

/**
 * The authoritative countdown, kept at module scope so it survives the
 * panel-action being rebuilt. Elapsed time is measured on the wall clock and
 * frozen only for a real multiplayer pause - never affected by the engine's
 * elapsedTime field, which this timer no longer trusts.
 */
const CLOCK = {
  turn: -1,
  total: 0,
  startMs: 0,
  pausedAccumMs: 0,
  pausedSinceMs: 0,
  lastEnforceMs: -Infinity,
  lastWarnTick: Infinity,
  staleBeepSecond: Infinity,

  /** Anchor a fresh countdown when the turn number changes; returns the total. */
  syncTurn() {
    const t = currentTurn();
    if (t !== this.turn) {
      this.turn = t;
      this.total = computeSeconds();
      this.startMs = Date.now();
      this.pausedAccumMs = 0;
      this.pausedSinceMs = 0;
      this.lastEnforceMs = -Infinity;
      this.lastWarnTick = Infinity;
      this.staleBeepSecond = Infinity;
      log(`turn ${t}: total=${this.total}s`);
    }
    return this.total;
  },

  /** Seconds elapsed this turn, excluding time spent paused (never negative). */
  elapsed() {
    const now = Date.now();
    const pausedNow = this.pausedSinceMs ? (now - this.pausedSinceMs) : 0;
    return Math.max(0, (now - this.startMs - this.pausedAccumMs - pausedNow) / 1000);
  },

  expired() { return this.total > 0 && this.elapsed() >= this.total; },

  /** Restart this turn's countdown from full (used while the capital is unfounded). */
  restart() {
    this.startMs = Date.now();
    this.pausedAccumMs = 0;
    if (this.pausedSinceMs) this.pausedSinceMs = this.startMs;
  },

  setPaused(paused) {
    if (paused) {
      if (!this.pausedSinceMs) this.pausedSinceMs = Date.now();
    } else if (this.pausedSinceMs) {
      this.pausedAccumMs += Date.now() - this.pausedSinceMs;
      this.pausedSinceMs = 0;
    }
  }
};

/**
 * Grace for the opening turn(s) of a session, measured from the first turn
 * this session actually sees rather than an absolute turn number. A new game
 * starting at turn 1 behaves exactly as before; a game that begins at a later
 * turn (a loaded save, a later-age start, or a patch that renumbers turns) still
 * gets its untimed setup turn instead of being timed from the very first turn.
 */
let firstTurnSeen = -1;
function inGrace() {
  const t = currentTurn();
  if (t < 1) return true;                  // turn not readable yet: treat as grace
  if (firstTurnSeen < 1) firstTurnSeen = t;
  return t < firstTurnSeen + Math.max(0, CONFIG.firstTimedTurn - 1);
}

/** True once the local player has founded at least one settlement. */
function localHasCity() {
  try {
    const player = Players.get(GameContext.localPlayerID);
    return !!player && (player.Cities?.getCities()?.length ?? 0) > 0;
  } catch (e) { return true; }   // unknown: don't hold the clock
}

/**
 * True when the timer is allowed to force-end the local turn. The only remaining
 * guard is that the player has a city: never advance a player who has not yet
 * founded their capital (turn 1 is already off via firstTimedTurn, but this
 * covers any edge where they still have none). Everything the End Turn button
 * treats as a blocker - units awaiting orders and pending-choice notifications
 * (research, civic, city growth, narrative) - is instead cleared at expiry, the
 * same way the engine's own timer force-end abandons them.
 */
function mptCanForceEnd() {
  try {
    const player = Players.get(GameContext.localPlayerID);
    if (player && (player.Cities?.getCities()?.length ?? 0) === 0) return false;
  } catch (e) { /* fall through */ }
  return true;
}

/**
 * Dismiss EVERY pending notification that blocks turn advancement - choose
 * research/civic, city growth, narrative events, and anything else. The engine
 * refuses sendTurnComplete while these exist; dismissing abandons the choice
 * for this turn, which is exactly what running out of time means (and what the
 * native timer force-end does). The competitive timer is strict: in multiplayer
 * nothing but a pause may stall the turn, so this does not spare "not normally
 * user-dismissible" blockers - it clears whatever the API will clear.
 */
function mptDismissTurnBlockers() {
  let ids = null;
  try { ids = Game.Notifications.getIdsForPlayer(GameContext.localPlayerID); } catch (e) { return; }
  for (const n of ids ?? []) {
    try {
      if (Game.Notifications.getBlocksTurnAdvancement(n)) Game.Notifications.dismiss(n);
    } catch (e) { /* skip this one */ }
  }
}

/** True only while the engine is refusing end-turn because units need orders. */
function unitsBlockEndTurn() {
  try {
    return Game.Notifications.getEndTurnBlockingType(GameContext.localPlayerID) === EndTurnBlockingTypes.UNITS;
  } catch (e) { return false; }
}

/**
 * True for a unit that is genuinely idle and waiting on the player. Units that
 * are carrying out an order - auto-explore, a multi-turn move, or any other
 * queued operation - or are sleeping/healing must be left alone: a SKIP_TURN
 * would overwrite their standing order and stop them for the turn.
 */
function unitAwaitsOrders(id) {
  let unit = null;
  try { unit = Units.get(id); } catch (e) { return false; }
  if (!unit) return false;
  try {
    const a = unit.activity;
    if (a === UnitActivityTypes.OPERATION || a === UnitActivityTypes.SLEEP || a === UnitActivityTypes.HEAL) return false;
  } catch (e) { /* activity unreadable: fall through to the path check */ }
  try { if (Units.getQueuedOperationDestination(id)) return false; } catch (e) { /* no queued path */ }
  return true;
}

/**
 * Only when the engine is actually refusing to end the turn because units need
 * orders: skip the units that are truly idle, leaving them where they are (what
 * a turn-timer expiry does). Automated and path-following units are never
 * touched, so explorers keep exploring and long moves keep going. The block
 * clears asynchronously, so the sweep repeats over subsequent ticks.
 */
function mptSkipReadyUnits() {
  if (!unitsBlockEndTurn()) return;
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    let id = null;
    try { id = UI.Player.getFirstReadyUnit(); } catch (e) { break; }
    if (!id) break;
    try { if (ComponentID && ComponentID.isInvalid && ComponentID.isInvalid(id)) break; } catch (e) {}
    const key = `${id.owner ?? ''}:${id.id ?? id}`;
    if (seen.has(key)) break;   // looped back to an already-visited unit - stop
    seen.add(key);
    if (unitAwaitsOrders(id)) {
      try { Game.UnitOperations.sendRequest(id, UnitOperationTypes.SKIP_TURN, {}); } catch (e) {}
    }
    try { UI.Player.selectNextReadyUnit(); } catch (e) {}
  }
}

/**
 * Wall-clock beeps for when timer events have stalled (a panel is open). Orange
 * cadence above the flash threshold, then one beep per second through the red
 * tier - mirroring the engine's own sounds so the cue is seamless. Deduped per
 * whole second; silent once expired (the native timer stops beeping there too).
 */
function mptBeepFromClock() {
  if (CLOCK.total <= 0) return;
  const remaining = CLOCK.total - CLOCK.elapsed();
  const n = Math.max(0, Math.round(remaining));
  if (n <= 0 || n === CLOCK.staleBeepSecond) return;
  let beep = false;
  if (n <= CONFIG.flashStart) beep = true;                                            // red: every second
  else if (n <= CONFIG.orangeStart && n % CONFIG.warnEverySeconds === 0) beep = true; // orange cadence
  if (!beep) return;
  CLOCK.staleBeepSecond = n;
  try { UI.sendAudioEvent(ENGINE.audioUrgency); } catch (e) { /* no audio */ }
}

/**
 * Independent enforcement sweep. Runs on wall time regardless of whether timer
 * events are firing, so the countdown beeps and the turn ends on time even
 * while a settlement panel is open. Clears the units-need-orders block, then
 * ends the local turn; it keeps trying (units clear asynchronously) and will
 * re-end if the player unreadies at zero.
 */
/** Living human major players (a "competitive" force-end only makes sense with 2+). */
function livingHumanCount() {
  let n = 0;
  try {
    for (const entry of Players.getAlive()) {
      const p = (entry && entry.isMajor !== undefined) ? entry : Players.get(entry);
      if (p && p.isMajor && p.isHuman) n++;
    }
  } catch (e) { /* keep count */ }
  return n;
}

function mptEnforceTick() {
  if (!isCompetitiveSelected() || !localPlayerTurnActive()) return;
  if (inGrace()) return;                                          // untimed opening turn(s)
  if (livingHumanCount() < CONFIG.minPlayersToEnforce) return;    // optional: never auto-end solo games
  CLOCK.syncTurn();
  // No settlement yet: keep the countdown at full so founding a capital late
  // never lands on an already-expired clock and ends the turn instantly.
  if (!localHasCity()) { CLOCK.restart(); return; }
  // Keep the audible countdown alive while timer events are stalled.
  if (Date.now() - mptLastEventMs > STALE_EVENT_MS) mptBeepFromClock();
  if (!CLOCK.expired() || !mptCanForceEnd()) return;
  try { if (GameContext.hasSentTurnComplete && GameContext.hasSentTurnComplete()) return; } catch (e) {}
  mptSkipReadyUnits();       // only if units genuinely block; automated/queued units untouched
  mptDismissTurnBlockers();  // clear pending-choice blockers (research/civic/growth/narrative)
  log(`time expired - ending local turn (turn ${CLOCK.turn})`);
  // Mirror the native End Turn button exactly (panel-action sendEndTurn).
  try { UI.Player.deselectAllUnits(); } catch (e) { /* ignore */ }
  try { GameContext.sendTurnComplete(); } catch (e) { /* ignore */ }
}

/** Start the enforcement sweep and pause accounting once (idempotent). */
function startMptEnforcement() {
  if (mptEnforcementStarted) return;
  mptEnforcementStarted = true;
  engine.on('GamePauseStateChanged',
    (data) => CLOCK.setPaused(!!data && Number(data.data) === 1));
  setInterval(mptEnforceTick, CONFIG.guardianMs);
  log('enforcement sweep started (wall clock)');
}

// ============================ Render helpers ==========================

/** Engine-styled number, falling back to plain text when stylize fails. */
function setStyledNumber(el, styleClass, n) {
  try { el.innerHTML = Locale.stylize(`[STYLE:${styleClass}]${n}[/STYLE]`); }
  catch (e) { el.textContent = String(n); }
}

/** Ring element class -> [stylesheet keyframes, identical clone] (panel-action.css). */
const RING_ANIMATIONS = [
  { className: 'action_panel__mp-timer-left-circle', names: ['rotate-timer-first', 'mpt-rotate-timer-first'] },
  { className: 'action_panel__mp-timer-right-circle', names: ['rotate-timer-second', 'mpt-rotate-timer-second'] },
  { className: 'action_panel__mp-timer-left-bk-circle', names: ['fade-in-bg', 'mpt-fade-in-bg'] }
];

function ringAnimationNames(el) {
  return RING_ANIMATIONS.find((entry) => el.classList.contains(entry.className))?.names ?? null;
}

/**
 * Identical clones of the game's ring keyframes. Flipping an element between
 * its original and clone forces the animation restart that makes a new
 * animationDelay take effect (see mptSyncRing).
 */
function injectRingKeyframes() {
  const style = document.createElement('style');
  style.textContent = `
@keyframes mpt-rotate-timer-first { 0% { transform: rotate(0deg); } 50% { transform: rotate(-180deg); } 100% { transform: rotate(-180deg); } }
@keyframes mpt-rotate-timer-second { 0% { transform: rotate(180deg); } 50% { transform: rotate(180deg); } 100% { transform: rotate(0deg); } }
@keyframes mpt-fade-in-bg { 0% { opacity: 0; } 49% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 1; } }`;
  document.head.appendChild(style);
}

// ====================== Component redefinition ========================

/**
 * Retrieve the base game's PanelAction class and register a subclass in its
 * place. Everything the base panel does is inherited; only the turn timer
 * path is extended.
 */
function defineMptPanelAction(attempts) {
  // Only take over the panel when OUR timer is the chosen setting; with any
  // other timer the game runs its genuine, untouched component. The lobby
  // choice is fixed before the game UI boots, so a load-time check suffices.
  // (undefined = configuration not readable yet - keep retrying.)
  const configured = configuredTimerType();
  if (configured === undefined) {
    if (attempts > 0) setTimeout(() => defineMptPanelAction(attempts - 1), DEFINE_RETRY_MS);
    else log('game configuration never became readable; competitive timer inactive');
    return;
  }
  if (configured !== COMPETITIVE_HASH) {
    log('Competitive timer not selected - base panel-action left untouched');
    return;
  }
  let base = null;
  try { base = Controls.getDefinition('panel-action'); } catch (e) { base = null; }
  if (!base?.createInstance) {
    if (attempts > 0) setTimeout(() => defineMptPanelAction(attempts - 1), DEFINE_RETRY_MS);
    else log('panel-action definition never appeared; competitive timer inactive');
    return;
  }
  const PanelAction = base.createInstance;
  injectRingKeyframes();
  startMptEnforcement();   // wall-clock enforcement runs even while the panel is rebuilt

  MPT_PanelAction = class MPT_PanelAction extends PanelAction {
    // --- ring freeze on pause (display-only; the clock itself is CLOCK) ---
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
      if (isCompetitiveSelected()) mptLastEventMs = Date.now();   // events are flowing
      // Grace turn(s): keep the competitive timer off entirely - hide it by
      // handing the base renderer a zero limit (its own "no timer" path).
      if (isCompetitiveSelected() && inGrace()) {
        super.onTurnTimerUpdated({ ...data, phaseTimeLimit: 0 });
        return;
      }
      const ctx = this.mptContext(data);
      super.onTurnTimerUpdated(ctx ? ctx.data : data);
      if (ctx) {
        this.mptSyncRing(ctx.ringElapsed);
        this.mptDecorateText(ctx.n);
        this.mptWarnSounds(ctx.n);
      }
    }

    /**
     * Substituted event data + display seconds from the wall-clock CLOCK.
     * Null when the event should pass through to the base panel untouched.
     */
    mptContext(data) {
      const limit = data?.phaseTimeLimit ?? 0;
      if (limit <= 0 || limit > CONFIG.maxProxyLimit || !isCompetitiveSelected()) return null;
      CLOCK.syncTurn();
      if (!localHasCity()) CLOCK.restart();   // show a full clock until the capital exists
      const total = CLOCK.total;
      if (total <= 0) return null;
      const elapsed = CLOCK.elapsed();
      const expired = elapsed >= total;
      const n = expired ? 0 : Math.max(0, Math.round(total - elapsed));
      // Engine-perceived clock: pinned at zero once expired; clamped while the
      // remaining time is above flashStart so the inherited sub-20s flash and
      // beeps stay quiet until our red tier actually begins.
      let effectiveElapsed = elapsed;
      if (expired) {
        effectiveElapsed = Math.max(elapsed, total);
      } else if (n > CONFIG.flashStart && total >= CONFIG.engineFlashHide + 1) {
        effectiveElapsed = Math.min(elapsed, total - CONFIG.engineFlashHide);
      }
      // The ring scrubs from the TRUE clock (with only the expiry pin), never
      // from the muzzle-clamped value, or it would freeze in the orange tier.
      const ringElapsed = expired ? total : elapsed;
      return { data: { ...data, phaseTimeLimit: total, elapsedTime: effectiveElapsed }, n, ringElapsed };
    }

    /**
     * Scrub the ring to the game clock on every timer event. Changing only
     * animationDelay on a RUNNING animation does not reposition it - the
     * delay offsets from the animation's ORIGINAL start time, so the ring ran
     * at double speed. A new delay is honored from "now" only when the
     * animation restarts, and a restart is guaranteed when animation-name
     * changes: each scrub flips the element between the game's keyframes and
     * an identical clone. Between events the ring free-runs smoothly on wall
     * clock; each restart corrects the few milliseconds drifted since the
     * last event. fill-mode holds the ring empty once the animation ends at
     * expiry. (The inherited startMPTimerAnimation never fires for us:
     * mpTimerMaxTime is kept equal to the total, so its grow-only guard
     * stays false.)
     */
    mptSyncRing(elapsed) {
      const total = CLOCK.total;
      if (total <= 0) return;
      this.mpTimerMaxTime = total;   // neutralize the inherited grow-only ring latch
      const position = Math.min(Math.max(elapsed, 0), total);
      for (const el of this.timerAnimationElements ?? []) {
        const names = ringAnimationNames(el);
        if (!names) continue;
        el.style.animationDuration = `${total}s`;
        el.style.animationDelay = `${-position}s`;
        el.style.animationFillMode = 'forwards';
        el.style.animationName = el.style.animationName === names[1] ? names[0] : names[1];
      }
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
      const beforeExpiry = !CLOCK.expired();
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
      if (CLOCK.expired() || !localPlayerTurnActive()) return;
      if (n > CONFIG.orangeStart || n <= CONFIG.flashStart || n % CONFIG.warnEverySeconds !== 0) return;
      if (n >= CLOCK.lastWarnTick) return;
      CLOCK.lastWarnTick = n;
      try { UI.sendAudioEvent(ENGINE.audioUrgency); } catch (e) { /* no audio */ }
      log(`urgency beep at ${n}s`);
    }

    /**
     * The ring animates on wall clock between scrubs, so it would keep moving
     * while the game is paused even though the phase clock stops. Freeze it
     * during pause; the first event after unpause scrubs it back into place.
     */
    mptOnGamePauseChanged(data) {
      const paused = !!data && Number(data.data) === 1;
      const rings = this.timerAnimationElements;
      if (rings) {
        for (const el of rings) el.style.animationPlayState = paused ? 'paused' : 'running';
      }
      log(paused ? 'game paused - ring frozen' : 'game resumed');
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
