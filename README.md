# Enhanced Pause Menu

A multiplayer pause system for **Sid Meier's Civilization VII**. Any player can
pause the game, only the **host** can resume it, a pause overlay is shown to
everyone, an end-pause **countdown** plays before play resumes, and all input
that would advance the game is blocked while paused — while you can still pan
the map, zoom, and read information.

This mod is built entirely on top of the game's own multiplayer-pause netcode
(`Network.toggleMultiplayerPause` / the synchronized `GamePauseStateChanged`
event). It does **not** modify any base-game files.

---

## Installation

1. Copy the whole **`Enhanced Pause Menu`** folder into your Civ VII mods
   folder (this is where it already lives if you are reading this):

   `…\Sid Meier's Civilization VII\Mods\Enhanced Pause Menu\`

2. Launch Civ VII → **Main Menu → Additional Content** (Mods) and make sure
   **Enhanced Pause Menu** is enabled.

3. **Every player in the multiplayer game must install and enable the mod.**
   The pause *state* itself is synchronized by the game engine, but the
   overlay, the host-only resume rules, the countdown, and the host-ownership
   handoff all run inside this script on each machine, so everyone needs it for
   the experience to be consistent.

The mod is inert in single-player games (the normal pause menu already freezes
single-player), so it is safe to leave enabled all the time.

---

## How to use it

- **Pause (any player):** click the **“Pause Game”** button (top-center of the
  screen) at any time during a multiplayer game. The game pauses for everyone.
- **While paused:** everybody sees the **GAME PAUSED** overlay. You can still
  drag/rotate/zoom the camera and open information screens (tech tree, civics,
  Civilopedia, rankings, etc.). Anything that would *advance* the game —
  ending the turn, moving or ordering units, etc. — is blocked.
- **Resume (host only):** only the host sees a **Resume** button. Clicking it
  starts a synchronized **3 · 2 · 1** countdown on every player's screen, then
  hands control back to everyone at once.

---

## How each requirement is met

| # | Requirement | Implementation |
|---|-------------|----------------|
| 1 | **Pause overlay** | A DOM overlay (`#epm-overlay`) is shown on every client from the synchronized `GamePauseStateChanged` event. Its backdrop is `pointer-events:none` so the map underneath stays fully interactive. |
| 2 | **End-pause countdown** | When the host resumes, the engine fires `GamePauseStateChanged(unpaused)` on all clients at the same instant. Each client then runs an identical 3-2-1 countdown — keeping the overlay up and input blocked — before releasing control, so the countdown is synchronized with no custom messaging. |
| 3 | **Only the host can unpause** | Host is detected via `GameContext.localPlayerID === Network.getHostPlayerId()`. Only the host's overlay has a Resume button, and the stock `multiplayer-pause` keybind is filtered out so no one can toggle pause behind the mod's back. Because the engine tracks a *per-player* "want pause" flag (and a client can only clear its own), the mod performs a **host-ownership handoff**: when a non-host starts a pause, the host adds its own flag and the original initiator drops theirs — leaving the host as the sole flag holder, so only the host can clear the pause. |
| 4 | **Any player can pause** | The on-screen “Pause Game” button calls `Network.toggleMultiplayerPause()` for any player. Routing every pause through the mod's button is what lets each client know whether it started the pause (needed for the handoff in #3). |
| 5 | **Block progressing input, allow reading/looking** | While paused (and during the countdown) all game-advancing input actions are registered with the engine's `InputFilterManager`, which sits first in the input-handler chain and blocks them before any gameplay handler runs. Camera actions (pan/rotate/zoom) and information screens are deliberately left untouched. The engine pause already freezes the simulation on every client, so no progression can occur regardless. The stock modal “Game Paused” popup (which would block the map) is suppressed so the map stays viewable. |

### Blocked input actions while paused
`next-action`, `keyboard-enter` (end turn / confirm), `force-end-turn`,
`unit-move`, `unit-ranged-attack`, `unit-skip-turn`, `unit-sleep`,
`unit-fortify`, `unit-heal`, `unit-alert`, `unit-auto-explore`,
`trigger-accept-dip`, `quick-load`, and the stock `multiplayer-pause` keybind.

### Deliberately **not** blocked (reading / looking is allowed)
Camera pan/rotate/zoom, mouse-wheel, edge/scroll pan, plot-cursor movement,
unit cycling, tooltips, and all `open-*` / `toggle-*` information screens.

---

## Design notes & assumptions

- **The engine pause is the real lever.** In a networked game the authoritative
  turn timer lives on the host/server, so a UI-only block could never truly
  stop progression on other machines. Using `Network.toggleMultiplayerPause`
  means the simulation is genuinely frozen on every client; the overlay and
  input filter are the player-facing layer on top of that.
- **Per-player "want pause" model.** The base game's in-game manager
  (`ui/mp-ingame-mgr/mp-ingame-mgr.js`) and the string
  `"{1_Number} Players have paused the game including {2_PlayerName}"` show that
  the game stays paused while *any* player wants pause, and each player toggles
  only their own flag. The host-ownership handoff (#3) is built around this
  model so that "only the host can resume" is enforceable.
- **Countdown timing.** The countdown is triggered by the synchronized unpause
  event, so for the few seconds it plays the simulation has technically already
  resumed — but local input stays blocked and the overlay stays up until the
  count reaches zero, so no player can act before everyone is released
  together. This keeps the countdown perfectly in sync with zero custom
  network traffic.
- **Graceful degradation.** Core singletons (`InputFilterManager`,
  `ContextManager`) are loaded with a small list of candidate import paths and
  `try/catch`. If a future patch moves them, the mod still pauses/overlays/
  counts down correctly; only the extra input-filtering / popup-suppression
  niceties would be reduced (and the engine pause still prevents progression).

---

## Files

```
Enhanced Pause Menu/
├─ enhanced-pause-menu.modinfo   # mod manifest (loads the UI script in-game)
├─ ui/
│  └─ epm-pause-manager.js       # all logic: overlay, countdown, input filter,
│                                #   host-only resume, any-player pause
└─ README.md
```

No base-game files are modified.
