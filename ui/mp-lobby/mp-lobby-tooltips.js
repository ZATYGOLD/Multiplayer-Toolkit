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
 * Multiplayer Toolkit - Lobby tooltip fixes (shell scope).
 *
 * The multiplayer game-setup civilization and leader tooltips show each
 * ability's TEXT but omit its NAME. This wraps the lobby model's two tooltip
 * builders and inserts the ability title line above the ability text.
 *
 * Same fix as the "Multiplayer UI Fix" Workshop mod, but as a runtime patch
 * instead of a full replacement of model-mp-staging-new.js - so it survives
 * game patches and coexists with other lobby mods.
 */
import { MPLobbyDataModel } from 'fs://game/core/ui/shell/mp-staging/model-mp-staging-new.js';
import { GetCivilizationData } from 'fs://game/core/ui/shell/create-panels/age-civ-select-model.js';
import { getLeaderData } from 'fs://game/core/ui/shell/create-panels/leader-select-model.js';
import { CONFIG } from './mp-lobby-config.js';

function log(message) {
  if (CONFIG.debug) console.log(`[MPT lobby] ${message}`);
}

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

const baseCivTooltip = MPLobbyDataModel.prototype.getCivilizationTooltip;
MPLobbyDataModel.prototype.getCivilizationTooltip = function (civilizationType, playerID) {
  const tooltip = baseCivTooltip.call(this, civilizationType, playerID);
  const civData = GetCivilizationData(false).find((data) => data.civID == civilizationType);
  return withAbilityTitle(tooltip, civData?.abilityTitle, civData?.abilityText);
};

const baseLeaderTooltip = MPLobbyDataModel.prototype.getLeaderTooltip;
MPLobbyDataModel.prototype.getLeaderTooltip = function (leaderType) {
  const tooltip = baseLeaderTooltip.call(this, leaderType);
  const leaderData = getLeaderData(false).find((data) => data.leaderID == leaderType);
  return withAbilityTitle(tooltip, leaderData?.abilityTitle, leaderData?.abilityText);
};

log('lobby civ/leader tooltips now include ability titles');
