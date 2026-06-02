/**
 * Enhanced Pause Menu - synchronized multiplayer pause manager.
 *
 * Loaded as an in-game UIScript (scope="game"). It activates only when the
 * current game is a multiplayer game; in single-player it does nothing (the
 * stock pause menu already pauses the simulation there).
 *
 * Design summary (see README.md for the full rationale):
 *
 *   - The authoritative pause is the engine's own multiplayer pause
 *     (Network.toggleMultiplayerPause / GamePauseStateChanged). This is the
 *     ONLY thing that truly halts turn progression across every client, so it
 *     is the backbone of the mod. Everything else is layered on top of it.
 *
 *   - Requirement 4 (any player can pause): the on-screen "Pause" button calls
 *     Network.toggleMultiplayerPause(). Because every pause/unpause is funneled
 *     through this script, each client always knows whether IT initiated the
 *     pause, which is what makes host-only resume deterministic. The stock
 *     "multiplayer-pause" keybind is filtered out so it cannot create an
 *     untracked pause that would bypass the host-authority logic.
 *
 *   - Requirement 1 (pause overlay): a lightweight DOM overlay is shown on
 *     every client from the synchronized GamePauseStateChanged event. Its
 *     backdrop uses pointer-events:none so the 3D map underneath stays
 *     draggable/zoomable (requirement 5 - "looking at the map is ok").
 *
 *   - Requirement 5 (block progressing input): while paused (and during the
 *     resume countdown) all game-advancing input actions are added to the
 *     engine's InputFilterManager, which sits first in the input handler chain.
 *     Camera and information/read-only actions are deliberately NOT filtered.
 *     The engine pause itself already prevents the simulation from advancing,
 *     so this is belt-and-suspenders for the UI layer.
 *
 *   - Requirement 3 (only host can resume): only the host's overlay shows a
 *     "Resume" button. To guarantee the host can actually clear the pause even
 *     when a NON-host started it (the engine tracks a per-player "want pause"
 *     flag and a client can only clear its own), the script performs a
 *     host-ownership handoff: when a non-host starts a pause, the host adds its
 *     own want-pause flag and the original initiator then drops theirs, leaving
 *     the host as the sole flag holder. From then on only the host can unpause.
 *
 *   - Requirement 2 (end-pause countdown): when the host resumes, the engine
 *     fires GamePauseStateChanged(unpaused) on every client simultaneously.
 *     Each client then runs an identical 3-2-1 countdown (keeping input blocked
 *     and the overlay up) before fully handing control back, so the countdown
 *     is synchronized without any custom network message.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const FILTER_SOURCE = "EnhancedPauseMenu";
  const RESUME_COUNTDOWN_SECONDS = 3;
  const HANDOFF_POLL_MS = 200;       // how often a non-host initiator checks for host takeover
  const HANDOFF_TIMEOUT_MS = 6000;   // give up waiting for host takeover after this long
  const RESUME_MAX_ATTEMPTS = 25;    // bound the host resume wait (~5s) for missing-mod safety

  // Input actions that advance / change the game state. Blocked while paused.
  // (Verified against Base/modules/core/config/Input.xml.)
  const PROGRESS_ACTIONS = [
    "next-action",        // advance to next action / end turn
    "keyboard-enter",     // mapped to LOC_NEXT_ACTION (end turn / confirm)
    "force-end-turn",     // force end the turn
    "unit-move",          // issue a move order
    "unit-ranged-attack", // issue a ranged attack
    "unit-skip-turn",     // skip / spend the unit's turn
    "unit-sleep",
    "unit-fortify",
    "unit-heal",
    "unit-alert",
    "unit-auto-explore",
    "trigger-accept-dip", // accept a diplomatic action
    "quick-load"          // reloading a save mid-pause
  ];

  // Filtered for the WHOLE session so the stock keybind can never create an
  // untracked pause/unpause that bypasses the host-authority logic. Pausing is
  // done exclusively through this mod's on-screen button.
  const ALWAYS_FILTERED = ["multiplayer-pause"];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const STATE = { IDLE: "idle", PAUSED: "paused", COUNTDOWN: "countdown" };
  let state = STATE.IDLE;

  let isMultiplayer = false;
  let inputFilter = null;        // InputFilterManager singleton (dynamically imported)
  let contextManager = null;     // ContextManager singleton (dynamically imported, best effort)

  let iHoldPauseFlag = false;    // does THIS client currently hold a want-pause flag?
  let iInitiatedPause = false;   // did THIS client start the current pause?
  let handoffPoll = null;
  let handoffDeadline = 0;
  let progressFiltersActive = false;
  let countdownTimer = null;
  let dialogObserver = null;

  // DOM references
  let overlayRoot = null;
  let overlayTitle = null;
  let overlaySub = null;
  let overlayControls = null;
  let overlayCountdown = null;
  let pauseButton = null;
  let styleEl = null;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function log(msg) { try { console.log("[EnhancedPauseMenu] " + msg); } catch (e) {} }
  function warn(msg) { try { console.warn("[EnhancedPauseMenu] " + msg); } catch (e) {} }

  function amHost() {
    try { return GameContext.localPlayerID === Network.getHostPlayerId(); }
    catch (e) { return false; }
  }

  function numWantPause() {
    try { return Network.getNumWantPausePlayers(); } catch (e) { return 0; }
  }

  function wantPauseName() {
    try { return Network.getWantPausePlayerName() || ""; } catch (e) { return ""; }
  }

  function toggleEnginePause() {
    try { Network.toggleMultiplayerPause(); return true; }
    catch (e) { warn("toggleMultiplayerPause failed: " + e); return false; }
  }

  // ---------------------------------------------------------------------------
  // Dynamic imports of core singletons (paths can vary by install, so we try a
  // few). Core gameplay still works if these fail; they only power niceties.
  // ---------------------------------------------------------------------------
  async function importFirst(candidates) {
    for (const path of candidates) {
      try {
        const mod = await import(path);
        if (mod && (mod.default || mod)) return mod.default || mod;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async function loadCoreSingletons() {
    inputFilter = await importFirst([
      "/core/ui/input/input-filter.js",
      "fs://game/core/ui/input/input-filter.js",
      "../../core/ui/input/input-filter.js",
      "../core/ui/input/input-filter.js",
      "core/ui/input/input-filter.js"
    ]);
    if (inputFilter) {
      try { inputFilter.allowFilters = true; } catch (e) {}
      // Permanently neutralize the stock pause keybind.
      addFilters(ALWAYS_FILTERED);
      log("InputFilterManager ready.");
    } else {
      warn("Could not load InputFilterManager; input blocking degraded (engine pause still stops progression).");
    }

    contextManager = await importFirst([
      "/core/ui/context-manager/context-manager.js",
      "fs://game/core/ui/context-manager/context-manager.js",
      "../../core/ui/context-manager/context-manager.js",
      "../core/ui/context-manager/context-manager.js",
      "core/ui/context-manager/context-manager.js"
    ]);
  }

  function addFilters(names) {
    if (!inputFilter) return;
    for (const n of names) {
      try { inputFilter.addInputFilter({ inputName: n, filterSource: FILTER_SOURCE }); } catch (e) {}
    }
  }

  function removeFilters(names) {
    if (!inputFilter) return;
    for (const n of names) {
      try { inputFilter.removeInputFilter({ inputName: n, filterSource: FILTER_SOURCE }); } catch (e) {}
    }
  }

  function applyProgressFilters() {
    if (progressFiltersActive) return;
    addFilters(PROGRESS_ACTIONS);
    progressFiltersActive = true;
  }

  function clearProgressFilters() {
    if (!progressFiltersActive) return;
    removeFilters(PROGRESS_ACTIONS);
    progressFiltersActive = false;
  }

  // ---------------------------------------------------------------------------
  // Native pause popup suppression
  // The stock code shows a modal hourglass dialog ("Game Paused") that would
  // block panning the map. We hide it (CSS) and pop it from the context stack
  // so the map stays interactive while our own overlay communicates the pause.
  // ---------------------------------------------------------------------------
  function suppressNativeDialog() {
    document.body.classList.add("epm-active");
    handleNativeDialogs();
    if (!dialogObserver) {
      dialogObserver = new MutationObserver(() => {
        if (state === STATE.PAUSED || state === STATE.COUNTDOWN) handleNativeDialogs();
      });
      try { dialogObserver.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    }
  }

  function handleNativeDialogs() {
    let dialogs;
    try { dialogs = document.querySelectorAll('screen-dialog-box[displayHourGlass="true"]'); }
    catch (e) { return; }
    if (!dialogs || dialogs.length === 0) return;
    // Visually hidden via CSS already; also try to pop it to release any modal
    // mouse-guard so the camera keeps working.
    if (contextManager && typeof contextManager.pop === "function") {
      try { contextManager.pop("screen-dialog-box"); } catch (e) { /* non-fatal */ }
    }
  }

  function stopSuppressNativeDialog() {
    document.body.classList.remove("epm-active");
    if (dialogObserver) {
      try { dialogObserver.disconnect(); } catch (e) {}
      dialogObserver = null;
    }
  }

  // ---------------------------------------------------------------------------
  // UI construction
  // ---------------------------------------------------------------------------
  function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.id = "epm-styles";
    styleEl.textContent = `
      /* Hide the stock modal "Game Paused" hourglass dialog while we own pause */
      body.epm-active screen-dialog-box[displayHourGlass="true"] { display: none !important; }

      #epm-pause-button {
        position: fixed; top: 12rem; left: 50%; transform: translateX(-50%);
        z-index: 8990; pointer-events: auto; cursor: pointer;
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.5rem 1.25rem; border-radius: 999px;
        font-family: "Times New Roman", "BodyFont", serif; font-size: 1rem; letter-spacing: 0.05em;
        color: #f3e2c0; background: rgba(20,16,10,0.78);
        border: 1px solid rgba(196,160,90,0.85);
        box-shadow: 0 0.25rem 1rem rgba(0,0,0,0.5);
        transition: background 0.15s ease, transform 0.1s ease;
      }
      #epm-pause-button:hover { background: rgba(48,38,22,0.95); }
      #epm-pause-button:active { transform: translateX(-50%) scale(0.97); }
      #epm-pause-button.epm-hidden { display: none; }
      #epm-pause-button .epm-icon { font-size: 1.1rem; line-height: 1; }

      #epm-overlay {
        position: fixed; inset: 0; z-index: 9000; pointer-events: none;
        display: none; flex-direction: column; align-items: center; justify-content: space-between;
        font-family: "Times New Roman", "BodyFont", serif;
      }
      #epm-overlay.epm-show { display: flex; }
      #epm-overlay .epm-vignette {
        position: absolute; inset: 0; pointer-events: none;
        box-shadow: inset 0 0 18rem rgba(0,0,0,0.55);
        background:
          linear-gradient(rgba(8,10,18,0.30), rgba(8,10,18,0.10) 18%, rgba(8,10,18,0.10) 82%, rgba(8,10,18,0.34));
        animation: epm-fadein 0.25s ease both;
      }
      @keyframes epm-fadein { from { opacity: 0; } to { opacity: 1; } }

      #epm-overlay .epm-banner {
        position: relative; margin-top: 6rem; pointer-events: none;
        display: flex; flex-direction: column; align-items: center;
        padding: 1rem 3rem;
        background: linear-gradient(rgba(10,8,4,0.72), rgba(10,8,4,0.55));
        border-top: 1px solid rgba(196,160,90,0.7);
        border-bottom: 1px solid rgba(196,160,90,0.7);
        animation: epm-fadein 0.25s ease both;
      }
      #epm-overlay .epm-title {
        font-size: 2.6rem; letter-spacing: 0.18em; color: #f6e6bf;
        text-transform: uppercase; text-shadow: 0 0.15rem 0.6rem rgba(0,0,0,0.8);
        display: flex; align-items: center; gap: 1rem;
      }
      #epm-overlay .epm-title .epm-pulse { animation: epm-pulse 1.6s ease-in-out infinite; }
      @keyframes epm-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      #epm-overlay .epm-sub { margin-top: 0.4rem; font-size: 1.15rem; color: #d8c79c; letter-spacing: 0.04em; }

      #epm-overlay .epm-controls {
        position: relative; margin-bottom: 9rem; pointer-events: auto;
        display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
      }
      #epm-overlay .epm-hint { font-size: 1rem; color: #cdbf99; letter-spacing: 0.04em; }
      #epm-resume-button {
        pointer-events: auto; cursor: pointer;
        padding: 0.7rem 2.5rem; border-radius: 6px;
        font-size: 1.25rem; letter-spacing: 0.08em; text-transform: uppercase;
        color: #1a1408; background: linear-gradient(#f0d9a4, #c79a4f);
        border: 1px solid #f4e6c2; box-shadow: 0 0.3rem 0.9rem rgba(0,0,0,0.55);
        transition: filter 0.15s ease, transform 0.1s ease;
      }
      #epm-resume-button:hover { filter: brightness(1.08); }
      #epm-resume-button:active { transform: scale(0.97); }
      #epm-resume-button.epm-hidden { display: none; }

      #epm-overlay .epm-countdown {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        display: none; align-items: center; justify-content: center; pointer-events: none;
        flex-direction: column;
      }
      #epm-overlay .epm-countdown.epm-show { display: flex; }
      #epm-overlay .epm-countdown .epm-count-label {
        font-size: 1.4rem; letter-spacing: 0.12em; color: #e7d6ab; text-transform: uppercase;
        text-shadow: 0 0.1rem 0.5rem rgba(0,0,0,0.8);
      }
      #epm-overlay .epm-countdown .epm-count-num {
        font-size: 8rem; line-height: 1; color: #f8ecca; font-weight: 700;
        text-shadow: 0 0.2rem 1rem rgba(0,0,0,0.85);
        animation: epm-count-pop 1s ease-out;
      }
      @keyframes epm-count-pop {
        0% { transform: scale(1.6); opacity: 0; }
        25% { transform: scale(1); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.85; }
      }
    `;
    document.head.appendChild(styleEl);
  }

  function buildUI() {
    injectStyles();

    // --- Pause button (any player) ---
    pauseButton = document.createElement("div");
    pauseButton.id = "epm-pause-button";
    pauseButton.classList.add("epm-hidden");
    pauseButton.innerHTML = '<span class="epm-icon">&#10073;&#10073;</span><span>Pause Game</span>';
    pauseButton.addEventListener("click", onPauseButtonClick);
    document.body.appendChild(pauseButton);

    // --- Overlay ---
    overlayRoot = document.createElement("div");
    overlayRoot.id = "epm-overlay";

    const vignette = document.createElement("div");
    vignette.className = "epm-vignette";
    overlayRoot.appendChild(vignette);

    const banner = document.createElement("div");
    banner.className = "epm-banner";
    overlayTitle = document.createElement("div");
    overlayTitle.className = "epm-title";
    overlayTitle.innerHTML = '<span class="epm-pulse">&#10073;&#10073;</span><span>Game Paused</span>';
    overlaySub = document.createElement("div");
    overlaySub.className = "epm-sub";
    overlaySub.textContent = "";
    banner.appendChild(overlayTitle);
    banner.appendChild(overlaySub);
    overlayRoot.appendChild(banner);

    overlayControls = document.createElement("div");
    overlayControls.className = "epm-controls";
    const resumeBtn = document.createElement("div");
    resumeBtn.id = "epm-resume-button";
    resumeBtn.textContent = "Resume";
    resumeBtn.addEventListener("click", onResumeButtonClick);
    const hint = document.createElement("div");
    hint.className = "epm-hint";
    overlayControls.appendChild(resumeBtn);
    overlayControls.appendChild(hint);
    overlayRoot.appendChild(overlayControls);

    overlayCountdown = document.createElement("div");
    overlayCountdown.className = "epm-countdown";
    overlayCountdown.innerHTML =
      '<div class="epm-count-label">Resuming in</div><div class="epm-count-num">3</div>';
    overlayRoot.appendChild(overlayCountdown);

    document.body.appendChild(overlayRoot);
  }

  function showPauseButton() {
    if (pauseButton && state === STATE.IDLE) pauseButton.classList.remove("epm-hidden");
  }
  function hidePauseButton() {
    if (pauseButton) pauseButton.classList.add("epm-hidden");
  }

  function refreshOverlayForPaused() {
    const name = wantPauseName();
    overlaySub.textContent = name ? ("Paused by " + name) : "The game is paused.";
    const resumeBtn = document.getElementById("epm-resume-button");
    const hint = overlayControls.querySelector(".epm-hint");
    if (amHost()) {
      resumeBtn.classList.remove("epm-hidden");
      hint.textContent = "You are the host — only you can resume the game.";
    } else {
      resumeBtn.classList.add("epm-hidden");
      hint.textContent = "Waiting for the host to resume the game…";
    }
  }

  function showOverlay() {
    overlayRoot.classList.add("epm-show");
    overlayCountdown.classList.remove("epm-show");
  }
  function hideOverlay() {
    overlayRoot.classList.remove("epm-show");
    overlayCountdown.classList.remove("epm-show");
  }

  // ---------------------------------------------------------------------------
  // Button handlers
  // ---------------------------------------------------------------------------
  function onPauseButtonClick() {
    if (!isMultiplayer || state !== STATE.IDLE) return;
    if (numWantPause() > 0) return; // already paused somewhere
    iInitiatedPause = true;
    iHoldPauseFlag = true;
    hidePauseButton();
    toggleEnginePause(); // -> GamePauseStateChanged(paused) on all clients
  }

  function onResumeButtonClick() {
    if (!amHost() || state !== STATE.PAUSED) return;
    requestHostResume(0);
  }

  // ---------------------------------------------------------------------------
  // Host-only resume
  // The host must be the sole want-pause flag holder for a single toggle to
  // unpause everyone. The handoff (below) ensures that. If a non-host hand-off
  // is still settling, we wait briefly and retry (bounded).
  // ---------------------------------------------------------------------------
  function requestHostResume(attempt) {
    attempt = attempt || 0;
    const count = numWantPause();
    if (count > 1 && attempt < RESUME_MAX_ATTEMPTS) {
      // A non-host flag is still being handed off; wait for it to settle
      // (bounded so a client missing the mod can't hang resume forever).
      setTimeout(() => {
        if (state === STATE.PAUSED && amHost()) requestHostResume(attempt + 1);
      }, HANDOFF_POLL_MS);
      return;
    }
    // Host drops its flag. If we are the sole holder this unpauses everyone;
    // if a stuck flag remains it is the host's best-effort attempt.
    iHoldPauseFlag = false;
    iInitiatedPause = false;
    toggleEnginePause(); // -> GamePauseStateChanged(unpaused) -> countdown on all clients
  }

  // ---------------------------------------------------------------------------
  // Host-ownership handoff
  // ---------------------------------------------------------------------------
  function hostEnsureOwnership() {
    // Host takes the pause over by adding its own flag if it didn't start it.
    if (!iHoldPauseFlag) {
      iHoldPauseFlag = true;
      toggleEnginePause(); // host now also holds a want-pause flag
    }
  }

  function startInitiatorHandoff() {
    // A non-host that started the pause waits until the host has also flagged
    // pause (count >= 2), then drops its own flag so only the host controls it.
    stopInitiatorHandoff();
    handoffDeadline = Date.now() + HANDOFF_TIMEOUT_MS;
    handoffPoll = setInterval(() => {
      if (state !== STATE.PAUSED) { stopInitiatorHandoff(); return; }
      if (numWantPause() >= 2) {
        // Host has taken ownership; release our flag.
        iHoldPauseFlag = false;
        iInitiatedPause = false;
        toggleEnginePause();
        stopInitiatorHandoff();
      } else if (Date.now() > handoffDeadline) {
        // Host never took over (e.g. host lacks the mod). Keep our flag so the
        // game stays paused; stop polling.
        warn("Host did not take pause ownership within timeout; keeping initiator flag.");
        stopInitiatorHandoff();
      }
    }, HANDOFF_POLL_MS);
  }

  function stopInitiatorHandoff() {
    if (handoffPoll) { clearInterval(handoffPoll); handoffPoll = null; }
  }

  // ---------------------------------------------------------------------------
  // State transitions driven by the synchronized engine pause event
  // ---------------------------------------------------------------------------
  function onGamePauseStateChanged(data) {
    if (!isMultiplayer) return;
    const paused = !!data && Number(data.data) === 1;
    if (paused) {
      if (state === STATE.PAUSED) { refreshOverlayForPaused(); return; }
      enterPaused();
    } else {
      if (state === STATE.PAUSED) {
        beginResumeCountdown();
      } else {
        enterIdle();
      }
    }
  }

  function enterPaused() {
    state = STATE.PAUSED;
    hidePauseButton();
    showOverlay();
    refreshOverlayForPaused();
    applyProgressFilters();
    suppressNativeDialog();

    if (amHost()) {
      // Make sure the host owns a flag so it can authoritatively resume later.
      hostEnsureOwnership();
    } else if (iInitiatedPause) {
      // Non-host that started this pause: hand ownership to the host.
      startInitiatorHandoff();
    }
  }

  function beginResumeCountdown() {
    if (state === STATE.COUNTDOWN) return;
    state = STATE.COUNTDOWN;
    stopInitiatorHandoff();
    stopSuppressNativeDialog();
    // Keep input blocked & overlay up during the countdown.
    applyProgressFilters();

    let remaining = RESUME_COUNTDOWN_SECONDS;
    const label = overlayCountdown.querySelector(".epm-count-label");
    const num = overlayCountdown.querySelector(".epm-count-num");
    if (label) label.textContent = "Resuming in";
    overlayCountdown.classList.add("epm-show");

    const tick = () => {
      if (remaining <= 0) {
        finishCountdown();
        return;
      }
      if (num) {
        num.textContent = String(remaining);
        // restart the pop animation each second
        num.style.animation = "none";
        void num.offsetWidth; // force reflow
        num.style.animation = "";
      }
      remaining -= 1;
      countdownTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  function finishCountdown() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    enterIdle();
  }

  function enterIdle() {
    state = STATE.IDLE;
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    stopInitiatorHandoff();
    stopSuppressNativeDialog();
    clearProgressFilters();
    hideOverlay();
    iInitiatedPause = false;
    iHoldPauseFlag = false;
    showPauseButton();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  function detectMultiplayer() {
    try {
      const cfg = Configuration.getGame();
      return !!(cfg && cfg.isAnyMultiplayer);
    } catch (e) { return false; }
  }

  async function onReady() {
    isMultiplayer = detectMultiplayer();
    if (!isMultiplayer) {
      log("Single-player game detected; Enhanced Pause Menu stays dormant.");
      return;
    }
    log("Multiplayer game detected; initializing Enhanced Pause Menu.");

    await loadCoreSingletons();
    buildUI();

    engine.on("GamePauseStateChanged", onGamePauseStateChanged);

    // If we joined while already paused, reflect it.
    if (numWantPause() > 0) {
      onGamePauseStateChanged({ data: 1 });
    } else {
      enterIdle();
    }
  }

  // engine.whenReady resolves once the UI engine is up.
  try {
    engine.whenReady.then(onReady).catch((e) => warn("onReady failed: " + e));
  } catch (e) {
    // Fallback: if whenReady is unavailable, attempt immediate init.
    try { onReady(); } catch (e2) { warn("init failed: " + e2); }
  }
})();
