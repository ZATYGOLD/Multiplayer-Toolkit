# Multiplayer Toolkit

Multiplayer quality-of-life features for **Sid Meier's Civilization VII**,
built on the game's own UI components. Current version: **0.6.04**.

- **Competitive turn timer** — a Turn Timer option that scales with cities,
  units, human players and the turn number, with urgency tiers and sounds.
- **Synchronized pause** — anyone can pause; everyone readies up (or the host
  resumes) and a shared countdown restarts the game. Disconnects, host
  changes and rejoins pause automatically.
- **Observer** *(experimental)* — watch a multiplayer game as a real player
  with no empire: whole-map vision, every leader's stats and screens.
- **Lobby fixes** — ability names in civ / leader tooltips; a 5-second start
  countdown.

## Installation

1. Copy the folder to `…\Sid Meier's Civilization VII\Mods\Multiplayer-Toolkit\`.
2. Enable **Multiplayer Toolkit** in **Main Menu → Additional Content**.
3. **Every player needs the mod** (menus, timer enforcement and the Observer
   run per client). It is dormant in single-player.

---

## Competitive Turn Timer

Set **Turn Timer** to **Competitive** in multiplayer setup (Simultaneous
turns). Each turn's clock, per Age:

```
seconds = Base + PerCity × (most cities any civ has) + PerUnit × (most units any civ has)
        + PerHuman × (living humans, Observers excluded) + PerTurn × (turn number)
