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
 * Multiplayer Toolkit - Observer's Eye placement (gameplay scripts).
 *
 * Shared by the two base-script overrides that run in the gameplay context:
 * maps/assign-starting-plots.js (new game) and
 * scripts/age-transition-post-load.js (each new Age, where units are reset).
 * The game never places the Observer's starting unit, so the Eye is created
 * here: on open water next to the Ocean / Marine / Ice tile nearest the
 * bottom-center of the map (out of every player's reach), then moved onto the
 * ice - the engine refuses to create a unit on impassable ice (it is left off
 * the map) but accepts the move. Without ice the Eye stays on the nearest
 * open water.
 */
const OBSERVER_LEADER = 'LEADER_MPT_OBSERVER';
const EYE_UNIT = 'UNIT_MPT_OBSERVER_EYE';

const log = (m) => console.log('[MPT observer-eye] ' + m);

function isObserverPlayerId(playerId) {
  try { return GameInfo.Leaders.lookup(Players.get(playerId)?.leaderType)?.LeaderType === OBSERVER_LEADER; }
  catch (e) { return false; }
}

const terrainType = (p) => { try { return GameInfo.Terrains.lookup(GameplayMap.getTerrainType(p.x, p.y))?.TerrainType ?? ''; } catch (e) { return ''; } };
const featureType = (p) => { try { return GameInfo.Features.lookup(GameplayMap.getFeatureType(p.x, p.y))?.FeatureType ?? ''; } catch (e) { return ''; } };
const isWater = (p) => { try { return GameplayMap.isWater(p.x, p.y); } catch (e) { return false; } };
const isIce = (p) => featureType(p) === 'FEATURE_ICE';
const isOceanIce = (p) => isWater(p) && terrainType(p) === 'TERRAIN_OCEAN' && isIce(p);
const isOpenWater = (p) => isWater(p) && !isIce(p);

/** Neighbouring plots of p that match the test. */
function neighbors(p, test) {
  const found = [];
  try {
    for (let dir = 0; dir < DirectionTypes.NUM_DIRECTION_TYPES; dir++) {
      const adj = GameplayMap.getAdjacentPlotLocation({ x: p.x, y: p.y }, dir);
      if (adj && adj.x >= 0 && test(adj)) found.push({ x: adj.x, y: adj.y });
    }
  } catch (e) { /* none */ }
  return found;
}

/** Every plot not in usedPlots, nearest the bottom-center of the map first (row 0 is the bottom). */
function plotsFromBottomCenter(usedPlots) {
  const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
  const cx = Math.floor(w / 2);
  const plots = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const index = y * w + x;
    if (!usedPlots.has(index)) plots.push({ x, y, index, d: Math.abs(x - cx) + y });
  }
  return plots.sort((a, b) => a.d - b.d);
}

/** { start, water }: the Eye's tile (the ice) and where it is created; the start plot is added to usedPlots. Null without water. */
function observerPlots(usedPlots) {
  const plots = plotsFromBottomCenter(usedPlots);
  const ice = plots.find((p) => isOceanIce(p) && neighbors(p, isOpenWater).length > 0);
  const start = ice ?? plots.find(isOpenWater);
  if (!start) return null;
  usedPlots.add(start.index);
  return { start, water: ice ? neighbors(ice, isOpenWater)[0] : start };
}

const onPlot = (unitId, p) => { const loc = Units.get(unitId)?.location; return !!loc && loc.x === p.x && loc.y === p.y; };

/** Create the Eye on the water, then move it onto the start plot (the ice). */
function createObserverEye(playerId, { start, water }) {
  const type = GameInfo.Units.lookup(EYE_UNIT)?.$hash ?? Database.makeHash(EYE_UNIT);
  let result = Units.create(playerId, { Type: type, Location: { x: water.x, y: water.y }, Validate: true });
  if (!result?.Success) result = Units.create(playerId, { Type: type, Location: { x: water.x, y: water.y }, Validate: false });
  if (!result?.Success || !result.ID) { log(`player ${playerId}: eye could not be created`); return; }
  if (!onPlot(result.ID, water)) Units.setLocation(result.ID, { x: water.x, y: water.y });
  if (start.x !== water.x || start.y !== water.y) {
    Units.setLocation(result.ID, { x: start.x, y: start.y });
    if (!onPlot(result.ID, start)) Units.setLocation(result.ID, { x: water.x, y: water.y });
  }
  const loc = Units.get(result.ID)?.location;
  log(`player ${playerId}: eye at (${loc?.x},${loc?.y})`);
}

function hasEye(playerId) {
  const eyeType = GameInfo.Units.lookup(EYE_UNIT)?.$hash;
  return (Players.get(playerId)?.Units?.getUnits?.() ?? []).some((u) => u.type === eyeType);
}

/** Give every living Observer without an Eye a new one (after an Age transition resets units). */
function placeObserverEyes() {
  const usedPlots = new Set();
  for (const playerId of Players.getAliveMajorIds()) {
    if (!isObserverPlayerId(playerId) || hasEye(playerId)) continue;
    try {
      const plots = observerPlots(usedPlots);
      if (plots) createObserverEye(playerId, plots);
      else log(`player ${playerId}: no water for the eye`);
    } catch (e) { log(`eye placement failed for ${playerId}: ${e}`); }
  }
}

export { createObserverEye, isObserverPlayerId, observerPlots, placeObserverEyes };
