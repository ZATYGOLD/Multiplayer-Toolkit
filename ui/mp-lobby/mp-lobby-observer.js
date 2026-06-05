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
 * Multiplayer Toolkit - EXPERIMENTAL observer mode (shell scope).
 *
 * The engine ships a never-surfaced observer subsystem (SlotStatus.SS_OBSERVER,
 * observer IDs/counts, observer-aware lobby ready checks). Each player chooses
 * their role through the TEAM dropdown of their own lobby row: an extra
 * "Observer" entry converts you into a spectator, and picking any team (or the
 * blank no-team entry) converts you back into a participant.
 *
 * Design notes:
 *   - Self-service only: a seated player cannot swap into a pre-made observer
 *     seat (the engine moves slot positions without changing what you are),
 *     so the role is a per-player choice on your own row. The player-slot
 *     action dropdown is left completely untouched.
 *   - Observer rows have their civ/leader/memento dropdowns blanked and
 *     disabled - an observer has nothing to configure but their role. Remote
 *     observer rows have their team dropdown blanked too: only you control
 *     your role.
 *   - Diagnostics by design: nothing registers unless the runtime SlotStatus
 *     enum exposes SS_OBSERVER.
 */
import MPLobbyModel, { MPLobbyDataModel, LobbyUpdateEvent } from 'fs://game/core/ui/shell/mp-staging/model-mp-staging-new.js';
import { MPStagingTeamDropdown } from 'fs://game/core/ui/shell/mp-staging/mp-staging-team-dropdown.js';
import { CONFIG } from './mp-lobby-config.js';

const TEAM_DROPDOWN = 'DROPDOWN_TYPE_TEAM';
const OBSERVER_ICON = 'fs://game/icons/mpt_observer.png';

function log(message) {
  if (CONFIG.debug) console.log(`[MPT lobby] ${message}`);
}

/** SS_OBSERVER from the runtime enum, or undefined when not exposed. */
function observerSlotStatus() {
  try { return SlotStatus.SS_OBSERVER; } catch (e) { return undefined; }
}

function slotStatusOf(playerID) {
  try { return Configuration.getPlayer(playerID).slotStatus; } catch (e) { return undefined; }
}

/** True when this is the local player's own slot in a new, un-readied game. */
function isEditableOwnSlot(playerID) {
  try {
    return MPLobbyDataModel.isLocalPlayer(playerID)
      && MPLobbyDataModel.isNewGame
      && !Network.isPlayerStartReady(GameContext.localPlayerID);
  } catch (e) { return false; }
}

