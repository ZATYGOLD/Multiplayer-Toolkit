# Multiplayer Toolkit

A toolkit of multiplayer quality-of-life features for **Sid Meier's Civilization
VII**, built on the game's own UI components. Current version: **0.5.4**.

Four tools so far:

- A **Competitive turn timer** — a fourth Turn Timer option in multiplayer setup
  (alongside None / Standard / Dynamic) whose per-turn time scales with cities,
  units, human players and the turn number, with orange/red urgency tiers and
  warning sounds.
- A **Synchronized Multiplayer Pause** — any player can pause; the pause menu
  opens for everyone with **Ready / Resume** and **View Map** buttons; a
  synchronized **countdown** plays before the game resumes. Disconnects, host
  migration and rejoin resyncs all pause the game automatically.
- **Observer mode** *(experimental)* — every player can choose **Observer**
  from the **Team** dropdown of their own lobby row to spectate instead of
  play, marked by an eye badge; picking any team switches back. In-game an
  observer gets full-map vision and a **spectator dashboard**: the player
  ribbons show every civ's **Yields**, **Research** (tech + civic),
  **Production** (per-city builds) or **Score** (victory metrics + overall
  score), with live progress. Built on the engine's own never-surfaced
  observer slot system.
- **Lobby UI fixes** — the civilization and leader tooltips in multiplayer
  game setup show each ability's **name** above its description (the base game
  omits it); and the all-ready start countdown is shortened to 5 seconds.
  Patched at runtime, so they coexist with other lobby mods.

---

## Installation

1. Copy the mod folder into your mods folder:
   `…\Sid Meier's Civilization VII\Mods\Multiplayer-Toolkit\`
2. In game: **Main Menu → Additional Content** and enable **Multiplayer Toolkit**.
3. **Every player must install and enable the mod.** The pause state and the
   turn clock are synchronized by the engine, but the menus, tallies, countdown
   display and timer enforcement run per-client, so everyone needs it.

The mod is dormant in single-player.

---

## Competitive Turn Timer

### How to use

In the multiplayer game setup, set **Turn Timer** to **Competitive** (it sits
between None and Standard) and play with **Simultaneous** turns. Each turn is
then bounded by a clock computed for the active Age:

```
seconds = Base
        + PerCity  × (most cities any civ has)
        + PerUnit  × (most units any civ has)
        + PerHuman × (living human players)
        + PerTurn  × (current turn number)
