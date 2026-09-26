import { generateDiscoveries } from '../maps/discovery-generator.js';
import { dumpResources } from '../maps/map-debug-helpers.js';
import { g_PolarWaterRows } from '../maps/map-globals.js';
import { removeRuralDistrict, placeRuralDistrict, replaceIslandResources } from '../maps/map-utilities.js';
import { tileClassIdFromValidBiome, prepareResourceSet, VERBOSE_LOGGING, getTileId, getDenseTileGroupId, isResourceAllowedOnLandmass, NUM_LANDMASS_GROUPS, NUM_TILE_GROUPS, buildPlacementContext, DENSITY_TARGET, tileClassFromId, buildBlueNoiseWindows, MAX_DENSITY, placeResourcesWithBlueNoise } from '../maps/resource-placement-common.js';
import { profileScope } from './profiling.js';
import { RandomImpl } from './random-pcg-32.js';
import { placeObserverEyes } from '../maps/mpt-observer-eye.js';   // MPT

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/scripts/age-transition-post-load.js
 * (build dated 2026-09-16); the ONLY changes are the "MPT:" import and the call
 * at the end of generateTransition. Re-apply after game updates.
 *
 * MPT: an Age transition resets every unit, so each Observer gets a new
 * Observer's Eye (its vision) on the marine ice (../maps/mpt-observer-eye.js).
 */

