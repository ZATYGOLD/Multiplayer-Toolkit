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
 */

/** TurnTimers row registered by config/SetupParameters.sql. */
const TIMER_TYPE = "MPT_TURNTIMER_COMPETITIVE";

/** Tunable timings / thresholds. */
const CONFIG = {
  firstTimedTurn: 2,        // grace: the first (firstTimedTurn - 1) turn(s) of each session are untimed (found capital, pick research)
  minPlayersToEnforce: 1,   // only force-end turns with at least this many living human players, Observers excluded (2 = never in solo games)
  roundToNearest: 1,        // round the computed total to the nearest multiple (1 = whole seconds)
  orangeStart: 30,          // orange tier begins at this many seconds remaining
  flashStart: 15,           // red flash + per-second beeps begin here
  warnEverySeconds: 5,      // orange-tier urgency beep cadence (30/25/20)
  orangeColor: "rgb(255, 155, 40)",
  steadyFlash: true,        // keep the flash colour on odd seconds (no white blink)
  engineFlashHide: 21,      // perceived remaining while muzzling the engine (<20 triggers it)
  guardianMs: 200,          // enforcement sweep interval
  staleEventMs: 1200,       // timer events silent this long (a panel is open): the sweep takes over the beeps
  maxUnitSkips: 40,         // units skipped per sweep when idle units block the end of the turn
  maxProxyLimit: 600,       // pass through bigger phases (age transition = 3000s)
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
