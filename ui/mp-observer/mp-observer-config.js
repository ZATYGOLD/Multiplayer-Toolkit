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
 * Multiplayer Toolkit - In-game observer features configuration & constants.
 */

/** View modes for the observer's player ribbons. */
const OBSERVER_VIEW = {
  YIELDS: 'yields',
  RESEARCH: 'research',
  PRODUCTION: 'production',
  SCORE: 'score'
};

/** Tunable settings. */
const CONFIG = {
  enabled: true,                  // master switch for the observer player ribbons
  defaultView: OBSERVER_VIEW.YIELDS,
  turnControl: true,              // lone observer (no humans playing): hold each turn until "Next Turn" (Autoplay-based, experimental)
  viewAsEnabled: true,            // right-click a leader to view their fog-of-war map (experimental)
  escapeMenuEnabled: false,       // observer Esc -> pause menu. OFF: forcing the pause menu crashes for a cleared-civ observer
  debug: true
};

export { CONFIG, OBSERVER_VIEW };
