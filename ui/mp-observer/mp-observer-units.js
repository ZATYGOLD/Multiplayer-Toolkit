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
 *     sent for a unit the Observer does not own;
 *   - combat preview: with a combat unit selected, hovering another player's
 *     unit shows the base combat preview window. The engine simulation is
 *     asked first (with an explicit melee / ranged type), but it only answers
 *     for the local player's own units - it stays empty even for a leader's
 *     unit against an independent it is at war with - so the window is then
 *     filled from an estimate with the game's damage formula
 *     (30 * e^(strength difference / 25), -1 strength per 10 HP lost). The
 *     estimate has no terrain, fortification or promotion modifiers; a note
 *     centred above the outcome says so.
 * The Eye is never selected and its flag is hidden (hiding the flag does not
 * affect its vision).
 * It also logs how many units the Observer can see (UI.log). Other players
 * are untouched.
 */
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import UnitSelection from 'fs://game/base-standard/ui/unit-selection/unit-selection.js';
import { UnitMapDecorationSupport } from 'fs://game/base-standard/ui/interface-modes/support-unit-map-decoration.js';
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import 'fs://game/base-standard/ui/unit-combat-preview/panel-unit-combat-preview.js';   // defines PREVIEW_TAG
import { PlotCursor } from 'fs://game/core/ui/input/plot-cursor.js';
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { InputHandlerState } from 'fs://game/core/ui/input/input-support.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { createLogger, isObserverPlayer, isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-units');
const PREVIEW_TAG = 'panel-unit-combat-preview';

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

// ============================ Combat preview ============================

const ESTIMATE_CLASS = 'mpt-combat-estimate';
const PREVIEW_LIFT = 'translateY(-4.5rem)';   // above the unit panel and turn text shown for a selected unit
const DAMAGE_BASE = 30;
const DAMAGE_SCALE = 25;
const HP_PER_STRENGTH = 10;

/** First unit on the hovered tile that belongs to neither the attacker's owner nor an Observer. */
function hoveredOpponent(attacker) {
  const plot = PlotCursor.plotCursorCoords;
  if (!plot) return ComponentID.getInvalidID();
  return inspectableUnits(plot.x, plot.y).find((id) => id.owner !== attacker.owner) ?? ComponentID.getInvalidID();
}

const meleeStrength = (unit) => unit?.Combat?.getMeleeStrength?.(false) ?? 0;
const rangedStrength = (unit) => Math.max(unit?.Combat?.rangedStrength ?? 0, unit?.Combat?.bombardStrength ?? 0);
const isRangedAttacker = (unit) => rangedStrength(unit) > meleeStrength(unit);

/** One side of an estimated fight, in the shape of a simulation result. */
function estimatedSide(unit, strength, strengthType) {
  const health = unit.Health;
  const penalty = health ? Math.floor(health.damage / HP_PER_STRENGTH) : 0;
  return { ID: unit.id, CombatStrength: strength, StrengthModifier: -penalty, CombatStrengthType: strengthType, MaxHitPoints: health?.maxDamage ?? 100, DamageTo: 0 };
}

/** The game's damage formula applied to base strengths (no terrain / fortify / promotion modifiers). */
function estimateCombat(attackerId, defenderId, location, token) {
  const attacker = Units.get(attackerId);
  const defender = Units.get(defenderId);
  if (!attacker || !defender) return null;
  const ranged = isRangedAttacker(attacker);
  const a = estimatedSide(attacker, ranged ? rangedStrength(attacker) : meleeStrength(attacker), ranged ? CombatStrengthTypes.STRENGTH_RANGED : CombatStrengthTypes.STRENGTH_MELEE);
  const d = estimatedSide(defender, meleeStrength(defender), CombatStrengthTypes.STRENGTH_MELEE);
  const diff = (a.CombatStrength + a.StrengthModifier) - (d.CombatStrength + d.StrengthModifier);
  d.DamageTo = Math.round(DAMAGE_BASE * Math.exp(diff / DAMAGE_SCALE));
  a.DamageTo = ranged ? 0 : Math.round(DAMAGE_BASE * Math.exp(-diff / DAMAGE_SCALE));
  return { QueryToken: token, Location: location, CombatType: ranged ? CombatTypes.COMBAT_RANGED : CombatTypes.COMBAT_MELEE, Attacker: a, Defender: d };
}

/**
 * The preview's portrait for a unit's owner. The base window only sets it when
 * the owner has a leader, so an independent or city-state unit kept the
 * previous portrait (it looked like both units belonged to one leader); those
 * show their civilization symbol instead, as the plot tooltip does.
 */
