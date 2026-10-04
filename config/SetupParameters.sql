-- config/SetupParameters.sql
-- Author: Zatygold

--*******************************************************
--***************** TURN TIMER SETTINGS *****************
--*******************************************************
INSERT INTO TurnTimers (Domain, TurnTimerType, Name,  Description, SortIndex)
    VALUES ('StandardTurnTimers', 'MPT_TURNTIMER_COMPETITIVE', 'LOC_MPT_TURNTIMER_COMPETITIVE', 'LOC_MPT_TURNTIMER_COMPETITIVE_DESC', 15);
