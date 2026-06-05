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
 * Multiplayer Toolkit - Competitive turn timer configuration & constants.
 *
 * Centralizes every tunable value and identifier so the timer logic stays
 * data-free. Mirrors the data/logic separation used by ui/mp-pause.
 */

/** TurnTimers row registered by config/SetupParameters.sql. */
const TIMER_TYPE = "MPT_TURNTIMER_COMPETITIVE";

/** Tunable timings / thresholds. */
const CONFIG = {
  roundToNearest: 1,        // round the computed total to the nearest multiple (1 = whole seconds)
  orangeStart: 30,          // orange tier begins at this many seconds remaining
  flashStart: 15,           // red flash + per-second beeps begin here
  warnEverySeconds: 5,      // orange-tier urgency beep cadence (30/25/20)
  orangeColor: "rgb(255, 155, 40)",
  steadyFlash: true,        // keep the flash colour on odd seconds (no white blink)
  engineFlashHide: 21,      // perceived remaining while muzzling the engine (<20 triggers it)
  enforceRetrySeconds: 2,   // re-send end-turn this often if a player unreadies at zero
  guardianMs: 200,          // takeover sweep interval
  maxProxyLimit: 600,       // pass through bigger phases (age transition = 3000s)
  clockJitterSeconds: 1.0,  // backward clock corrections smaller than this are ignored
  debug: true
};

/** Engine identifiers the timer touches. */
const ENGINE = {
  timerTextId: "action_panel__mp-turntimer",
  segmentType: "TURN_SEGMENT_SINGLEPHASE",
  styleActiveFlash: "screen-turntimer_text_turn_active_flash",
  styleInactive: "screen-turntimer_text_turn_inactive",
  audioUrgency: "turn-timer-countdown"
};

export { TIMER_TYPE, CONFIG, ENGINE };
