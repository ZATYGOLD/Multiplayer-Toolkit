-- data/timers/exploration/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 20,
    TimeLimit_PerCity = 2,
    TimeLimit_PerUnit = 1
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.25,
    PerTurn = 1.5
WHERE ScalingId = 'DEFAULT';
