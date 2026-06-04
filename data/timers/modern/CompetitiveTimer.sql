-- data/timers/modern/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE TurnSegments
SET TimeLimit_Base = 25,
    TimeLimit_PerCity = 2,
    TimeLimit_PerUnit = 2
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.5, 
    PerTurn = 1.75
WHERE ScalingId = 'DEFAULT';
