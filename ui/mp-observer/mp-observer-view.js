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
 * player's perspective - their revealed map and fog of war - via the engine's
 * Autoplay.setObserveAsPlayer(). Right-click the same leader again to return to
 * the full map (OBSERVER_ID god-view). The camera jumps to that player's capital,
 * and each leader shows a "Player View - Right Click" tooltip.
 *
 * Gating is by the CLIENT's own slot (are *we* the observer?), not the current
 * view: once you adopt a player's view, GameContext.localObserverID points at
 * that player, so a view-based check would wrongly go dormant and trap you in
 * that player's eyes. Slot-based gating lets right-click keep switching players
 * and toggling back to the full map. A seated player is never affected.
 */
import { CONFIG } from './mp-observer-config.js';

const LEADER_HITBOX = '.diplo-ribbon__portrait-hitbox';
const TIP_TEXT = 'Player View - Right Click';
const TIP_FLAG = 'data-mpt-viewtip';

let currentObservedId = PlayerIds.OBSERVER_ID;

function log(m) { if (CONFIG.debug) { try { console.log('[MPT observer-view] ' + m); } catch (e) {} } }

/** True when THIS client's own slot is an observer (stable across view changes). */
function isObserverClient() {
  try {
    const pc = Configuration.getPlayer(GameContext.localPlayerID);
    if (pc && pc.isObserver) return true;
  } catch (e) { /* fall through */ }
  try { return GameContext.localObserverID === PlayerIds.OBSERVER_ID; } catch (e) { return false; }
}

/** Full map is always allowed; otherwise only a valid, living player. */
function isViewable(id) {
  if (id === PlayerIds.OBSERVER_ID) return true;
  try { return Players.isValid(id) && Players.isAlive(id); } catch (e) { return false; }
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
    if (!isObserverClient()) return;
    const d = ev.detail;
    if (!d || d.name !== 'mousebutton-right' || d.status !== InputActionStatuses.FINISH) return;
    const id = playerIdFromEvent(ev);
    if (id == null || id === PlayerIds.NO_PLAYER) return;   // not a leader element - let it pass
    // Toggle: right-clicking the player you're already viewing returns to the full map.
    const target = id === currentObservedId ? PlayerIds.OBSERVER_ID : id;
    if (!isViewable(target)) return;                        // never hand a dead/invalid id to the engine
    viewAs(target);
    ev.stopPropagation();
    ev.preventDefault();
  } catch (e) { /* ignore */ }
}

/** Add the "Player View - Right Click" hint to each leader tooltip (once per element). */
function decorateTooltips() {
  if (!isObserverClient()) return;
  let els;
  try { els = document.querySelectorAll(LEADER_HITBOX); } catch (e) { return; }
  for (const el of els) {
    if (el.getAttribute(TIP_FLAG) === '1') continue;
    const cur = el.getAttribute('data-tooltip-content') || '';
    el.setAttribute('data-tooltip-content', cur ? (cur + ' — ' + TIP_TEXT) : TIP_TEXT);
    el.setAttribute(TIP_FLAG, '1');
  }
}

/**
 * Normalize the observer baseline to the proper full-map id (OBSERVER_ID). A
 * real multiplayer observer can sit at NO_PLAYER, where several base panels bail
 * (e.g. the ribbon model's createPlayerData returns an empty entry for
 * NO_PLAYER but works for OBSERVER_ID). Establishing OBSERVER_ID gives the HUD a
 * valid full-map identity to build against, without adopting any one player.
 */
function normalizeGodView() {
  if (!isObserverClient()) return;
  try {
    if (GameContext.localObserverID !== PlayerIds.OBSERVER_ID) {
      Autoplay.setObserveAsPlayer(PlayerIds.OBSERVER_ID);
      currentObservedId = PlayerIds.OBSERVER_ID;
      log('normalized observer baseline to full-map (OBSERVER_ID)');
    }
  } catch (e) { log('normalize failed: ' + e); }
}

engine.whenReady.then(() => {
  if (CONFIG.viewAsEnabled === false) { log('view-as disabled via config'); return; }
  normalizeGodView();
  // Delegated + capturing so it works regardless of ribbon rebuilds.
  window.addEventListener('engine-input', onEngineInput, true);
  setInterval(decorateTooltips, 1000);   // re-apply after ribbon rebuilds
  log(isObserverClient()
    ? 'active: right-click a leader to view their map; right-click again for full map'
    : 'not an observer - view-as idle');
});

export default { onEngineInput };
