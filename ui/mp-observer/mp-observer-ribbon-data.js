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
 * Multiplayer Toolkit - Observer ribbon stat rows (in-game scope).
 *
 * Builds each leader card's rows for the Research, Production and Score views
 * in the base ribbon's displayItems shape. Meters and score rows live in the
 * item's `img` HTML so they fit the narrow card column; they use only markup
 * the Gameface renderer supports (plain <img>, width-based bars).
 */
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';

const TEXT_COLOR = '#e7d9ac';
const BAR_COLOR = { tech: '#5fb5f0', civic: '#c08fe0', production: '#7fc77f' };

/** A stat row: everything is drawn by `img`, the rest feeds tooltips and sorting. */
function displayItem(type, label, img, details, rawValue) {
  return { type, label, value: '', img, details, rawValue, warningThreshold: Infinity };
}

/** Icon, label and a progress bar stacked in one column; pct is 0..100. */
function meterHTML(iconUrl, label, pct, barColor) {
  const p = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const icon = iconUrl ? `<img src='${iconUrl}' style='width:1.7rem;height:1.7rem;'>` : '';
  const name = label
    ? `<div style='font-size:0.66rem;line-height:0.85rem;color:${TEXT_COLOR};text-align:center;margin-top:0.15rem;width:4.2rem;overflow:hidden;'>${label}</div>`
    : '';
  return `<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0.4rem 0.25rem;width:4.4rem;overflow:hidden;'>` +
    icon + name +
    `<div style='width:2.4rem;height:0.22rem;border-radius:0.11rem;background-color:rgba(255,255,255,0.22);margin-top:0.25rem;'>` +
    `<div style='height:100%;border-radius:0.11rem;background-color:${barColor};width:${p}%;'></div></div></div>`;
}

// ============================ Research ============================

/** True while an Age transition is processing (trees are in flux). */
function ageTransitionActive() {
  try { return Modding.getTransitionInProgress?.() === TransitionType.Age; } catch (e) { return false; }
}

/**
 * The node a player is researching in a tree, mirroring the sub-system dock:
 * { name, turns, icon, progress 0..1 } or null.
 */
function activeResearch(playerID, treeType, tree, isTech) {
  try {
    if (treeType == null) return null;
    const treeObject = Game.ProgressionTrees.getTree(playerID, treeType);
    const activeNode = treeObject?.activeNodeIndex >= 0 ? treeObject.nodes[treeObject.activeNodeIndex] : null;
    const nodeInfo = activeNode ? GameInfo.ProgressionTreeNodes.lookup(activeNode.nodeType) : null;
    if (!nodeInfo) return null;
    let name = Locale.compose(nodeInfo.Name ?? nodeInfo.ProgressionTreeNodeType);
    const nodeData = Game.ProgressionTrees.getNode(playerID, activeNode.nodeType);
    const numeral = nodeData?.depthUnlocked >= 1 ? Locale.toRomanNumeral(nodeData.depthUnlocked + 1) : '';
    if (numeral) name += ' ' + numeral;
    // getNodeCost is only safe with a valid researching type (as the dock guards it).
    let progress = 0;
    try {
      const researching = tree?.getResearching?.();
      const cost = researching?.type != null && nodeData ? tree.getNodeCost?.(researching.type) : 0;
      if (cost > 0) progress = Math.max(0, Math.min(1, nodeData.progress / cost));
    } catch (e) { /* leave 0 */ }
    const icon = isTech ? Icon.getTechIconFromProgressionTreeNodeDefinition(nodeInfo) : Icon.getCultureIconFromProgressionTreeNodeDefinition(nodeInfo);
    return { name, turns: tree?.getTurnsLeft?.() ?? 0, icon, progress };
  } catch (e) { return null; }
}

function researchRow(type, labelLoc, research, barColor) {
  if (!research) return displayItem(type, Locale.compose(labelLoc), '', Locale.compose('LOC_MPT_OBSERVER_NONE'), 0);
  const details = research.turns > 0 ? `${research.name} (${research.turns})` : research.name;
  return displayItem(type, research.name, meterHTML(research.icon, research.name, research.progress * 100, barColor), details, research.turns);
}

