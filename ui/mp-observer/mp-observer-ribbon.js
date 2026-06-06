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
 * Multiplayer Toolkit - Observer diplo-ribbon population & view toggle (in-game).
 *
 * An observer normally sees an EMPTY diplomacy ribbon (updateAll bails when
 * there is no local player). Two patches fix and extend it:
 *
 *   1. updateAll - for an observer, rebuild the ribbon from every living major
 *      player instead of bailing.
 *   2. createPlayerYieldsData - the single point BOTH the full and incremental
 *      ribbon refreshes use to build a player's stat rows. In RESEARCH mode it
 *      returns the player's current tech + civic instead of yields, so every
 *      refresh path stays consistent (no flicker between views).
 *
 * A small toolbar (Yields / Research) switches the mode. Normal players are
 * untouched - every patch no-ops unless the local context is an observer.
 */
import { DiploRibbonData } from 'fs://game/base-standard/ui/diplo-ribbon/model-diplo-ribbon.js';
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';
import { CONFIG, OBSERVER_VIEW } from './mp-observer-config.js';

const TOOLBAR_ID = 'mpt-observer-toolbar';

let viewMode = CONFIG.defaultView;

function log(message) {
  if (CONFIG.debug) console.log(`[MPT observer] ${message}`);
}

/** True when the local viewing context is a spectator, not a seated player. */
function isObserverContext() {
  try {
    const id = GameContext.localObserverID;
    if (id === PlayerIds.OBSERVER_ID) return true;
    if (id === PlayerIds.NO_PLAYER) return false;
    return !Players.get(id);
  } catch (e) { return false; }
}

// ============================ Research data ============================

/**
 * The node a player is actively researching in a tree (engine IN_PROGRESS
 * node), mirroring the sub-system dock's current-research logic. Returns
 * { name, turns, icon } or null when nothing is being researched. All native
 * calls take an explicit player ID, so they work for any player.
 */
function activeResearch(playerID, treeType, tree, isTech) {
  try {
    if (treeType == null) return null;
    const treeObject = Game.ProgressionTrees.getTree(playerID, treeType);
    if (!treeObject || treeObject.activeNodeIndex < 0) return null;
    const activeNode = treeObject.nodes[treeObject.activeNodeIndex];
    if (!activeNode) return null;
    const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(activeNode.nodeType);
    if (!nodeInfo) return null;
    let name = Locale.compose(nodeInfo.Name ?? nodeInfo.ProgressionTreeNodeType);
    const nodeData = Game.ProgressionTrees.getNode(playerID, activeNode.nodeType);
    if (nodeData && nodeData.depthUnlocked >= 1) {
      const numeral = Locale.toRomanNumeral(nodeData.depthUnlocked + 1);
      if (numeral) name += ' ' + numeral;
    }
    // Fraction complete (0..1), mirroring the sub-system dock's progress math.
    // getNodeCost is only safe with a VALID researching type - passing an
    // undefined type (a player between researches) can crash the engine, so
    // guard it the way the dock does.
    let progress = 0;
    try {
      const researching = tree?.getResearching?.();
      if (researching && researching.type != null && nodeData) {
        const cost = tree.getNodeCost?.(researching.type);
        if (cost > 0) progress = Math.max(0, Math.min(1, nodeData.progress / cost));
      }
    } catch (e) { /* leave 0 */ }
    const icon = isTech
      ? Icon.getTechIconFromProgressionTreeNodeDefinition(nodeInfo)
      : Icon.getCultureIconFromProgressionTreeNodeDefinition(nodeInfo);
    return { name, turns: tree?.getTurnsLeft?.() ?? 0, icon, progress };
  } catch (e) { return null; }
}

/**
 * A stacked progress meter as an HTML string for the ribbon's displayItems
 * `img` slot: an icon (a plain <img>, which the UI renderer supports), a label
 * beneath it, then a width-based progress bar. Shared by the Research and
 * Production views. `pct` is 0..100. Avoids conic-gradient / CSS the
 * Coherent/Gameface renderer rejects.
 */
