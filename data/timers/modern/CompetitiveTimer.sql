-- data/timers/modern/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 30,
    TimeLimit_PerCity = 2.15,
    TimeLimit_PerUnit = 2.15
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.55,
    PerTurn = 1.75
WHERE ScalingId = 'DEFAULT';
