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
 * Multiplayer Toolkit - Observer civilizations kept out of civilization lists
 * (in-game scope, every player).
 *
 *   - Age-transition civilization choice: a real leader is never offered an
 *     Observer civilization; the Observer is offered only Observer ones.
 *   - Legacies "Civ Unlocks" tab: Observer civilizations are never listed; for
 *     the Observer, unlock states, current and previous civilization are the
 *     viewed leader's (mp-observer-leader-view.js). Installed through the
 *     model registry's override priority, wrapping the base model.
 */
import { CivUnlocksModel, createCivUnlocksModel } from 'fs://game/core/ui-next/screens/unlocks/civ-unlocks-model.js';
import { ModelRegistry, ModelLifecycle } from 'fs://game/core/ui-next/services/model-registry.js';
import { createLogger, isObserverCiv, OBSERVER_LEADER, wrapMethod } from '../mpt-shared/mpt-util.js';
import { viewedPlayerID } from './mp-observer-leader-view.js';

const log = createLogger('observer-civ-lists');
const CIV_PARAMS = new Set(['PlayerCivilization', 'AgeTransitionPlayerCivilization']);
const MODEL_OVERRIDE_PRIORITY = 1;

// ============================ Age-transition choice ============================

function isObserverLeaderSlot(playerId) {
  try { return Configuration.getPlayer(playerId)?.leaderTypeName === OBSERVER_LEADER; } catch (e) { return false; }
}

/** Civilization choices without the other role's civilizations (Observer vs. real leader). */
function filterCivChoices() {
  wrapMethod(GameSetup, 'findPlayerParameter', (base, playerId, paramName, ...rest) => {
    const param = base(playerId, paramName, ...rest);
    const values = param?.domain?.possibleValues;
    if (!CIV_PARAMS.has(paramName) || !Array.isArray(values)) return param;
    try {
      const observer = isObserverLeaderSlot(playerId);
      const kept = values.filter((v) => isObserverCiv(v.value?.toString()) === observer);
      if (kept.length === 0 || kept.length === values.length) return param;
      return { ...param, domain: { ...param.domain, possibleValues: kept } };
    } catch (e) { return param; }
  });
}

// ============================ Civ Unlocks ============================

const bypassUnlocks = () => Configuration.getGame().getValue('NoCivilizationUnlocks') === true;

/** Lock state and requirement rows of one civilization for one player, as the base model builds them. */
function unlockState(civType, playerId) {
  const reward = GameInfo.UnlockRewards.find((r) => r.UnlockRewardKind === 'KIND_CIVILIZATION' && r.UnlockRewardType === civType);
  if (!reward) return null;
  const progress = Game.Unlocks.getProgressForPlayer(reward.UnlockType, playerId);
  const states = new Map();
  progress?.progress.forEach((p) => states.set(p.requirementSetId, p.state));
  const unlockedBy = GameInfo.UnlockRequirements.filter((r) => r.UnlockType === reward.UnlockType).map((r) => {
    const state = states.get(r.RequirementSetId);
    return { isUnlocked: state == RequirementState.AlwaysMet || state == RequirementState.Met, text: r.Description ?? '', isGameplayUnlock: r.GameplayUnlock };
  });
  unlockedBy.sort((a, b) => Number(b.isUnlocked) - Number(a.isUnlocked) || Number(b.isGameplayUnlock) - Number(a.isGameplayUnlock));
  return { isLocked: bypassUnlocks() ? false : progress ? progress.isUnlocked == false : false, unlockedBy };
}

/** Rewrite the per-player parts of the model for another player. */
function retarget(model, player) {
  const current = GameInfo.Civilizations.lookup(player.civilizationType)?.CivilizationType ?? '';
  const previous = GameInfo.Civilizations.lookup(player.previousAgeCivilizationType)?.CivilizationType ?? '';
  for (const civ of model.civInfo) {
    Object.assign(civ, unlockState(civ.civID, player.id) ?? {});
    civ.isCurrentCiv = civ.civID === current || undefined;
    civ.isPreviousCiv = (!civ.isCurrentCiv && civ.civID === previous) || undefined;
  }
  model.civInfo.sort((a, b) => Number(!a.isPreviousCiv) - Number(!b.isPreviousCiv) || Number(!a.isCurrentCiv) - Number(!b.isCurrentCiv) || Number(a.isLocked) - Number(b.isLocked));
  model.currentCivType = current;
  const leader = GameInfo.Leaders.lookup(player.leaderType);
  if (leader) model.leaderIcon = UI.getIconCSS(leader.LeaderType);
}

function createCivUnlocksModelForView() {
  const model = createCivUnlocksModel();
  if (!Array.isArray(model?.civInfo)) return model;
  try {
    model.civInfo = model.civInfo.filter((civ) => !isObserverCiv(civ.civID));
    const viewed = viewedPlayerID();
    const player = viewed === undefined ? null : Players.get(viewed);
    if (player) retarget(model, player);
  } catch (e) { log(`civ unlocks shaping failed: ${e}`); }
  return model;
}

try {
  filterCivChoices();
  if (CivUnlocksModel) ModelRegistry.register('CivUnlocksModel', ModelLifecycle.SharedInstance, createCivUnlocksModelForView, MODEL_OVERRIDE_PRIORITY);
} catch (e) { log(`install failed: ${e}`); }
