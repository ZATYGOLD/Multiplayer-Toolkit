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
 *   - blocked: the advisor screens (nothing to advise an empire that has none)
 *   - redirected: religion screens -> every leader's pantheon (mp-observer-overview.js)
 * Other players are untouched.
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import PopupSequencer from 'fs://game/base-standard/ui/popup-sequencer/popup-sequencer.js';
import { createLogger, isObserverSeat } from './mp-observer-core.js';
import { OVERVIEW_PANEL_TAG, setOverviewSource } from './mp-observer-overview.js';

const log = createLogger('observer-screens');

const BLOCKED = new Set(['screen-advisor-council', 'advisor-council-popup']);
const REDIRECTS = {
  'screen-pantheon-chooser': 'pantheons',
  'panel-pantheon-complete': 'pantheons',
  'panel-religion-picker': 'pantheons',
  'panel-belief-picker': 'pantheons'
};

function install() {
  const basePush = ContextManager.push.bind(ContextManager);
  ContextManager.push = (target, properties, ...rest) => {
    if (typeof target === 'string' && isObserverSeat()) {
      if (BLOCKED.has(target)) { log(`blocked ${target}`); return null; }
      const source = REDIRECTS[target];
      if (source) {
        setOverviewSource(source);
        log(`${target} -> ${OVERVIEW_PANEL_TAG} (${source})`);
        return basePush(OVERVIEW_PANEL_TAG, { singleton: true, createMouseGuard: true });
      }
    }
    return basePush(target, properties, ...rest);
  };

  // Queued popups never reach the queue, so nothing waits on a screen that will not open.
  const baseRequest = PopupSequencer.addDisplayRequest.bind(PopupSequencer);
  PopupSequencer.addDisplayRequest = (request, ...rest) => {
    if (isObserverSeat() && BLOCKED.has(request?.screenId)) { log(`dropped queued ${request.screenId}`); return request; }
    return baseRequest(request, ...rest);
  };
  log('observer screen routing installed');
}

install();
