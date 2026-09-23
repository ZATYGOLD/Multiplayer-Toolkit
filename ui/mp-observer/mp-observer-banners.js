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
 * Multiplayer Toolkit - show city banners for an observer (0.5.6, experimental).
 *
 * A city banner hides itself whenever the tile's revealed state for
 * GameContext.localObserverID is HIDDEN. In the observer's full-map god-view
 * (localObserverID = OBSERVER_ID / NO_PLAYER) that state comes back HIDDEN for
 * every plot, so testers saw no city centers at all. We patch the exported
 * CityBannerComponent so, and ONLY WHILE the observer is in the full-map view,
 * getVisibility reports VISIBLE - revealing every city center. As soon as the
 * observer adopts a real player's eyes (view-as), the patch stands down and the
 * banner follows that player's genuine fog of war again.
 */
import { CONFIG } from './mp-observer-config.js';
import { CityBannerComponent } from 'fs://game/base-standard/ui/city-banners/city-banners.js';

function log(m) { if (CONFIG.debug) { try { console.log('[MPT observer-banners] ' + m); } catch (e) {} } }

/** True only in the full-map god-view (no real player behind the camera). */
function isGodView() {
  try {
    const id = GameContext.localObserverID;
    if (id === PlayerIds.OBSERVER_ID || id === PlayerIds.NO_PLAYER) return true;
    return !Players.get(id);
  } catch (e) { return false; }
}

function patchBanners() {
  if (!CityBannerComponent?.prototype || CityBannerComponent.prototype.mptBannerPatched) return false;
  const base = CityBannerComponent.prototype.getVisibility;
  if (typeof base !== 'function') return false;
  CityBannerComponent.prototype.getVisibility = function () {
    if (isGodView()) {
      try { return RevealedStates.VISIBLE; } catch (e) { /* fall through to base */ }
    }
    return base.call(this);
  };
  CityBannerComponent.prototype.mptBannerPatched = true;
  log('city-banner visibility patched for observer full-map view');
  return true;
}

engine.whenReady.then(() => { patchBanners(); });

export default { patchBanners };
