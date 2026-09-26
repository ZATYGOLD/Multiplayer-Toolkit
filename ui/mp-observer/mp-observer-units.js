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
 * Multiplayer Toolkit - Observer units (in-game scope).
 *
 * The Observer's Eye (data/observer/observer-units.xml) keeps the whole map
 * and every unit in sight. For the Observer seat, other players' units are
 * selected with the game's own selection so the base unit panel shows them
 * (combat preview: mp-observer-combat.js). The base game only ever selects
 * the local player's own units, so every step that assumes ownership is
 * guarded:
 *   - selection: clicking a tile cycles through its units, clicking a unit
 *     flag selects that unit, and the unit-selected mode allows them;
 *   - map decorations (move range, attack targets, path) are skipped for
 *     them; drawing them for a foreign unit hung the GPU;
 *   - orders: right-click / move-to and unit operations or commands are never
 *     sent for a unit the Observer does not own.
 * The Observer's own units (the Eye) are never selected.
 */
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import UnitSelection from 'fs://game/base-standard/ui/unit-selection/unit-selection.js';
import { UnitMapDecorationSupport } from 'fs://game/base-standard/ui/interface-modes/support-unit-map-decoration.js';
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { InputHandlerState } from 'fs://game/core/ui/input/input-support.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { createLogger, findAncestor, isObserverPlayer, wrapMethod } from '../mpt-shared/mpt-util.js';
import { isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-units');

/** True when the Observer seat is looking at a unit it does not own. */
function isForeign(unitId) {
  return isObserverSeat() && !!unitId && ComponentID.isValid(unitId) && unitId.owner !== GameContext.localPlayerID;
}

/** Units on a tile the Observer can inspect (other players' units only). */
function inspectableUnits(x, y) {
  try { return MapUnits.getUnits(x, y).filter((id) => !isObserverPlayer(id.owner)); }
  catch (e) { return []; }
}

// ============================ Selection ============================

function selectUnit(unitId) {
  UI.Player.selectUnit(unitId);
  if (!ComponentID.isMatch(UI.Player.getHeadSelectedUnit(), unitId)) log(`selection refused for ${ComponentID.toLogString(unitId)}`);
}

/** Unit flags only select the local player's units; for the Observer they select any other unit. */
function onEngineInput(ev) {
  const d = ev.detail;
  if (!d || d.status !== InputActionStatuses.FINISH || d.name !== 'mousebutton-left' || !isObserverSeat()) return;
  const flag = findAncestor(ev.target, (el) => !!el.getAttribute('unit-id'));
  const unitId = flag ? ComponentID.fromString(flag.getAttribute('unit-id')) : null;
  if (!isForeign(unitId)) return;
  selectUnit(unitId);
  ev.stopPropagation();
  ev.preventDefault();
}

function patchSelection() {
  wrapMethod(WorldInput, 'handleSelectedPlotUnit', (base, location, ...rest) => {
    if (!isObserverSeat()) return base(location, ...rest);
    const units = inspectableUnits(location.x, location.y);
    if (units.length === 0) return true;
    const current = units.findIndex((id) => ComponentID.isMatch(id, UI.Player.getHeadSelectedUnit()));
    selectUnit(units[(current + 1) % units.length]);
    return false;
  });
  wrapMethod(UnitSelection, 'trySwitchToUnitSelectedMode', (base, unitId, ...rest) => {
    if (!isForeign(unitId)) return base(unitId, ...rest);
    return InterfaceMode.isInInterfaceMode('INTERFACEMODE_UNIT_SELECTED') || InterfaceMode.switchTo('INTERFACEMODE_UNIT_SELECTED', { UnitID: unitId });
  });
}

// ============================ Guards ============================

function patchGuards() {
  const decorations = UnitMapDecorationSupport.manager;
  wrapMethod(decorations, 'activate', (base, unitId, ...rest) => (isForeign(unitId) ? undefined : base(unitId, ...rest)));
  wrapMethod(decorations, 'update', (base, ...args) => (isForeign(decorations.unitID) ? undefined : base(...args)));

  const headIsForeign = () => isForeign(UI.Player.getHeadSelectedUnit());
  wrapMethod(WorldInput, 'doActionOnPlot', (base, ...args) => (headIsForeign() ? undefined : base(...args)));
  wrapMethod(WorldInput, 'actionMouseRightButton', (base, ...args) => (headIsForeign() ? InputHandlerState.Handled : base(...args)));
  wrapMethod(WorldInput, 'requestMoveOperation', (base, unitId, ...rest) => (isForeign(unitId) ? false : base(unitId, ...rest)));
  for (const library of [Game.UnitOperations, Game.UnitCommands]) {
    try { wrapMethod(library, 'sendRequest', (base, unitId, ...rest) => (isForeign(unitId) ? undefined : base(unitId, ...rest))); }
    catch (e) { log(`order guard unavailable: ${e}`); }
  }
}

patchSelection();
patchGuards();
window.addEventListener('engine-input', onEngineInput, true);

export { inspectableUnits, isForeign };
