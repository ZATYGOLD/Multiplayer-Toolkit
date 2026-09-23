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
 * Multiplayer Toolkit - observer Escape / pause-menu enabler (0.5.6).
 *
 * Testers found that as an observer the Escape menu never opens - only alt+F4
 * quits. The engine's own gate (ContextManager.canOpenPauseMenu) does NOT block
 * observers; the problem is upstream: the HUD bring-up that registers the Escape
 * handler dereferences the (cleared) local player and aborts, so the handler is
 * never attached. We register our own capturing handler that opens the pause
 * menu on Escape / controller Start, restoring the menu (and with it the mod's
 * multiplayer pause controls and a clean quit).
 *
 * Gated to an observer CLIENT so a seated player - whose native handler works -
 * is never double-handled; we capture first and stop propagation for observers.
 */
import { CONFIG } from './mp-observer-config.js';
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';

const PAUSE_MENU_MODE = 'INTERFACEMODE_PAUSE_MENU';

function log(m) { if (CONFIG.debug) { try { console.log('[MPT observer-menu] ' + m); } catch (e) {} } }

/** True when THIS client's own slot is an observer. */
function isObserverClient() {
  try {
    const pc = Configuration.getPlayer(GameContext.localPlayerID);
    if (pc && pc.isObserver) return true;
  } catch (e) { /* fall through */ }
  try { return GameContext.localObserverID === PlayerIds.OBSERVER_ID; } catch (e) { return false; }
}

function inPauseMenu() {
  try { return InterfaceMode.isInInterfaceMode(PAUSE_MENU_MODE); } catch (e) { return false; }
}

function onInput(ev) {
  try {
    if (!isObserverClient()) return;
    const d = ev?.detail;
    if (!d || d.status !== InputActionStatuses.FINISH) return;
    if (d.name !== 'keyboard-escape' && d.name !== 'sys-menu') return;
    if (inPauseMenu()) { InterfaceMode.switchToDefault?.(); }
    else { InterfaceMode.switchTo(PAUSE_MENU_MODE); }
    ev.stopPropagation();
    ev.preventDefault();
  } catch (e) { /* ignore */ }
}

engine.whenReady.then(() => {
  // Capturing so we run before (absent) native handling; gated per-event.
  window.addEventListener('engine-input', onInput, true);
  log(isObserverClient() ? 'Escape -> pause menu enabled for observer' : 'not an observer - menu handler idle');
});

export default { onInput };
