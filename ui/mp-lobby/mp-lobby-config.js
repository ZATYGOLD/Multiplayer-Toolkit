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
 * Multiplayer Toolkit - Lobby UI fixes configuration & constants.
 */

/** Tunable settings. */
const CONFIG = {
  titleStyle: "text-negative-light", // engine text style for ability title lines
  observerSlots: true,               // EXPERIMENTAL: host-only "Observer" slot action in the MP lobby
  startCountdownSeconds: 5,          // all-ready lobby countdown before the game starts (stock: 10)
  debug: true
};

export { CONFIG };
