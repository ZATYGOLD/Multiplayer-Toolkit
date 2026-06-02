# Enhanced Pause Menu

A multiplayer pause for **Sid Meier's Civilization VII**, built on the game's
own pause menu and UI components. Any player can pause; the pause menu opens for
everyone with a **Ready / Resume** button and a **View Map** button; a
synchronized **countdown** plays before the game resumes. No base-game files are
modified.

---

## Installation

1. Keep/copy the **`Enhanced Pause Menu`** folder in your mods folder:
   `…\Sid Meier's Civilization VII\Mods\Enhanced Pause Menu\`
2. In game: **Main Menu → Additional Content** and enable **Enhanced Pause Menu**.
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
| **Pause before the AI takes over** on pause / disconnect | A manual pause freezes the synchronized simulation immediately, so the AI never acts while paused. On a **player disconnect** the mod pauses instantly from the `MultiplayerPostPlayerDisconnected` event — before the next turn-processing step where the AI would take over the absent player. The AI resumes control normally once the game is unpaused if that player hasn't returned. |

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
`ui/epm-pause-manager.js`:

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

### Pause on disconnect (before AI takeover)

When any player drops, every remaining client receives
`MultiplayerPostPlayerDisconnected` and immediately requests the pause, so the
networked simulation halts before the AI can take the disconnected player's
turn. The pause menu then opens for everyone with a note naming who dropped, and
the usual Ready / vote / override rules decide when to resume. If the player
reconnects (or the game resumes), the AI takes over only from the moment play
continues, exactly as the base game would.

*Honest scope:* a UI mod reacts to the disconnect **event** (it cannot pre-empt
the engine's internal scheduler below that), but in Civ VII's multiplayer flow
that event precedes the turn-processing where AI actions for an absent player
occur, so the pause lands first in normal play.

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

## Files
```
Enhanced Pause Menu/
├─ enhanced-pause-menu.modinfo          # manifest (loads text + UI script in-game)
├─ text/en_us/EnhancedPauseMenuText.xml # button caption strings
├─ ui/epm-pause-manager.js              # all logic
└─ README.md
```
No base-game files are modified.