```

Every player gets the same clock. At zero the turn ends automatically. Below
30s the display turns orange with warning beeps; below 15s it turns red with a
beep per second. The clock holds until you found a settlement and stands still
while paused or while an Age is ending.

| Tune | Where |
|---|---|
| Per-Age `Base` / `PerCity` / `PerUnit` (and overrides) | `data/timers/<age>/CompetitiveTimer.sql` |
| Default `PerHuman` / `PerTurn` | `data/timers/TimerScaling.sql` |
| Tiers, colours, sounds, debug | `ui/mp-timer/mp-timer-config.js` |

The engine only enforces its built-in timers, so the mod registers a subclass
of the game's action panel (only when Competitive is chosen) that draws the
native text and ring from the synchronized phase clock and ends the turn
itself. Its numbers live in mod-owned tables; the Dynamic timer is untouched.
Known cosmetic: the lobby **Rules** popup shows a debug string for the timer.

---

## Synchronized Pause

- **Pause:** **Pause Game** in the Esc menu, or the **P** key (rebindable in
  keyboard mapping). The pause menu opens for everyone.
- **While paused:** **Ready** (or **Resume (All Players)** for the host) and
  **View Map** to look around (Esc returns to the menu). A "Ready X / N" tally
  counts connected players. Game-advancing actions (end turn, unit orders,
  quick load) are blocked; camera, selection and panels are not.
- **Resume:** when every connected player is ready, or the host resumes for
  all, a 5-second **UNPAUSING…** countdown runs (still paused) and play resumes
  together.
- **Disconnects:** a dropped player pauses the game before the AI takes over
  (disconnect event, connection polling and a turn-start guard). The host gets
  **Drop Disconnected & Resume** to continue without them. Host changes and
  rejoin resyncs also pause, with a notice in the menu.

Settings: `ui/mp-pause/mp-pause-config.js`. The engine exposes only a total
"want pause" count, so host resume uses hidden chat commands between clients.

---

## Observer (experimental)

**Setup:** in the multiplayer lobby pick **Observer** as leader or
civilization (the other follows; team and civ lock). At each Age transition
the Observer civilization is picked automatically.

**Playing:** you are a normal player who never settles and is never
eliminated. Press **End Turn** or turn on **Auto End Turn** (the button on
your ribbon card; it switches off when an Age completes so the Age transition
action shows). Pause, chat and every screen work. Your Founder is replaced by
the hidden **Observer's Eye**, whose sight shows every unit live.

**Ribbon:** every living leader, your card at the right edge.

- Your card's buttons switch every card between **Yields** (compact rows incl.
  food, production, citizens, military, techs / civics / wonders; best leader
  highlighted, negatives banded red), **Research**, **Production** and
  **Victories**.
- Right-click your portrait to hide or show details (the game's "Always Show
  Ribbon Yields" option); left-click it to jump to the Eye.
- Left-click a leader to jump to their capital; right-click also opens their
  leader panel (wars listed, no actions). Settlement banners and city centers
  open the owner's panel.
- Allies share a hex-border colour; leaders at war glow red with a pip per
  war; celebrations glow gold. Antiquity cards show the leader's pantheon.

**Yield Graphs:** a button in the HUD's screen dock opens line graphs of
every leader's science, culture, gold, influence, food and production per
turn (a tab each), recorded every turn and saved with the game. It is built
from the Victories screen's own frame, rows and graph, like its Economic tab:
Rank / Leader / Per Turn rows (click one to hide or show its line), the graph
on the right, and an Age dropdown for the whole game (Overall) or one Age.

**Screens:** Resources & Trade, Legacies, Government, Great Works, Religion and
the tech / civic trees get a row of leader portraits — pick one to see that
screen as theirs (read-only, same tab). The tech and civic buttons open the
full tree directly. Click any unit to inspect it; with a combat unit selected,
hover another unit for an estimated combat preview.

**Quiet:** advisors, narrative events, diplomacy and meeting prompts,
crisis / Age countdown popups, dedications and the Age transition choice are
handled automatically. The camera zooms 30% closer and 55% further; the
notification bar is 25% smaller. Observers never appear in victories,
rankings, Civ Unlocks or Age-transition choices, and complete no Triumphs.

### How it works

- Data, not UI hacks: an Observer leader and one civ per Age, defined like the
  game's own, with no abilities. Defeat and every Triumph get an extra
  "not the Observer" requirement.
- The Eye replaces the Founder (`UnitReplaces`), is created by the start-plot
  script near the bottom-centre of the map (moved onto ice when possible),
  sees 128 tiles through terrain, keeps every unit visible and is kept asleep.
- UI only: the Observer counts as having met everyone, and screens read the
  picked leader through `MPTLeaderView`.
- Zoom past the engine's 0..1 range changes the field of view, as Zoom+ does.

### Known limits

- Multiplayer only; a "Random" pick could resolve to the Observer.
- The Eye shows as a generic ship, visible only to the Observer.
- Combat previews between other players' units are estimates.

---

## Project structure

```
Multiplayer-Toolkit/
├─ multiplayer-toolkit.modinfo   # manifest, per-Age data, observer-in-game criteria
├─ config/                       # lobby DB: Competitive option, pause keybind, Observer setup
├─ data/observer/                # gameplay DB: Observer leader, civs, Eye, Triumph / defeat exemptions
├─ data/timers/                  # Competitive timer numbers (default + per Age)
├─ icons/                        # Observer art
├─ maps/, scripts/               # base-game overrides: Observer start and Eye each Age
├─ ui-next/screens/, ui/policies/, ui/great-works/,
│  ui/tech-tree/, ui/culture-tree/, ui/tree-grid/   # base-game overrides: screens for a picked leader
├─ text/en_us/                   # mod info and in-game strings
└─ ui/
   ├─ mpt-shared/                # logger, method wrapping, deferred patching, Observer identity
   ├─ mp-keybind/                # pause action in keyboard mapping
   ├─ mp-lobby/                  # tooltips, countdown, Observer lobby role
   ├─ mp-pause/                  # pause manager, overlay, chat commands
   ├─ mp-timer/                  # Competitive timer
   └─ mp-observer/               # in-game Observer (no-op for other players)
