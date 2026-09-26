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
 * Multiplayer Toolkit - Observer diplomacy (in-game scope).
 *
 * For the Observer seat:
 *   - met everyone: the Observer's own hasMet answers true, so every screen
 *     shows real leader names and portraits instead of "unmet";
 *   - leader panel: the actions tab lists every war the selected leader is in
 *     (the base panel lists only wars involving the local player) and offers
 *     no diplomatic actions; the relationships tab leaves the Observer out.
 */
import DiplomacyManager from 'fs://game/base-standard/ui/diplomacy/diplomacy-manager.js';
import 'fs://game/base-standard/ui/diplomacy-actions/panel-other-diplomacy.js';   // defines PANEL_TAG
import { clearChildren, createLogger, isObserverPlayer, wrapMethod } from '../mpt-shared/mpt-util.js';
import { isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-diplomacy');
const PANEL_TAG = 'panel-other-player-diplomacy-actions';
const OMIT_CLASS = 'mpt-observer-omit';
const OWN_RELATIONSHIP = '#panel-diplomacy-actions__relationship-event-container';
const OTHER_RELATIONSHIPS = '#panel-diplomacy-actions__other-relationships-container';

let metInstalled = false;

/** The Observer's own diplomacy object answers hasMet with true (requires the engine to reuse that object). */
function installMetEveryone() {
  if (metInstalled || !isObserverSeat()) return;
  metInstalled = true;
  const own = Players.get(GameContext.localPlayerID)?.Diplomacy;
  if (!own || Players.get(GameContext.localPlayerID)?.Diplomacy !== own) { log('diplomacy object is not stable; met-everyone skipped'); return; }
  wrapMethod(Object.getPrototypeOf(own), 'hasMet', function (base, playerId, ...rest) {
    return (this === own && playerId !== GameContext.localPlayerID) || base(playerId, ...rest);
  });
}

/** Every war the given player is part of (one entry per war). */
function warsOf(playerId) {
  const seen = new Set();
  try {
    return Game.Diplomacy.getPlayerEvents(playerId).filter((action) => {
      if (action.actionType != DiplomacyActionTypes.DIPLOMACY_ACTION_DECLARE_WAR || seen.has(action.uniqueID)) return false;
      seen.add(action.uniqueID);
      return true;
    });
  } catch (e) { return []; }
}

function header(title) {
  const el = document.createElement('fxs-header');
  el.classList.add('relative');
  el.setAttribute('title', title);
  el.setAttribute('filigree-style', 'h3');
  return el;
}

function note(loc) {
  const p = document.createElement('p');
  p.classList.value = 'font-body-base text-accent-2 text-center mt-2';
  p.setAttribute('data-l10n-id', loc);
  return p;
}

/** Drop Observer portraits (and rows left empty) and the leader's relationship with the Observer. */
function removeObserverRelationships(root) {
  root.querySelector(OWN_RELATIONSHIP)?.style.setProperty('display', 'none');
  for (const icon of root.querySelectorAll('.' + OMIT_CLASS)) icon.remove();
  const rows = root.querySelector(OTHER_RELATIONSHIPS);
  for (const row of [...(rows?.children ?? [])]) {
    if (!row.querySelector('#relationship-icon-row')?.children.length) row.remove();
  }
}

function patchPanel(proto) {
  wrapMethod(proto, 'createBorderedIcon', (base, iconURL, leaderID, ...rest) => {
    const icon = base(iconURL, leaderID, ...rest);
    if (isObserverSeat() && leaderID != null && isObserverPlayer(leaderID)) icon.classList.add(OMIT_CLASS);
    return icon;
  });

  wrapMethod(proto, 'populateRelationshipInfo', function (base, ...args) {
    const result = base(...args);
    if (isObserverSeat()) removeObserverRelationships(this.Root);
    return result;
  });

  wrapMethod(proto, 'populateAvailableActions', function (base, ...args) {
    if (!isObserverSeat()) return base(...args);
    clearChildren(this.majorActionsSlot);
  });

  wrapMethod(proto, 'populateActionsPanel', function (base, ...args) {
    if (!isObserverSeat()) return base(...args);
    const slot = this.Root.querySelector('#available-projects-slot');
    if (!slot) return;
    clearChildren(slot);
    this.firstFocusSection = null;
    const wars = warsOf(DiplomacyManager.selectedPlayerID);
    slot.appendChild(header('LOC_DIPLOMACY_WAR_HEADER'));
    if (wars.length === 0) { slot.appendChild(note('LOC_MPT_OBSERVER_NO_WARS')); return; }
    for (const war of wars) {
      const item = this.createWarInfoElement(war);
      item.addEventListener('action-activate', () => this.clickOngoingAction(war.uniqueID));
      slot.appendChild(item);
    }
  });
}

const proto = Controls.getDefinition(PANEL_TAG)?.createInstance?.prototype;
if (proto) patchPanel(proto);
else log('leader panel not found');

engine.whenReady.then(() => {
  installMetEveryone();
  engine.on('LocalPlayerTurnBegin', installMetEveryone);
});
