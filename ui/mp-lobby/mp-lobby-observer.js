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
 * Multiplayer Toolkit - Observer in the multiplayer lobby (shell scope).
 *
 * The Observer is a real leader + civilization (config/observer-config.xml).
 * This module makes the lobby treat them as one role:
 *   - The civilization list shows a single "Observer" entry - the one for the
 *     game's start Age (the lobby lists every Age's civs together).
 *   - Picking the Observer leader or civilization sets the other one and
 *     clears the team; picking another leader releases the civilization.
 *   - While observing, the civilization and team dropdowns are locked and the
 *     team column shows the eye badge. The leader dropdown stays open so the
 *     player can switch back.
 * Wraps the lobby model's dropdown builders and callbacks; no base file edits.
 */
import MPLobbyModel, { MPLobbyDataModel } from 'fs://game/core/ui/shell/mp-staging/model-mp-staging-new.js';
import { MPStagingTeamDropdown } from 'fs://game/core/ui/shell/mp-staging/mp-staging-team-dropdown.js';
import { CONFIG } from './mp-lobby-config.js';

const OBSERVER_LEADER = 'LEADER_MPT_OBSERVER';
const OBSERVER_CIV_PREFIX = 'CIVILIZATION_MPT_OBSERVER_';
const OBSERVER_ICON = 'fs://game/icons/mpt_observer.png';
const OBSERVER_CIV_ICON = 'fs://game/icons/mpt_observer_civ.png';
const PARAM_LEADER = 'PlayerLeader';
const PARAM_CIV = 'PlayerCivilization';
const DROPDOWN_PARAM = 'DROPDOWN_TYPE_PLAYER_PARAM';
const DROPDOWN_TEAM = 'DROPDOWN_TYPE_TEAM';
const NO_TEAM = -1;

function log(message) {
  if (CONFIG.debug) { try { console.warn(`[MPT lobby-observer] ${message}`); } catch (e) { /* ignore */ } }
}

// ============================ Game state ============================

function isObserverCiv(civ) { return typeof civ === 'string' && civ.startsWith(OBSERVER_CIV_PREFIX); }

/**
 * The Observer civilization for the game's start Age. The game config only
 * exposes the Age's display key (LOC_AGE_ANTIQUITY_NAME), so it is resolved to
 * the AgeType through the setup database, with a name-strip fallback.
 */
let cachedStartAge = '';
function startAgeType() {
  let name = '';
  try { name = Configuration.getGame().startAgeName || ''; } catch (e) { /* unknown */ }
  if (!name) return cachedStartAge || 'AGE_ANTIQUITY';
  try {
    const row = (Database.query('config', 'select AgeType, Name from Ages') ?? []).find((r) => r.Name === name);
    if (row?.AgeType) { cachedStartAge = row.AgeType; return cachedStartAge; }
  } catch (e) { /* fall back */ }
  cachedStartAge = name.replace(/^LOC_/, '').replace(/_NAME$/, '');
  return cachedStartAge;
}
function observerCivForStartAge() {
  return OBSERVER_CIV_PREFIX + startAgeType().replace(/^AGE_/, '');
}

/** Keep RANDOM first, everything else in base order, and the Observer entry last. */
function moveObserverLast(items, isObserver) {
  const rest = items.filter((it) => !isObserver(it));
  const obs = items.filter(isObserver);
  return rest.concat(obs);
}

function playerLeader(playerID) {
  try { return Configuration.getPlayer(playerID)?.leaderTypeName ?? ''; } catch (e) { return ''; }
}
function playerCiv(playerID) {
  try { return Configuration.getPlayer(playerID)?.civilizationTypeName ?? ''; } catch (e) { return ''; }
}
function isObserverRow(playerID) {
  return playerLeader(playerID) === OBSERVER_LEADER || isObserverCiv(playerCiv(playerID));
}

function setParam(playerID, param, value) {
  try { GameSetup.setPlayerParameterValue(playerID, param, value); return true; }
  catch (e) { log(`set ${param}=${value} failed for ${playerID}: ${e}`); return false; }
}
function setTeam(playerID, team) {
  try { Configuration.editPlayer(playerID)?.setTeam(team); } catch (e) { /* ignore */ }
}

