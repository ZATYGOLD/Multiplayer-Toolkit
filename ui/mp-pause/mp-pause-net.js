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
 * Multiplayer Toolkit - lightweight cross-client RPC over multiplayer chat.
 *
 * Civilization VII exposes no custom UI network message, but it does expose
 * chat: Network.sendChat(text, target, id) to send and the "MultiplayerChat"
 * engine event to receive. Following the approach proven by the Civ VI
 * "Multiplayer Helper" mod, we tunnel small commands through chat - a prefixed
 * message every client parses - so one authorized player can drive an action
 * on every other client (e.g. the host resuming the game for everyone).
 *
 * Command lines are hidden from the visible chat window by patching the chat
 * screen's createMessage to drop any message carrying our prefix. Handlers get
 * { from, arg }; callers should validate authority (isFromHost) themselves.
 */

import { CONFIG } from './mp-pause-config.js';

const PREFIX = "​MPTNET:";   // leading zero-width space keeps it untypeable/inconspicuous
const handlers = {};
let listenerBound = false;

function log(m) { try { console.log("[MPT net] " + m); } catch (e) {} }

const MPTNet = {
  /** Broadcast a command (optionally with a string arg) to every player. */
  send(cmd, arg) {
    try {
      const msg = PREFIX + cmd + (arg != null ? (":" + String(arg)) : "");
      Network.sendChat(msg, ChatTargetTypes.CHATTARGET_ALL, -1);
    } catch (e) { log("send failed: " + e); }
  },
  /** Register a handler for a command name. Handler receives { from, arg }. */
  on(cmd, fn) { handlers[cmd] = fn; },
  /** True when the sender is the game host. */
  isFromHost(fromPlayer) {
    try { return fromPlayer === Network.getHostPlayerId(); } catch (e) { return false; }
  }
};

function onChat(data) {
  try {
    const text = data && data.text;
    if (typeof text !== "string" || text.indexOf(PREFIX) !== 0) return;
    const body = text.slice(PREFIX.length);
    const idx = body.indexOf(":");
    const cmd = idx >= 0 ? body.slice(0, idx) : body;
    const arg = idx >= 0 ? body.slice(idx + 1) : undefined;
    const fn = handlers[cmd];
    if (fn) fn({ from: data.fromPlayer, arg });
  } catch (e) { /* ignore malformed */ }
}

function bindReceiver() {
  if (listenerBound) return;
  try { engine.on("MultiplayerChat", onChat); listenerBound = true; log("receiver bound"); }
  catch (e) { log("bind failed: " + e); }
}

/**
 * Hide our command messages from the chat window. createMessage is a real
 * prototype method on the chat screen; we let it build the genuine message
 * element (so the chat list never receives a malformed node) and only hide it
 * when it carries our prefix. Never throws into the chat's render path.
 */
function suppressChatDisplay(attempts) {
  try {
    const def = Controls.getDefinition ? Controls.getDefinition("screen-mp-chat") : null;
    const cls = def && def.createInstance;
    if (cls && cls.prototype && !cls.prototype.mptNetPatched) {
      const base = cls.prototype.createMessage;
      if (typeof base === "function") {
        cls.prototype.createMessage = function (data) {
          const el = base.call(this, data);   // always the real, well-formed element
          try {
            const t = data && data.text;
            if (el && typeof t === "string" && t.indexOf(PREFIX) === 0 && el.style) {
              el.style.display = "none";       // keep OUR command line invisible
            }
          } catch (e) { /* leave the message as-is */ }
          return el;
        };
        cls.prototype.mptNetPatched = true;
        log("chat command display suppressed");
        return;
      }
    }
  } catch (e) { /* retry */ }
  if (attempts > 0) setTimeout(() => suppressChatDisplay(attempts - 1), 300);
}

engine.whenReady.then(() => {
  // The chat-RPC only exists to serve host-authoritative resume. When that is
  // off, do not touch the chat screen at all - both a clean fallback and an A/B
  // switch for diagnosing chat issues.
  if (CONFIG.hostAuthoritativeResume === false) { log("chat-RPC disabled via config"); return; }
  bindReceiver();
  suppressChatDisplay(30);
});

export default MPTNet;
