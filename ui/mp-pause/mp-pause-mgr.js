/*
 * Multiplayer Toolkit - multiplayer quality-of-life features for Civilization VII.
 * Copyright (C) 2026  Zatygold
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Multiplayer Toolkit - multiplayer pause manager (singleton).
 *
 * Loaded as an in-game UIScript (scope="game"); active only in multiplayer.
 * Mirrors the base game's manager pattern (see base-standard
 * ui/mp-ingame-mgr/mp-ingame-mgr.js): a class with bound engine listeners,
 * constructed on engine.whenReady, exported as the module default.
 *
 * Responsibilities
 *  - Pause/resume orchestration built on the engine's synchronized multiplayer
 *    pause (Network.toggleMultiplayerPause + GamePauseStateChanged). A held
 *    "want pause" flag means "this player is NOT ready"; the game unpauses when
 *    all flags clear. readyCount = N - wantPauseCount is identical on every
 *    client, giving a synchronized tally for free.
 *  - Injects Pause / Ready / View Map controls into the built-in pause menu.
 *  - Blocks game-advancing input while paused (engine InputFilterManager).
 *  - Keeps the game paused through a synchronized "UNPAUSING..." countdown.
 *  - Pauses immediately on a player disconnect, before the AI can take over.
 *  - Suppresses the stock "Game Paused" popup (shared DialogBoxManager).
 *
 * Engine limitation: there is no per-player/host pause query and no custom UI
 * network message, so a unilateral instant host-only override is not possible;
 * host authority is expressed through the configurable vote/override delays.
 */
import { FILTER_SOURCE, PAUSE_MENU_MODE, NATIVE_PAUSE_DIALOG_TITLE, CONFIG, PROGRESS_ACTIONS, LOC, coreCandidates } from './mp-pause-config.js';
import styles from './mp-pause.scss.js';
import PauseCountdownOverlay from './mp-pause-overlay.js';

const STATE = { IDLE: "idle", PAUSED: "paused", COUNTDOWN: "countdown" };

const STYLE_ELEMENT_ID = "mpt-styles";
const READY_BUTTON_ID = "mpt-ready-button";
const VIEW_MAP_BUTTON_ID = "mpt-viewmap-button";
const PAUSE_BUTTON_ID = "mpt-pause-button";
const HOST_HINT_ID = "mpt-host-hint";
const FOOTER_READY_ID = "mpt-footer-ready";
const PAUSE_MENU_CONTAINER = "#pause-menu-button-container";
const NATIVE_RESUME_BUTTON = "#pause-menu-resume-button";

class MultiplayerPauseManager {
  // --- runtime state ---
  state = STATE.IDLE;
  isMultiplayer = false;
  iHoldFlag = false;          // does THIS client hold a want-pause flag?
  finalizing = false;         // countdown finished, releasing our flag
  pauseStart = 0;
  maxCount = 0;               // peak want-pause count (calibrates player total)
  pauseReason = "";           // optional cause shown in the menu (e.g. disconnect)
  pollTimer = 0;
  countdownTimer = 0;
  progressFiltersActive = false;
  menuListenerBound = false;
  connState = {};             // playerId -> last-known connected? (disconnect watchdog)
  watchedHumans = [];         // human player ids monitored for drops
  connectionTimer = 0;
  acknowledged = {};          // disconnected ids the players deliberately resumed past
  disconnectNotices = [];     // { id, name } per currently-disconnected player (menu display)
  viewHiddenForcedEl = null;  // production chooser element we forced "View Hidden" on

  // --- core singletons (resolved lazily in loadCoreSingletons) ---
  inputFilter = null;
  interfaceMode = null;
  dialogBox = null;

  // --- reusable components ---
  overlay = new PauseCountdownOverlay();

  // --- bound engine listeners ---
  gamePauseStateChangedListener = (data) => this.onGamePauseStateChanged(data);
  playerDisconnectedListener = (data) => this.onPlayerDisconnected(data);
  interfaceModeChangedListener = () => this.onInterfaceModeChanged();
  playerTurnActivatedListener = () => this.onTurnActivated();
  playerConnectedListener = (data) => this.onPlayerConnected(data);
  hostMigratedListener = (data) => this.onHostMigrated(data);

  constructor() {
    engine.whenReady.then(() => this.onReady());
  }

