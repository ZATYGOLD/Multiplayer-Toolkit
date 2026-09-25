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
 * Multiplayer Toolkit - observer turn control (in-game scope, experimental).
 *
 * When the only human in a game is an observer, the AI-only game advances turns
 * on its own. This lets the observer decide when the next turn happens: the game
 * is held at each turn until "Next Turn" is pressed, or "Auto Turns" can be
 * switched on to let it run freely.
 *
 * The multiplayer pause cannot do this - the engine ignores an observer's pause.
 * Instead this drives the engine's Autoplay controller, the same one the AI
 * benchmark uses to hold and release an AI-only game (setActive + setPause),
 * with the observer as the viewing identity. It is active ONLY for a lone
 * observer (no human is playing), so it never touches a game real players drive.
 * The controls are appended to the observer toolbar.
 */
import { CONFIG } from './mp-observer-config.js';

const TOOLBAR_ID = 'mpt-observer-toolbar';
const CONTROLS_ID = 'mpt-observer-turn-controls';
const NEXT_BTN_ID = 'mpt-observer-next-turn';
const AUTO_BTN_ID = 'mpt-observer-auto-turns';
const POLL_MS = 250;
const STABLE_TICKS = 4;          // lone-observer state must hold this many ticks before engaging
const ACTIVATE_DEBOUNCE_MS = 250;

let autoTurns = false;           // false = hold each turn; true = run freely
let stepping = false;            // one turn has been released and is advancing
let heldTurn = -1;               // turn the observer is holding at / released from
let engagedByUs = false;         // we switched Autoplay on (so only we switch it off)
let appliedHeld = null;          // last pause state pushed to Autoplay
let stableTicks = 0;
let lastActivateAt = 0;

function log(m) { if (CONFIG.debug) { try { console.log('[MPT observer-turns] ' + m); } catch (e) {} } }

// ============================ Game state ============================

/** True when THIS client's own slot is an observer. */
function isObserverClient() {
  try {
    const pc = Configuration.getPlayer(GameContext.localPlayerID);
    if (pc && pc.isObserver) return true;
  } catch (e) { /* fall through */ }
  try { return GameContext.localObserverID === PlayerIds.OBSERVER_ID; } catch (e) { return false; }
}

/** { majors, humans } among living major players (an observer is not a major). */
function playerCounts() {
  const counts = { majors: 0, humans: 0 };
  try {
    for (const entry of Players.getAlive()) {
      const p = (entry && entry.isMajor !== undefined) ? entry : Players.get(entry);
      if (!p || !p.isMajor || p.id === GameContext.localPlayerID) continue;
      counts.majors++;
      if (p.isHuman) counts.humans++;
    }
  } catch (e) { /* keep zeros */ }
  return counts;
}

function currentTurn() {
  try { return Game.turn ?? -1; } catch (e) { return -1; }
}

function autoplayReady() {
  return typeof Autoplay !== 'undefined'
    && typeof Autoplay.setActive === 'function'
    && typeof Autoplay.setPause === 'function';
}

/** Lone observer watching a loaded, AI-only game. */
function loneObserver() {
  if (CONFIG.turnControl === false || !autoplayReady() || !isObserverClient()) return false;
  const { majors, humans } = playerCounts();
  return majors > 0 && humans === 0;
}

// ============================ Autoplay ============================

function engage() {
  try {
    if (Autoplay.isActive) return;
    try { Autoplay.setReturnAsPlayer(GameContext.localPlayerID); } catch (e) { /* optional */ }
    Autoplay.setActive(true);
    engagedByUs = true;
    appliedHeld = null;   // re-push the hold state onto the fresh session
    log('autoplay engaged for observer turn control');
  } catch (e) { log('autoplay engage failed: ' + e); }
}

function disengage() {
  if (!engagedByUs) return;
  try { Autoplay.setPause(false); } catch (e) { /* ignore */ }
  try { Autoplay.setActive(false); } catch (e) { /* ignore */ }
  engagedByUs = false;
  appliedHeld = null;
  log('autoplay released (a human is playing or control is off)');
}

/** Held unless Auto Turns is on or a single turn is currently advancing. */
function applyHeld() {
  const want = !autoTurns && !stepping;
  if (appliedHeld === want) return;
  try { Autoplay.setPause(want); appliedHeld = want; }
  catch (e) { log('setPause failed: ' + e); }
}

// ============================ Actions ============================

