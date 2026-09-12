-- data/timers/antiquity/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 10,
    TimeLimit_PerCity = 1,
    TimeLimit_PerUnit = 1
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1.1,
    PerTurn = 1.1
WHERE ScalingId = 'DEFAULT';
