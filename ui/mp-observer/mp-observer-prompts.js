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
 *   - narrative events (crises included) never open; the pending story is
 *     answered with its first available choice, so nothing waits on it;
 *   - the end-of-age countdown popup never opens;
 *   - diplomacy dialogs addressed to the Observer never open; their session
 *     is closed, as the dialog's own buttons do;
 *   - first meetings are answered with the neutral greeting (the game waits
 *     on that answer before the turn can end);
 *   - crisis, age-progress, "player met" and agenda notifications are dismissed.
 * Other players are untouched.
 */
import { DisplayQueueManager } from 'fs://game/core/ui/context-manager/display-queue-manager.js';
import AgeProgressionPopupManager from 'fs://game/base-standard/ui/age-progression-warning-popup/age-progression-warning-popup-manager.js';
import { NarrativePopupManager } from 'fs://game/base-standard/ui/narrative-event/narrative-popup-manager.js';
import { DiplomacyDialogManagerImpl } from 'fs://game/base-standard/ui/diplomacy/diplomacy-manager.js';
import { createLogger, isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-prompts');
const SILENCED_NOTIFICATIONS = /^NOTIFICATION_(CRISIS|AGE_(EARLY|LATE|VERY_LATE)_PROGRESS|AGE_PROGRESSION_|AGE_EXTENDED|PLAYER_MET|DIPLOMATIC_ACTION_AGENDA)/;
const STORY_NOTIFICATIONS = /STORY_DIRECTION$/;
const STORY_RETRY_MS = 1500;
const SWEEP_DELAY_MS = 500;

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

/** Answer the Observer's next pending story (one per call; the engine applies it asynchronously). */
function answerPendingStory() {
  if (!isObserverSeat()) return;
  try {
    const stories = Players.get(GameContext.localPlayerID)?.Stories;
    const storyId = stories?.getFirstPendingMetId?.() || stories?.getFirstPendingDiscoveryLastMetID?.();
    if (!storyId || storyId === lastAnsweredStory) return;
    for (const key of storyChoices(stories, storyId)) {
      const args = { TargetType: key, Target: storyId, Action: PlayerOperationParameters.Activate };
      if (!Game.PlayerOperations.canStart(GameContext.localPlayerID, PlayerOperationTypes.CHOOSE_NARRATIVE_STORY_DIRECTION, args, false)?.Success) continue;
      Game.PlayerOperations.sendRequest(GameContext.localPlayerID, PlayerOperationTypes.CHOOSE_NARRATIVE_STORY_DIRECTION, args);
      lastAnsweredStory = storyId;
      log(`story ${storyId} answered with ${key}`);
      setTimeout(answerPendingStory, STORY_RETRY_MS);   // the next pending story, if any
      return;
    }
    log(`story ${storyId}: no available choice`);
  } catch (e) { log(`story answer failed: ${e}`); }
}

// ============================ First meetings ============================

const answeredMeets = new Set();

/** Answer every pending first meeting with the neutral greeting (once per leader). */
function answerFirstMeets() {
  if (!isObserverSeat()) return;
  const me = GameContext.localPlayerID;
  for (const id of Players.getAliveIds()) {
    if (id === me || answeredMeets.has(id)) continue;
    try {
      const args = { Player1: me, Player2: id, Type: DiplomacyPlayerFirstMeets.PLAYER_REALATIONSHIP_FIRSTMEET_NEUTRAL };
      if (!Game.PlayerOperations.canStart(me, PlayerOperationTypes.RESPOND_DIPLOMATIC_FIRST_MEET, args, false)?.Success) continue;
      Game.PlayerOperations.sendRequest(me, PlayerOperationTypes.RESPOND_DIPLOMATIC_FIRST_MEET, args);
      answeredMeets.add(id);
      log(`first meeting with player ${id} answered`);
    } catch (e) { log(`first meeting answer failed: ${e}`); }
  }
}

// ============================ Notifications ============================

function notificationType(id) {
  const type = Game.Notifications.getType(id);
  return GameInfo.Notifications.lookup(type)?.NotificationType ?? Game.Notifications.getTypeName(type) ?? '';
}

/** Dismiss silenced notifications and answer what the others wait on. */
function sweepNotifications() {
  if (!isObserverSeat()) return;
  answerFirstMeets();
  for (const id of Game.Notifications.getIdsForPlayer(GameContext.localPlayerID) ?? []) {
    try {
      const type = notificationType(id);
      if (STORY_NOTIFICATIONS.test(type)) { answerPendingStory(); continue; }
      if (!SILENCED_NOTIFICATIONS.test(type)) continue;
      if (Game.Notifications.canUserDismissNotification(id)) {
        Game.Notifications.dismiss(id);
        log(`dismissed ${type}`);
      }
    } catch (e) { log(`notification handling failed: ${e}`); }
  }
}

let sweepQueued = false;
function queueSweep() {
  if (sweepQueued) return;
  sweepQueued = true;
  setTimeout(() => { sweepQueued = false; sweepNotifications(); }, SWEEP_DELAY_MS);
}

// ============================ Popups ============================

function patchPopups() {
  const baseRaise = NarrativePopupManager.raiseNotificationPanel.bind(NarrativePopupManager);
  NarrativePopupManager.raiseNotificationPanel = (...args) => {
    if (!isObserverSeat()) return baseRaise(...args);
    answerPendingStory();
    return false;
  };

  const baseShow = AgeProgressionPopupManager.show.bind(AgeProgressionPopupManager);
  AgeProgressionPopupManager.show = (request, ...rest) => {
    if (!isObserverSeat()) return baseShow(request, ...rest);
    setTimeout(() => DisplayQueueManager.close(request), 0);   // release the queue without showing
    log('age countdown popup skipped');
  };

  const dialogProto = DiplomacyDialogManagerImpl.prototype;
  const baseDialog = dialogProto.show;
  dialogProto.show = function (request, ...rest) {
    if (!isObserverSeat()) return baseDialog.call(this, request, ...rest);
    answerFirstMeets();
    try { Game.DiplomacySessions.closeSession(request.SessionID); } catch (e) { log(`close session failed: ${e}`); }
    setTimeout(() => DisplayQueueManager.close(request), 0);
    log(`diplomacy dialog from player ${request?.OtherPlayerID} skipped`);
    queueSweep();
  };
}

engine.whenReady.then(() => {
  patchPopups();
  engine.on('NotificationAdded', (data) => { if (data?.id?.owner == GameContext.localPlayerID) queueSweep(); });
  engine.on('LocalPlayerTurnBegin', () => { answerPendingStory(); queueSweep(); });
  answerPendingStory();
  queueSweep();
  log('observer prompt filtering installed');
});
