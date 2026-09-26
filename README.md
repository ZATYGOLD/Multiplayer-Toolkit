# Multiplayer Toolkit

A toolkit of multiplayer quality-of-life features for **Sid Meier's Civilization
VII**, built on the game's own UI components. Current version: **0.6.00**.

Four tools so far:

- A **Competitive turn timer** — a fourth Turn Timer option in multiplayer setup
  (alongside None / Standard / Dynamic) whose per-turn time scales with cities,
  units, human players and the turn number, with orange/red urgency tiers and
  warning sounds.
- A **Synchronized Multiplayer Pause** — any player can pause; the pause menu
  opens for everyone with **Ready / Resume** and **View Map** buttons; a
  synchronized **countdown** plays before the game resumes. Disconnects, host
  migration and rejoin resyncs all pause the game automatically.
- **Observer leader & civilization** *(experimental)* — pick **Observer** as
  your leader and civilization in game setup or the multiplayer lobby to watch
  a game as a real player with no empire: whole-map vision, the normal HUD,
  pause and End Turn all work, and you are never eliminated. See Observer Mode.
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
        + PerHuman × (living human players, Observers excluded)
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

- **Pause (any player):** open the pause menu (Esc) and click **Pause Game**,
  or press the **Pause Game** key (default **P**, rebindable in Options ->
  keyboard mapping; while paused it toggles your readiness). The game pauses
  for everyone and the pause menu opens on every player's screen.
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

In the multiplayer lobby pick **Observer** in either the **Leader** or the
**Civilization** dropdown - the other one follows, the team is cleared and both
the civilization and team columns lock with the eye badge (pick any other
leader to play again; "Observer" is also an entry in the Team dropdown). In-game you are a normal player: every turn you press
**End Turn** (or let the turn timer do it), you can pause, chat and open every
screen. In place of a Founder you get the **Observer's Eye**: a hidden,
sleeping naval unit whose sight covers the whole map, so every unit shows live.
Its flag is hidden and it cannot be selected; click (left or
right) your own portrait on the ribbon to jump to it. You never own a settlement. At an
Age transition pick **Observer** again (it is the only civilization the
Observer leader unlocks).

The diplomacy ribbon shows **every** living leader (a unit-less empire never
"meets" anyone, so the base ribbon would stay empty), stats pinned open, with
the Observer's own card at the right edge. That card has no stats; it holds
round icon buttons (the game's own mini-map lens button with its yield
glyphs) that switch every other card between **Yields / Research /
Production / Score**. Observers are never listed on the Victories screens or
the age rankings, on any client, and the Observer sees every leader's real
name there instead of "An unmet Player". Left-click any leader's portrait to jump the camera to
their capital; right-click also opens their leader panel; click a settlement banner or city-center tile to open that
leader's diplomacy panel (shown without the ribbon), whose war section lists
every war that leader is in and whose relationships leave out the Observer.
Portraits turn angry for leaders at war and happy for leaders in a
celebration; a celebrating leader's portrait and civ banner glow gold, and
leaders at war with each other share a portrait highlight colour (one colour
per war, with a coloured pip under the portrait for each war a leader is in). Every unit stays in
sight, military and civilian, so war moves, scouts, merchants, settlers,
missionaries and commanders can be followed live. Click any unit (tile or
flag; click the tile again to cycle a stack) to select it with the game's own
selection, so the base unit panel shows it; with a combat unit selected,
hover another player's unit for the game's own combat preview window. The
game only simulates combat for the local player's own units (even a leader's
unit against an independent it is at war with gets no answer), so the window
shows an estimate from base strengths and health, with an "Estimate" note
above the outcome; the window sits higher so the unit panel does not cover it. Move ranges and
paths are not drawn for other players' units, and no order is ever sent for
them.
The Religion button lists every leader's pantheon. The advisor screens,
narrative events (crises included), diplomacy dialogs (first meetings
included; first meetings get the neutral greeting automatically), the
end-of-age countdown popup and crisis / age-progress / "player
met" / agenda notifications never interrupt the Observer. At each new Age the
Observer skips dedications and capital choice (it has no settlement) and gets
a new Eye. The Observer's Eye
sits on the Ocean / Marine / Ice tile nearest the bottom-center of the map,
out of every player's reach.

### Implementation notes (honest)