function setOwnerIcon(icon, unitId) {
  const unit = Units.get(unitId);
  const owner = unit ? Players.get(unit.owner) : null;
  if (!icon || !owner) return;
  if (owner.isMajor) {
    icon.style.backgroundImage = '';
    icon.setAttribute('data-icon-id', GameInfo.Leaders.lookup(owner.leaderType)?.LeaderType ?? 'UNKNOWN_LEADER');
    return;
  }
  let civOwner = owner;
  try {
    const independentId = Game.IndependentPowers.getIndependentPlayerIDFromUnit(unit.id);
    if (independentId != PlayerIds.NO_PLAYER) civOwner = Players.get(independentId) ?? owner;
  } catch (e) { /* the unit's owner */ }
  icon.removeAttribute('data-icon-id');
  icon.style.backgroundImage = Icon.getCivSymbolCSSFromCivilizationType(civOwner.civilizationType) || '';
  icon.style.backgroundSize = 'contain';
}

/** "Estimate" note centred above the outcome box; shown only for estimated fights. */
function setEstimateNote(root, visible) {
  const outcome = root?.querySelector('.preview-outcome');
  if (!outcome) return;
  let note = outcome.querySelector('.' + ESTIMATE_CLASS);
  if (!note) {
    note = document.createElement('div');
    note.classList.add(ESTIMATE_CLASS, 'font-body', 'text-sm', 'text-accent-1');
    note.style.cssText = 'position: absolute; bottom: 100%; left: -2.5rem; right: -2.5rem; margin-bottom: 0.3rem; padding: 0.15rem 0.5rem; text-align: center; ' +
      'border-radius: 0.3rem; background-color: rgba(10, 10, 12, 0.85); border: 0.0555555556rem solid rgba(140, 126, 98, 0.9);';
    note.setAttribute('data-l10n-id', 'LOC_MPT_OBSERVER_COMBAT_ESTIMATE');
    outcome.appendChild(note);
  }
  note.style.display = visible ? 'block' : 'none';
}

/** One-time UI.log dump of what the engine exposes about a unit's combat modifiers. */
let modifiersLogged = false;
function logCombatModifiers(unitId) {
  if (modifiersLogged) return;
  modifiersLogged = true;
  try { log(`combatModifiers sample: ${JSON.stringify(Units.get(unitId)?.Combat?.combatModifiers)?.slice(0, 1500)}`); }
  catch (e) { log(`combatModifiers unreadable: ${e}`); }
}

function patchCombatPreview() {
  const proto = Controls.getDefinition(PREVIEW_TAG)?.createInstance?.prototype;
  if (!proto) { log('combat preview not found'); return; }

  const baseTarget = proto.getTargetAtCursor;
  proto.getTargetAtCursor = function (...args) {
    const target = baseTarget.apply(this, args);
    const attacker = isForeign(this.selectedUnitID) ? Units.get(this.selectedUnitID) : null;
    if (!attacker || ComponentID.isValid(target) || this.isTargetDistrict) return target;
    return hoveredOpponent(attacker);
  };

  const baseRealize = proto.realizeCombatPreview;
  proto.realizeCombatPreview = function (...args) {
    const attacker = isForeign(this.selectedUnitID) ? Units.get(this.selectedUnitID) : null;
    if (!attacker || !this.location) return baseRealize.apply(this, args);
    const combatType = isRangedAttacker(attacker) ? CombatTypes.COMBAT_RANGED : CombatTypes.COMBAT_MELEE;
    this.queryCombatID = Game.Combat.simulateAttackAsync(this.selectedUnitID, { Location: this.location, X: this.location.x, Y: this.location.y, CombatType: combatType });
  };

  const baseResult = proto.onSimulateCombatResult;
  proto.onSimulateCombatResult = function (results, ...rest) {
    const ours = isForeign(this.selectedUnitID) && ComponentID.isMatch(results?.QueryToken, this.queryCombatID);
    const shown = ours && results?.Attacker == void 0
      ? estimateCombat(this.selectedUnitID, this.targetID, this.location, this.queryCombatID) ?? results
      : results;
    const result = baseResult.call(this, shown, ...rest);
    if (ours) {
      this.Root.style.transform = PREVIEW_LIFT;
      setEstimateNote(this.Root, shown !== results);
      if (shown !== results) logCombatModifiers(this.selectedUnitID);
      setOwnerIcon(this.attackerLeaderIcon, this.selectedUnitID);
      setOwnerIcon(this.targetLeaderIcon, this.targetID);
    }
    return result;
  };
}

/** The Eye's flag is hidden: it is the Observer's vision, not a piece. */
function hideOwnFlags() {
  const proto = GenericUnitFlag.prototype;
  const baseAttach = proto.onAttach;
  proto.onAttach = function (...args) {
    const result = baseAttach.apply(this, args);
    try { if (isObserverSeat() && this.componentID?.owner === GameContext.localPlayerID) this.hide(); }
    catch (e) { /* keep the flag */ }
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

hideOwnFlags();
patchPlotSelection();
patchSelectedMode();
patchDecorations();
patchOrders();
patchCombatPreview();
engine.whenReady.then(() => {
  window.addEventListener('engine-input', onEngineInput, true);
  engine.on('LocalPlayerTurnBegin', logVisibility);
  setTimeout(logVisibility, 5000);
  log('observer unit selection installed');
});
