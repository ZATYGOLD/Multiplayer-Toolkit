-- data/timers/antiquity/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE MPT_TurnSegments
SET TimeLimit_Base = 15,
    TimeLimit_PerCity = 1,
    TimeLimit_PerUnit = 1
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

UPDATE MPT_TimerScaling
SET PerHuman = 1,
    PerTurn = 1.25
WHERE ScalingId = 'DEFAULT';