- This is a data mod, not a UI hack. `LEADER_MPT_OBSERVER` and one
  `CIVILIZATION_MPT_OBSERVER_<AGE>` per Age are defined exactly the way the
  base game defines its leaders and civilizations (gameplay `Leaders`,
  `Civilizations`, `CivilizationTraits`, `Unlocks`, and the lobby-side config
  `Leaders`/`Civilizations` tables), with no abilities, no `TRAIT_<AGE>_CIV`
  package (so no free army or ship), and reused "unknown" portrait/symbol art.
- Start positions come from the game's `maps/assign-starting-plots.js`; the
  mod ships a copy that wraps `StartPositioner.setStartPosition` so Observer
  players start on the Ocean / Marine / Ice tile nearest the bottom-center of
  the map. Ice is impassable: a unit created on it is left off the map
  (-9999,-9999), with no vision. So the Eye is created on the neighbouring
  open water (valid in every Age through the Exploration deep-ocean tech
  effects) and moved onto the ice with `Units.setLocation`, which the engine
  accepts; it stays on the water if the move fails. Like the other base-file override, re-check it after game updates.
- Starting units are per Age, not per civ, so the Founder cannot be skipped
  in data. The Observer civs replace it (`UnitReplaces`) with the Observer's
  Eye, a naval unit. The game never places the Observer's starting unit, so
  the map script creates the Eye (`Units.create`) on the start plot; the
  replacement only guarantees the Observer never gets a real Founder. Eye stats: sight 128 through terrain and vegetation (the Chasqui / Hulche
  effects), sees hidden units, keeps every unit's plot visible (the Squadron
  "Spotting" effect without its limits), stealthed, cannot be damaged, no
  3D model. It keeps 1 move (0 moves crashes new-game setup) and
  `mp-observer-eye.js` keeps it asleep so it never asks for orders. A
  player only sees units on plots in its sight; revealing the map is not
  enough, so the mod no longer reveals the map and relies on the Eye.
- Default defeat ("no cities and no founder") gets an extra inverse
  leader-match requirement so the Observer is never eliminated.
- UI.log reports `units on visible plots: N/M` each turn to confirm the
  Eye's vision.
- Narrative stories sent to the Observer are answered automatically with
  their first available choice (they cannot be skipped, and would otherwise
  wait on the Observer).
- The Observer counts as having met every leader (UI only: its own
  `hasMet`), so names, portraits and war rows show everywhere. Its leader
  panel has no diplomatic action buttons.

### Known limits

- Multiplayer only: single-player game setup never lists the Observer (it has
  no leader or banner 3D art, and picking it there crashed the game).
- The Observer's Eye has no art of its own: the game shows a generic ship on
  its ice tile, visible only to the Observer (its flag is hidden).
- The combat preview between other players' units is an estimate (base
  strengths and health only).
- A "Random" leader or civilization can in principle resolve to the Observer,
  since it sits in the standard leader and civilization lists.
- Requires the same mod on every client (it changes gameplay data).

---

## Project structure