console.log("Loading age-transition-post-load.ts");
console.log("Legacies and Victories overriden version!");
let g_numMajorPlayers = 0;
let g_incomingAge = 0;
let g_continuityMode = false;
function requestInitializationParameters(initParams) {
  console.log("Getting Age Transition Parameters");
  console.log("Players: ", initParams.numMajorPlayers);
  console.log("Old Age: ", initParams.outgoingAge);
  console.log("New Age: ", initParams.incomingAge);
  g_numMajorPlayers = initParams.numMajorPlayers;
  g_incomingAge = initParams.incomingAge;
  engine.call("SetAgeInitializationParameters", initParams);
}
function doMapUpdates() {
  TerrainBuilder.storeWaterData();
}
function generateTransition() {
  console.log("Generating age transition!");
  const setting = Configuration.getGameValue("AgeTransitionSettingName");
  console.log("Age Transition Setting: " + setting);
  if (setting == "AGE_TRANSITION_SETTING_KEEP_MORE") {
    console.log("Using continuity setting");
    g_continuityMode = true;
  }
  doMapUpdates();
  const mapName = Configuration.getMapValue("Name");
  console.log(mapName);
  if (mapName == "LOC_MAP_EARTH_NAME") {
    addNewResourcesEarthHuge();
    console.log("yeehaw I remembered Earth");
  } else {
    const aGeneratedResourceHashes = ResourceBuilder.getGeneratedMapResources();
    const removedResourcePlots = removeObsoleteResources(aGeneratedResourceHashes);
    addNewResources(removedResourcePlots, aGeneratedResourceHashes);
  }
  const iWidth = GameplayMap.getGridWidth();
  const iHeight = GameplayMap.getGridHeight();
  generateDiscoveries(iWidth, iHeight, [], g_PolarWaterRows);
  for (let iPlayer = 0; iPlayer < g_numMajorPlayers; iPlayer++) {
    if (!Players.get(iPlayer)?.isAlive) {
      continue;
    }
    const regressedCities = regressCitiesToTowns(iPlayer);
    if (g_continuityMode) {
      positionUnits(iPlayer);
    } else {
      positionArmyCommanders(iPlayer);
      positionFleetCommanders(iPlayer);
    }
    capGold(iPlayer);
    capInfluence(iPlayer);
    generateDarkAgeCards(iPlayer);
    generateDynamicVictoryCards(iPlayer);
    generateRetainCityCards(iPlayer, regressedCities);
    Players.AdvancedStart.get(iPlayer)?.dynamicCardsAddedComplete();
  }
  try { placeObserverEyes(); } catch (e) { console.log("[MPT observer-eye] placement failed: " + e); }   // MPT
}
function removeObsoleteResources(aGeneratedResourceHashes) {
  const scope = new profileScope("Removing old resources");
  const resourcesAvailable = ResourceBuilder.getResourceCounts(PlotTags.PLOT_TAG_ALL).map((x, idx) => ({
    idx,
    resourceDef: GameInfo.Resources.find((res) => res.$index === idx),
    count: x,
    validForAge: true,
    removalWeight: 0,
    overlappedResources: /* @__PURE__ */ new Set()
  }));
  let typesOnMap = 0;
  let typesAllowedToKeep = 0;
  const resourcesToRemove = [];
  for (const r of resourcesAvailable) {
    if (r.count > 0) {
      typesOnMap++;
      r.validForAge = ResourceBuilder.isResourceValidForAge(r.resourceDef.$hash, g_incomingAge);
      if (!r.validForAge) {
        resourcesToRemove.push(r.resourceDef);
      } else {
        typesAllowedToKeep++;
      }
    }
  }
  console.log(
    `Adding ${aGeneratedResourceHashes.length} new resources: ${aGeneratedResourceHashes.map((r) => Locale.compose(GameInfo.Resources.lookup(r)?.Name ?? "unknown")).join(", ")}`
  );
  console.log(`Types of resources already on map: ${typesOnMap}`);
  console.log(`Resources we can keep on map: ${typesAllowedToKeep}`);
  console.log(`Calculating placement weights for new resources to be added:`);
  class TileGroupInfo {
    weight = 0;
    resourcesInGroup = /* @__PURE__ */ new Set();
  }
  const newResourcesUseWeights = /* @__PURE__ */ new Map();
  for (const r of aGeneratedResourceHashes) {
    const resourceDef = GameInfo.Resources.find((res) => res.$hash === r);
    if (!resourceDef) continue;
    for (const validBiome of GameInfo.Resource_ValidBiomes) {
      if (validBiome.ResourceType != resourceDef.ResourceType) continue;
      const tileGroupId = tileClassIdFromValidBiome(validBiome);
      if (tileGroupId === void 0) continue;
      const tileGroupInfo = newResourcesUseWeights.get(tileGroupId) ?? new TileGroupInfo();
      tileGroupInfo.weight += resourceDef.Weight;
      tileGroupInfo.resourcesInGroup.add(resourceDef);
      newResourcesUseWeights.set(tileGroupId, tileGroupInfo);
      console.log(`  ${Locale.compose(resourceDef.Name)} in group ${tileGroupId}`);
    }
  }
  console.log(`Calculating weights for existing resources to be removed based on their placement:`);
  for (const r of resourcesAvailable) {
    if (r.count == 0 || !r.validForAge || !r.resourceDef) continue;
    if (r.resourceDef.Staple || r.resourceDef.LandmassUnique) continue;
    if (ResourceBuilder.isResourceRequiredForAge(r.resourceDef.$hash, g_incomingAge)) continue;
    for (const validBiome of GameInfo.Resource_ValidBiomes) {
      if (validBiome.ResourceType != r.resourceDef.ResourceType) continue;
      const tileGroupId = tileClassIdFromValidBiome(validBiome);
      if (tileGroupId === void 0) continue;
      console.log(`  Existing resource ${Locale.compose(r.resourceDef.Name)} is in tile group ${tileGroupId}`);
      const tileGroupInfo = newResourcesUseWeights.get(tileGroupId);
      if (tileGroupInfo) {
        r.removalWeight += tileGroupInfo.weight;
        r.overlappedResources = /* @__PURE__ */ new Set([...r.overlappedResources, ...tileGroupInfo.resourcesInGroup]);
      }
    }
  }
  for (const r of resourcesAvailable) {
    if (r.removalWeight > 0) {
      console.log(`Resource ${Locale.compose(r.resourceDef.Name)} has removal weight ${r.removalWeight}`);
    }
  }
  console.log(
    `Removing resources no longer valid for age: ${resourcesToRemove.map((r) => Locale.compose(r.Name)).join(", ")}`
  );
  const removalBudget = Math.max(0, aGeneratedResourceHashes.length - resourcesToRemove.length);
  const weightedCandidates = resourcesAvailable.filter((a) => a.removalWeight > 0).sort((a, b) => b.removalWeight - a.removalWeight);
  const removeByWeight = weightedCandidates.slice(0, removalBudget).map((r) => r);
  console.log(`Removing resources due to overlap with new resources:`);
  for (const r of removeByWeight) {
    if (r.removalWeight > 0) {
      console.log(
        `  ${Locale.compose(r.resourceDef.Name)} overlaps with ${r.overlappedResources.size} new resources: ${[...r.overlappedResources].map((res) => Locale.compose(res.Name)).join(", ")}`
      );
    } else {
      console.log(
        `  Warning: ${Locale.compose(r.resourceDef.Name)} has no calculated removal weight but is being removed to make room for new resources.`
      );
    }
  }
  resourcesToRemove.push(...removeByWeight.map((r) => r.resourceDef));
  const removeResourceLookup = new Uint8Array(GameInfo.Resources.length);
  removeResourceLookup.fill(255);
  for (let i = 0; i < resourcesToRemove.length; i++) {
    removeResourceLookup[resourcesToRemove[i].$index] = i;
  }
  let countRemoved = 0;
  const removedResourcePlots = [];
  const iWidth = GameplayMap.getGridWidth();
  const iHeight = GameplayMap.getGridHeight();
  for (let iY = 0; iY < iHeight; iY++) {
    for (let iX = 0; iX < iWidth; iX++) {
      const iIndex = iY * iWidth + iX;
      const resourceIdx = GameplayMap.getResourceType(iX, iY);
      if (resourceIdx === ResourceTypes.NO_RESOURCE) continue;
      const removeResourceIdx = removeResourceLookup[resourceIdx];
      if (removeResourceIdx != 255) {
        const resourceDef = resourcesToRemove[removeResourceIdx];
        countRemoved++;
        removeRuralDistrict(iX, iY);
        ResourceBuilder.setResourceType(iX, iY, ResourceTypes.NO_RESOURCE);
        console.log(`Removed resource: ${Locale.compose(resourceDef.Name)}(${resourceIdx}) at (${iX}, ${iY})`);
        removedResourcePlots.push(iIndex);
        placeRuralDistrict(iX, iY);
      }
    }
  }
  console.log("Removed total resource locations: " + countRemoved);
  scope.end();
  return removedResourcePlots;
}
function addNewResources(iRemovedResourcePlots, aGeneratedResourceHashes) {
  const scope = new profileScope("addNewResources");
  console.log("Adding new resources");
  const iWidth = GameplayMap.getGridWidth();
  const iHeight = GameplayMap.getGridHeight();
  const iResourceCounts = ResourceBuilder.getResourceCounts(-1);
  const resourceSet = prepareResourceSet(aGeneratedResourceHashes, (info) => iResourceCounts[info.$index] === 0);
  if (VERBOSE_LOGGING) {
    console.log(`New resources to place (${resourceSet.activeResourceIndices.length} types):`);
    for (const typeIdx of resourceSet.activeResourceIndices) {
      const def = GameInfo.Resources[typeIdx];
      const landmass = resourceSet.resourceAssignedLandmass[typeIdx];
      console.log(`  ${def?.ResourceType}: weight=${def?.Weight}, landmass=${landmass}`);
    }
  }
  const placedPerResource = new Uint16Array(GameInfo.Resources.length);
  const placedPerResourcePerTileGroup = /* @__PURE__ */ new Map();
  const tileGroupToResources = /* @__PURE__ */ new Map();
  for (const vb of resourceSet.resolvedValidBiomes) {
    const list = tileGroupToResources.get(vb.tileGroupId);
    if (list) {
      list.push(vb.resourceIdx);
    } else {
      tileGroupToResources.set(vb.tileGroupId, [vb.resourceIdx]);
    }
  }
  for (let i = iRemovedResourcePlots.length - 1; i > 0; i--) {
    const j = TerrainBuilder.getRandomNumber(i + 1, "Removed Plot Shuffle");
    [iRemovedResourcePlots[i], iRemovedResourcePlots[j]] = [iRemovedResourcePlots[j], iRemovedResourcePlots[i]];
  }
  let removedPlotsFilled = 0;
  const eligibleIndices = new Int32Array(GameInfo.Resources.length);
  const eligibleWeights = new Float32Array(GameInfo.Resources.length);
  for (const plotIdx of iRemovedResourcePlots) {
    const x = plotIdx % iWidth;
    const y = (plotIdx - x) / iWidth;
    if (MapCities.getDistrict(x, y) != null) continue;
    if (GameplayMap.getResourceType(x, y) !== ResourceTypes.NO_RESOURCE) continue;
    const regionId = GameplayMap.getLandmassRegionId(x, y);
    const rawId = getTileId(x, y);
    const tileId = getDenseTileGroupId(rawId);
    const candidates = tileGroupToResources.get(tileId);
    if (!candidates || candidates.length === 0) continue;
    let eligibleCount = 0;
    let totalWeight = 0;
    for (const resourceIdx of candidates) {
      if (!isResourceAllowedOnLandmass(
        resourceSet.resourceAssignedLandmass[resourceIdx],
        regionId,
        NUM_LANDMASS_GROUPS
      ))
        continue;
      if (!ResourceBuilder.canHaveResource(x, y, resourceIdx, true)) continue;
      const def = GameInfo.Resources[resourceIdx];
      const minimum = def?.MinimumPerLandmass > 0 ? def.MinimumPerLandmass : 0;
      const placed = placedPerResource[resourceIdx];
      const weight = resourceSet.resourceWeight[resourceIdx] * (1 + Math.max(0, minimum - placed));
      if (weight <= 0) continue;
      eligibleIndices[eligibleCount] = resourceIdx;
      eligibleWeights[eligibleCount] = weight;
      eligibleCount++;
      totalWeight += weight;
    }
    let bestIdx = -1;
    if (eligibleCount > 0) {
      let r = RandomImpl.fRand("Removed Plot Weighted Pick") * totalWeight;
      for (let i = 0; i < eligibleCount; i++) {
        r -= eligibleWeights[i];
        if (r <= 0) {
          bestIdx = eligibleIndices[i];
          break;
        }
      }
    }
    if (bestIdx >= 0) {
      ResourceBuilder.setResourceType(x, y, bestIdx);
      placedPerResource[bestIdx]++;
      const key = bestIdx * NUM_TILE_GROUPS + tileId;
      placedPerResourcePerTileGroup.set(key, (placedPerResourcePerTileGroup.get(key) ?? 0) + 1);
      removedPlotsFilled++;
      removeRuralDistrict(x, y);
      placeRuralDistrict(x, y);
      if (VERBOSE_LOGGING) {
        const name = GameInfo.Resources[bestIdx]?.ResourceType ?? `Unknown(${bestIdx})`;
        console.log(`  Filled removed plot (${x}, ${y}) with ${name}`);
      }
    }
  }
  console.log(`Phase 2: Filled ${removedPlotsFilled} of ${iRemovedResourcePlots.length} removed plots.`);
  const effectiveMinimums = new Uint16Array(GameInfo.Resources.length);
  let totalRemaining = 0;
  for (const typeIdx of resourceSet.activeResourceIndices) {
    const def = GameInfo.Resources[typeIdx];
    if (!def) continue;
    const minimum = def.MinimumPerLandmass > 0 ? def.MinimumPerLandmass : 0;
    const remaining = Math.max(0, minimum - placedPerResource[typeIdx]);
    effectiveMinimums[typeIdx] = remaining;
    totalRemaining += remaining;
  }
  if (VERBOSE_LOGGING) {
    console.log(`Phase 3: ${totalRemaining} resources still needed after filling removed plots.`);
    for (const typeIdx of resourceSet.activeResourceIndices) {
      const remaining = effectiveMinimums[typeIdx];
      if (remaining > 0) {
        const name = GameInfo.Resources[typeIdx]?.ResourceType ?? `Unknown(${typeIdx})`;
        console.log(`  ${name}: ${remaining} more needed`);
      }
    }
  }
  if (totalRemaining > 0) {
    const ctx = buildPlacementContext(iWidth, iHeight);
    const numResources = GameInfo.Resources.length;
    const isNewResource = new Uint8Array(numResources);
    for (const r of aGeneratedResourceHashes) {
      const resourceDef = GameInfo.Resources.lookup(r);
      if (resourceDef) {
        isNewResource[resourceDef.$index] = 1;
      }
    }
    const totalTiles = iWidth * iHeight;
    const skipMask = new Uint8Array(totalTiles);
    const oldExistingByTileGroup = new Uint16Array(NUM_TILE_GROUPS);
    const oldTypesCountByTileGroup = new Uint8Array(NUM_TILE_GROUPS);
    const oldTypeSeenByTileGroup = new Uint8Array(NUM_TILE_GROUPS * numResources);
    for (let y = 0; y < iHeight; y++) {
      for (let x = 0; x < iWidth; x++) {
        const idx = y * iWidth + x;
        const resourceIdx = GameplayMap.getResourceType(x, y);
        if (resourceIdx !== ResourceTypes.NO_RESOURCE) {
          skipMask[idx] = 1;
          if (!isNewResource[resourceIdx]) {
            const tid = ctx.tileIdCache[idx];
            oldExistingByTileGroup[tid]++;
            const flagIdx = tid * numResources + resourceIdx;
            if (oldTypeSeenByTileGroup[flagIdx] === 0) {
              oldTypesCountByTileGroup[tid]++;
              oldTypeSeenByTileGroup[flagIdx] = 1;
            }
          }
        } else if (MapCities.getDistrict(x, y) != null) {
          skipMask[idx] = 1;
        }
      }
    }
    const MAX_COMBINED_DENSITY_FACTOR = 1.5;
    const maxCombinedDensity = DENSITY_TARGET * MAX_COMBINED_DENSITY_FACTOR;
    const newTypesCountByTileGroup = new Uint8Array(NUM_TILE_GROUPS);
    for (const [tid, list] of tileGroupToResources) {
      newTypesCountByTileGroup[tid] = list.length;
    }
    const densityByResourceAndGroup = new Float32Array(numResources * NUM_TILE_GROUPS);
    for (const vb of resourceSet.resolvedValidBiomes) {
      const tid = vb.tileGroupId;
      const groupCount = ctx.groupCount[tid];
      if (groupCount === 0) continue;
      const nOld = oldTypesCountByTileGroup[tid];
      const nNew = newTypesCountByTileGroup[tid];
      if (nNew === 0) continue;
      const totalResources = nOld + nNew;
      const oldDensity = oldExistingByTileGroup[tid] / groupCount;
      let perTypeShare = DENSITY_TARGET / totalResources;
      const headroom = (DENSITY_TARGET - oldDensity) / nNew;
      if (headroom > perTypeShare) {
        perTypeShare = headroom;
      } else if (perTypeShare > headroom * MAX_COMBINED_DENSITY_FACTOR) {
        perTypeShare = headroom * MAX_COMBINED_DENSITY_FACTOR;
      }
      const fairShareDensity = perTypeShare * vb.weight;
      const intendedTiles = fairShareDensity * groupCount;
      const key = vb.resourceIdx * NUM_TILE_GROUPS + tid;
      const alreadyPlaced = placedPerResourcePerTileGroup.get(key) ?? 0;
      const remainingTiles = Math.max(0, intendedTiles - alreadyPlaced);
      const finalDensity = remainingTiles / groupCount;
      densityByResourceAndGroup[key] = Math.max(0, finalDensity);
      if (VERBOSE_LOGGING) {
        const tc = tileClassFromId(ctx.groupRawId[tid]);
        const resName = GameInfo.Resources.lookup(vb.resourceIdx)?.ResourceType ?? `Unknown(${vb.resourceIdx})`;
        const terrainName = GameInfo.Terrains.lookup(tc.terrain)?.TerrainType ?? `Unknown(${tc.terrain})`;
        const biomeName = GameInfo.Biomes.lookup(tc.biome)?.BiomeType ?? `Unknown(${tc.biome})`;
        const featureName = GameInfo.Features.lookup(tc.feature)?.FeatureType ?? "";
        console.log(
          `  ${resName} on ${terrainName}/${biomeName}/${featureName}: nOld=${nOld} nNew=${nNew} oldDensity=${oldDensity.toFixed(3)} perTypeShare=${perTypeShare.toFixed(3)} weight=${vb.weight.toFixed(2)} intendedTiles=${intendedTiles.toFixed(1)} alreadyPlaced=${alreadyPlaced} final=${finalDensity.toFixed(3)}`
        );
      }
    }
    const blueNoisePlan = buildBlueNoiseWindows(ctx, resourceSet, {
      densityTarget: DENSITY_TARGET,
      maxDensity: MAX_DENSITY,
      effectiveMinimums,
      densityByResourceAndGroup
    });
    const offsetX = TerrainBuilder.getRandomNumber(128, "Age Transition Blue Noise Offset X");
    const offsetY = TerrainBuilder.getRandomNumber(128, "Age Transition Blue Noise Offset Y");
    placeResourcesWithBlueNoise(ctx, resourceSet, blueNoisePlan, {
      skipMask,
      offsetX,
      offsetY,
      shouldPlaceResource: void 0,
      onResourcePlaced: (x, y) => {
        removeRuralDistrict(x, y);
        placeRuralDistrict(x, y);
      }
    });
  }
  const ageDefinition = GameInfo.Ages.lookup(g_incomingAge);
  if (ageDefinition) {
    const mapType = Configuration.getMapValue("Name");
    for (const option of GameInfo.MapIslandBehavior) {
      if (option.MapType === mapType && option.AgeType === ageDefinition.AgeType) {
        replaceIslandResources(iWidth, iHeight, option.ResourceClassType);
      }
    }
  }
  dumpResources(iWidth, iHeight);
  scope.end();
}
function addNewResourcesEarthHuge() {
  let xCoord = 0;
  let yCoord = 0;
  let resourceToBePlaced = "";
  if (Game.age == Database.makeHash("AGE_EXPLORATION")) {
    console.log("Found Explo");
    stampResourceEarthHuge(69, 53, "RESOURCE_NITER");
    stampResourceEarthHuge(55, 59, "RESOURCE_FURS");
    stampResourceEarthHuge(61, 60, "RESOURCE_FURS");
    stampResourceEarthHuge(64, 62, "RESOURCE_FURS");
    stampResourceEarthHuge(72, 62, "RESOURCE_FURS");
    stampResourceEarthHuge(81, 61, "RESOURCE_FURS");
    stampResourceEarthHuge(86, 60, "RESOURCE_FURS");
    stampResourceEarthHuge(94, 57, "RESOURCE_FURS");
    stampResourceEarthHuge(90, 54, "RESOURCE_NITER");
    stampResourceEarthHuge(81, 54, "RESOURCE_NITER");
    stampResourceEarthHuge(74, 53, "RESOURCE_NITER");
    stampResourceEarthHuge(54, 53, "RESOURCE_NITER");
    stampResourceEarthHuge(53, 27, "RESOURCE_NITER");
    stampResourceEarthHuge(49, 12, "RESOURCE_NITER");
    stampResourceEarthHuge(16, 49, "RESOURCE_NITER");
    stampResourceEarthHuge(20, 49, "RESOURCE_FURS");
    stampResourceEarthHuge(49, 27, "RESOURCE_NITER");
    stampResourceEarthHuge(45, 25, "RESOURCE_NITER");
    stampResourceEarthHuge(22, 62, "RESOURCE_FURS");
    stampResourceEarthHuge(12, 63, "RESOURCE_FURS");
    stampResourceEarthHuge(18, 61, "RESOURCE_FURS");
    stampResourceEarthHuge(23, 51, "RESOURCE_FURS");
    stampResourceEarthHuge(69, 44, "RESOURCE_TEA");
    stampResourceEarthHuge(57, 49, "RESOURCE_TEA");
    stampResourceEarthHuge(26, 13, "RESOURCE_NITER");
    stampResourceEarthHuge(57, 56, "RESOURCE_FURS");
    stampResourceEarthHuge(60, 25, "RESOURCE_TEA");
    stampResourceEarthHuge(59, 21, "RESOURCE_TEA");
    stampResourceEarthHuge(24, 20, "RESOURCE_NITER");
    stampResourceEarthHuge(26, 29, "RESOURCE_NITER");
    stampResourceEarthHuge(13, 54, "RESOURCE_FURS");
    stampResourceEarthHuge(41, 31, "RESOURCE_NITER");
    stampResourceEarthHuge(54, 31, "RESOURCE_NITER");
    stampResourceEarthHuge(64, 35, "RESOURCE_NITER");
    removeRuralDistrict(39, 60);
    ResourceBuilder.setResourceType(39, 60, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(39, 60);
    stampResourceEarthHuge(86, 10, "RESOURCE_TEA");
    stampResourceEarthHuge(62, 59, "RESOURCE_SILVER");
    stampResourceEarthHuge(78, 59, "RESOURCE_SILVER");
    removeRuralDistrict(16, 60);
    ResourceBuilder.setResourceType(16, 60, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(16, 60);
    stampResourceEarthHuge(105, 7, "RESOURCE_SILVER");
    stampResourceEarthHuge(20, 54, "RESOURCE_SILVER");
    stampResourceEarthHuge(62, 11, "RESOURCE_GOLD");
    stampResourceEarthHuge(92, 11, "RESOURCE_LIMESTONE");
    stampResourceEarthHuge(90, 17, "RESOURCE_LIMESTONE");
    stampResourceEarthHuge(99, 16, "RESOURCE_TIN");
    stampResourceEarthHuge(14, 33, "RESOURCE_COCOA");
    stampResourceEarthHuge(19, 31, "RESOURCE_COCOA");
    stampResourceEarthHuge(22, 34, "RESOURCE_COCOA");
    stampResourceEarthHuge(27, 25, "RESOURCE_COCOA");
    stampResourceEarthHuge(29, 21, "RESOURCE_COCOA");
    stampResourceEarthHuge(32, 20, "RESOURCE_COCOA");
    stampResourceEarthHuge(36, 21, "RESOURCE_COCOA");
    stampResourceEarthHuge(23, 37, "RESOURCE_COCOA");
    stampResourceEarthHuge(15, 35, "RESOURCE_COCOA");
    stampResourceEarthHuge(25, 28, "RESOURCE_COCOA");
    stampResourceEarthHuge(44, 22, "RESOURCE_COCOA");
    stampResourceEarthHuge(47, 22, "RESOURCE_COCOA");
    stampResourceEarthHuge(35, 18, "RESOURCE_COCOA");
    stampResourceEarthHuge(68, 13, "RESOURCE_COCOA");
    stampResourceEarthHuge(91, 25, "RESOURCE_COCOA");
    stampResourceEarthHuge(88, 26, "RESOURCE_COCOA");
    stampResourceEarthHuge(28, 36, "RESOURCE_COCOA");
    stampResourceEarthHuge(58, 13, "RESOURCE_COCOA");
    stampResourceEarthHuge(56, 54, "RESOURCE_PITCH");
    stampResourceEarthHuge(58, 59, "RESOURCE_PITCH");
    stampResourceEarthHuge(61, 55, "RESOURCE_PITCH");
    stampResourceEarthHuge(49, 47, "RESOURCE_PITCH");
    stampResourceEarthHuge(53, 48, "RESOURCE_PITCH");
    stampResourceEarthHuge(62, 48, "RESOURCE_PITCH");
    stampResourceEarthHuge(66, 52, "RESOURCE_PITCH");
    stampResourceEarthHuge(13, 58, "RESOURCE_PITCH");
    stampResourceEarthHuge(10, 53, "RESOURCE_PITCH");
    stampResourceEarthHuge(31, 10, "RESOURCE_PITCH");
    stampResourceEarthHuge(56, 7, "RESOURCE_PITCH");
    stampResourceEarthHuge(50, 11, "RESOURCE_PITCH");
    stampResourceEarthHuge(75, 32, "RESOURCE_SPICES");
    stampResourceEarthHuge(72, 30, "RESOURCE_SPICES");
    stampResourceEarthHuge(73, 26, "RESOURCE_SPICES");
    stampResourceEarthHuge(84, 33, "RESOURCE_SPICES");
    stampResourceEarthHuge(44, 37, "RESOURCE_SPICES");
    stampResourceEarthHuge(45, 28, "RESOURCE_SPICES");
    stampResourceEarthHuge(52, 26, "RESOURCE_SPICES");
    stampResourceEarthHuge(90, 37, "RESOURCE_SPICES");
    stampResourceEarthHuge(88, 41, "RESOURCE_SPICES");
    stampResourceEarthHuge(96, 50, "RESOURCE_SPICES");
    stampResourceEarthHuge(103, 48, "RESOURCE_SPICES");
    stampResourceEarthHuge(101, 53, "RESOURCE_SPICES");
    stampResourceEarthHuge(61, 45, "RESOURCE_SPICES");
    stampResourceEarthHuge(57, 54, "RESOURCE_SPICES");
    stampResourceEarthHuge(49, 16, "RESOURCE_SPICES");
    stampResourceEarthHuge(53, 13, "RESOURCE_SPICES");
    stampResourceEarthHuge(30, 17, "RESOURCE_SUGAR");
    stampResourceEarthHuge(32, 18, "RESOURCE_SUGAR");
    stampResourceEarthHuge(32, 12, "RESOURCE_SUGAR");
    stampResourceEarthHuge(25, 26, "RESOURCE_SUGAR");
    stampResourceEarthHuge(29, 35, "RESOURCE_SUGAR");
    stampResourceEarthHuge(26, 36, "RESOURCE_SUGAR");
    stampResourceEarthHuge(73, 32, "RESOURCE_SUGAR");
    stampResourceEarthHuge(82, 32, "RESOURCE_SUGAR");
    stampResourceEarthHuge(84, 30, "RESOURCE_SUGAR");
    stampResourceEarthHuge(101, 16, "RESOURCE_SUGAR");
    stampResourceEarthHuge(96, 18, "RESOURCE_SUGAR");
    stampResourceEarthHuge(94, 20, "RESOURCE_SUGAR");
    stampResourceEarthHuge(17, 40, "RESOURCE_SUGAR");
    stampResourceEarthHuge(17, 43, "RESOURCE_SUGAR");
    stampResourceEarthHuge(78, 36, "RESOURCE_SUGAR");
    stampResourceEarthHuge(87, 33, "RESOURCE_SUGAR");
    stampResourceEarthHuge(69, 44, "RESOURCE_TEA");
    stampResourceEarthHuge(57, 49, "RESOURCE_TEA");
    stampResourceEarthHuge(60, 25, "RESOURCE_TEA");
    stampResourceEarthHuge(59, 21, "RESOURCE_TEA");
    stampResourceEarthHuge(86, 10, "RESOURCE_TEA");
    stampResourceEarthHuge(68, 42, "RESOURCE_TEA");
    stampResourceEarthHuge(84, 36, "RESOURCE_TEA");
    stampResourceEarthHuge(80, 36, "RESOURCE_TEA");
    stampResourceEarthHuge(102, 49, "RESOURCE_TEA");
    stampResourceEarthHuge(81, 41, "RESOURCE_TEA");
    stampResourceEarthHuge(82, 44, "RESOURCE_TEA");
    stampResourceEarthHuge(83, 41, "RESOURCE_TEA");
    stampResourceEarthHuge(91, 40, "RESOURCE_TEA");
    stampResourceEarthHuge(83, 45, "RESOURCE_TEA");
    stampResourceEarthHuge(91, 45, "RESOURCE_TEA");
    stampResourceEarthHuge(96, 47, "RESOURCE_TEA");
    stampResourceEarthHuge(74, 25, "RESOURCE_TEA");
    stampResourceEarthHuge(55, 52, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(56, 50, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(53, 59, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(48, 55, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(5, 49, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(45, 46, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(50, 47, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(84, 37, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(101, 11, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(1, 7, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(102, 13, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(37, 59, "RESOURCE_WHALES");
    stampResourceEarthHuge(35, 62, "RESOURCE_WHALES");
    stampResourceEarthHuge(38, 63, "RESOURCE_WHALES");
    stampResourceEarthHuge(47, 62, "RESOURCE_WHALES");
    stampResourceEarthHuge(52, 56, "RESOURCE_WHALES");
    stampResourceEarthHuge(5, 44, "RESOURCE_WHALES");
    stampResourceEarthHuge(7, 42, "RESOURCE_WHALES");
    stampResourceEarthHuge(12, 34, "RESOURCE_WHALES");
    stampResourceEarthHuge(28, 48, "RESOURCE_WHALES");
    stampResourceEarthHuge(20, 39, "RESOURCE_WHALES");
    stampResourceEarthHuge(18, 35, "RESOURCE_WHALES");
    stampResourceEarthHuge(32, 30, "RESOURCE_WHALES");
    stampResourceEarthHuge(36, 37, "RESOURCE_WHALES");
    stampResourceEarthHuge(49, 40, "RESOURCE_WHALES");
    stampResourceEarthHuge(46, 44, "RESOURCE_WHALES");
    stampResourceEarthHuge(39, 39, "RESOURCE_WHALES");
    stampResourceEarthHuge(36, 17, "RESOURCE_WHALES");
    stampResourceEarthHuge(35, 14, "RESOURCE_WHALES");
    stampResourceEarthHuge(29, 6, "RESOURCE_WHALES");
    stampResourceEarthHuge(30, 3, "RESOURCE_WHALES");
    stampResourceEarthHuge(24, 5, "RESOURCE_WHALES");
    stampResourceEarthHuge(25, 11, "RESOURCE_WHALES");
    stampResourceEarthHuge(22, 21, "RESOURCE_WHALES");
    stampResourceEarthHuge(19, 23, "RESOURCE_WHALES");
    stampResourceEarthHuge(11, 37, "RESOURCE_WHALES");
    stampResourceEarthHuge(5, 54, "RESOURCE_WHALES");
    stampResourceEarthHuge(3, 60, "RESOURCE_WHALES");
    stampResourceEarthHuge(1, 35, "RESOURCE_WHALES");
    stampResourceEarthHuge(103, 35, "RESOURCE_WHALES");
    stampResourceEarthHuge(104, 38, "RESOURCE_WHALES");
    stampResourceEarthHuge(1, 37, "RESOURCE_WHALES");
    stampResourceEarthHuge(47, 16, "RESOURCE_WHALES");
    stampResourceEarthHuge(49, 3, "RESOURCE_WHALES");
    stampResourceEarthHuge(56, 4, "RESOURCE_WHALES");
    stampResourceEarthHuge(61, 8, "RESOURCE_WHALES");
    stampResourceEarthHuge(65, 11, "RESOURCE_WHALES");
    stampResourceEarthHuge(66, 32, "RESOURCE_WHALES");
    stampResourceEarthHuge(64, 30, "RESOURCE_WHALES");
    stampResourceEarthHuge(71, 27, "RESOURCE_WHALES");
    stampResourceEarthHuge(104, 51, "RESOURCE_WHALES");
    stampResourceEarthHuge(103, 46, "RESOURCE_WHALES");
    stampResourceEarthHuge(102, 43, "RESOURCE_WHALES");
    stampResourceEarthHuge(105, 54, "RESOURCE_WHALES");
    stampResourceEarthHuge(98, 39, "RESOURCE_WHALES");
    stampResourceEarthHuge(95, 34, "RESOURCE_WHALES");
    stampResourceEarthHuge(85, 23, "RESOURCE_WHALES");
    stampResourceEarthHuge(82, 22, "RESOURCE_WHALES");
    stampResourceEarthHuge(90, 21, "RESOURCE_WHALES");
    stampResourceEarthHuge(87, 17, "RESOURCE_WHALES");
    stampResourceEarthHuge(84, 15, "RESOURCE_WHALES");
    stampResourceEarthHuge(84, 10, "RESOURCE_WHALES");
    stampResourceEarthHuge(85, 6, "RESOURCE_WHALES");
    stampResourceEarthHuge(96, 5, "RESOURCE_WHALES");
    stampResourceEarthHuge(100, 3, "RESOURCE_WHALES");
    stampResourceEarthHuge(102, 7, "RESOURCE_WHALES");
    stampResourceEarthHuge(0, 10, "RESOURCE_WHALES");
    stampResourceEarthHuge(103, 6, "RESOURCE_WHALES");
  } else if (Game.age == Database.makeHash("AGE_MODERN")) {
    console.log("Found Modern");
    stampResourceEarthHuge(69, 47, "RESOURCE_CITRUS");
    stampResourceEarthHuge(70, 39, "RESOURCE_CITRUS");
    stampResourceEarthHuge(75, 34, "RESOURCE_CITRUS");
    stampResourceEarthHuge(30, 8, "RESOURCE_CITRUS");
    stampResourceEarthHuge(41, 42, "RESOURCE_CITRUS");
    stampResourceEarthHuge(13, 43, "RESOURCE_CITRUS");
    stampResourceEarthHuge(40, 29, "RESOURCE_CITRUS");
    stampResourceEarthHuge(102, 47, "RESOURCE_CITRUS");
    stampResourceEarthHuge(90, 47, "RESOURCE_CITRUS");
    stampResourceEarthHuge(90, 53, "RESOURCE_CITRUS");
    stampResourceEarthHuge(82, 47, "RESOURCE_CITRUS");
    stampResourceEarthHuge(92, 16, "RESOURCE_COAL");
    stampResourceEarthHuge(94, 11, "RESOURCE_COAL");
    stampResourceEarthHuge(40, 57, "RESOURCE_COAL");
    stampResourceEarthHuge(62, 55, "RESOURCE_COAL");
    stampResourceEarthHuge(63, 49, "RESOURCE_COAL");
    stampResourceEarthHuge(44, 43, "RESOURCE_COAL");
    stampResourceEarthHuge(74, 45, "RESOURCE_COAL");
    stampResourceEarthHuge(55, 19, "RESOURCE_COAL");
    stampResourceEarthHuge(56, 27, "RESOURCE_COAL");
    stampResourceEarthHuge(85, 38, "RESOURCE_COAL");
    stampResourceEarthHuge(60, 50, "RESOURCE_COAL");
    stampResourceEarthHuge(80, 34, "RESOURCE_COAL");
    stampResourceEarthHuge(101, 49, "RESOURCE_COAL");
    stampResourceEarthHuge(26, 49, "RESOURCE_COAL");
    stampResourceEarthHuge(23, 46, "RESOURCE_COAL");
    stampResourceEarthHuge(46, 37, "RESOURCE_COAL");
    stampResourceEarthHuge(41, 44, "RESOURCE_COAL");
    stampResourceEarthHuge(43, 49, "RESOURCE_COAL");
    stampResourceEarthHuge(52, 47, "RESOURCE_COAL");
    stampResourceEarthHuge(84, 47, "RESOURCE_COAL");
    stampResourceEarthHuge(55, 7, "RESOURCE_COAL");
    stampResourceEarthHuge(90, 13, "RESOURCE_COAL");
    stampResourceEarthHuge(62, 24, "RESOURCE_COFFEE");
    stampResourceEarthHuge(14, 45, "RESOURCE_COFFEE");
    stampResourceEarthHuge(28, 17, "RESOURCE_COFFEE");
    stampResourceEarthHuge(72, 28, "RESOURCE_COFFEE");
    stampResourceEarthHuge(98, 18, "RESOURCE_COFFEE");
    stampResourceEarthHuge(79, 33, "RESOURCE_COFFEE");
    stampResourceEarthHuge(21, 31, "RESOURCE_COFFEE");
    stampResourceEarthHuge(73, 36, "RESOURCE_COFFEE");
    stampResourceEarthHuge(71, 33, "RESOURCE_COFFEE");
    stampResourceEarthHuge(71, 38, "RESOURCE_COFFEE");
    stampResourceEarthHuge(59, 16, "RESOURCE_COFFEE");
    stampResourceEarthHuge(92, 26, "RESOURCE_COFFEE");
    stampResourceEarthHuge(82, 34, "RESOURCE_COFFEE");
    stampResourceEarthHuge(70, 41, "RESOURCE_COFFEE");
    stampResourceEarthHuge(53, 17, "RESOURCE_COFFEE");
    stampResourceEarthHuge(56, 14, "RESOURCE_COFFEE");
    stampResourceEarthHuge(58, 10, "RESOURCE_COFFEE");
    stampResourceEarthHuge(79, 50, "RESOURCE_OIL");
    stampResourceEarthHuge(42, 33, "RESOURCE_OIL");
    stampResourceEarthHuge(49, 32, "RESOURCE_OIL");
    stampResourceEarthHuge(56, 32, "RESOURCE_OIL");
    stampResourceEarthHuge(62, 34, "RESOURCE_OIL");
    stampResourceEarthHuge(64, 33, "RESOURCE_OIL");
    stampResourceEarthHuge(53, 35, "RESOURCE_OIL");
    stampResourceEarthHuge(19, 48, "RESOURCE_OIL");
    stampResourceEarthHuge(54, 60, "RESOURCE_OIL");
    stampResourceEarthHuge(27, 55, "RESOURCE_OIL");
    stampResourceEarthHuge(14, 54, "RESOURCE_OIL");
    stampResourceEarthHuge(26, 52, "RESOURCE_OIL");
    stampResourceEarthHuge(18, 52, "RESOURCE_OIL");
    stampResourceEarthHuge(4, 60, "RESOURCE_OIL");
    stampResourceEarthHuge(64, 28, "RESOURCE_OIL");
    stampResourceEarthHuge(60, 29, "RESOURCE_OIL");
    stampResourceEarthHuge(62, 32, "RESOURCE_OIL");
    stampResourceEarthHuge(67, 36, "RESOURCE_OIL");
    stampResourceEarthHuge(62, 41, "RESOURCE_OIL");
    stampResourceEarthHuge(57, 34, "RESOURCE_OIL");
    stampResourceEarthHuge(51, 30, "RESOURCE_OIL");
    stampResourceEarthHuge(43, 30, "RESOURCE_OIL");
    stampResourceEarthHuge(45, 36, "RESOURCE_OIL");
    stampResourceEarthHuge(39, 31, "RESOURCE_OIL");
    stampResourceEarthHuge(61, 38, "RESOURCE_OIL");
    stampResourceEarthHuge(69, 63, "RESOURCE_OIL");
    stampResourceEarthHuge(11, 54, "RESOURCE_OIL");
    stampResourceEarthHuge(4, 62, "RESOURCE_OIL");
    stampResourceEarthHuge(91, 59, "RESOURCE_OIL");
    stampResourceEarthHuge(85, 57, "RESOURCE_OIL");
    stampResourceEarthHuge(81, 57, "RESOURCE_OIL");
    stampResourceEarthHuge(76, 46, "RESOURCE_OIL");
    stampResourceEarthHuge(36, 20, "RESOURCE_QUININE");
    stampResourceEarthHuge(31, 10, "RESOURCE_QUININE");
    stampResourceEarthHuge(30, 25, "RESOURCE_QUININE");
    stampResourceEarthHuge(25, 36, "RESOURCE_QUININE");
    stampResourceEarthHuge(21, 33, "RESOURCE_QUININE");
    stampResourceEarthHuge(31, 22, "RESOURCE_QUININE");
    stampResourceEarthHuge(47, 20, "RESOURCE_RUBBER");
    stampResourceEarthHuge(35, 18, "RESOURCE_RUBBER");
    stampResourceEarthHuge(29, 17, "RESOURCE_RUBBER");
    stampResourceEarthHuge(32, 20, "RESOURCE_RUBBER");
    stampResourceEarthHuge(48, 21, "RESOURCE_RUBBER");
    stampResourceEarthHuge(52, 20, "RESOURCE_RUBBER");
    stampResourceEarthHuge(51, 23, "RESOURCE_RUBBER");
    stampResourceEarthHuge(14, 33, "RESOURCE_RUBBER");
    stampResourceEarthHuge(96, 25, "RESOURCE_RUBBER");
    stampResourceEarthHuge(87, 27, "RESOURCE_RUBBER");
    stampResourceEarthHuge(86, 25, "RESOURCE_RUBBER");
    stampResourceEarthHuge(42, 23, "RESOURCE_RUBBER");
    stampResourceEarthHuge(46, 28, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(63, 26, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(71, 52, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(45, 50, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(49, 53, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(16, 45, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(15, 51, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(13, 50, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(65, 43, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(72, 33, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(73, 35, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(82, 40, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(14, 43, "RESOURCE_TOBACCO");
    stampResourceEarthHuge(67, 54, "RESOURCE_KAOLIN");
    stampResourceEarthHuge(79, 42, "RESOURCE_KAOLIN");
    stampResourceEarthHuge(56, 24, "RESOURCE_KAOLIN");
    stampResourceEarthHuge(48, 52, "RESOURCE_TRUFFLES");
    stampResourceEarthHuge(48, 29, "RESOURCE_NITER");
    stampResourceEarthHuge(54, 55, "RESOURCE_WINE");
    stampResourceEarthHuge(56, 51, "RESOURCE_WINE");
    stampResourceEarthHuge(59, 53, "RESOURCE_TEA");
    stampResourceEarthHuge(62, 35, "RESOURCE_LIMESTONE");
    stampResourceEarthHuge(58, 31, "RESOURCE_LIMESTONE");
    stampResourceEarthHuge(42, 34, "RESOURCE_LIMESTONE");
    stampResourceEarthHuge(26, 2, "RESOURCE_SILVER");
    stampResourceEarthHuge(64, 41, "RESOURCE_SILVER");
    stampResourceEarthHuge(49, 8, "RESOURCE_SILVER");
    stampResourceEarthHuge(100, 14, "RESOURCE_SILVER");
    stampResourceEarthHuge(47, 60, "RESOURCE_SILVER");
    stampResourceEarthHuge(86, 15, "RESOURCE_SILVER");
    stampResourceEarthHuge(42, 42, "RESOURCE_GOLD");
    stampResourceEarthHuge(96, 27, "RESOURCE_TIN");
    stampResourceEarthHuge(73, 52, "RESOURCE_TIN");
    stampResourceEarthHuge(85, 39, "RESOURCE_TIN");
    stampResourceEarthHuge(81, 45, "RESOURCE_TIN");
    stampResourceEarthHuge(66, 57, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(30, 56, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(74, 61, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(81, 62, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(85, 59, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(88, 62, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(93, 59, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(78, 62, "RESOURCE_HARDWOOD");
    stampResourceEarthHuge(98, 9, "RESOURCE_SILK");
    stampResourceEarthHuge(76, 42, "RESOURCE_SILK");
    stampResourceEarthHuge(31, 32, "RESOURCE_FISH");
    stampResourceEarthHuge(105, 35, "RESOURCE_FISH");
    stampResourceEarthHuge(14, 31, "RESOURCE_FISH");
    stampResourceEarthHuge(0, 18, "RESOURCE_FISH");
    stampResourceEarthHuge(96, 30, "RESOURCE_FISH");
    stampResourceEarthHuge(82, 29, "RESOURCE_FISH");
    stampResourceEarthHuge(102, 44, "RESOURCE_FISH");
    stampResourceEarthHuge(64, 13, "RESOURCE_FISH");
    stampResourceEarthHuge(12, 9, "RESOURCE_FISH");
    stampResourceEarthHuge(60, 41, "RESOURCE_FISH");
    stampResourceEarthHuge(59, 38, "RESOURCE_FISH");
    stampResourceEarthHuge(55, 39, "RESOURCE_FISH");
    stampResourceEarthHuge(56, 45, "RESOURCE_FISH");
    stampResourceEarthHuge(53, 40, "RESOURCE_FISH");
    stampResourceEarthHuge(52, 36, "RESOURCE_FISH");
    stampResourceEarthHuge(49, 38, "RESOURCE_FISH");
    stampResourceEarthHuge(46, 42, "RESOURCE_FISH");
    stampResourceEarthHuge(50, 39, "RESOURCE_FISH");
    stampResourceEarthHuge(41, 37, "RESOURCE_FISH");
    stampResourceEarthHuge(46, 18, "RESOURCE_FISH");
    stampResourceEarthHuge(47, 12, "RESOURCE_FISH");
    stampResourceEarthHuge(54, 3, "RESOURCE_FISH");
    stampResourceEarthHuge(62, 21, "RESOURCE_FISH");
    stampResourceEarthHuge(66, 33, "RESOURCE_FISH");
    stampResourceEarthHuge(62, 9, "RESOURCE_FISH");
    stampResourceEarthHuge(78, 32, "RESOURCE_FISH");
    stampResourceEarthHuge(84, 29, "RESOURCE_FISH");
    stampResourceEarthHuge(88, 30, "RESOURCE_FISH");
    stampResourceEarthHuge(85, 33, "RESOURCE_FISH");
    stampResourceEarthHuge(93, 33, "RESOURCE_FISH");
    stampResourceEarthHuge(93, 27, "RESOURCE_FISH");
    stampResourceEarthHuge(98, 26, "RESOURCE_FISH");
    stampResourceEarthHuge(105, 38, "RESOURCE_FISH");
    stampResourceEarthHuge(8, 13, "RESOURCE_FISH");
    stampResourceEarthHuge(24, 38, "RESOURCE_PEARLS");
    stampResourceEarthHuge(1, 29, "RESOURCE_PEARLS");
    stampResourceEarthHuge(102, 37, "RESOURCE_PEARLS");
    stampResourceEarthHuge(103, 24, "RESOURCE_PEARLS");
    stampResourceEarthHuge(92, 28, "RESOURCE_PEARLS");
    stampResourceEarthHuge(80, 24, "RESOURCE_PEARLS");
    stampResourceEarthHuge(76, 24, "RESOURCE_PEARLS");
    stampResourceEarthHuge(58, 8, "RESOURCE_PEARLS");
    xCoord = 87;
    yCoord = 15;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 79;
    yCoord = 35;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 96;
    yCoord = 62;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 20;
    yCoord = 35;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 2;
    yCoord = 31;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 6;
    yCoord = 14;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 99;
    yCoord = 21;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 91;
    yCoord = 23;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 98;
    yCoord = 40;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 62;
    yCoord = 14;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 59;
    yCoord = 43;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 9;
    yCoord = 41;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 51;
    yCoord = 63;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 89;
    yCoord = 13;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 75;
    yCoord = 46;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 91;
    yCoord = 52;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 83;
    yCoord = 47;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 92;
    yCoord = 51;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 8;
    yCoord = 57;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 89;
    yCoord = 8;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 96;
    yCoord = 8;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 101;
    yCoord = 13;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 88;
    yCoord = 39;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 98;
    yCoord = 44;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 91;
    yCoord = 60;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 87;
    yCoord = 59;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 84;
    yCoord = 63;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 81;
    yCoord = 59;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 75;
    yCoord = 63;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 77;
    yCoord = 58;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 69;
    yCoord = 60;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 59;
    yCoord = 63;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 53;
    yCoord = 62;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 44;
    yCoord = 56;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 29;
    yCoord = 52;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 22;
    yCoord = 53;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 16;
    yCoord = 56;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 13;
    yCoord = 60;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
    xCoord = 25;
    yCoord = 28;
    removeRuralDistrict(xCoord, yCoord);
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    placeRuralDistrict(xCoord, yCoord);
  }
}
function stampResourceEarthHuge(xCoord, yCoord, resourceToBePlaced) {
  let evaluatedTile = MapCities.getDistrict(xCoord, yCoord);
  if (evaluatedTile != null) {
    const district = Districts.get(evaluatedTile);
    if (district?.typeHash == DistrictTypes.RURAL) {
      removeRuralDistrict(xCoord, yCoord);
      ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
      ResourceBuilder.setResourceType(xCoord, yCoord, resourceToBePlaced);
      placeRuralDistrict(xCoord, yCoord);
      console.log("1Placed " + resourceToBePlaced + " at " + xCoord + ", " + yCoord + " (REPLACEMENT)");
    } else if (district?.typeHash == DistrictTypes.WILDERNESS) {
      ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
      ResourceBuilder.setResourceType(xCoord, yCoord, resourceToBePlaced);
      console.log("Placed " + resourceToBePlaced + " at " + xCoord + ", " + yCoord);
    } else {
      console.log("Failed to place " + resourceToBePlaced + "at" + xCoord + " " + yCoord + " due to DISTRICT: " + district?.typeName);
    }
  } else {
    ResourceBuilder.setResourceType(xCoord, yCoord, ResourceTypes.NO_RESOURCE);
    ResourceBuilder.setResourceType(xCoord, yCoord, resourceToBePlaced);
    console.log("Placed " + resourceToBePlaced + " at " + xCoord + ", " + yCoord);
  }
}
var DynamicCardTypes = /* @__PURE__ */ ((DynamicCardTypes2) => {
  DynamicCardTypes2[DynamicCardTypes2["None"] = 0] = "None";
  DynamicCardTypes2[DynamicCardTypes2["Capital"] = 1] = "Capital";
  DynamicCardTypes2[DynamicCardTypes2["City"] = 2] = "City";
  DynamicCardTypes2[DynamicCardTypes2["Commander"] = 3] = "Commander";
  DynamicCardTypes2[DynamicCardTypes2["Wonder"] = 4] = "Wonder";
  DynamicCardTypes2[DynamicCardTypes2["Gold"] = 5] = "Gold";
  DynamicCardTypes2[DynamicCardTypes2["DarkAge"] = 6] = "DarkAge";
  DynamicCardTypes2[DynamicCardTypes2["Victory"] = 7] = "Victory";
  DynamicCardTypes2[DynamicCardTypes2["Unit"] = 8] = "Unit";
  return DynamicCardTypes2;
})(DynamicCardTypes || {});
function regressCitiesToTowns(iPlayer) {
  const player = Players.get(iPlayer);
  const playerSettlements = player?.Cities?.getCityIds();
  const regressedCities = [];
  if (playerSettlements != null) {
    for (const ps of playerSettlements) {
      const settlement = Cities.get(ps);
      if (settlement != null) {
        if (!settlement.isCapital && !settlement.isTown) {
          regressedCities.push(ps);
          settlement.changeHasBuildQueue(-1);
        }
      }
    }
  }
  return regressedCities;
}
function positionUnits(iPlayer) {
  const player = Players.get(iPlayer);
  if (player != null) {
    const playerUnits = player?.Units;
    if (playerUnits != null) {
      let commanderIds = playerUnits.getUnitIds();
      if (commanderIds != null) {
        commanderIds = commanderIds.filter((unitId) => {
          return Units.get(unitId)?.isCommanderUnit;
        });
        const shadows = playerUnits.getUnitShadows();
        for (const shadow of shadows) {
          const unit = createUnitFromShadowAtLocation(player, shadow, shadow.location);
          if (unit != null && shadow.isInCommander) {
            console.log("In commander");
            for (const commanderId of commanderIds) {
              const army = Armies.get(commanderId);
              console.log(
                "Locations: " + army?.location.x + "," + army?.location.y + " " + shadow.location.x + "," + shadow.location.y + " " + (army != null) + " " + (army?.location == shadow.location)
              );
              if (army != null && army.location.x == shadow.location.x && army.location.y == shadow.location.y) {
                console.log("Packing");
                army.packUnit(unit);
              }
            }
          }
        }
      }
    }
  }
}
function positionArmyCommanders(iPlayer) {
  const LAND_DOMAIN_HASH = Database.makeHash("DOMAIN_LAND");
  const CORE_CLASS_MILITARY_HASH = Database.makeHash("CORE_CLASS_MILITARY");
  const numDefensiveUnits = getNumDefenders();
  const player = Players.get(iPlayer);
  if (player != null) {
    let playerSettlements = player?.Cities?.getCityIds();
    if (playerSettlements != null && playerSettlements.length > 0) {
      playerSettlements = playerSettlements.sort((a, b) => {
        const popA = Cities.get(a)?.population;
        const popB = Cities.get(b)?.population;
        if (popA == null) return 1;
        if (popB == null) return -1;
        return popB - popA;
      });
      const cityCount = playerSettlements.length;
      console.log("Cities available ", cityCount);
      const playerUnits = player?.Units;
      if (playerUnits != null) {
        let totalUnitsCreated = 0;
        let shadows = playerUnits.getUnitShadows();
        let unitIds = player?.Units?.getUnitIds();
        if (unitIds != null) {
          unitIds.forEach((unitID) => {
            const unit = Units.get(unitID);
            if (unit != null && unit.isArmyCommander) {
              console.log("Packing commander with previous units");
              const army = Armies.get(unit.armyId);
              const packedUnits = [];
              for (let i = 0; i < shadows.length; i++) {
                if (shadows[i].location.x == unit.location.x && shadows[i].location.y == unit.location.y && shadows[i].isInCommander) {
                  console.log("Found previous packed unit");
                  packedUnits.push(i);
                }
              }
              for (const pu of packedUnits) {
                const newUnitID = createUnitFromShadowAtLocation(player, shadows[pu], unit.location);
                totalUnitsCreated++;
                if (newUnitID != null) {
                  console.log("Packing unit");
                  army?.packUnit(newUnitID);
                }
              }
              while (packedUnits.length > 0) {
                const index = packedUnits.pop();
                if (index != null) {
                  playerUnits.removeUnitShadowAtIndex(index);
                }
              }
              shadows = playerUnits.getUnitShadows();
            }
          });
        }
        shadows = playerUnits.getUnitShadows();
        for (const s of shadows) {
          console.log(JSON.stringify(s));
        }
        let cityIndex = 0;
        for (let i = 0; i < numDefensiveUnits; i++) {
          const city = Cities.get(playerSettlements[cityIndex]);
          if (city != null) {
            const shadowIndex = playerUnits.getShadowIndexClosestToLocation(
              city.location,
              LAND_DOMAIN_HASH,
              CORE_CLASS_MILITARY_HASH
            );
            if (shadowIndex >= 0 && shadowIndex < shadows.length) {
              createUnitFromShadowAtLocation(player, shadows[shadowIndex], city.location);
              playerUnits.removeUnitShadowAtIndex(shadowIndex);
              shadows = playerUnits.getUnitShadows();
              totalUnitsCreated++;
            } else if (totalUnitsCreated < numDefensiveUnits) {
              console.log("Spawning free unit as defender");
              player.AdvancedStart?.createDefender(
                city.location,
                Database.makeHash("UNIT_CLASS_INFANTRY")
              );
              totalUnitsCreated++;
            }
          }
          cityIndex++;
          if (cityIndex >= cityCount) {
            cityIndex = 0;
          }
        }
        unitIds = player?.Units?.getUnitIds();
        if (unitIds != null) {
          unitIds = unitIds.filter((unitId) => {
            return Units.get(unitId)?.Experience?.canEarnExperience == true && Units.get(unitId)?.isArmyCommander;
          });
          unitIds = unitIds.sort((a, b) => {
            let expA = 0;
            let expB = 0;
            const expCompA = Units.get(a)?.Experience;
            if (expCompA != null) {
              expA = expCompA.experiencePoints;
            }
            const expCompB = Units.get(b)?.Experience;
            if (expCompB != null) {
              expB = expCompB.experiencePoints;
            }
            return expB - expA;
          });
          if (unitIds.length == 0) {
            const city = Cities.get(playerSettlements[0]);
            if (city != null) {
              const commanderType = player.Units?.getBuildUnit("UNIT_ARMY_COMMANDER");
              const result = Units.create(player.id, { Type: commanderType, Location: city.location });
              if (result.Success && result.ID) {
                unitIds.push(result.ID);
              }
            }
          }
          unitIds.forEach((unitID) => {
            const unit = Units.get(unitID);
            if (unit != null && playerSettlements != null) {
              console.log(Locale.compose(unit.name));
              if (unit.isArmyCommander) {
                const army = Armies.get(unit.armyId);
                const prevArmyLocation = unit.location;
                const city = player.Cities?.findClosest(unit.location);
                if (city != null && army != null) {
                  Units.setLocation(unitID, city.location);
                  unit.setProperty("PROPERTY_CHECK_COMMANDER", true);
                  unit.setProperty("PROPERTY_KEEP_COMMANDER", true);
                  const capacityRemaining = army.combatUnitCapacity - army.unitCount;
                  for (let i = 0; i < capacityRemaining && shadows.length > 0; i++) {
                    const shadowIndex = playerUnits.getShadowIndexClosestToLocation(
                      prevArmyLocation,
                      LAND_DOMAIN_HASH,
                      CORE_CLASS_MILITARY_HASH
                    );
                    if (shadowIndex >= 0 && shadowIndex < shadows.length) {
                      const newUnitID = createUnitFromShadowAtLocation(
                        player,
                        shadows[shadowIndex],
                        city.location
                      );
                      playerUnits.removeUnitShadowAtIndex(shadowIndex);
                      shadows = playerUnits.getUnitShadows();
                      totalUnitsCreated++;
                      if (newUnitID != null) {
                        army.packUnit(newUnitID);
                      }
                    }
                  }
                }
              }
            }
          });
        }
      }
    }
  }
}
function positionFleetCommanders(iPlayer) {
  const SEA_DOMAIN_HASH = Database.makeHash("DOMAIN_SEA");
  const CORE_CLASS_MILITARY_HASH = Database.makeHash("CORE_CLASS_MILITARY");
  const player = Players.get(iPlayer);
  if (player != null) {
    let unitIds = player?.Units?.getUnitIds();
    if (unitIds != null) {
      unitIds = unitIds.filter((unitId) => {
        return Units.get(unitId)?.Experience?.canEarnExperience == true && Units.get(unitId)?.isFleetCommander;
      });
      unitIds = unitIds.sort((a, b) => {
        let expA = 0;
        let expB = 0;
        const expCompA = Units.get(a)?.Experience;
        if (expCompA != null) {
          expA = expCompA.experiencePoints;
        }
        const expCompB = Units.get(b)?.Experience;
        if (expCompB != null) {
          expB = expCompB.experiencePoints;
        }
        return expB - expA;
      });
      const playerUnits = player?.Units;
      if (playerUnits != null) {
        let shadows = playerUnits.getUnitShadows();
        unitIds.forEach((unitID) => {
          const unit = Units.get(unitID);
          if (unit != null) {
            console.log(Locale.compose(unit.name));
            if (unit.isFleetCommander) {
              const army = Armies.get(unit.armyId);
              const locationIndex = Game.PlacementRules.getValidOceanNavalLocation(iPlayer);
              console.log("Location Index: " + locationIndex);
              if (army != null && locationIndex != -1) {
                const location = GameplayMap.getLocationFromIndex(locationIndex);
                const prevArmyLocation = unit.location;
                Units.setLocation(unitID, location);
                console.log("Location: " + JSON.stringify(location));
                unit.setProperty("PROPERTY_CHECK_COMMANDER", true);
                unit.setProperty("PROPERTY_KEEP_COMMANDER", true);
                for (let i = 0; i < army.combatUnitCapacity && shadows.length > 0; i++) {
                  const shadowIndex = playerUnits.getShadowIndexClosestToLocation(
                    prevArmyLocation,
                    SEA_DOMAIN_HASH,
                    CORE_CLASS_MILITARY_HASH
                  );
                  if (shadowIndex >= 0 && shadowIndex < shadows.length) {
                    const newUnitID = createUnitFromShadowAtLocation(
                      player,
                      shadows[shadowIndex],
                      prevArmyLocation
                    );
                    playerUnits.removeUnitShadowAtIndex(shadowIndex);
                    shadows = playerUnits.getUnitShadows();
                    if (newUnitID != null) {
                      army.packUnit(newUnitID);
                    }
                  } else {
                    console.log("Shadow index outside of valid range");
                  }
                }
              }
            }
          }
        });
        shadows = playerUnits.getUnitShadows();
        for (const constructible of player.Constructibles?.getConstructibles() || []) {
          if (constructible.typeHash == Database.makeHash("BUILDING_HARBOR")) {
            const shadowIndex = playerUnits.getShadowIndexClosestToLocation(
              constructible.location,
              SEA_DOMAIN_HASH,
              CORE_CLASS_MILITARY_HASH
            );
            if (shadowIndex >= 0 && shadowIndex < shadows.length) {
              createUnitFromShadowAtLocation(player, shadows[shadowIndex], constructible.location);
              playerUnits.removeUnitShadowAtIndex(shadowIndex);
              shadows = playerUnits.getUnitShadows();
            } else {
              break;
            }
          }
        }
      }
    }
  }
}
function createUnitFromShadowAtLocation(player, shadow, location) {
  for (const shadowOption of GameInfo.Unit_ShadowReplacements) {
    if (Database.makeHash(shadowOption.Domain) == shadow.domainHash && Database.makeHash(shadowOption.CoreClass) == shadow.coreClassHash && Database.makeHash(shadowOption.Tag) == shadow.tagHash) {
      const buildUnit = player.Units?.getBuildUnit(shadowOption.UnitType);
      if (buildUnit != null) {
        const result = Units.create(player.id, { Type: buildUnit, Location: location, Validate: true });
        if (result.Success && result.ID) {
          if (g_continuityMode && shadow.activityType != UnitActivityTypes.NONE) {
            Units.setActivity(result.ID, shadow.activityType);
          }
          return result.ID;
        }
      }
    }
  }
  return null;
}
function getNumDefenders() {
  const definition = GameInfo.Ages.lookup(Game.age);
  if (definition != null) {
    return definition.NumDefenders;
  }
  return 0;
}
function capGold(iPlayer) {
  const player = Players.get(iPlayer);
  let defaultGold = Game.EconomicRules.adjustForGameSpeed(3e3);
  if (g_continuityMode) {
    if (Game.age == Database.makeHash("AGE_EXPLORATION")) {
      defaultGold = Game.EconomicRules.adjustForGameSpeed(6e3);
    } else if (Game.age == Database.makeHash("AGE_MODERN")) {
      defaultGold = Game.EconomicRules.adjustForGameSpeed(9e3);
    }
  }
  console.log("Default gold: " + defaultGold);
  const currentGold = player?.Treasury?.goldBalance;
  if (currentGold != null) {
    if (currentGold > defaultGold) {
      player?.Treasury?.changeGoldBalance(defaultGold - currentGold, -1);
    }
  }
}
function capInfluence(iPlayer) {
  const player = Players.get(iPlayer);
  let defaultInfluence = Game.EconomicRules.adjustForGameSpeed(500);
  if (g_continuityMode) {
    if (Game.age == Database.makeHash("AGE_EXPLORATION")) {
      defaultInfluence = Game.EconomicRules.adjustForGameSpeed(800);
    } else if (Game.age == Database.makeHash("AGE_MODERN")) {
      defaultInfluence = Game.EconomicRules.adjustForGameSpeed(1200);
    }
  }
  console.log("Default influence: " + defaultInfluence);
  const currentInfluence = player?.DiplomacyTreasury?.diplomacyBalance;
  if (currentInfluence != null) {
    if (currentInfluence > defaultInfluence) {
      player?.DiplomacyTreasury?.changeDiplomacyBalance(defaultInfluence - currentInfluence);
    }
  }
}
function generateDarkAgeCards(iPlayer) {
  if (Game.age == Database.makeHash("AGE_EXPLORATION")) {
    const card = {
      id: "CARD_AT_EXP_DARK_AGE_MILITARY",
      name: "LOC_LEGACY_PATH_ANTIQUITY_MILITARY_DARK_AGE_NAME",
      description: "LOC_LEGACY_PATH_ANTIQUITY_MILITARY_DARK_AGE_DESCRIPTION",
      tooltip: "",
      iconOverride: "agecard_dark.png",
      limitID: "",
      individualLimit: 1,
      unlock: "UNLOCK_DARK_AGE_MILITARISTIC_1",
      categorySortOrder: 100,
      cost: [{ category: CardCategories.CARD_CATEGORY_DARK_AGE, value: 1 }],
      effects: [
        {
          id: "CARD_AT_EXP_DARK_AGE_ARMY",
          type: "CARD_ADD_ARMY_CAVALRY_PLUS_SIEGE",
          name: "",
          description: "",
          amount: 3,
          special: 0,
          metadata: {
            Type: 6 /* DarkAge */
          }
        },
        {
          id: "CARD_AT_EXP_DARK_AGE_LOSE_ALL_BUT_CAPITAL",
          type: "",
          name: "",
          description: "",
          amount: 1,
          special: 0,
          metadata: {
            Type: 6 /* DarkAge */
          }
        }
      ],
      aiModifierLists: ["Dark Age Armies Pseudoyields"]
    };
    Players.AdvancedStart.get(iPlayer)?.addDynamicAvailableCard(card);
  }
}
function generateRetainCityCards(iPlayer, aSettlements) {
  const player = Players.get(iPlayer);
  if (player != null) {
    if (aSettlements.length > 0) {
      const card = {
        id: "CARD_AT_EXP_GOLDEN_AGE_ECONOMIC",
        name: "LOC_UNLOCK_AQ_DEFAULT_5_NAME",
        description: "LOC_UNLOCK_AQ_DEFAULT_5_DESCRIPTION",
        tooltip: "",
        iconOverride: "agecard_victory.png",
        limitID: "",
        individualLimit: 1,
        goldenAgeReward: false,
        categorySortOrder: 60,
        unlock: "",
        cost: [{ category: CardCategories.CARD_CATEGORY_WILDCARD, value: 1 }],
        effects: [],
        aiModifierLists: []
      };
      for (let i = 0; i < aSettlements.length; i++) {
        card.effects.push({
          id: "CARD_AT_EXP_GOLDEN_AGE_ECONOMIC_" + i,
          type: "CARD_AT_EXP_GOLDEN_AGE_ECONOMIC",
          name: "",
          description: "",
          amount: 1,
          special: 0,
          metadata: {
            Type: 2 /* City */,
            SettlementId: aSettlements[i].id
          }
        });
      }
      Players.AdvancedStart.get(iPlayer)?.addDynamicAvailableCard(card);
    }
  }
}
function generateDynamicVictoryCards(iPlayer) {
  const player = Players.get(iPlayer);
  if (player != null) {
    if (Game.age == Database.makeHash("AGE_EXPLORATION")) {
      let yield_multiplier = 5;
      const numberOfroutes = player.getProperty("PROPERTY_ANTIQUITY_TRADE_ROUTE_TOTAL");
      let totalYield = numberOfroutes * yield_multiplier;
      if (totalYield > 0) {
        const card = {
          id: "CARD_AT_EXP_VICTORY_ECONOMIC_SECOND",
          name: "LOC_LEGACY_PATH_ANTIQUITY_ECONOMIC_MILESTONE_2_NAME\\",
          description: "LOC_LEGACY_PATH_ANTIQUITY_ECONOMIC_MILESTONE_2_DESCRIPTION_DYNAMIC\\5\\" + totalYield,
          tooltip: "",
          iconOverride: "agecard_victory.png",
          limitID: "",
          individualLimit: 1,
          categorySortOrder: 20,
          unlock: "UNLOCK_AT_LEAST_SECOND_ECONOMIC_VICTORY_1",
          cost: [{ category: CardCategories.CARD_CATEGORY_ECONOMIC, value: 2 }],
          effects: [
            {
              id: "CARD_AT_EXP_VICTORY_ECONOMIC_SECOND",
              type: "CARD_AT_EXP_VICTORY_ECONOMIC_SECOND",
              name: "",
              description: "",
              amount: 1,
              special: 0,
              metadata: {
                Type: 7 /* Victory */,
                Amount: totalYield
              }
            }
          ],
          aiModifierLists: []
        };
        Players.AdvancedStart.get(iPlayer)?.addDynamicAvailableCard(card);
      }
      yield_multiplier = 1;
      const numberOfGreatWorks = player.getProperty("PROPERTY_PREVIOUS_AGE_GREAT_WORK_TOTAL");
      totalYield = numberOfGreatWorks * yield_multiplier;
      if (totalYield > 0) {
        const card = {
          id: "CARD_AT_EXP_VICTORY_SCIENTIFIC_SECOND",
          name: "LOC_LEGACY_PATH_ANTIQUITY_SCIENCE_MILESTONE_2_NAME\\",
          description: "LOC_LEGACY_PATH_ANTIQUITY_SCIENCE_MILESTONE_2_DESCRIPTION_DYNAMIC\\1\\" + totalYield,
          tooltip: "",
          iconOverride: "agecard_victory.png",
          limitID: "",
          individualLimit: 1,
          unlock: "UNLOCK_AT_LEAST_SECOND_SCIENTIFIC_VICTORY_1",
          categorySortOrder: 20,
          cost: [{ category: CardCategories.CARD_CATEGORY_SCIENTIFIC, value: 2 }],
          effects: [
            {
              id: "CARD_AT_EXP_VICTORY_SCIENTIFIC_SECOND",
              type: "CARD_AT_EXP_VICTORY_SCIENTIFIC_SECOND",
              name: "",
              description: "",
              amount: 1,
              special: 0,
              metadata: {
                Type: 7 /* Victory */,
                Amount: totalYield
              }
            }
          ],
          aiModifierLists: []
        };
        Players.AdvancedStart.get(iPlayer)?.addDynamicAvailableCard(card);
      }
      {
        const card = {
          id: "CARD_AT_EXP_VICTORY_MILITARISTIC_UNITS",
          name: "LOC_LEGACY_PATH_ANTIQUITY_MILITARY_GOLDEN_AGE_NAME",
          description: "",
          tooltip: "",
          iconOverride: "agecard_victory.png",
          limitID: "CARD_AT_EXP_VICTORY_CULTURE_GOLDEN_AGE",
          individualLimit: 1,
          goldenAgeReward: true,
          unlock: "UNLOCK_WON_MILITARISTIC_VICTORY_1",
          categorySortOrder: 10,
          cost: [{ category: CardCategories.CARD_CATEGORY_MILITARISTIC, value: 2 }],
          effects: [],
          aiModifierLists: []
        };
        let totalUnits = 0;
        const playerCities = player.Cities?.getCities();
        if (playerCities) {
          for (const city of playerCities) {
            if (city.getProperty(Database.makeHash("PROPERTY_WAS_CONQUERED"))) {
              console.log("Was conquered: " + city.name);
              card.effects.push({
                id: "CARD_EFFECT_AT_EXP_VICTORY_MILITARISTIC_UNITS" + totalUnits,
                type: "CARD_AT_EXP_VICTORY_MILITARISTIC_UNITS",
                name: "",
                description: "",
                amount: 1,
                special: 0,
                metadata: {
                  Type: 8 /* Unit */,
                  SettlementId: city.id.id
                }
              });
              totalUnits++;
            }
          }
        }
        card.description = "LOC_LEGACY_PATH_ANTIQUITY_MILITARY_GOLDEN_AGE_DESCRIPTION_DYNAMIC\\" + totalUnits;
        Players.AdvancedStart.get(iPlayer)?.addDynamicAvailableCard(card);
      }
    } else if (Game.age == Database.makeHash("AGE_MODERN")) {
      const yield_multiplier = 2;
      const numberOfGreatWorks = player.getProperty("PROPERTY_PREVIOUS_AGE_GREAT_WORK_TOTAL");
      const totalYield = numberOfGreatWorks * yield_multiplier;
      if (totalYield > 0) {
        const card = {
          id: "CARD_AT_MOD_VICTORY_CULTURAL_SECOND",
          name: "LOC_LEGACY_PATH_EXPLORATION_CULTURE_MILESTONE_2_NAME\\",
          description: "LOC_LEGACY_PATH_EXPLORATION_CULTURE_MILESTONE_2_DESCRIPTION_DYNAMIC\\2\\" + totalYield,
          tooltip: "",
          iconOverride: "agecard_victory.png",
          limitID: "",
          individualLimit: 1,
          unlock: "UNLOCK_AT_LEAST_SECOND_CULTURAL_VICTORY_2",
          categorySortOrder: 20,
          cost: [{ category: CardCategories.CARD_CATEGORY_CULTURAL, value: 2 }],
          effects: [
            {
              id: "CARD_AT_MOD_VICTORY_CULTURAL_SECOND",
              type: "CARD_AT_MOD_VICTORY_CULTURAL_SECOND",
              name: "",
              description: "",
              amount: 1,
              special: 0,
              metadata: {
                Type: 7 /* Victory */,
                Amount: totalYield
              }
            }
          ],
          aiModifierLists: []
        };
        Players.AdvancedStart.get(iPlayer)?.addDynamicAvailableCard(card);
      }
    }
  }
}
engine.on("RequestAgeInitializationParameters", requestInitializationParameters);
engine.on("GenerateAgeTransition", generateTransition);
console.log("Loaded age-transition-post-load.ts");
//# sourceMappingURL=age-transition-post-load.js.map