// ============================ Dropdown shaping ============================

function lockDropdown(dropdown, index) {
  dropdown.selectedItemIndex = index;
  dropdown.isDisabled = true;
}

/** Civ list: one Observer entry (start Age only), eye icon; locked while observing. */
function shapeCivDropdown(dropdown, playerID) {
  const wanted = observerCivForStartAge();
  let items = (dropdown.itemList ?? []).filter((it) => !isObserverCiv(it.paramID) || it.paramID === wanted);
  if (!items.some((it) => it.paramID === wanted)) {   // unknown Age: keep one Observer entry rather than none
    const first = (dropdown.itemList ?? []).find((it) => isObserverCiv(it.paramID));
    if (first) items.push(first);
  }
  items = moveObserverLast(items, (it) => isObserverCiv(it.paramID));
  for (const it of items) if (isObserverCiv(it.paramID)) it.iconURL = OBSERVER_CIV_ICON;
  const current = playerCiv(playerID);
  dropdown.itemList = items;
  dropdown.selectedItemIndex = items.findIndex((it) => it.paramID === current);
  if (isObserverRow(playerID)) lockDropdown(dropdown, items.findIndex((it) => isObserverCiv(it.paramID)));
}

/** Leader list: Observer last with the eye icon; stays enabled to switch back. */
function shapeLeaderDropdown(dropdown, playerID) {
  const items = moveObserverLast(dropdown.itemList ?? [], (it) => it.paramID === OBSERVER_LEADER);
  for (const it of items) if (it.paramID === OBSERVER_LEADER) it.iconURL = OBSERVER_ICON;
  dropdown.itemList = items;
  const current = playerLeader(playerID);
  dropdown.selectedItemIndex = items.findIndex((it) => it.paramID === current);
}

/**
 * Team column: an "Observer" entry is appended to the team list (picking it
 * makes the row an observer). While observing it is the selection, the eye
 * badge is shown and the numbered teams are disabled.
 */
function shapeTeamDropdown(dropdown, playerID) {
  const observing = isObserverRow(playerID);
  const items = (dropdown.itemList ?? []).filter((it) => !it.mptObserver);
  if (observing) for (const it of items) it.disabled = true;
  items.push({
    label: Locale.compose('LOC_MPT_TEAM_OBSERVER'),
    teamID: NO_TEAM,
    mptObserver: true,
    tooltip: 'LOC_MPT_TEAM_OBSERVER_DESC',
    disabled: false
  });
  dropdown.itemList = items;
  if (observing) {
    dropdown.selectedItemIndex = items.length - 1;
    dropdown.showLabelOnSelectedItem = false;
  }
}

// ============================ Selection sync ============================

/** Leader and civ move together: Observer leader <-> Observer civ, team cleared. */
function syncSelection(playerID, param, value) {
  const civ = observerCivForStartAge();
  if (param === PARAM_LEADER) {
    if (value === OBSERVER_LEADER) {
      if (playerCiv(playerID) !== civ) setParam(playerID, PARAM_CIV, civ);
      setTeam(playerID, NO_TEAM);
      log(`player ${playerID} -> observer (${civ})`);
    } else if (isObserverCiv(playerCiv(playerID))) {
      setParam(playerID, PARAM_CIV, 'RANDOM');
      log(`player ${playerID} left observer; civ reset`);
    }
  } else if (param === PARAM_CIV) {
    if (isObserverCiv(value)) {
      if (value !== civ) setParam(playerID, PARAM_CIV, civ);
      if (playerLeader(playerID) !== OBSERVER_LEADER) setParam(playerID, PARAM_LEADER, OBSERVER_LEADER);
      setTeam(playerID, NO_TEAM);
      log(`player ${playerID} -> observer via civ`);
    } else if (playerLeader(playerID) === OBSERVER_LEADER) {
      setParam(playerID, PARAM_LEADER, 'RANDOM');
      log(`player ${playerID} left observer via civ; leader reset`);
    }
  }
}

// ============================ Installation ============================

