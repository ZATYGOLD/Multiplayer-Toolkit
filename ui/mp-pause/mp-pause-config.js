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
 * Multiplayer Toolkit - configuration & constants.
 *
 * Centralizes every tunable value and identifier so the manager, overlay and
 * styles stay consistent. Mirrors the data/logic separation used across the
 * base game's UI modules.
 */

/** Source tag used when registering/removing engine input filters. */
const FILTER_SOURCE = "MultiplayerToolkit";

/** Interface mode that shows the built-in pause menu. */
const PAUSE_MENU_MODE = "INTERFACEMODE_PAUSE_MENU";

/** Title of the stock multiplayer "Game Paused" popup we suppress. */
const NATIVE_PAUSE_DIALOG_TITLE = "LOC_MP_PAUSE_POPUP_TITLE";

/** Tunable timings / thresholds. */
const CONFIG = {
  resumeCountdownSeconds: 5,   // length of the "UNPAUSING..." countdown
  pollMs: 250,                 // tally / condition evaluation interval
  convergenceDelayMs: 2000,    // wait for all clients to flag in before voting
  voteThreshold: 0.60,         // fraction ready that triggers a vote resume
  voteDelayMs: 20000,          // a vote resume is only allowed after this long
  hostOverrideDelayMs: 45000,  // after this long, any readiness resumes (anti-AFK)
  finalizeBackstopMs: 4000,    // fallback idle if the unpause event is missed
  connectionWatchMs: 500       // how often to poll player connections for drops
};

/**
 * Input actions that advance / commit game state. Blocked while paused.
 * Verified against Base/modules/core/config/Input.xml. Camera, selection,
 * information screens and city/production panels are intentionally NOT listed.
 */
const PROGRESS_ACTIONS = [
  "next-action", "keyboard-enter", "force-end-turn",
  "unit-move", "unit-ranged-attack", "unit-skip-turn", "unit-sleep",
  "unit-fortify", "unit-heal", "unit-alert", "unit-auto-explore",
  "trigger-accept-dip", "quick-load"
];

/** Localization keys for the injected buttons (see text/en_us/mp-pause-text.xml). */
const LOC = {
  pauseGame: "LOC_MPT_PAUSE_GAME",
  ready: "LOC_MPT_READY",
  cancelReady: "LOC_MPT_CANCEL_READY",
  resumeHost: "LOC_MPT_RESUME_HOST",
  viewMap: "LOC_ADVANCED_START_VIEW_MAP"  // reuse the base game's existing string
};

/** Candidate import paths for a core singleton (mod is not co-located w/ core). */
function coreCandidates(relPath) {
  return [
    "fs://game/core/ui/" + relPath,
    "/core/ui/" + relPath,
    "../../../core/ui/" + relPath
  ];
}

export { FILTER_SOURCE, PAUSE_MENU_MODE, NATIVE_PAUSE_DIALOG_TITLE, CONFIG, PROGRESS_ACTIONS, LOC, coreCandidates };
