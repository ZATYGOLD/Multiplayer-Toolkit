-- data/timers/modern/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 15,
    TimeLimit_PerCity = 1.25,
    TimeLimit_PerUnit = 1.00
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.50,
    PerTurn = 1.50
WHERE ScalingId = 'DEFAULT';
