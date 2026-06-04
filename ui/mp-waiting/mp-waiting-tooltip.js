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
 * Multiplayer Toolkit - "Waiting for Players" hover tooltip.
 *
 * While the action panel banner shows "WAITING FOR PLAYERS", its button only
 * carries a generic tooltip. This module refreshes that tooltip with the live
 * list of human players who have not finished their turn, so hovering the
 * button shows exactly who everyone is waiting on.
 *
 * The banner state is detected by comparing the panel's banner text against
 * the localized waiting string; the tooltip is the engine's own
 * data-tooltip-content attribute, so presentation matches every other tooltip.
 */
import { CONFIG, ENGINE, LOC } from './mp-waiting-config.js';

let waitingBannerText = null;

function log(message) {
  if (CONFIG.debug) console.log(`[MPT waiting] ${message}`);
}

/** Localized banner string, resolved once (Locale is ready post-load). */
function bannerString() {
  if (waitingBannerText === null) {
    try { waitingBannerText = Locale.compose(ENGINE.waitingBannerLoc); }
    catch (e) { return null; }
  }
  return waitingBannerText;
}

/** Human players (other than us) who are still taking their turn. */
function pendingPlayerNames() {
  const names = [];
  try {
    const localId = GameContext.localPlayerID;
    for (const entry of Players.getAlive()) {
      const player = (entry && entry.isHuman !== undefined) ? entry : Players.get(entry);
      if (!player || !player.isHuman || !player.isTurnActive) continue;
      const id = player.id ?? entry;
      if (id === localId) continue;
      const slotName = Configuration.getPlayer(id)?.slotName;
      if (slotName) names.push(Locale.compose(slotName));
    }
  } catch (e) { /* return what we have */ }
  return names;
}

/** Refresh the tooltip while the waiting banner is up; leave other states alone. */
function refreshTooltip() {
  const banner = document.querySelector(`.${ENGINE.bannerTextClass}`);
  const button = document.querySelector(`.${ENGINE.actionButtonClass}`);
  const waiting = bannerString();
  if (!banner || !button || !waiting) return;
  if (banner.textContent !== waiting) return;
  const names = pendingPlayerNames();
  if (!names.length) return;
  const list = names.join(', ');
  let content;
  try { content = Locale.compose(LOC.waitingList, list); }
  catch (e) { content = null; }
  // Guard: an unmatched placeholder renders literally rather than throwing,
  // so fall back to the bare name list if substitution did not happen.
  if (!content || content.includes('{1_')) content = list;
  if (button.getAttribute('data-tooltip-content') !== content) {
    button.setAttribute('data-tooltip-content', content);
    banner.setAttribute('data-tooltip-content', content);
    log(`waiting on: ${names.join(', ')}`);
  }
}

setInterval(refreshTooltip, CONFIG.refreshMs);
