-- data/timers/TimerScaling.sql
-- Author: Zatygold

--*******************************************************
--*************** ADDITIONAL TIMER SCALING **************
--*******************************************************
-- Schema and default values; each Age may override below files.
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
