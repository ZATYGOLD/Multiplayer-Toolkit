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
 * Multiplayer Toolkit - Observer leader view on the older screens (in-game scope).
 *
 * Runtime patches (no base-file copies) giving the Religion, Great Works and
 * tech / civic tree screens the leader picker of mp-observer-leader-view.js:
 *   - Religion (panel-belief-picker): the viewed leader's religion is the
 *     screen's own (first tab); a leader without one gets a note instead of
 *     another leader's religion; nothing can be chosen, founded or confirmed;
 *   - Great Works: the picker row under the title (the slots themselves come
 *     from the model-great-works.js override);
 *   - tech and civic trees: the picker row under the title (the progress
 *     comes from the model-tech-tree.js, model-culture-tree.js and
 *     tree-grid.js overrides); a leader switch rebuilds the open tree in
 *     place by sending the screen's own "view tree" event for that leader's
 *     trees (the civic screen's cached tab panels are rebuilt). The Observer
 *     cannot choose, so a chooser opens its full tree instead (openFullTree,
 *     routed by mp-observer-screens.js).
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';
import { createLogger, whenDefined, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { BAR_CLASS, setRefresh, viewedPlayerID } from './mp-observer-leader-view.js';

const log = createLogger('observer-leader-screens');
const RELIGION_TAG = 'panel-belief-picker';
const GREAT_WORKS_TAG = 'screen-great-works';

/** The node being researched in a player's tree, else undefined. */
function activeNode(player, treeType) {
  const tree = treeType === undefined ? null : Game.ProgressionTrees.getTree(player.id, treeType);
  return tree && tree.activeNodeIndex >= 0 ? tree.nodes?.[tree.activeNodeIndex]?.nodeType : undefined;
}

/**
 * Tree screens, their chooser, and the event (with the detail the chooser's
 * "View Tree" sends for a player) that shows a tree.
 */
const TREES = [
  {
    tag: 'screen-tech-tree', chooser: 'screen-tech-tree-chooser', event: 'view-tech-progression-tree',
    detail: (player) => {
      const treeType = player.Techs?.getTreeType();
      return treeType === undefined ? null
        : { treeCSV: String(treeType), targetNode: activeNode(player, treeType), iconCallback: Icon.getTechIconFromProgressionTreeNodeDefinition };
    }
  },
  {
    tag: 'screen-culture-tree', chooser: 'screen-culture-tree-chooser', event: 'view-culture-progression-tree',
    defaultTab: () => GameInfo.Ages.lookup(Game.age)?.MainCultureProgressionTreeType,
    detail: (player) => {
      const trees = [...(player.Culture?.getAvailableTrees() ?? [])];
      const main = GameInfo.Ages.lookup(Game.age)?.MainCultureProgressionTreeType;
      if (main && !trees.some((t) => GameInfo.ProgressionTrees.lookup(t)?.ProgressionTreeType === main)) trees.unshift(main);
      return !trees.length ? null
        : { treeCSV: trees.join(','), targetNode: activeNode(player, player.Culture.getActiveTree()), iconCallback: Icon.getCultureIconFromProgressionTreeNodeDefinition };
    }
  }
];
const TREE_SCREEN_PROPS = { singleton: true, createMouseGuard: true };
const CHOOSER_TAGS = new Set(TREES.map((t) => t.chooser));
const NOTE_CLASS = 'mpt-observer-no-religion';
const GREAT_WORKS_BAR_STYLE = { marginTop: '-1rem', marginBottom: '1.5rem' };   // clear of the frame's top border

const viewedPlayer = () => {
  const id = viewedPlayerID();
  return id === undefined ? null : Players.get(id);
};

function insertBar(anchor, screenTag, before = true) {
  const bar = globalThis.MPTLeaderView?.playerBar(screenTag);
  if (!bar || !anchor?.parentElement) return null;
  anchor.parentElement.insertBefore(bar, before ? anchor : anchor.nextSibling);
  return bar;
}

// ============================ Religion ============================

/** Base layout for "no religion": the religion area and its tabs hidden, plus a note. */
function showNoReligion(root, player) {
  root.querySelector('.belief-picker_belief-choices')?.classList.add('opacity-0');
  root.querySelector('.belief-picker_belief-tabs')?.classList.add('hidden');
  root.querySelector('.belief-picker-main-icon')?.classList.add('hidden');
  if (root.querySelector('.' + NOTE_CLASS)) return;
  const note = document.createElement('p');
  note.classList.value = `${NOTE_CLASS} font-body-base text-accent-2 text-center self-center mt-6`;
  note.textContent = Locale.compose('LOC_MPT_OBSERVER_NO_RELIGION', player.name);
  root.querySelector('.belief-picker_belief-choices')?.parentElement?.prepend(note);
}

function patchReligion(proto) {
  // The viewed leader's religion is the screen's own; the Observer never founds one.
  wrapMethod(proto, 'constructAllPlayerReligionInfo', function (base, ...args) {
    const viewed = viewedPlayer();
    if (!viewed?.Religion) return base(...args);
    this.playerObject = viewed;
    this.playerReligion = viewed.Religion;
    const result = base(...args);
    if (this.mustCreateReligion) {
      if (!this.playerReligion.hasCreatedReligion()) this.allPlayerReligions = this.allPlayerReligions.filter((r) => r !== this.playerReligion);
      this.mustCreateReligion = false;
    }
    return result;
  });
  wrapMethod(proto, 'onAttach', function (base, ...args) {
    const result = base(...args);
    const viewed = viewedPlayer();
    if (!viewed) return result;
    try {
      this.beliefConfirmButton?.classList.add('hidden');
      this.backButton?.classList.add('hidden');
      insertBar(this.Root.querySelector('.belief-picker_belief-tabs'), RELIGION_TAG);
      if (!viewed.Religion?.hasCreatedReligion()) showNoReligion(this.Root, viewed);
    } catch (e) { log(`religion screen patch failed: ${e}`); }
    return result;
  });
  for (const name of ['openBeliefChooser', 'onConfirm']) {
    wrapMethod(proto, name, function (base, ...args) { return viewedPlayer() ? undefined : base(...args); });
  }
}

// ============================ Great Works ============================

function patchGreatWorks(proto) {
  wrapMethod(proto, 'onAttach', function (base, ...args) {
    const result = base(...args);
    try {
      const bar = insertBar(this.Root.querySelector('.great-works-header'), GREAT_WORKS_TAG, false);
      if (bar) Object.assign(bar.style, GREAT_WORKS_BAR_STYLE);
    } catch (e) { log(`great works screen patch failed: ${e}`); }
    return result;
  });
}

// ============================ Tech and civic trees ============================

const placeTreeBar = (root, screenTag) => insertBar(root?.querySelector('fxs-header'), screenTag, false);

/**
 * The civic screen caches one panel per tab position, built for the trees it
 * first showed; another leader's civilization tree needs fresh panels, or
 * its tab can never be selected.
 */
function resetTreePanels(screen, treesCSV) {
  if (screen._mptTreesCSV !== treesCSV && screen.panelContentElements?.size) {
    for (const entry of screen.panelContentElements.values()) entry.cardScaling?.removeListeners?.();
    screen.panelContentElements.clear();
  }
  screen._mptTreesCSV = treesCSV;
}

/** Opens the screen's tab bar on the tab with this id (the base picks the tree being researched, kept from the last leader or Age). */
function selectTab(fragment, id) {
  const bar = [...(fragment?.childNodes ?? [])].find((node) => String(node.localName).toLowerCase() === 'fxs-tab-bar');
  const index = id ? JSON.parse(bar?.getAttribute('tab-items') ?? '[]').findIndex((tab) => tab.id === id) : -1;
  if (index >= 0) bar.setAttribute('selected-tab-index', `${index}`);
}

function patchTree(proto, tree) {
  wrapMethod(proto, 'onAttach', function (base, ...args) {
    const result = base(...args);
    try { placeTreeBar(this.Root, tree.tag); } catch (e) { log(`${tree.tag} patch failed: ${e}`); }
    return result;
  });
  wrapMethod(proto, 'refreshProgressionTree', function (base, treesCSV, ...rest) {
    try { resetTreePanels(this, treesCSV); } catch (e) { log(`${tree.tag} panel reset failed: ${e}`); }
    return base(treesCSV, ...rest);
  });
  if (tree.defaultTab) {
    wrapMethod(proto, 'createTabControl', function (base, ...args) {
      const fragment = base(...args);
      try { if (viewedPlayer()) selectTab(fragment, tree.defaultTab()); } catch (e) { log(`${tree.tag} tab select failed: ${e}`); }
      return fragment;
    });
  }
  // A leader switch shows the newly viewed leader's trees in the open screen.
  setRefresh(tree.tag, () => {
    const screen = document.querySelector(tree.tag);
    const player = viewedPlayer();
    const detail = screen && player ? tree.detail(player) : null;
    if (!detail) return false;
    screen.querySelector('.' + BAR_CLASS)?.remove();
    placeTreeBar(screen, tree.tag);
    window.dispatchEvent(new CustomEvent(tree.event, { detail }));
    return true;
  });
}

/** Opens the viewed leader's full tree for a chooser, as its "View Tree" does; false when there is none to show. */
function openFullTree(chooserTag) {
  const tree = TREES.find((t) => t.chooser === chooserTag);
  const player = viewedPlayer();
  const detail = tree && player ? tree.detail(player) : null;
  if (!detail) return false;
  try {
    ContextManager.push(tree.tag, { ...TREE_SCREEN_PROPS, targetParent: document.querySelector('.fxs-trees') ?? undefined });
    window.dispatchEvent(new CustomEvent(tree.event, { detail }));
    return true;
  } catch (e) { log(`${tree.tag} open failed: ${e}`); return false; }
}

if (CONFIG.enabled) {
  for (const tree of TREES) whenDefined(tree.tag, (definition) => patchTree(definition.createInstance.prototype, tree), { log });
  whenDefined(RELIGION_TAG, (definition) => patchReligion(definition.createInstance.prototype), { log });
  whenDefined(GREAT_WORKS_TAG, (definition) => patchGreatWorks(definition.createInstance.prototype), { log });
}

export { CHOOSER_TAGS, openFullTree };
