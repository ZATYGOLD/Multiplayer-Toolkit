/**
 * Enhanced Pause Menu - synchronized multiplayer pause built on the game's
 * own pause menu and components.
 *
 * Loaded as an in-game UIScript (scope="game"). Active only in multiplayer.
 *
 * WHAT IT DOES
 *  - Adds a "Pause Game" button to the built-in pause menu (Esc menu). Any
 *    player can use it to pause the multiplayer game.
 *  - When the game is paused, the built-in pause menu is opened on EVERY
 *    player's screen, with a "Ready / Resume" button and a "View Map" button
 *    (View Map reuses the game's own LOC_ADVANCED_START_VIEW_MAP string and
 *    simply returns to the world so players can look around; Esc re-opens the
 *    pause menu).
 *  - Game-advancing input is blocked while paused (engine InputFilterManager),
 *    but the camera, information screens and city/production panels remain
 *    viewable - you just can't commit anything (the engine pause prevents it).
 *  - When the unpause is triggered, every open pause menu is closed first, then
 *    a synchronized 3-2-1 countdown plays for everyone before play resumes.
 *
 * HOW PAUSE / READY / RESUME IS SYNCHRONIZED
 *  The engine exposes a multiplayer pause that is paused while ANY player holds
 *  a "want pause" flag, unpaused the instant all flags are cleared, and fully
 *  synchronized via the GamePauseStateChanged event. The only synchronized
 *  per-player primitive is therefore this binary flag plus an aggregate count
 *  (Network.getNumWantPausePlayers). We build everything on it:
 *
 *    flag held  == "this player is NOT ready to resume"
 *    flag clear == "this player is ready to resume"
 *
 *  On pause, every client holds a flag (so the game stays paused and the menu
 *  is shown to all). Clicking Ready clears your own flag. readyCount = N-count
 *  is identical on every client, giving a synchronized "Ready X / N" tally.
 *  The game unpauses (synchronized) the moment the last flag clears, which
 *  happens via:
 *    - Consensus: everyone clicks Ready, or
 *    - Vote: after VOTE_DELAY, once >= VOTE_THRESHOLD are ready, the remaining
 *      clients auto-clear (each evaluates the same shared count + its own
 *      timer), or
 *    - Override: after HOST_OVERRIDE_DELAY, any readiness clears the rest
 *      (anti-AFK safety / host force-resume).
 *  The host's button is labelled as the authoritative Resume.
 *
 *  NOTE/LIMITATION: the engine provides no per-player or host-specific pause
 *  query and no custom UI network message, so a *unilateral, instant* host-only
 *  override that other clients could detect on the wire is not possible from a
 *  UI mod. Host authority is therefore expressed through the configurable
 *  thresholds above (host force-resume becomes effective after
 *  HOST_OVERRIDE_DELAY). All timings/thresholds are configurable below.
 */
