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
 * Multiplayer Toolkit - Observer configuration & constants (in-game scope).
 */

/** What every leader card on the Observer's ribbon shows. */
const OBSERVER_VIEW = {
  YIELDS: 'yields',
  RESEARCH: 'research',
  PRODUCTION: 'production',
  SCORE: 'score'
};

/** Tunable settings. */
const CONFIG = {
  enabled: true,                        // master switch for the Observer's in-game features
  debug: true,                          // extra UI.log diagnostics (e.g. the Eye's vision each turn)
  defaultView: OBSERVER_VIEW.YIELDS,
  autoEndTurn: false,                   // initial state of the auto end turn toggle
  autoEndTurnDelayMs: 1000,             // wait after the turn starts (prompts are answered first)
  autoEndTurnRetryMs: 1000,             // retry while something still blocks the turn
  meterRefreshMs: 2000,                 // minimum gap between Research / Production meter repaints
  ribbonSeedAttempts: 30,               // tries to populate the ribbon once the HUD exists
  ribbonSeedIntervalMs: 500,
  combatPreviewLift: 'translateY(-4.5rem)',  // keeps the combat preview above the unit panel
  zoomIn: 0.25,                         // closest zoom: 25% less of the map than the game's closest
  zoomOut: 0.5,                         // furthest zoom: 50% more of the map than the game's furthest
  zoomStepScale: 0.5,                   // zoom step per input vs. the game's (smaller = smoother)
  notificationScale: 0.75               // notification bar size
};

/**
 * Card highlight colours: the glow of a leader at war and of a celebration,
 * one hex-border colour per alliance, and one pip colour per war pair.
 */
const HIGHLIGHT = {
  glowSize: '0.7rem',                   // glow around the portrait hex
  borderGlowSize: '0.3rem',             // tight glow on the hex border
  atWar: '#ff2a2a',
  celebration: '#ffc21a',
  alliances: ['#4aa3ff', '#5cd65c', '#b36bff', '#ff8c1a', '#3de0d0', '#ff5fb0', '#f0f0f0'],
  wars: ['#e04848', '#4aa3ff', '#5cd65c', '#b36bff', '#ff8c1a', '#3de0d0', '#ff5fb0', '#f0f0f0']
};

export { CONFIG, HIGHLIGHT, OBSERVER_VIEW };