function meterHTML(iconUrl, label, pct, barColor) {
  const p = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const icon = iconUrl ? `<img src='${iconUrl}' style='width:1.9rem;height:1.9rem;'>` : '';
  const name = label
    ? `<div style='font-size:0.72rem;line-height:0.95rem;color:#e7d9ac;text-align:center;margin-top:0.2rem;max-width:5.5rem;'>${label}</div>`
    : '';
  return (
    `<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0.55rem 0.5rem;'>` +
    icon +
    name +
    `<div style='width:2.4rem;height:0.22rem;border-radius:0.11rem;background-color:rgba(255,255,255,0.22);margin-top:0.25rem;'>` +
    `<div style='height:100%;border-radius:0.11rem;background-color:${barColor};width:${p}%;'></div>` +
    `</div>` +
    `</div>`
  );
}

/** A single research row in the ribbon's displayItems shape (meter only). */
function researchRow(type, labelLoc, research, barColor) {
  const none = Locale.compose('LOC_MPT_OBSERVER_NONE');
  const details = research
    ? (research.turns > 0 ? `${research.name} (${research.turns})` : research.name)
    : none;
  return {
    type,
    label: research ? research.name : Locale.compose(labelLoc),
    value: '',
    img: research ? meterHTML(research.icon, research.name, (research.progress ?? 0) * 100, barColor) : '',
    details,
    rawValue: research?.turns ?? 0,
    warningThreshold: Infinity
  };
}

// ============================ Production data ============================

/** Localized name of a production item from its type hash, or null. */
function productionName(hash) {
  try {
    for (const table of [GameInfo.Units, GameInfo.Constructibles, GameInfo.Buildings, GameInfo.Projects]) {
      const def = table?.lookup?.(hash);
      if (def?.Name) return Locale.compose(def.Name);
    }
  } catch (e) { /* none */ }
  return null;
}

/** Per-city production meters for a player (icon = item, label = city name). */
function productionItems(player) {
  const items = [];
  try {
    const cities = player.Cities?.getCities?.() ?? [];
    for (const city of cities) {
      if (!city || city.isTown) continue;   // towns have no production queue
      const cityName = city.name ? Locale.compose(city.name) : Locale.compose('LOC_MPT_OBSERVER_NONE');
      const bq = city.BuildQueue;
      const hash = bq?.currentProductionTypeHash;
      const producing = bq && hash != null && hash !== -1;
      const icon = producing ? Icon.getProductionIconFromHash(hash) : '';
      const pct = producing ? (bq.getPercentComplete?.(hash) ?? 0) : 0;
      const itemName = producing ? productionName(hash) : null;
      items.push({
        type: 'production',
        label: itemName ? `${cityName} - ${itemName}` : cityName,
        value: '',
        img: meterHTML(icon, cityName, pct, '#7fc77f'),
        details: itemName ?? cityName,
        rawValue: pct,
        warningThreshold: Infinity
      });
    }
  } catch (e) { /* leave whatever we built */ }
  return items;
}

// ============================ Score data ============================

/** Per-victory-path scores + total for a player (the SCORE view's rows). */
function scoreItems(player) {
  const items = [];
  let total = 0;
  try {
    const lp = player.LegacyPaths;
    const enabled = lp?.getEnabledLegacyPaths?.() ?? [];
    for (const elp of enabled) {
      const def = GameInfo.LegacyPaths.lookup(elp.legacyPath);
      if (!def) continue;
      const score = lp?.getScore?.(def.LegacyPathType) ?? 0;
      total += score;
      items.push({
        type: 'victory',
        label: Locale.compose(def.Name),
        value: String(score),
        img: `<img src='${Icon.getLegacyPathIcon(def)}'>`,
        details: Locale.compose(def.Name),
        rawValue: score,
        warningThreshold: Infinity
      });
    }
  } catch (e) { /* leave whatever we built */ }
  items.push({
    type: 'victory',
    label: Locale.compose('LOC_MPT_OBSERVER_TOTAL'),
    value: String(total),
    img: '',
    details: Locale.compose('LOC_MPT_OBSERVER_TOTAL'),
    rawValue: total,
    warningThreshold: Infinity
  });
  return items;
}

