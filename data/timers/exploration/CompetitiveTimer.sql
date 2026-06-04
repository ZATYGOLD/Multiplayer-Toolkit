-- data/timers/exploration/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE TurnSegments
SET TimeLimit_Base = 20,
    TimeLimit_PerCity = 1,
    TimeLimit_PerUnit = 1
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 2, 
    PerTurn = 1
WHERE ScalingId = 'DEFAULT';

