-- data/timers/exploration/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 15,
    TimeLimit_PerCity = 2,
    TimeLimit_PerUnit = 1.25
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.2,
    PerTurn = 1.2
WHERE ScalingId = 'DEFAULT';
