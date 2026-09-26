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
 * Multiplayer Toolkit - cross-client commands over multiplayer chat (in-game scope).
 *
 * Civilization VII has no custom UI network message, but it has chat
 * (Network.sendChat and the "MultiplayerChat" event). As in the Civ VI
 * "Multiplayer Helper" mod, small commands travel as prefixed chat lines that
 * every client parses, so one authorized player can drive an action on every
 * client (the host resuming the game for everyone). Handlers get
 * { from, arg } and validate authority themselves (isFromHost).
 *
 * Command lines never reach the chat window: chat screens skip them (no
 * message, sound, speech or unread badge) and any message element still built
 * for one is hidden. The mini-map binds the chat handler it first sees, so the
 * sound can still play until chat is first opened.
 */
import { createLogger, whenDefined, wrapMethod } from '../mpt-shared/mpt-util.js';
import { CONFIG } from './mp-pause-config.js';

const log = createLogger('net');
const PREFIX = "\u200BMPTNET:";   // leading zero-width space: untypeable and inconspicuous
const CHAT_TAG = "screen-mp-chat";
const handlers = {};

const isCommand = (data) => typeof data?.text === "string" && data.text.startsWith(PREFIX);

const MPTNet = {
  /** Broadcast a command (optionally with a string arg) to every player. */
  send(cmd, arg) {
    try { Network.sendChat(PREFIX + cmd + (arg != null ? ":" + String(arg) : ""), ChatTargetTypes.CHATTARGET_ALL, -1); }
    catch (e) { log("send failed: " + e); }
  },
  /** Register the handler for a command name. */
  on(cmd, fn) { handlers[cmd] = fn; },
  /** True when the sender is the game host. */
  isFromHost(fromPlayer) {
    try { return fromPlayer === Network.getHostPlayerId(); } catch (e) { return false; }
  }
};

function onChat(data) {
  if (!isCommand(data)) return;
  try {
    const body = data.text.slice(PREFIX.length);
    const idx = body.indexOf(":");
    const fn = handlers[idx >= 0 ? body.slice(0, idx) : body];
    fn?.({ from: data.fromPlayer, arg: idx >= 0 ? body.slice(idx + 1) : undefined });
  } catch (e) { /* ignore malformed */ }
}

/** Keep command lines out of the chat window. */
function hideCommandsFromChat() {
  whenDefined(CHAT_TAG, (definition) => {
    const proto = definition.createInstance.prototype;
    if (proto.mptNetPatched) return;
    proto.mptNetPatched = true;
    // onMultiplayerChat is an instance field (the mini-map binds it directly), so wrap it per instance.
    wrapMethod(proto, "onInitialize", function (base, ...args) {
      const result = base(...args);
      const handler = this.onMultiplayerChat;
      if (typeof handler === "function") this.onMultiplayerChat = (data, ...rest) => (isCommand(data) ? undefined : handler(data, ...rest));
      return result;
    });
    wrapMethod(proto, "createMessage", (base, data, ...rest) => {
      const el = base(data, ...rest);
      if (el?.style && isCommand(data)) el.style.display = "none";
      return el;
    });
  }, { retries: 30, intervalMs: 300, log });
}

// The chat channel only serves host-authoritative resume; with that off the chat screen is untouched.
if (CONFIG.hostAuthoritativeResume !== false) {
  engine.whenReady.then(() => {
    engine.on("MultiplayerChat", onChat);
    hideCommandsFromChat();
  });
}

export default MPTNet;
