/*
 * Zatygold's Observer Mode - a playable Observer for multiplayer Civilization VII.
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
 * Zatygold's Observer Mode - Observer yield graphs (in-game scope).
 *
 * Built from the Victories screen's own parts and stylesheet, laid out like
 * its Economic tab: the same ornate screen frame and tab bar (a tab per
 * recorded yield, mp-observer-history.js), Rank / Leader / Per Turn rows with
 * each leader's banner, portrait and line colour (click a row to hide or
 * show its line), the game's line graph, and an Age dropdown (Overall or one
 * Age). The screen opens from a button in the HUD's sub-system dock.
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, createRenderEffect, createSignal, For, onCleanup, onMount, Show } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { Activatable } from 'fs://game/core/ui-next/components/activatable.js';
import { Dropdown, DropdownItem } from 'fs://game/core/ui-next/components/dropdown.js';
import { defineLegacyComponent } from 'fs://game/core/ui-next/components/fxs-solid-component.js';
import { L10n } from 'fs://game/core/ui-next/components/l10n.js';
import { LineGraph } from 'fs://game/core/ui-next/components/line-graph.js';
import { ScrollArea } from 'fs://game/core/ui-next/components/scroll-area.js';
import { Tab } from 'fs://game/core/ui-next/components/tab.js';
import { ComponentRegistry } from 'fs://game/core/ui-next/services/component-registry.js';
import { isMobile } from 'fs://game/core/ui-next/services/view-experience.js';
import { LeaderWithRibbon } from 'fs://game/base-standard/ui-next/components/leader-with-ribbon.js';
import { ScreenFrame } from 'fs://game/base-standard/ui-next/components/screen-frame.js';
import victoriesStyle from 'fs://game/base-standard/ui-next/screens/victories/victories-screen.scss.js';
import { createLogger, whenDefined, wrapMethod } from '../zom-shared/zom-util.js';
import { CONFIG } from './mp-observer-config.js';
import { isObserverSeat } from './mp-observer-core.js';
import { HISTORY_EVENT, HISTORY_YIELDS, yieldHistory } from './mp-observer-history.js';

const log = createLogger('observer-graphs');
const GRAPHS_TAG = 'zom-observer-graphs';
const DOCK_TAG = 'panel-sub-system-dock';
const DOCK_BUTTON_CLASS = 'zom-graphs-dock-button';
// Age dropdown values are non-empty strings: the dropdown treats a falsy value (Antiquity's 0) as nothing selected.
const OVERALL = 'overall';
const ageOption = (chronology) => `age-${chronology}`;
const optionChronology = (option) => Number(option.slice(4));
const LINE_WIDTH = 6;   // the Economic tab's
const DEFAULT_BANNER = 'bn_deluxe';
/** Title colour and panel background (the Victories screen's art) per yield. */
const YIELD_LOOK = {
  science: { color: '#6fa6d6', background: 'bg_victory_scientific2' },
  culture: { color: '#b48ee0', background: 'bg_victory_culture' },
  gold: { color: '#ffd553', background: 'bg_victory_economic3' },
  influence: { color: '#8fd1b0', background: 'bg_victory_economic' },
  food: { color: '#9bd06a', background: 'bg_victory_culture' },
  production: { color: '#d99a5b', background: 'bg_victory_military' }
};

