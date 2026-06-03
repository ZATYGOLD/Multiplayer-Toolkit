-- data/timers/antiquity/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE TurnSegments
SET TimeLimit_Base = 20,
    TimeLimit_PerCity = 1,
    TimeLimit_PerUnit = 2
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';