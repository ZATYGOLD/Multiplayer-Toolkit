-- config/SetupParameters.sql
-- Author: Zatygold

--*******************************************************
--***************** TURN TIMER SETTINGS *****************
--*******************************************************
INSERT INTO TurnTimers (Domain, TurnTimerType, Name,  Description, SortIndex)
    VALUES ('StandardTurnTimers', 'MPT_TURNTIMER_COMPETITIVE', 'LOC_MPT_TURNTIMER_COMPETITIVE', 'LOC_MPT_TURNTIMER_COMPETITIVE_DESC', 15);

--*******************************************************
--***************** OBSERVER IN GAME ********************
--*******************************************************
-- Hidden. The lobby host sets it while any player is the Observer; the
-- modinfo loads the Observer's base-game overrides only when it is set.
INSERT INTO Parameters (ParameterID, Name, Description, Domain, Hash, DefaultValue, ConfigurationGroup, ConfigurationKey, GroupID, Hidden, ChangeableAfterGameStart, SortIndex)
    VALUES ('MPTObserverInGame', 'LOC_MPT_OBSERVER_IN_GAME', 'LOC_MPT_OBSERVER_IN_GAME', 'bool', 0, 0, 'Game', 'MPT_OBSERVER_IN_GAME', 'GameOptions', 1, 0, 9000);