  // ============================ Small helpers ============================
  log(m) { try { console.log("[MultiplayerToolkit] " + m); } catch (e) {} }
  warn(m) { try { console.warn("[MultiplayerToolkit] " + m); } catch (e) {} }

  amHost() {
    try { return GameContext.localPlayerID === Network.getHostPlayerId(); }
    catch (e) { return false; }
  }
  numWantPause() {
    try { return Network.getNumWantPausePlayers() | 0; } catch (e) { return 0; }
  }
  toggleEnginePause() {
    try { Network.toggleMultiplayerPause(); return true; }
    catch (e) { this.warn("toggleMultiplayerPause failed: " + e); return false; }
  }
  humanPlayerCount() {
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
  totalPlayers() { return Math.max(this.humanPlayerCount(), this.maxCount, 1); }
  readyCount() { return Math.max(0, this.totalPlayers() - this.numWantPause()); }
  converged() { return (Date.now() - this.pauseStart) >= CONFIG.convergenceDelayMs; }

  // ===================== Core singletons (dynamic import) =====================
  async importFirst(candidates) {
    for (const path of candidates) {
      try { const m = await import(path); if (m) return m; } catch (e) { /* next */ }
    }
    return null;
  }
  async loadCoreSingletons() {
    const inputMod = await this.importFirst(coreCandidates("input/input-filter.js"));
    this.inputFilter = inputMod ? (inputMod.default || inputMod) : null;
    if (this.inputFilter) { try { this.inputFilter.allowFilters = true; } catch (e) {} }

    const imMod = await this.importFirst(coreCandidates("interface-modes/interface-modes.js"));
    this.interfaceMode = imMod ? (imMod.InterfaceMode || imMod.default || null) : null;

    const dbMod = await this.importFirst(coreCandidates("dialog-box/manager-dialog-box.js"));
    this.dialogBox = dbMod ? (dbMod.DialogBoxManager || dbMod.default || null) : null;

    this.suppressNativePausePopup();
    this.log("singletons: inputFilter=" + !!this.inputFilter +
      " interfaceMode=" + !!this.interfaceMode + " dialogBox=" + !!this.dialogBox);
  }

  // Wrap the shared DialogBoxManager so the stock multiplayer "Game Paused"
  // popup is never created; our own menu + overlay replace it. Everything else
  // passes through untouched. No base-game files are modified.
  suppressNativePausePopup() {
    const mgr = this.dialogBox;
    if (!mgr || typeof mgr.createDialog_MultiOption !== "function" || mgr.__mptPatched) return;
    const original = mgr.createDialog_MultiOption.bind(mgr);
    mgr.createDialog_MultiOption = function (params) {
      if (params && params.title === NATIVE_PAUSE_DIALOG_TITLE) {
        return "mpt-suppressed-pause-dialog";
      }
      return original(params);
    };
    mgr.__mptPatched = true;
    this.log("Native 'Game Paused' popup suppressed.");
  }

  // ============================= Input filtering =============================
  applyProgressFilters() {
    if (this.progressFiltersActive || !this.inputFilter) return;
    for (const name of PROGRESS_ACTIONS) {
      try { this.inputFilter.addInputFilter({ inputName: name, filterSource: FILTER_SOURCE }); } catch (e) {}
    }
    this.progressFiltersActive = true;
  }
  clearProgressFilters() {
    if (!this.progressFiltersActive) return;
    if (this.inputFilter) {
      for (const name of PROGRESS_ACTIONS) {
        try { this.inputFilter.removeInputFilter({ inputName: name, filterSource: FILTER_SOURCE }); } catch (e) {}
      }
    }
    this.progressFiltersActive = false;
  }

  // ===================== Interface mode (built-in pause menu) =================
  pauseMenuIsOpen() {
    try {
      if (this.interfaceMode && typeof this.interfaceMode.isInInterfaceMode === "function") {
        return this.interfaceMode.isInInterfaceMode(PAUSE_MENU_MODE);
      }
    } catch (e) { /* fall through */ }
    return !!document.querySelector("#screen-pause-menu");
  }
  openPauseMenu() {
    if (this.pauseMenuIsOpen()) return;
    try { this.interfaceMode?.switchTo?.(PAUSE_MENU_MODE); }
    catch (e) { this.warn("openPauseMenu failed: " + e); }
  }
  closePauseMenu() {
    if (!this.pauseMenuIsOpen()) return;
    try { this.interfaceMode?.switchToDefault?.(); }
    catch (e) { this.warn("closePauseMenu failed: " + e); }
  }

  // ================================= Styles ==================================
  injectStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    el.textContent = styles;
    document.head.appendChild(el);
  }

