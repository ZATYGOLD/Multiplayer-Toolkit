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
 * Multiplayer Toolkit - "Waiting for Players" tooltip configuration & constants.
 *
 * Centralizes every tunable value and identifier so the tooltip logic stays
 * data-free. Mirrors the data/logic separation used by ui/mp-pause and
 * ui/mp-timer.
 */

/** Tunable timings / thresholds. */
const CONFIG = {
  refreshMs: 500,   // how often the pending-player list is refreshed
  debug: true
};

/** Engine identifiers the tooltip touches. */
const ENGINE = {
  bannerTextClass: "action-panel__button-txt-plate__text",
  actionButtonClass: "action-panel__button-next-action",
  waitingBannerLoc: "LOC_ACTION_PANEL_WAITING_FOR_PLAYERS"
};

/** Localization keys (see text/en_us/mpt-text.xml). */
const LOC = {
  waitingList: "LOC_MPT_WAITING_FOR_LIST"
};

export { CONFIG, ENGINE, LOC };
