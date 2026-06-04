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
