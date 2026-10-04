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
 * Multiplayer Toolkit - Observer yield history (in-game scope).
 *
 * At the start of every turn the Observer records each watched leader's
 * per-turn yields (HISTORY_YIELDS: science, culture, gold, influence, food,
 * production). One sample per turn is kept in the
 * Observer's own player properties - the store the game's UI catalogs use
 * (utility-serialize.js) - which are saved with the game and carried across
 * Age transitions, so the graphs cover the whole game.
 *
 * Sample text: "<age chronology>|<turn>|<playerId>:<v1>,<v2>,...;<playerId>:...".
 */
import { createLogger } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat, watchedPlayers } from './mp-observer-core.js';

const log = createLogger('observer-history');
const KEY_PREFIX = 'MPT_YIELD_HISTORY_';
const COUNT_KEY = `${KEY_PREFIX}COUNT`;
const HISTORY_EVENT = 'mpt-yield-history-changed';

/**
 * Recorded yields in display order; `slot` is the value's position in a
 * sample (new yields take the next slot, so older samples stay readable).
 */
const HISTORY_YIELDS = [
  { id: 'science', slot: 0, yieldType: 'YIELD_SCIENCE', label: 'LOC_MPT_GRAPH_SCIENCE' },
  { id: 'culture', slot: 1, yieldType: 'YIELD_CULTURE', label: 'LOC_MPT_GRAPH_CULTURE' },
  { id: 'gold', slot: 2, yieldType: 'YIELD_GOLD', label: 'LOC_MPT_GRAPH_GOLD' },
  { id: 'influence', slot: 5, yieldType: 'YIELD_DIPLOMACY', label: 'LOC_MPT_GRAPH_INFLUENCE' },
  { id: 'food', slot: 3, yieldType: 'YIELD_FOOD', label: 'LOC_MPT_GRAPH_FOOD' },
  { id: 'production', slot: 4, yieldType: 'YIELD_PRODUCTION', label: 'LOC_MPT_GRAPH_PRODUCTION' }
];
const SLOT_ORDER = [...HISTORY_YIELDS].sort((a, b) => a.slot - b.slot);

let samples = null;   // [{ age, turn, values: Map<playerId, number[]> }], oldest first
let nextIndex = 0;    // property index of the next new sample

const propertyHash = (key) => Database.makeHash(key);
const propertyStore = () => Players.get(GameContext.localPlayerID)?.Tutorial;
const round = (value) => Math.round((Number(value) || 0) * 10) / 10;

function encode({ age, turn, values }) {
  const players = [...values].map(([id, list]) => `${id}:${list.join(',')}`).join(';');
  return `${age}|${turn}|${players}`;
}

function decode(text) {
  const [age, turn, players = ''] = text.split('|');
  const values = new Map();
  for (const entry of players.split(';')) {
    const [id, list] = entry.split(':');
    if (list !== undefined) values.set(Number(id), list.split(',').map(Number));
  }
  return { age: Number(age), turn: Number(turn), values };
}

/** Every recorded sample (read from the save once per session). */
function yieldHistory() {
  if (samples) return samples;
  samples = [];
  const store = propertyStore();
  if (!store) return samples;
  try {
    nextIndex = Number(store.getProperty(propertyHash(COUNT_KEY))) || 0;
    for (let i = 0; i < nextIndex; i++) {
      const text = store.getProperty(propertyHash(KEY_PREFIX + i));
      if (typeof text === 'string' && text) samples.push(decode(text));
    }
  } catch (e) { log(`history read failed: ${e}`); }
  log(`yield history: ${samples.length} turns loaded`);
  return samples;
}

const currentAge = () => GameInfo.Ages.lookup(Game.age)?.ChronologyIndex ?? 0;

/** Records this turn's yields; a turn already recorded (e.g. after a reload) is replaced. */
function recordTurn() {
  const store = propertyStore();
  if (!isObserverSeat() || !store) return;
  const history = yieldHistory();
  const sample = { age: currentAge(), turn: Game.turn, values: new Map() };
  for (const player of watchedPlayers()) {
    sample.values.set(player.id, SLOT_ORDER.map((y) => round(player.Stats?.getNetYield?.(YieldTypes[y.yieldType]))));
  }
  if (sample.values.size === 0) return;
  const last = history[history.length - 1];
  const replace = last?.age === sample.age && last?.turn === sample.turn;
  const index = replace ? nextIndex - 1 : nextIndex;
  try {
    store.setProperty(propertyHash(KEY_PREFIX + index), encode(sample));
    if (!replace) store.setProperty(propertyHash(COUNT_KEY), index + 1);
  } catch (e) { log(`history write failed: ${e}`); return; }
  if (replace) history[history.length - 1] = sample;
  else { history.push(sample); nextIndex = index + 1; }
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
}

const scheduleRecord = () => setTimeout(recordTurn, CONFIG.historyRecordDelayMs);

if (CONFIG.enabled) {
  engine.whenReady.then(() => {
    if (!isObserverSeat()) return;
    engine.on('TurnBegin', scheduleRecord);
    scheduleRecord();
  });
}

export { HISTORY_EVENT, HISTORY_YIELDS, yieldHistory };
