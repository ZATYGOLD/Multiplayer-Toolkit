-- config/mpt-input.sql
-- Author: Zatygold
--
-- Registers a rebindable "Pause Game" keyboard action so it appears in the
-- game's own Options -> keyboard mapping screen. Default gesture is P.
-- NOTE: P is also the base game's default for "open-attributes" (both are
-- universal), so out of the box P triggers both; either can be rebound from
-- the same menu now that this action is listed there.

INSERT OR REPLACE INTO InputActions
    (ActionId, DeviceType, Name, Description, SortIndex)
    VALUES ('mpt-pause-game', 'Keyboard', 'LOC_MPT_PAUSE_KEYBIND', 'LOC_MPT_PAUSE_KEYBIND_TT', 100);

INSERT OR REPLACE INTO InputActionDefaultGestures
    (ActionId, "Index", GestureType, GestureData)
    VALUES ('mpt-pause-game', 0, 'KBMouse', 'KEY_P');