(function () {
  "use strict";

  // ----------------------------- Configuration ------------------------------
  const FILTER_SOURCE = "EnhancedPauseMenu";
  const RESUME_COUNTDOWN_SECONDS = 5;   // length of the resume countdown
  const POLL_MS = 250;                  // tally / condition evaluation interval
  const CONVERGENCE_DELAY_MS = 2000;    // wait for all clients to flag in
  const VOTE_THRESHOLD = 0.60;          // 60% ready to trigger a vote resume
  const VOTE_DELAY_MS = 20000;          // vote resume only after this long
  const HOST_OVERRIDE_DELAY_MS = 45000; // any readiness resumes after this long

  const PAUSE_MENU_MODE = "INTERFACEMODE_PAUSE_MENU";

  // Input actions that advance / change game state (blocked while paused).
  // Verified against Base/modules/core/config/Input.xml. Camera, selection,
  // information screens and city/production panels are intentionally allowed.
  const PROGRESS_ACTIONS = [
    "next-action", "keyboard-enter", "force-end-turn",
    "unit-move", "unit-ranged-attack", "unit-skip-turn", "unit-sleep",
    "unit-fortify", "unit-heal", "unit-alert", "unit-auto-explore",
    "trigger-accept-dip", "quick-load"
  ];

  // ------------------------------- State -------------------------------------
  const STATE = { IDLE: "idle", PAUSED: "paused", COUNTDOWN: "countdown" };
  let state = STATE.IDLE;

  let isMultiplayer = false;
  let iHoldFlag = false;
  let pauseStart = 0;
  let maxCount = 0;
  let pollTimer = null;
  let countdownTimer = null;
  let progressFiltersActive = false;
  let pauseReason = "";   // optional cause shown in the menu (e.g. a disconnect)
  let finalizing = false; // true once the countdown finished and we are releasing

  // Core singletons (dynamically imported; gameplay still works if any fail).
  let InputFilter = null;
  let InterfaceModeRef = null;
  let DialogBoxMgr = null;

  // DOM
  let styleEl = null;
  let countdownEl = null;

  // ------------------------------- Helpers -----------------------------------
  function log(m) { try { console.log("[EnhancedPauseMenu] " + m); } catch (e) {} }
  function warn(m) { try { console.warn("[EnhancedPauseMenu] " + m); } catch (e) {} }

  function amHost() {
    try { return GameContext.localPlayerID === Network.getHostPlayerId(); }
    catch (e) { return false; }
  }
  function numWantPause() {
    try { return Network.getNumWantPausePlayers() | 0; } catch (e) { return 0; }
  }
  function toggleEnginePause() {
    try { Network.toggleMultiplayerPause(); return true; }
    catch (e) { warn("toggleMultiplayerPause failed: " + e); return false; }
  }
  function humanPlayerCount() {
    let n = 0;
    try {
      const ids = Players.getAliveMajorIds();
      for (let i = 0; i < ids.length; i++) {
        const p = Players.get(ids[i]);
        if (p && p.isHuman) n++;
      }
    } catch (e) { /* fall through */ }
    return n;
  }
  // N = best estimate of participating players; self-calibrates to the observed
  // flag count so it is correct once everyone has flagged in.
  function totalPlayers() {
    const humans = humanPlayerCount();
    return Math.max(humans, maxCount, 1);
  }
  function readyCount() {
    return Math.max(0, totalPlayers() - numWantPause());
  }
  // True once enough time has passed for every client to have flagged in.
  function converged() {
    return (Date.now() - pauseStart) >= CONVERGENCE_DELAY_MS;
  }

  // --------------------- Dynamic import of core singletons -------------------
  async function importModule(candidates) {
    for (const path of candidates) {
      try { const m = await import(path); if (m) return m; } catch (e) { /* next */ }
    }
    return null;
  }
  async function loadCoreSingletons() {
    const inputMod = await importModule([
      "fs://game/core/ui/input/input-filter.js",
      "/core/ui/input/input-filter.js",
      "../../core/ui/input/input-filter.js"
    ]);
    InputFilter = inputMod ? (inputMod.default || inputMod) : null;
    if (InputFilter) { try { InputFilter.allowFilters = true; } catch (e) {} }

    const imMod = await importModule([
      "fs://game/core/ui/interface-modes/interface-modes.js",
      "/core/ui/interface-modes/interface-modes.js",
      "../../core/ui/interface-modes/interface-modes.js"
    ]);
    InterfaceModeRef = imMod ? (imMod.InterfaceMode || imMod.default || null) : null;

    const dbMod = await importModule([
      "fs://game/core/ui/dialog-box/manager-dialog-box.js",
      "/core/ui/dialog-box/manager-dialog-box.js",
      "../../core/ui/dialog-box/manager-dialog-box.js"
    ]);
    DialogBoxMgr = dbMod ? (dbMod.DialogBoxManager || dbMod.default || null) : null;

    // Suppress the base game's modal "Game Paused" popup at the source. It is
    // created via DialogBoxManager.createDialog_MultiOption({title:
    // "LOC_MP_PAUSE_POPUP_TITLE", ...}) in mp-ingame-mgr.js. Because we share the
    // same DialogBoxManager singleton, we wrap that one call so this specific
    // popup is never built (our own pause menu + overlay replace it). All other
    // dialogs pass through untouched.
    if (DialogBoxMgr && typeof DialogBoxMgr.createDialog_MultiOption === "function" && !DialogBoxMgr.__epmPatched) {
      const origMulti = DialogBoxMgr.createDialog_MultiOption.bind(DialogBoxMgr);
      DialogBoxMgr.createDialog_MultiOption = function (params) {
        try {
          if (params && params.title === "LOC_MP_PAUSE_POPUP_TITLE") {
            return "epm-suppressed-pause-dialog";
          }
        } catch (e) { /* fall through to original */ }
        return origMulti(params);
      };
      DialogBoxMgr.__epmPatched = true;
      log("Native 'Game Paused' popup suppressed.");
    }

    log("singletons: InputFilter=" + !!InputFilter + " InterfaceMode=" + !!InterfaceModeRef + " DialogBoxManager=" + !!DialogBoxMgr);
  }

  // ----------------------------- Input filtering -----------------------------
  function applyProgressFilters() {
    if (progressFiltersActive || !InputFilter) return;
    for (const n of PROGRESS_ACTIONS) {
      try { InputFilter.addInputFilter({ inputName: n, filterSource: FILTER_SOURCE }); } catch (e) {}
    }
    progressFiltersActive = true;
  }
  function clearProgressFilters() {
    if (!progressFiltersActive || !InputFilter) { progressFiltersActive = false; return; }
    for (const n of PROGRESS_ACTIONS) {
      try { InputFilter.removeInputFilter({ inputName: n, filterSource: FILTER_SOURCE }); } catch (e) {}
    }
    progressFiltersActive = false;
  }

  // ------------------ Interface mode (open / close pause menu) ----------------
  function pauseMenuIsOpen() {
    try {
      if (InterfaceModeRef && typeof InterfaceModeRef.isInInterfaceMode === "function") {
        return InterfaceModeRef.isInInterfaceMode(PAUSE_MENU_MODE);
      }
    } catch (e) {}
    return !!document.querySelector("#screen-pause-menu");
  }
  function openPauseMenu() {
    if (pauseMenuIsOpen()) return;
    try {
      if (InterfaceModeRef && typeof InterfaceModeRef.switchTo === "function") {
        InterfaceModeRef.switchTo(PAUSE_MENU_MODE);
      }
    } catch (e) { warn("openPauseMenu failed: " + e); }
  }
  function closePauseMenu() {
    if (!pauseMenuIsOpen()) return;
    try {
      if (InterfaceModeRef && typeof InterfaceModeRef.switchToDefault === "function") {
        InterfaceModeRef.switchToDefault();
      }
    } catch (e) { warn("closePauseMenu failed: " + e); }
  }

  // ------------- Dismiss the stock modal "Game Paused" hourglass --------------
  // The base game pops a modal hourglass dialog (with a mouse guard) on pause,
  // which would block looking at the map. We dismiss it ONCE per pause (with a
  // single retry). We deliberately do NOT run a continuous observer here - that
  // was the cause of the earlier "clicking a unit removed the UI" bug.
  function dismissNativeHourglass(retries) {
    retries = retries == null ? 4 : retries;
    let dlg = null;
    try { dlg = document.querySelector('screen-dialog-box[displayHourGlass="true"]'); } catch (e) {}
    if (dlg && DialogBoxMgr && typeof DialogBoxMgr.closeDialogBox === "function") {
      try { DialogBoxMgr.closeDialogBox(); } catch (e) {}
    }
    if (retries > 0 && state === STATE.PAUSED) {
      setTimeout(() => dismissNativeHourglass(retries - 1), 250);
    }
  }

  // ----------------------------- Countdown overlay ---------------------------
  function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.id = "epm-styles";
    styleEl.textContent = `
      /* Our injected pause-menu buttons + status, styled to sit with the natives */
      /* Host / status hint shown directly above the Resume button */
      .epm-host-hint {
        width: 100%; text-align: center; margin-bottom: 0.5rem;
        font-family: "Times New Roman","BodyFont",serif; font-size: 1.05rem;
        letter-spacing: 0.04em; color: #e7d6ab; text-shadow: 0 0.1rem 0.4rem rgba(0,0,0,0.7);
      }
      .epm-host-hint .epm-reason { display: block; color: #f0c98a; margin-bottom: 0.25rem; }
      /* "Ready: X / N" placed in the footer, under the build number, with a gap */
      .epm-footer-ready {
        width: 100%; text-align: center; margin-top: 1.75rem;
        font-family: "Times New Roman","BodyFont",serif; font-size: 1.7rem; font-weight: 700;
        letter-spacing: 0.06em; text-shadow: 0 0.12rem 0.5rem rgba(0,0,0,0.9);
      }
      .epm-footer-ready.epm-not-enough { color: #ff5555; }
      .epm-footer-ready.epm-enough { color: #5dff86; }

      /* Resume countdown overlay. Full-screen (inset: 0) so the faded vignette
         covers the whole width/height of the scene, with the text centered.
         To move the text off-center, swap justify-content for flex-start and
         add a padding-top. Tweak the rgba alphas to dim more/less. */
      #epm-countdown {
        position: fixed; inset: 0; width: 100%; height: 100%; z-index: 9000; pointer-events: none;
        display: none; flex-direction: column; align-items: center; justify-content: center;
        font-family: "Times New Roman", "BodyFont", serif;
        background: radial-gradient(ellipse 120% 90% at center, rgba(8,10,18,0.12), rgba(8,10,18,0.55));
      }
      #epm-countdown.epm-show { display: flex; }
      #epm-countdown .epm-count-label {
        width: 100%; text-align: center; font-size: 1.7rem; letter-spacing: 0.16em;
        text-transform: uppercase; color: #e7d6ab; text-shadow: 0 0.1rem 0.5rem rgba(0,0,0,0.9);
      }
      #epm-countdown .epm-count-num {
        width: 100%; text-align: center; font-size: 7rem; line-height: 1; font-weight: 700;
        color: #f8ecca; text-shadow: 0 0.2rem 1rem rgba(0,0,0,0.95); animation: epm-pop 1s ease-out;
      }
      @keyframes epm-pop {
        0% { transform: scale(1.6); opacity: 0; }
        25% { transform: scale(1); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.85; }
      }
    `;
    document.head.appendChild(styleEl);
  }
  // Simple resume countdown overlay shown top-center on the game scene.
  function buildCountdown() {
    if (countdownEl) return;
    countdownEl = document.createElement("div");
    countdownEl.id = "epm-countdown";
    countdownEl.innerHTML =
      '<div class="epm-count-label">Unpausing...</div>' +
      '<div class="epm-count-num">' + RESUME_COUNTDOWN_SECONDS + '</div>';
    document.body.appendChild(countdownEl);
  }
  function showCountdown(show) {
    if (countdownEl) countdownEl.classList.toggle("epm-show", !!show);
  }

  // --------------------- Pause-menu button injection -------------------------
  // We inject the game's own fxs-button components into the built-in pause menu
  // button container so they match the native look exactly.
  let menuModeListener = null;
  function tryInjectWhenMenuReady(attempt) {
    attempt = attempt || 0;
    const container = document.querySelector("#pause-menu-button-container");
    if (container) { injectMenuButtons(container); return; }
    if (attempt < 20) setTimeout(() => tryInjectWhenMenuReady(attempt + 1), 50);
  }
  // We hook the lightweight "interface-mode-changed" event (not a DOM observer)
  // so injection only runs when the pause menu actually opens. Re-running this
  // also refreshes the buttons when our pause state changes while the menu is up.
  function startMenuObserver() {
    if (!menuModeListener) {
      menuModeListener = () => { if (pauseMenuIsOpen()) tryInjectWhenMenuReady(0); };
      window.addEventListener("interface-mode-changed", menuModeListener);
    }
    if (pauseMenuIsOpen()) tryInjectWhenMenuReady(0);
  }
  function stopMenuObserver() {
    // Listener is cheap and idempotent; keep it for the session so the Pause
    // button is offered whenever the pause menu is opened while idle.
  }

  function makeButton(id, caption, onActivate) {
    const btn = document.createElement("fxs-button");
    btn.id = id;
    btn.classList.add("pause-menu-button", "epm-injected");
    btn.setAttribute("caption", caption);
    // fxs-button dispatches "action-activate" for both mouse and controller,
    // exactly as the base game's own buttons do. Using only this avoids the
    // double-invocation that adding a separate "click" listener would cause.
    btn.addEventListener("action-activate", onActivate);
    return btn;
  }

  function injectMenuButtons(container) {
    const paused = (state === STATE.PAUSED);
    const nativeResume = container.querySelector("#pause-menu-resume-button");

    // Remove any of our previous injections so we can rebuild for the state.
    container.querySelectorAll(".epm-injected").forEach((el) => el.remove());

    if (paused) {
      // The native hero "Resume Game" button is a ui-next component that can't be
      // reliably hooked (it would only close the menu), so hide it and provide our
      // own working Resume/Ready button as the primary action.
      if (nativeResume) nativeResume.style.display = "none";

      // Host hint (or waiting text) ABOVE the Resume button.
      const hint = document.createElement("div");
      hint.className = "epm-host-hint epm-injected";
      hint.id = "epm-host-hint";
      hint.innerHTML = hostHintHTML();

      const readyCaption = amHost()
        ? "LOC_EPM_RESUME_HOST"
        : (iHoldFlag ? "LOC_EPM_READY" : "LOC_EPM_CANCEL_READY");
      const readyBtn = makeButton("epm-ready-button", readyCaption, onReadyClick);
      const viewBtn = makeButton("epm-viewmap-button", "LOC_ADVANCED_START_VIEW_MAP", onViewMapClick);

      // Order at the top of the menu: hint, Resume button, then View Map below it.
      const first = container.firstChild;
      container.insertBefore(hint, first);
      container.insertBefore(readyBtn, first);
      container.insertBefore(viewBtn, first);

      injectFooterReady();
    } else {
      // Not paused: keep the native Resume and put Pause Game BELOW it.
      if (nativeResume) nativeResume.style.display = "";
      removeFooterReady();
      const pauseBtn = makeButton("epm-pause-button", "LOC_EPM_PAUSE_GAME", onPauseClick);
      if (nativeResume) container.insertBefore(pauseBtn, nativeResume.nextSibling);
      else container.insertBefore(pauseBtn, container.firstChild);
    }
  }

  // The footer container that holds the game / build info at the bottom.
  function footerContainer() {
    const gi = document.querySelector(".pause-menu-game-info");
    return gi ? gi.parentElement : null;
  }
  function applyFooterClass(el) {
    const n = totalPlayers();
    const enough = converged() && n > 0 && (readyCount() / n) >= VOTE_THRESHOLD;
    el.classList.toggle("epm-enough", enough);
    el.classList.toggle("epm-not-enough", !enough);
  }
  function injectFooterReady() {
    let el = document.querySelector("#epm-footer-ready");
    if (!el) {
      const fc = footerContainer();
      if (!fc) return;
      el = document.createElement("div");
      el.id = "epm-footer-ready";
      el.className = "epm-footer-ready";
      fc.appendChild(el);
    }
    el.textContent = footerReadyText();
    applyFooterClass(el);
  }
  function removeFooterReady() {
    const el = document.querySelector("#epm-footer-ready");
    if (el) el.remove();
  }

  function footerReadyText() {
    const n = totalPlayers();
    // Avoid showing a misleading tally before all clients have flagged in.
    const r = converged() ? readyCount() : 0;
    return "Ready: " + r + " / " + n;
  }
  function hostHintHTML() {
    const reason = pauseReason ? ('<span class="epm-reason">' + pauseReason + '</span>') : "";
    let line;
    if (amHost()) line = "You are the host. Resume when ready.";
    else if (!iHoldFlag) line = "You are ready. Waiting for the host to resume.";
    else line = "Waiting for the host to resume.";
    return reason + line;
  }
  function refreshStatus() {
    const hint = document.querySelector("#epm-host-hint");
    if (hint) hint.innerHTML = hostHintHTML();
    let footer = document.querySelector("#epm-footer-ready");
    if (!footer && state === STATE.PAUSED) { injectFooterReady(); footer = document.querySelector("#epm-footer-ready"); }
    if (footer) { footer.textContent = footerReadyText(); applyFooterClass(footer); }
    const rb = document.querySelector("#epm-ready-button");
    if (rb && !amHost()) rb.setAttribute("caption", iHoldFlag ? "LOC_EPM_READY" : "LOC_EPM_CANCEL_READY");
  }

  // ------------------------------ Button handlers ----------------------------
  function onPauseClick(ev) {
    if (ev) { try { ev.stopPropagation(); } catch (e) {} }
    if (!isMultiplayer || state !== STATE.IDLE) return;
    if (numWantPause() > 0) return;       // already paused elsewhere
    pauseReason = "";                     // manual pause has no special reason
    iHoldFlag = true;                     // we will hold the first flag
    toggleEnginePause();                  // -> GamePauseStateChanged(paused) for all
  }

  function onReadyClick(ev) {
    if (ev) { try { ev.stopPropagation(); } catch (e) {} }
    if (state !== STATE.PAUSED) return;
    // Toggle our readiness by toggling our own want-pause flag.
    if (iHoldFlag) { iHoldFlag = false; toggleEnginePause(); }   // become ready
    else { iHoldFlag = true; toggleEnginePause(); }              // cancel ready
    refreshStatus();
  }

  function onViewMapClick(ev) {
    if (ev) { try { ev.stopPropagation(); } catch (e) {} }
    if (state !== STATE.PAUSED) return;
    // Return to the world to look at the map. Esc re-opens the pause menu.
    closePauseMenu();
  }

  // ---------------------- Synchronized pause state machine --------------------
  function onGamePauseStateChanged(data) {
    if (!isMultiplayer) return;
    const paused = !!data && Number(data.data) === 1;
    if (paused) {
      // Engine is paused (some flag is held).
      if (state === STATE.IDLE) enterPaused();
      else if (state === STATE.PAUSED) refreshStatus();
      // state === COUNTDOWN: this is our own re-pause during the countdown -> ignore.
    } else {
      // Engine is unpaused (all flags cleared).
      if (state === STATE.PAUSED) {
        beginCountdown();              // run the countdown FIRST, keeping the game paused
      } else if (state === STATE.COUNTDOWN) {
        if (finalizing) enterIdle();   // genuine release after the countdown finished
        // else: brief transient before our re-pause lands -> ignore
      } else {
        enterIdle();
      }
    }
  }

  function enterPaused() {
    state = STATE.PAUSED;
    pauseStart = Date.now();
    maxCount = numWantPause();

    // Ensure THIS client holds a flag (everyone "not ready" baseline).
    if (!iHoldFlag) { iHoldFlag = true; toggleEnginePause(); }

    applyProgressFilters();
    dismissNativeHourglass();   // one-shot (with a few short retries)
    openPauseMenu();            // bring the pause menu up for this player
    startMenuObserver();        // (re)inject our buttons whenever the menu opens
    startPoll();
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(onPoll, POLL_MS);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function onPoll() {
    if (state !== STATE.PAUSED) return;
    const count = numWantPause();
    if (count > maxCount) maxCount = count;
    // The pause menu is a reactive (SolidJS) screen; if a re-render dropped our
    // injected buttons while the menu is open, put them back.
    if (pauseMenuIsOpen() && !document.querySelector("#epm-viewmap-button")) {
      const c = document.querySelector("#pause-menu-button-container");
      if (c) injectMenuButtons(c);
    }
    refreshStatus();

    // Auto-resume evaluation (only matters if WE still hold a flag).
    if (!iHoldFlag) return;
    const t = Date.now() - pauseStart;
    if (t < CONVERGENCE_DELAY_MS) return;

    const n = totalPlayers();
    const ready = readyCount();
    const ratio = n > 0 ? ready / n : 0;

    const voteResume = (t >= VOTE_DELAY_MS) && (ratio >= VOTE_THRESHOLD);
    const overrideResume = (t >= HOST_OVERRIDE_DELAY_MS) && (ready >= 1);

    if (voteResume || overrideResume) {
      iHoldFlag = false;
      toggleEnginePause();   // contribute to count -> 0 (cascades to unpause)
    }
  }

  function beginCountdown() {
    if (state === STATE.COUNTDOWN) return;
    state = STATE.COUNTDOWN;
    finalizing = false;
    stopPoll();
    // Close any open pause menu BEFORE the countdown shows.
    closePauseMenu();
    // KEEP THE GAME PAUSED during the countdown: immediately re-assert our own
    // pause flag so the simulation stays frozen until the timer reaches zero.
    // (The last flag-clear briefly unpaused the engine to fire this event; we
    // re-pause right away so no game-advancing action can happen during the
    // countdown.) The real unpause only happens in finalizeResume().
    if (!iHoldFlag) { iHoldFlag = true; toggleEnginePause(); }
    applyProgressFilters();

    // Top-center "UNPAUSING..." countdown overlay.
    showCountdown(true);
    let remaining = RESUME_COUNTDOWN_SECONDS;
    const num = countdownEl ? countdownEl.querySelector(".epm-count-num") : null;
    const tick = () => {
      if (remaining <= 0) { finalizeResume(); return; }
      if (num) {
        num.textContent = String(remaining);
        num.style.animation = "none"; void num.offsetWidth; num.style.animation = "";
      }
      remaining -= 1;
      countdownTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  // Countdown reached zero: release our pause flag. The game only truly resumes
  // once EVERY client's countdown has finished and all flags are cleared, so it
  // stays frozen for everyone until the slowest countdown completes.
  function finalizeResume() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    finalizing = true;
    showCountdown(false);
    if (iHoldFlag) { iHoldFlag = false; toggleEnginePause(); }   // drop -> unpause when last
    // Backstop: if no unpause event arrives (we weren't the last holder), idle out.
    setTimeout(() => { if (state === STATE.COUNTDOWN) enterIdle(); }, 4000);
  }

  function enterIdle() {
    state = STATE.IDLE;
    stopPoll();
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    showCountdown(false);
    clearProgressFilters();
    // Restore native resume button visibility if the menu happens to be open.
    const nativeResume = document.querySelector("#pause-menu-resume-button");
    if (nativeResume) nativeResume.style.display = "";
    iHoldFlag = false;
    finalizing = false;
    maxCount = 0;
    pauseReason = "";
    removeFooterReady();
    // Keep the menu observer running so the Pause button is offered next time
    // the player opens the pause menu while idle.
    startMenuObserver();
  }

  // ----------------- Pause on player disconnect (before AI takes over) -------
  // When a player drops, we pause IMMEDIATELY on the disconnect event so the
  // synchronized simulation halts before the next turn-processing step where
  // the AI would take over the absent player. The AI naturally resumes control
  // after the game is unpaused if that player has not returned.
  function onPlayerDisconnected(data) {
    if (!isMultiplayer) return;
    let name = "";
    try { name = (data && (data.playerNameT2gp || data.playerName1Pgp)) || ""; } catch (e) {}
    const reason = name ? (name + " disconnected.") : "A player disconnected.";
    // Record the reason on EVERY client so all menus can show it, regardless of
    // which client wins the race to trigger the pause.
    if (state !== STATE.COUNTDOWN) pauseReason = reason;
    if (state !== STATE.IDLE) { refreshStatus(); return; }   // already paused
    if (numWantPause() > 0) { refreshStatus(); return; }     // pause in progress
    try { if (document.querySelector("#screen-endgame")) return; } catch (e) {}
    iHoldFlag = true;
    toggleEnginePause();   // pause now, before any automatic AI action
    log("Auto-paused due to player disconnect.");
  }

  // -------------------------------- Lifecycle --------------------------------
  function detectMultiplayer() {
    try { const c = Configuration.getGame(); return !!(c && c.isAnyMultiplayer); }
    catch (e) { return false; }
  }

  async function onReady() {
    isMultiplayer = detectMultiplayer();
    if (!isMultiplayer) { log("Single-player; Enhanced Pause Menu dormant."); return; }
    log("Multiplayer; initializing Enhanced Pause Menu.");
    await loadCoreSingletons();
    injectStyles();
    buildCountdown();
    engine.on("GamePauseStateChanged", onGamePauseStateChanged);
    // Pause the instant a player drops, before the AI can take over their turn.
    engine.on("MultiplayerPostPlayerDisconnected", onPlayerDisconnected);
    if (numWantPause() > 0) onGamePauseStateChanged({ data: 1 });
    else enterIdle();
  }

  try {
    engine.whenReady.then(onReady).catch((e) => warn("onReady failed: " + e));
  } catch (e) {
    try { onReady(); } catch (e2) { warn("init failed: " + e2); }
  }
})();
