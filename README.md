# Multiplayer Toolkit

A toolkit of multiplayer quality-of-life features for **Sid Meier's Civilization
VII**, built on the game's own UI components.

The first tool is a **synchronized multiplayer pause**: any player can pause;
the pause menu opens for everyone with a **Ready / Resume** button and a
**View Map** button; a synchronized **countdown** plays before the game resumes.

> Note: the mod id is now `multiplayer-toolkit` (manifest:
> `multiplayer-toolkit.modinfo`) and the display name is **Multiplayer Toolkit**.
> The on-disk folder is still named `Enhanced Pause Menu` — the game identifies
> mods by the id, not the folder, so this is fine; rename the folder to
> `Multiplayer Toolkit` if you like. Because the id changed, **re-enable the mod
> once** in **Additional Content**.

---

## Installation

1. Keep/copy the mod folder (currently **`Enhanced Pause Menu`**) in your mods folder:
   `…\Sid Meier's Civilization VII\Mods\Enhanced Pause Menu\`
2. In game: **Main Menu → Additional Content** and enable **Multiplayer Toolkit**.
3. **Every player must install and enable the mod.** The pause *state* is
   synchronized by the engine, but the menu, ready tally, countdown and resume
   rules run per-client, so everyone needs it.

The mod is dormant in single-player.

---

## How to use

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

---

## How each requirement is met

| Requirement | Implementation |
|---|---|
| Pause button **in the pause menu** | An `fxs-button` (the game's own button component) labelled **Pause Game** is injected into the built-in pause menu's `#pause-menu-button-container`. |
| **View Map** button, only while paused | An `fxs-button` reusing the game's existing **`LOC_ADVANCED_START_VIEW_MAP`** ("View Map") string, shown only when paused. It calls `InterfaceMode.switchToDefault()` to return to the world; Esc re-opens the pause menu. |
| Pause menu **opens for all** with **Ready** + **View Map** | On the synchronized `GamePauseStateChanged` event every client opens `INTERFACEMODE_PAUSE_MENU` and the Ready / View Map buttons + "Ready X/N" tally are injected. |
| **Countdown** appears when unpausing, game stays paused during it | When all flags clear, each client immediately re-asserts its pause flag and runs a 5-second top-center **UNPAUSING…** countdown; the engine only truly unpauses when every client's countdown has finished, so no game-advancing action is possible during the timer. |
| **Ready tally is unmissable** | The footer "Ready: X / N" is large and turns **bright red** until enough players are ready, then **bright green** (≥ the vote threshold). |
| See **production / town panels**, but can't advance | Only game-advancing input actions are filtered (see below). Selecting cities/units and opening production & information panels is allowed; the engine pause prevents any change from actually taking effect. |
| **Pause before the AI takes over** on pause / disconnect | Three layers: the `MultiplayerPostPlayerDisconnected` event, a `Network.isPlayerConnected` watchdog polled every 0.5s, and a turn-activation guard (`PlayerTurnActivated` / `RemotePlayerTurnBegin`). Any human drop pauses the game before the AI can take that player's turn. After a deliberate resume the AI may take over an acknowledged absentee; a fresh drop pauses again. |

### The unpause / "Ready" model

The engine keeps the game paused while **any** player holds a "want pause" flag,
and unpauses (synchronized) the instant all flags clear; a client can only clear
its **own** flag. The mod uses that primitive directly:

> flag held = "not ready", flag cleared = "ready". `Ready = N − wantPauseCount`,
> identical on every client, so the "Ready X/N" tally is synchronized for free.

Resume happens (last flag clears → engine unpauses) via, in order:

1. **Consensus** – everyone (the host included, whose flag is required) clicks
   Ready.
2. **60% vote** – after `VOTE_DELAY` seconds, once ≥ `VOTE_THRESHOLD` (default
   60%) are ready, the remaining clients auto-ready and the game resumes.
3. **Override** – after `HOST_OVERRIDE_DELAY` seconds, any readiness resumes the
   game (anti-AFK / host force-resume).

Because the host's own flag is required for the consensus path, the host
effectively gates a normal resume; the vote/override tiers are the time-limited
fallbacks you asked for. All values are configurable at the top of
`ui/mp-pause/mp-pause-config.js`:

```
RESUME_COUNTDOWN_SECONDS, VOTE_THRESHOLD, VOTE_DELAY_MS, HOST_OVERRIDE_DELAY_MS
```

**Engine limitation (honest note):** Civ VII exposes only an *aggregate*
want-pause count — there is no per-player or host-specific pause query and no
custom UI network message a mod can send. A *unilateral, instant* host-only
override that other clients could detect on the wire is therefore not possible
from a UI mod, so host authority is expressed through the configurable
thresholds above rather than as an instant force. If you'd prefer a strict
"only the host's flag controls the pause" model (clean instant host resume, but
no cross-client ready/vote tally), that's a one-setting change — just ask.

### Pause on disconnect (before AI takeover) — three layers

Preventing the AI from acting for a dropped player is the most important
guarantee of this mod, so it is defended at **every UI hook the engine exposes**
(a UI mod cannot run code inside the engine's AI turn-processing itself). All
three layers funnel into one `requestDisconnectPause()` path:

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
"acknowledged" so the guard does not fight the choice and the AI may take over
(as you specified). If that player reconnects and later drops again, it is a
fresh disconnect and pauses again.

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

## Notes

- The earlier "clicking a unit removed the UI" bug is fixed: it was caused by a
  continuous DOM observer that popped the wrong UI context. That mechanism is
  gone. The stock modal "Game Paused / [player] has paused the game" popup is now
  suppressed at the source — the mod shares the engine's `DialogBoxManager`
  singleton and intercepts that one popup (by its `LOC_MP_PAUSE_POPUP_TITLE`
  title) so it is never created, while every other dialog passes through
  untouched. Buttons are injected only when the pause menu actually opens (via
  the `interface-mode-changed` event).
- Core singletons are imported with several candidate paths and `try/catch`; if
  a future patch relocates them the mod still pauses, shows the menu and counts
  down (only the input-filter / popup-dismiss niceties would degrade).

## Project structure

```
Enhanced Pause Menu/
├─ multiplayer-toolkit.modinfo        # manifest (loads text + UI scripts in-game)
├─ text/en_us/mp-pause-text.xml       # button caption strings (LOC_EPM_*)
├─ ui/mp-pause/                       # feature folder (mirrors the base game's ui/<feature>/)
│  ├─ mp-pause-config.js              # constants & tunable settings (data)
│  ├─ mp-pause.scss.js                # styles, shipped as a string (base "*.scss.js" convention)
│  ├─ mp-pause-overlay.js             # reusable "UNPAUSING..." countdown overlay component
│  └─ mp-pause-mgr.js                 # manager singleton / entry point (mirrors mp-ingame-mgr.js)
└─ README.md
```

The manager is a class-based singleton constructed on `engine.whenReady`, like the
base game's `mp-ingame-mgr.js`. Tunables live in `mp-pause-config.js`
(`CONFIG.resumeCountdownSeconds`, `voteThreshold`, `voteDelayMs`,
`hostOverrideDelayMs`, …); styles live in `mp-pause.scss.js`.

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