  // ====================== Pause-menu button injection ========================
  onInterfaceModeChanged() {
    if (this.pauseMenuIsOpen()) this.tryInjectWhenMenuReady(0);
  }
  // Hook the lightweight "interface-mode-changed" event (not a DOM observer) so
  // injection only runs when the pause menu actually opens.
  startMenuListener() {
    if (!this.menuListenerBound) {
      window.addEventListener("interface-mode-changed", this.interfaceModeChangedListener);
      this.menuListenerBound = true;
    }
    if (this.pauseMenuIsOpen()) this.tryInjectWhenMenuReady(0);
  }
  tryInjectWhenMenuReady(attempt) {
    attempt = attempt || 0;
    const container = document.querySelector(PAUSE_MENU_CONTAINER);
    if (container) { this.injectMenuButtons(container); return; }
    if (attempt < 20) setTimeout(() => this.tryInjectWhenMenuReady(attempt + 1), 50);
  }
  // fxs-button dispatches "action-activate" for both mouse and controller, just
  // like the base game's own buttons - using only this avoids double-invocation.
  makeButton(id, caption, onActivate) {
    const btn = document.createElement("fxs-button");
    btn.id = id;
    btn.classList.add("pause-menu-button", "mpt-injected");
    btn.setAttribute("caption", caption);
    btn.addEventListener("action-activate", onActivate);
    return btn;
  }
  injectMenuButtons(container) {
    const paused = this.state === STATE.PAUSED;
    const nativeResume = container.querySelector(NATIVE_RESUME_BUTTON);
    container.querySelectorAll(".mpt-injected").forEach((el) => el.remove());

    if (paused) {
      // The native ui-next "Resume Game" hero button can't be reliably hooked to
      // unpause (it only closes the menu), so hide it and use our own controls.
      if (nativeResume) nativeResume.style.display = "none";

      const hint = document.createElement("div");
      hint.className = "mpt-host-hint mpt-injected";
      hint.id = HOST_HINT_ID;
      hint.innerHTML = this.hostHintHTML();

      const readyCaption = this.amHost() ? LOC.resumeHost : (this.iHoldFlag ? LOC.ready : LOC.cancelReady);
      const readyBtn = this.makeButton(READY_BUTTON_ID, readyCaption, (ev) => this.onReadyClick(ev));
      const viewBtn = this.makeButton(VIEW_MAP_BUTTON_ID, LOC.viewMap, (ev) => this.onViewMapClick(ev));

      // Top of the menu, in order: hint, Resume button, then View Map below it.
      const first = container.firstChild;
      container.insertBefore(hint, first);
      container.insertBefore(readyBtn, first);
      container.insertBefore(viewBtn, first);

      this.injectFooterReady();
    } else {
      // Not paused: keep the native Resume and put Pause Game below it.
      if (nativeResume) nativeResume.style.display = "";
      this.removeFooterReady();
      const pauseBtn = this.makeButton(PAUSE_BUTTON_ID, LOC.pauseGame, (ev) => this.onPauseClick(ev));
      if (nativeResume) container.insertBefore(pauseBtn, nativeResume.nextSibling);
      else container.insertBefore(pauseBtn, container.firstChild);
    }
  }

