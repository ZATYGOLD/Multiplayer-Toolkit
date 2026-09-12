-- data/timers/exploration/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 25,
    TimeLimit_PerCity = 2.15,
    TimeLimit_PerUnit = 1.15
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.25,
    PerTurn = 1.55
WHERE ScalingId = 'DEFAULT';
