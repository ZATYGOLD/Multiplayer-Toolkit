/*
 * Zatygold's Observer Mode - a playable Observer for multiplayer Civilization VII.
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
 * Zatygold's Observer Mode - Observer turn ending (in-game scope).
 *
 * Auto End Turn (off by default, toggled from the Observer's ribbon card):
 * the Observer's turn ends as soon as nothing blocks it, never while the game
 * is paused, and never again in a turn the Observer un-readied itself (as the
 * game's own Auto End Turn option). Switching it off un-readies an ended turn
 * while the game still allows it.
 *
 * Age end: when an Age is complete, Auto End Turn switches off so the HUD's
 * Age transition action shows on the last turn and the Observer starts the
 * transition. Once the Age has ended the Observer always continues: those
 * turns end automatically (mp-observer-prompts.js skips the end-of-Age
 * screens).
 *
 * While the turn is ended for the Observer and the game is not paused, the
 * HUD's End Turn button (panel-action) slides down out of sight (and back up
 * when shown) by a stylesheet rule, which also covers a rebuilt button.
 *
 * Pause recovery (always on): the engine ignores a turn completion sent while
 * the game is paused, yet the client still counts the turn as ended, so the
 * game would wait on the Observer forever. After every unpause the Observer's
 * still-active, "ended" turn is sent again.
 */
import { createLogger, isAgeEnding } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-turn');
const HIDE_CLASS = 'mpt-observer-auto-turn';
const STYLE_ID = 'mpt-observer-turn-style';
const SLIDE = '0.35s ease';

let autoEnd = CONFIG.autoEndTurn;
let retryTimer = null;

const isPaused = () => !!Configuration.getGame().isPaused;
const turnActive = () => !!Players.get(GameContext.localPlayerID)?.isTurnActive;
const blocked = () => Game.Notifications.getEndTurnBlockingType(GameContext.localPlayerID) !== EndTurnBlockingTypes.NONE;
/** The Age has ended (after its last turn) and the next one has not begun. */
function ageOver() {
  try {
    if (Modding.getTransitionInProgress?.() === TransitionType.Age) return true;
    const ages = Game.AgeProgressManager;
    return !!ages?.isAgeOver && !ages.isFinalAge && !ages.isExtendedGame;
  } catch (e) { return false; }
}

const endsAutomatically = () => (autoEnd && !isAgeEnding()) || ageOver();

function sendTurnComplete() {
  UI.Player.deselectAllUnits();
  GameContext.sendTurnComplete();
}

/** End the turn now if possible; otherwise retry while the turn stays open. */
function tryEndTurn() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!endsAutomatically() || !isObserverSeat()) return;
  try {
    if (!turnActive() || GameContext.hasSentTurnComplete() || GameContext.hasSentTurnUnreadyThisTurn()) return;
    if (isPaused() || blocked()) { retryTimer = setTimeout(tryEndTurn, CONFIG.autoEndTurnRetryMs); return; }
    sendTurnComplete();
  } catch (e) { log(`auto end turn failed: ${e}`); }
}

/** Re-send a turn completion the engine dropped while paused. */
function recoverAfterPause() {
  if (!isObserverSeat() || isPaused()) return;
  try {
    if (turnActive() && GameContext.hasSentTurnComplete()) {
      log('re-sending turn completion after unpause');
      sendTurnComplete();
    }
  } catch (e) { log(`turn recovery failed: ${e}`); }
  tryEndTurn();
}

const later = (fn) => () => setTimeout(fn, CONFIG.autoEndTurnDelayMs);

/** Hide the End Turn button while the turn ends automatically (shown again when paused or off). */
function updateEndTurnButton() {
  if (!isObserverSeat()) return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      `panel-action { transition: transform ${SLIDE}, opacity ${SLIDE}; }`,
      `.${HIDE_CLASS} panel-action { transform: translateY(120%); opacity: 0; pointer-events: none; }`
    ].join('\n');
    document.head.appendChild(style);
  }
  document.body.classList.toggle(HIDE_CLASS, endsAutomatically() && !isPaused());
}

/** Turn start / Age end: refresh the button, then end the turn if it ends automatically. */
function onTurnState() {
  if (autoEnd && isObserverSeat() && isAgeEnding() && !ageOver()) {
    autoEnd = false;   // the last turn of the Age: the Observer starts the transition from the HUD
    log('age complete: auto end turn switched off');
  }
  updateEndTurnButton();
  tryEndTurn();
}

function isAutoEndTurn() { return autoEnd; }

function setAutoEndTurn(on) {
  autoEnd = !!on;
  updateEndTurnButton();
  if (autoEnd) { tryEndTurn(); return; }
  clearTimeout(retryTimer);
  retryTimer = null;
  try { if (Players.get(GameContext.localPlayerID)?.canUnreadyTurn) GameContext.sendUnreadyTurn(); }
  catch (e) { log(`unready failed: ${e}`); }
}

if (CONFIG.enabled) {
  for (const event of ['LocalPlayerTurnBegin', 'GameAgeEnded']) engine.on(event, later(onTurnState));
  engine.on('GamePauseStateChanged', () => { setTimeout(updateEndTurnButton, 0); later(recoverAfterPause)(); });
  engine.whenReady.then(later(onTurnState));
}

export { isAutoEndTurn, setAutoEndTurn };
