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
 * Multiplayer Toolkit - Observer victory lists (in-game scope, every client).
 *
 * Observers are never listed on the Victories screens (Summary, each victory
 * path, Score) or in the age rankings: the base VictoryManager's results are
 * filtered after each rebuild. The Victories screen model itself is a base-file
 * override (ui-next/screens/victories/victories-screen-model.js).
 */
import VictoryManager from 'fs://game/base-standard/ui/victory-manager/victory-manager.js';
import { createLogger, isObserverPlayer, wrapMethod } from '../mpt-shared/mpt-util.js';

const log = createLogger('observer-victory');
const proto = Object.getPrototypeOf(VictoryManager);

wrapMethod(proto, 'processVictoryData', function (base, ...args) {
  const result = base(...args);
  try {
    this.victoryEnabledPlayers = (this.victoryEnabledPlayers ?? []).filter((id) => !isObserverPlayer(id));
    for (const list of this.processedVictoryData?.values?.() ?? []) {
      for (const victory of list) victory.playerData = victory.playerData.filter((d) => !isObserverPlayer(d.playerID));
    }
  } catch (e) { log(`victory filter failed: ${e}`); }
  return result;
});

wrapMethod(proto, 'processScoreData', function (base, ...args) {
  const result = base(...args);
  try { this.processedScoreData = (this.processedScoreData ?? []).filter((d) => !isObserverPlayer(d.playerID)); }
  catch (e) { log(`score filter failed: ${e}`); }
  return result;
});
