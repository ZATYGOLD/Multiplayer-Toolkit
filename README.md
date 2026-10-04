# Zatygold's Observer Mode

A playable **Observer** for multiplayer **Sid Meier's Civilization VII**, built
on the game's own UI components. Current version: **0.6.04**.

Pick **Observer** as your leader to watch a game as a real player with no
empire: whole-map vision, every leader's stats, screens and yield graphs, the
normal HUD and End Turn, through every Age, and you are never eliminated.

## Installation

1. Copy the mod folder into your mods folder:
   `…\Sid Meier's Civilization VII\Mods\`
2. Enable **Zatygold's Observer Mode** in **Main Menu → Additional Content**.
3. **Every player must install and enable the mod** (it changes gameplay data).

---

## Observer (experimental)

**Setup:** in the multiplayer lobby pick **Observer** as leader or
civilization (the other follows; team and civ lock). At each Age transition
the Observer civilization is picked automatically.

**Playing:** you are a normal player who never settles and is never
eliminated. Press **End Turn** or turn on **Auto End Turn** (the button on
your ribbon card; it switches off when an Age completes so the Age transition
action shows). Chat and every screen work. Your Founder is replaced by
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
  picked leader through `ZOMLeaderView`.
- Zoom past the engine's 0..1 range changes the field of view, as Zoom+ does.

### Known limits

- Multiplayer only; a "Random" pick could resolve to the Observer.
- The Eye shows as a generic ship, visible only to the Observer.
- Combat previews between other players' units are estimates.

---

## Project structure

```
zatygolds-oberver-mode.modinfo   # manifest, zom-observer-in-game criteria
├─ config/                       # lobby DB: Observer leader / civs, hidden "Observer in game" option
├─ data/observer/                # gameplay DB: Observer leader, civs, Eye, Triumph / defeat exemptions
├─ icons/                        # Observer art
├─ maps/, scripts/               # base-game overrides: Observer start and Eye each Age
├─ ui-next/screens/, ui/policies/, ui/great-works/,
│  ui/tech-tree/, ui/culture-tree/, ui/tree-grid/   # base-game overrides: screens for a picked leader
├─ text/en_us/                   # mod info and in-game strings
└─ ui/
   ├─ zom-shared/                # logger, method wrapping, deferred patching, Observer identity
   ├─ mp-lobby/                  # Observer lobby role
   └─ mp-observer/               # in-game Observer (no-op for other players)
```

Each feature has a `*-config.js` for settings, and modules patch the base UI at
runtime. Base-game overrides are verbatim copies with changes marked `ZOM:`;
they load only in a game with an Observer (modinfo criteria
`zom-observer-in-game`), so other games run the untouched files. Diagnostics go to
`UI.log`.

---

## Changelog

### 0.6.04

- **Split from Multiplayer Toolkit** — the Observer is now its own mod
  (`zatygolds-oberver-mode`); the pause, Competitive timer and lobby tooltip
  features stay in Multiplayer Toolkit. Earlier entries are the Observer's
  history inside Multiplayer Toolkit.
- **Runs alongside Multiplayer Toolkit** — every identifier (leader, civs,
  unit, text, icons, game option, UI elements, saved history) uses its own
  `ZOM` prefix, so both mods can be enabled together.
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
- **Fix:** the game waiting on the Observer after a pause; Observer
  completing Triumphs; Observer civs in Civ Unlocks; editable policies; End
  Turn showing under Auto End Turn; outdated Age-transition override.
- **Fix:** Religion button after Antiquity opens the game's Religion screen.
- **Performance:** cached ribbon data.

### 0.6.00

- Shared helpers and split Observer modules.
- **Fix:** Observer Age transitions (new Eye, no dedication prompt); portrait
  clicks; single-player Observer crash (now multiplayer only).

### 0.5.9

- **New:** Observer leader & civilization as game data, replacing the old
  observer slot and dashboard.

---

## License

Copyright (C) 2026 Zatygold. Free software under the **GNU General Public
License v3 or later**, without any warranty. See [`LICENSE`](LICENSE) or
<https://www.gnu.org/licenses/>.