function install() {
  const proto = MPLobbyDataModel.prototype;

  const baseParamDropdown = proto.createPlayerParamDropdown;
  proto.createPlayerParamDropdown = function (playerID, dropID, type, dropLabel, dropDesc, paramNameHandle, ...rest) {
    const dropdown = baseParamDropdown.call(this, playerID, dropID, type, dropLabel, dropDesc, paramNameHandle, ...rest);
    if (!dropdown) return dropdown;
    try {
      if (paramNameHandle === this.PlayerCivilizationStringHandle) shapeCivDropdown(dropdown, playerID);
      else if (paramNameHandle === this.PlayerLeaderStringHandle) shapeLeaderDropdown(dropdown, playerID);
    } catch (e) { log(`dropdown shaping failed: ${e}`); }
    return dropdown;
  };

  const baseTeamDropdown = proto.createTeamParamDropdown;
  proto.createTeamParamDropdown = function (playerID, ...rest) {
    const dropdown = baseTeamDropdown.call(this, playerID, ...rest);
    if (dropdown) { try { shapeTeamDropdown(dropdown, playerID); } catch (e) { log(`team shaping failed: ${e}`); } }
    return dropdown;
  };

  // Sync after the base handler has applied the player's pick.
  const baseParamCallback = MPLobbyModel.dropdownCallbacks.get(DROPDOWN_PARAM);
  MPLobbyModel.dropdownCallbacks.set(DROPDOWN_PARAM, (event) => {
    baseParamCallback?.(event);
    try {
      const target = event?.target;
      const playerID = parseInt(target?.getAttribute?.('data-player-id') ?? '');
      const param = target?.getAttribute?.('data-player-param');
      const value = event?.detail?.selectedItem?.paramID;
      if (Number.isInteger(playerID) && param && value) syncSelection(playerID, param, value);
    } catch (e) { log(`sync failed: ${e}`); }
  });

  // Team "Observer" makes the row an observer (leader + civ follow); an
  // observer row never joins a numbered team.
  const baseTeamCallback = MPLobbyModel.dropdownCallbacks.get(DROPDOWN_TEAM);
  MPLobbyModel.dropdownCallbacks.set(DROPDOWN_TEAM, (event) => {
    try {
      const playerID = parseInt(event?.target?.getAttribute?.('data-player-id') ?? '');
      if (Number.isInteger(playerID)) {
        if (event?.detail?.selectedItem?.mptObserver) {
          if (playerLeader(playerID) !== OBSERVER_LEADER) setParam(playerID, PARAM_LEADER, OBSERVER_LEADER);
          syncSelection(playerID, PARAM_LEADER, OBSERVER_LEADER);
          return;
        }
        if (isObserverRow(playerID)) { setTeam(playerID, NO_TEAM); return; }
      }
    } catch (e) { /* fall through */ }
    baseTeamCallback?.(event);
  });

  // Collapsed team badge: paint the eye instead of a team color for the Observer
  // entry. Re-checked when the items change too, since the index may not move.
  const baseTeamAttrChanged = MPStagingTeamDropdown.prototype.onAttributeChanged;
  MPStagingTeamDropdown.prototype.onAttributeChanged = function (name, oldValue, newValue) {
    baseTeamAttrChanged.call(this, name, oldValue, newValue);
    try {
      if (name !== 'selected-item-index' && name !== 'dropdown-items') return;
      const index = parseInt(this.Root.getAttribute('selected-item-index') ?? '-1');
      const observing = !!this.dropdownItems?.[index]?.mptObserver;
      if (observing) {
        this.Root.setAttribute('icon-container-innerhtml',
          `<div class='absolute w-16 h-16' style='background-image: url("${OBSERVER_ICON}"); background-size: contain; background-repeat: no-repeat; background-position: center;'></div>`);
      }
      this.Root.setAttribute('show-label-on-selected-item', observing ? 'false' : 'true');
    } catch (e) { /* keep base visuals */ }
  };

  log(`observer role installed (start-age civ: ${observerCivForStartAge()})`);
}

if (CONFIG.observerRole !== false) {
  try { install(); } catch (e) { log(`install failed: ${e}`); }
}