function onNextTurn() {
  if (!engagedByUs || autoTurns || stepping) return;
  stepping = true;
  heldTurn = currentTurn();
  applyHeld();
  refreshButtons();
  log('next turn released from turn ' + heldTurn);
}

function onToggleAuto() {
  if (!engagedByUs) return;
  autoTurns = !autoTurns;
  stepping = false;
  heldTurn = currentTurn();
  applyHeld();
  refreshButtons();
  log('auto turns ' + (autoTurns ? 'on' : 'off'));
}

/** One activation per press: the activatable can report both click and action-activate. */
function debounced(fn) {
  return () => {
    const now = Date.now();
    if (now - lastActivateAt < ACTIVATE_DEBOUNCE_MS) return;
    lastActivateAt = now;
    fn();
  };
}

// ============================ Controls ============================

function makeButton(id, onActivate) {
  const btn = document.createElement('fxs-activatable');
  btn.id = id;
  btn.classList.add('mpt-observer-turn-btn', 'pointer-events-auto');
  btn.style.cssText =
    'padding: 0.25rem 1rem; margin: 0 0.25rem; cursor: pointer; font-size: 0.9rem;' +
    'border: 0.0555555556rem solid #8c7e62; border-radius: 0.25rem; color: #e7d9ac;' +
    'background: rgba(20, 26, 38, 0.85); text-shadow: 0 0 2px #000;';
  const handler = debounced(onActivate);
  btn.addEventListener('action-activate', handler);
  btn.addEventListener('click', handler);
  return btn;
}

function setLabel(btn, loc) {
  if (btn.getAttribute('data-loc') === loc) return;
  btn.setAttribute('data-loc', loc);
  btn.innerHTML = Locale.compose(loc);
}

function refreshButtons() {
  const next = document.getElementById(NEXT_BTN_ID);
  if (next) {
    setLabel(next, stepping ? 'LOC_MPT_OBSERVER_ADVANCING' : 'LOC_MPT_OBSERVER_NEXT_TURN');
    next.style.opacity = (autoTurns || stepping) ? '0.45' : '1';
  }
  const auto = document.getElementById(AUTO_BTN_ID);
  if (auto) {
    setLabel(auto, autoTurns ? 'LOC_MPT_OBSERVER_AUTO_ON' : 'LOC_MPT_OBSERVER_AUTO_OFF');
    auto.style.background = autoTurns ? 'rgba(231, 217, 172, 0.9)' : 'rgba(20, 26, 38, 0.85)';
    auto.style.color = autoTurns ? '#1a1a1a' : '#e7d9ac';
  }
}

/** Attach the controls to the observer toolbar (or a standalone bar until it exists). */
function ensureControls() {
  let box = document.getElementById(CONTROLS_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = CONTROLS_ID;
    box.appendChild(makeButton(NEXT_BTN_ID, onNextTurn));
    box.appendChild(makeButton(AUTO_BTN_ID, onToggleAuto));
  }
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (toolbar) {
    if (box.parentElement !== toolbar) {
      box.className = '';
      box.style.cssText = 'display: flex; flex-direction: row; align-items: center; margin-left: 0.75rem;';
      toolbar.appendChild(box);
    }
  } else if (!box.parentElement) {
    box.className = 'pointer-events-none';
    box.style.cssText =
      'position: fixed; top: 0.5rem; left: 50%; transform: translateX(-50%); z-index: 50;' +
      'display: flex; flex-direction: row; align-items: center;';
    document.body.appendChild(box);
  }
  refreshButtons();
}

function removeControls() {
  document.getElementById(CONTROLS_ID)?.remove();
}

// ============================ Loop ============================

function tick() {
  if (!loneObserver()) {
    stableTicks = 0;
    disengage();
    removeControls();
    return;
  }
  if (stableTicks < STABLE_TICKS) { stableTicks++; return; }   // wait until the state is settled
  engage();
  if (!engagedByUs) return;
  const turn = currentTurn();
  if (stepping && turn !== heldTurn) {   // the released turn has advanced: hold again
    stepping = false;
    heldTurn = turn;
    log('turn ' + turn + ': held');
  }
  applyHeld();
  ensureControls();
}

if (CONFIG.enabled !== false && CONFIG.turnControl !== false) {
  engine.whenReady.then(() => {
    heldTurn = currentTurn();
    setInterval(tick, POLL_MS);
    log('observer turn control installed');
  });
}

export default { onNextTurn, onToggleAuto };
