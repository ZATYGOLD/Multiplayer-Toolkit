/*
 * Zatygold's Observer Mode - a playable Observer for multiplayer Civilization VII.
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
 * Zatygold's Observer Mode - Observer screen routing (in-game scope).
 *
 * Every screen opens through ContextManager.push (popups first pass through
 * the PopupSequencer queue). For the Observer seat:
 *   - blocked: the advisor screens (there is no empire to advise) and the
 *     Age-start dedication / advanced-start screens (mp-observer-prompts.js
 *     completes that step for the Observer);
 *   - redirected: the Antiquity pantheon screens open every leader's
 *     pantheons (mp-observer-overview.js); the religion picker opens the
 *     game's religion and belief screen, where the Observer picks a leader
 *     (mp-observer-leader-view.js); the tech and civic choosers open the
 *     full trees (mp-observer-leader-screens.js).
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import PopupSequencer from 'fs://game/base-standard/ui/popup-sequencer/popup-sequencer.js';
import { wrapMethod } from '../zom-shared/zom-util.js';
import { isObserverSeat } from './mp-observer-core.js';
import { CHOOSER_TAGS, openFullTree } from './mp-observer-leader-screens.js';
import { OVERVIEW_PANEL_TAG, setOverviewSource } from './mp-observer-overview.js';

const BLOCKED = new Set(['screen-advisor-council', 'advisor-council-popup', 'screen-dedication-selection', 'screen-advanced-start']);
const OVERVIEW_PROPS = { singleton: true, createMouseGuard: true };
/** Screen -> what opens instead: an overview source, or another screen. */
const REDIRECTS = {
  'screen-pantheon-chooser': { overview: 'pantheons' },
  'panel-pantheon-complete': { overview: 'pantheons' },
  'panel-religion-picker': { screen: 'panel-belief-picker' }
};

wrapMethod(ContextManager, 'push', (base, target, ...rest) => {
  if (typeof target !== 'string' || !isObserverSeat()) return base(target, ...rest);
  if (BLOCKED.has(target)) return null;
  if (CHOOSER_TAGS.has(target) && openFullTree(target)) return null;
  const redirect = REDIRECTS[target];
  if (!redirect) return base(target, ...rest);
  if (redirect.screen) return base(redirect.screen, ...rest);
  setOverviewSource(redirect.overview);
  return base(OVERVIEW_PANEL_TAG, OVERVIEW_PROPS);
});

// Blocked popups never enter the queue, so nothing waits on a screen that will not open.
wrapMethod(PopupSequencer, 'addDisplayRequest', (base, request, ...rest) =>
  (isObserverSeat() && BLOCKED.has(request?.screenId) ? request : base(request, ...rest)));
