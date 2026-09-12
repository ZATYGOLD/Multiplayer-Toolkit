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
 * Multiplayer Toolkit - Keybind editor injection.
 *
 * The keyboard-mapping options screen only lists the action IDs in a hardcoded
 * (non-exported) KEYS_TO_ADD array inside the game's editor-keyboard-mapping.js,
 * so a mod-registered action does not appear there on its own. This patches the
 * editor panel to also list our pause action (registered by config/mpt-input.sql)
 * so it shows up and can be rebound like any built-in keybind.
 *
 * Loaded in both shell and game scope, since the keyboard-mapping screen can be
 * opened from the main menu and the in-game pause menu.
 */
const EDITOR_TAG = 'editor-keyboard-mapping';
const ACTION_ID = 'mpt-pause-game';
const RETRY_MS = 300;
const RETRIES = 50;

function log(message) {
  console.log(`[MPT keybind] ${message}`);
}

function patchEditor(attempts) {
  let def = null;
  try { def = Controls.getDefinition(EDITOR_TAG); } catch (e) { def = null; }
  if (!def?.createInstance) {
    if (attempts > 0) setTimeout(() => patchEditor(attempts - 1), RETRY_MS);
    return;
  }
  const EditorClass = def.createInstance;
  if (EditorClass.prototype.mptKeybindPatched) return;
  EditorClass.prototype.mptKeybindPatched = true;

  const baseAddActions = EditorClass.prototype.addActionsForContext;
  EditorClass.prototype.addActionsForContext = function (inputContext) {
    baseAddActions.call(this, inputContext);
    try {
      const actionId = Input.getActionIdByName(ACTION_ID);
      if (actionId && !this.mappingDataMap.has(actionId) && this.actionContainer) {
        this.actionContainer.appendChild(this.createActionEntry(actionId, inputContext));
      }
    } catch (e) { /* leave the base list intact */ }
  };
  log('keyboard-mapping editor patched to list the pause action');
}

patchEditor(RETRIES);
