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
 * Multiplayer Toolkit - Observer's Eye (in-game scope).
 *
 * The Observer's only unit is the Eye (data/observer/observer-units.xml),
 * created on marine ice by the map script. Its sight covers the whole map, so
 * every unit shows live (revealing the map alone never shows units). For the
 * Observer seat its flag is hidden, and it is kept asleep: it has 1 move, so
 * it would otherwise ask for orders every turn. It is never selected
 * (mp-observer-units.js ignores the Observer's own units).
 */
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import { createLogger, isObserverPlayer, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-eye');
const SLEEP_OPERATION = 'UNITOPERATION_SLEEP';

const ownUnits = () => Players.get(GameContext.localPlayerID)?.Units?.getUnits?.() ?? [];

function sleepUnits() {
  if (!isObserverSeat()) return;
  for (const unit of ownUnits()) {
    try {
      if (Game.UnitOperations.canStart(unit.id, SLEEP_OPERATION, {}, false)?.Success) Game.UnitOperations.sendRequest(unit.id, SLEEP_OPERATION, {});
    } catch (e) { log(`sleep failed: ${e}`); }
  }
}

function hideOwnFlags() {
  wrapMethod(GenericUnitFlag.prototype, 'onAttach', function (base, ...args) {
    const result = base(...args);
    try { if (isObserverSeat() && this.componentID?.owner === GameContext.localPlayerID) this.hide(); }
    catch (e) { /* keep the flag */ }
    return result;
  });
}

/** Debug: where the Eye is, and how many other units are on visible plots. */
function logVision() {
  const me = GameContext.localPlayerID;
  const eyes = ownUnits().map((u) => `${u.location?.x},${u.location?.y}`).join(' ');
  let total = 0, visible = 0;
  for (const player of Players.getAlive()) {
    if (isObserverPlayer(player.id)) continue;
    for (const unit of player.Units?.getUnits?.() ?? []) {
      total++;
      const loc = unit.location;
      if (loc && GameplayMap.getRevealedState(me, loc.x, loc.y) === RevealedStates.VISIBLE) visible++;
    }
  }
  log(`eye at [${eyes}], units on visible plots: ${visible}/${total}`);
}

hideOwnFlags();
engine.whenReady.then(() => {
  if (!isObserverSeat()) return;
  engine.on('LocalPlayerTurnBegin', sleepUnits);
  engine.on('UnitAddedToMap', (data) => { if (data?.unit?.owner === GameContext.localPlayerID) sleepUnits(); });
  sleepUnits();
  if (CONFIG.debug) {
    engine.on('LocalPlayerTurnBegin', logVision);
    logVision();
  }
});
