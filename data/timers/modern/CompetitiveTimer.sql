-- data/timers/antiquity/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE TurnSegments
SET TimeLimit_Base = 500,
    TimeLimit_PerCity = 10,
    TimeLimit_PerUnit = 20
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';