// Markup and classes of the Victories screen (victories-screen.js, victories-alt-base.js, victory-tab-base.js).
const T = {
  container: template(`<div class="mt-8 flex flex-col flex-auto bg-accent-6 items-center mb-5 pl-8 pr-8 pt-8 relative victories-panel-container"><div class="absolute inset-0 bottom-0 filigree-inner-frame-top"></div><div class="absolute inset-0 bottom-0 filigree-inner-frame-bottom"></div></div>`),
  panel: template(`<div class="relative w-full h-full"><div class="absolute inset-0 bg-cover bg-no-repeat opacity-30 pointer-events-none"></div><div class="relative h-full flex flex-col items-center w-full"></div></div>`),
  description: template(`<div class="absolute -top-14 victories-header"><div class="font-body text-body text-xs self-center text-center"></div></div>`),
  title: template(`<div class="flex flex-row absolute -mt-6 ml-2 w-full victories-point-goal-line"><div class="victories-military-cols-1-and-2 font-title uppercase font-bold text-lg"><div role="heading"></div></div></div>`),
  spacer: template(`<div class="w-full h-4"></div>`),
  header: template(`<div class="flex flex-row victories-military-bottom-line h-14 w-full"><div class="victories-military-col-1 font-title text-sm fxs-header uppercase self-center text-center"></div><div class="victories-military-col-2 font-title text-sm fxs-header uppercase self-center pl-4"></div><div class="victories-military-col-4 flex flex-row victories-military-left-line-header"><div class="w-full font-title text-sm fxs-header uppercase flex flex-row"><div class="self-center w-full text-center font-fit-shrink"></div></div></div><div class="victories-military-col-3 font-title text-sm"><div class="w-full h-full relative flex flex-row justify-end victories-military-left-line-header"><div class="relative ml-2 mt-2 mr-2 uppercase fxs-header self-center"></div></div></div></div>`),
  body: template(`<div class="victories-scrollarea shrink mb-2 flex flex-row w-full flex-auto"><div class="victories-econ-col-3 victories-economic-graph relative"><div class="h-full absolute inset-2"></div></div></div>`),
  row: template(`<div class="flex flex-row pointer-events-auto min-h-32 duration-150 ease-out"><div class="flex flex-row victories-econ-col-4"><div class="h-full w-2"></div><div class="self-center flex-1"><div class="font-title bold text-xl text-center text-white"></div></div></div></div>`),
  rowLeader: template(`<div class="absolute inset-0 flex flex-row"><div class="flex flex-row victories-econ-col-1 justify-center"><div class="self-center"></div></div><div class="relative victories-econ-col-2 victories-military-left-line"><div class="flex flex-row"><div class="mx-2"></div><div class="victories-military-player-vslot mt-7 flex-1"><div class="text-white"></div></div></div></div></div>`),
  rowBanner: template(`<div class="absolute inset-0 bg-cover bg-no-repeat duration-150 ease-out opacity-30"></div>`),
  selected: template(`<div class="pl-3"></div>`),
  empty: template(`<div class="absolute inset-0 flex items-center justify-center font-body text-sm text-accent-3"></div>`)
};

// ============================ Data ============================

const ages = () => [...GameInfo.Ages].sort((a, b) => a.ChronologyIndex - b.ChronologyIndex);
const currentChronology = () => GameInfo.Ages.lookup(Game.age)?.ChronologyIndex ?? 0;

function ageLabel(option) {
  if (option === OVERALL) return Locale.compose('LOC_ZOM_GRAPH_OVERALL');
  const age = ages().find((a) => a.ChronologyIndex === optionChronology(option));
  return age ? Locale.compose('LOC_VICTORY_AGE_NAME', age.Name) : '';
}

function leaderColor(playerId) {
  try { return UI.Player.getPrimaryColorValueAsString(playerId); } catch (e) { return '#ffffff'; }
}

let banners = null;
/** The leader's banner art from the legend paths, as the Victories screen shows it. */
function leaderBanner(playerId) {
  if (!banners) {
    banners = new Map();
    try {
      for (const item of Online.Metaprogression.getLegendPathsData()) {
        if (!item.legendPathLoc?.includes('LOC_LEADER')) continue;
        const banner = item.rewards?.find((r) => r.gameItemID?.slice(0, 7) === 'BANNER_');
        if (banner) banners.set(item.legendPathLoc.substring(4, item.legendPathLoc.length - 5), banner.reward);
      }
    } catch (e) { log(`banners unavailable: ${e}`); }
  }
  const leaderType = GameInfo.Leaders.lookup(Players.get(playerId)?.leaderType)?.LeaderType;
  return banners.get(leaderType) ?? DEFAULT_BANNER;
}

const formatValue = (value) => (value == null ? '-' : Locale.toNumber(Math.round(value * 10) / 10));
const leaderIds = (samples) => [...new Set(samples.flatMap((s) => [...s.values.keys()]))];

function latestValue(samples, id, slot) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const value = samples[i].values.get(id)?.[slot];
    if (value != null) return value;
  }
  return null;
}

/** Leaders by their latest value, highest first: [{ id, value }]. */
const ranking = (samples, slot) => leaderIds(samples).map((id) => ({ id, value: latestValue(samples, id, slot) }))
  .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

