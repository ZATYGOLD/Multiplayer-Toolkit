-- config/turn-timers.sql
-- Author: Zatygold

--*******************************************************
--************** COMPETITIVE TIMER SETTINGS *************
--*******************************************************
INSERT INTO TurnTimers (Domain, TurnTimerType, Name, Description, SortIndex)
VALUES ('StandardTurnTimers', 'MPT_TURNTIMER_COMPETITIVE', 'LOC_MPT_TURNTIMER_COMPETITIVE', 'LOC_MPT_TURNTIMER_COMPETITIVE_DESC', 40);
