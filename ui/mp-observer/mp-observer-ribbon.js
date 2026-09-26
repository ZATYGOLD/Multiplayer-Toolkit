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
 * Multiplayer Toolkit - Observer diplomacy ribbon (in-game scope).
 *
 * The base ribbon lists only leaders the local player has met, and an empire
 * with no units meets no one. For the Observer seat the ribbon model is
 * rebuilt from every living major (the Observer's own card last, at the right
 * edge), stats are pinned open, and the Observer's card switches what every
 * card shows (see mp-observer-ribbon-toolbar.js). Portraits show each leader's
 * mood (angry at war, else happy while celebrating); look and highlights are
 * in mp-observer-ribbon-style.js.
 *
 * The leader panel (and other diplomacy screens) keep the base compact cards
 * and are never rebuilt by this module: there the base panel re-centres on
 * the selected leader on every rebuild, which reads as the ribbon jumping.
 */
import { DiploRibbonData } from 'fs://game/base-standard/ui/diplo-ribbon/model-diplo-ribbon.js';
import { PanelDiploRibbon } from 'fs://game/base-standard/ui/diplo-ribbon/panel-diplo-ribbon.js';
import { createLogger, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG, OBSERVER_VIEW } from './mp-observer-config.js';
import { inDiplomacyMode, inLeaderPanel, isObserverSeat } from './mp-observer-core.js';
import { productionItems, researchItems, scoreItems } from './mp-observer-ribbon-data.js';
import { lockCardSize, markCards, setRibbonHidden } from './mp-observer-ribbon-style.js';
import { placeViewButtons } from './mp-observer-ribbon-toolbar.js';

const log = createLogger('observer-ribbon');
const RIGHT_EDGE_CLASS = 'right-4';   // the base panel uses right-24; the Observer's ribbon sits at the edge
const VIEW_ITEMS = {
  [OBSERVER_VIEW.RESEARCH]: researchItems,
  [OBSERVER_VIEW.PRODUCTION]: productionItems,
  [OBSERVER_VIEW.SCORE]: scoreItems
};

let viewMode = CONFIG.defaultView;
let lastMeterRefresh = 0;

// ============================ Moods ============================

function isAtWar(player) {
  try { return !!player.Diplomacy?.isAtWarWithAnyMajorCiv?.(); } catch (e) { return false; }
}

function isCelebrating(player) {
  try { return !!player.Happiness?.isInGoldenAge?.(); } catch (e) { return false; }
}

function moodContext(player) {
  if (isAtWar(player)) return 'LEADER_ANGRY';
  return isCelebrating(player) ? 'LEADER_HAPPY' : '';
}

// ============================ Panel ============================

function hudPanel() {
  return document.querySelector('panel-diplo-ribbon');
}

/** Everything the Observer's ribbon needs after the base panel builds it. */
function decorateRibbon(panel) {
  if (!panel) return;
  const hidden = inLeaderPanel();
  setRibbonHidden(panel, hidden);
  if (hidden) return;
  if (inDiplomacyMode()) panel.classList.remove(RIGHT_EDGE_CLASS);
  else {
    panel.classList.remove('right-24');
    panel.classList.add(RIGHT_EDGE_CLASS);
    lockCardSize(panel, viewMode === OBSERVER_VIEW.YIELDS);
    placeViewButtons(panel, viewMode, setView);
  }
  markCards(panel, isCelebrating);
}

/** Full rebuild of the HUD ribbon, keeping its scroll position (never in diplomacy screens). */
function rebuildRibbon() {
  if (inDiplomacyMode()) return;
  try {
    const panel = hudPanel();
    const component = panel?.maybeComponent ?? panel?.component;
    if (!component) return;
    const first = component.firstLeaderIndex;
    component.populateFlags?.();
    if (first != null && component.firstLeaderIndex !== first) {
      component.firstLeaderIndex = first;
      component.refreshRibbonVis?.();
    }
    decorateRibbon(panel);
  } catch (e) { log(`ribbon rebuild failed: ${e}`); }
}

/** Refresh the model and repaint the cards. */
function refreshRibbon() {
  if (!isObserverSeat()) return;
  try { DiploRibbonData.updateAll(); rebuildRibbon(); } catch (e) { log(`ribbon refresh failed: ${e}`); }
}