/** LineGraph lines (x = recorded turn 1..n of the view), hidden leaders left out. */
const graphLines = (samples, slot, hidden) => leaderIds(samples).filter((id) => !hidden.has(id)).map((id) => ({
  color: leaderColor(id),
  order: 1,
  points: samples.map((s, i) => ({ x: i + 1, y: s.values.get(id)?.[slot] })).filter((p) => p.y != null)
}));

/** A round axis top above the highest value (1, 2 or 5 times a power of ten). */
function graphTop(samples, slot) {
  const max = Math.max(0, ...samples.flatMap((s) => [...s.values.values()].map((v) => v[slot] ?? 0)));
  if (max <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((m) => m * step).find((top) => top >= max * 1.05) ?? 10 * step;
}

// ============================ Rows ============================

const LeaderRow = (props) => {
  const row = T.row();
  const scoreBar = row.firstChild.firstChild;
  const scoreText = scoreBar.nextSibling.firstChild;
  const banner = T.rowBanner();
  const leader = T.rowLeader();
  const rank = leader.firstChild.firstChild;
  const portrait = leader.firstChild.nextSibling.firstChild.firstChild;
  const name = portrait.nextSibling.firstChild;
  banner.style.backgroundImage = `url(blp:${leaderBanner(props.entry.id)})`;
  rank.textContent = `${props.rank}`;
  name.textContent = Locale.compose(Players.get(props.entry.id)?.name ?? '');
  scoreBar.style.backgroundColor = leaderColor(props.entry.id);
  scoreText.textContent = formatValue(props.entry.value);
  insert(portrait, createComponent(LeaderWithRibbon, { leaderId: props.entry.id, size: 28, omitFullRibbon: true, omitRelationshipIcon: true }));
  // Leader columns before the Per Turn column, as in the Victories rows.
  insert(row, createComponent(Activatable, {
    'class': 'victories-econ-cols-1-and-2 relative flex flex-row',
    onActivate: () => props.onToggle(props.entry.id),
    onMouseEnter: () => banner.classList.replace('opacity-30', 'opacity-60'),
    get children() { return [banner, leader]; }
  }), row.firstChild);
  createRenderEffect(() => {
    const hidden = props.hidden();
    row.style.opacity = hidden ? '0.4' : '1';
    row.setAttribute('data-tooltip-content', Locale.compose(hidden ? 'LOC_ZOM_GRAPH_SHOW_LINE' : 'LOC_ZOM_GRAPH_HIDE_LINE'));
  });
  row.addEventListener('mouseleave', () => banner.classList.replace('opacity-60', 'opacity-30'));
  return row;
};

// ============================ Yield panel ============================

const YieldPanel = (props) => {
  const look = YIELD_LOOK[props.yieldDef.id] ?? YIELD_LOOK.gold;
  const slot = props.yieldDef.slot;
  const panel = T.panel();
  const background = panel.firstChild;
  const content = background.nextSibling;
  background.style.backgroundImage = `url(${look.background})`;

  const description = T.description();
  description.firstChild.textContent = Locale.compose('LOC_ZOM_GRAPH_DESCRIPTION', Locale.compose(props.yieldDef.label));
  const title = T.title();
  const heading = title.firstChild;
  heading.style.color = look.color;
  heading.firstChild.textContent = Locale.compose(props.yieldDef.label);

  const header = T.header();
  const [rankHead, leaderHead, valueHead, ageHead] = Array.from(header.children);
  rankHead.textContent = Locale.compose('LOC_GENERIC_RANK');
  leaderHead.textContent = Locale.compose('LOC_GENERIC_LEADER');
  valueHead.firstChild.firstChild.textContent = Locale.compose('LOC_ZOM_GRAPH_PER_TURN_COLUMN');
  insert(ageHead.firstChild.firstChild, createComponent(Dropdown, {
    get defaultValue() { return props.age(); },
    selectedItemTemplate: (value) => { const text = T.selected(); text.textContent = ageLabel(value); return text; },
    hotkey: 'shell-action-2',
    onItemSelected: (value) => props.setAge(value),
    get children() {
      return createComponent(For, {
        get each() { return props.ageOptions(); },
        children: (option) => createComponent(DropdownItem, { value: option, get children() { return createComponent(L10n.Compose, { text: ageLabel(option) }); } })
      });
    }
  }));

  const body = T.body();
  const graph = body.firstChild.firstChild;
  insert(body, createComponent(ScrollArea, {
    'class': 'victories-scroll-base w-full victories-econ-cols-1-and-2-and-4',
    useProxy: true,
    get children() {
      return createComponent(For, {
        get each() { return ranking(props.samples(), slot); },
        children: (entry, index) => createComponent(LeaderRow, { entry, rank: index() + 1, hidden: () => props.hidden().has(entry.id), onToggle: props.toggle })
      });
    }
  }), body.firstChild);
  insert(graph, createComponent(Show, {
    get when() { return props.samples().length > 0; },
    get fallback() { const empty = T.empty(); empty.textContent = Locale.compose('LOC_ZOM_GRAPH_NO_DATA'); return empty; },
    get children() {
      return createComponent(LineGraph, {
        'class': 'opacity-100',
        width: LINE_WIDTH,
        get lines() { return graphLines(props.samples(), slot, props.hidden()); },
        get maxX() { return Math.max(props.samples().length, 2); },
        get maxY() { return graphTop(props.samples(), slot); },
        minX: 1,
        gridColorX: 'rgb(255 255 255 / 30%)',
        axisLabelX: Locale.compose('LOC_GENERIC_TURN'),
        axisLabelY: Locale.compose('LOC_ZOM_GRAPH_PER_TURN', Locale.compose(props.yieldDef.label)),
        axisNumberColor: '#b5b5b6',
        axisLabelColor: '#848486'
      });
    }
  }));

  content.append(description, title, T.spacer(), header, body);
  return panel;
};

// ============================ Screen ============================

const TOP_ICON_CLASS = 'zom-graphs-top-icon';
const TOP_ICON_ZOOM = 1.5;   // the glyph fills the frame's top medallion

function ornatePanelData() {
  return {
    topIconSrc: 'none',   // the medallion shows the graph glyph (placeTopIcon)
    topIconClass: `size-14 relative ${TOP_ICON_CLASS}`,
    backgroundImageSrc: '',
    name: 'ZOM-Yield-Graphs',
    id: GRAPHS_TAG,
    isFullscreen: isMobile()
  };
}

const GraphsScreenComponent = () => {
  const [history, setHistory] = createSignal(yieldHistory(), { equals: false });
  const [age, setAge] = createSignal(OVERALL);
  const [hidden, setHidden] = createSignal(new Set(), { equals: false });
  const onHistory = () => setHistory(yieldHistory());
  onMount(() => {
    window.addEventListener(HISTORY_EVENT, onHistory);
    placeTopIcon();
  });
  onCleanup(() => window.removeEventListener(HISTORY_EVENT, onHistory));

  const samples = createMemo(() => (age() === OVERALL ? history() : history().filter((s) => s.age === optionChronology(age()))));
  const ageOptions = createMemo(() => [OVERALL, ...ages().map((a) => a.ChronologyIndex).filter((c) => c <= currentChronology()).map(ageOption)]);
  const toggle = (id) => {
    const set = hidden();
    if (!set.delete(id)) set.add(id);
    setHidden(set);
  };
  const panelProps = { samples, age, setAge, ageOptions, hidden, toggle };

  return createComponent(ScreenFrame, {
    name: 'ZOM-Yield-Graphs',
    panelContext: GRAPHS_TAG,
    audioContext: 'VictoryScreen',
    title: 'LOC_ZOM_GRAPHS_TITLE',
    ornatePanelData: ornatePanelData(),
    addYieldBar: false,
    get isFullscreen() { return isMobile(); },
    get children() {
      return createComponent(Tab, {
        'class': 'victories-tab-bar w-full flex flex-col flex-auto pointer-events-auto mx-5',
        defaultTab: HISTORY_YIELDS[0].id,
        get children() {
          const container = T.container();
          insert(container, createComponent(Tab.Output, {}), null);
          return [
            createComponent(Tab.TabList, { 'class': 'victories-tab-width self-center text-base font-base', nextHotkey: 'nav-next', previousHotkey: 'nav-previous' }),
            container,
            ...HISTORY_YIELDS.map((yieldDef) => createComponent(Tab.Item, {
              name: yieldDef.id,
              title: () => yieldDef.label,
              body: () => createComponent(YieldPanel, { yieldDef, ...panelProps })
            }))
          ];
        }
      });
    }
  });
};

/** The graph glyph in the frame's top medallion, where the Victories screen has its trophy. */
function placeTopIcon(attempts = 10) {
  const medallion = document.querySelector(`${GRAPHS_TAG} .${TOP_ICON_CLASS}`);
  if (!medallion) {
    if (attempts > 0) requestAnimationFrame(() => placeTopIcon(attempts - 1));
    return;
  }
  if (!medallion.firstChild) medallion.appendChild(graphGlyph(TOP_ICON_ZOOM));
}

const GraphsScreen = ComponentRegistry.register({
  name: 'ZOMYieldGraphsScreen',
  styles: [victoriesStyle],
  createInstance: GraphsScreenComponent
});

defineLegacyComponent(GRAPHS_TAG, { classNames: ['fullscreen'], attrs: {} }, () => {
  Input.setActiveContext(InputContext.Shell);
  return createComponent(GraphsScreen, {});
});

const openGraphs = () => ContextManager.push(GRAPHS_TAG, { singleton: true, createMouseGuard: true });

// ============================ Dock button ============================

/**
 * The button's icon in the dock icons' look - a light, engraved glyph with a
 * dark edge - drawn on a 128 x 128 canvas centred on the button, and larger
 * in the screen's top medallion (the game has no graph icon): an axis and a
 * rising line.
 */
const GRAPH_GLYPH = {
  light: ['#f1ebdc', '#b9b2a2'],   // top and bottom of the glyph's gradient
  edge: 'rgba(20, 16, 10, 0.75)',
  axis: [[42, 40], [42, 88], [90, 88]],
  line: [[50, 78], [61, 63], [71, 70], [86, 47]]
};

function graphGlyph(zoom = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const light = ctx.createLinearGradient(0, 40, 0, 90);
  light.addColorStop(0, GRAPH_GLYPH.light[0]);
  light.addColorStop(1, GRAPH_GLYPH.light[1]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(64, 64);
  ctx.scale(zoom, zoom);
  ctx.translate(-66, -64);   // the glyph's centre
  const stroke = (points, style, width) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  for (const [points, width] of [[GRAPH_GLYPH.axis, 5], [GRAPH_GLYPH.line, 6]]) stroke(points, GRAPH_GLYPH.edge, width + 4);
  for (const [points, width] of [[GRAPH_GLYPH.axis, 5], [GRAPH_GLYPH.line, 6]]) stroke(points, light, width);
  return canvas;
}

/** The Graphs button after the dock's own screen buttons, built by the dock itself. */
function placeDockButton(dock) {
  const root = dock?.Root;
  if (!isObserverSeat() || !root || root.querySelector('.' + DOCK_BUTTON_CLASS)) return;
  const button = dock.createButton({
    tooltip: 'LOC_ZOM_GRAPHS_TITLE',
    modifierClass: 'zom-graphs',
    callback: openGraphs,
    class: DOCK_BUTTON_CLASS,
    audio: 'unlocks',
    focusedAudio: 'data-audio-focus-small'
  });
  button.classList.add('ssb__element');
  button.querySelector('.ssb__button-icon')?.appendChild(graphGlyph());
  const slot = root.querySelector('#panel-sub-system-dock-mod-slot');
  if (slot) slot.parentElement.insertBefore(button, slot);
  else root.appendChild(button);
}

if (CONFIG.enabled) {
  whenDefined(DOCK_TAG, (definition) => {
    wrapMethod(definition.createInstance.prototype, 'onAttach', function (base, ...args) {
      const result = base(...args);
      try { placeDockButton(this); } catch (e) { log(`dock button failed: ${e}`); }
      return result;
    });
    // The HUD may already be up.
    engine.whenReady.then(() => {
      const dock = document.querySelector(DOCK_TAG);
      try { placeDockButton(dock?.maybeComponent ?? dock?.component); } catch (e) { log(`dock button failed: ${e}`); }
    });
  }, { log });
}

export { openGraphs };
