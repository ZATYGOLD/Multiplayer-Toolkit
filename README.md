# Multiplayer Toolkit

Multiplayer quality-of-life features for **Sid Meier's Civilization VII**,
built on the game's own UI components. Current version: **0.6.1**.

- **Competitive turn timer** — a Turn Timer option that scales with cities,
  units, human players and the turn number, with urgency tiers and sounds.
- **Synchronized pause** — anyone can pause; everyone readies up (or the host
  resumes) and a shared countdown restarts the game. Disconnects, host
  changes and rejoins pause automatically.
- **Lobby fixes** — ability names in civ / leader tooltips; a 5-second start
  countdown.

The Observer now lives in its own mod, **Zatygold's Observer Mode**.

## Installation

1. Copy the folder to `…\Sid Meier's Civilization VII\Mods\Multiplayer-Toolkit\`.
2. Enable **Multiplayer Toolkit** in **Main Menu → Additional Content**.
3. **Every player needs the mod** (menus and timer enforcement run per
   client). It is dormant in single-player.

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

## Project structure

```
Multiplayer-Toolkit/
├─ multiplayer-toolkit.modinfo   # manifest, per-Age timer data
├─ config/                       # lobby DB: Competitive option, pause keybind
├─ data/timers/                  # Competitive timer numbers (default + per Age)
├─ text/en_us/                   # mod info and in-game strings
└─ ui/
   ├─ mpt-shared/                # logger, method wrapping, deferred patching
   ├─ mp-keybind/                # pause action in keyboard mapping
   ├─ mp-lobby/                  # tooltips, countdown
   ├─ mp-pause/                  # pause manager, overlay, chat commands
   └─ mp-timer/                  # Competitive timer
```

Each feature has a `*-config.js` for settings, and modules patch the base UI at
runtime (no base-game files are replaced). Diagnostics go to `UI.log`.

---

## Changelog

### 0.6.1

- **The Observer moved to its own mod**, Zatygold's Observer Mode (leader,
  civilizations, ribbon, leader screens, yield graphs and every base-game
  copy). Multiplayer Toolkit no longer replaces any base-game file.
- **Works with Zatygold's Observer Mode** — its Observer adds no time to the
  Competitive timer (it still counts toward ending turns), never has its clock
  held, counts toward the pause's ready tally and never pauses the game by
  disconnecting.

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
