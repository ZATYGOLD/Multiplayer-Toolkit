-- data/timers/modern/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE TurnSegments
SET TimeLimit_Base = 25,
    TimeLimit_PerCity = 1,
    TimeLimit_PerUnit = 1
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 2, 
    PerTurn = 2
WHERE ScalingId = 'DEFAULT';