  // ===================== Status hint & footer ready tally ====================
  footerContainer() {
    const gi = document.querySelector(".pause-menu-game-info");
    return gi ? gi.parentElement : null;
  }
  footerReadyText() {
    const n = this.totalPlayers();
    const r = this.converged() ? this.readyCount() : 0;   // avoid a misleading early tally
    return "Ready: " + r + " / " + n;
  }
  applyFooterClass(el) {
    const n = this.totalPlayers();
    const threshold = CONFIG.votingEnabled ? CONFIG.voteThreshold : 1;   // no voting: green only at consensus
    const enough = this.converged() && n > 0 && (this.readyCount() / n) >= threshold;
    el.classList.toggle("mpt-enough", enough);
    el.classList.toggle("mpt-not-enough", !enough);
  }
  injectFooterReady() {
    let el = document.querySelector("#" + FOOTER_READY_ID);
    if (!el) {
      const fc = this.footerContainer();
      if (!fc) return;
      el = document.createElement("div");
      el.id = FOOTER_READY_ID;
      el.className = "mpt-footer-ready";
      fc.appendChild(el);
    }
    el.textContent = this.footerReadyText();
    this.applyFooterClass(el);
  }
  removeFooterReady() {
    const el = document.querySelector("#" + FOOTER_READY_ID);
    if (el) el.remove();
  }
  /** Player display name like "Name#12345": gamertag fields first, LOC keys composed. */
  composePlayerName(raw) {
    if (!raw) return "";
    try { return Locale.compose(raw); } catch (e) { return String(raw); }
  }
  playerNameById(id) {
    try {
      const pc = Configuration.getPlayer(id);
      return this.composePlayerName(pc && (pc.nickName_T2GP || pc.nickName || pc.slotName));
    } catch (e) { return ""; }
  }
  addDisconnectNotice(id, name) {
    if (id !== null && this.disconnectNotices.some((n) => n.id === id)) return;
    if (name && this.disconnectNotices.some((n) => n.name === name)) return;
    this.disconnectNotices.push({ id, name: name || "A player" });
    this.refreshStatus();
  }
  removeDisconnectNotice(id) {
    this.disconnectNotices = this.disconnectNotices.filter((n) => n.id !== id);
    this.refreshStatus();
  }
  hostHintHTML() {
    // One line per disconnected player (bright red, padded - see .mpt-reason).
    const notices = this.disconnectNotices
      .map((n) => '<div class="mpt-reason">' + n.name + ' disconnected.</div>')
      .join("");
    const reason = this.pauseReason ? ('<div class="mpt-reason">' + this.pauseReason + '</div>') : "";
    let line;
    if (this.amHost()) line = "You are the host. Resume when ready.";
    else if (!this.iHoldFlag) line = "You are ready. Waiting for the host to resume.";
    else line = "Waiting for the host to resume.";
    return notices + reason + line;
  }
  refreshStatus() {
    const hint = document.querySelector("#" + HOST_HINT_ID);
    if (hint) hint.innerHTML = this.hostHintHTML();
    let footer = document.querySelector("#" + FOOTER_READY_ID);
    if (!footer && this.state === STATE.PAUSED) {
      this.injectFooterReady();
      footer = document.querySelector("#" + FOOTER_READY_ID);
    }
    if (footer) { footer.textContent = this.footerReadyText(); this.applyFooterClass(footer); }
    const rb = document.querySelector("#" + READY_BUTTON_ID);
    if (rb && !this.amHost()) rb.setAttribute("caption", this.iHoldFlag ? LOC.ready : LOC.cancelReady);
  }

  // ============================== Button handlers ============================
  onPauseClick(ev) {
    ev?.stopPropagation?.();
    if (!this.isMultiplayer || this.state !== STATE.IDLE) return;
    if (this.numWantPause() > 0) return;       // already paused elsewhere
    this.pauseReason = "";
    this.iHoldFlag = true;
    this.toggleEnginePause();
  }
  onReadyClick(ev) {
    ev?.stopPropagation?.();
    if (this.state !== STATE.PAUSED) return;
    this.iHoldFlag = !this.iHoldFlag;   // toggle our readiness (drop = ready)
    this.toggleEnginePause();
    this.refreshStatus();
  }
  onViewMapClick(ev) {
    ev?.stopPropagation?.();
    if (this.state !== STATE.PAUSED) return;
    this.closePauseMenu();              // return to the world; Esc re-opens the menu
  }

