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
 * Multiplayer Toolkit - Observer prompts (in-game scope).
 *
 * The Observer is a real player, so the game also sends it the prompts meant
 * for an empire. For the Observer seat:
 *   - narrative events (crises included) never open; each pending story is
 *     answered with its first available choice, so nothing waits on it;
 *   - first meetings are answered with the neutral greeting (the turn cannot
 *     end until they are);
 *   - diplomacy dialogs addressed to the Observer never open; their session
 *     is closed, as the dialog's own buttons do;
 *   - the end-of-age countdown popup never opens;
 *   - crisis, age-progress, "player met" and agenda notifications are dismissed.
 */
import { DisplayQueueManager } from 'fs://game/core/ui/context-manager/display-queue-manager.js';
import AgeProgressionPopupManager from 'fs://game/base-standard/ui/age-progression-warning-popup/age-progression-warning-popup-manager.js';
import { NarrativePopupManager } from 'fs://game/base-standard/ui/narrative-event/narrative-popup-manager.js';
import { DiplomacyDialogManagerImpl } from 'fs://game/base-standard/ui/diplomacy/diplomacy-manager.js';
import { createLogger, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-prompts');
const debug = CONFIG.debug ? log : () => {};
const SILENCED_NOTIFICATIONS = /^NOTIFICATION_(CRISIS|AGE_(EARLY|LATE|VERY_LATE)_PROGRESS|AGE_PROGRESSION_|AGE_EXTENDED|PLAYER_MET|DIPLOMATIC_ACTION_AGENDA)/;
const STORY_NOTIFICATIONS = /STORY_DIRECTION$/;
const STORY_RETRY_MS = 1500;
const SWEEP_DELAY_MS = 500;

/** Send a player operation for the Observer if the engine allows it. */
function tryOperation(type, args) {
  const me = GameContext.localPlayerID;
  if (!Game.PlayerOperations.canStart(me, type, args, false)?.Success) return false;
  Game.PlayerOperations.sendRequest(me, type, args);
  return true;
}

/** Close a display request without showing it (after the current show call returns). */
const skipDisplay = (request) => setTimeout(() => DisplayQueueManager.close(request), 0);

// ============================ Narrative stories ============================

let lastAnsweredStory = null;

/** Choice keys for a pending story, in the order the narrative screen lists them. */
function storyChoices(stories, storyId) {
  const def = GameInfo.NarrativeStories.lookup(stories.find(storyId)?.type);
  if (!def) return ['CLOSE'];
  const links = def.VariableLinks
    ? (stories.getOrderedLinks(storyId) ?? [])
    : GameInfo.NarrativeStory_Links.filter((l) => l.FromNarrativeStoryType == def.NarrativeStoryType).map((l) => l.ToNarrativeStoryType);
  return [...links, 'CLOSE'];
}

/** Answer the next pending story (one per call; the engine applies it asynchronously). */
function answerPendingStory() {
  if (!isObserverSeat()) return;
  try {
    const stories = Players.get(GameContext.localPlayerID)?.Stories;
    const storyId = stories?.getFirstPendingMetId?.() || stories?.getFirstPendingDiscoveryLastMetID?.();
    if (!storyId || storyId === lastAnsweredStory) return;
    const answered = storyChoices(stories, storyId).find((key) =>
      tryOperation(PlayerOperationTypes.CHOOSE_NARRATIVE_STORY_DIRECTION, { TargetType: key, Target: storyId, Action: PlayerOperationParameters.Activate }));
    if (!answered) { log(`story ${storyId}: no available choice`); return; }
    lastAnsweredStory = storyId;
    debug(`story ${storyId} answered with ${answered}`);
    setTimeout(answerPendingStory, STORY_RETRY_MS);   // the next pending story, if any
  } catch (e) { log(`story answer failed: ${e}`); }
}

// ============================ First meetings ============================

const answeredMeets = new Set();

function answerFirstMeets() {
  const me = GameContext.localPlayerID;
  for (const id of Players.getAliveIds()) {
    if (id === me || answeredMeets.has(id)) continue;
    try {
      if (!tryOperation(PlayerOperationTypes.RESPOND_DIPLOMATIC_FIRST_MEET, { Player1: me, Player2: id, Type: DiplomacyPlayerFirstMeets.PLAYER_REALATIONSHIP_FIRSTMEET_NEUTRAL })) continue;
      answeredMeets.add(id);
      debug(`first meeting with player ${id} answered`);
    } catch (e) { log(`first meeting answer failed: ${e}`); }
  }
}

// ============================ Notifications ============================

function notificationType(id) {
  const type = Game.Notifications.getType(id);
  return GameInfo.Notifications.lookup(type)?.NotificationType ?? Game.Notifications.getTypeName(type) ?? '';
}

/** Answer what the game waits on and dismiss silenced notifications. */
function sweep() {
  if (!isObserverSeat()) return;
  answerFirstMeets();
  for (const id of Game.Notifications.getIdsForPlayer(GameContext.localPlayerID) ?? []) {
    try {
      const type = notificationType(id);
      if (STORY_NOTIFICATIONS.test(type)) answerPendingStory();
      else if (SILENCED_NOTIFICATIONS.test(type) && Game.Notifications.canUserDismissNotification(id)) Game.Notifications.dismiss(id);
    } catch (e) { log(`notification handling failed: ${e}`); }
  }
}

let sweepQueued = false;
function queueSweep() {
  if (sweepQueued) return;
  sweepQueued = true;
  setTimeout(() => { sweepQueued = false; sweep(); }, SWEEP_DELAY_MS);
}

// ============================ Popups ============================

function patchPopups() {
  wrapMethod(NarrativePopupManager, 'raiseNotificationPanel', (base, ...args) => {
    if (!isObserverSeat()) return base(...args);
    answerPendingStory();
    return false;
  });
  wrapMethod(AgeProgressionPopupManager, 'show', (base, request, ...rest) => {
    if (!isObserverSeat()) return base(request, ...rest);
    skipDisplay(request);
  });
  wrapMethod(DiplomacyDialogManagerImpl.prototype, 'show', (base, request, ...rest) => {
    if (!isObserverSeat()) return base(request, ...rest);
    answerFirstMeets();
    try { Game.DiplomacySessions.closeSession(request.SessionID); } catch (e) { log(`close session failed: ${e}`); }
    skipDisplay(request);
    queueSweep();
  });
}

patchPopups();
engine.on('NotificationAdded', (data) => { if (data?.id?.owner == GameContext.localPlayerID) queueSweep(); });
engine.on('LocalPlayerTurnBegin', () => { answerPendingStory(); queueSweep(); });
engine.whenReady.then(() => { answerPendingStory(); queueSweep(); });
