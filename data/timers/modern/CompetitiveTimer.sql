-- data/timers/modern/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 20,
    TimeLimit_PerCity = 2,
    TimeLimit_PerUnit = 1.5
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.3,
    PerTurn = 1.3
WHERE ScalingId = 'DEFAULT';