```

Each feature has a `*-config.js` for settings, and modules patch the base UI at
runtime. Base-game overrides are verbatim copies with changes marked `MPT:`;
they load only in a game with an Observer (modinfo criteria
`observer-in-game`), so other games run the untouched files. Diagnostics go to
`UI.log`.

---

## Changelog

### 0.6.04

- **Yield Graphs redesign** — built from the Victories screen's own parts
  like its Economic tab: the ornate frame and tab bar, Rank / Leader / Per
  Turn rows with each leader's banner, portrait and line colour (click a row
  to hide or show its line), the game's line graph with thicker lines, and a
  graph glyph in the frame's medallion.
- **Age dropdown** — the game's own dropdown, available from Antiquity on:
  Overall (the whole game) or one Age; no longer shows "Select an Item"
  when switching tabs.
- **Graphs button** — redrawn in the dock icons' look and centred.

### 0.6.03

- **New: Yield Graphs** (Observer) — per-turn science, culture, gold,
  influence, food and production for every leader across all Ages, from a
  button in the HUD's screen dock; a tab per yield and a ranked leader list;
  history recorded each turn and saved with the game.

### 0.6.02

- **New:** compact Yields view with citizens, techs, civics and wonders; best
  leader highlighted (also on Victories); red band behind negatives.
- **New:** tech and civic trees for any leader; the research and civic buttons
  open the full tree; the civic tree opens on the Age's main civics.
- **New:** right-click the Observer's portrait to hide / show details.
- **New:** pantheons on the ribbon in Antiquity.
- **New:** Age end — Auto End Turn switches off when an Age completes; the Age
  transition choice is skipped.
- **Compatibility:** base-game copies load only in games with an Observer;
  Religion and Great Works are runtime patches.
- **Polish:** narrower cards with a gap; alliance colours kept during wars and
  celebrations; End Turn slides away under Auto End Turn; leader switches
  without reopen animations; zoom 30% / 55%.
- **Fix:** Religion screen showing another leader's religion; Great Works
  picker too low.

### 0.6.01

- **New:** Observer Auto End Turn; food, production and military on Yields.
- **New:** Resources & Trade, Legacies, Government and Great Works for any
  leader (tab kept when switching).
- **New:** alliance and war highlights; wider zoom; smaller notifications;
  top yield bar follows the leader panel.
- **New:** the Observer continues into the next Age automatically.
- **Fix:** Competitive timer frozen for the Observer, not ending at 0, and
  counting while paused.
- **Fix:** the game waiting on the Observer after a pause; Observer
  completing Triumphs; Observer civs in Civ Unlocks; editable policies; End
  Turn showing under Auto End Turn; outdated Age-transition override.
- **Fix:** Religion button after Antiquity opens the game's Religion screen.
- **Performance:** cached ribbon data, fewer timer retries and rescans.

### 0.6.00

- Shared helpers and split Observer modules; Observers excluded from timer and
  disconnect counts; quieter chat commands.
- **Fix:** Observer Age transitions (new Eye, no dedication prompt); portrait
  clicks; single-player Observer crash (now multiplayer only).

### 0.5.9

- **New:** Observer leader & civilization as game data, replacing the old
  observer slot and dashboard.
- **Fix:** Competitive timer ending opening turns; timer-ended turns no longer
  cancel unit orders.

### 0.5.8

- Pause: consensus of connected players or host **Resume (All Players)**;
  **Drop Disconnected & Resume**; cross-client chat commands.

### 0.5.7

- Observer slot fixes (pause menu, ribbons, view as player); timer retuned.

### 0.5.6

- Observer "view as player" (experimental).

### 0.5.5

- Rebindable pause key; timer fixes (capital turn, stalls, strict expiry,
  starts turn 2); retuned timings.

### 0.5.4

- Observer dashboard; 5-second lobby countdown.

### 0.5.3

- Observer lobby role; lobby tooltip ability names; timer as an action-panel
  subclass with its own tables and a synced ring. More than 8 players is not
  moddable (engine limit).

### 0.5.2

- Decimal timer weights; vote resume off by default; disconnect, host-change
  and rejoin pauses.

### 0.5.1

- Competitive turn timer; config / logic split.

---

## License

Copyright (C) 2026 Zatygold. Free software under the **GNU General Public
License v3 or later**, without any warranty. See [`LICENSE`](LICENSE) or
<https://www.gnu.org/licenses/>.
