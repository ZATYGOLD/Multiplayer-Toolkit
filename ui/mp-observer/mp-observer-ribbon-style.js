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
 * Multiplayer Toolkit - Observer ribbon look (in-game scope).
 *
 * One injected stylesheet for the Observer's ribbon:
 *   - fixed card size: every view renders into the stat-area size the Yields
 *     view uses, so switching views never re-lays out the ribbon;
 *   - highlights: a celebrating leader's portrait and civ banner glow gold;
 *     leaders at war with each other share a portrait colour (one per war
 *     pair, kept until peace) and a coloured pip per war under the portrait;
 *   - the leader panel shows no ribbon.
 */
import { HIGHLIGHT } from './mp-observer-config.js';
import { warPairs } from './mp-observer-core.js';

const STYLE_ID = 'mpt-observer-ribbon-style';
const SIZED_CLASS = 'mpt-observer-ribbon';
const HIDDEN_CLASS = 'mpt-observer-hub-hidden';
const CELEBRATING_CLASS = 'mpt-celebrating';
const WAR_CLASS_PREFIX = 'mpt-war-';
const PIPS_CLASS = 'mpt-war-pips';
const SIGNATURE_ATTR = 'data-mpt-highlight';
const CONTENT_WIDTH = '4.7222222222rem';   // .diplo-ribbon_content-container in the base stylesheet

let statHeightPx = 0;
let writtenCss = '';

// ============================ Stylesheet ============================

/** Portrait glow and hex-frame tint; a celebration also tints and glows the civ banner. */
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

/** (Re)write the stylesheet only when its content changes. War rules come last so they win on the portrait. */
function writeStyle() {
  const fixed = (prop) => `${prop}: ${CONTENT_WIDTH} !important; min-${prop}: ${CONTENT_WIDTH} !important; max-${prop}: ${CONTENT_WIDTH} !important;`;
  const height = statHeightPx > 0 ? `height: ${statHeightPx}px !important; min-height: ${statHeightPx}px !important; max-height: ${statHeightPx}px !important;` : '';
  const css = [
    `.${SIZED_CLASS} .diplo-ribbon__yields { ${fixed('width')} overflow: hidden !important; ${height} }`,
    `.${SIZED_CLASS} .diplo-ribbon_content-container { ${fixed('width')} }`,
    `.${SIZED_CLASS} .relationship-icon, .${SIZED_CLASS} .diplo-ribbon__war-support-count { display: none; }`,
    `.${HIDDEN_CLASS} { display: none !important; }`,
    ...highlightRules('.' + CELEBRATING_CLASS, HIGHLIGHT.celebration, true),
    ...HIGHLIGHT.wars.flatMap((color, i) => highlightRules('.' + WAR_CLASS_PREFIX + i, color, false))
  ].join('\n');
  if (css === writtenCss && document.getElementById(STYLE_ID)) return;
  let el = document.getElementById(STYLE_ID);
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = writtenCss = css;
}

/** Size the stat area once, measured in the Yields view from a leader card (not the Observer's own). */
function lockCardSize(panel, measure) {
  panel.classList.add(SIZED_CLASS);
  if (statHeightPx === 0 && measure) {
    const other = [...panel.querySelectorAll('.diplo-ribbon__yields')]
      .find((el) => parseInt(el.getAttribute('data-leader-id'), 10) !== GameContext.localPlayerID);
    statHeightPx = other?.offsetHeight ?? 0;
  }
  writeStyle();
}

/** Hide or show a ribbon panel (used for the leader panel's ribbon). */
function setRibbonHidden(panel, hidden) {
  if (hidden) writeStyle();
  panel.classList.toggle(HIDDEN_CLASS, hidden);
}

// ============================ Highlights ============================

const warColorByPair = new Map();
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
    const free = HIGHLIGHT.wars.findIndex((_, i) => !used.has(i));
    warColorByPair.set(key, free >= 0 ? free : warColorByPair.size % HIGHLIGHT.wars.length);
  }
  return pairs.map((pair) => ({ a: pair[0], b: pair[1], color: warColorByPair.get(pairKey(pair)) }));
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
    pip.style.cssText = `width: 0.6rem; height: 0.6rem; margin: 0 0.1rem; border-radius: 0.3rem; background-color: ${HIGHLIGHT.wars[war.color]}; border: 0.0555555556rem solid #000000;`;
    if (enemy) pip.setAttribute('data-tooltip-content', Locale.compose('LOC_MPT_OBSERVER_AT_WAR_WITH', enemy.name));
    pips.appendChild(pip);
  }
  (card.querySelector('.diplo-ribbon__relation-container') ?? card).appendChild(pips);
}

/** Celebration and war highlights on every leader card; cards whose state is unchanged are left alone. */
function markCards(panel, isCelebrating) {
  if (!panel) return;
  const wars = coloredWars();
  for (const card of panel.querySelectorAll('.diplo-ribbon-outer[data-player-id]')) {
    const id = parseInt(card.getAttribute('data-player-id'), 10);
    const player = Players.get(id);
    const own = wars.filter((w) => w.a === id || w.b === id).sort((x, y) => x.color - y.color);
    const celebrating = !!player && isCelebrating(player);
    const signature = `${celebrating}|${own.map((w) => `${w.a}-${w.b}:${w.color}`).join(',')}`;
    if (card.getAttribute(SIGNATURE_ATTR) === signature) continue;
    card.setAttribute(SIGNATURE_ATTR, signature);
    card.classList.toggle(CELEBRATING_CLASS, celebrating);
    HIGHLIGHT.wars.forEach((_, i) => card.classList.toggle(WAR_CLASS_PREFIX + i, own[0]?.color === i));
    warPips(card, own, id);
  }
}

export { lockCardSize, markCards, setRibbonHidden };
