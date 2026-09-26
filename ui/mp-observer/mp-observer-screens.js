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
 * Multiplayer Toolkit - Observer screen routing (in-game scope).
 *
 * Every screen opens through ContextManager.push (popups first pass through
 * the PopupSequencer queue). For the Observer seat:
 *   - blocked: the advisor screens (there is no empire to advise);
 *   - redirected: religion screens open every leader's pantheon
 *     (mp-observer-overview.js).
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import PopupSequencer from 'fs://game/base-standard/ui/popup-sequencer/popup-sequencer.js';
import { wrapMethod } from '../mpt-shared/mpt-util.js';
import { isObserverSeat } from './mp-observer-core.js';
import { OVERVIEW_PANEL_TAG, setOverviewSource } from './mp-observer-overview.js';

const BLOCKED = new Set(['screen-advisor-council', 'advisor-council-popup']);
const REDIRECTS = {
  'screen-pantheon-chooser': 'pantheons',
  'panel-pantheon-complete': 'pantheons',
  'panel-religion-picker': 'pantheons',
  'panel-belief-picker': 'pantheons'
};

wrapMethod(ContextManager, 'push', (base, target, ...rest) => {
  if (typeof target !== 'string' || !isObserverSeat()) return base(target, ...rest);
  if (BLOCKED.has(target)) return null;
  if (!REDIRECTS[target]) return base(target, ...rest);
  setOverviewSource(REDIRECTS[target]);
  return base(OVERVIEW_PANEL_TAG, { singleton: true, createMouseGuard: true });
});

// Blocked popups never enter the queue, so nothing waits on a screen that will not open.
wrapMethod(PopupSequencer, 'addDisplayRequest', (base, request, ...rest) =>
  (isObserverSeat() && BLOCKED.has(request?.screenId) ? request : base(request, ...rest)));