  // ======================= Synchronized state machine ========================
  onGamePauseStateChanged(data) {
    if (!this.isMultiplayer) return;
    const paused = !!data && Number(data.data) === 1;
    if (paused) {
      if (this.state === STATE.IDLE) this.enterPaused();
      else if (this.state === STATE.PAUSED) this.refreshStatus();
      // COUNTDOWN: our own re-pause during the countdown -> ignore
    } else {
      if (this.state === STATE.PAUSED) this.beginCountdown();
      else if (this.state === STATE.COUNTDOWN) { if (this.finalizing) this.enterIdle(); }
      else this.enterIdle();
    }
  }
  enterPaused() {
    this.state = STATE.PAUSED;
    this.pauseStart = Date.now();
    this.maxCount = this.numWantPause();
    if (!this.iHoldFlag) { this.iHoldFlag = true; this.toggleEnginePause(); }
    this.applyProgressFilters();
    this.openPauseMenu();
    this.startMenuListener();
    this.startPoll();
  }
  startPoll() {
    this.stopPoll();
    this.pollTimer = setInterval(() => this.onPoll(), CONFIG.pollMs);
  }
  stopPoll() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = 0; }
  }
  /**
   * While paused every city operation fails, so with "View Hidden" off the
   * production chooser renders empty categories. Force it on through the
   * chooser's own setter (items appear, disabled) once per chooser-open, and
   * restore it on unpause. The user can still toggle it manually meanwhile.
   */
  syncProductionChooser() {
    const el = document.querySelector("panel-production-chooser");
    const chooser = el?.maybeComponent;
    if (!el || !chooser) { this.viewHiddenForcedEl = null; return; }
    if (this.viewHiddenForcedEl === el) return;   // already handled this open
    try {
      if (chooser.viewHidden === false) {
        chooser.viewHidden = true;
        this.log("Production chooser: 'View Hidden' forced on while paused.");
      }
      this.viewHiddenForcedEl = el;
    } catch (e) { /* chooser internals changed; leave it alone */ }
  }
  restoreProductionChooser() {
    const chooser = document.querySelector("panel-production-chooser")?.maybeComponent;
    if (chooser && this.viewHiddenForcedEl) {
      try { chooser.viewHidden = false; } catch (e) { /* ignore */ }
    }
    this.viewHiddenForcedEl = null;
  }

  onPoll() {
    if (this.state !== STATE.PAUSED) return;
    const count = this.numWantPause();
    if (count > this.maxCount) this.maxCount = count;
    this.syncProductionChooser();

    // The pause menu is a reactive (SolidJS) screen; if a re-render dropped our
    // injected buttons while it is open, put them back.
    if (this.pauseMenuIsOpen() && !document.querySelector("#" + VIEW_MAP_BUTTON_ID)) {
      const c = document.querySelector(PAUSE_MENU_CONTAINER);
      if (c) this.injectMenuButtons(c);
    }
    this.refreshStatus();

    // Auto-resume evaluation (only matters while WE still hold a flag).
    if (!this.iHoldFlag) return;
    const t = Date.now() - this.pauseStart;
    if (t < CONFIG.convergenceDelayMs) return;
    const n = this.totalPlayers();
    const ratio = n > 0 ? this.readyCount() / n : 0;
    const voteResume = CONFIG.votingEnabled && (t >= CONFIG.voteDelayMs) && (ratio >= CONFIG.voteThreshold);
    const overrideResume = (t >= CONFIG.hostOverrideDelayMs) && (this.readyCount() >= 1);
    if (voteResume || overrideResume) { this.iHoldFlag = false; this.toggleEnginePause(); }
  }
  beginCountdown() {
    if (this.state === STATE.COUNTDOWN) return;
    this.state = STATE.COUNTDOWN;
    this.finalizing = false;
    this.stopPoll();
    this.closePauseMenu();
    // Keep the game PAUSED during the countdown: re-assert our flag immediately
    // (the last flag-clear briefly unpaused the engine to fire this event). The
    // real unpause only happens in finalizeResume().
    if (!this.iHoldFlag) { this.iHoldFlag = true; this.toggleEnginePause(); }
    this.applyProgressFilters();

    this.overlay.show(true);
    let remaining = CONFIG.resumeCountdownSeconds;
    const tick = () => {
      if (remaining <= 0) { this.finalizeResume(); return; }
      this.overlay.setValue(remaining);
      remaining -= 1;
      this.countdownTimer = setTimeout(tick, 1000);
    };
    tick();
  }
  // Countdown hit zero: release our flag. The game truly resumes only once every
  // client's countdown has finished and all flags are cleared.
  finalizeResume() {
    if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = 0; }
    this.finalizing = true;
    // The players chose to resume; accept AI control of anyone still absent so we
    // don't instantly re-pause them. A NEW disconnect later still pauses.
    for (const id of this.watchedHumans) {
      try { if (!Network.isPlayerConnected(id)) this.acknowledged[id] = true; } catch (e) {}
    }
    this.overlay.show(false);
    if (this.iHoldFlag) { this.iHoldFlag = false; this.toggleEnginePause(); }
    setTimeout(() => { if (this.state === STATE.COUNTDOWN) this.enterIdle(); }, CONFIG.finalizeBackstopMs);
  }
  enterIdle() {
    this.state = STATE.IDLE;
    this.stopPoll();
    if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = 0; }
    this.overlay.show(false);
    this.clearProgressFilters();
    const nativeResume = document.querySelector(NATIVE_RESUME_BUTTON);
    if (nativeResume) nativeResume.style.display = "";
    this.iHoldFlag = false;
    this.finalizing = false;
    this.maxCount = 0;
    this.pauseReason = "";
    this.disconnectNotices = [];
    this.restoreProductionChooser();
    this.removeFooterReady();
    this.startMenuListener();   // keep offering the Pause button while idle
  }

  // ============ Disconnect protection (no AI takeover) - THREE LAYERS =========
  // The single most important guarantee: when a human drops, the game must be
  // paused BEFORE the AI takes their turn. A UI mod cannot run code inside the
  // engine's AI turn-processing, so we defend at every UI hook the engine gives
  // us, all funnelling into requestDisconnectPause():
  //   1. The "MultiplayerPostPlayerDisconnected" event (reactive).
  //   2. A connection watchdog that polls Network.isPlayerConnected (proactive,
  //      catches drops even if the event is late or missed).
  //   3. A turn-activation guard: at the instant ANY turn begins, if a human is
  //      disconnected we pause first - this is the exact moment the engine would
  //      otherwise hand the absent player's turn to the AI.

  /** List of currently human, non-observer major player ids. */
  humanParticipantIds() {
    const out = [];
    try {
      const ids = Players.getAliveMajorIds();
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        let pc = null;
        try { pc = Configuration.getPlayer(id); } catch (e) { pc = null; }
        if (pc && pc.isHuman && !pc.isObserver) out.push(id);
      }
    } catch (e) { /* fall through */ }
    return out;
  }

  /**
   * True if any monitored human slot is disconnected AND has not been
   * deliberately resumed past. The initial drop always trips this; once the
   * players consciously resume with someone absent we "acknowledge" them so the
   * turn guard does not fight that choice (a fresh drop later still trips it).
   */
  disconnectedHumanExists() {
    const ids = this.watchedHumans.length ? this.watchedHumans : this.humanParticipantIds();
    for (const id of ids) {
      if (this.acknowledged[id]) continue;
      let connected = true;
      try { connected = Network.isPlayerConnected(id); } catch (e) { connected = true; }
      if (!connected) return true;
    }
    return false;
  }

  /** Shared entry point: pause now (before AI) if we are idle and not at endgame. */
  requestDisconnectPause(reason) {
    if (this.state !== STATE.COUNTDOWN) this.pauseReason = reason;   // record on every client
    if (this.state !== STATE.IDLE) { this.refreshStatus(); return; }
    if (this.numWantPause() > 0) { this.refreshStatus(); return; }
    try { if (document.querySelector("#screen-endgame")) return; } catch (e) {}
    this.iHoldFlag = true;
    this.toggleEnginePause();
    this.log("Auto-paused before AI takeover: " + reason);
  }

  // Layer 1 - engine disconnect event.
  onPlayerDisconnected(data) {
    if (!this.isMultiplayer) return;
    let id = null;
    try { id = data && (data.player ?? data.playerID ?? data.data ?? null); } catch (e) {}
    let name = "";
    try { name = this.composePlayerName(data && (data.playerNameT2gp || data.playerName1Pgp)); } catch (e) {}
    if (!name && id !== null) name = this.playerNameById(id);
    this.addDisconnectNotice(id, name);
    this.requestDisconnectPause("");
  }

  // Layer 2 - connection watchdog (polled).
  primeConnections() {
    for (const id of this.humanParticipantIds()) {
      if (this.watchedHumans.indexOf(id) === -1) this.watchedHumans.push(id);
      try { this.connState[id] = Network.isPlayerConnected(id); } catch (e) { this.connState[id] = true; }
    }
  }
  startConnectionWatch() {
    if (this.connectionTimer) return;
    this.primeConnections();
    this.connectionTimer = setInterval(() => this.checkConnections(), CONFIG.connectionWatchMs);
  }
  checkConnections() {
    if (!this.isMultiplayer) return;
    // Keep the watch set current (covers hot-join).
    for (const id of this.humanParticipantIds()) {
      if (this.watchedHumans.indexOf(id) === -1) {
        this.watchedHumans.push(id);
        try { this.connState[id] = Network.isPlayerConnected(id); } catch (e) { this.connState[id] = true; }
      }
    }
    for (const id of this.watchedHumans) {
      let connected = true;
      try { connected = Network.isPlayerConnected(id); } catch (e) { connected = true; }
      const was = this.connState[id];
      this.connState[id] = connected;
      if (was === true && connected === false) {   // newly dropped (edge) -> pause once
        this.addDisconnectNotice(id, this.playerNameById(id));
        this.requestDisconnectPause("");
      }
    }
  }
  onPlayerConnected(payload) {
    let id = null;
    try { id = payload && (payload.data !== undefined ? payload.data : payload.player); } catch (e) {}
    if (id === undefined || id === null) return;
    if (this.watchedHumans.indexOf(id) === -1) this.watchedHumans.push(id);
    this.connState[id] = true;       // reconnected -> a later drop is a fresh edge
    delete this.acknowledged[id];    // and is eligible to pause again if it drops
    this.removeDisconnectNotice(id);
    // A rejoin forces every client through a resync/reload; make sure the game
    // is paused and the pause menu is up on everyone's screen for its duration.
    const name = this.playerNameById(id);
    if (this.state === STATE.IDLE) {
      this.requestDisconnectPause((name || "A player") + " is reconnecting - resyncing.");
    } else {
      this.pauseReason = (name || "A player") + " is reconnecting - resyncing.";
      this.openPauseMenu();
      this.refreshStatus();
    }
    this.log("Player " + id + " connected.");
  }

  /**
   * Host migration: when the host drops or changes, the pause guarantee must
   * survive the switch. Pause (if running), re-render the menu so the new
   * host's controls appear, and refresh every client's hint text.
   */
  onHostMigrated(data) {
    if (!this.isMultiplayer) return;
    this.log("Host migrated" + (data && data.player !== undefined ? " to player " + data.player : "") + ".");
    if (this.state === STATE.IDLE) {
      this.requestDisconnectPause("The host changed.");
    } else {
      this.pauseReason = "The host changed.";
    }
    // Captions depend on amHost(); rebuild the injected buttons on next poll.
    document.querySelectorAll(".mpt-injected").forEach((el) => el.remove());
    if (this.pauseMenuIsOpen()) this.tryInjectWhenMenuReady(0);
    this.refreshStatus();
  }

  // Layer 3 - turn-activation guard (the moment of AI takeover).
  onTurnActivated() {
    if (!this.isMultiplayer || this.state !== STATE.IDLE) return;
    if (this.disconnectedHumanExists()) {
      this.requestDisconnectPause("A player is disconnected.");
    }
  }

  // ================================ Lifecycle ================================
  isMultiplayerGame() {
    try { const c = Configuration.getGame(); return !!(c && c.isAnyMultiplayer); }
    catch (e) { return false; }
  }
  async onReady() {
    this.isMultiplayer = this.isMultiplayerGame();
    if (!this.isMultiplayer) { this.log("Single-player; Multiplayer Toolkit dormant."); return; }
    this.log("Multiplayer; initializing Multiplayer Toolkit.");
    await this.loadCoreSingletons();
    this.injectStyles();
    this.overlay.build();
    engine.on("GamePauseStateChanged", this.gamePauseStateChangedListener);
    // Disconnect protection layers (see "Disconnect protection" section).
    engine.on("MultiplayerPostPlayerDisconnected", this.playerDisconnectedListener);
    engine.on("MultiplayerPlayerConnected", this.playerConnectedListener);
    engine.on("MultiplayerHostMigrated", this.hostMigratedListener);
    engine.on("PlayerTurnActivated", this.playerTurnActivatedListener);
    engine.on("RemotePlayerTurnBegin", this.playerTurnActivatedListener);
    this.startConnectionWatch();
    if (this.numWantPause() > 0) this.onGamePauseStateChanged({ data: 1 });
    else this.enterIdle();
  }
}

const MultiplayerPause = new MultiplayerPauseManager();
export { MultiplayerPause as default };