```
Multiplayer-Toolkit/
├─ multiplayer-toolkit.modinfo        # manifest: shell + game action groups, per-Age timer data
├─ config/                            # setup (lobby) database
│  ├─ SetupParameters.sql             # the Competitive option in the turn-timer dropdown
│  ├─ mpt-input.sql                   # rebindable "Pause Game" keyboard action (default P)
│  └─ observer-config.xml             # Observer leader + one civ per Age
├─ data/observer/                     # gameplay database: the Observer
│  ├─ observer-leader.xml             # leader, defeat exemption
│  ├─ observer-civilizations.xml      # one civ per Age + age-transition unlocks
│  ├─ observer-units-gameeffects.xml  # Observer's Eye ability modifiers
│  ├─ observer-units.xml              # Observer's Eye: whole-map sight unit (replaces UNIT_FOUNDER)
│  ├─ observer-icons.xml              # portraits / symbols / Eye flag icon
│  └─ observer-colors.xml             # player colors
├─ data/timers/                       # gameplay database: Competitive timer numbers
│  ├─ TimerScaling.sql                # schema + default values
│  └─ <age>/CompetitiveTimer.sql      # per-Age tuning
├─ icons/                             # eye badge + hex/circle leader portraits
├─ maps/assign-starting-plots.js      # base-game override: Observer start + Eye creation (marked MPT:)
├─ maps/mpt-observer-eye.js           # Observer's Eye placement, shared by the two gameplay-script overrides
├─ scripts/age-transition-post-load.js  # base-game override: a new Eye each Age (marked MPT:)
├─ ui-next/screens/victories/victories-screen-model.js  # base-game override: no Observers on the Victories screens (marked MPT:)
├─ text/en_us/
│  ├─ mod-info-text.xml               # mod name / description
│  └─ mpt-text.xml                    # every in-game string
└─ ui/
   ├─ mpt-shared/mpt-util.js          # shared helpers: logger, method wrapping, deferred patching, Observer identity
   ├─ mp-keybind/mp-keybind.js        # lists the pause action in the keyboard-mapping options
   ├─ mp-lobby/                       # lobby (shell scope)
   │  ├─ mp-lobby-config.js
   │  ├─ mp-lobby-observer.js         # Observer role: one civ entry, leader/civ/team kept in sync and locked
   │  └─ mp-lobby-tooltips.js         # ability titles in tooltips, shorter start countdown
   ├─ mp-pause/                       # synchronized pause
   │  ├─ mp-pause-config.js
   │  ├─ mp-pause.scss.js             # styles, shipped as a string
   │  ├─ mp-pause-overlay.js          # "UNPAUSING..." countdown overlay
   │  ├─ mp-pause-net.js              # hidden commands over chat (host resume for all)
   │  └─ mp-pause-mgr.js              # pause manager
   ├─ mp-timer/                       # Competitive turn timer
   │  ├─ mp-timer-config.js
   │  └─ mp-timer.js                  # panel-action subclass: clock, tiers, ring, enforcement
   └─ mp-observer/                    # in-game Observer (every module no-ops for other players)
      ├─ mp-observer-config.js
      ├─ mp-observer-core.js          # Observer seat, watched players, war pairs, diplomacy modes
      ├─ mp-observer-overview.js      # reusable every-leader list panel (pantheons)
      ├─ mp-observer-screens.js       # screen routing: advisor blocked, religion -> overview
      ├─ mp-observer-ribbon.js        # ribbon model: every leader, pinned stats, moods, views
      ├─ mp-observer-ribbon-data.js   # Research / Production / Score rows
      ├─ mp-observer-ribbon-style.js  # fixed card size, celebration / war highlights
      ├─ mp-observer-ribbon-toolbar.js  # view buttons on the Observer's card
      ├─ mp-observer-navigation.js    # portrait / banner / city-center clicks
      ├─ mp-observer-victory.js       # Observers left out of victory data
      ├─ mp-observer-diplomacy.js     # met everyone; leader panel: wars, no actions, no Observer rows
      ├─ mp-observer-units.js         # selecting other players' units, with guards
      ├─ mp-observer-combat.js        # combat preview between other players' units
      ├─ mp-observer-eye.js           # the Eye: hidden flag, kept asleep, vision diagnostics
      └─ mp-observer-prompts.js       # no narrative / meeting / diplomacy / crisis / age-countdown prompts
```

Each feature has a `*-config.js` module for its settings and constants, and
every module patches the base UI at runtime (the two base-game overrides above
are the exceptions, marked `MPT:`). Diagnostics go to `UI.log` through the
shared logger; features with a `debug` setting log more when it is on.

---

## Changelog

### 0.6.00

- **Cleanup:** shared helpers (`ui/mpt-shared/mpt-util.js`) for logging,
  method wrapping and deferred patching across every feature; the Observer's
  ribbon split into model / rows / look / buttons / navigation modules; all
  logs reach `UI.log`; pause-menu texts are localized and player names are
  shown as plain text; Observers no longer count as human players for the
  Competitive timer or for disconnect pauses; pause/resume chat commands no
  longer play the chat sound or mark chat unread once chat has been opened.
- **Fix: Observer Age transitions.** The Observer's Eye is recreated each Age
  (units are reset), and the dedication / capital step is completed for the
  Observer instead of prompting.
- **Fix: ribbon portrait clicks** (left: capital; right: capital and leader
  panel) no longer fall through to the base ribbon.
- **Fix: picking the Observer in single-player setup crashed the game.** The
  Observer is now hidden from single-player setup (a remembered pick resets to
  Random); it stays available in the multiplayer lobby.

### 0.5.9

- **New (experimental): Observer leader & civilization** — a full restart of
  the observer feature as game data instead of UI hacks. Pick **Observer** as
  leader and civilization; you are a real player with a valid id (so the HUD,
  pause and End Turn work natively), your Founder is replaced by the hidden
  Observer's Eye whose sight covers the whole map, and you
  are exempt from the "no cities" defeat. Requires the mod on all clients.
  The Observer sees and can select every unit live, sees
  every leader's wars in their diplomacy panel, and its ribbon portraits glow
  gold for celebrations and colour-match leaders at war with each other.
  Crisis, narrative and end-of-age prompts no longer interrupt the Observer,
  and the leader panel shows no ribbon.
