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
 * Multiplayer Toolkit - Observer overview panel (in-game scope).
 *
 * One reusable screen that lists something for every watched leader: a leader
 * header, then that leader's entries (icon, title, description). Built from the
 * base game's pantheon panel markup and stylesheet so it looks native.
 * Each "source" supplies the title and the per-player entries; the Observer's
 * Religion button opens it (see mp-observer-screens.js).
 */
import Panel from 'fs://game/core/ui/panel-support.js';
import { FocusManager } from 'fs://game/core/ui-next/services/focus-manager.js';
import { InputEngineEventName } from 'fs://game/core/ui/input/input-support.js';
import { watchedPlayers } from './mp-observer-core.js';

const PANEL_TAG = 'mpt-observer-overview';
const PANTHEON_STYLES = 'fs://game/base-standard/ui/pantheon-complete/panel-pantheon-complete.css';

const CONTENT = `
<fxs-subsystem-frame class="pantheon-frame items-center shrink pointer-events-auto" tabindex="-1" backDrop="fs://game/pant_altarbg.png">
  <div class="flex flex-col items-center" data-slot="header">
    <fxs-header class="mpt-overview-title tracking-150 justify-center flex w-96" data-slot="header"></fxs-header>
  </div>
  <div class="mpt-overview-list mx-6 flex items-center flex-col flex-auto relative"></div>
</fxs-subsystem-frame>`;

// ============================ Sources ============================

function pantheonEntries(player) {
  const religion = player.Religion;
  const entries = [];
  for (const type of religion?.getPantheons?.() ?? []) {
    const def = GameInfo.Beliefs.lookup(type);
    if (def) entries.push({ icon: UI.getIconCSS(def.BeliefType, 'PANTHEONS'), title: def.Name, description: def.Description });
  }
  try {
    if (religion?.hasCreatedReligion?.()) {
      const def = GameInfo.Religions.lookup(religion.getReligionType());
      entries.push({ icon: def ? UI.getIconCSS(def.ReligionType, 'RELIGION_DECO') : '', title: religion.getReligionName(), description: '' });
    }
  } catch (e) { /* religion optional */ }
  return entries;
}

const SOURCES = {
  pantheons: { title: 'LOC_BELIEF_CLASS_PANTHEON_NAME', entries: pantheonEntries, empty: 'LOC_MPT_OBSERVER_NO_PANTHEON' }
};

let requestedSource = 'pantheons';

// ============================ Panel ============================

class ObserverOverviewPanel extends Panel {
  engineInputListener = this.onEngineInput.bind(this);
  closeListener = () => this.close();

  onAttach() {
    super.onAttach();
    this.frame = this.Root.querySelector('fxs-subsystem-frame');
    this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
    this.frame?.addEventListener('subsystem-frame-close', this.closeListener);
    this.render(SOURCES[requestedSource] ?? SOURCES.pantheons);
  }

  onDetach() {
    this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
    this.frame?.removeEventListener('subsystem-frame-close', this.closeListener);
    super.onDetach();
  }

  onReceiveFocus() {
    super.onReceiveFocus();
    FocusManager.get().setFocus(this.Root);
  }

  onEngineInput(ev) {
    if (ev.detail.status !== InputActionStatuses.FINISH) return;
    if (ev.isCancelInput() || ev.detail.name === 'sys-menu') {
      this.close();
      ev.stopPropagation();
      ev.preventDefault();
    }
  }

  render(source) {
    this.Root.querySelector('.mpt-overview-title')?.setAttribute('title', source.title);
    const list = this.Root.querySelector('.mpt-overview-list');
    if (!list) return;
    list.innerHTML = '';
    for (const player of watchedPlayers()) {
      list.appendChild(leaderHeader(player));
      const entries = source.entries(player);
      if (entries.length === 0) list.appendChild(emptyLine(source.empty));
      for (const entry of entries) list.appendChild(entryItem(entry));
    }
  }
}

function leaderHeader(player) {
  const row = document.createElement('div');
  row.classList.value = 'flex flex-row items-center self-stretch mt-6 pb-1';
  row.style.borderBottom = '0.0555555556rem solid rgba(140, 126, 98, 0.6)';
  const portrait = document.createElement('fxs-icon');
  portrait.classList.value = 'size-12 mr-2';
  portrait.setAttribute('data-icon-id', GameInfo.Leaders.lookup(player.leaderType)?.LeaderType ?? 'UNKNOWN_LEADER');
  portrait.setAttribute('data-icon-context', 'CIRCLE_MASK');
  const name = document.createElement('p');
  name.classList.value = 'font-title-base text-accent-2';
  name.textContent = Locale.compose(player.name);
  row.appendChild(portrait);
  row.appendChild(name);
  return row;
}

/** Same markup as the base pantheon panel's list item. */
function entryItem(entry) {
  const item = document.createElement('div');
  item.classList.value = 'pantheon-list-container-item max-w-72 flex flex-col items-center mt-3';
  const iconBox = document.createElement('div');
  iconBox.classList.value = 'pantheon-list-container_icon flex items-center justify-center pointer-events-none bg-cover m-2';
  const icon = document.createElement('div');
  icon.classList.value = 'pantheon-list-container_icon-image relative flex flex-col items-center size-14 bg-center bg-contain bg-no-repeat';
  if (entry.icon) icon.style.backgroundImage = entry.icon;
  iconBox.appendChild(icon);
  const title = document.createElement('p');
  title.classList.value = 'pantheon-list_title font-title-base text-accent-2';
  title.setAttribute('data-l10n-id', entry.title);
  item.appendChild(iconBox);
  item.appendChild(title);
  if (entry.description) {
    const desc = document.createElement('div');
    desc.role = 'paragraph';
    desc.classList.value = 'pantheon-list_desc font-body-sm text-center flex flex-col text-accent-3 pointer-events-auto';
    desc.setAttribute('data-l10n-id', entry.description);
    item.appendChild(desc);
  }
  return item;
}

function emptyLine(loc) {
  const p = document.createElement('p');
  p.classList.value = 'font-body-sm text-accent-3 mt-2';
  p.setAttribute('data-l10n-id', loc);
  return p;
}

Controls.define(PANEL_TAG, {
  createInstance: ObserverOverviewPanel,
  description: 'Multiplayer Toolkit observer overview (every leader).',
  classNames: ['screen-pantheon-complete', 'absolute', 'pointer-events-none', 'flex'],
  innerHTML: [CONTENT],
  styles: [PANTHEON_STYLES],
  attributes: []
});

/** Screen routing hands over the source key (see SOURCES) before opening the panel. */
function setOverviewSource(source) { requestedSource = source; }

export { PANEL_TAG as OVERVIEW_PANEL_TAG, setOverviewSource };
