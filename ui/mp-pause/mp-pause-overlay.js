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
 * Multiplayer Toolkit - resume countdown overlay.
 *
 * A small, self-contained component that owns the full-screen "UNPAUSING..."
 * element. It only manipulates its own DOM, so it can be reused/replaced
 * independently of the pause manager.
 */
import { CONFIG } from './mp-pause-config.js';

const OVERLAY_ID = "mpt-countdown";

class PauseCountdownOverlay {
  element = null;

  /** Create the overlay element once and attach it to the document body. */
  build() {
    if (this.element) {
      return;
    }
    const el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.innerHTML =
      '<div class="mpt-count-label">Unpausing...</div>' +
      '<div class="mpt-count-num">' + CONFIG.resumeCountdownSeconds + '</div>';
    document.body.appendChild(el);
    this.element = el;
  }

  /** Show or hide the overlay. */
  show(visible) {
    if (this.element) {
      this.element.classList.toggle("mpt-show", !!visible);
    }
  }

  /** Update the big countdown number and replay its pop animation. */
  setValue(seconds) {
    if (!this.element) {
      return;
    }
    const num = this.element.querySelector(".mpt-count-num");
    if (!num) {
      return;
    }
    num.textContent = String(seconds);
    num.style.animation = "none";
    void num.offsetWidth;       // force reflow so the animation restarts
    num.style.animation = "";
  }
}

export { PauseCountdownOverlay as default };