/** True while an Age transition is processing (trees are in flux - skip reads). */
function ageTransitionActive() {
  try { return Modding.getTransitionInProgress?.() === TransitionType.Age; }
  catch (e) { return false; }
}

/** Current tech + civic rows for a player (the RESEARCH view's stat rows). */
function researchItems(player) {
  if (ageTransitionActive()) {
    return [
      researchRow('science', 'LOC_MPT_OBSERVER_RESEARCH_TECH', null, '#5fb5f0'),
      researchRow('culture', 'LOC_MPT_OBSERVER_RESEARCH_CIVIC', null, '#c08fe0')
    ];
  }
  let tech = null, civic = null;
  try { tech = activeResearch(player.id, player.Techs?.getTreeType?.(), player.Techs, true); } catch (e) { /* none */ }
  try { civic = activeResearch(player.id, player.Culture?.getActiveTree?.(), player.Culture, false); } catch (e) { /* none */ }
  return [
    researchRow('science', 'LOC_MPT_OBSERVER_RESEARCH_TECH', tech, '#5fb5f0'),
    researchRow('culture', 'LOC_MPT_OBSERVER_RESEARCH_CIVIC', civic, '#c08fe0')
  ];
}

// ============================ Toolbar ============================

/** Fully rebuild the ribbon DOM (row counts change between views). */
function rebuildRibbon() {
  try {
    const panel = document.querySelector('panel-diplo-ribbon');
    const component = panel?.maybeComponent ?? panel?.component;
    component?.populateFlags?.();
  } catch (e) { log(`ribbon rebuild failed: ${e}`); }
}

/** Throttled rebuild so steady-state updates don't repaint the ribbon every event. */
let lastRebuildAt = 0;
function rebuildRibbonThrottled() {
  const now = Date.now();
  if (now - lastRebuildAt < 600) return;
  lastRebuildAt = now;
  rebuildRibbon();
}

function setView(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  refreshToolbarState();
  try {
    DiploRibbonData.updateAll();
    rebuildRibbon();
  } catch (e) { log(`toggle failed: ${e}`); }
  log(`view -> ${mode}`);
}

function makeButton(mode, labelLoc) {
  const btn = document.createElement('fxs-activatable');
  btn.classList.add('mpt-observer-btn', 'pointer-events-auto');
  btn.setAttribute('data-mode', mode);
  btn.style.cssText =
    'padding: 0.25rem 1rem; margin: 0 0.25rem; cursor: pointer; font-size: 0.9rem;' +
    'border: 0.0555555556rem solid #8c7e62; border-radius: 0.25rem; color: #e7d9ac;' +
    'background: rgba(20, 26, 38, 0.85); text-shadow: 0 0 2px #000;';
  btn.innerHTML = Locale.compose(labelLoc);
  btn.addEventListener('action-activate', () => setView(mode));
  btn.addEventListener('click', () => setView(mode));
  return btn;
}

function refreshToolbarState() {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (!toolbar) return;
  for (const btn of toolbar.querySelectorAll('.mpt-observer-btn')) {
    const active = btn.getAttribute('data-mode') === viewMode;
    btn.style.background = active ? 'rgba(231, 217, 172, 0.9)' : 'rgba(20, 26, 38, 0.85)';
    btn.style.color = active ? '#1a1a1a' : '#e7d9ac';
  }
}

