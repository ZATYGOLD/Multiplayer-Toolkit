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
 * Multiplayer Toolkit - observer "view as player" (0.5.6, experimental).
 *
 * Right-click a leader on the observer ribbon to see the game from that
 * player's perspective - their revealed map and fog of war - using the engine's
 * Autoplay.setObserveAsPlayer(). Right-click the same leader again to return to
 * the full map (OBSERVER_ID, the normal observer god-view). The camera also
 * jumps to that player's capital so the switch is obvious.
 *
 * Right-click arrives as an "engine-input" event named "mousebutton-right"; each
 * leader element on the base diplo-ribbon carries a data-player-id attribute, so
 * a single delegated capture-listener maps the click to a player and survives
 * the ribbon rebuilding. Everything is gated to an observer context, so a seated
 * player's view is never changed.
 */
import { CONFIG } from './mp-observer-config.js';

let currentObservedId = PlayerIds.OBSERVER_ID;

function log(m) { if (CONFIG.debug) { try { console.log('[MPT observer-view] ' + m); } catch (e) {} } }

/** True when the local viewing context is a spectator, not a seated player. */
function isObserverContext() {
  try {
    const id = GameContext.localObserverID;
    if (id === PlayerIds.OBSERVER_ID) return true;
    if (id === PlayerIds.NO_PLAYER) return false;
    return !Players.get(id);
  } catch (e) { return false; }
}

/** Human-readable label for the log. */
function label(id) {
  if (id === PlayerIds.OBSERVER_ID) return 'Full Map';
  try {
    const pc = Configuration.getPlayer(id);
    const nm = pc && (pc.leaderName || pc.civilizationName || pc.slotName);
    return nm ? Locale.compose(nm) : ('Player ' + id);
  } catch (e) { return 'Player ' + id; }
}

/** Move the camera to the player's first city, else a living unit. */
function lookAt(id) {
  if (id === PlayerIds.OBSERVER_ID) return;
  try {
    const p = Players.get(id);
    let loc = (p?.Cities?.getCities?.() ?? [])[0]?.location;
    if (!loc) loc = (p?.Units?.getUnits?.() ?? []).find((u) => !u.isDead)?.location;
    if (loc) Camera.lookAtPlot(loc, { zoom: 1 });
  } catch (e) { /* camera optional */ }
}

/** Adopt a player's fog-of-war view (or OBSERVER_ID for the full map). */
function viewAs(id) {
  try { Autoplay.setObserveAsPlayer(id); }
  catch (e) { log('setObserveAsPlayer failed: ' + e); return; }
  currentObservedId = id;
  lookAt(id);
  log('now viewing as: ' + label(id) + ' (id=' + id + ')');
}

/** Walk up from the event target to the nearest element tagged with a player id. */
function playerIdFromEvent(ev) {
  let el = ev.target;
  while (el && typeof el.getAttribute === 'function') {
    const a = el.getAttribute('data-player-id');
    if (a != null) { const n = parseInt(a, 10); return Number.isNaN(n) ? null : n; }
    el = el.parentElement;
  }
  return null;
}

function onEngineInput(ev) {
  try {
    if (!isObserverContext()) return;
    const d = ev.detail;
    if (!d || d.name !== 'mousebutton-right' || d.status !== InputActionStatuses.FINISH) return;
    const id = playerIdFromEvent(ev);
    if (id == null || id === PlayerIds.NO_PLAYER) return;   // not a leader element - let it pass
    // Toggle: right-clicking the player you're already viewing returns to the full map.
    viewAs(id === currentObservedId ? PlayerIds.OBSERVER_ID : id);
    ev.stopPropagation();
    ev.preventDefault();
  } catch (e) { /* ignore */ }
}

engine.whenReady.then(() => {
  // Delegated + capturing so it works regardless of ribbon rebuilds; gated
  // per-event, so it stays dormant for a seated player.
  window.addEventListener('engine-input', onEngineInput, true);
  log(isObserverContext()
    ? 'active: right-click a leader to view their map; right-click again for full map'
    : 'not an observer - view-as idle');
});

export default { onEngineInput };
