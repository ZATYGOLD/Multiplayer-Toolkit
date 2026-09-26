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
  meterRefreshMs: 600,                  // minimum gap between Research / Production meter repaints
  ribbonSeedAttempts: 30,               // tries to populate the ribbon once the HUD exists
  ribbonSeedIntervalMs: 500,
  combatPreviewLift: 'translateY(-4.5rem)'   // keeps the combat preview above the unit panel
};

/** Card highlight colours: celebrations, then one colour per war pair. */
const HIGHLIGHT = {
  celebration: '#f5c542',
  wars: ['#e04848', '#4aa3ff', '#5cd65c', '#b36bff', '#ff8c1a', '#3de0d0', '#ff5fb0', '#f0f0f0']
};

export { CONFIG, HIGHLIGHT, OBSERVER_VIEW };