- **Removed: the old Observer slot role and in-game dashboard.** Findings kept
  for the record: an observer slot has no player in-game, the September 16
  game update made `advice-manager.js` throw at load for the seatless observer
  id (aborting the base HUD), the engine ignores an observer's pause and never
  waits on it, and `Autoplay.setObserveAsPlayer` is a no-op outside Autoplay.
- **Fix: Competitive timer ending turns from the start** — the untimed opening
  turn is now counted from the first turn the session sees (not a fixed turn
  number), and the clock stays full until you have founded a settlement, so a
  late capital no longer lands on an already-expired timer. The timer still ends
  your turn when it reaches 0, including in solo host games
  (`minPlayersToEnforce` can be raised to 2 to disable that for solo).
- **Fix: timer-ended turns no longer cancel unit orders** — when the timer ran
  out it skipped every "ready" unit, which could overwrite auto-explore and
  multi-turn move orders. It now only skips genuinely idle units, and only when
  the game is actually refusing to end the turn because of them. Automated,
  path-following, sleeping and healing units are left alone, and the force-end
  now mirrors the native End Turn button.

### 0.5.8

- **Pause: reworked resume** — removed the voting/auto-resume tiers. Any player
  can pause. The game unpauses either when every **connected** player readies
  (consensus), or instantly when the host presses **"Resume (All Players)"**,
  which unpauses for everyone at once. Disconnected players are excluded from the
  ready tally. (`hostAuthoritativeResume` toggles the host button.)
- **Pause / Drop: fixed the disconnect stall** — a player who dropped while
  paused left a pause-flag nobody else could clear, so the game could never
  unpause even with everyone ready. The host now gets a **"Drop Disconnected &
  Resume"** button (shown only while a player is disconnected) that kicks the
  dropped player *and* resumes all remaining connected players in one press.
- Under the hood: added a chat-based cross-client command channel (hidden from
  the chat window) that lets the host drive a synchronized resume on every
  client - the technique behind host-authoritative resume.
- Note: with the auto-resume timers gone, a *connected* player who never readies
  holds the pause until the host resumes (pure consensus otherwise).

### 0.5.7

- **Observer: Escape / pause menu works** — observers can open the pause menu
  again (pause, resume, quit) instead of being stuck with alt+F4.
- **Observer: leader ribbons show in multiplayer** — fixed observer detection so
  the per-player ribbon (Yields / Research / Production / Score) populates for
  real MP observers, not just solo tests.
- **Observer: city centers in full-map view** — city banners are forced visible
  while spectating the full map (experimental).
- **Observer: reliable "view as player"** — right-click a leader to see their
  revealed map and fog of war; right-click again, or another leader, to switch
  or return to the full map. Each leader shows a "Player View - Right Click"
  tooltip. (Previously you could get stuck in one player's view.)
- **Known limit:** a multiplayer observer still occupies a player slot — the
  engine provides no slot-free spectator for multiplayer.
- **Competitive timer retuned** — one shared formula across all ages, tuned so
  estimated turn lengths hit the intended per-age targets.

### 0.5.6

- **New (experimental): observer "view as player"** — while observing, right-click
  a leader on the ribbon to see the game from that player's perspective (their
  revealed map and fog of war); right-click the same leader again for the full
  map. The camera jumps to that player's capital. Toggle with `viewAsEnabled`.
  Confirmed to switch the view in a live observer session; fog-of-war behavior
  still needs verifying with real human players.

### 0.5.5

- **New: rebindable pause keybind** — pause is bound to **P** by default and can
  be reassigned in Options → Keyboard Mapping.
- **Competitive timer fixes** — no longer skips your capital-founding turn or
  force-ends every round.
- **The timer can't be stalled** — opening a settlement panel no longer pauses
  or resets it, and it keeps beeping while panels are open. Only a pause stops
  the clock.
- **Strict expiry** — when time runs out the turn ends even with pending choices
  (research, civic, city growth, narrative), which are skipped.
- **Timer starts on turn 2**, leaving turn 1 free to found your capital and pick
  research.
- **Retuned Competitive timing** per age for shorter turns.

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
