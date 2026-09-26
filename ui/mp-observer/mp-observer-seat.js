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
 * Multiplayer Toolkit - Observer seat (in-game scope).
 *
 * The Observer is a real player (data/observer/*.xml): valid player id, full
 * HUD, pause and End Turn all work natively. Its only unit is the Observer's
 * Eye, whose sight covers the whole map, so units are visible live (a map
 * reveal alone never shows units). The Eye has 1 move, so this module keeps it
 * asleep and it never asks for orders. Only runs for the Observer seat.
 */
import { createLogger, isObserverSeat } from './mp-observer-core.js';

const SLEEP_OPERATION = 'UNITOPERATION_SLEEP';

const log = createLogger('observer-seat');

function ownUnits() {
  return Players.get(GameContext.localPlayerID)?.Units?.getUnits?.() ?? [];
}

/** Put every awake unit the Observer owns (the Eye) to sleep. */
function sleepUnits() {
  if (!isObserverSeat()) return;
  for (const unit of ownUnits()) {
    try {
      if (!Game.UnitOperations.canStart(unit.id, SLEEP_OPERATION, {}, false)?.Success) continue;
      Game.UnitOperations.sendRequest(unit.id, SLEEP_OPERATION, {});
      log('eye put to sleep');
    } catch (e) { log(`sleep failed: ${e}`); }
  }
}

engine.whenReady.then(() => {
  if (!isObserverSeat()) return;
  const units = ownUnits().map((u) => `${GameInfo.Units.lookup(u.type)?.UnitType ?? u.type} @ ${u.location?.x},${u.location?.y}`);
  log(`observer seat: player ${GameContext.localPlayerID}, units [${units.join(', ')}]`);
  engine.on('LocalPlayerTurnBegin', sleepUnits);
  engine.on('UnitAddedToMap', (data) => { if (data?.unit?.owner === GameContext.localPlayerID) sleepUnits(); });
  sleepUnits();
});
