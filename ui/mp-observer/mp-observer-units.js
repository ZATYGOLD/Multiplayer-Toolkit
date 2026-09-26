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
 * and every unit in sight, so units render live. For the Observer seat, other
 * players' units are selected with the game's own selection, so the base unit
 * panel and combat preview show them. The base game only ever selects the
 * local player's units, so every step that assumes ownership is guarded:
 *   - selection: tile clicks cycle through the tile's units, flag clicks
 *     select that unit; the unit-selected mode is allowed for them;
 *   - map decorations (move range, attack targets, path) are skipped for
 *     them - the previous attempt hung the GPU right after those updated;
 *   - orders: right-click / move-to and unit operations or commands are never
 *     sent for a unit the Observer does not own.
 * The Eye is never selected and its flag shows faded and ignores the mouse.
 * It also logs how many units the Observer can see (UI.log). Other players
 * are untouched.
 */
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import UnitSelection from 'fs://game/base-standard/ui/unit-selection/unit-selection.js';
import { UnitMapDecorationSupport } from 'fs://game/base-standard/ui/interface-modes/support-unit-map-decoration.js';
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { InputHandlerState } from 'fs://game/core/ui/input/input-support.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { createLogger, isObserverPlayer, isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-units');
const OWN_FLAG_OPACITY = '0.5';

/** True when the Observer seat is looking at a unit it does not own. */
function isForeign(unitId) {
  return isObserverSeat() && !!unitId && ComponentID.isValid(unitId) && unitId.owner !== GameContext.localPlayerID;
}

const headIsForeign = () => isForeign(UI.Player.getHeadSelectedUnit());

// ============================ Selection ============================

/** Units on a plot the Observer can inspect (other players' units only). */
function inspectableUnits(x, y) {
  try { return MapUnits.getUnits(x, y).filter((id) => !isObserverPlayer(id.owner)); }
  catch (e) { return []; }
}

function selectUnit(unitId) {
  UI.Player.selectUnit(unitId);
  if (!ComponentID.isMatch(UI.Player.getHeadSelectedUnit(), unitId)) log(`selection refused for ${ComponentID.toLogString(unitId)}`);
}

/** Tile clicks cycle through the tile's units; the Eye is never selected. */
function patchPlotSelection() {
  const base = WorldInput.handleSelectedPlotUnit.bind(WorldInput);
  WorldInput.handleSelectedPlotUnit = (location, previousPlot, ...rest) => {
    if (!isObserverSeat()) return base(location, previousPlot, ...rest);
    const units = inspectableUnits(location.x, location.y);
    if (units.length === 0) return true;
    const current = units.findIndex((id) => ComponentID.isMatch(id, UI.Player.getHeadSelectedUnit()));
    selectUnit(units[(current + 1) % units.length]);
    return false;
  };
}

function flagUnitId(target) {
  for (let el = target; el && typeof el.getAttribute === 'function'; el = el.parentElement) {
    const id = el.getAttribute('unit-id');
    if (id) return ComponentID.fromString(id);
  }
  return null;
}

/** Unit flags only select the local player's units; for the Observer they select any other unit. */
function onEngineInput(ev) {
  const d = ev.detail;
  if (!d || d.status !== InputActionStatuses.FINISH || d.name !== 'mousebutton-left' || !isObserverSeat()) return;
  const id = flagUnitId(ev.target);
  if (!isForeign(id)) return;
  selectUnit(id);
  ev.stopPropagation();
  ev.preventDefault();
}

/** The unit-selected mode (base unit panel, combat preview) for other players' units. */
function patchSelectedMode() {
  const base = UnitSelection.trySwitchToUnitSelectedMode.bind(UnitSelection);
  UnitSelection.trySwitchToUnitSelectedMode = (unitID, ...rest) => {
    if (!isForeign(unitID)) return base(unitID, ...rest);
    if (InterfaceMode.isInInterfaceMode('INTERFACEMODE_UNIT_SELECTED')) return true;
    return InterfaceMode.switchTo('INTERFACEMODE_UNIT_SELECTED', { UnitID: unitID });
  };
}

// ============================ Guards ============================

/** No move range, attack targets or path for units the Observer does not own. */
function patchDecorations() {
  const manager = UnitMapDecorationSupport.manager;
  for (const name of ['activate', 'update']) {
    const base = manager[name].bind(manager);
    manager[name] = (...args) => {
      const unitId = name === 'activate' ? args[0] : manager.unitID;
      if (isForeign(unitId)) return undefined;
      return base(...args);
    };
  }
}

/** Never order a unit the Observer does not own. */
function patchOrders() {
  for (const name of ['doActionOnPlot', 'actionMouseRightButton']) {
    const base = WorldInput[name].bind(WorldInput);
    WorldInput[name] = (...args) => (headIsForeign() ? (name === 'doActionOnPlot' ? undefined : InputHandlerState.Handled) : base(...args));
  }
  const base = WorldInput.requestMoveOperation.bind(WorldInput);
  WorldInput.requestMoveOperation = (unitId, ...rest) => (isForeign(unitId) ? false : base(unitId, ...rest));
  for (const library of [Game.UnitOperations, Game.UnitCommands]) {
    try {
      const baseSend = library.sendRequest.bind(library);
      library.sendRequest = (unitId, ...rest) => (isForeign(unitId) ? undefined : baseSend(unitId, ...rest));
    } catch (e) { log(`order guard unavailable: ${e}`); }
  }
}

/** The Eye's flag shows faded and cannot be clicked. */
function fadeOwnFlags() {
  const proto = GenericUnitFlag.prototype;
  const baseAttach = proto.onAttach;
  proto.onAttach = function (...args) {
    const result = baseAttach.apply(this, args);
    try {
      if (isObserverSeat() && this.componentID?.owner === GameContext.localPlayerID) {
        this.Root.style.opacity = OWN_FLAG_OPACITY;
        this.Root.style.pointerEvents = 'none';
      }
    } catch (e) { /* keep the flag */ }
    return result;
  };
}

// ============================ Diagnostics ============================

/** UI.log check that the Eye works: other players' units on visible plots. */
function logVisibility() {
  if (!isObserverSeat()) return;
  const me = GameContext.localPlayerID;
  let total = 0, visible = 0;
  try {
    for (const player of Players.getAlive()) {
      if (player.id === me || isObserverPlayer(player.id)) continue;
      for (const unit of player.Units?.getUnits?.() ?? []) {
        total++;
        const loc = unit.location;
        if (loc && GameplayMap.getRevealedState(me, loc.x, loc.y) === RevealedStates.VISIBLE) visible++;
      }
    }
  } catch (e) { log(`visibility check failed: ${e}`); return; }
  log(`units on visible plots: ${visible}/${total}`);
}

fadeOwnFlags();
patchPlotSelection();
patchSelectedMode();
patchDecorations();
patchOrders();
engine.whenReady.then(() => {
  window.addEventListener('engine-input', onEngineInput, true);
  engine.on('LocalPlayerTurnBegin', logVisibility);
  setTimeout(logVisibility, 5000);
  log('observer unit selection installed');
});
