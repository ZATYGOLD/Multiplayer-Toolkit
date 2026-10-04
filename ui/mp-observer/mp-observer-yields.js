/*
 * Zatygold's Observer Mode - a playable Observer for multiplayer Civilization VII.
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
 * Zatygold's Observer Mode - Observer top yield bar (in-game scope).
 *
 * For the Observer seat the HUD's yield bar (panel-yield-banner) also shows
 * food and production, and while a leader panel is open it shows that
 * leader's yields, treasuries and settlement limit instead of the Observer's.
 * The bar's own handlers keep writing the Observer's values (they are bound
 * before this module loads), so every change is followed by a deferred
 * repaint for the shown leader.
 */
import DiplomacyManager from 'fs://game/base-standard/ui/diplomacy/diplomacy-manager.js';
import { PanelYieldBanner } from 'fs://game/base-standard/ui/diplo-ribbon/panel-yield-banner.js';
import { createLogger, wrapMethod } from '../zom-shared/zom-util.js';
import { CONFIG } from './mp-observer-config.js';
import { inLeaderPanel, isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-yields');
const BANNER_TAG = 'panel-yield-banner';
const EXTRA_YIELDS = [
  { type: 'YIELD_FOOD', tooltip: 'LOC_YIELD_FOOD', textClass: 'text-yield-food' },
  { type: 'YIELD_PRODUCTION', tooltip: 'LOC_YIELD_PRODUCTION', textClass: 'text-yield-production' }
];
/** Engine events after which the bar's own handlers repaint it. */
const REPAINT_EVENTS = [
  'PlayerYieldChanged', 'TreasuryChanged', 'DiplomacyTreasuryChanged', 'PlayerSettlementCapChanged',
  'PlayerCityLimitChanged', 'CityAddedToMap', 'UnitRemovedFromMap', 'ConstructibleAddedToMap',
  'TraditionChanged', 'TraditionSlotsAdded', 'AttributeNodeCompleted', 'CityReligionChanged',
  'GreatWorkCreated', 'GreatWorkMoved', 'GreatWorkArchived', 'TradeRouteAddedToMap',
  'TradeRouteRemovedFromMap', 'NarrativeChoiceMade', 'AdvancedStartEffectUsed'
];

/** The leader whose yields the bar shows: the leader panel's leader, else the Observer. */
function shownPlayer() {
  const selected = inLeaderPanel() ? DiplomacyManager.selectedPlayerID : PlayerIds.NO_PLAYER;
  return Players.get(Players.isValid(selected) ? selected : GameContext.localObserverID);
}

function setEntry(element, value, extra = {}) {
  if (!element) return;
  element.dataset.value = String(value);
  if (extra.stored !== undefined) element.dataset.stored = String(extra.stored);
  if (extra.max !== undefined) element.dataset.max = String(extra.max);
}

/** Food and production entries, placed before the settlement limit (once per bar). */
function ensureExtraEntries(banner) {
  if (banner.zomExtraEntries) return;
  const anchor = banner.settlementCapElement;
  if (!anchor?.parentElement) return;
  banner.zomExtraEntries = EXTRA_YIELDS.map(({ type, tooltip, textClass }) => {
    const entry = document.createElement('yield-bar-entry');
    entry.dataset.icon = type;
    entry.dataset.tooltipContent = tooltip;
    entry.classList.add(textClass);
    anchor.parentElement.insertBefore(entry, anchor);
    return { type, entry };
  });
}

/** Every entry from one player's stats. */
function fillBanner(banner, player) {
  const stats = player?.Stats;
  if (!stats) return;
  const entries = banner.yieldElementMap;
  setEntry(entries[YieldTypes.YIELD_GOLD], stats.getNetYield(YieldTypes.YIELD_GOLD), { stored: player.Treasury?.goldBalance ?? 0 });
  setEntry(entries[YieldTypes.YIELD_DIPLOMACY], stats.getNetYield(YieldTypes.YIELD_DIPLOMACY), { stored: player.DiplomacyTreasury?.diplomacyBalance ?? 0 });
  for (const type of [YieldTypes.YIELD_SCIENCE, YieldTypes.YIELD_CULTURE, YieldTypes.YIELD_HAPPINESS]) setEntry(entries[type], stats.getNetYield(type));
  for (const { type, entry } of banner.zomExtraEntries ?? []) setEntry(entry, stats.getNetYield(YieldTypes[type]));
  setEntry(banner.settlementCapElement, stats.numSettlements, { max: stats.settlementCap });
  setEntry(banner.cityCapElement, stats.numCities, { max: player.Cities?.getCityLimit?.() ?? 0 });
}

function refreshBanner(banner) {
  try {
    ensureExtraEntries(banner);
    fillBanner(banner, shownPlayer());
  } catch (e) { log(`yield bar refresh failed: ${e}`); }
}

let refreshQueued = false;

/** Repaint every yield bar after the current handlers (and the bar's own) have run. */
function queueRefresh() {
  if (refreshQueued || !isObserverSeat()) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    for (const el of document.querySelectorAll(BANNER_TAG)) {
      const banner = el.maybeComponent ?? el.component;
      if (banner) refreshBanner(banner);
    }
  }, 0);
}

if (CONFIG.enabled) {
  wrapMethod(PanelYieldBanner.prototype, 'render', function (base, ...args) {
    const result = base(...args);
    queueRefresh();
    return result;
  });
  engine.whenReady.then(() => {
    if (!isObserverSeat()) return;
    for (const event of REPAINT_EVENTS) engine.on(event, queueRefresh);
    for (const event of ['interface-mode-changed', 'diplomacy-selected-player-changed']) window.addEventListener(event, queueRefresh);
    queueRefresh();
  });
}
