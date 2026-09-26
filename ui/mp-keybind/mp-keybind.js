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
 * Multiplayer Toolkit - Pause keybind in the keyboard-mapping options (shell and game scope).
 *
 * The keyboard-mapping screen only lists the action IDs in a hard-coded,
 * non-exported array in the game's editor-keyboard-mapping.js, so the pause
 * action registered by config/mpt-input.sql would not appear there. The
 * editor is patched to list it, so it can be rebound like any built-in key.
 * Loaded in both scopes: the screen opens from the main menu and in game.
 */
import { createLogger, whenDefined, wrapMethod } from '../mpt-shared/mpt-util.js';

const log = createLogger('keybind');
const EDITOR_TAG = 'editor-keyboard-mapping';
const PAUSE_ACTION_ID = 'mpt-pause-game';

whenDefined(EDITOR_TAG, (definition) => {
  const proto = definition.createInstance.prototype;
  if (proto.mptKeybindPatched) return;
  proto.mptKeybindPatched = true;
  wrapMethod(proto, 'addActionsForContext', function (base, inputContext, ...rest) {
    const result = base(inputContext, ...rest);
    try {
      const actionId = Input.getActionIdByName(PAUSE_ACTION_ID);
      if (actionId && !this.mappingDataMap.has(actionId) && this.actionContainer) {
        this.actionContainer.appendChild(this.createActionEntry(actionId, inputContext));
      }
    } catch (e) { /* leave the base list intact */ }
    return result;
  });
}, { retries: 50, intervalMs: 300, log });

export { PAUSE_ACTION_ID };
