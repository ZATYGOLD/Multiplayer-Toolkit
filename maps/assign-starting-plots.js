import { g_MinLandmassSizeForIslandBias, g_DesiredBufferBetweenMajorStarts, g_RequiredBufferBetweenMajorStarts } from './map-globals.js';
import { getSectorRegion, shuffle, isOceanAccess } from './map-utilities.js';
import { profileScope } from '../scripts/profiling.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/maps/assign-starting-plots.js
 * (build dated 2026-09-16); the ONLY change is the "MPT:" block below, which
 * wraps StartPositioner.setStartPosition. Re-apply after game updates.
 *
 * MPT: Observer players (leader LEADER_MPT_OBSERVER) never start on land with
 * the other majors. Whatever plot the map script chose for them is swapped
 * for the ocean tile nearest the bottom-center of the map that borders marine
 * ice (tucked into the ice, out of the way), else the nearest open water
 * bordering ice, else any open water, else the script's own choice; each
 * observer gets its own tile. The Observer's Eye (a naval unit that may enter
 * ocean) is created there directly - the game never places the Observer's
 * starting unit on its own. If the engine leaves it off the map (it did on
 * ice, which is impassable), it is moved to that tile, else to the nearest
 * open coast.
 */
(function mptObserverStartPositions() {
  const OBSERVER_LEADER = 'LEADER_MPT_OBSERVER';
  const EYE_UNIT = 'UNIT_MPT_OBSERVER_EYE';
  const usedPlots = new Set();

  const log = (m) => console.log('[MPT observer-start] ' + m);

  const isObserver = (playerId) => {
    try {
      const p = Players.get(playerId);
      return !!p && GameInfo.Leaders.lookup(p.leaderType)?.LeaderType === OBSERVER_LEADER;
    } catch (e) { return false; }
  };

  const terrainType = (x, y) => { try { return GameInfo.Terrains.lookup(GameplayMap.getTerrainType(x, y))?.TerrainType ?? ''; } catch (e) { return ''; } };
  const featureType = (x, y) => { try { return GameInfo.Features.lookup(GameplayMap.getFeatureType(x, y))?.FeatureType ?? ''; } catch (e) { return ''; } };
  const isWater = (x, y) => { try { return GameplayMap.isWater(x, y); } catch (e) { return false; } };
  const isIce = (x, y) => featureType(x, y) === 'FEATURE_ICE';
  const isOpenWater = (p) => isWater(p.x, p.y) && !isIce(p.x, p.y);
  const isOpenCoast = (p) => isOpenWater(p) && terrainType(p.x, p.y) === 'TERRAIN_COAST';
  const isOpenOcean = (p) => isOpenWater(p) && terrainType(p.x, p.y) === 'TERRAIN_OCEAN';
  const bordersIce = (p) => {
    try {
      for (let dir = 0; dir < DirectionTypes.NUM_DIRECTION_TYPES; dir++) {
        const adj = GameplayMap.getAdjacentPlotLocation({ x: p.x, y: p.y }, dir);
        if (adj && adj.x >= 0 && isIce(adj.x, adj.y)) return true;
      }
    } catch (e) { /* treat as no ice */ }
    return false;
  };

  /** Every free plot, nearest the bottom-center of the map first (row 0 is the bottom). */
  const plotsFromBottomCenter = () => {
    const w = GameplayMap.getGridWidth(), h = GameplayMap.getGridHeight();
    const cx = Math.floor(w / 2);
    const plots = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const index = y * w + x;
      if (!usedPlots.has(index)) plots.push({ x, y, index, d: Math.abs(x - cx) + y });
    }
    return plots.sort((a, b) => a.d - b.d);
  };

  /** The observer's start plot (where the Eye goes) and an open-coast fallback for the Eye. */
  const observerPlots = (playerId) => {
    const plots = plotsFromBottomCenter();
    const start = plots.find((p) => isOpenOcean(p) && bordersIce(p)) || plots.find((p) => isOpenWater(p) && bordersIce(p)) || plots.find(isOpenWater);
    if (!start) { log(`player ${playerId}: no water; keeping the script's plot`); return null; }
    usedPlots.add(start.index);
    const fallback = plots.find((p) => isOpenCoast(p) && !usedPlots.has(p.index)) ?? start;
    log(`player ${playerId}: bottom-center -> (${start.x},${start.y}) ${terrainType(start.x, start.y)}`);
    return { start, fallback };
  };

  const onMap = (unitId) => { const loc = Units.get(unitId)?.location; return !!loc && loc.x >= 0 && loc.y >= 0; };

  /** Create the Observer's Eye on the start plot; if it lands off the map, move it there or to the fallback. */
  const createEye = (playerId, { start, fallback }) => {
    const type = GameInfo.Units.lookup(EYE_UNIT)?.$hash ?? Database.makeHash(EYE_UNIT);
    let result = Units.create(playerId, { Type: type, Location: { x: start.x, y: start.y }, Validate: true });
    if (!result?.Success) result = Units.create(playerId, { Type: type, Location: { x: start.x, y: start.y }, Validate: false });
    if (!result?.Success || !result.ID) { log(`player ${playerId}: eye could not be created`); return; }
    for (const plot of [start, fallback]) {
      if (onMap(result.ID)) break;
      Units.setLocation(result.ID, { x: plot.x, y: plot.y });
    }
    const loc = Units.get(result.ID)?.location;
    log(`player ${playerId}: eye at (${loc?.x},${loc?.y})`);
  };

  try {
    const base = StartPositioner.setStartPosition.bind(StartPositioner);
    StartPositioner.setStartPosition = (plotIndex, playerId) => {
      if (!isObserver(playerId)) return base(plotIndex, playerId);
      let plots = null;
      try { plots = observerPlots(playerId); }
      catch (e) { log(`observer start failed for ${playerId}: ${e}`); }
      const result = base(plots ? plots.start.index : plotIndex, playerId);
      try {
        const w = GameplayMap.getGridWidth();
        const script = { x: plotIndex % w, y: Math.floor(plotIndex / w) };
        createEye(playerId, plots ?? { start: script, fallback: script });
      } catch (e) { log(`eye creation failed for ${playerId}: ${e}`); }
      return result;
    };
    log('observer bottom-center starts installed');
  } catch (e) { log('could not wrap StartPositioner: ' + e); }
})();

