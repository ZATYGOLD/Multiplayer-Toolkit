import { createSignal, createContext, useContext } from '../../../../core/vendor/solid-js/dist/solid.js';
import { createMutable } from '../../../../core/vendor/solid-js/store/dist/store.js';
import { ContextManager } from '../../../../core/ui/context-manager/context-manager.js';
import { getQuestTracker } from '../../../ui/quest-tracker/quest-tracker.js';
import { getLegacyCardStyling } from './legacies-support.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui-next/screens/legacies/legacies-model.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)

var TriumphFilterOptions = /* @__PURE__ */ ((TriumphFilterOptions2) => {
  TriumphFilterOptions2["DEFAULT"] = "DEFAULT";
  TriumphFilterOptions2["CULTURAL"] = "CULTURAL";
  TriumphFilterOptions2["DIPLOMATIC"] = "DIPLOMATIC";
  TriumphFilterOptions2["ECONOMIC"] = "ECONOMIC";
  TriumphFilterOptions2["EXPANSIONIST"] = "EXPANSIONIST";
  TriumphFilterOptions2["MILITARISTIC"] = "MILITARISTIC";
  TriumphFilterOptions2["SCIENTIFIC"] = "SCIENTIFIC";
  TriumphFilterOptions2["CRISIS"] = "CRISIS";
  TriumphFilterOptions2["IN_PROGRESS"] = "IN_PROGRESS";
  TriumphFilterOptions2["COMPLETE"] = "COMPLETE";
  TriumphFilterOptions2["INCOMPLETE"] = "INCOMPLETE";
  TriumphFilterOptions2["FIRST_ONLY"] = "FIRST_ONLY";
  TriumphFilterOptions2["TRACKED"] = "TRACKED";
  TriumphFilterOptions2["UNTRACKED"] = "UNTRACKED";
  return TriumphFilterOptions2;
})(TriumphFilterOptions || {});
var CivFilterOptions = /* @__PURE__ */ ((CivFilterOptions2) => {
  CivFilterOptions2["ALL_ATTRIBUTES"] = "LOC_LEGACIES_FILTER_ALL_ATTRIBUTES";
  CivFilterOptions2["CULTURAL"] = "LOC_TAG_TRAIT_CULTURAL_NAME";
  CivFilterOptions2["ECONOMIC"] = "LOC_TAG_TRAIT_ECONOMIC_NAME";
  CivFilterOptions2["SCIENTIFIC"] = "LOC_TAG_TRAIT_EXPANSIONIST_NAME";
  CivFilterOptions2["MILITARISTIC"] = "LOC_TAG_TRAIT_MILITARISTIC_NAME";
  CivFilterOptions2["EXPANSIONIST"] = "LOC_TAG_TRAIT_POLITICAL_NAME";
  CivFilterOptions2["DIPLOMATIC"] = "LOC_TAG_TRAIT_SCIENTIFIC_NAME";
  CivFilterOptions2["WILDCARD"] = "LOC_TAG_TRAIT_WILDCARD_NAME";
  return CivFilterOptions2;
})(CivFilterOptions || {});
function createTriumphData(triumphDef) {
  const playerLegacies = Players.get(mptLocalPlayerID())?.Legacies;
  const questTracker = getQuestTracker();
  if (!playerLegacies) {
    console.error("legacies-model: Unable to get legacies object for local player while creating the legacy car");
    return {
      triumphName: "",
      isTriggered: false,
      lockedReason: "",
      progressString: "",
      triumphRequirements: triumphDef.TriggerDescription,
      triumphDescription: triumphDef.Description,
      isFirstOnly: false,
      traitIcon: "",
      bgColor: "",
      descriptionBG: "",
      isComingSoon: false,
      triumphType: triumphDef.LegacyType,
      isTracked: questTracker.has(triumphDef.LegacyType, "triumph"),
      isMajor: triumphDef.MajorLegacy,
      filterOptions: [],
      progressGoal: 0,
      currentProgress: 0
    };
  }
  let lockedReason;
  for (const id of Players.getWasEverAliveMajorIds()) {
    if (id == mptLocalPlayerID()) {
      break;
    }
    const player = Players.get(Players.getWasEverAliveMajorIds()[id]);
    if (triumphDef.FirstPlayerOnly && player?.Legacies?.isTriggered(triumphDef.LegacyType)) {
      lockedReason = Locale.compose("LOC_LEGACIES_ALREADY_EARNED_BY", player.name);
      break;
    }
  }
  const filterOptions = [];
  const triumphProgress = playerLegacies.getProgress(triumphDef.LegacyType);
  const isTriggered = playerLegacies.isTriggered(triumphDef.LegacyType) ?? false;
  let progressString = void 0;
  let currentProgress = void 0;
  let progressGoal = void 0;
  if (triumphProgress) {
    progressString = triumphProgress.progress[0].current + "/" + triumphProgress.progress[0].total;
    currentProgress = triumphProgress.progress[0].current;
    progressGoal = triumphProgress.progress[0].total;
    if (triumphProgress.progress[0].current > 0 && !isTriggered) {
      filterOptions.push("IN_PROGRESS" /* IN_PROGRESS */);
    }
  }
  if (isTriggered) {
    filterOptions.push("COMPLETE" /* COMPLETE */);
  } else {
    if (!(triumphProgress?.raceWinner != mptLocalPlayerID() && triumphProgress?.raceWinner != -1)) {
      filterOptions.push("INCOMPLETE" /* INCOMPLETE */);
    }
  }
  if (triumphDef.FirstPlayerOnly) {
    filterOptions.push("FIRST_ONLY" /* FIRST_ONLY */);
  }
  const { tagType, traitIcon, bgColor, comingSoon, descriptionBG } = getLegacyCardStyling(triumphDef.LegacyType);
  filterOptions.push(tagType);
  filterOptions.push("DEFAULT" /* DEFAULT */);
  const legacyData = {
    triumphName: Locale.compose(triumphDef.Name),
    isTriggered,
    lockedReason,
    progressString: progressString ?? "",
    currentProgress: currentProgress ?? 0,
    progressGoal: progressGoal ?? 0,
    triumphRequirements: triumphDef.TriggerDescription,
    triumphDescription: triumphDef.Description,
    isFirstOnly: triumphDef.FirstPlayerOnly && triumphProgress?.raceWinner != mptLocalPlayerID() && triumphProgress?.raceWinner != -1,
    traitIcon,
    bgColor,
    descriptionBG,
    isComingSoon: comingSoon,
    triumphType: triumphDef.LegacyType,
    isTracked: questTracker.has(triumphDef.LegacyType, "triumph"),
    isMajor: triumphDef.MajorLegacy,
    filterOptions
  };
  if (progressGoal && progressGoal <= 10) {
    const progressPips = [];
    for (let i = 1; i <= progressGoal; i++) {
      progressPips.push(i);
    }
    legacyData.progressPips = progressPips;
  }
  if (triumphProgress && triumphProgress?.raceWinner != -1) {
    const localPlayerDiplomacy = Players.get(mptLocalPlayerID())?.Diplomacy;
    const playerName = localPlayerDiplomacy?.hasMet(triumphProgress?.raceWinner) ? Players.get(triumphProgress?.raceWinner)?.name : Locale.compose("LOC_UI_UNMET_PLAYER_NAME");
    if (playerName) {
      legacyData.raceWinnerName = playerName;
    }
  }
  return legacyData;
}
function populateTriumphData() {
  let allTriumphData = [];
  const majorTriumphsSection = {
    titleText: "LOC_LEGACIES_MAJOR_TRIUMPHS",
    triumphs: []
  };
  const minorTriumphsSection = {
    titleText: "LOC_LEGACIES_MINOR_TRIUMPHS",
    triumphs: []
  };
  const playerLegacies = Players.get(mptLocalPlayerID())?.Legacies;
  if (!playerLegacies) {
    return allTriumphData;
  }
  GameInfo.Legacies.forEach((triumph) => {
    if (!playerLegacies.isValidLegacy(triumph.LegacyType)) {
      return;
    }
    const triumphData = createTriumphData(triumph);
    if (triumph.MajorLegacy) {
      majorTriumphsSection.triumphs.push(triumphData);
    } else {
      minorTriumphsSection.triumphs.push(triumphData);
    }
  });
  allTriumphData = [majorTriumphsSection, minorTriumphsSection];
  return allTriumphData;
}
function createLegaciesScreenModel() {
  const [selectedTriumphFilter, setSelectedTriumphFilter] = createSignal(
    "DEFAULT" /* DEFAULT */
  );
  function handleClickClose() {
    ContextManager.pop("screen-legacies");
  }
  let bgSrc = "";
  let playerColor = "";
  const localPlayer = Players.get(mptLocalPlayerID());
  if (localPlayer != null) {
    const civDefinition = GameInfo.Civilizations.lookup(localPlayer.civilizationType);
    if (civDefinition) {
      const civInfo = GameInfo.LoadingInfo_Civilizations.lookup(civDefinition?.CivilizationType);
      const civImagePath = window.innerWidth >= 1080 ? civInfo?.BackgroundImageHigh : civInfo?.BackgroundImageLow;
      const civImage = civImagePath ? `url(${civImagePath})` : "";
      bgSrc = civImage;
    }
    const bgColor = UI.Color.getPlayerColors(mptLocalPlayerID());
    if (bgColor) {
      const variants = UI.Color.createPlayerColorVariants(bgColor);
      playerColor = variants.primaryColor.tintColor;
    }
  }
  const [isShowingDetails, setIsShowingDetails] = createSignal(false);
  const model = createMutable({
    triumphSections: populateTriumphData(),
    onClickClose: handleClickClose,
    selectedTriumphFilter,
    setSelectedTriumphFilter,
    playerColor,
    bgSrc,
    isShowingDetails,
    setIsShowingDetails
  });
  return model;
}
const LegaciesScreenContext = createContext();
function useLegaciesScreenContext() {
  const context = useContext(LegaciesScreenContext);
  if (!context) {
    throw new Error("Unable to get legacies screen context!");
  }
  return context;
}

export { CivFilterOptions, LegaciesScreenContext, TriumphFilterOptions, createLegaciesScreenModel, createTriumphData, useLegaciesScreenContext };
//# sourceMappingURL=legacies-model.js.map
