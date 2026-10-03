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
 * Multiplayer Toolkit - Observer leader view (in-game scope).
 *
 * Empire screens read "the local player" through MPTLeaderView (base-game
 * overrides marked "MPT:" in ui-next/screens/commerce, ui-next/screens/legacies,
 * ui/policies, ui/great-works and ui/panel-belief-picker): Resources & Trade,
 * Legacies, Government, Great Works and Religion. For the Observer that is the leader picked in a row of leader
 * portraits above the screen's tabs, shared by every such screen; picking
 * another leader reopens the screen for that leader on the same tab. The
 * screens stay read-only: game actions are still sent as the Observer, which
 * the game refuses. Other players see the base screens.
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { isObserverSeat, watchedPlayers } from './mp-observer-core.js';

const SCREEN_PROPS = { singleton: true, createMouseGuard: true };
const SELECTED_STYLE = 'border: 0.1666666667rem solid #e5d2ac; opacity: 1;';
const OTHER_STYLE = 'border: 0.1666666667rem solid transparent; opacity: 0.65;';
// A dark plate so the row reads over any background (Great Works sits over the map).
const BAR_STYLE = 'background-color: rgba(10, 12, 18, 0.88); border: 0.0555555556rem solid rgba(229, 210, 172, 0.55); border-radius: 0.5rem; padding: 0.3rem 0.6rem;';

let viewedId = null;
const openTabs = new Map();      // screen tag -> tab last shown to the Observer
const restoreTabs = new Map();   // screen tag -> tab to show once the screen reopens

/** The leader shown to the Observer (first watched leader by default); undefined for everyone else. */
function playerID() {
  if (!isObserverSeat()) return undefined;
  if (viewedId == null || !Players.get(viewedId)?.isAlive) viewedId = watchedPlayers()[0]?.id ?? null;
  return viewedId ?? undefined;
}

/** onTabChanged handler (it receives the active tab item) that remembers the Observer's open tab, then calls base. */
function trackTab(screenTag, base) {
  return (tab) => {
    const name = typeof tab === 'string' ? tab : tab?.name;
    if (name && isObserverSeat()) {
      openTabs.set(screenTag, name);
      if (restoreTabs.get(screenTag) === name) restoreTabs.delete(screenTag);   // restored: back to normal tab handling
    }
    base?.(tab);
  };
}

/**
 * The tab to reopen on after a leader switch, else undefined. Kept until that
 * tab is reported open: the screen reads it several times while it builds.
 */
function restoredTab(screenTag) {
  return restoreTabs.get(screenTag);
}

function reopen(screenTag, id) {
  if (id === viewedId) return;
  viewedId = id;
  if (openTabs.has(screenTag)) restoreTabs.set(screenTag, openTabs.get(screenTag));
  setTimeout(() => {
    ContextManager.pop(screenTag);
    ContextManager.push(screenTag, SCREEN_PROPS);
  }, 0);
}

function portraitButton(screenTag, player, selected) {
  const btn = document.createElement('fxs-activatable');
  btn.classList.value = 'size-14 mx-1 rounded-full pointer-events-auto';
  btn.style.cssText = selected ? SELECTED_STYLE : OTHER_STYLE;
  btn.setAttribute('data-tooltip-content', Locale.compose(player.name));
  const icon = document.createElement('fxs-icon');
  icon.classList.value = 'size-full';
  icon.setAttribute('data-icon-id', GameInfo.Leaders.lookup(player.leaderType)?.LeaderType ?? 'UNKNOWN_LEADER');
  icon.setAttribute('data-icon-context', 'CIRCLE_MASK');
  btn.appendChild(icon);
  for (const event of ['action-activate', 'click']) btn.addEventListener(event, () => reopen(screenTag, player.id));
  return btn;
}

/** One portrait per watched leader, the viewed one highlighted; null for everyone else. */
function playerBar(screenTag) {
  const viewed = playerID();
  if (viewed === undefined) return null;
  const bar = document.createElement('div');
  bar.classList.value = 'flex flex-row flex-wrap justify-center items-center self-center mb-2 pointer-events-auto';
  bar.style.cssText = BAR_STYLE;
  for (const player of watchedPlayers()) bar.appendChild(portraitButton(screenTag, player, player.id === viewed));
  return bar;
}

globalThis.MPTLeaderView = { playerID, playerBar, restoredTab, trackTab };

export { playerID as viewedPlayerID };
