-- Multiplayer Toolkit - the Observer earns no Triumphs (gameplay database, every Age).
--
-- The Observer's Eye sees the whole map, which can complete Triumphs such as
-- "First to Circumnavigate" and take a first-player-only Triumph from a real
-- player. Every Triumph's trigger set (all TEST_ALL) also requires the player
-- not to be the Observer. ProgressWeight 0 keeps the extra requirement out of
-- each Triumph's progress count. Loaded after the Age modules, so it covers
-- every Triumph defined by then (DLC included).

INSERT OR IGNORE INTO Requirements (RequirementId, RequirementType, Inverse, ProgressWeight)
VALUES ('REQ_MPT_LEGACY_NOT_OBSERVER', 'REQUIREMENT_PLAYER_LEADER_TYPE_MATCHES', 1, 0);

INSERT OR IGNORE INTO RequirementArguments (RequirementId, Name, Value)
VALUES ('REQ_MPT_LEGACY_NOT_OBSERVER', 'LeaderType', 'LEADER_MPT_OBSERVER');

INSERT OR IGNORE INTO RequirementSetRequirements (RequirementSetId, RequirementId)
SELECT DISTINCT lm.RequirementSetId, 'REQ_MPT_LEGACY_NOT_OBSERVER'
FROM LegacyModifiers lm
JOIN RequirementSets rs ON rs.RequirementSetId = lm.RequirementSetId
WHERE rs.RequirementSetType = 'REQUIREMENTSET_TEST_ALL';