```

City/unit counts use the largest empire, so every player gets the same number —
one shared, fair clock. Decimal weights (e.g. `PerTurn = 1.25`) are supported,
and the result rounds to the nearest whole second (`roundToNearest` in
`mp-timer-config.js`). When it reaches zero the turn ends automatically; a
player who un-readies after zero is re-ended within seconds.

### Urgency tiers

| Remaining | Display | Sound |
|---|---|---|
| above 30s | normal | engine's 60s warning only |
| 30s – 16s | **orange** | urgency beep at 30 / 25 / 20 |
| 15s – 0s | **steady red** | per-second countdown beeps |

### Tuning

| What | Where |
|---|---|
| Per-Age `Base` / `PerCity` / `PerUnit` | `data/timers/<age>/CompetitiveTimer.sql` |
| Default `PerHuman` / `PerTurn` (all Ages) | `data/timers/TimerScaling.sql` |
| Per-Age `PerHuman` / `PerTurn` overrides | `UPDATE MPT_TimerScaling …` in the Age's file (see antiquity) |
| Tier thresholds, colours, sounds, debug logging | `ui/mp-timer/mp-timer-config.js` |

### Implementation notes (honest)

- The engine only *enforces* its three built-in timer types; a data-registered
  fourth type is treated as unknown (fallback 180s display, no enforcement).
  The mod therefore **subclasses the action panel component** itself:
  `MPT_PanelAction extends` the base game's `PanelAction` (via
  `Controls.getDefinition` + priority redefinition), feeds the inherited
  renderer the competitive time — so the native text, ring meter, flash and
  beeps all draw the real clock — and ends the local turn itself via
  `GameContext.sendTurnComplete()`. The subclass is only registered when
  **Competitive** is the chosen timer; any other setting runs the untouched
  base component.
- The Competitive numbers live in **mod-owned tables** (`MPT_TurnSegments`,
  `MPT_TimerScaling`) — the game's own `TurnSegments` is never modified, so the
  Dynamic timer is completely unaffected.
- Remaining time derives from the engine's **synchronized phase clock**, so
  readying, un-readying and HUD interaction cannot desync or reset it. New
  turns are detected via `Game.turn`; backward clock corrections are tolerated;
  the display pins at zero once expired.
- The ring meter is **scrubbed to the synchronized clock on every timer tick**
  (the CSS animation is restarted with a fresh offset each event), so it cannot
  drift from the number, freezes during a pause, and holds exactly empty at
  zero.
- Known cosmetic: the lobby **Rules** popup prints a debug string for the
  custom timer type (the base screen only knows the three built-ins). Age
  transitions use their own long phase and are passed through untouched.

---

## Synchronized Pause

- **Pause (any player):** open the pause menu (Esc) and click **Pause Game**.
  The game pauses for everyone and the pause menu opens on every player's screen.
- **While paused** every player sees the pause menu with:
  - **Resume (Host) / Ready** – the primary button (a working `fxs-button`; the
    native ui-next "Resume Game" hero button can't be hooked to actually unpause,
    so it is hidden while paused). A short hint sits **above** it ("You are the
    host. Resume when ready." for the host; a waiting note for others), and the
    live **"Ready: X / N"** tally sits in the **footer**, under the build number.
  - **View Map** – directly **below** the Resume button; returns you to the
    world so you can pan the map and open information / city & production panels.
    Press **Esc** to bring the pause menu back. You can look at anything; you
    just can't advance the game.
  - The **Pause Game** button (when not paused) sits **below** the menu's
    normal Resume button.
- **Resuming:** when the resume is triggered, every open pause menu is closed
  and a top-center **UNPAUSING…** overlay runs a **5-second countdown**. The game
  stays fully **paused during the countdown** (the mod re-asserts the pause flag
  for the duration), so no one can take a game-advancing action until the timer
  hits zero — only then does play actually resume, together.

### The unpause / "Ready" model

The engine keeps the game paused while **any** player holds a "want pause" flag,
and unpauses (synchronized) the instant all flags clear; a client can only clear
its **own** flag. The mod uses that primitive directly:

> flag held = "not ready", flag cleared = "ready". `Ready = N − wantPauseCount`,
> identical on every client, so the "Ready X/N" tally is synchronized for free.

Resume happens (last flag clears → engine unpauses) via, in order:

1. **Consensus** – everyone (the host included, whose flag is required) clicks
   Ready.
2. **Override** – after `hostOverrideDelayMs`, any readiness resumes the game
   (anti-AFK / host force-resume).

A third **60% vote** tier exists but is **disabled by default**
(`votingEnabled: false`); set it to `true` to re-enable auto-resume once
`voteThreshold` of players are ready after `voteDelayMs`. Because the host's
own flag is required for the consensus path, the host effectively gates a
normal resume. All values are configurable in `ui/mp-pause/mp-pause-config.js`.

**Engine limitation (honest note):** Civ VII exposes only an *aggregate*
want-pause count — there is no per-player or host-specific pause query and no
custom UI network message a mod can send. A *unilateral, instant* host-only
override that other clients could detect on the wire is therefore not possible
from a UI mod, so host authority is expressed through the configurable
thresholds above rather than as an instant force.

### Pause on disconnect (before AI takeover) — three layers

All three layers funnel into one `requestDisconnectPause()` path:

1. **Disconnect event** — `MultiplayerPostPlayerDisconnected` pauses immediately
   (reactive).
2. **Connection watchdog** — a timer polls `Network.isPlayerConnected(id)` for
   every human slot (every `connectionWatchMs`, default 0.5s) and pauses the
   instant a player's connection drops, even if the event is late or missed
   (proactive).
3. **Turn-activation guard** — on `PlayerTurnActivated` / `RemotePlayerTurnBegin`
   (the exact moment the engine would hand an absent player's turn to the AI),
   if any human is disconnected the game pauses first.

**Resume vs. re-pause.** The first drop always pauses before the AI. Once the
players *deliberately* resume with someone still absent, that player is
"acknowledged" so the guard does not fight the choice and the AI may take over.
If that player reconnects and later drops again, it is a fresh disconnect and
pauses again.

**Disconnect notices.** Each disconnected player gets their own bright-red line
in the pause menu ("Name#12345 disconnected."), using the platform gamertag
where available; a player's line clears when they rejoin.

**Host migration.** If the host drops or changes, the game pauses (if running),
"The host changed." is shown, and the menu controls rebuild so the new host
immediately gets the **Resume (Host)** button.

**Rejoin / resync.** When a player rejoins, the engine forces every client
through a resync. The mod pauses (if running) and opens the pause menu on every
screen for the duration, with "*Name* is reconnecting — resyncing."

*Honest scope:* the guarantee is as strong as a UI mod can make it — the
turn-activation guard fires at the start of turn processing, before AI orders
execute — but it is still event/poll-driven rather than a hook inside the
engine's AI loop.

### Blocked while paused

`next-action`, `keyboard-enter`, `force-end-turn`, `unit-move`,
`unit-ranged-attack`, `unit-skip-turn`, `unit-sleep`, `unit-fortify`,
`unit-heal`, `unit-alert`, `unit-auto-explore`, `trigger-accept-dip`,
`quick-load`. Camera, selection, information screens and city/production panels
are **not** blocked.

---

## Observer Mode (experimental)

### How to use

In a multiplayer lobby, open the **Team** dropdown on **your own row** and pick
**Observer** (it sits below the team numbers). Your row shows an eye badge in
the team column and "Observer" with the eye icon as your leader; your civ,
leader and memento choices are cleared and locked. Pick **any team** (or the
blank no-team entry) to switch back to playing. Each player controls only their
own role, and roles lock once you ready up — a readied or remote observer still
shows the eye badge, read-only.

In-game, an observer sees the **whole map** and a **spectator dashboard** built
on the diplomacy ribbon: every major civ's portrait with the stats pinned open
(no hovering) and a small toolbar (top-center) to switch what every ribbon
shows, one view at a time:

- **Yields** — gold, science, culture, happiness, diplomacy, settlements, trade.
- **Research** — current technology and civic: the real icon, name and a live
  progress bar.
- **Production** — each city's current build: item icon, city name and a live
  progress bar (towns are skipped — they have no production queue).
- **Score** — the victory metrics from the current victory system (Tourism,
  GDP, Dominion, Innovation) with each metric's emblem, plus the overall
  **Score** (the game's tiebreaker total).

### Implementation notes (honest)

- The engine ships a complete but never-surfaced observer subsystem
  (`SlotStatus.SS_OBSERVER`, observer IDs/counts, observer-aware lobby ready
  checks). The mod surfaces it: the Team dropdown gains the Observer entry,
  and selection routes through `Configuration.editPlayer().setSlotStatus()` —
  the same engine call the lobby's own slot actions use.
- Observers are not "participants", and the lobby renders non-participants as
  bare closed-slot rows, which would strand an observer with no controls. The
  mod re-shapes observer rows back to the full row template after every lobby
  update (display only; the engine slot status genuinely remains observer).
- Swapping into a pre-marked observer seat does **not** work — the engine
  moves slot positions without changing what you are — which is why the role
  is a self-service choice rather than a host-assigned seat.
- The in-game dashboard reads other players' data directly (yields, current
  research node, progress) — all of it readable for any player in a networked
  game — and repaints the diplo ribbon for the observer, who otherwise sees an
  empty ribbon. Progress bars use plain `<img>` + width-based bars because the
  UI renderer rejects `conic-gradient`.

### Known engine limitations (cannot be fixed from a mod)

- **No turn control or pausing for observers.** The engine does not honor an
  observer's pause request and never gives a spectator an interactive
  end-turn button (the action panel stays on "Please Wait…"). An
  observer-stepped / observer-paused game is therefore not possible from a UI
  mod; the `turnGating` switch in `mp-observer-config.js` is left **off**.
- **Lone-observer stability.** A single human *observer* watching only AI
  players crashes the game at the **Antiquity→Exploration age transition**
  (~turn 50). This reproduces with every one of the mod's in-game scripts
  disabled, so it is an engine issue with that specific configuration, not the
  mod. It is **not yet confirmed** whether it occurs in a normal game with
  other human players present — the intended use case — which is the next
  thing to verify with a real multiplayer test.
- Master switches: `observerSlots` in `mp-lobby-config.js` (lobby role) and
  `enabled` in `mp-observer-config.js` (in-game dashboard).

---

## Project structure

```
Multiplayer-Toolkit/
├─ multiplayer-toolkit.modinfo        # manifest: shell settings, per-Age data, UI scripts
├─ config/
│  └─ SetupParameters.sql             # registers the Competitive option in the lobby dropdown
├─ data/timers/
│  ├─ TimerScaling.sql                # MPT_TimerScaling schema + default PerHuman/PerTurn
│  ├─ antiquity/CompetitiveTimer.sql  # Antiquity segment values + scaling overrides
│  ├─ exploration/CompetitiveTimer.sql
│  └─ modern/CompetitiveTimer.sql
├─ icons/
│  └─ mpt_observer.png                # observer eye badge (team + leader columns)
├─ text/en_us/
│  ├─ mod-info-text.xml               # mod name/description (Additional Content screen)
│  └─ mpt-text.xml                    # button captions + timer/observer strings
├─ ui/mp-pause/                       # synchronized pause feature
│  ├─ mp-pause-config.js              # constants & tunable settings (data)
│  ├─ mp-pause.scss.js                # styles, shipped as a string
│  ├─ mp-pause-overlay.js             # reusable "UNPAUSING..." countdown overlay
│  └─ mp-pause-mgr.js                 # manager singleton / entry point
├─ ui/mp-lobby/                       # lobby UI fixes & observer role (shell scope)
│  ├─ mp-lobby-config.js              # constants & tunable settings (data)
│  ├─ mp-lobby-observer.js            # observer role: team-dropdown toggle + civ/leader clear
│  └─ mp-lobby-tooltips.js            # civ/leader ability-title tooltip patch (logic)
├─ ui/mp-observer/                    # in-game observer dashboard (game scope)
│  ├─ mp-observer-config.js           # constants & tunable settings (data)
│  ├─ mp-observer-ribbon.js           # spectator ribbon: Yields/Research/Production/Score
│  └─ mp-observer-turns.js            # observer turn-gating (off; engine-limited)
├─ ui/mp-timer/                       # competitive turn timer feature
│  ├─ mp-timer-config.js              # constants & tunable settings (data)
│  └─ mp-timer.js                     # MPT_PanelAction subclass: tiers, ring sync, enforcement
└─ TESTING.md                         # FireTuner test guide + MPTTimer debug API
```

Each feature follows the same pattern: a `*-config.js` data module and a logic
module, mirroring the base game's UI conventions. See [`TESTING.md`](TESTING.md)
for live-testing with FireTuner.

---

## Changelog

### 0.5.4

- **New: in-game observer dashboard** — an observer now sees the whole map and
  a spectator view on the diplomacy ribbon (every major civ's portrait, which
  the base ribbon leaves blank for a spectator), with stats pinned open (no
  hovering). A top-center toolbar toggles all ribbons between four views:
  **Yields**, **Research** (current tech + civic), **Production** (per-city
  builds), and **Score** (the current victory metrics — Tourism, GDP, Dominion,
  Innovation — plus the overall Score). Research and Production show live
  progress bars.
- **Lobby:** the all-ready start countdown is shortened to 5 seconds
  (configurable via `startCountdownSeconds`), with the countdown ring patched
  to fill correctly for the shorter time.
- **Observer setup:** converting to observer now also clears the slot's
  civ/leader, not just the team.
- **Observer limitations found (engine, not moddable):** the engine ignores an
  observer's pause and never gives a spectator an interactive end-turn button,
  so observer turn-control / pausing is not possible (the `turnGating` switch
  ships off). A lone human observer watching only AI also crashes at the
  Antiquity Turn 50 and above — this reproduces with all of the mod's
  in-game scripts disabled, so it is an engine issue with that solo
  configuration; whether it affects a normal game with other humans is still to
  be confirmed.

### 0.5.3

- **New: Observer mode (lobby, experimental)** — pick **Observer** from your
  own row's Team dropdown to spectate instead of play; pick any team to switch
  back. Eye badge in the team column, observer "leader", civ/leader/mementos
  locked while observing; roles lock on ready-up. Surfaces the engine's own
  hidden observer slot system.
- **Investigated, not shipped: more players in multiplayer** — the lobby's
  slot capacity can be raised from a mod, but the engine natively validates
  multiplayer player counts against the hosting platform at launch
  (`BAD_MAPSIZE` / "Map Size Unsupported") and hard-caps network games at 8
  players. Not moddable from data or UI scripts; mods like Scapeh's Unlocked
  Player Limits work in single player only for the same reason.
- **New: Lobby UI fixes** — the game-setup civilization and leader tooltips
  now show each ability's name above its description. Same fix as the
  "Multiplayer UI Fix" Workshop mod (credit to p0kiehl for spotting it),
  reimplemented as a runtime patch instead of a base-file replacement.
- **Removed: "Waiting for Players" tooltip** — redundant with the base game:
  the end-turn button's own waiting tooltip already lists the pending players,
  and the diplo ribbon marks every player whose turn is still active.
- **Timer architecture:** the takeover proxy and guardian are gone — the mod
  now registers `MPT_PanelAction`, a subclass of the game's own action panel
  component, and only when **Competitive** is the selected timer; every other
  setting runs the genuine base component.
- **Timer data separation:** Competitive values moved to mod-owned tables
  (`MPT_TurnSegments`, `MPT_TimerScaling`); the game's `TurnSegments` is never
  touched, so the Dynamic timer is completely independent again.
- **Ring sync:** the ring meter is scrubbed to the synchronized phase clock on
  every timer tick instead of free-running — no more jumps or drift against
  the countdown number, and it holds exactly empty at zero.

### 0.5.2

- **New: "Waiting for Players" tooltip** — hover the end-turn button to see who
  everyone is waiting on, one name per line, expanding upward.
- **Timer:** decimal scaling weights supported (e.g. `PerTurn = 1.25`); totals
  round to the nearest whole second (`roundToNearest`); the ring now freezes
  while the game is paused and resyncs on resume.
- **Pause:** the 60% vote-resume tier is disabled by default
  (`votingEnabled`); disconnect notices show each player's gamertag on its own
  bright-red line and clear on rejoin; host migration pauses the game and hands
  the new host the resume controls; a player rejoining pauses the game and
  opens the pause menu on every client during the resync.
- **Lobby:** the Competitive timer's setup description now explains the
  scaling, tiers and auto-end behaviour.
- **Dev:** FireTuner test guide (`TESTING.md`) and an in-game `MPTTimer` debug
  console API (status / forceRemaining / expire), active while `debug` is on.

### 0.5.1

- Competitive turn timer: per-Age scaling, orange/red urgency tiers with
  warning sounds, native ring/text rendering, automatic turn end.
- Code reorganization: config/logic module split for every feature.

---

## License

Copyright (C) 2026 Zatygold

Multiplayer Toolkit is free software: you can redistribute it and/or modify it
under the terms of the **GNU General Public License** as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <https://www.gnu.org/licenses/>. The full text is in
the [`LICENSE`](LICENSE) file.