function registerObserverMode() {
  const observerStatus = observerSlotStatus();
  if (observerStatus === undefined) {
    try { log(`SS_OBSERVER not exposed - SlotStatus keys: ${Object.keys(SlotStatus).join(', ')}`); }
    catch (e) { log('SlotStatus enum unavailable in shell scope'); }
    return;
  }

  const isObserverRow = (playerID) => slotStatusOf(playerID) === observerStatus;

  const blankDropdown = (dropdown) => {
    try {
      dropdown.itemList = [{ label: '', disabled: true }];
      dropdown.selectedItemIndex = 0;
      dropdown.selectedItemTooltip = undefined;
      dropdown.showLabelOnSelectedItem = false;
      dropdown.isDisabled = true;
    } catch (e) { /* keep base */ }
    return dropdown;
  };

  // Observers have no civ, leader or mementos to configure (any row).
  const baseParamDropdown = MPLobbyDataModel.prototype.createPlayerParamDropdown;
  MPLobbyDataModel.prototype.createPlayerParamDropdown = function (playerID, ...rest) {
    const dropdown = baseParamDropdown.call(this, playerID, ...rest);
    return dropdown && isObserverRow(playerID) ? blankDropdown(dropdown) : dropdown;
  };

  // The team dropdown is the role control on your own row: an appended
  // "Observer" entry, selected while observing. Remote observer rows are
  // blanked instead.
  const baseTeamDropdown = MPLobbyDataModel.prototype.createTeamParamDropdown;
  MPLobbyDataModel.prototype.createTeamParamDropdown = function (playerID, ...rest) {
    const dropdown = baseTeamDropdown.call(this, playerID, ...rest);
    if (!dropdown) return dropdown;
    try {
      if (isEditableOwnSlot(playerID)) {
        const items = dropdown.itemList ?? [];
        items.push({
          label: Locale.compose('LOC_MPT_TEAM_OBSERVER'),
          teamID: -1,
          mptObserver: true,
          tooltip: 'LOC_MPT_TEAM_OBSERVER_DESC',
          disabled: false
        });
        dropdown.itemList = items;
        if (isObserverRow(playerID)) {
          dropdown.selectedItemIndex = items.length - 1;
          // The icon alone marks the observer; no word over the badge.
          dropdown.showLabelOnSelectedItem = false;
        }
        dropdown.isDisabled = false;
      } else if (isObserverRow(playerID)) {
        // Read-only badge: a readied local observer or a remote observer
        // keeps the observer mark, just without the role controls.
        dropdown.itemList = [{
          label: Locale.compose('LOC_MPT_TEAM_OBSERVER'),
          teamID: -1,
          mptObserver: true,
          disabled: true
        }];
        dropdown.selectedItemIndex = 0;
        dropdown.showLabelOnSelectedItem = false;
        dropdown.isDisabled = true;
      }
    } catch (e) { /* keep base */ }
    return dropdown;
  };

  // Selection routing: "Observer" converts; any team pick while observing
  // restores the participant first, then the base handler sets the team.
  const baseTeamCallback = MPLobbyModel.dropdownCallbacks.get(TEAM_DROPDOWN);
  MPLobbyModel.dropdownCallbacks.set(TEAM_DROPDOWN, (event) => {
    try {
      const selected = event?.detail?.selectedItem;
      const playerID = parseInt(event?.target?.getAttribute?.('data-player-id') ?? '');
      if (Number.isInteger(playerID)) {
        if (selected?.mptObserver) {
          const playerConfig = Configuration.editPlayer(playerID);
          playerConfig?.setSlotStatus(observerStatus);
          playerConfig?.setTeam?.(-1);
          log(`slot ${playerID} -> observing`);
          MPLobbyModel.update();
          return;
        }
        if (isObserverRow(playerID)) {
          const playerConfig = Configuration.editPlayer(playerID);
          playerConfig?.setSlotStatus(SlotStatus.SS_TAKEN);
          playerConfig?.setAsMajorCiv?.();
          log(`slot ${playerID} -> playing`);
          baseTeamCallback?.(event);
          MPLobbyModel.update();
          return;
        }
      }
    } catch (e) { /* fall through to base */ }
    baseTeamCallback?.(event);
  });

  // Observers are not participants, and the lobby renders non-participants
  // with the bare "closed slot" row template - no dropdown elements at all,
  // which would strand an observer with no way back. After every model update,
  // re-shape observer rows: flip the row's VIEW-MODEL isParticipant flag
  // (display only - the engine config is untouched) so the full row template
  // renders, and supply the dropdowns the participant branch skipped. They
  // pass through the wrappers above, so the local row's team dropdown comes
  // back with "Observer" selected while civ/leader (and remote observers'
  // team) come back blanked.
  let mptInjecting = false;
  const baseUpdate = MPLobbyDataModel.prototype.update;
  MPLobbyDataModel.prototype.update = function (...args) {
    const result = baseUpdate.apply(this, args);
    if (mptInjecting) return result;
    try {
      let injected = false;
      for (const playerData of this.playersData ?? []) {
        const playerID = parseInt(playerData.playerID);
        if (!Number.isInteger(playerID) || playerData.isParticipant) continue;
        if (!isObserverRow(playerID)) continue;
        playerData.isParticipant = true;
        playerData.teamDropdown = this.createTeamParamDropdown(
          playerID,
          'team_selector_0',
          'PLAYER_TEAM',
          'PLAYER_TEAM',
          Locale.compose('LOC_UI_MP_LOBBY_DROPDOWN_TEAM_DESC'),
          this.PlayerTeamStringHandle,
          false,
          true
        );
        playerData.civilizationDropdown = this.createPlayerParamDropdown(
          playerID,
          'civ_selector_0',
          'PLAYER_CIV',
          'PLAYER_CIV',
          Locale.compose('LOC_UI_MP_LOBBY_DROPDOWN_CIV_DESC'),
          this.PlayerCivilizationStringHandle,
          true,
          false,
          this.civIconURLGetter
        );
        const leaderDropdown = this.createPlayerParamDropdown(
          playerID,
          'leader_selector_0',
          'PLAYER_LEADER',
          'PLAYER_LEADER',
          Locale.compose('LOC_UI_MP_LOBBY_DROPDOWN_LEADER_DESC'),
          this.PlayerLeaderStringHandle,
          true,
          true,
          this.leaderIconURLGetter
        );
        if (leaderDropdown) {
          // Observer "leader": our icon with the word Observer, locked.
          leaderDropdown.itemList = [{
            label: Locale.compose('LOC_MPT_TEAM_OBSERVER'),
            iconURL: OBSERVER_ICON,
            disabled: true
          }];
          leaderDropdown.selectedItemIndex = 0;
          leaderDropdown.showLabelOnSelectedItem = true;
          leaderDropdown.isDisabled = true;
        }
        playerData.leaderDropdown = leaderDropdown;
        injected = true;
      }
      if (injected) {
        mptInjecting = true;
        try {
          this.onUpdate?.(this);
          window.dispatchEvent(new LobbyUpdateEvent());
        } finally {
          mptInjecting = false;
        }
        log('observer row re-shaped to the full row template');
      }
    } catch (e) { /* leave base data untouched */ }
    return result;
  };

  // Collapsed team icon: the base team-dropdown paints a tinted circle from
  // multiplayerTeamColors[selectedIndex] - our Observer entry indexes past
  // that array (broken red tint). When the observer entry is the selection,
  // paint the observer icon instead and hide the redundant text label.
  const baseTeamAttrChanged = MPStagingTeamDropdown.prototype.onAttributeChanged;
  MPStagingTeamDropdown.prototype.onAttributeChanged = function (name, oldValue, newValue) {
    baseTeamAttrChanged.call(this, name, oldValue, newValue);
    try {
      if (name !== 'selected-item-index') return;
      const observing = !!this.dropdownItems?.[parseInt(newValue)]?.mptObserver;
      if (observing) {
        this.Root.setAttribute('icon-container-innerhtml',
          `<div class='absolute w-16 h-16' style='background-image: url("${OBSERVER_ICON}"); background-size: contain; background-repeat: no-repeat; background-position: center;'></div>`);
      }
      this.Root.setAttribute('show-label-on-selected-item', observing ? 'false' : 'true');
    } catch (e) { /* keep base visuals */ }
  };

  log('observer mode registered on the team dropdown (SS_OBSERVER exposed)');
}

if (CONFIG.observerSlots) registerObserverMode();
