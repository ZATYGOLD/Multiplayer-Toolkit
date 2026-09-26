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
 * Multiplayer Toolkit - Observer players are never listed on the Victories
 * screens (Summary, each victory path, Score) or in the age rankings, on any
 * client. The base VictoryManager builds those lists; its results are
 * filtered after each rebuild.
 */
import VictoryManager from 'fs://game/base-standard/ui/victory-manager/victory-manager.js';
import { createLogger, isObserverPlayer } from './mp-observer-core.js';

const log = createLogger('observer-victory');

function install() {
  const proto = Object.getPrototypeOf(VictoryManager);
  const baseVictory = proto.processVictoryData;
  const baseScore = proto.processScoreData;
  if (typeof baseVictory !== 'function' || typeof baseScore !== 'function') { log('victory manager unavailable'); return; }

  proto.processVictoryData = function (...args) {
    const result = baseVictory.apply(this, args);
    try {
      this.victoryEnabledPlayers = (this.victoryEnabledPlayers ?? []).filter((id) => !isObserverPlayer(id));
      for (const list of this.processedVictoryData?.values?.() ?? []) {
        for (const victory of list) victory.playerData = victory.playerData.filter((d) => !isObserverPlayer(d.playerID));
      }
    } catch (e) { log(`victory filter failed: ${e}`); }
    return result;
  };
  proto.processScoreData = function (...args) {
    const result = baseScore.apply(this, args);
    try { this.processedScoreData = (this.processedScoreData ?? []).filter((d) => !isObserverPlayer(d.playerID)); }
    catch (e) { log(`score filter failed: ${e}`); }
    return result;
  };
  log('observer excluded from victory lists');
}

install();
