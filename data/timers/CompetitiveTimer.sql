-- data/timers/CompetitiveTimer.sql
-- Author: Zatygold
--
-- Adds "Competitive" to the multiplayer Turn Timer dropdown, alongside the
-- built-in None / Standard / Dynamic. This is the visual entry only; selecting
-- it does not yet drive any timing logic.
--
-- Loaded in the shell (setup) scope so it lands in the configuration database,
-- where the TurnTimers domain feeds the lobby. Text tags are defined in
-- text/en_us/mpt-text.xml.

INSERT INTO TurnTimers 
    (
        Domain, 
        TurnTimerType,
        Name, 
        Description, 
        SortIndex
    )
VALUES
    (
        'StandardTurnTimers',
        'MPT_TURNTIMER_COMPETITIVE', 
        'LOC_MPT_TURNTIMER_COMPETITIVE', 
        'LOC_MPT_TURNTIMER_COMPETITIVE_DESC', 
        40
    );