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
 * Multiplayer Toolkit - Observer core (in-game scope).
 *
 * Who is watching and who is being watched. Every Observer module no-ops
 * unless isObserverSeat() - other players are untouched.
 */
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { isObserverPlayer } from '../mpt-shared/mpt-util.js';

/** True when this client plays the Observer. */
function isObserverSeat() {
  try { return isObserverPlayer(GameContext.localPlayerID); } catch (e) { return false; }
}

/** Living major players, Observers excluded. */
function watchedPlayers() {
  try { return Players.getAlive().filter((p) => p?.isMajor && !isObserverPlayer(p.id)); }
  catch (e) { return []; }
}

// ============================ Diplomacy snapshot ============================

const SNAPSHOT_TTL_MS = 1000;
let snapshot = null;
let snapshotAt = 0;

/** Groups of ids linked by alliances (union of allied pairs), only groups of two or more. */
function allianceGroups(players, allied) {
  const parent = new Map(players.map((p) => [p.id, p.id]));
  const root = (id) => (parent.get(id) === id ? id : root(parent.get(id)));
  for (const [a, b] of allied) parent.set(root(a), root(b));
  const groups = new Map();
  for (const p of players) {
    const r = root(p.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p.id);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

/**
 * Wars and alliances between watched leaders, recomputed at most once a
 * second (or right after a war or peace): { wars: [[idA, idB]], alliances: [[ids]] },
 * pairs with idA < idB.
 */
function diplomacySnapshot() {
  const now = Date.now();
  if (snapshot && now - snapshotAt < SNAPSHOT_TTL_MS) return snapshot;
  const players = watchedPlayers();
  const wars = [];
  const allied = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const [a, b] = [players[i], players[j]];
      const pair = [a.id, b.id].sort((x, y) => x - y);
      try {
        if (a.Diplomacy?.isAtWarWith?.(b.id)) wars.push(pair);
        else if (a.Diplomacy?.hasAllied?.(b.id)) allied.push(pair);
      } catch (e) { /* skip pair */ }
    }
  }
  snapshot = { wars, alliances: allianceGroups(players, allied) };
  snapshotAt = now;
  return snapshot;
}

for (const event of ['DiplomacyDeclareWar', 'DiplomacyMakePeace', 'DiplomacyRelationshipStatusChanged']) engine.on(event, () => { snapshot = null; });

/** A unit's current base strengths (0 when it has none). */
const meleeStrength = (unit) => unit?.Combat?.getMeleeStrength?.(false) ?? 0;
const rangedStrength = (unit) => Math.max(unit?.Combat?.rangedStrength ?? 0, unit?.Combat?.bombardStrength ?? 0);
const unitStrength = (unit) => Math.max(meleeStrength(unit), rangedStrength(unit));

/** True in any diplomacy screen (leader panel, dialogs, call to arms, peace deal). */
function inDiplomacyMode() {
  try { return /DIPLOMACY|CALL_TO_ARMS|PEACE_DEAL/.test(InterfaceMode.getCurrent() ?? ''); } catch (e) { return false; }
}

/** True in the leader panel itself. */
function inLeaderPanel() {
  try { return /DIPLOMACY_HUB/.test(InterfaceMode.getCurrent() ?? ''); } catch (e) { return false; }
}

export { isObserverPlayer, isObserverSeat, watchedPlayers, diplomacySnapshot, meleeStrength, rangedStrength, unitStrength, inDiplomacyMode, inLeaderPanel };
