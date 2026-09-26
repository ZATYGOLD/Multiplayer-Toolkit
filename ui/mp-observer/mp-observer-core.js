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
 * Multiplayer Toolkit - shared Observer helpers (in-game scope).
 * The Observer is a real player whose leader is LEADER_MPT_OBSERVER.
 */
const OBSERVER_LEADER = 'LEADER_MPT_OBSERVER';

/** Logger that reaches UI.log (console.log output does not). */
function createLogger(tag) {
  return (message) => { try { console.warn(`[MPT ${tag}] ${message}`); } catch (e) { /* ignore */ } };
}

function isObserverPlayer(playerId) {
  try {
    const p = Players.get(playerId);
    return !!p && GameInfo.Leaders.lookup(p.leaderType)?.LeaderType === OBSERVER_LEADER;
  } catch (e) { return false; }
}

/** True when this client plays the Observer. */
function isObserverSeat() {
  try { return isObserverPlayer(GameContext.localPlayerID); } catch (e) { return false; }
}

/** Living major players, Observers excluded. */
function watchedPlayers() {
  try { return Players.getAlive().filter((p) => p?.isMajor && !isObserverPlayer(p.id)); }
  catch (e) { return []; }
}

/** Every pair of watched leaders at war with each other, as [idA, idB] with idA < idB. */
function warPairs() {
  const players = watchedPlayers();
  const pairs = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      try { if (players[i].Diplomacy?.isAtWarWith?.(players[j].id)) pairs.push([players[i].id, players[j].id].sort((a, b) => a - b)); }
      catch (e) { /* skip pair */ }
    }
  }
  return pairs;
}

export { OBSERVER_LEADER, createLogger, isObserverPlayer, isObserverSeat, watchedPlayers, warPairs };