function ensureToolbar() {
  try {
    if (document.getElementById(TOOLBAR_ID)) return;
    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.classList.add('pointer-events-none');
    toolbar.style.cssText =
      'position: fixed; top: 0.5rem; left: 50%; transform: translateX(-50%);' +
      'display: flex; flex-direction: row; align-items: center; z-index: 50;';
    toolbar.appendChild(makeButton(OBSERVER_VIEW.YIELDS, 'LOC_MPT_OBSERVER_YIELDS'));
    toolbar.appendChild(makeButton(OBSERVER_VIEW.RESEARCH, 'LOC_MPT_OBSERVER_RESEARCH'));
    toolbar.appendChild(makeButton(OBSERVER_VIEW.PRODUCTION, 'LOC_MPT_OBSERVER_PRODUCTION'));
    toolbar.appendChild(makeButton(OBSERVER_VIEW.SCORE, 'LOC_MPT_OBSERVER_SCORE'));
    document.body.appendChild(toolbar);
    refreshToolbarState();
    log('observer toolbar created');
  } catch (e) { log(`toolbar create failed: ${e}`); }
}

// ====================== Model installation ======================

function installObserverRibbon() {
  if (typeof DiploRibbonData?.updateAll !== 'function' ||
      typeof DiploRibbonData?.createPlayerYieldsData !== 'function') {
    log('diplo ribbon model unavailable; observer ribbon inactive');
    return;
  }

  // Chokepoint: both the full and incremental refreshes build a player's stat
  // rows here. For an observer, the selected view swaps yields for research /
  // production / score, consistently across every refresh path (no flicker).
  const baseYields = DiploRibbonData.createPlayerYieldsData.bind(DiploRibbonData);
  DiploRibbonData.createPlayerYieldsData = function (playerLibrary, isLocal) {
    if (isObserverContext() && playerLibrary) {
      try {
        if (viewMode === OBSERVER_VIEW.RESEARCH) return researchItems(playerLibrary);
        if (viewMode === OBSERVER_VIEW.PRODUCTION) return productionItems(playerLibrary);
        if (viewMode === OBSERVER_VIEW.SCORE) return scoreItems(playerLibrary);
      } catch (e) { /* fall through to base yields */ }
    }
    return baseYields(playerLibrary, isLocal);
  };

  // Pin every player's stats on-screen for an observer (no hover needed). The
  // panel hides stats behind hover unless areRibbonYieldsStuckOnScreen is true;
  // force it for observers without touching the user's own toggle state.
  try {
    const proto = Object.getPrototypeOf(DiploRibbonData);
    const baseStuck = Object.getOwnPropertyDescriptor(proto, 'areRibbonYieldsStuckOnScreen')?.get;
    Object.defineProperty(DiploRibbonData, 'areRibbonYieldsStuckOnScreen', {
      configurable: true,
      get() {
        if (isObserverContext()) return true;
        return baseStuck ? baseStuck.call(this)
          : (this._alwaysShowYields === 1 || this._userDiploRibbonsToggled === 1);
      }
    });
  } catch (e) { log(`could not pin ribbon stats: ${e}`); }

  // For an observer, populate the ribbon from every living major player
  // instead of bailing on the missing local player.
  const baseUpdateAll = DiploRibbonData.updateAll.bind(DiploRibbonData);
  DiploRibbonData.updateAll = function () {
    if (!isObserverContext()) {
      baseUpdateAll();
      return;
    }
    try {
      this.getRibbonDisplayTypesFromUserOptions?.();
      const rebuilt = [];
      for (const player of Players.getAlive()) {
        if (!player?.isMajor) continue;
        const data = this.createPlayerData(player, player.Diplomacy, true);
        if (data) rebuilt.push(data);
      }
      this._playerData = rebuilt;
      this.onUpdate?.(this);
      this._eventNotificationRefresh?.trigger?.();
      ensureToolbar();
      // The meters (icon/name/bar) live in the displayItems `img`, which the
      // ribbon's incremental refresh does NOT touch - only a full rebuild
      // repaints them. Force one each update so research/production stay current.
      if (viewMode === OBSERVER_VIEW.RESEARCH || viewMode === OBSERVER_VIEW.PRODUCTION) {
        rebuildRibbonThrottled();
      }
    } catch (e) {
      log(`observer rebuild failed (${e}); falling back to base`);
      baseUpdateAll();
    }
  };

  log('observer diplo-ribbon population installed');
}

if (CONFIG.enabled) installObserverRibbon();
