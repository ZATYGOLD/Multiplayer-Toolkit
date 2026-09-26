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
 * Multiplayer Toolkit - Lobby tooltips and start countdown (shell scope).
 *
 * The game-setup civilization and leader tooltips show each ability's text
 * but omit its name; the lobby model's two tooltip builders are wrapped to
 * insert the ability title above the text (a runtime patch rather than a
 * replacement of model-mp-staging-new.js, so it survives game patches). The
 * all-ready start countdown is shortened, and its ring rescaled to match.
 */
import { MPLobbyDataModel } from 'fs://game/core/ui/shell/mp-staging/model-mp-staging-new.js';
import { GetCivilizationData } from 'fs://game/core/ui/shell/create-panels/age-civ-select-model.js';
import { getLeaderData } from 'fs://game/core/ui/shell/create-panels/leader-select-model.js';
import { createLogger, whenDefined, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-lobby-config.js';

const log = createLogger('lobby');
const LOBBY_TAG = 'screen-mp-lobby';
const STOCK_COUNTDOWN_SECONDS = 10;   // the lobby template's hard-coded ring maximum

// ============================ Start countdown ============================

/** The model reads this static each time the countdown begins. */
function shortenCountdown() {
  MPLobbyDataModel.ALL_READY_COUNTDOWN = CONFIG.startCountdownSeconds * 1000;
  if (CONFIG.startCountdownSeconds === STOCK_COUNTDOWN_SECONDS) return;
  whenDefined(LOBBY_TAG, (definition) => {
    wrapMethod(definition.createInstance.prototype, 'onAttach', function (base, ...args) {
      const result = base(...args);
      try {
        for (const ring of this.Root?.querySelectorAll?.('.mp-staging__ring-meter') ?? []) ring.setAttribute('max-value', String(CONFIG.startCountdownSeconds));
      } catch (e) { /* leave the ring as is */ }
      return result;
    });
  }, { log });
}

// ============================ Ability titles ============================

/**
 * Inserts the styled ability title above the ability text. Idempotent: the
 * base model caches tooltip fragments, so a tooltip that already carries the
 * title is returned untouched.
 */
function withAbilityTitle(tooltip, abilityTitle, abilityText) {
  if (!tooltip || !abilityTitle || !abilityText) return tooltip;
  const title = Locale.compose(abilityTitle);
  const text = Locale.compose(abilityText);
  if (!title || !text || tooltip.includes(title)) return tooltip;
  return tooltip.replace(text, `[STYLE:${CONFIG.titleStyle}][B]${title}[/B][/S][N]${text}`);
}

function patchTooltips() {
  const proto = MPLobbyDataModel.prototype;
  wrapMethod(proto, 'getCivilizationTooltip', (base, civilizationType, ...rest) => {
    const civData = GetCivilizationData(false).find((data) => data.civID == civilizationType);
    return withAbilityTitle(base(civilizationType, ...rest), civData?.abilityTitle, civData?.abilityText);
  });
  wrapMethod(proto, 'getLeaderTooltip', (base, leaderType, ...rest) => {
    const leaderData = getLeaderData(false).find((data) => data.leaderID == leaderType);
    return withAbilityTitle(base(leaderType, ...rest), leaderData?.abilityTitle, leaderData?.abilityText);
  });
}

try {
  if (CONFIG.startCountdownSeconds > 0) shortenCountdown();
  patchTooltips();
} catch (e) { log(`lobby patches failed: ${e}`); }
