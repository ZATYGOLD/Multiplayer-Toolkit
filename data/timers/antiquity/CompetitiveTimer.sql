-- data/timers/antiquity/CompetitiveTimer.sql
-- Author: Zatygold

UPDATE TurnSegments
SET TimeLimit_Base = 30,
    TimeLimit_PerCity = 1,
    TimeLimit_PerUnit = 2
WHERE TurnSegmentType = 'TURN_SEGMENT_SINGLEPHASE';

--*******************************************************
--*************** ADDITIONAL TIMER SCALING **************
--*******************************************************
-- Extra seconds layered on top of the segment values above:
--   + PerHuman * (living human players)
--   + PerTurn  * (current turn number)

CREATE TABLE IF NOT EXISTS MPT_TimerScaling
    (
        ScalingId TEXT NOT NULL,
        PerHuman INTEGER NOT NULL DEFAULT 0,
        PerTurn INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(ScalingId)
    );

INSERT OR REPLACE INTO MPT_TimerScaling (ScalingId, PerHuman, PerTurn)
    VALUES ('DEFAULT', 2, 1);
