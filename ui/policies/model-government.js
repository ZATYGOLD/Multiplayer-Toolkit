import { createSignal, createContext, useContext } from '../../../core/vendor/solid-js/dist/solid.js';
import { createMutable } from '../../../core/vendor/solid-js/store/dist/store.js';
import { utils } from '../../../core/ui/graph-layout/utils.js';
import { getModifierTextByContext } from '../../../core/ui/utilities/utilities-core-textprovider.js';
import { ModelRegistry, ModelLifecycle } from '../../../core/ui-next/services/model-registry.js';
import { isMobile } from '../../../core/ui-next/services/view-experience.js';

/*
 * Zatygold's Observer Mode - base-game override.
 * Copied verbatim from the game's base-standard/ui/policies/model-government.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)

const [activePolicyTab, setActivePolicyTab] = createSignal("gov-overview");
function createGovtScreenModel() {
  let bgSrc = "";
  let govName = "";
  let govDescription = "";
  let happPer = "";
  let crisisProgressText = "";
  let crisisProgressBarWidth = "";
  let happinessRingMeter = 0;
  let celebrationTurnsLeftNumber = "";
  let celebrationTurnsLeftDesc = "";
  let govAbility = "";
  let happinessNeeded = 0;
  let happinessNextThreshold = 0;
  let govtChosen = false;
  const traditionsUnlocked = [];
  const celebrationChoices = [];
  const crisisEventMarkers = [
    {
      progressLabelStr: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_BEGINS",
      progressLabelStrRange: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_BEGINS_RANGE",
      eventName: "LOC_UI_POLICIES_CRISIS_BEGINS",
      timelinePlacement: Game.CrisisManager.getCrisisStageTriggerPercent(0, 0) / 100
    },
    {
      progressLabelStr: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_INTENSIFIES",
      progressLabelStrRange: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_INTENSIFIES_RANGE",
      eventName: "LOC_UI_POLICIES_CRISIS_INTENSIFIES",
      timelinePlacement: Game.CrisisManager.getCrisisStageTriggerPercent(0, 1) / 100
    },
    {
      progressLabelStr: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_CULMINATES",
      progressLabelStrRange: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_CULMINATES_RANGE",
      eventName: "LOC_UI_POLICIES_CRISIS_CULMINATES",
      timelinePlacement: Game.CrisisManager.getCrisisStageTriggerPercent(0, 2) / 100
    },
    {
      progressLabelStr: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_ENDS",
      progressLabelStrRange: "LOC_UI_POLICIES_TURNS_UNTIL_CRISIS_ENDS_RANGE",
      eventName: "LOC_UI_POLICIES_CRISIS_ENDS",
      timelinePlacement: Game.CrisisManager.getCrisisStageTriggerPercent(0, 3) / 100
    }
  ];
  const localPlayer = Players.get(mptLocalPlayerID());
  if (localPlayer != null) {
    const civDefinition = GameInfo.Civilizations.lookup(localPlayer.civilizationType);
    if (civDefinition) {
      const civInfo = GameInfo.LoadingInfo_Civilizations.lookup(civDefinition?.CivilizationType);
      const civImagePath = window.innerWidth >= 1080 ? civInfo?.BackgroundImageHigh : civInfo?.BackgroundImageLow;
      const civImage = civImagePath ? `url(${civImagePath})` : "";
      bgSrc = civImage;
    }
  }
  const localPlayerHappiness = localPlayer?.Happiness;
  if (localPlayerHappiness === void 0) {
    console.error("model-government: Local player happiness is undefined!");
  }
  const localPlayerStats = localPlayer?.Stats;
  if (localPlayerStats === void 0) {
    console.error("model-government: Local player stats is undefined!");
  }
  const localPlayerCulture = localPlayer?.Culture;
  if (!localPlayerCulture) {
    console.error("model-government:No player culture!");
  }
  const localPlayerGovernmentType = localPlayerCulture.getGovernmentType() ?? null;
  if (localPlayerGovernmentType) {
    if (localPlayerGovernmentType == -1) {
      govtChosen = false;
    } else {
      govtChosen = true;
    }
    const governmentDef = GameInfo.Governments.lookup(localPlayerGovernmentType);
    if (governmentDef) {
      const govModifiers = GameInfo.GovernmentModifiers.filter(
        (m) => m.GovernmentType === governmentDef.GovernmentType
      );
      for (const govMod of govModifiers) {
        const text = getModifierTextByContext(govMod.ModifierId, "Description");
        if (text) {
          govAbility = text;
          break;
        }
      }
    }
    const currentGovernment = GameInfo.Governments.lookup(localPlayerGovernmentType);
    govName = currentGovernment?.Name ?? "";
    govDescription = currentGovernment?.Description ?? "";
  }
  const choices = localPlayerCulture?.getGoldenAgeChoices() ?? "";
  let currentlyInCelebration = false;
  if (localPlayerStats) {
    if (localPlayerHappiness) {
      currentlyInCelebration = localPlayerHappiness.isInGoldenAge();
      const happinessPerTurn = localPlayerStats?.getNetYield(YieldTypes.YIELD_HAPPINESS) ?? -1;
      happPer = Locale.stylize(
        "LOC_UI_POLICIES_HAPPINESS_PER_TURN",
        `${happinessPerTurn >= 0 ? "+" : "-"}${Math.round(happinessPerTurn)}`
      );
      for (const choice of choices) {
        const celebrationItemDef = GameInfo.GoldenAges.lookup(choice);
        if (!celebrationItemDef) {
          console.error(
            `screen-policies: buildOverviewWindow() - No golden age definition found for ${choice}!`
          );
        }
        const description = Locale.stylize(
          celebrationItemDef?.Description ?? "",
          localPlayerHappiness.getGoldenAgeDuration()
        );
        if (celebrationItemDef) {
          const item = {
            image: `url("${UI.getIconURL(celebrationItemDef.GoldenAgeType)}")`,
            description
          };
          celebrationChoices.push(item);
        }
      }
      celebrationTurnsLeftDesc = localPlayerHappiness.isInGoldenAge() ? "LOC_UI_CURRENT_CELEBRATION" : "LOC_UI_NEXT_CELEBRATION";
      happinessNeeded = Math.ceil(localPlayerStats.getLifetimeYield(YieldTypes.YIELD_HAPPINESS)) ?? -1;
      happinessNextThreshold = localPlayerHappiness.nextGoldenAgeThreshold;
      if (localPlayerHappiness.isInGoldenAge()) {
        celebrationTurnsLeftNumber = Locale.compose(
          "LOC_UI_X_TURNS_LEFT",
          localPlayerHappiness.getGoldenAgeTurnsLeft()
        );
        happinessRingMeter = localPlayerHappiness.getGoldenAgeTurnsLeft() / localPlayerHappiness.getGoldenAgeDuration() * 100;
      } else {
        const happinessPerTurn2 = localPlayerStats.getNetYield(YieldTypes.YIELD_HAPPINESS) ?? -1;
        const turnsToNextCelebration = Math.max(
          Math.ceil((happinessNextThreshold - happinessNeeded) / happinessPerTurn2),
          1
        );
        celebrationTurnsLeftNumber = Locale.compose("LOC_UI_X_TURNS_LEFT", turnsToNextCelebration);
        happinessRingMeter = 100 * happinessNeeded / happinessNextThreshold;
      }
    }
  }
  const lookupGov = GameInfo.Governments.lookup(localPlayerGovernmentType)?.GovernmentType;
  const govTypeString = lookupGov ?? "";
  let unlockNode = [];
  const govtNodes = GameInfo.ProgressionTreeNodeUnlocks.filter(
    (o) => o.RequiredGovernmentType == govTypeString
  );
  if (govtNodes) {
    if (govtNodes.length > 0) {
      for (const govtTraditions in govtNodes) {
        const tradition = GameInfo.Traditions.lookup(govtNodes[govtTraditions].TargetType);
        if (tradition) {
          unlockNode = govtNodes.filter((item) => item.TargetType == govtNodes[govtTraditions].TargetType);
          const nodeObject = GameInfo.ProgressionTreeNodes.lookup(unlockNode[0].ProgressionTreeNodeType);
          const unlockNodeName = nodeObject ? nodeObject.Name : "";
          const traditionDisplayItem = {
            def: tradition,
            unlock: `{LOC_LOADING_TRADITION_UNLOCKED_WITH} [B]{${unlockNodeName}}[/B]`
          };
          traditionsUnlocked.push(traditionDisplayItem);
        }
      }
    }
  }
  const crisisStage = Game.CrisisManager.getCurrentCrisisStage(0);
  const nextCrisisStage = Math.max(0, crisisStage + 1);
  let showCrisisText = false;
  if (Game.CrisisManager.isCrisisEnabled(0) && nextCrisisStage < crisisEventMarkers.length) {
    const { progressLabelStr, progressLabelStrRange } = crisisEventMarkers[nextCrisisStage];
    const minTurns = Game.CrisisManager.getMinimumTurnsRemainingInCurrentCrisis(0, crisisStage);
    const maxTurns = Game.CrisisManager.getMaximumTurnsRemainingInCurrentCrisis(0, crisisStage);
    if (minTurns != -1) {
      if (minTurns < 1) {
        crisisProgressText = Locale.stylize(progressLabelStr, maxTurns);
        showCrisisText = true;
      } else if (maxTurns < minTurns) {
        crisisProgressText = Locale.stylize(progressLabelStr, minTurns);
        showCrisisText = true;
      } else {
        crisisProgressText = Locale.stylize(progressLabelStrRange, minTurns, maxTurns);
        showCrisisText = true;
      }
    }
  }
  const currentAgeProgression = Game.AgeProgressManager.getCurrentAgeProgressionPoints();
  const maxAgeProgression = Game.AgeProgressManager.getMaxAgeProgressionPoints();
  const ageProgressionPercent = currentAgeProgression / maxAgeProgression;
  crisisProgressBarWidth = `${utils.clamp(ageProgressionPercent * 100, 0, 100)}%`;
  for (const crisis of crisisEventMarkers) {
    if (ageProgressionPercent < crisis.timelinePlacement) break;
  }
  function showCrisisTab() {
    if (Game.CrisisManager.getCrisisStageTriggerPercent(0, 1) == -1 || Game.age == Database.makeHash("AGE_MODERN")) {
      return false;
    } else {
      return true;
    }
  }
  function getHappinessRangeString(stage) {
    let happinessRange = "";
    const min = stage.StageMinThreshold ?? -Infinity;
    const max = stage.StageMaxThreshold ?? Infinity;
    if (min == -Infinity) {
      happinessRange = Locale.stylize("LOC_UI_CITY_DETAILS_HAPPINESS_STAGE_DETAIL_NO_MIN", max);
    } else if (max == Infinity) {
      happinessRange = Locale.stylize("LOC_UI_CITY_DETAILS_HAPPINESS_STAGE_DETAIL_NO_MAX", min);
    } else {
      happinessRange = Locale.stylize("LOC_UI_CITY_DETAILS_HAPPINESS_STAGE_DETAIL", min, max);
    }
    return happinessRange;
  }
  function getSettlementHappiness() {
    const happinessStages = [];
    GameInfo.HappinessStages.forEach((row) => {
      happinessStages.push({
        stage: row.HappinessStageType,
        stageName: row.HappinessStageType.replace("HAPPINESS_STAGE_", "LOC_UI_CITY_DETAILS_"),
        icon: row.HappinessStageType.replace("HAPPINESS_STAGE_", "YIELD_"),
        textColor: row.HappinessStageType.replace("HAPPINESS_STAGE_", "").toLowerCase() + "-text",
        min: row.StageMinThreshold ?? -Infinity,
        max: row.StageMaxThreshold ?? Infinity,
        settlements: 0,
        happinessRange: getHappinessRangeString(row)
      });
    });
    const localPlayer2 = Players.get(mptLocalPlayerID());
    localPlayer2?.Cities?.getCities().forEach((city) => {
      const cityHappiness = city.Happiness?.netHappinessPerTurn;
      if (cityHappiness) {
        for (const stage of happinessStages) {
          if (cityHappiness >= stage.min && cityHappiness <= stage.max) {
            stage.settlements++;
          }
        }
      }
    });
    return happinessStages;
  }
  function populateData() {
    const ornatePanelData = {
      topIconSrc: "url(blp:fi_celebration_128)",
      topIconTint: "",
      topIconBackgroundTint: "#dba33d",
      backgroundImageSrc: bgSrc,
      name: "Government Screen",
      id: "policies-screen",
      isFullscreen: isMobile(),
      hideTopIcon: isMobile(),
      useNoMarginFrame: isMobile()
    };
    const govtScreenData = {
      ornatePanelData,
      governmentDescription: govDescription,
      governmentName: govName,
      happinessPerTurn: happPer,
      celebrationBonusItems: celebrationChoices,
      crisisProgress: crisisProgressText,
      showCrisisText,
      crisisBarWdith: crisisProgressBarWidth,
      crisisEventMarkers,
      celebrationTurnsLeftDesc,
      celebrationTurnsLeft: celebrationTurnsLeftNumber,
      happinessRing: happinessRingMeter,
      governmentAbilityDescription: govAbility,
      hasGovtBeenChosen: govtChosen,
      happinessNeeded,
      happinessNextCelebrationThreshold: happinessNextThreshold,
      govtTraditions: traditionsUnlocked,
      inCelebration: currentlyInCelebration,
      settlementHappiness: getSettlementHappiness,
      displayCrisisTab: showCrisisTab
    };
    return govtScreenData;
  }
  const model = createMutable({
    data: populateData()
  });
  return model;
}
const GovtScreenModel = ModelRegistry.register(
  "GovtScreenModel",
  ModelLifecycle.SharedInstance,
  createGovtScreenModel
);
const GovtScreenModelContext = createContext();
function usePoliciesModelContext() {
  const context = useContext(GovtScreenModelContext);
  if (!context) {
    throw new Error("useGovtModelContext: Cannot find context!");
  }
  return context;
}

export { GovtScreenModel, GovtScreenModelContext, activePolicyTab, createGovtScreenModel, setActivePolicyTab, usePoliciesModelContext };
//# sourceMappingURL=model-government.js.map
