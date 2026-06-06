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
 * Multiplayer Toolkit - Observer-gated turn advancement (in-game scope).
 *
 * An AI-only game (or any game with no turn timer) advances turns on its own.
 * For an observer this holds the game at the start of each turn and only lets
 * it advance when the observer presses the game's own action panel (end-turn)
 * button - stepping through the game one turn at a time, using the native UI
 * rather than a separate control.
 *
 * The hold uses the engine's multiplayer pause (the only script-reachable way
 * to stop turn processing). Active ONLY when the local context is an observer
 * AND (there are no other human players OR no turn timer is running), so it
 * never fights real human players who are driving the clock themselves.
 *
 * EXPERIMENTAL: whether the engine honors an observer's pause is itself
 * untested; this surfaces it. Best used with the synchronized-pause feature
 * off (it would otherwise pop its menu on each hold).
 */
import { CONFIG } from './mp-observer-config.js';

const ACTION_BUTTON_SELECTOR = '.action-panel__button-next-action';
const POLL_MS = 1000;

let releasedForOneTurn = false;
let lastTurn = -1;
let hookedButton = null;

function log(message) {
  if (CONFIG.debug) console.log(`[MPT observer-turns] ${message}`);
}

function isObserverContext() {
  try {
    const id = GameContext.localObserverID;
    if (id === PlayerIds.OBSERVER_ID) return true;
    if (id === PlayerIds.NO_PLAYER) return false;
    return !Players.get(id);
  } catch (e) { return false; }
}

/** Living human players that are NOT the local observer. */
function otherHumanCount() {
  let count = 0;
  try {
    for (const player of Players.getAlive()) {
      if (player?.isHuman && !player.isObserver) count++;
    }
  } catch (e) { /* treat as none */ }
  return count;
}

function noTurnTimer() {
  try {
    const type = Configuration.getGame()?.turnTimerType;
    return type == null || type === 0 || type === Database.makeHash('TURNTIMER_NONE');
  } catch (e) { return true; }
}

/** The gate is live only for an observer when no humans/timer drive the clock. */
function gatingActive() {
  return isObserverContext() && (otherHumanCount() === 0 || noTurnTimer());
}

function isPaused() {
  try { return (Network.getNumWantPausePlayers() | 0) > 0; } catch (e) { return false; }
}

function setPaused(want) {
  try {
    if (isPaused() !== !!want) Network.toggleMultiplayerPause();
  } catch (e) { log(`pause toggle failed: ${e}`); }
}

function currentTurn() {
  try { return Game.turn ?? -1; } catch (e) { return -1; }
}

// ====================== Action panel hook ======================

function onNextTurn() {
  if (!gatingActive()) return;
  releasedForOneTurn = true;
  lastTurn = currentTurn();
  setPaused(false);
  log('turn released via action panel');
}

/** The game's end-turn button, kept clickable so the observer can step turns. */
function hookActionPanel() {
  try {
    const btn = document.querySelector(ACTION_BUTTON_SELECTOR);
    if (!btn) return;
    if (btn !== hookedButton) {
      hookedButton = btn;
      btn.addEventListener('action-activate', onNextTurn);
      btn.addEventListener('click', onNextTurn);
      log('action panel end-turn button hooked');
    }
    // An observer's end-turn button is normally inert; keep it interactive.
    btn.classList.remove('disabled');
    btn.removeAttribute('disabled');
    btn.style.pointerEvents = 'auto';
  } catch (e) { log(`action panel hook failed: ${e}`); }
}

// ============================ Turn hold ============================

/** Re-hold at the start of each new turn (after a one-turn release). */
function onTurnChanged() {
  if (!gatingActive()) return;
  const turn = currentTurn();
  if (turn === lastTurn) return;
  lastTurn = turn;
  if (releasedForOneTurn) releasedForOneTurn = false;
  setPaused(true);
  hookActionPanel();
  log(`turn ${turn}: held`);
}

/** Periodic guard: keeps the hold asserted and the button hooked/clickable. */
function guard() {
  if (!gatingActive()) return;
  hookActionPanel();
  if (!releasedForOneTurn) setPaused(true);
}

function install() {
  engine.whenReady.then(() => {
    try {
      if (!gatingActive()) { log('turn gating inactive for this game'); }
      lastTurn = currentTurn();
      setPaused(gatingActive());
      hookActionPanel();
      engine.on('TurnBegin', onTurnChanged);
      engine.on('PlayerTurnActivated', onTurnChanged);
      engine.on('RemotePlayerTurnBegin', onTurnChanged);
      setInterval(guard, POLL_MS);
      log('observer turn gating installed');
    } catch (e) { log(`install failed: ${e}`); }
  });
}

if (CONFIG.turnGating) install();
