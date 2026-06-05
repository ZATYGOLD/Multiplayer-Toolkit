-- data/timers/TimerScaling.sql
-- Author: Zatygold

--*******************************************************
--*************** ADDITIONAL TIMER SCALING **************
--*******************************************************
-- Schema and default values; each Age may override below files.
--   + PerHuman * (living human players)
--   + PerTurn  * (current turn number)
-- Decimal values (e.g. 1.25) are supported.
CREATE TABLE IF NOT EXISTS MPT_TimerScaling 
    (
        ScalingId TEXT NOT NULL, 
        PerHuman REAL NOT NULL DEFAULT 0, 
        PerTurn REAL NOT NULL DEFAULT 0, 
        PRIMARY KEY(ScalingId)
    );

INSERT OR REPLACE INTO MPT_TimerScaling (ScalingId, PerHuman, PerTurn)
    VALUES ('DEFAULT', 2, 1);

--*******************************************************
--************** MPT COMPETITIVE TURN SEGMENT ***********
--*******************************************************
-- Mod-owned copy of the segment numbers so the Competitive timer is fully
-- separate from the Dynamic timer (the game's TurnSegments is never modified).
CREATE TABLE IF NOT EXISTS MPT_TurnSegments 
    (
        TurnSegmentType TEXT NOT NULL, 
        TimeLimit_Base REAL NOT NULL DEFAULT 0, 
        TimeLimit_PerCity REAL NOT NULL DEFAULT 0, 
        TimeLimit_PerUnit REAL NOT NULL DEFAULT 0, 
        PRIMARY KEY(TurnSegmentType)
    );

INSERT OR REPLACE INTO MPT_TurnSegments 
    (TurnSegmentType, TimeLimit_Base, TimeLimit_PerCity, TimeLimit_PerUnit)
    VALUES ('TURN_SEGMENT_SINGLEPHASE', 20, 1, 1);