class PlayerRegion {
  tiles = [];
  landmassId = 0;
  regionId = 0;
  toString() {
    return `[PlayerRegion] landmassId: ${this.landmassId}, regionId: ${this.regionId}, tile count: ${this.tiles.length}`;
  }
}
class PlayerRegionScores {
  scores = [];
  totalBias = 0;
  playerId = 0;
  playerIndex = 0;
  toString() {
    return `[PlayerRegionScores] playerId: ${this.playerId} (Index: ${this.playerIndex}), totalBias: ${this.totalBias}, scores: ${this.scores}`;
  }
}
function chooseStartSectors(iNumPlayersLandmass1, iNumPlayersLandmass2, iRows, iCols, bHumanNearEquator) {
  const returnValue = [];
  const iSectorsPerContinent = iRows * iCols;
  let iPlayersWestContinent = iNumPlayersLandmass1;
  let iPlayersEastContinent = iNumPlayersLandmass2;
  let iMaxNumMajors = 0;
  iMaxNumMajors = iPlayersWestContinent + iPlayersEastContinent;
  const aliveMajorIds = Players.getAliveMajorIds();
  const humanPlayers = [];
  for (let iMajorIndex = 0; iMajorIndex < iMaxNumMajors; iMajorIndex++) {
    if (iMajorIndex < aliveMajorIds.length && Players.isHuman(aliveMajorIds[iMajorIndex])) {
      humanPlayers.push(iMajorIndex);
    }
  }
  const numHumans = humanPlayers.length;
  const maxSide = Math.max(iPlayersWestContinent, iPlayersEastContinent);
  if (numHumans > maxSide) {
    const half = Math.floor(iMaxNumMajors / 2);
    iPlayersWestContinent = half;
    iPlayersEastContinent = iMaxNumMajors - half;
    iNumPlayersLandmass1 = iPlayersWestContinent;
    iNumPlayersLandmass2 = iPlayersEastContinent;
  }
  if (iNumPlayersLandmass1 == 1 && iNumPlayersLandmass2 == 3) {
    var validConfigs1 = [[0], [1], [2], [3], [4], [5]];
    var validConfigs2 = [
      [0, 3, 4],
      [1, 2, 5]
    ];
  } else if (iNumPlayersLandmass1 == 3 && iNumPlayersLandmass2 == 1) {
    var validConfigs1 = [
      [0, 3, 4],
      [1, 2, 5]
    ];
    var validConfigs2 = [[0], [1], [2], [3], [4], [5]];
  } else if (iNumPlayersLandmass1 == 4 && iNumPlayersLandmass2 == 0) {
    var validConfigs1 = [[0, 2, 3, 5]];
    var validConfigs2 = [[]];
  } else if (iNumPlayersLandmass1 == 4 && iNumPlayersLandmass2 == 2) {
    var validConfigs1 = [
      [0, 2, 6, 8],
      [1, 3, 5, 7]
    ];
    var validConfigs2 = [
      [0, 8],
      [2, 6]
    ];
  } else if (iNumPlayersLandmass1 == 2 && iNumPlayersLandmass2 == 4) {
    var validConfigs1 = [
      [0, 8],
      [2, 6]
    ];
    var validConfigs2 = [
      [0, 2, 6, 8],
      [1, 3, 5, 7]
    ];
  } else if (iNumPlayersLandmass1 == 6 && iNumPlayersLandmass2 == 0) {
    var validConfigs1 = [[0, 2, 3, 5, 6, 8]];
    var validConfigs2 = [[]];
  } else if (iNumPlayersLandmass1 == 5 && iNumPlayersLandmass2 == 3) {
    var validConfigs1 = [
      [0, 2, 6, 8, 10],
      [1, 3, 5, 9, 11]
    ];
    var validConfigs2 = [
      [3, 5, 7],
      [4, 6, 8]
    ];
  } else if (iNumPlayersLandmass1 == 3 && iNumPlayersLandmass2 == 5) {
    var validConfigs1 = [
      [3, 5, 7],
      [4, 6, 8]
    ];
    var validConfigs2 = [
      [0, 2, 6, 8, 10],
      [1, 3, 5, 9, 11]
    ];
  } else if (iNumPlayersLandmass1 == 6 && iNumPlayersLandmass2 == 4) {
    var validConfigs1 = [
      [0, 2, 4, 6, 8, 10],
      [1, 3, 5, 7, 9, 11]
    ];
    var validConfigs2 = [
      [1, 3, 5, 7],
      [4, 6, 8, 10]
    ];
  } else if (iNumPlayersLandmass1 == 4 && iNumPlayersLandmass2 == 6) {
    var validConfigs1 = [
      [1, 3, 5, 7],
      [4, 6, 8, 10]
    ];
    var validConfigs2 = [
      [0, 2, 4, 6, 8, 10],
      [1, 3, 5, 7, 9, 11]
    ];
  } else if (iNumPlayersLandmass1 == 2 && iNumPlayersLandmass2 == 2) {
    var validConfigs1 = [
      [0, 5],
      [1, 4]
    ];
    var validConfigs2 = [
      [0, 5],
      [1, 4]
    ];
  } else if (iNumPlayersLandmass1 == 3 && iNumPlayersLandmass2 == 3) {
    var validConfigs1 = [
      [0, 2, 7],
      [1, 6, 8]
    ];
    var validConfigs2 = [
      [0, 2, 7],
      [1, 6, 8]
    ];
  } else if (iNumPlayersLandmass1 == 4 && iNumPlayersLandmass2 == 4) {
    var validConfigs1 = [
      [0, 2, 6, 8],
      [3, 5, 9, 11]
    ];
    var validConfigs2 = [
      [0, 2, 6, 8],
      [3, 5, 9, 11]
    ];
  } else if (iNumPlayersLandmass1 == 5 && iNumPlayersLandmass2 == 5) {
    var validConfigs1 = [
      [0, 2, 6, 8, 10],
      [1, 3, 5, 9, 11]
    ];
    var validConfigs2 = [
      [0, 2, 6, 8, 10],
      [1, 3, 5, 9, 11]
    ];
  } else if (iNumPlayersLandmass1 == 6 && iNumPlayersLandmass2 == 6) {
    var validConfigs1 = [
      [0, 2, 4, 6, 8, 10],
      [1, 3, 5, 7, 9, 11]
    ];
    var validConfigs2 = [
      [0, 2, 4, 6, 8, 10],
      [1, 3, 5, 7, 9, 11]
    ];
  } else if (iNumPlayersLandmass1 == 8 && iNumPlayersLandmass2 == 0) {
    var validConfigs1 = [[0, 2, 3, 5, 6, 8, 9, 11]];
    var validConfigs2 = [[]];
  } else if (iNumPlayersLandmass1 == 5 && iNumPlayersLandmass2 == 0) {
    var validConfigs1 = [[0, 2, 3, 5, 6]];
    var validConfigs2 = [[]];
  } else {
    console.log("THIS SHOULD NOT BE HIT IN STARTING POSITION");
    var validConfigs1 = [[0], [1], [2], [3], [4], [5]];
    var validConfigs2 = [
      [0, 2, 4],
      [1, 3, 5]
    ];
  }
  let iWestContinentConfig = validConfigs1.length - 1;
  if (!bHumanNearEquator)
    iWestContinentConfig = TerrainBuilder.getRandomNumber(validConfigs1.length, "West Continent Start Positions");
  for (let i = 0; i < iSectorsPerContinent; i++) {
    let bFoundIt = false;
    for (let j = 0; j < iPlayersWestContinent; j++) {
      if (i == validConfigs1[iWestContinentConfig][j]) {
        bFoundIt = true;
        break;
      }
    }
    returnValue[i] = bFoundIt;
  }
  let iEastContinentConfig = validConfigs2.length - 1;
  if (!bHumanNearEquator)
    iEastContinentConfig = TerrainBuilder.getRandomNumber(validConfigs2.length, "East Continent Start Positions");
  for (let i = 0; i < iSectorsPerContinent; i++) {
    let bFoundIt = false;
    for (let j = 0; j < iPlayersEastContinent; j++) {
      if (i == validConfigs2[iEastContinentConfig][j]) {
        bFoundIt = true;
        break;
      }
    }
    returnValue[i + iSectorsPerContinent] = bFoundIt;
  }
  return returnValue;
}
function assignStartPositions(iNumWest, iNumEast, west, east, iStartSectorRows, iStartSectorCols, sectors) {
  console.log("Assigning Starting Positions");
  const startPositions = [];
  console.log("iStartSectorRows: " + iStartSectorRows);
  console.log("iStartSectorCols: " + iStartSectorCols);
  console.log("iNumWest: " + iNumWest);
  console.log("iNumEast: " + iNumEast);
  let iMaxNumMajors = 0;
  iMaxNumMajors = iNumWest + iNumEast;
  console.log("iMaxNumMajors: " + iMaxNumMajors);
  let bEastBias = false;
  if (iNumEast > iNumWest) {
    console.log("EastSide");
    bEastBias = true;
  }
  const aliveMajorIds = Players.getAliveMajorIds();
  if (iMaxNumMajors < aliveMajorIds.length) {
    console.log("The input total is less than the total alive majors: " + aliveMajorIds.length);
  }
  const humanPlayers = [];
  for (let iMajorIndex = 0; iMajorIndex < iMaxNumMajors; iMajorIndex++) {
    if (iMajorIndex < aliveMajorIds.length && Players.isHuman(aliveMajorIds[iMajorIndex])) {
      humanPlayers.push(iMajorIndex);
    }
  }
  let iNumberHomelands = 0;
  let bHumansLargestLandmass = GameInfo.Ages.lookup(Game.age).HumanPlayersPrimaryHemisphere;
  if (bEastBias && iNumEast < humanPlayers.length) {
    bHumansLargestLandmass = false;
  } else if (!bEastBias && iNumWest < humanPlayers.length) {
    bHumansLargestLandmass = false;
  }
  if (bHumansLargestLandmass) {
    if (bEastBias) {
      iNumberHomelands = iNumEast;
    } else {
      iNumberHomelands = iNumWest;
    }
  } else {
    iNumberHomelands = (iNumWest + iNumEast) / 2;
  }
  const [iHomeLandmassRegionId, iDistantLandmassRegionId] = bEastBias ? [LandmassRegion.LANDMASS_REGION_EAST, LandmassRegion.LANDMASS_REGION_WEST] : [LandmassRegion.LANDMASS_REGION_WEST, LandmassRegion.LANDMASS_REGION_EAST];
  const homelandStartRegions = [];
  const distantStartRegions = [];
  let bAssignStartPositionsBySector = true;
  if (iStartSectorRows == 0 || iStartSectorCols == 0) {
    bAssignStartPositionsBySector = false;
  } else {
    bAssignStartPositionsBySector = checkStartSectorsViable(
      west,
      east,
      iStartSectorRows,
      iStartSectorCols,
      sectors
    );
  }
  if (bAssignStartPositionsBySector) {
    console.log("Using Sector-based Assignments");
    for (let iSector = 0; iSector < sectors.length; iSector++) {
      if (sectors[iSector] == true) {
        const region = getSectorRegion(
          iSector,
          iStartSectorRows,
          iStartSectorCols,
          east.south,
          east.north,
          west.west,
          west.east,
          east.west
        );
        const bEastHemis = iSector >= sectors.length / 2;
        let szHeading;
        if (bEastHemis == bEastBias) {
          homelandStartRegions.push(region);
          szHeading = "HOMELAND START REGION:";
        } else {
          distantStartRegions.push(region);
          szHeading = "DISTANT START REGION:";
        }
        console.log(szHeading);
        console.log("West: " + region.west);
        console.log("East: " + region.east);
        console.log("North: " + region.north);
        console.log("South: " + region.south);
        console.log("Start Sector: " + iSector);
      }
    }
  } else {
    console.log("Using Areas of Equal Fertility");
    const iMinMajorFertility = 25;
    const iMinMinorFertility = 5;
    {
      const iLeftCol = bEastBias ? east.west : west.west;
      const iRightCol = bEastBias ? east.east : west.east;
      StartPositioner.initializeValues();
      StartPositioner.divideMapIntoMajorRegions(
        iNumberHomelands,
        iMinMajorFertility,
        iMinMinorFertility,
        iLeftCol,
        iRightCol,
        PlotTags.PLOT_TAG_NONE,
        iHomeLandmassRegionId
      );
      console.log("Divided map into major regions for Homelands");
      for (let iRegion = 0; iRegion < iNumberHomelands; iRegion++) {
        homelandStartRegions[iRegion] = StartPositioner.getMajorStartRegion(iRegion);
        console.log("HOMELAND START REGION: " + iRegion);
        console.log("West: " + homelandStartRegions[iRegion].west);
        console.log("East: " + homelandStartRegions[iRegion].east);
        console.log("North: " + homelandStartRegions[iRegion].north);
        console.log("South: " + homelandStartRegions[iRegion].south);
        console.log("Continent: " + homelandStartRegions[iRegion].continent);
      }
    }
    {
      const iLeftCol = bEastBias ? west.west : east.west;
      const iRightCol = bEastBias ? west.east : east.east;
      StartPositioner.initializeValues();
      StartPositioner.divideMapIntoMajorRegions(
        iMaxNumMajors - iNumberHomelands,
        iMinMajorFertility,
        iMinMinorFertility,
        iLeftCol,
        iRightCol,
        PlotTags.PLOT_TAG_NONE,
        iDistantLandmassRegionId
      );
      console.log("Divided map into major regions for Distant Lands");
      for (let iRegion = 0; iRegion < iMaxNumMajors - iNumberHomelands; iRegion++) {
        distantStartRegions[iRegion] = StartPositioner.getMajorStartRegion(iRegion);
        console.log("DISTANT START REGION: " + iRegion);
        console.log("West: " + distantStartRegions[iRegion].west);
        console.log("East: " + distantStartRegions[iRegion].east);
        console.log("North: " + distantStartRegions[iRegion].north);
        console.log("South: " + distantStartRegions[iRegion].south);
        console.log("Continent: " + distantStartRegions[iRegion].continent);
      }
    }
  }
  const homelandPlayers = [];
  const distantPlayers = [];
  if (bHumansLargestLandmass) {
    for (let iMajorIndex = 0; iMajorIndex < iMaxNumMajors; iMajorIndex++) {
      if (iMajorIndex < aliveMajorIds.length && Players.isHuman(aliveMajorIds[iMajorIndex])) {
        homelandPlayers.push(iMajorIndex);
      }
    }
    for (let iMajorIndex = 0; iMajorIndex < iMaxNumMajors; iMajorIndex++) {
      if (iMajorIndex < aliveMajorIds.length && Players.isAI(aliveMajorIds[iMajorIndex])) {
        if (homelandPlayers.length < iNumberHomelands) {
          homelandPlayers.push(iMajorIndex);
        } else {
          distantPlayers.push(iMajorIndex);
        }
      }
    }
    shuffle(homelandPlayers);
    shuffle(distantPlayers);
  } else {
    const tempPlayers = [];
    for (let iMajorIndex = 0; iMajorIndex < iMaxNumMajors; iMajorIndex++) {
      if (iMajorIndex < aliveMajorIds.length) {
        console.log("Found real major at: " + aliveMajorIds[iMajorIndex]);
        tempPlayers.push(iMajorIndex);
      }
    }
    shuffle(tempPlayers);
    for (let i = 0; i < tempPlayers.length; i++) {
      if (homelandPlayers.length < iNumberHomelands) {
        homelandPlayers.push(tempPlayers[i]);
      } else {
        distantPlayers.push(tempPlayers[i]);
      }
    }
  }
  console.log("homelandPlayers: " + homelandPlayers.length);
  console.log("homelandStartRegions: " + homelandStartRegions.length);
  console.log("distantPlayers: " + distantPlayers.length);
  console.log("distantStartRegions: " + distantStartRegions.length);
  console.log("Update homelandPlayers:");
  updateRegionsForStartBias(homelandPlayers, homelandStartRegions);
  console.log("Update distantPlayers:");
  updateRegionsForStartBias(distantPlayers, distantStartRegions);
  for (let i = 0; i < homelandPlayers.length; i++) {
    const iStartPosition = homelandPlayers[i];
    const playerId = aliveMajorIds[iStartPosition];
    const plotIndex = pickStartPlot(
      homelandStartRegions[i],
      i,
      playerId,
      false,
      startPositions,
      void 0,
      iHomeLandmassRegionId
    );
    if (plotIndex >= 0) {
      startPositions[iStartPosition] = plotIndex;
      const location = GameplayMap.getLocationFromIndex(plotIndex);
      console.log("CHOICE FOR PLAYER: " + playerId + " (" + location.x + ", " + location.y + ")");
      StartPositioner.setStartPosition(plotIndex, playerId);
    } else {
      console.log("FAILED TO PICK LOCATION FOR: " + playerId);
    }
  }
  for (let i = 0; i < distantPlayers.length; i++) {
    const iStartPosition = distantPlayers[i];
    const playerId = aliveMajorIds[iStartPosition];
    const plotIndex = pickStartPlot(
      distantStartRegions[i],
      i + homelandPlayers.length,
      playerId,
      false,
      startPositions,
      void 0,
      iDistantLandmassRegionId
    );
    if (plotIndex >= 0) {
      startPositions[iStartPosition] = plotIndex;
      const location = GameplayMap.getLocationFromIndex(plotIndex);
      console.log("CHOICE FOR PLAYER: " + playerId + " (" + location.x + ", " + location.y + ")");
      StartPositioner.setStartPosition(plotIndex, playerId);
    } else {
      console.log("FAILED TO PICK LOCATION FOR: " + playerId);
    }
  }
  return startPositions;
}
function assignStartPositionsFromHexMap(hexMap, humanLandmassId) {
  const perfScope = new profileScope("Building PlayerRegions from hex map");
  const playerRegions = [];
  for (const row of hexMap.getTiles()) {
    for (const tile of row) {
      if (tile.majorPlayerRegionId >= 0) {
        const playerRegion = playerRegions[tile.majorPlayerRegionId] ??= new PlayerRegion();
        playerRegion.regionId = tile.majorPlayerRegionId;
        playerRegion.landmassId = tile.playerLandmassId - 1;
        playerRegion.tiles.push(tile.coord);
      }
    }
  }
  console.log(
    `Creating player regions.. initializing indices: ${playerRegions.map((pr) => [pr.regionId, pr.landmassId])}`
  );
  perfScope.end();
  return assignStartPositionsFromTiles(playerRegions, humanLandmassId);
}
function assignStartPositionsFromTiles(playerRegions, humanLandmassId) {
  const scope = new profileScope("Assigning Starting Positions");
  if (playerRegions.length === 0) {
    console.error("empty array passed to assignStartPositionsFromTiles()");
    return [];
  }
  const landmassRegions = /* @__PURE__ */ new Map();
  for (const region of playerRegions) {
    let regions = landmassRegions.get(region.landmassId) ?? [];
    regions.push(region.regionId);
    landmassRegions.set(region.landmassId, regions);
  }
  let largestLandmassId = -1;
  let largestTileCount = 0;
  for (const [id, lr] of landmassRegions) {
    const lrTileCount = lr.reduce((sum, regionId) => sum + playerRegions[regionId].tiles.length, 0);
    if (lrTileCount > largestTileCount) {
      largestTileCount = lrTileCount;
      largestLandmassId = id;
    }
  }
  const totalPlayers = playerRegions.length;
  console.log(
    `Largest landmass is region ${largestLandmassId} with ${landmassRegions.get(largestLandmassId).length} players and ${largestTileCount} total tiles.`
  );
  console.log(`Total players: ${totalPlayers}`);
  const aliveMajorIds = Players.getAliveMajorIds();
  let aliveMajorIndices = [...aliveMajorIds.keys()];
  if (totalPlayers !== aliveMajorIds.length) {
    console.log(`The input player total ${totalPlayers} is not equal to the alive majors: ${aliveMajorIds.length}`);
  }
  class RegionBounds {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
  }
  const regionBounds = new Array(playerRegions.length);
  for (let i = 0; i < playerRegions.length; i++) {
    const bounds = new RegionBounds();
    for (const tile of playerRegions[i].tiles) {
      bounds.minX = Math.min(bounds.minX, tile.x);
      bounds.maxX = Math.max(bounds.maxX, tile.x);
      bounds.minY = Math.min(bounds.minY, tile.y);
      bounds.maxY = Math.max(bounds.maxY, tile.y);
    }
    regionBounds[i] = bounds;
  }
  const regionGetter = {
    count: playerRegions.length,
    getTileCoords: function* (regionId) {
      for (const tile of playerRegions[regionId].tiles) {
        yield [tile.x, tile.y];
      }
    }
  };
  const playerRegionScores = getRegionScoresPerPlayer(aliveMajorIndices, regionGetter);
  console.log("Player region scores:");
  playerRegionScores.forEach((prs) => console.log(prs));
  const humanPlayerIndices = aliveMajorIndices.filter((index) => Players.isHuman(aliveMajorIds[index]));
  const primaryLandmassId = humanLandmassId ?? largestLandmassId;
  let bHumansOnSpecificLandmass = humanPlayerIndices.length > 1 && GameInfo.Ages.lookup(Game.age).HumanPlayersPrimaryHemisphere && humanPlayerIndices.length <= landmassRegions.get(primaryLandmassId).length;
  if (humanLandmassId !== void 0 && humanPlayerIndices.length > 0) {
    bHumansOnSpecificLandmass = true;
  }
  let regionPlayerBias = new Array(playerRegions.length).fill(-1);
  const assignPlayerBiases = (playerIndices, regions) => {
    for (const playerIndex of playerIndices) {
      let bestId = -1;
      let bestScore = -1;
      for (const regionId of regions) {
        const regionScore = playerRegionScores[playerIndex].scores[regionId];
        if (regionScore > bestScore && regionPlayerBias[regionId] == -1) {
          bestId = regionId;
          bestScore = regionScore;
        }
      }
      regionPlayerBias[bestId] = playerIndex;
    }
  };
  if (bHumansOnSpecificLandmass) {
    console.log(`Placing humans on landmass ${primaryLandmassId}`);
    aliveMajorIndices = aliveMajorIndices.filter((index) => !Players.isHuman(aliveMajorIds[index]));
    const regionsOnPrimaryLandmass = landmassRegions.get(primaryLandmassId);
    humanPlayerIndices.sort((a, b) => playerRegionScores[b].totalBias - playerRegionScores[a].totalBias);
    assignPlayerBiases(humanPlayerIndices, regionsOnPrimaryLandmass);
  }
  aliveMajorIndices.sort((a, b) => playerRegionScores[b].totalBias - playerRegionScores[a].totalBias);
  console.log(`Sorted indices: ${aliveMajorIndices}`);
  assignPlayerBiases(
    aliveMajorIndices,
    playerRegions.map((v) => v.regionId)
  );
  console.log(`Player region biases:`);
  for (const [regionId, playerIndex] of regionPlayerBias.entries()) {
    const bestScore = playerRegionScores[playerIndex].scores.reduce((best, cur) => Math.max(best, cur), -1);
    const playerId = playerRegionScores[playerIndex].playerId;
    console.log(
      `  Player Id ${playerId} assigned to region ${regionId}: (${regionBounds[regionId].minX}, ${regionBounds[regionId].minY}) - (${regionBounds[regionId].maxX}, ${regionBounds[regionId].maxY}) with score ${playerRegionScores[playerIndex].scores[regionId]} (best score possible is ${bestScore})`
    );
  }
  let found = 0;
  let startPositions = new Array(regionPlayerBias.length);
  for (const [regionId, playerIndex] of regionPlayerBias.entries()) {
    const playerId = aliveMajorIds[playerIndex];
    const playerTiles = playerRegions[regionId].tiles;
    console.log(
      `Searching ${playerTiles.length} tiles in region ${regionId} (landmass ${playerRegions[regionId].landmassId}) for player ${playerId} (${Players.isHuman(playerId) ? "human" : "ai"})`
    );
    const plotIndex = pickStartPlotByTile(playerTiles, -1, found, playerId, false, startPositions);
    ++found;
    if (plotIndex >= 0) {
      startPositions[playerId] = plotIndex;
      const location = GameplayMap.getLocationFromIndex(plotIndex);
      console.log("CHOICE FOR PLAYER: " + playerId + " (" + location.x + ", " + location.y + ")");
      StartPositioner.setStartPosition(plotIndex, playerId);
    } else {
      console.log("FAILED TO PICK LOCATION FOR: " + playerId);
    }
  }
  scope.end();
  return startPositions;
}
function assignSingleContinentStartPositions(iNumPlayers, primaryLandmass, iStartSectorRows, iStartSectorCols, sectors) {
  console.log("Assigning Starting Positions");
  const startPositions = [];
  console.log("iStartSectorRows: " + iStartSectorRows);
  console.log("iStartSectorCols: " + iStartSectorCols);
  let iMaxNumMajors = 0;
  iMaxNumMajors = iNumPlayers;
  console.log("iMaxNumMajors: " + iMaxNumMajors);
  const aliveMajorIds = Players.getAliveMajorIds();
  if (iMaxNumMajors < aliveMajorIds.length) {
    console.log("The input total is less than the total alive majors: " + aliveMajorIds.length);
  }
  const homelandPlayers = [];
  const homelandStartRegions = [];
  let bAssignStartPositionsBySector = true;
  if (iStartSectorRows == 0 || iStartSectorCols == 0) {
    bAssignStartPositionsBySector = false;
  } else {
    bAssignStartPositionsBySector = checkStartSectorsViable(
      primaryLandmass,
      primaryLandmass,
      iStartSectorRows,
      iStartSectorCols,
      sectors
    );
  }
  if (bAssignStartPositionsBySector) {
    console.log("Using Sector-based Assignments");
    for (let iSector = 0; iSector < sectors.length; iSector++) {
      if (sectors[iSector] == true) {
        const region = getSectorRegion(
          iSector,
          iStartSectorRows,
          iStartSectorCols,
          primaryLandmass.south,
          primaryLandmass.north,
          primaryLandmass.west,
          primaryLandmass.east,
          primaryLandmass.west
        );
        let szHeading;
        homelandStartRegions.push(region);
        szHeading = "HOMELAND START REGION:";
        console.log(szHeading);
        console.log("West: " + region.west);
        console.log("East: " + region.east);
        console.log("North: " + region.north);
        console.log("South: " + region.south);
        console.log("Start Sector: " + iSector);
      }
    }
  } else {
    console.log("Assigning Starting Positions Across a Single Continent with Equal Fertility");
    const iMinMajorFertility = 25;
    const iMinMinorFertility = 5;
    StartPositioner.initializeValues();
    StartPositioner.divideMapIntoMajorRegions(
      iNumPlayers,
      iMinMajorFertility,
      iMinMinorFertility,
      primaryLandmass.west,
      primaryLandmass.east,
      PlotTags.PLOT_TAG_NONE,
      LandmassRegion.LANDMASS_REGION_ANY
    );
    const potentialRegions = [];
    for (let i = 0; i < iNumPlayers; i++) {
      const region = StartPositioner.getMajorStartRegion(i);
      if (region && region.east > primaryLandmass.west && region.west < primaryLandmass.east) {
        potentialRegions.push(region);
      }
    }
    potentialRegions.sort(
      (a, b) => (b.east - b.west) * (b.north - b.south) - (a.east - a.west) * (a.north - a.south)
    );
    for (const region of potentialRegions) {
      if (homelandStartRegions.length < iNumPlayers) {
        homelandStartRegions.push(region);
      }
    }
    if (homelandStartRegions.length < iNumPlayers) {
      console.log("WARNING: Not enough fertile regions found within the selected continent.");
    }
  }
  for (let iMajorIndex = 0; iMajorIndex < iMaxNumMajors; iMajorIndex++) {
    if (iMajorIndex < aliveMajorIds.length) {
      homelandPlayers.push(iMajorIndex);
    }
  }
  shuffle(homelandPlayers);
  console.log("homelandPlayers: " + homelandPlayers.length);
  console.log("homelandStartRegions: " + homelandStartRegions.length);
  console.log("Update homelandPlayers:");
  updateRegionsForStartBias(homelandPlayers, homelandStartRegions);
  for (let i = 0; i < homelandPlayers.length; i++) {
    const iStartPosition = homelandPlayers[i];
    const playerId = aliveMajorIds[iStartPosition];
    let plotIndex = pickStartPlot(homelandStartRegions[i], i, playerId, false, startPositions);
    if (plotIndex >= 0) {
      startPositions[iStartPosition] = plotIndex;
      const location = GameplayMap.getLocationFromIndex(plotIndex);
      console.log("CHOICE FOR PLAYER: " + playerId + " (" + location.x + ", " + location.y + ")");
      StartPositioner.setStartPosition(plotIndex, playerId);
    } else {
      console.log("FAILED TO PICK LOCATION FOR: " + playerId + " - Retrying with alternative regions.");
      for (const retryRegion of homelandStartRegions) {
        plotIndex = pickStartPlot(retryRegion, i, playerId, false, startPositions);
        if (plotIndex >= 0) {
          startPositions[iStartPosition] = plotIndex;
          StartPositioner.setStartPosition(plotIndex, playerId);
          console.log("Successfully found an alternative start position for " + playerId);
          break;
        }
      }
      if (plotIndex < 0) {
        console.log("FAILED AGAIN - NO VALID LOCATION FOUND FOR: " + playerId);
      }
    }
  }
  return startPositions;
}
function checkStartSectorsViable(west, east, iStartSectorRows, iStartSectorCols, sectors) {
  const tempStartPositions = [];
  for (let iSector = 0; iSector < sectors.length; iSector++) {
    if (sectors[iSector] == true) {
      const region = getSectorRegion(
        iSector,
        iStartSectorRows,
        iStartSectorCols,
        east.south,
        east.north,
        west.west,
        west.east,
        east.west
      );
      const startPlot = pickStartPlot(region, 0, 0, true, tempStartPositions);
      if (startPlot == -1) {
        console.log("LOW FERTILITY START SECTOR: " + iSector);
        console.log("West: " + region.west);
        console.log("East: " + region.east);
        console.log("North: " + region.north);
        console.log("South: " + region.south);
        console.log("ABORTING - Falling back to Civ VI start position assignment algorithm");
        return false;
      }
    }
  }
  return true;
}
function getRegionScoresPerPlayer(majorGroup, startRegions) {
  const biomeBiases = Array.from(
    { length: majorGroup.length },
    () => new Array(GameInfo.Biomes.length).fill(0)
  );
  const navRiverBias = new Array(majorGroup.length).fill(0);
  const NWBias = new Array(majorGroup.length).fill(0);
  const IslandBias = new Array(majorGroup.length).fill(0);
  const aliveMajorIds = Players.getAliveMajorIds();
  const updateBiasForPlayer = (iMajorGroup, startBiasDef, updateCb, defFilter) => {
    const playerId = aliveMajorIds[majorGroup[iMajorGroup]];
    const player = Players.get(playerId);
    if (player == null) {
      return;
    }
    const uiCivType = player.civilizationType;
    const uiLeaderType = player.leaderType;
    for (let startIdx = 0; startIdx < startBiasDef.length; startIdx++) {
      const startDef = startBiasDef[startIdx];
      if (startDef && (defFilter == null || defFilter(startDef))) {
        const civString = startDef.CivilizationType;
        const ldrString = startDef.LeaderType;
        let civHash = 0;
        let ldrHash = 0;
        if (civString != null) {
          const civObj = GameInfo.Civilizations.lookup(civString);
          if (civObj) {
            civHash = civObj.$hash;
          }
        }
        if (ldrString != null) {
          const ldrObj = GameInfo.Leaders.lookup(ldrString);
          if (ldrObj) {
            ldrHash = ldrObj.$hash;
          }
        }
        if (civHash == uiCivType || ldrHash == uiLeaderType) {
          updateCb(iMajorGroup, startDef);
        }
      }
    }
  };
  for (let iMajorGroup = 0; iMajorGroup < majorGroup.length; iMajorGroup++) {
    const playerId = aliveMajorIds[majorGroup[iMajorGroup]];
    const player = Players.get(playerId);
    if (player == null) {
      continue;
    }
    console.log(
      "Resolving start biases for player Id:" + playerId + ", " + player.civilizationName + ", " + player.leaderName
    );
    updateBiasForPlayer(iMajorGroup, GameInfo.StartBiasBiomes, (iMajorGroup2, startDef) => {
      const biomeDef = GameInfo.Biomes.lookup(startDef.BiomeType);
      if (biomeDef) {
        const biomeIndex = biomeDef.$index;
        console.log("biomeIndex: " + biomeIndex + ", Score: " + startDef.Score);
        biomeBiases[iMajorGroup2][biomeIndex] += startDef.Score;
      }
    });
    updateBiasForPlayer(
      iMajorGroup,
      GameInfo.StartBiasTerrains,
      (iMajorGroup2, startDef) => {
        navRiverBias[iMajorGroup2] += startDef.Score;
      },
      (startDef) => startDef.TerrainType === "TERRAIN_NAVIGABLE_RIVER"
    );
    updateBiasForPlayer(iMajorGroup, GameInfo.StartBiasNaturalWonders, (iMajorGroup2, startDef) => {
      NWBias[iMajorGroup2] += startDef.Score;
    });
    updateBiasForPlayer(iMajorGroup, GameInfo.StartBiasIslands, (iMajorGroup2, startDef) => {
      IslandBias[iMajorGroup2] += startDef.Score;
    });
  }
  console.log("biomeBiases " + biomeBiases);
  console.log("navRiverBias " + navRiverBias);
  console.log("NWBias " + NWBias);
  console.log("IslandBias " + IslandBias);
  const startRegionCount = Array.isArray(startRegions) ? startRegions.length : startRegions.count;
  const biomeCounts = new Array(startRegionCount);
  for (let i = 0; i < startRegionCount; i++) {
    biomeCounts[i] = [];
  }
  const navRiverCounts = [];
  const NWCounts = [];
  const IslandCounts = [];
  for (let iRegion = 0; iRegion < startRegionCount; iRegion++) {
    for (let iBiome = 0; iBiome < GameInfo.Biomes.length; iBiome++) {
      biomeCounts[iRegion][iBiome] = 0;
    }
    navRiverCounts[iRegion] = 0;
    NWCounts[iRegion] = 0;
    IslandCounts[iRegion] = 0;
  }
  for (let iRegion = 0; iRegion < startRegionCount; iRegion++) {
    let tileCount = 0;
    const processTile = (xCoord, yCoord) => {
      const biomeType = GameplayMap.getBiomeType(xCoord, yCoord);
      biomeCounts[iRegion][biomeType]++;
      if (GameplayMap.isNavigableRiver(xCoord, yCoord)) {
        navRiverCounts[iRegion]++;
      }
      if (GameplayMap.isNaturalWonder(xCoord, yCoord)) {
        NWCounts[iRegion]++;
      }
      if (GameplayMap.isIsland(xCoord, yCoord)) {
        IslandCounts[iRegion]++;
      }
      ++tileCount;
    };
    if (Array.isArray(startRegions)) {
      const region = startRegions[iRegion];
      for (let iX = region.west; iX <= region.east; iX++) {
        for (let iY = region.south; iY <= region.north; iY++) {
          processTile(iX, iY);
        }
      }
    } else {
      for (const [iX, iY] of startRegions.getTileCoords(iRegion)) {
        processTile(iX, iY);
      }
    }
    console.log(`Processed ${tileCount} tiles in region ${iRegion}`);
  }
  console.log("biomeCounts " + biomeCounts);
  console.log("navRiverCounts " + navRiverCounts);
  console.log("NWCounts " + NWCounts);
  console.log("IslandCounts " + IslandCounts);
  let regionScores = [];
  for (let iMajorGroup = 0; iMajorGroup < majorGroup.length; iMajorGroup++) {
    const regionScore = new PlayerRegionScores();
    regionScore.playerIndex = majorGroup[iMajorGroup];
    regionScore.playerId = aliveMajorIds[majorGroup[iMajorGroup]];
    for (let iBiome = 0; iBiome < GameInfo.Biomes.length; iBiome++) {
      regionScore.totalBias += biomeBiases[iMajorGroup][iBiome];
    }
    regionScore.totalBias += navRiverBias[iMajorGroup];
    regionScore.totalBias += NWBias[iMajorGroup];
    regionScore.totalBias += IslandBias[iMajorGroup];
    regionScores.push(regionScore);
  }
  for (let iMajorGroup = 0; iMajorGroup < majorGroup.length; iMajorGroup++) {
    const regionScore = regionScores[iMajorGroup];
    for (let iRegion = 0; iRegion < startRegionCount; iRegion++) {
      let regionScoreForMajor = 0;
      for (let iBiome = 0; iBiome < GameInfo.Biomes.length; iBiome++) {
        regionScoreForMajor += biomeBiases[iMajorGroup][iBiome] * biomeCounts[iRegion][iBiome];
      }
      regionScoreForMajor += navRiverBias[iMajorGroup] * navRiverCounts[iRegion];
      regionScoreForMajor += NWBias[iMajorGroup] * NWCounts[iRegion];
      regionScoreForMajor += IslandBias[iMajorGroup] * IslandCounts[iRegion];
      console.log(`majorIndex ${iMajorGroup}, regionScore: ${regionScoreForMajor}`);
      regionScore.scores.push(regionScoreForMajor);
    }
  }
  return regionScores;
}
function updateRegionsForStartBias(majorGroup, startRegions) {
  const regionScores = getRegionScoresPerPlayer(majorGroup, startRegions);
  console.log(`totalMajorBiases: ${regionScores.map((v) => v.totalBias)}`);
  regionScores.sort((a, b) => b.totalBias - a.totalBias);
  console.log(`sortedMajorIndices: ${regionScores.map((v) => v.playerId)}`);
  majorGroup.fill(-1);
  for (const playerRegionScores of regionScores) {
    let iBestScore = -1;
    let iBestRegion = -1;
    for (let iRegion = 0; iRegion < playerRegionScores.scores.length; iRegion++) {
      if (majorGroup[iRegion] == -1) {
        const regionScoreForPlayer = playerRegionScores.scores[iRegion];
        if (regionScoreForPlayer > iBestScore) {
          iBestScore = regionScoreForPlayer;
          iBestRegion = iRegion;
        }
      }
    }
    if (iBestRegion >= 0) {
      majorGroup[iBestRegion] = playerRegionScores.playerIndex;
      console.log(
        `Region ${iBestRegion} is best for major: ${playerRegionScores.playerId} (index: ${playerRegionScores.playerIndex})`
      );
    }
  }
  console.log("Majors (final form):" + majorGroup);
}
function pickStartPlotByTile(tiles, continentId, numFoundEarlier, playerId, ignoreBias, startPositions, plotTagFilter, landmassRegionIdFilter) {
  let chosenPlotIndex = -1;
  let highestScore = 0;
  let passedFilter = 0;
  let minArea = HasStartBiasForPlayer(playerId, GameInfo.StartBiasIslands) ? g_MinLandmassSizeForIslandBias : void 0;
  if (minArea) {
    console.log(`Player ${playerId} has island start bias, setting minArea to ${minArea}`);
  }
  for (const tile of tiles) {
    const satisfiesPlotTagFilter = !plotTagFilter || plotTagFilter == PlotTags.PLOT_TAG_NONE || GameplayMap.hasPlotTag(tile.x, tile.y, plotTagFilter);
    const satisfiesLandmassRegionIdFilter = satisfiesPlotTagFilter && !landmassRegionIdFilter || landmassRegionIdFilter === LandmassRegion.LANDMASS_REGION_ANY || GameplayMap.getLandmassRegionId(tile.x, tile.y) === landmassRegionIdFilter;
    if (satisfiesPlotTagFilter && satisfiesLandmassRegionIdFilter) {
      passedFilter++;
      let score = scorePlot(tile.x, tile.y, continentId, minArea);
      if (score > 0) {
        if (!ignoreBias) {
          score += adjustScoreByStartBias(tile.x, tile.y, playerId);
        }
        if (numFoundEarlier > 0) {
          score = adjustScoreByClosestStart(score, tile.x, tile.y, startPositions);
        }
        if (score > highestScore) {
          highestScore = score;
          chosenPlotIndex = tile.y * GameplayMap.getGridWidth() + tile.x;
        }
      }
    }
  }
  console.log(`pickStartPlotByTile: checked ${tiles.length} tiles, ${passedFilter} of which passed the filter.`);
  return chosenPlotIndex;
}
function pickStartPlot(region, numFoundEarlier, playerId, ignoreBias, startPositions, plotTagFilter, landmassRegionIdFilter) {
  const tiles = [];
  for (let iY = region.south; iY <= region.north; iY++) {
    for (let iX = region.west; iX <= region.east; iX++) {
      tiles.push({ x: iX, y: iY });
    }
  }
  return pickStartPlotByTile(
    tiles,
    region.continent,
    numFoundEarlier,
    playerId,
    ignoreBias,
    startPositions,
    plotTagFilter,
    landmassRegionIdFilter
  );
}
function scorePlot(iX, iY, iContinent, minArea) {
  let score = -1;
  if (!GameplayMap.isWater(iX, iY) && !GameplayMap.isMountain(iX, iY)) {
    if (iContinent == -1 || GameplayMap.getContinentType(iX, iY) == iContinent) {
      score = StartPositioner.getStartPositionScore(iX, iY, minArea);
    }
  }
  return score;
}
function adjustScoreByClosestStart(originalScore, iX, iY, startPositions) {
  let score = originalScore;
  if (g_DesiredBufferBetweenMajorStarts <= g_RequiredBufferBetweenMajorStarts) return score;
  const distance = getDistanceToClosestStart(iX, iY, startPositions);
  if (distance < g_RequiredBufferBetweenMajorStarts) {
    score = 0;
  } else if (distance < g_DesiredBufferBetweenMajorStarts) {
    score = score * (distance - g_RequiredBufferBetweenMajorStarts + 1) / (g_DesiredBufferBetweenMajorStarts - g_RequiredBufferBetweenMajorStarts + 1);
  }
  return score;
}
function getDistanceToClosestStart(iX, iY, startPositions) {
  let minDistance = 32768;
  for (let iStart = 0; iStart < startPositions.length; iStart++) {
    const startPlotIndex = startPositions[iStart];
    if (startPlotIndex) {
      const iStartX = startPlotIndex % GameplayMap.getGridWidth();
      const iStartY = startPlotIndex / GameplayMap.getGridWidth();
      const distance = GameplayMap.getPlotDistance(iX, iY, iStartX, iStartY);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
  }
  return minDistance;
}
function HasStartBiasForPlayer(playerId, startBiasDef) {
  const player = Players.get(playerId);
  if (player == null || player.isAlive == false) {
    return false;
  }
  const eCivType = player.civilizationType;
  const eLeaderType = player.leaderType;
  for (let idx = 0; idx < startBiasDef.length; idx++) {
    const startBiasCivilization = startBiasDef[idx]?.CivilizationType;
    const startBiasLeader = startBiasDef[idx]?.LeaderType;
    if (startBiasCivilization) {
      const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
      const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
      if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
        return true;
      }
    }
    if (startBiasLeader) {
      const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
      const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
      if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
        return true;
      }
    }
  }
  return false;
}
function adjustScoreByStartBias(iX, iY, playerId) {
  let score = 0;
  const player = Players.get(playerId);
  if (player == null || player.isAlive == false) {
    return score;
  }
  const eCivType = player.civilizationType;
  const eLeaderType = player.leaderType;
  for (let biomeIdx = 0; biomeIdx < GameInfo.StartBiasBiomes.length; biomeIdx++) {
    const startBiasCivilization = GameInfo.StartBiasBiomes[biomeIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasBiomes[biomeIdx]?.LeaderType;
    const startBiasBiome = GameInfo.StartBiasBiomes[biomeIdx]?.BiomeType;
    if (startBiasBiome) {
      if (startBiasCivilization) {
        const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
        const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
        if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
          score += getBiomeStartBiasScore(startBiasBiome, GameInfo.StartBiasBiomes[biomeIdx].Score, iX, iY);
        }
      }
      if (startBiasLeader) {
        const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
        const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
        if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
          score += getBiomeStartBiasScore(startBiasBiome, GameInfo.StartBiasBiomes[biomeIdx].Score, iX, iY);
        }
      }
    }
  }
  for (let terrainIdx = 0; terrainIdx < GameInfo.StartBiasTerrains.length; terrainIdx++) {
    const startBiasCivilization = GameInfo.StartBiasTerrains[terrainIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasTerrains[terrainIdx]?.LeaderType;
    const startBiasTerrain = GameInfo.StartBiasTerrains[terrainIdx]?.TerrainType;
    if (startBiasTerrain) {
      if (startBiasCivilization) {
        const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
        const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
        if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
          score += getTerrainStartBiasScore(
            startBiasTerrain,
            GameInfo.StartBiasTerrains[terrainIdx].Score,
            iX,
            iY
          );
        }
      }
      if (startBiasLeader) {
        const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
        const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
        if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
          score += getTerrainStartBiasScore(
            startBiasTerrain,
            GameInfo.StartBiasTerrains[terrainIdx].Score,
            iX,
            iY
          );
        }
      }
    }
  }
  for (let riverIdx = 0; riverIdx < GameInfo.StartBiasRivers.length; riverIdx++) {
    const startBiasCivilization = GameInfo.StartBiasRivers[riverIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasRivers[riverIdx]?.LeaderType;
    if (startBiasCivilization) {
      const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
      const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
      if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
        score += getRiverStartBiasScore(GameInfo.StartBiasRivers[riverIdx].Score, iX, iY);
      }
    }
    if (startBiasLeader) {
      const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
      const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
      if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
        score += getRiverStartBiasScore(GameInfo.StartBiasRivers[riverIdx].Score, iX, iY);
      }
    }
  }
  for (let coastIdx = 0; coastIdx < GameInfo.StartBiasAdjacentToCoasts.length; coastIdx++) {
    const startBiasCivilization = GameInfo.StartBiasAdjacentToCoasts[coastIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasAdjacentToCoasts[coastIdx]?.LeaderType;
    if (startBiasCivilization) {
      const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
      const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
      if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
        score += getCoastStartBiasScore(GameInfo.StartBiasAdjacentToCoasts[coastIdx].Score, iX, iY);
      }
    }
    if (startBiasLeader) {
      const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
      const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
      if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
        score += getCoastStartBiasScore(GameInfo.StartBiasAdjacentToCoasts[coastIdx].Score, iX, iY);
      }
    }
  }
  for (let featureIdx = 0; featureIdx < GameInfo.StartBiasFeatureClasses.length; featureIdx++) {
    const startBiasCivilization = GameInfo.StartBiasFeatureClasses[featureIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasFeatureClasses[featureIdx]?.LeaderType;
    const startBiasFeature = GameInfo.StartBiasFeatureClasses[featureIdx]?.FeatureClassType;
    if (startBiasFeature) {
      if (startBiasCivilization) {
        const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
        const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
        if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
          score += getFeatureClassStartBiasScore(
            startBiasFeature,
            GameInfo.StartBiasFeatureClasses[featureIdx].Score,
            iX,
            iY
          );
        }
      }
      if (startBiasLeader) {
        const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
        const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
        if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
          score += getFeatureClassStartBiasScore(
            startBiasFeature,
            GameInfo.StartBiasFeatureClasses[featureIdx].Score,
            iX,
            iY
          );
        }
      }
    }
  }
  for (let resourceIdx = 0; resourceIdx < GameInfo.StartBiasResources.length; resourceIdx++) {
    const startBiasCivilization = GameInfo.StartBiasResources[resourceIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasResources[resourceIdx]?.LeaderType;
    const startBiasResource = GameInfo.StartBiasResources[resourceIdx]?.ResourceType;
    if (startBiasResource) {
      if (startBiasCivilization) {
        const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
        const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
        if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
          score += getResourceStartBiasScore(
            startBiasResource,
            GameInfo.StartBiasResources[resourceIdx].Score,
            iX,
            iY
          );
        }
      }
      if (startBiasLeader) {
        const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
        const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
        if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
          score += getResourceStartBiasScore(
            startBiasResource,
            GameInfo.StartBiasResources[resourceIdx].Score,
            iX,
            iY
          );
        }
      }
    }
  }
  for (let lakeIdx = 0; lakeIdx < GameInfo.StartBiasLakes.length; lakeIdx++) {
    const startBiasCivilization = GameInfo.StartBiasLakes[lakeIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasLakes[lakeIdx]?.LeaderType;
    if (startBiasCivilization) {
      const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
      const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
      if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
        score += getLakeStartBiasScore(GameInfo.StartBiasLakes[lakeIdx].Score, iX, iY);
      }
    }
    if (startBiasLeader) {
      const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
      const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
      if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
        score += getLakeStartBiasScore(GameInfo.StartBiasLakes[lakeIdx].Score, iX, iY);
      }
    }
  }
  for (let nwIdx = 0; nwIdx < GameInfo.StartBiasNaturalWonders.length; nwIdx++) {
    const startBiasCivilization = GameInfo.StartBiasNaturalWonders[nwIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasNaturalWonders[nwIdx]?.LeaderType;
    if (startBiasCivilization) {
      const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
      const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
      if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
        score += getNaturalWonderStartBiasScore(GameInfo.StartBiasNaturalWonders[nwIdx].Score, iX, iY);
      }
    }
    if (startBiasLeader) {
      const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
      const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
      if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
        score += getNaturalWonderStartBiasScore(GameInfo.StartBiasNaturalWonders[nwIdx].Score, iX, iY);
      }
    }
  }
  for (let iIdx = 0; iIdx < GameInfo.StartBiasIslands.length; iIdx++) {
    const startBiasCivilization = GameInfo.StartBiasIslands[iIdx]?.CivilizationType;
    const startBiasLeader = GameInfo.StartBiasIslands[iIdx]?.LeaderType;
    if (startBiasCivilization) {
      const startBiasCivilizationTypeIndex = GameInfo.Civilizations.lookup(startBiasCivilization)?.$index;
      const civInfoTypeIndex = GameInfo.Civilizations.lookup(eCivType)?.$index;
      if (startBiasCivilizationTypeIndex == civInfoTypeIndex) {
        score += getIslandStartBiasScore(GameInfo.StartBiasIslands[iIdx].Score, iX, iY);
      }
    }
    if (startBiasLeader) {
      const startBiasLeaderTypeIndex = GameInfo.Leaders.lookup(startBiasLeader)?.$index;
      const leaderInfoTypeIndex = GameInfo.Leaders.lookup(eLeaderType)?.$index;
      if (startBiasLeaderTypeIndex == leaderInfoTypeIndex) {
        score += getIslandStartBiasScore(GameInfo.StartBiasIslands[iIdx].Score, iX, iY);
      }
    }
  }
  return score;
}
function getBiomeStartBiasScore(biome, score, iX, iY) {
  const startBiasBiomeTypeIndex = GameInfo.Biomes.lookup(biome)?.$index;
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    const biomeInfoTypeIndex = GameInfo.Biomes.lookup(GameplayMap.getBiomeType(iLocation.x, iLocation.y))?.$index;
    if (startBiasBiomeTypeIndex == biomeInfoTypeIndex) {
      let distance = GameplayMap.getPlotDistance(iX, iY, iLocation.x, iLocation.y);
      if (distance < 1) {
        distance = 1;
      }
      outputScore += score / distance;
    }
  }
  return outputScore;
}
function getTerrainStartBiasScore(terrain, score, iX, iY) {
  const startBiasTerrainTypeIndex = GameInfo.Terrains.lookup(terrain)?.$index;
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    const terrainInfoTypeIndex = GameInfo.Terrains.lookup(
      GameplayMap.getTerrainType(iLocation.x, iLocation.y)
    )?.$index;
    if (startBiasTerrainTypeIndex == terrainInfoTypeIndex) {
      let distance = GameplayMap.getPlotDistance(iX, iY, iLocation.x, iLocation.y);
      if (distance < 1) {
        distance = 1;
      }
      outputScore += score / distance;
    }
  }
  return outputScore;
}
function getRiverStartBiasScore(score, iX, iY) {
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    if (GameplayMap.isRiver(iLocation.x, iLocation.y)) {
      let distance = GameplayMap.getPlotDistance(iX, iY, iLocation.x, iLocation.y);
      if (distance < 1) {
        distance = 1;
      }
      outputScore += score / distance;
    }
  }
  return outputScore;
}
function getCoastStartBiasScore(score, iX, iY) {
  let outputScore = 0;
  if (isOceanAccess(iX, iY)) {
    outputScore += score;
  }
  return outputScore;
}
function getFeatureClassStartBiasScore(feature, score, iX, iY) {
  const startBiasFeatureTypeIndex = GameInfo.FeatureClasses.lookup(feature)?.$index;
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    const featureInfoTypeIndex = GameInfo.Features.lookup(
      GameplayMap.getFeatureType(iLocation.x, iLocation.y)
    )?.FeatureClassType;
    if (featureInfoTypeIndex) {
      const featureClassInfoTypeIndex = GameInfo.FeatureClasses.lookup(featureInfoTypeIndex)?.$index;
      if (featureClassInfoTypeIndex == startBiasFeatureTypeIndex) {
        let distance = GameplayMap.getPlotDistance(iX, iY, iLocation.x, iLocation.y);
        if (distance < 1) {
          distance = 1;
        }
        outputScore += score / distance;
      }
    }
  }
  return outputScore;
}
function getResourceStartBiasScore(resource, score, iX, iY) {
  const startBiasResourceTypeIndex = GameInfo.Resources.lookup(resource)?.$index;
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    const resourceInfoTypeIndex = GameInfo.Resources.lookup(
      GameplayMap.getResourceType(iLocation.x, iLocation.y)
    )?.$index;
    if (startBiasResourceTypeIndex == resourceInfoTypeIndex) {
      outputScore += score;
    }
  }
  return outputScore;
}
function getLakeStartBiasScore(score, iX, iY) {
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    if (GameplayMap.isLake(iLocation.x, iLocation.y)) {
      outputScore += score;
    }
  }
  if (outputScore > 0) {
    console.log("Start Bias Score: " + outputScore);
  }
  return outputScore;
}
function getNaturalWonderStartBiasScore(score, iX, iY) {
  const plots = GameplayMap.getPlotIndicesInRadius(iX, iY, 3);
  let outputScore = 0;
  for (let plot = 0; plot < plots.length; plot++) {
    const iLocation = GameplayMap.getLocationFromIndex(plots[plot]);
    if (GameplayMap.isNaturalWonder(iLocation.x, iLocation.y)) {
      outputScore += score;
    }
  }
  if (outputScore > 0) {
    console.log("Start Bias Score: " + outputScore);
  }
  return outputScore;
}
function getIslandStartBiasScore(score, iX, iY) {
  let outputScore = 0;
  if (GameplayMap.isIsland(iX, iY)) {
    outputScore += score;
  }
  if (outputScore > 0) {
    console.log("Start Bias Score: " + outputScore);
  }
  return outputScore;
}

export { PlayerRegion, PlayerRegionScores, assignSingleContinentStartPositions, assignStartPositions, assignStartPositionsFromHexMap, assignStartPositionsFromTiles, chooseStartSectors };
//# sourceMappingURL=assign-starting-plots.js.map
