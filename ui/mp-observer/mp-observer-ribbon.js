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
 * Multiplayer Toolkit - Observer diplo-ribbon (in-game scope).
 *
 * The Observer is a real player, so the base ribbon works - but it only lists
 * leaders the local player has met, and an empire with no units never meets
 * anyone. For the Observer seat the ribbon is rebuilt from every living major
 * (the Observer's own card last, so it sits at the right edge) and a small
 * toolbar switches what every card shows: Yields, Research (tech + civic),
 * Production (per-city builds) or Score. Stats are pinned open. Other players
 * are untouched - every patch no-ops unless the local leader is the Observer.
 */
import { DiploRibbonData } from 'fs://game/base-standard/ui/diplo-ribbon/model-diplo-ribbon.js';
import { PanelDiploRibbon } from 'fs://game/base-standard/ui/diplo-ribbon/panel-diplo-ribbon.js';
import { RaiseDiplomacyEvent } from 'fs://game/base-standard/ui/diplomacy/diplomacy-events.js';
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';
import { CONFIG, OBSERVER_VIEW } from './mp-observer-config.js';
import { createLogger, isObserverSeat as isObserverContext, isObserverPlayer, warPairs } from './mp-observer-core.js';


let viewMode = CONFIG.defaultView;

const log = createLogger('observer-ribbon');


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
  const icon = iconUrl ? `<img src='${iconUrl}' style='width:1.7rem;height:1.7rem;'>` : '';
  const name = label
    ? `<div style='font-size:0.66rem;line-height:0.85rem;color:#e7d9ac;text-align:center;margin-top:0.15rem;width:4.2rem;overflow:hidden;'>${label}</div>`
    : '';
  return (
    `<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0.4rem 0.25rem;width:4.4rem;overflow:hidden;'>` +
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

/**
 * One score row laid out entirely inside the displayItems `img` (value left
 * empty) so it stays within the narrow ribbon column. Two columns: a left
 * column with the icon stacked over the name, and the score on the right.
 */
function scoreRow(iconHtml, name, score) {
  const nameSpan = name
    ? `<span style='font-size:0.62rem;line-height:0.8rem;color:#e7d9ac;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:4rem;'>${name}</span>`
    : '';
  const img =
    `<div style='display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;padding:0.2rem 0;'>` +
    `<div style='display:flex;flex-direction:column;align-items:center;min-width:0;'>${iconHtml}${nameSpan}</div>` +
    `<span style='font-size:0.9rem;color:#e7d9ac;margin-left:0.3rem;flex-shrink:0;'>${score}</span>` +
    `</div>`;
  return {
    type: 'victory',
    label: name,
    value: '',
    img,
    details: name,
    rawValue: score,
    warningThreshold: Infinity
  };
}

// The current victory system (post-update): each class maps to a metric, read
// via player.Victories.getPointsForVictoryType(hash). VICTORY_CLASS_SCORE is
// the overall game Score (the tiebreaker total).
const VICTORY_CLASS_LABEL = {
  VICTORY_CLASS_CULTURE: 'LOC_MPT_OBSERVER_TOURISM',
  VICTORY_CLASS_ECONOMIC: 'LOC_MPT_OBSERVER_GDP',
  VICTORY_CLASS_MILITARY: 'LOC_MPT_OBSERVER_DOMINION',
  VICTORY_CLASS_SCIENCE: 'LOC_MPT_OBSERVER_INNOVATION',
  VICTORY_CLASS_SCORE: 'LOC_MPT_OBSERVER_SCORE'
};
// The game's dedicated victory emblems (sprite classes used by the Victories
// screen). Rendered as a div background so the proper Tourism/GDP/Dominion/
// Innovation icon shows rather than a generic yield icon.
const VICTORY_CLASS_EMBLEM = {
  VICTORY_CLASS_CULTURE: 'img-emblem-cultural',
  VICTORY_CLASS_ECONOMIC: 'img-emblem-economic',
  VICTORY_CLASS_MILITARY: 'img-emblem-military',
  VICTORY_CLASS_SCIENCE: 'img-emblem-scientific'
};
const VICTORY_CLASS_ORDER = [
  'VICTORY_CLASS_CULTURE', 'VICTORY_CLASS_ECONOMIC',
  'VICTORY_CLASS_MILITARY', 'VICTORY_CLASS_SCIENCE', 'VICTORY_CLASS_SCORE'
];

function classIcon(cls) {
  const emblem = VICTORY_CLASS_EMBLEM[cls];
  return emblem
    ? `<div class='${emblem}' style='width:1.6rem;height:1.6rem;background-size:contain;background-repeat:no-repeat;background-position:center;'></div>`
    : '';
}

/**
 * Victory-class scores for a player (Tourism / GDP / Dominion / Innovation) and
 * the overall Score, read from player.Victories - the current victory system
 * the in-game Victories screen uses. Points are summed across each class's
 * victory definitions so the active (current-age) one supplies the value.
 */
function scoreItems(player) {
  const vic = player.Victories;
  const byClass = {};
  try {
    if (vic?.getPointsForVictoryType) {
      for (const def of GameInfo.Victories) {
        const cls = def?.VictoryClassType;
        if (!cls || !(cls in VICTORY_CLASS_LABEL)) continue;
        let pts = 0;
        try { pts = vic.getPointsForVictoryType(def.$hash) ?? 0; } catch (e) { pts = 0; }
        byClass[cls] = Math.max(byClass[cls] ?? 0, pts);
      }
    }
  } catch (e) { /* leave whatever we built */ }
  const items = [];
  for (const cls of VICTORY_CLASS_ORDER) {
    if (!(cls in byClass)) continue;
    // Emblem classes show the icon alone; the SCORE row (no emblem) keeps text.
    const hasEmblem = cls in VICTORY_CLASS_EMBLEM;
    const name = hasEmblem ? '' : Locale.compose(VICTORY_CLASS_LABEL[cls]);
    items.push(scoreRow(classIcon(cls), name, byClass[cls]));
  }
  if (items.length === 0) items.push(scoreRow('', Locale.compose('LOC_MPT_OBSERVER_NONE'), 0));
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
const RIGHT_EDGE_CLASS = 'right-4';   // base panel uses right-24; the observer sits closer to the edge

function inDiplomacyMode() {
  try { return /DIPLOMACY|CALL_TO_ARMS|PEACE_DEAL/.test(InterfaceMode.getCurrent() ?? ''); } catch (e) { return false; }
}

function tightenToRightEdge(panel) {
  if (!panel) return;
  if (inDiplomacyMode()) { panel.classList.remove(RIGHT_EDGE_CLASS); return; }
  if (panel.classList.contains(RIGHT_EDGE_CLASS) && !panel.classList.contains('right-24')) return;
  panel.classList.remove('right-24');
  panel.classList.add(RIGHT_EDGE_CLASS);
}

// ====================== Leader moods & highlights ======================
// At war -> angry portrait; celebrating (and not at war) -> happy portrait.
// Celebrating cards glow gold (portrait and civ banner). Leaders at war share
// a highlight colour (one colour per war pair, stable while the war lasts);
// every war a leader is in shows as a coloured pip under the portrait.

const CELEBRATION_COLOR = '#f5c542';
const WAR_COLORS = ['#e04848', '#4aa3ff', '#5cd65c', '#b36bff', '#ff8c1a', '#3de0d0', '#ff5fb0', '#f0f0f0'];
const WAR_CLASS_PREFIX = 'mpt-war-';
const PIPS_CLASS = 'mpt-war-pips';
const SIGNATURE_ATTR = 'data-mpt-highlight';
const warColorByPair = new Map();

function isAtWar(player) {
  try { return !!player.Diplomacy?.isAtWarWithAnyMajorCiv?.(); } catch (e) { return false; }
}
function isCelebrating(player) {
  try { return !!player.Happiness?.isInGoldenAge?.(); } catch (e) { return false; }
}
function moodContext(player) {
  if (isAtWar(player)) return 'LEADER_ANGRY';
  if (isCelebrating(player)) return 'LEADER_HAPPY';
  return '';
}

const pairKey = ([a, b]) => `${a}-${b}`;

/** Current wars as [{ a, b, color }]; a pair keeps its colour until peace. */
function coloredWars() {
  const pairs = warPairs();
  const live = new Set(pairs.map(pairKey));
  for (const key of [...warColorByPair.keys()]) if (!live.has(key)) warColorByPair.delete(key);
  for (const pair of pairs) {
    const key = pairKey(pair);
    if (warColorByPair.has(key)) continue;
    const used = new Set(warColorByPair.values());
    const free = WAR_COLORS.findIndex((_, i) => !used.has(i));
    warColorByPair.set(key, free >= 0 ? free : warColorByPair.size % WAR_COLORS.length);
  }
  return pairs.map(([a, b]) => ({ a, b, color: warColorByPair.get(pairKey([a, b])) }));
}

function warPips(card, wars, playerId) {
  card.querySelector('.' + PIPS_CLASS)?.remove();
  if (wars.length === 0) return;
  const pips = document.createElement('div');
  pips.classList.add(PIPS_CLASS);
  pips.style.cssText = 'display: flex; flex-direction: row; justify-content: center; margin-top: 0.2rem;';
  for (const war of wars) {
    const enemy = Players.get(war.a === playerId ? war.b : war.a);
    const pip = document.createElement('div');
    pip.classList.add('pointer-events-auto');
    pip.style.cssText = `width: 0.6rem; height: 0.6rem; margin: 0 0.1rem; border-radius: 0.3rem; background-color: ${WAR_COLORS[war.color]}; border: 0.0555555556rem solid #000000;`;
    if (enemy) pip.setAttribute('data-tooltip-content', Locale.compose('LOC_MPT_OBSERVER_AT_WAR_WITH', enemy.name));
    pips.appendChild(pip);
  }
  (card.querySelector('.diplo-ribbon__relation-container') ?? card).appendChild(pips);
}

/** Celebration glow, war-pair colour and war pips on every leader card. */
function markCards(panel) {
  if (!panel) return;
  const wars = coloredWars();
  for (const card of panel.querySelectorAll('.diplo-ribbon-outer[data-player-id]')) {
    const id = parseInt(card.getAttribute('data-player-id'), 10);
    const player = Players.get(id);
    const own = wars.filter((w) => w.a === id || w.b === id).sort((x, y) => x.color - y.color);
    const celebrating = !!player && isCelebrating(player);
    const signature = `${celebrating}|${own.map((w) => `${w.a}-${w.b}:${w.color}`).join(',')}`;
    if (card.getAttribute(SIGNATURE_ATTR) === signature) continue;   // unchanged: leave the DOM alone
    card.setAttribute(SIGNATURE_ATTR, signature);
    card.classList.toggle('mpt-celebrating', celebrating);
    WAR_COLORS.forEach((_, i) => card.classList.toggle(WAR_CLASS_PREFIX + i, own[0]?.color === i));
    warPips(card, own, id);
  }
}

/** Everything the Observer's ribbon needs after the base panel builds it. */
function decorateRibbon(panel) {
  if (!panel) return;
  if (hideInLeaderPanel(panel)) return;
  tightenToRightEdge(panel);
  if (!inDiplomacyMode()) {
    lockCardSize(panel);
    placeViewButtons(panel);
  }
  markCards(panel);
}

/** The leader panel (diplomacy hub) shows no ribbon for the Observer. Returns true when hidden. */
function hideInLeaderPanel(panel) {
  const hide = /DIPLOMACY_HUB/.test(InterfaceMode.getCurrent() ?? '');
  if (hide && !document.getElementById(STYLE_ID)) writeRibbonStyle();
  panel.classList.toggle(HUB_HIDDEN_CLASS, hide);
  return hide;
}

// ====================== Fixed card size ======================
// Every view renders into the same box: the stat area is locked to the size
// the Yields view uses, so switching views never re-lays out the ribbon.

const STYLE_ID = 'mpt-observer-ribbon-style';
const HUB_HIDDEN_CLASS = 'mpt-observer-hub-hidden';
const SIZED_CLASS = 'mpt-observer-ribbon';
const CONTENT_WIDTH = '4.7222222222rem';   // .diplo-ribbon_content-container in the base stylesheet
let statHeightPx = 0;

function writeRibbonStyle() {
  let el = document.getElementById(STYLE_ID);
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  const height = statHeightPx > 0 ? `height: ${statHeightPx}px !important; min-height: ${statHeightPx}px !important; max-height: ${statHeightPx}px !important;` : '';
  el.textContent = [
    `.${SIZED_CLASS} .diplo-ribbon__yields { width: ${CONTENT_WIDTH} !important; min-width: ${CONTENT_WIDTH} !important; max-width: ${CONTENT_WIDTH} !important; overflow: hidden !important; ${height} }`,
    `.${SIZED_CLASS} .diplo-ribbon_content-container { width: ${CONTENT_WIDTH} !important; min-width: ${CONTENT_WIDTH} !important; max-width: ${CONTENT_WIDTH} !important; }`,
    `.${SIZED_CLASS} .relationship-icon, .${SIZED_CLASS} .diplo-ribbon__war-support-count { display: none; }`,
    `.${HUB_HIDDEN_CLASS} { display: none !important; }`,
    ...highlightRules('.mpt-celebrating', CELEBRATION_COLOR, true),
    ...WAR_COLORS.flatMap((color, i) => highlightRules('.' + WAR_CLASS_PREFIX + i, color, false))
  ].join('\n');
}

/**
 * Card highlight rules: the portrait glows and its hex frame is tinted. A
 * celebration also tints and glows the civ banner. The stat area is never
 * highlighted. War rules come last, so a celebrating leader at war keeps the
 * gold banner and shows the war colour on the portrait.
 */
function highlightRules(selector, color, banner) {
  const card = `.${SIZED_CLASS} ${selector}`;
  const glow = `filter: drop-shadow(0 0 0.35rem ${color});`;
  const rules = [
    `${card} .diplo-ribbon__portrait-hex-bg-frame { fxs-background-image-tint: ${color}; }`,
    `${card} .diplo-ribbon__portrait { ${glow} }`
  ];
  if (banner) {
    rules.push(
      `${card} .diplo-ribbon__front-banner-shadow { fxs-border-image-tint: ${color}; }`,
      `${card} .diplo-ribbon__upper-bg { ${glow} }`
    );
  }
  return rules;
}

/** Measure the stat area once, in the Yields view, from a leader card (not the Observer's own). */
function lockCardSize(panel) {
  if (!panel) return;
  panel.classList.add(SIZED_CLASS);
  if (statHeightPx === 0 && viewMode === OBSERVER_VIEW.YIELDS) {
    const other = [...panel.querySelectorAll('.diplo-ribbon__yields')]
      .find((el) => parseInt(el.getAttribute('data-leader-id'), 10) !== GameContext.localPlayerID);
    const h = other?.offsetHeight ?? 0;
    if (h > 0) { statHeightPx = h; log(`stat area locked at ${h}px`); }
  }
  writeRibbonStyle();
}

/**
 * Full rebuild of the HUD ribbon, keeping the scrolled position. Skipped in
 * the diplomacy screens: there the base panel re-centres on the selected
 * leader and re-creates every card on each rebuild, which reads as jumping.
 */
function rebuildRibbon() {
  if (inDiplomacyMode()) return;
  try {
    const panel = document.querySelector('panel-diplo-ribbon');
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

/** Throttled rebuild so steady-state updates don't repaint the ribbon every event. */
let lastRebuildAt = 0;
function rebuildRibbonThrottled() {
  const now = Date.now();
  if (now - lastRebuildAt < 600) return;
  lastRebuildAt = now;
  rebuildRibbon();
}

/** Wars start or end: portraits, highlights and pips all change. */
function refreshMoods() {
  if (!isObserverContext()) return;
  try { DiploRibbonData.updateAll(); rebuildRibbon(); } catch (e) { log(`mood refresh failed: ${e}`); }
}

function setView(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  try {
    DiploRibbonData.updateAll();
    rebuildRibbon();
  } catch (e) { log(`toggle failed: ${e}`); }
  log(`view -> ${mode}`);
}

// Game assets: the round mini-map lens button (hud_mini_lens_btn) with the
// game's own yield glyphs. Layout: [Yields | Production] / [Research] / [Score].
const ICON = {
  gold: 'blp:fi_Yield_Gold_64',
  science: 'blp:fi_Yield_Science_64',
  culture: 'blp:fi_Yield_Culture_64',
  happiness: 'blp:fi_Yield_Happiness_64',
  influence: 'blp:fi_yield_diplomacy_64',
  production: 'blp:fi_Yield_Production_64',
  tech: 'blp:fi_radial_tech_64',
  civic: 'blp:fi_radial_civics_64',
  victories: 'blp:radial_victories'
};
const BUTTON_ROWS = [
  [[OBSERVER_VIEW.YIELDS, 'LOC_MPT_OBSERVER_YIELDS', 'yields'], [OBSERVER_VIEW.PRODUCTION, 'LOC_MPT_OBSERVER_PRODUCTION', 'production']],
  [[OBSERVER_VIEW.RESEARCH, 'LOC_MPT_OBSERVER_TECHS_CIVICS', 'research']],
  [[OBSERVER_VIEW.SCORE, 'LOC_PEDIA_VICTORIES_TITLE', 'score']]
];
const BUTTONS_CLASS = 'mpt-observer-view-buttons';
const BUTTON_SIZE = '1.6rem';
const GLYPH_INSET = '0.2rem';   // same glyph area on every button (the lens button's own inset is larger)

function iconDiv(url, cssText) {
  const d = document.createElement('div');
  d.style.cssText = `position: absolute; background-image: url("${url}"); background-size: contain; background-repeat: no-repeat; background-position: center; ${cssText}`;
  return d;
}

/** Five small yield glyphs on the points of an (unshown) pentagram: gold top, science right, happiness bottom-right, influence bottom-left, culture left. */
function yieldsGlyph(icon) {
  const size = 38;   // percent of the button
  const points = [[ICON.gold, 50, 12], [ICON.science, 86, 40], [ICON.happiness, 72, 84], [ICON.influence, 28, 84], [ICON.culture, 14, 40]];
  for (const [url, cx, cy] of points) {
    icon.appendChild(iconDiv(url, `width: ${size}%; height: ${size}%; left: ${cx - size / 2}%; top: ${cy - size / 2}%;`));
  }
}

/** The full tech glyph and the full civic glyph side by side. */
function researchGlyph(icon) {
  icon.appendChild(iconDiv(ICON.tech, 'width: 58%; height: 58%; left: -4%; top: 21%;'));
  icon.appendChild(iconDiv(ICON.civic, 'width: 58%; height: 58%; right: -4%; top: 21%;'));
}

function scoreGlyph(icon) {
  icon.style.backgroundImage = `url("${ICON.victories}")`;   // the radial menu's Victories trophy
}

function glyph(kind) {
  const icon = document.createElement('div');
  icon.classList.add('mini-map__lens-button__icon');
  icon.style.backgroundImage = 'none';
  for (const side of ['top', 'left', 'right', 'bottom']) icon.style[side] = GLYPH_INSET;
  if (kind === 'yields') yieldsGlyph(icon);
  else if (kind === 'research') researchGlyph(icon);
  else if (kind === 'score') scoreGlyph(icon);
  else icon.style.backgroundImage = `url("${ICON.production}")`;
  return icon;
}

function makeButton(mode, labelLoc, kind) {
  const btn = document.createElement('fxs-activatable');
  btn.classList.add('mini-map__lens-button', 'mpt-observer-btn', 'pointer-events-auto');
  btn.setAttribute('data-mode', mode);
  btn.setAttribute('data-tooltip-content', Locale.compose(labelLoc));
  btn.style.width = BUTTON_SIZE;
  btn.style.height = BUTTON_SIZE;
  btn.style.margin = '0.3rem 0.25rem';
  // Every button stays fully visible; the active view uses the lens button's own "pressed" look.
  btn.classList.toggle('pressed', mode === viewMode);
  const bg = document.createElement('div');
  bg.classList.add('mini-map__lens-button__bg');
  btn.appendChild(bg);
  btn.appendChild(glyph(kind));
  btn.addEventListener('action-activate', () => setView(mode));
  btn.addEventListener('click', () => setView(mode));
  return btn;
}

/**
 * The Observer's own card carries no stats; its stat area holds the view
 * buttons instead (Yields | Production, then Research, then Score). Its portrait is re-fitted to the hex so
 * the eye badge sits centred (individual style properties only - the icon
 * element keeps its own background-image). Re-applied after every build.
 */
function placeViewButtons(panel) {
  try {
    const own = panel?.querySelector(`.diplo-ribbon__yields[data-leader-id="${GameContext.localPlayerID}"]`);
    if (own && !own.querySelector('.' + BUTTONS_CLASS)) {
      own.innerHTML = '';
      const box = document.createElement('div');
      box.classList.add(BUTTONS_CLASS, 'pointer-events-auto');
      box.style.cssText = 'display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0;';
      for (const row of BUTTON_ROWS) {
        const line = document.createElement('div');
        line.style.cssText = 'display: flex; flex-direction: row; justify-content: center;';
        for (const [mode, loc, kind] of row) line.appendChild(makeButton(mode, loc, kind));
        box.appendChild(line);
      }
      own.appendChild(box);
    }
    let card = own;
    while (card && !card.classList?.contains('diplo-ribbon-outer')) card = card.parentElement;
    const portrait = card?.querySelector('.diplo-ribbon__portrait-image');
    if (portrait) {
      portrait.style.top = '0';
      portrait.style.left = '0';
      portrait.style.width = '100%';
      portrait.style.height = '100%';
    }
  } catch (e) { log(`view buttons failed: ${e}`); }
}

// ====================== Click -> capital ======================

/** Move the camera to the player's capital (else first city, else a unit). */
function lookAtPlayer(id) {
  try {
    const p = Players.get(id);
    const cities = p?.Cities?.getCities?.() ?? [];
    let loc = (cities.find((c) => c.isCapital) ?? cities[0])?.location;
    if (!loc) loc = (p?.Units?.getUnits?.() ?? []).find((u) => !u.isDead)?.location;
    if (loc) Camera.lookAtPlot(loc, { zoom: 1 });
  } catch (e) { log(`look-at failed: ${e}`); }
}

/** Walk up from an event target looking for a class; returns the element or null. */
function ancestorWithClass(el, cls) {
  while (el && typeof el.getAttribute === 'function') {
    if (el.classList?.contains(cls)) return el;
    el = el.parentElement;
  }
  return null;
}

/** The major (non-Observer) owner of the city whose banner shows this name. */
function ownerOfBanner(banner) {
  const name = banner.querySelector('.city-banner__name')?.textContent?.trim();
  if (!name) return null;
  for (const p of Players.getAlive()) {
    if (!p?.isMajor || isObserverPlayer(p.id)) continue;
    for (const city of p.Cities?.getCities?.() ?? []) {
      if (Locale.compose(city.name) === name) return p.id;
    }
  }
  return null;
}

/** A click that lands on a settlement banner opens that leader's diplomacy panel. */
function onBannerClick(ev) {
  const banner = ancestorWithClass(ev.target, 'city-banner');
  if (!banner) return false;
  const owner = ownerOfBanner(banner);
  log(`banner click: owner=${owner}`);
  if (owner == null) return false;
  window.dispatchEvent(new RaiseDiplomacyEvent(owner));
  return true;
}

/**
 * City-center tiles: the game's own handler raises diplomacy for another
 * leader's city center but refuses unmet leaders. For the Observer every
 * leader counts as met; every other tile keeps the base behaviour.
 */
function patchCityCenterClicks() {
  const base = WorldInput.handleSelectedPlotCity?.bind(WorldInput);
  if (!base) { log('world input city handler not found'); return; }
  WorldInput.handleSelectedPlotCity = (location, ...rest) => {
    if (isObserverContext()) {
      try {
        const districtId = MapCities.getDistrict(location.x, location.y);
        const district = districtId ? Districts.get(districtId) : null;
        if (district?.cityId && district.type == DistrictTypes.CITY_CENTER) {
          const owner = Cities.get(district.cityId)?.owner;
          const p = owner != null ? Players.get(owner) : null;
          if (p && (p.isMajor || p.isMinor || p.isIndependent) && !isObserverPlayer(owner)) {
            window.dispatchEvent(new RaiseDiplomacyEvent(owner));
            return false;
          }
        }
      } catch (e) { log(`city center click failed: ${e}`); }
    }
    return base(location, ...rest);
  };
}

/** Left or right click on a leader portrait: camera to their capital, no diplomacy screen. */
function onEngineInput(ev) {
  try {
    const d = ev.detail;
    if (!d || !['mousebutton-left', 'mousebutton-right', 'accept'].includes(d.name) || !isObserverContext()) return;
    if (d.status === InputActionStatuses.FINISH && d.name === 'mousebutton-left' && onBannerClick(ev)) {
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }
    let el = ev.target, id = null, onLeader = false;
    while (el && typeof el.getAttribute === 'function') {
      if (el.classList?.contains('diplo-ribbon__portrait') || el.classList?.contains('diplo-ribbon__portrait-hitbox')) onLeader = true;
      if (id == null && el.getAttribute('data-player-id') != null) id = parseInt(el.getAttribute('data-player-id'), 10);
      if (String(el.localName).toLowerCase() === 'panel-diplo-ribbon') break;
      el = el.parentElement;
    }
    if (!onLeader || id == null || Number.isNaN(id)) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (d.status === InputActionStatuses.FINISH) lookAtPlayer(id);
  } catch (e) { /* ignore */ }
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
      if (playerLibrary.id === GameContext.localPlayerID) return [];   // the Observer has no stats
      try {
        if (viewMode === OBSERVER_VIEW.RESEARCH) return researchItems(playerLibrary);
        if (viewMode === OBSERVER_VIEW.PRODUCTION) return productionItems(playerLibrary);
        if (viewMode === OBSERVER_VIEW.SCORE) return scoreItems(playerLibrary);
      } catch (e) { /* fall through to base yields */ }
    }
    return baseYields(playerLibrary, isLocal);
  };

  const baseSize = DiploRibbonData.createPlayerSizeData.bind(DiploRibbonData);
  DiploRibbonData.createPlayerSizeData = function (playerLibrary, isLocal) {
    if (isObserverContext() && playerLibrary?.id === GameContext.localPlayerID) return [];
    return baseSize(playerLibrary, isLocal);
  };

  // Pin every player's stats on-screen for an observer (no hover needed). The
  // panel hides stats behind hover unless areRibbonYieldsStuckOnScreen is true;
  // force it for observers without touching the user's own toggle state.
  // The diplomacy screens keep the base compact cards.
  try {
    const proto = Object.getPrototypeOf(DiploRibbonData);
    const baseStuck = Object.getOwnPropertyDescriptor(proto, 'areRibbonYieldsStuckOnScreen')?.get;
    Object.defineProperty(DiploRibbonData, 'areRibbonYieldsStuckOnScreen', {
      configurable: true,
      get() {
        if (isObserverContext() && !inDiplomacyMode()) return true;
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
      let own = null;
      for (const player of Players.getAlive()) {
        if (!player?.isMajor) continue;
        const data = this.createPlayerData(player, player.Diplomacy, true);
        if (!data) continue;
        data.portraitContext = moodContext(player);
        if (player.id === GameContext.localPlayerID) own = data; else rebuilt.push(data);
      }
      if (own) rebuilt.push(own);   // the Observer's own card is always the right-most
      this._playerData = rebuilt;
      this.onUpdate?.(this);
      this._eventNotificationRefresh?.trigger?.();
      for (const panel of document.querySelectorAll('panel-diplo-ribbon')) markCards(panel);
      // The meters (icon/name/bar) live in the displayItems `img`, which the
      // ribbon's incremental refresh does NOT touch - only a full rebuild
      // repaints them. Force one each update so research/production stay current.
      if (!inDiplomacyMode() && (viewMode === OBSERVER_VIEW.RESEARCH || viewMode === OBSERVER_VIEW.PRODUCTION)) {
        rebuildRibbonThrottled();
      }
    } catch (e) {
      log(`observer rebuild failed (${e}); falling back to base`);
      baseUpdateAll();
    }
  };

  // Losing focus normally minimises the stats and requests a full model update.
  // Stats are pinned for the Observer, and rebuilding the cards can itself
  // move focus, so that update would loop; skip it for the Observer.
  try {
    const baseFocusout = PanelDiploRibbon.prototype.onFocusout;
    PanelDiploRibbon.prototype.onFocusout = function (...args) {
      if (isObserverContext()) return;
      return baseFocusout.apply(this, args);
    };
  } catch (e) { log(`focusout patch failed: ${e}`); }

  // The panel re-applies its stock right margin on every populate; keep the
  // observer's ribbon at the right edge through all of them.
  try {
    const basePopulate = PanelDiploRibbon.prototype.populateFlags;
    PanelDiploRibbon.prototype.populateFlags = function (...args) {
      const result = basePopulate.apply(this, args);
      if (isObserverContext()) decorateRibbon(this.Root);
      return result;
    };
  } catch (e) { log(`right-edge patch failed: ${e}`); }

  log('observer diplo-ribbon population installed');
}

/**
 * Force the ribbon to populate for an observer without waiting on a sparse game
 * event. The model's very first updateAll runs at construction - before our
 * override is installed - so for an observer it bails and leaves the ribbon
 * empty until some later event happens to fire. Seed it ourselves once things
 * are ready, retrying until the panel exists (HUD bring-up can be late for a
 * cleared-civ observer).
 */
function seedObserverRibbon(attempts) {
  if (!isObserverContext()) return;
  try {
    DiploRibbonData.updateAll();
    rebuildRibbon();
  } catch (e) { log(`seed failed: ${e}`); }
  const havePanel = !!document.querySelector('panel-diplo-ribbon');
  if (attempts > 0 && !havePanel) {
    setTimeout(() => seedObserverRibbon(attempts - 1), 500);
  }
}

if (CONFIG.enabled) {
  installObserverRibbon();
  window.addEventListener('engine-input', onEngineInput, true);
  for (const event of ['DiplomacyDeclareWar', 'DiplomacyMakePeace']) engine.on(event, refreshMoods);
  patchCityCenterClicks();
  try { engine.whenReady.then(() => seedObserverRibbon(30)); }
  catch (e) { setTimeout(() => seedObserverRibbon(30), 500); }
}