/** Current tech and civic meters. */
function researchItems(player) {
  const busy = ageTransitionActive();
  const tech = busy ? null : activeResearch(player.id, player.Techs?.getTreeType?.(), player.Techs, true);
  const civic = busy ? null : activeResearch(player.id, player.Culture?.getActiveTree?.(), player.Culture, false);
  return [
    researchRow('science', 'LOC_MPT_OBSERVER_RESEARCH_TECH', tech, BAR_COLOR.tech),
    researchRow('culture', 'LOC_MPT_OBSERVER_RESEARCH_CIVIC', civic, BAR_COLOR.civic)
  ];
}

// ============================ Production ============================

/** Localized name of a production item from its type hash, or null. */
function productionName(hash) {
  for (const table of [GameInfo.Units, GameInfo.Constructibles, GameInfo.Buildings, GameInfo.Projects]) {
    const def = table?.lookup?.(hash);
    if (def?.Name) return Locale.compose(def.Name);
  }
  return null;
}

/** One meter per city (towns have no production queue): icon = item, label = city. */
function productionItems(player) {
  const items = [];
  try {
    for (const city of player.Cities?.getCities?.() ?? []) {
      if (!city || city.isTown) continue;
      const cityName = Locale.compose(city.name || 'LOC_MPT_OBSERVER_NONE');
      const queue = city.BuildQueue;
      const hash = queue?.currentProductionTypeHash;
      const producing = hash != null && hash !== -1;
      const pct = producing ? (queue.getPercentComplete?.(hash) ?? 0) : 0;
      const itemName = producing ? productionName(hash) : null;
      items.push(displayItem('production', itemName ? `${cityName} - ${itemName}` : cityName,
        meterHTML(producing ? Icon.getProductionIconFromHash(hash) : '', cityName, pct, BAR_COLOR.production), itemName ?? cityName, pct));
    }
  } catch (e) { /* keep what was built */ }
  return items;
}

// ============================ Score ============================

/** Victory classes shown, in order; emblem classes show the Victories screen's own emblem. */
const VICTORY_CLASSES = [
  { type: 'VICTORY_CLASS_CULTURE', emblem: 'img-emblem-cultural' },
  { type: 'VICTORY_CLASS_ECONOMIC', emblem: 'img-emblem-economic' },
  { type: 'VICTORY_CLASS_MILITARY', emblem: 'img-emblem-military' },
  { type: 'VICTORY_CLASS_SCIENCE', emblem: 'img-emblem-scientific' },
  { type: 'VICTORY_CLASS_SCORE', label: 'LOC_MPT_OBSERVER_SCORE' }
];

/** Icon (or name) on the left, score on the right. */
function scoreRow(victoryClass, score) {
  const icon = victoryClass.emblem
    ? `<div class='${victoryClass.emblem}' style='width:1.6rem;height:1.6rem;background-size:contain;background-repeat:no-repeat;background-position:center;'></div>`
    : '';
  const name = victoryClass.label ? Locale.compose(victoryClass.label) : '';
  const nameSpan = name
    ? `<span style='font-size:0.62rem;line-height:0.8rem;color:${TEXT_COLOR};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:4rem;'>${name}</span>`
    : '';
  const img = `<div style='display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;padding:0.2rem 0;'>` +
    `<div style='display:flex;flex-direction:column;align-items:center;min-width:0;'>${icon}${nameSpan}</div>` +
    `<span style='font-size:0.9rem;color:${TEXT_COLOR};margin-left:0.3rem;flex-shrink:0;'>${score}</span></div>`;
  return displayItem('victory', name, img, name, score);
}

/** Points per victory class from player.Victories (the active Age's definition wins). */
function scoreItems(player) {
  const points = new Map();
  try {
    for (const def of GameInfo.Victories) {
      if (!VICTORY_CLASSES.some((c) => c.type === def.VictoryClassType)) continue;
      let pts = 0;
      try { pts = player.Victories?.getPointsForVictoryType?.(def.$hash) ?? 0; } catch (e) { pts = 0; }
      points.set(def.VictoryClassType, Math.max(points.get(def.VictoryClassType) ?? 0, pts));
    }
  } catch (e) { /* keep what was read */ }
  const items = VICTORY_CLASSES.filter((c) => points.has(c.type)).map((c) => scoreRow(c, points.get(c.type)));
  return items.length ? items : [scoreRow({ label: 'LOC_MPT_OBSERVER_NONE' }, 0)];
}

export { researchItems, productionItems, scoreItems };
