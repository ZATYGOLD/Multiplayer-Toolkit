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
 * Multiplayer Toolkit - Observer navigation (in-game scope).
 *
 * For the Observer seat:
 *   - leader portraits on the ribbon: left click moves the camera to that
 *     leader's capital, right click opens their leader panel; the Observer's
 *     own portrait moves the camera to the Observer's Eye;
 *   - a settlement banner or city-center tile opens its owner's leader panel
 *     (the base game refuses unmet leaders, and the Observer meets no one).
 */
import { RaiseDiplomacyEvent } from 'fs://game/base-standard/ui/diplomacy/diplomacy-events.js';
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import { createLogger, findAncestor, isObserverPlayer, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat, watchedPlayers } from './mp-observer-core.js';

const log = createLogger('observer-navigation');

const openLeaderPanel = (playerId) => window.dispatchEvent(new RaiseDiplomacyEvent(playerId));

/** Move the camera to the player's capital (else first city, else a unit - the Eye for the Observer). */
function lookAtPlayer(playerId) {
  try {
    const player = Players.get(playerId);
    const cities = player?.Cities?.getCities?.() ?? [];
    const loc = (cities.find((c) => c.isCapital) ?? cities[0])?.location
      ?? (player?.Units?.getUnits?.() ?? []).find((u) => !u.isDead)?.location;
    if (loc) Camera.lookAtPlot(loc, { zoom: 1 });
  } catch (e) { log(`look-at failed: ${e}`); }
}

/** The leader owning the settlement whose banner shows this name. */
function ownerOfBanner(banner) {
  const name = banner.querySelector('.city-banner__name')?.textContent?.trim();
  if (!name) return null;
  return watchedPlayers().find((p) => (p.Cities?.getCities?.() ?? []).some((city) => Locale.compose(city.name) === name))?.id ?? null;
}

/** The ribbon portrait (and its player id) under an event target, or null. */
function portraitTarget(target) {
  const ribbon = findAncestor(target, (el) => el.localName === 'panel-diplo-ribbon');
  if (!ribbon || !findAncestor(target, (el) => el.classList?.contains('diplo-ribbon__portrait') || el.classList?.contains('diplo-ribbon__portrait-hitbox'))) return null;
  const id = parseInt(findAncestor(target, (el) => el.getAttribute('data-player-id') != null)?.getAttribute('data-player-id'), 10);
  return Number.isNaN(id) ? null : id;
}

function onEngineInput(ev) {
  const d = ev.detail;
  if (!d || !['mousebutton-left', 'mousebutton-right', 'accept'].includes(d.name) || !isObserverSeat()) return;
  try {
    const banner = d.name === 'mousebutton-left' ? findAncestor(ev.target, (el) => el.classList?.contains('city-banner')) : null;
    const bannerOwner = banner ? ownerOfBanner(banner) : null;
    const portraitId = bannerOwner == null ? portraitTarget(ev.target) : null;
    if (bannerOwner == null && portraitId == null) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (d.status !== InputActionStatuses.FINISH) return;
    if (bannerOwner != null) openLeaderPanel(bannerOwner);
    else if (d.name === 'mousebutton-right' && !isObserverPlayer(portraitId)) openLeaderPanel(portraitId);
    else lookAtPlayer(portraitId);
  } catch (e) { log(`click failed: ${e}`); }
}

/** City-center tiles open their owner's leader panel; every other tile keeps the base behaviour. */
function patchCityCenterClicks() {
  wrapMethod(WorldInput, 'handleSelectedPlotCity', (base, location, ...rest) => {
    if (!isObserverSeat()) return base(location, ...rest);
    try {
      const districtId = MapCities.getDistrict(location.x, location.y);
      const district = districtId ? Districts.get(districtId) : null;
      const owner = district?.cityId && district.type == DistrictTypes.CITY_CENTER ? Cities.get(district.cityId)?.owner : null;
      const player = owner != null ? Players.get(owner) : null;
      if (player && (player.isMajor || player.isMinor || player.isIndependent) && !isObserverPlayer(owner)) {
        openLeaderPanel(owner);
        return false;
      }
    } catch (e) { log(`city center click failed: ${e}`); }
    return base(location, ...rest);
  });
}

if (CONFIG.enabled) {
  patchCityCenterClicks();
  window.addEventListener('engine-input', onEngineInput, true);
}
