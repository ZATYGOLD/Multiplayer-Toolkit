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
 * Multiplayer Toolkit - shared helpers (shell and game scope).
 *
 * Logging, method wrapping, deferred component patching and DOM lookups used
 * by every feature, plus Observer identity (the Observer is a real player
 * whose leader is LEADER_MPT_OBSERVER).
 */
const OBSERVER_LEADER = 'LEADER_MPT_OBSERVER';

/** Logger that reaches UI.log (console.log output does not). */
function createLogger(tag) {
  return (message) => { try { console.warn(`[MPT ${tag}] ${message}`); } catch (e) { /* ignore */ } };
}

/**
 * Replace target[name] with wrapper(base, ...args). The wrapper runs with the
 * call's receiver as `this`, and base calls the original on that receiver, so
 * it works for singletons and prototypes alike.
 */
function wrapMethod(target, name, wrapper) {
  const base = target?.[name];
  if (typeof base !== 'function') return false;
  target[name] = function (...args) { return wrapper.call(this, (...a) => base.apply(this, a), ...args); };
  return true;
}

/** Run callback(definition) once the UI component tag is defined, retrying a bounded number of times. */
function whenDefined(tag, callback, { retries = 50, intervalMs = 200, log = null } = {}) {
  let definition = null;
  try { definition = Controls.getDefinition(tag); } catch (e) { definition = null; }
  if (definition?.createInstance) { callback(definition); return; }
  if (retries > 0) setTimeout(() => whenDefined(tag, callback, { retries: retries - 1, intervalMs, log }), intervalMs);
  else log?.(`${tag} was never defined`);
}

/** The nearest element from el upwards (el included) that matches the test, or null. */
function findAncestor(el, test) {
  for (let node = el; node && typeof node.getAttribute === 'function'; node = node.parentElement) {
    if (test(node)) return node;
  }
  return null;
}

function clearChildren(el) {
  while (el?.firstChild) el.removeChild(el.firstChild);
}

/** Observer by leader; cached per player id (a player's leader is fixed for the life of the UI). */
const observerById = new Map();
function isObserverPlayer(playerId) {
  if (observerById.has(playerId)) return observerById.get(playerId);
  try {
    const leader = GameInfo.Leaders.lookup(Players.get(playerId)?.leaderType);
    if (!leader) return false;   // not resolvable yet: ask again next time
    const observer = leader.LeaderType === OBSERVER_LEADER;
    observerById.set(playerId, observer);
    return observer;
  } catch (e) { return false; }
}

export { OBSERVER_LEADER, clearChildren, createLogger, findAncestor, isObserverPlayer, whenDefined, wrapMethod };
