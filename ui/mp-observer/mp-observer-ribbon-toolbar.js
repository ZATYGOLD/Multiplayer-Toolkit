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
 * Multiplayer Toolkit - Observer ribbon view buttons (in-game scope).
 *
 * The Observer's own card has no stats; its stat area holds round buttons
 * (the game's mini-map lens button with its own yield glyphs) that switch
 * every other card between Yields | Production, Research and Victories. The
 * card's banner, between the portrait and the civ symbol, holds the Auto End
 * Turn toggle (mp-observer-turn.js).
 */
import { OBSERVER_VIEW } from './mp-observer-config.js';
import { isAutoEndTurn, setAutoEndTurn } from './mp-observer-turn.js';

const BUTTONS_CLASS = 'mpt-observer-view-buttons';
const AUTO_END_CLASS = 'mpt-observer-auto-end';
const BUTTON_SIZE_REM = 1.6;
const BUTTON_SIZE = `${BUTTON_SIZE_REM}rem`;
const DOUBLE_ACTIVATION_MS = 150;   // a click fires both action-activate and click
const AUTO_END_TOP = '3.05rem';   // centred between the portrait hex (bottom ~2.7rem) and the civ symbol (top 5rem, the base mt-20)
const GLYPH_INSET = '0.2rem';   // same glyph area on every button (the lens button's own inset is larger)

const ICON = {
  gold: 'blp:fi_Yield_Gold_64',
  science: 'blp:fi_Yield_Science_64',
  culture: 'blp:fi_Yield_Culture_64',
  happiness: 'blp:fi_Yield_Happiness_64',
  influence: 'blp:fi_yield_diplomacy_64',
  production: 'blp:fi_Yield_Production_64',
  tech: 'blp:fi_radial_tech_64',
  civic: 'blp:fi_radial_civics_64',
  victories: 'blp:radial_victories',
  endTurn: 'blp:fi_next_turn_64'
};

function iconDiv(url, cssText) {
  const d = document.createElement('div');
  d.style.cssText = `position: absolute; background-image: url("${url}"); background-size: contain; background-repeat: no-repeat; background-position: center; ${cssText}`;
  return d;
}

/** Five yield glyphs on the points of a pentagram: gold, science, happiness, influence, culture. */
function yieldsGlyph(icon) {
  const size = 38;   // percent of the button
  const points = [[ICON.gold, 50, 12], [ICON.science, 86, 40], [ICON.happiness, 72, 84], [ICON.influence, 28, 84], [ICON.culture, 14, 40]];
  for (const [url, cx, cy] of points) icon.appendChild(iconDiv(url, `width: ${size}%; height: ${size}%; left: ${cx - size / 2}%; top: ${cy - size / 2}%;`));
}

/** The tech and civic glyphs side by side. */
function researchGlyph(icon) {
  icon.appendChild(iconDiv(ICON.tech, 'width: 58%; height: 58%; left: -4%; top: 21%;'));
  icon.appendChild(iconDiv(ICON.civic, 'width: 58%; height: 58%; right: -4%; top: 21%;'));
}

const GLYPHS = {
  [OBSERVER_VIEW.YIELDS]: yieldsGlyph,
  [OBSERVER_VIEW.RESEARCH]: researchGlyph,
  [OBSERVER_VIEW.PRODUCTION]: (icon) => { icon.style.backgroundImage = `url("${ICON.production}")`; },
  [OBSERVER_VIEW.SCORE]: (icon) => { icon.style.backgroundImage = `url("${ICON.victories}")`; }
};

const BUTTON_ROWS = [
  [[OBSERVER_VIEW.YIELDS, 'LOC_MPT_OBSERVER_YIELDS'], [OBSERVER_VIEW.PRODUCTION, 'LOC_MPT_OBSERVER_PRODUCTION']],
  [[OBSERVER_VIEW.RESEARCH, 'LOC_MPT_OBSERVER_TECHS_CIVICS']],
  [[OBSERVER_VIEW.SCORE, 'LOC_PEDIA_VICTORIES_TITLE']]
];

/** A round lens-style button; drawGlyph fills its icon. */
function roundButton(tooltip, pressed, drawGlyph, onActivate) {
  const btn = document.createElement('fxs-activatable');
  btn.classList.add('mini-map__lens-button', 'pointer-events-auto');
  btn.classList.toggle('pressed', pressed);
  btn.setAttribute('data-tooltip-content', tooltip);
  btn.style.cssText = `width: ${BUTTON_SIZE}; height: ${BUTTON_SIZE}; margin: 0.3rem 0.25rem;`;
  const bg = document.createElement('div');
  bg.classList.add('mini-map__lens-button__bg');
  const icon = document.createElement('div');
  icon.classList.add('mini-map__lens-button__icon');
  icon.style.backgroundImage = 'none';
  for (const side of ['top', 'left', 'right', 'bottom']) icon.style[side] = GLYPH_INSET;
  drawGlyph(icon);
  btn.append(bg, icon);
  let lastActivation = 0;
  const activate = () => {
    const now = Date.now();
    if (now - lastActivation < DOUBLE_ACTIVATION_MS) return;
    lastActivation = now;
    onActivate(btn);
  };
  for (const event of ['action-activate', 'click']) btn.addEventListener(event, activate);
  return btn;
}

function viewButton(view, labelLoc, currentView, onSelect) {
  return roundButton(Locale.compose(labelLoc), view === currentView, GLYPHS[view], () => onSelect(view));
}

const autoEndTooltip = () => Locale.compose(isAutoEndTurn() ? 'LOC_MPT_OBSERVER_AUTO_END_TURN_ON' : 'LOC_MPT_OBSERVER_AUTO_END_TURN_OFF');

/** Toggles the Observer's auto end turn; pressed while on. */
function autoEndTurnButton() {
  const glyph = (icon) => { icon.style.backgroundImage = `url("${ICON.endTurn}")`; };
  const btn = roundButton(autoEndTooltip(), isAutoEndTurn(), glyph, () => {
    setAutoEndTurn(!isAutoEndTurn());
    btn.classList.toggle('pressed', isAutoEndTurn());
    btn.setAttribute('data-tooltip-content', autoEndTooltip());
  });
  btn.classList.add(AUTO_END_CLASS);
  return btn;
}

/** The toggle on the card's white banner, below the portrait hex and above the civ symbol. */
function placeAutoEndButton(card) {
  const banner = card?.querySelector('.diplo-ribbon__upper-bg');
  if (!banner || banner.querySelector('.' + AUTO_END_CLASS)) return;
  const btn = autoEndTurnButton();
  btn.style.cssText = `position: absolute; width: ${BUTTON_SIZE}; height: ${BUTTON_SIZE}; left: calc(50% - ${BUTTON_SIZE_REM / 2}rem); top: ${AUTO_END_TOP}; margin: 0; z-index: 10;`;
  banner.appendChild(btn);
}

/** Fill the Observer's own stat area with the view buttons, centre its eye portrait in the hex and add the toggle. */
function placeViewButtons(panel, currentView, onSelect) {
  const own = panel.querySelector(`.diplo-ribbon__yields[data-leader-id="${GameContext.localPlayerID}"]`);
  if (!own) return;
  if (!own.querySelector('.' + BUTTONS_CLASS)) {
    own.innerHTML = '';
    const box = document.createElement('div');
    box.classList.add(BUTTONS_CLASS, 'pointer-events-auto');
    box.style.cssText = 'display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0;';
    for (const row of BUTTON_ROWS) {
      const line = document.createElement('div');
      line.style.cssText = 'display: flex; flex-direction: row; justify-content: center;';
      for (const [view, loc] of row) line.appendChild(viewButton(view, loc, currentView, onSelect));
      box.appendChild(line);
    }
    own.appendChild(box);
  }
  const card = own.closest?.('.diplo-ribbon-outer');
  const portrait = card?.querySelector('.diplo-ribbon__portrait-image');
  if (portrait) Object.assign(portrait.style, { top: '0', left: '0', width: '100%', height: '100%' });
  placeAutoEndButton(card);
}

export { placeViewButtons };
