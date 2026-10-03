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
 * Multiplayer Toolkit - Observer HUD and camera (in-game scope).
 *
 * For the Observer seat:
 *   - one zoom axis from CONFIG.zoomIn closer than the game allows to
 *     CONFIG.zoomOut further out, in smaller steps (CONFIG.zoomStepScale) for
 *     a smoother scroll. The engine clamps its zoom to 0..1, so past either
 *     end the camera's field of view is narrowed or widened instead (the
 *     technique of the Zoom+ mod, reduced to its core); the view is re-applied
 *     while the camera moves, since the engine may reset it. Left to Zoom+
 *     when that mod's camera controller is installed;
 *   - the notification bar is drawn at CONFIG.notificationScale.
 */
import CameraController from 'fs://game/core/ui/camera/camera-controller.js';
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import ViewManager from 'fs://game/core/ui/views/view-manager.js';
import { createLogger, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat } from './mp-observer-core.js';

const log = createLogger('observer-hud');
const ZOOM_RATE = 0.3;              // camera-controller.js zoomRate
const DEFAULT_FOV = 45;             // degrees, if the camera does not report its own
const FOV_KEYS = ['verticalFoV', 'verticalFov', 'fov', 'FoV', 'fieldOfView'];
const FOV_HOLD_MS = 250;            // re-apply interval while the view is widened or narrowed
const STYLE_ID = 'mpt-observer-hud-style';

// ============================ Camera ============================

let baseFov = null;
let reportedFov = false;            // one diagnostic line per session (CONFIG.debug)
let zoom = null;                    // -zoomIn .. 1 + zoomOut; 0..1 is the game's own range
let holdTimer = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function readFov() {
  try {
    const state = Camera.getState();
    for (const key of FOV_KEYS) if (Number.isFinite(state?.[key])) return state[key];
  } catch (e) { /* not reported */ }
  return null;
}

/** Share of the normal view width shown at this zoom (1 inside the game's range). */
const viewScale = (z) => (z > 1 ? z : z < 0 ? 1 + z : 1);

function fovFor(z) {
  const half = (baseFov * Math.PI) / 360;
  return (2 * Math.atan(viewScale(z) * Math.tan(half)) * 180) / Math.PI;
}

function applyFov() {
  const wanted = fovFor(zoom);
  try { Camera.setVerticalFoV(wanted); }
  catch (e) { log(`field of view not settable: ${e}`); return; }
  if (CONFIG.debug && !reportedFov && viewScale(zoom) !== 1) {
    reportedFov = true;
    log(`zoom ${zoom.toFixed(2)}: field of view ${baseFov.toFixed(1)} -> ${wanted.toFixed(1)}, camera reports ${readFov() ?? 'nothing'}`);
  }
}

/** Keep a widened / narrowed view applied while the camera moves; stop inside the normal range. */
function holdFov() {
  clearInterval(holdTimer);
  holdTimer = viewScale(zoom) === 1 ? null : setInterval(() => {
    const current = readFov();
    if (current === null || Math.abs(current - fovFor(zoom)) > 0.05) applyFov();
  }, FOV_HOLD_MS);
}

/** The current position on the zoom axis; follows the game's zoom when something else moved it. */
function currentZoom() {
  const native = Camera.getState().zoomLevel;
  const inside = zoom === null || viewScale(zoom) === 1;
  const nativeAtEnd = zoom > 1 ? native >= 0.999 : native <= 0.001;
  return inside || !nativeAtEnd ? native : zoom;
}

/** One zoom input along the single axis; true when handled (the base zoom must not run). */
let reportedInput = false;

function zoomBy(direction, status, x) {
  if (CONFIG.debug && !reportedInput) { reportedInput = true; log(`first zoom input: world input ${ViewManager.isWorldInputAllowed ? 'allowed' : 'blocked'}, zoom ${Camera.getState().zoomLevel}`); }
  if (!isObserverSeat() || !ViewManager.isWorldInputAllowed) return false;
  if (typeof Camera.setVerticalFoV !== 'function') {
    if (!reportedFov) { reportedFov = true; log('Camera.setVerticalFoV is not available: the game zoom range is kept'); }
    return false;
  }
  const value = (status == InputActionStatuses.START || status == InputActionStatuses.UPDATE) && !x ? 1 : x;
  if (!value) return true;
  baseFov ??= readFov() ?? DEFAULT_FOV;
  zoom = clamp(currentZoom() + direction * ZOOM_RATE * value * CONFIG.zoomStepScale, -CONFIG.zoomIn, 1 + CONFIG.zoomOut);
  Camera.zoom(clamp(zoom, 0, 1));
  applyFov();
  holdFov();
  return true;
}

const HOOK_RETRIES = 40;
const HOOK_RETRY_MS = 250;
const hookedControllers = new WeakSet();

/**
 * The camera controllers that receive input: the one registered with the
 * context manager's input handlers (the HUD's), plus the imported singleton.
 */
function cameraControllers() {
  return [CameraController, ...(ContextManager.engineInputEventHandlers ?? [])]
    .filter((h, i, all) => typeof h?.cameraZoomIn === 'function' && all.indexOf(h) === i);
}

function hookController(controller) {
  if (hookedControllers.has(controller)) return false;
  hookedControllers.add(controller);
  wrapMethod(controller, 'cameraZoomOut', (base, status, x) => (zoomBy(1, status, x) ? undefined : base(status, x)));
  wrapMethod(controller, 'cameraZoomIn', (base, status, x) => (zoomBy(-1, status, x) ? undefined : base(status, x)));
  return true;
}

/** Hook every controller found; retry until the HUD's input handler has been registered. */
function patchCamera(attempts = HOOK_RETRIES) {
  const controllers = cameraControllers();
  if (controllers.some((c) => typeof c.applyZoomTarget === 'function')) { log('Zoom+ camera controller found; zoom left to it'); return; }
  const hooked = controllers.filter(hookController).length;
  const registered = (ContextManager.engineInputEventHandlers ?? []).some((h) => hookedControllers.has(h));
  if (hooked && CONFIG.debug) log(`camera zoom hooked (${hooked} controller(s), input handler ${registered ? 'found' : 'not yet found'})`);
  if (!registered && attempts > 0) setTimeout(() => patchCamera(attempts - 1), HOOK_RETRY_MS);
}

// ============================ Notification bar ============================

function scaleNotifications() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `panel-notification-train { transform: scale(${CONFIG.notificationScale}); transform-origin: bottom right; }`;
  document.head.appendChild(style);
}

if (CONFIG.enabled) {
  engine.whenReady.then(() => { if (isObserverSeat()) patchCamera(); });
  engine.whenReady.then(() => {
    if (!isObserverSeat()) return;
    scaleNotifications();
    if (CONFIG.debug) log(`zoom range ${-CONFIG.zoomIn}..${1 + CONFIG.zoomOut}, step x${CONFIG.zoomStepScale}`);
  });
}