function setView(view) {
  if (view === viewMode) return;
  viewMode = view;
  refreshRibbon();
}

/**
 * Research / Production meters live in each row's `img`, which the base
 * incremental refresh never repaints; rebuild at most once per meterRefreshMs.
 */
function refreshMeters() {
  if (viewMode !== OBSERVER_VIEW.RESEARCH && viewMode !== OBSERVER_VIEW.PRODUCTION) return;
  const now = Date.now();
  if (now - lastMeterRefresh < CONFIG.meterRefreshMs) return;
  lastMeterRefresh = now;
  rebuildRibbon();
}

// ============================ Model ============================

function patchModel() {
  // Every refresh path builds a card's rows here; the selected view swaps them.
  wrapMethod(DiploRibbonData, 'createPlayerYieldsData', (base, player, ...rest) => {
    if (!isObserverSeat() || !player) return base(player, ...rest);
    if (player.id === GameContext.localPlayerID) return [];   // the Observer's card holds the view buttons
    try { return VIEW_ITEMS[viewMode]?.(player) ?? base(player, ...rest); }
    catch (e) { return base(player, ...rest); }
  });
  wrapMethod(DiploRibbonData, 'createPlayerSizeData', (base, player, ...rest) =>
    (isObserverSeat() && player?.id === GameContext.localPlayerID ? [] : base(player, ...rest)));

  // Stats pinned open on the map (the user's own toggle is untouched); diplomacy screens stay compact.
  const baseStuck = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(DiploRibbonData), 'areRibbonYieldsStuckOnScreen')?.get;
  Object.defineProperty(DiploRibbonData, 'areRibbonYieldsStuckOnScreen', {
    configurable: true,
    get() {
      if (isObserverSeat() && !inDiplomacyMode()) return true;
      return baseStuck ? baseStuck.call(this) : (this._alwaysShowYields === 1 || this._userDiploRibbonsToggled === 1);
    }
  });

  // Every living major, the Observer's own card last.
  wrapMethod(DiploRibbonData, 'updateAll', function (base) {
    if (!isObserverSeat()) return base();
    try {
      this.getRibbonDisplayTypesFromUserOptions?.();
      const cards = [];
      let own = null;
      for (const player of Players.getAlive()) {
        if (!player?.isMajor) continue;
        const data = this.createPlayerData(player, player.Diplomacy, true);
        if (!data) continue;
        data.portraitContext = moodContext(player);
        if (player.id === GameContext.localPlayerID) own = data; else cards.push(data);
      }
      if (own) cards.push(own);
      this._playerData = cards;
      this.onUpdate?.(this);
      this._eventNotificationRefresh?.trigger?.();
      for (const panel of document.querySelectorAll('panel-diplo-ribbon')) markCards(panel, isCelebrating);
      if (!inDiplomacyMode()) refreshMeters();
    } catch (e) {
      log(`observer update failed (${e}); using the base ribbon`);
      base();
    }
  });
}

function patchPanel() {
  const proto = PanelDiploRibbon.prototype;
  // Losing focus minimises the stats and requests a full update; the Observer's
  // stats are pinned and rebuilding moves focus, so that would loop.
  wrapMethod(proto, 'onFocusout', (base, ...args) => (isObserverSeat() ? undefined : base(...args)));
  wrapMethod(proto, 'populateFlags', function (base, ...args) {
    const result = base(...args);
    try { if (isObserverSeat()) decorateRibbon(this.Root); } catch (e) { log(`ribbon decoration failed: ${e}`); }
    return result;
  });
}

/**
 * The model's first updateAll runs before this module loads, so the Observer's
 * ribbon starts empty; seed it once the HUD panel exists.
 */
function seedRibbon(attempts) {
  if (!isObserverSeat()) return;
  refreshRibbon();
  if (!hudPanel() && attempts > 0) setTimeout(() => seedRibbon(attempts - 1), CONFIG.ribbonSeedIntervalMs);
}

if (CONFIG.enabled) {
  patchModel();
  patchPanel();
  for (const event of ['DiplomacyDeclareWar', 'DiplomacyMakePeace']) engine.on(event, refreshRibbon);
  engine.whenReady.then(() => seedRibbon(CONFIG.ribbonSeedAttempts));
}
