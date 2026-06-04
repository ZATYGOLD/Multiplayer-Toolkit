# Multiplayer Toolkit

A toolkit of multiplayer quality-of-life features for **Sid Meier's Civilization
VII**, built on the game's own UI components. Current version: **0.5.1**.

Two tools so far:

- A **Competitive turn timer** — a fourth Turn Timer option in multiplayer setup
  (alongside None / Standard / Dynamic) whose per-turn time scales with cities,
  units, human players and the turn number, with orange/red urgency tiers and
  warning sounds.
- A **synchronized multiplayer pause** — any player can pause; the pause menu
  opens for everyone with **Ready / Resume** and **View Map** buttons; a
  synchronized **countdown** plays before the game resumes.

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
  The mod therefore proxies the action panel's `TurnTimerUpdated` listener and
  feeds the engine's own renderer the competitive time — so the native text,
  ring meter, flash and beeps all draw the real clock — and ends the local turn
  itself via `GameContext.sendTurnComplete()`.
- Remaining time derives from the engine's **synchronized phase clock**, so
  readying, un-readying and HUD interaction cannot desync or reset it. New
  turns are detected via `Game.turn`; backward clock corrections are tolerated;
  the display pins at zero once expired.
- A periodic guardian keeps the takeover in place if the action panel
  re-attaches, and the ring meter self-heals if a stray native render or
  ready-up reset desyncs it.
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
2. **60% vote** – after `voteDelayMs`, once ≥ `voteThreshold` (default 60%) are
   ready, the remaining clients auto-ready and the game resumes.
3. **Override** – after `hostOverrideDelayMs`, any readiness resumes the game
   (anti-AFK / host force-resume).

Because the host's own flag is required for the consensus path, the host
effectively gates a normal resume; the vote/override tiers are the time-limited
fallbacks. All values are configurable in `ui/mp-pause/mp-pause-config.js`.

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
├─ text/en_us/
│  ├─ mod-info-text.xml               # mod name/description (Additional Content screen)
│  └─ mpt-text.xml                    # button captions + Competitive timer strings
├─ ui/mp-pause/                       # synchronized pause feature
│  ├─ mp-pause-config.js              # constants & tunable settings (data)
│  ├─ mp-pause.scss.js                # styles, shipped as a string
│  ├─ mp-pause-overlay.js             # reusable "UNPAUSING..." countdown overlay
│  └─ mp-pause-mgr.js                 # manager singleton / entry point
└─ ui/mp-timer/                       # competitive turn timer feature
   ├─ mp-timer-config.js              # constants & tunable settings (data)
   └─ mp-timer.js                     # takeover proxy, tiers, enforcement (logic)
```

Each feature follows the same pattern: a `*-config.js` data module and a logic
module, mirroring the base game's UI conventions.

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
