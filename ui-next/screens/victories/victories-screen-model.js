import { createSignal, onMount, createEffect, untrack, createContext, useContext } from '../../../../core/vendor/solid-js/dist/solid.js';
import { createMutable } from '../../../../core/vendor/solid-js/store/dist/store.js';
import { ContextManager } from '../../../../core/ui/context-manager/context-manager.js';
import { utils } from '../../../../core/ui/graph-layout/utils.js';
import NavTray from '../../../../core/ui/navigation-tray/model-navigation-tray.js';
import { ObjectToRgbaString } from '../../../../core/ui/utilities/utilities-color.js';
import { ComponentID } from '../../../../core/ui/utilities/utilities-component-id.js';
import { Layout } from '../../../../core/ui/utilities/utilities-layout.js';
import { getPlayerCardInfo } from '../../../../core/ui/utilities/utilities-liveops.js';
import { IsTouchActive } from '../../../../core/ui-next/services/input.js';
import { ModelRegistry, ModelLifecycle } from '../../../../core/ui-next/services/model-registry.js';
import { isMobile } from '../../../../core/ui-next/services/view-experience.js';
import { createEngineEvent } from '../../../../core/ui-next/utilities/game-core-utilities.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui-next/screens/victories/
 * victories-screen-model.js (build dated 2026-09-16). The only changes are
 * marked "MPT:": Observer players (LEADER_MPT_OBSERVER) are left out of every
 * player list on the Victories screens, and an Observer sees every leader's
 * real name instead of "An unmet Player". Re-apply after game updates.
 */
const MPT_OBSERVER_LEADER = 'LEADER_MPT_OBSERVER';
function mptIsObserver(playerId) {
  try {
    const p = Players.get(playerId);
    return !!p && GameInfo.Leaders.lookup(p.leaderType)?.LeaderType === MPT_OBSERVER_LEADER;
  } catch (e) { return false; }
}
/** An Observer has "met" everyone; otherwise the normal diplomacy check. */
function mptHasMet(diplomacy, playerId) {
  if (mptIsObserver(GameContext.localPlayerID)) return true;
  return diplomacy.hasMet(playerId);
}

var VictoryTabType = /* @__PURE__ */ ((VictoryTabType2) => {
  VictoryTabType2[VictoryTabType2["Military"] = 0] = "Military";
  VictoryTabType2[VictoryTabType2["Cultural"] = 1] = "Cultural";
  VictoryTabType2[VictoryTabType2["Economic"] = 2] = "Economic";
  VictoryTabType2[VictoryTabType2["Scientific"] = 3] = "Scientific";
  VictoryTabType2[VictoryTabType2["Score"] = 4] = "Score";
  return VictoryTabType2;
})(VictoryTabType || {});
var LaunchpadStatus = /* @__PURE__ */ ((LaunchpadStatus2) => {
  LaunchpadStatus2[LaunchpadStatus2["unset"] = 0] = "unset";
  LaunchpadStatus2[LaunchpadStatus2["PreModern"] = 1] = "PreModern";
  LaunchpadStatus2[LaunchpadStatus2["NeedRocketry"] = 2] = "NeedRocketry";
  LaunchpadStatus2[LaunchpadStatus2["NotBuilt"] = 3] = "NotBuilt";
  LaunchpadStatus2[LaunchpadStatus2["Built"] = 4] = "Built";
  LaunchpadStatus2[LaunchpadStatus2["InUse"] = 5] = "InUse";
  LaunchpadStatus2[LaunchpadStatus2["Damaged"] = 6] = "Damaged";
  return LaunchpadStatus2;
})(LaunchpadStatus || {});
const primaryColors = [
  { r: 0, g: 158, b: 115, a: 1 },
  // light green
  { r: 220, g: 205, b: 125, a: 1 },
  // yellow
  { r: 126, g: 41, b: 84, a: 1 },
  // darker pink
  { r: 91, g: 143, b: 237, a: 1 },
  // cyan
  { r: 213, g: 94, b: 0, a: 1 },
  // dark orange
  { r: 204, g: 121, b: 167, a: 1 },
  // pink
  { r: 51, g: 117, b: 56, a: 1 },
  // medium green
  { r: 170, g: 51, b: 119, a: 1 },
  // magenta
  { r: 0, g: 114, b: 178, a: 1 },
  // blue-green
  { r: 230, g: 159, b: 0, a: 1 },
  // orange
  { r: 180, g: 180, b: 180, a: 1 }
  // light grey
];
const playerColors = calcPlayerColors();
function calcPlayerColors() {
  const colorMap = /* @__PURE__ */ new Map();
  const colorChoices = [];
  for (const color of primaryColors) {
    colorChoices.push(color);
  }
  Players.getAlive().forEach((player) => {
    if (player && player.isMajor) {
      const ourPrimary = UI.Player.getPrimaryColorValue(player.id);
      let minDistance = 999999;
      let winningColor = { r: 255, g: 255, b: 255, a: 255 };
      let lastWinner = -1;
      for (let i = 0; i < colorChoices.length; i++) {
        const indColor = colorChoices[i];
        const distance = UI.Color.calculateColorDistance(ourPrimary, indColor);
        if (distance < minDistance) {
          minDistance = distance;
          winningColor = indColor;
          lastWinner = i;
        }
      }
      if (lastWinner != -1) {
        colorChoices.splice(lastWinner, 1);
      }
      const dim_r = Math.round(winningColor.r * 0.25);
      const dim_g = Math.round(winningColor.g * 0.25);
      const dim_b = Math.round(winningColor.b * 0.25);
      colorMap.set(player.id, {
        primary: winningColor,
        dim: { r: dim_r, g: dim_g, b: dim_b, a: winningColor.a }
      });
    }
  });
  return colorMap;
}
function createVictoriesScreenModel(isEndGame, allowOneMoreTurn, showNextTurnButton) {
  const playerUiStateById = /* @__PURE__ */ new Map();
  const persistentUiState = {
    lastFocusedPlayer: PlayerIds.NO_PLAYER,
    lastInspectedPlayer: PlayerIds.NO_PLAYER,
    isInspecting: false
  };
  const [currentTab, setCurrentTab] = createSignal("");
  function getOrCreatePlayerRowState(playerId) {
    let state = playerUiStateById.get(playerId);
    if (!state) {
      const [highlighted, setHighlighted] = createSignal(false);
      const [focused, setFocused] = createSignal(false);
      const [dimScore, setDimScore] = createSignal(false);
      state = {
        isHighlighted: highlighted,
        setIsHighlighted: setHighlighted,
        isFocused: focused,
        setIsFocused: setFocused,
        shouldDimScore: dimScore,
        setShouldDimScore: setDimScore
      };
      playerUiStateById.set(playerId, state);
    }
    return state;
  }
  function syncPersistentUiStateToData(data) {
    data.lastFocusedPlayer = persistentUiState.lastFocusedPlayer;
    data.lastInspectedPlayer = persistentUiState.lastInspectedPlayer;
    data.isInspecting = persistentUiState.isInspecting;
  }
  function setLastFocusedPlayer(playerId) {
    persistentUiState.lastFocusedPlayer = playerId;
    model.data.lastFocusedPlayer = playerId;
  }
  function setLastInspectedPlayer(playerId) {
    persistentUiState.lastInspectedPlayer = playerId;
    model.data.lastInspectedPlayer = playerId;
  }
  function setIsInspecting(isInspecting) {
    persistentUiState.isInspecting = isInspecting;
    model.data.isInspecting = isInspecting;
  }
  function clearAllPlayerPresentationState() {
    playerUiStateById.forEach((state) => {
      state.setIsHighlighted(false);
      state.setIsFocused(false);
      state.setShouldDimScore(false);
    });
  }
  function getTabTypeFromId(tabId) {
    switch (tabId) {
      case "military":
        return 0 /* Military */;
      case "cultural":
        return 1 /* Cultural */;
      case "economic":
        return 2 /* Economic */;
      case "scientific":
        return 3 /* Scientific */;
      case "score":
        return 4 /* Score */;
    }
  }
  function applyHighlightPlayer(playerId, tabType) {
    switch (tabType) {
      case 2 /* Economic */:
        model.data.economicDetails.playerDetails.forEach((player) => {
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setHighlighted(true);
            player.playerInfo.setDimScore(false);
          } else {
            player.playerInfo.setDimScore(true);
          }
        });
        highlightEconPlayer(playerId);
        break;
      case 0 /* Military */:
        model.data.militaryDetails.playerDetails.forEach((player) => {
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setHighlighted(true);
            player.playerInfo.setDimScore(false);
          } else {
            player.playerInfo.setDimScore(true);
          }
        });
        break;
      case 3 /* Scientific */:
        model.data.scienceDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(true);
        break;
      case 1 /* Cultural */:
        model.data.cultureDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(true);
        break;
      case 4 /* Score */:
        model.data.scoreDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(true);
        model.data.scoreDetails.playerDetails.find((player) => player.playerInfo.playerId != playerId)?.playerInfo.setHighlighted(false);
        break;
    }
  }
  function applyUnHighlightPlayer(playerId, tabType) {
    switch (tabType) {
      case 2 /* Economic */:
        model.data.economicDetails.playerDetails.forEach((player) => {
          player.playerInfo.setDimScore(false);
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setHighlighted(false);
          }
        });
        highlightAllEconPlayers();
        break;
      case 0 /* Military */:
        model.data.militaryDetails.playerDetails.forEach((player) => {
          player.playerInfo.setDimScore(false);
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setHighlighted(false);
          }
        });
        break;
      case 3 /* Scientific */:
        model.data.scienceDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(false);
        break;
      case 1 /* Cultural */:
        model.data.cultureDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(false);
        break;
      case 4 /* Score */:
        model.data.scoreDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(false);
        break;
    }
  }
  function applyFocusPlayer(playerId, tabType) {
    switch (tabType) {
      case 2 /* Economic */:
        model.data.economicDetails.playerDetails.forEach((player) => {
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setDimScore(false);
            player.playerInfo.setFocused(true);
          } else {
            player.playerInfo.setDimScore(true);
            player.playerInfo.setFocused(false);
          }
        });
        break;
      case 0 /* Military */:
        model.data.militaryDetails.playerDetails.forEach((player) => {
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setDimScore(false);
            player.playerInfo.setFocused(true);
          } else {
            player.playerInfo.setDimScore(true);
            player.playerInfo.setFocused(false);
          }
        });
        break;
      case 1 /* Cultural */:
        model.data.cultureDetails.playerDetails.forEach((player) => {
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setDimScore(false);
            player.playerInfo.setHighlighted(true);
          } else {
            player.playerInfo.setDimScore(true);
            player.playerInfo.setHighlighted(false);
            player.playerInfo.setFocused(false);
          }
        });
        break;
      case 3 /* Scientific */:
        model.data.scienceDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(true);
        break;
      case 4 /* Score */:
        applyHighlightPlayer(playerId, tabType);
        break;
    }
  }
  function applyUnFocusPlayer(playerId, tabType) {
    switch (tabType) {
      case 2 /* Economic */:
        model.data.economicDetails.playerDetails.forEach((player) => {
          player.playerInfo.setDimScore(false);
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setFocused(false);
          }
        });
        break;
      case 0 /* Military */:
        model.data.militaryDetails.playerDetails.forEach((player) => {
          player.playerInfo.setDimScore(false);
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setFocused(false);
          }
        });
        break;
      case 1 /* Cultural */:
        model.data.cultureDetails.playerDetails.forEach((player) => {
          player.playerInfo.setDimScore(false);
          if (player.playerInfo.playerId == playerId) {
            player.playerInfo.setHighlighted(false);
          }
        });
        break;
      case 3 /* Scientific */:
        model.data.scienceDetails.playerDetails.find((player) => player.playerInfo.playerId == playerId)?.playerInfo.setHighlighted(false);
        break;
      case 4 /* Score */:
        applyUnHighlightPlayer(playerId, tabType);
        break;
    }
  }
  function reapplyTrackedUiState() {
    clearAllPlayerPresentationState();
    const tabType = getTabTypeFromId(model.data.currentTab());
    if (tabType == void 0) {
      return;
    }
    if (persistentUiState.lastFocusedPlayer != PlayerIds.NO_PLAYER) {
      applyFocusPlayer(persistentUiState.lastFocusedPlayer, tabType);
    }
    if (persistentUiState.isInspecting && persistentUiState.lastInspectedPlayer != PlayerIds.NO_PLAYER) {
      applyHighlightPlayer(persistentUiState.lastInspectedPlayer, tabType);
    } else if (tabType == 2 /* Economic */) {
      highlightAllEconPlayers();
    }
    syncPersistentUiStateToData(model.data);
  }
  onMount(() => {
    const victoryDominanceChanged = createEngineEvent("VictoryDominanceChanged");
    const victoryCountdownChanged = createEngineEvent("VictoryCountdownChanged");
    const victoryPointsChanged = createEngineEvent("VictoryPointsChanged");
    createEffect(() => {
      if (victoryDominanceChanged() || victoryCountdownChanged() || victoryPointsChanged()) {
        untrack(() => {
          model.data = populateData();
          reapplyTrackedUiState();
        });
      }
    });
    createEffect(() => {
      const chart = model.data.economicDetails.ageCharts.get(
        model.data.economicDetails.ageOptions.selectedValue()
      );
      if (chart) {
        untrack(() => {
          model.data.economicDetails.currentChart = chart;
          if (model.data.currentTab() == "economic") {
            reapplyTrackedUiState();
          }
        });
      } else {
        console.error(
          `victories-screen-model: Could not find chart for age ${model.data.economicDetails.ageOptions.selectedValue()}`
        );
      }
    });
  });
  function handleClickClose() {
    NavTray.clear();
    ContextManager.pop("screen-victory-progress");
  }
  function handleUnFocusAllPlayers(tabId) {
    let lastTab = 4 /* Score */;
    switch (tabId) {
      case "military":
        lastTab = 0 /* Military */;
        break;
      case "cultural":
        lastTab = 1 /* Cultural */;
        break;
      case "economic":
        lastTab = 2 /* Economic */;
        break;
      case "scientific":
        lastTab = 3 /* Scientific */;
        break;
    }
    if (lastTab != 4 /* Score */) {
      model.focusPlayer(PlayerIds.NO_PLAYER, lastTab);
    }
  }
  function handleTabNavStartup(hotkeyContext) {
    if (model.data.isEndGame) {
      hotkeyContext.unregisterNavtray("cancel");
      if (model.data.showNextTurnButton) {
        hotkeyContext.registerNavtray("nav-shell-next", "LOC_NEXT_TURN");
      } else {
        hotkeyContext.registerNavtray("nav-shell-next", "LOC_END_GAME_EXIT");
      }
      if (model.data.allowOneMoreTurn) {
        hotkeyContext.registerNavtray("nav-shell-previous", "LOC_END_GAME_CONTINUE");
      }
    }
  }
  function handleTabNavShutdown(hotkeyContext) {
    if (model.data.isEndGame) {
      hotkeyContext.unregisterNavtray("nav-shell-next");
      if (model.data.allowOneMoreTurn) {
        hotkeyContext.unregisterNavtray("nav-shell-previous");
      }
    }
  }
  function handleTabChanged(tabId) {
    if (tabId == model.data.currentTab()) {
      return false;
    }
    model.tooltipToggle = false;
    setLastFocusedPlayer(PlayerIds.NO_PLAYER);
    setLastInspectedPlayer(PlayerIds.NO_PLAYER);
    setIsInspecting(false);
    model.data.setCurrentTab(tabId);
    handleUnFocusAllPlayers(tabId);
    return true;
  }
  function handleGamepadInfoButton() {
    model.tooltipToggle = !model.tooltipToggle;
  }
  function handleGamepadInspectButton() {
    if (model.data.lastFocusedPlayer != PlayerIds.NO_PLAYER) {
      switch (model.data.currentTab()) {
        case "military":
          if (!model.data.isInspecting) {
            handleHighlightPlayer(model.data.lastFocusedPlayer, 0 /* Military */);
          } else {
            handleUnHighlightPlayer(model.data.lastFocusedPlayer, 0 /* Military */);
            handleFocusPlayer(model.data.lastFocusedPlayer, 0 /* Military */);
          }
          break;
        case "economic":
          if (!model.data.isInspecting) {
            handleHighlightPlayer(model.data.lastFocusedPlayer, 2 /* Economic */);
          } else {
            handleUnHighlightPlayer(model.data.lastFocusedPlayer, 2 /* Economic */);
            highlightAllEconPlayers();
            handleFocusPlayer(model.data.lastFocusedPlayer, 2 /* Economic */);
          }
          break;
        case "cultural":
          if (IsTouchActive()) {
            if (!model.data.isInspecting) {
              handleHighlightPlayer(model.data.lastFocusedPlayer, 1 /* Cultural */);
            } else {
              handleUnHighlightPlayer(model.data.lastFocusedPlayer, 1 /* Cultural */);
              handleUnFocusPlayer(model.data.lastFocusedPlayer, 1 /* Cultural */);
            }
          }
          break;
        case "scientific":
          if (IsTouchActive()) {
            if (!model.data.isInspecting) {
              handleHighlightPlayer(model.data.lastFocusedPlayer, 3 /* Scientific */);
            } else {
              handleUnHighlightPlayer(model.data.lastFocusedPlayer, 3 /* Scientific */);
              handleUnFocusPlayer(model.data.lastFocusedPlayer, 3 /* Scientific */);
            }
          }
          break;
        case "score":
          if (IsTouchActive()) {
            if (!model.data.isInspecting) {
              handleHighlightPlayer(model.data.lastFocusedPlayer, 4 /* Score */);
            } else {
              handleUnHighlightPlayer(model.data.lastFocusedPlayer, 4 /* Score */);
              handleUnFocusPlayer(model.data.lastFocusedPlayer, 4 /* Score */);
            }
          }
          break;
      }
      if (model.data.isInspecting) {
        setIsInspecting(false);
      } else {
        setIsInspecting(true);
      }
      setLastInspectedPlayer(model.data.lastFocusedPlayer);
    } else if (model.data.currentTab() == "summary") {
      if (model.data.isInspecting) {
        setIsInspecting(false);
      } else {
        setIsInspecting(true);
      }
      setLastFocusedPlayer(PlayerIds.NO_PLAYER);
    }
  }
  function handleHighlightPlayer(playerId, tabType) {
    applyHighlightPlayer(playerId, tabType);
  }
  function handleUnHighlightPlayer(playerId, tabType) {
    applyUnHighlightPlayer(playerId, tabType);
  }
  function handleFocusPlayer(playerId, tabType) {
    if (playerId == model.data.lastFocusedPlayer) {
      return;
    }
    setLastFocusedPlayer(playerId);
    if (model.data.isInspecting && model.data.lastInspectedPlayer != playerId) {
      setIsInspecting(false);
      handleUnHighlightPlayer(model.data.lastInspectedPlayer, 2 /* Economic */);
      handleUnHighlightPlayer(model.data.lastInspectedPlayer, 0 /* Military */);
      setLastInspectedPlayer(PlayerIds.NO_PLAYER);
    }
    applyFocusPlayer(playerId, tabType);
  }
  function handleUnFocusPlayer(playerId, tabType) {
    setLastFocusedPlayer(PlayerIds.NO_PLAYER);
    applyUnFocusPlayer(playerId, tabType);
  }
  function getPlayerList() {
    const PlayerList = Players.getAlive().filter((player) => !mptIsObserver(player.id));   // MPT: no observers
    if (!mptIsObserver(GameContext.localPlayerID) && !PlayerList.find((player) => player.id == GameContext.localPlayerID)) {
      const localPlayer = Players.get(GameContext.localPlayerID);
      if (localPlayer) {
        PlayerList.push(localPlayer);
      }
    }
    return PlayerList;
  }
  function populateData() {
    const ornatePanelData = {
      topIconSrc: Game.AgeProgressManager.isExtendedGame || Game.AgeProgressManager.getMaxAgeProgressionPoints() <= 0 ? "url(blp:hud_omt_infinity)" : "url(blp:sub_agetimer)",
      backgroundImageSrc: "",
      name: "Victories-Screen",
      id: "victories-screen",
      isFullscreen: isMobile()
    };
    const localPlayer = Players.get(GameContext.localPlayerID);
    if (localPlayer != null) {
      const civDefinition = GameInfo.Civilizations.lookup(localPlayer.civilizationType);
      if (civDefinition) {
        const civInfo = GameInfo.LoadingInfo_Civilizations.lookup(civDefinition?.CivilizationType);
        const civImagePath = window.innerWidth >= 1280 ? civInfo?.BackgroundImageHigh : civInfo?.BackgroundImageLow;
        const civImage = civImagePath ? `url(${civImagePath})` : "";
        ornatePanelData.backgroundImageSrc = civImage;
        const playerColor = UI.Color.getPlayerColors(GameContext.localPlayerID);
        if (playerColor) {
          const variants = UI.Color.createPlayerColorVariants(playerColor);
          ornatePanelData.topIconBackgroundTint = variants.primaryColor.tintColor;
        }
      }
    }
    const panelList = [];
    let militaryDetails = {};
    let economicDetails = {};
    let scienceDetails = {};
    let cultureDetails = {};
    let scoreDetails = {};
    const sortedVictories = [...GameInfo.VictoryTypes].sort(
      (a, b) => a.VictoryType.localeCompare(b.VictoryType)
    );
    sortedVictories.forEach((victory) => {
      const victoryDefinition = GameInfo.Victories.find((a) => a.VictoryType == victory.VictoryType);
      if (victoryDefinition) {
        const goals = {
          class: "",
          rules: "",
          titleText: "",
          titleColor: "",
          pointGoal: Game.VictoryManager.getCountdownVictoryDominanceScore(victory.$hash),
          goalPercent: 0,
          // obviously wrong default
          leaderBoard: calcVictoryLeaderboard(victory.$hash, victory.CountdownDuration),
          noDomination: victory.ScoringType !== "COUNTDOWN_VICTORY_SCORING_TYPE_DOMINATION",
          tooltipInfo: calcTooltipForVictory(
            victoryDefinition.VictoryType,
            victoryDefinition.VictoryClassType
          ),
          hasFocus: false
        };
        if (goals.leaderBoard.length >= 2) {
          goals.goalPercent = utils.clamp(
            goals.pointGoal / (goals.leaderBoard[1]?.points || 0) * 100,
            0,
            100
          );
        }
        const ageName = GameInfo.Ages.lookup(Game.age)?.AgeType;
        if (ageName && ageName === "AGE_ANTIQUITY" && victoryDefinition.VictoryClassType === "VICTORY_CLASS_SCIENCE") {
          goals.pointGoal = -1;
        }
        const victoryProps = {
          victoryType: victory.$hash,
          victoryClass: victoryDefinition.VictoryClassType,
          victoryLogo: "",
          titleText: victory.Name,
          titleColor: "",
          description: victory.Description,
          goals,
          divider: true,
          summaryBg: "",
          background: "",
          rules: "",
          dominantPlayer: calcDominantPlayer(victory.$hash, victory.CountdownDuration),
          tabId: "",
          visible: Game.VictoryManager.isCountdownVictoryEnabled(victory.VictoryType),
          hasFocus: false
        };
        const includeUnmetPlayers = victoryDefinition.VictoryClassType === "VICTORY_CLASS_SCIENCE";
        const spreadsheet = calcSpreadsheetsForVictory(
          victory.$hash,
          victoryDefinition.VictoryClassType,
          includeUnmetPlayers
        );
        switch (victoryDefinition.VictoryClassType) {
          case "VICTORY_CLASS_MILITARY":
            victoryProps.victoryLogo = "img-emblem-military";
            victoryProps.titleColor = "victories-color-militaristic";
            victoryProps.summaryBg = "victories-summary-military";
            victoryProps.background = "blp:bg_victory_military";
            victoryProps.rules = "LOC_VICTORIES_RULES_MILITARY";
            victoryProps.tabId = "military";
            militaryDetails = calcMilitaryDetails(victory.$hash);
            break;
          case "VICTORY_CLASS_CULTURE":
            victoryProps.victoryLogo = "img-emblem-cultural";
            victoryProps.titleColor = "victories-color-cultural";
            victoryProps.summaryBg = "victories-summary-cultural";
            victoryProps.background = "blp:bg_victory_culture";
            victoryProps.rules = "LOC_VICTORIES_RULES_CULTURE";
            victoryProps.tabId = "cultural";
            cultureDetails = calcCultureDetails(victory.$hash, victory.CountdownDuration);
            break;
          case "VICTORY_CLASS_ECONOMIC":
            victoryProps.victoryLogo = "img-emblem-economic";
            victoryProps.titleColor = "victories-color-economic";
            victoryProps.summaryBg = "victories-summary-economic";
            victoryProps.background = "blp:bg_victory_economic";
            victoryProps.rules = "LOC_VICTORIES_RULES_ECONOMIC";
            victoryProps.tabId = "economic";
            economicDetails = calcEconomicDetails(victory.$hash, spreadsheet);
            break;
          case "VICTORY_CLASS_SCIENCE":
            victoryProps.victoryLogo = "img-emblem-scientific";
            victoryProps.titleColor = "victories-color-scientific";
            victoryProps.summaryBg = "victories-summary-scientific";
            victoryProps.background = "blp:bg_victory_scientific2";
            victoryProps.rules = "LOC_VICTORIES_RULES_SCIENTIFIC";
            victoryProps.divider = false;
            victoryProps.tabId = "scientific";
            scienceDetails = calcScienceDetails(victory.$hash, victory.CountdownDuration, spreadsheet);
            break;
          case "VICTORY_CLASS_SCORE":
            scoreDetails = calcScoreDetails(victory.$hash);
            victoryProps.visible = false;
            break;
          default:
            victoryProps.visible = false;
            break;
        }
        panelList.push(victoryProps);
      } else {
        console.error(
          `victories-screen-model: Unable to find victory definition for victory ${victory.VictoryType}`
        );
      }
    });
    const fallbackTab = "summary";
    const preservedTab = currentTab();
    const hasPreservedTab = preservedTab == "summary" || panelList.some((panel) => panel.tabId == preservedTab && panel.visible);
    const defaultTab = hasPreservedTab ? preservedTab : fallbackTab;
    if (currentTab() != defaultTab) {
      setCurrentTab(defaultTab);
    }
    const victoriesScreenData = {
      ornatePanelData,
      panels: panelList,
      militaryDetails,
      economicDetails,
      scienceDetails,
      cultureDetails,
      scoreDetails,
      defaultTab,
      currentTab,
      setCurrentTab,
      lastFocusedPlayer: persistentUiState.lastFocusedPlayer,
      lastInspectedPlayer: persistentUiState.lastInspectedPlayer,
      isInspecting: persistentUiState.isInspecting,
      isEndGame,
      allowOneMoreTurn,
      showNextTurnButton
    };
    return victoriesScreenData;
  }
  function calcDominantPlayer(victoryType, countdownDuration) {
    const PlayerList = Players.getAlive();
    const playerList = [];
    PlayerList.forEach((player) => {
      if (player && player.Victories) {
        const countdown = player.Victories.getVictoryCountdownStatus(victoryType);
        if (countdown && countdown.isDominant) {
          const dominantPlayer = {
            name: player.leaderName,
            id: player.id,
            turns: utils.clamp(countdownDuration - countdown.turns, 0, countdownDuration),
            percent: utils.clamp(countdown.turns / countdownDuration * 100, 0, 100)
          };
          playerList.push(dominantPlayer);
        }
      }
    });
    return playerList;
  }
  function calcTooltipForVictory(victoryTypeString, victoryClassString) {
    const tooltipInfo = {};
    tooltipInfo.descTitle = "LOC_VICTORY_TOOLTIP_REQUIRED_POINTS";
    switch (victoryClassString) {
      case "VICTORY_CLASS_MILITARY":
        tooltipInfo.description = "LOC_VICTORY_MILITARY_LONGFORM";
        break;
      case "VICTORY_CLASS_CULTURE":
        tooltipInfo.description = "LOC_VICTORY_CULTURAL_LONGFORM";
        break;
      case "VICTORY_CLASS_ECONOMIC":
        tooltipInfo.description = "LOC_VICTORY_ECONOMIC_LONGFORM";
        break;
      case "VICTORY_CLASS_SCIENCE":
        tooltipInfo.description = "LOC_VICTORY_SCIENTIFIC_LONGFORM";
        break;
    }
    const maxPoints = Game.AgeProgressManager.getMaxAgeProgressionPoints();
    const curPoints = Game.AgeProgressManager.getCurrentAgeProgressionPoints();
    const ageProgress = curPoints / maxPoints * 100;
    const ageName = GameInfo.Ages.lookup(Configuration.getGame().campaignStartAgeType)?.AgeType;
    tooltipInfo.currentVictoryPercent = -1;
    tooltipInfo.nextVictoryPercent = -1;
    const dominationPercentages = [];
    GameInfo.VictoryDominationPercents.forEach((victoryDom) => {
      if (victoryDom.VictoryType == victoryTypeString && victoryDom.StartingAge == ageName && victoryDom.PreviousAgeCount == Configuration.getGame().previousAgeCount) {
        dominationPercentages.push(victoryDom);
      }
    });
    dominationPercentages.sort((a, b) => b.MinAgeProgressPercent - a.MinAgeProgressPercent);
    for (let idx = 0; idx < dominationPercentages.length; idx++) {
      const domPct = dominationPercentages[idx];
      if (ageProgress >= domPct.MinAgeProgressPercent) {
        tooltipInfo.currentVictoryName = domPct.Name;
        tooltipInfo.currentVictoryMult = (domPct.DominationPercent + 100) / 100;
        if (idx > 0) {
          const nextDom = dominationPercentages[idx - 1];
          tooltipInfo.nextVictoryName = nextDom.Name;
          tooltipInfo.nextVictoryMult = (nextDom.DominationPercent + 100) / 100;
          tooltipInfo.currentVictoryPercent = nextDom.MinAgeProgressPercent;
          if (idx > 1) {
            tooltipInfo.nextVictoryPercent = dominationPercentages[idx - 2].MinAgeProgressPercent;
          } else {
            tooltipInfo.nextVictoryPercent = 100;
          }
        } else {
          tooltipInfo.currentVictoryPercent = 100;
        }
        break;
      }
    }
    return tooltipInfo;
  }
  function calcSpreadsheetsForVictory(victoryType, victoryTypeString, includeUnmetPlayers) {
    const victorySheets = [];
    const PlayerList = getPlayerList();
    PlayerList.forEach((player) => {
      if (player && player.Victories && player.isMajor) {
        const tempSheet = {
          header: "",
          title: "",
          playerId: player.id,
          isDominant: false,
          showTotal: false,
          countdownTurns: 0,
          points: player.Victories.getPointsForVictoryType(victoryType),
          lastTurnDelta: 0,
          items: [],
          prereqs: [],
          metPlayer: true
        };
        if (victoryTypeString === "VICTORY_CLASS_ECONOMIC") {
          tempSheet.header = "LOC_VICTORY_ECONOMIC_HEADER";
          tempSheet.title = "LOC_VICTORIES_SCORE_BREAKDOWN";
          tempSheet.showTotal = true;
        }
        const countdown = player.Victories.getVictoryCountdownStatus(victoryType);
        if (countdown) {
          if (countdown.isDominant) {
            tempSheet.isDominant = countdown.isDominant;
          }
          if (countdown.turns) {
            tempSheet.countdownTurns = countdown.turns;
          }
          countdown.prereqs.forEach((prereq) => {
            const tempPrereq = {
              name: prereq.description,
              points: prereq.current,
              target: prereq.total,
              turn: 0,
              age: AgeTypes.NO_AGE,
              trackerType: VictoryTrackerTypes.VICTORY_TRACKER_NONE
            };
            tempSheet.prereqs.push(tempPrereq);
          });
        }
        const scoring = player.Victories.getScoringForVictoryType(victoryType);
        scoring.forEach((score) => {
          const dupe = tempSheet.items.find((a) => a.name == score.name);
          if (dupe) {
            dupe.points += score.points;
          } else {
            const tempItem = {
              name: score.name,
              points: score.points,
              target: 0,
              turn: score.turn,
              age: score.age,
              trackerType: score.trackerType
            };
            tempSheet.items.push(tempItem);
          }
        });
        if (includeUnmetPlayers) {
          victorySheets.push(tempSheet);
        } else {
          const localPlayer = Players.get(GameContext.localPlayerID);
          if (localPlayer) {
            const localPlayerDiplomacy = localPlayer.Diplomacy;
            if (localPlayerDiplomacy) {
              const hasMet = mptHasMet(localPlayerDiplomacy, player.id) || player.id == GameContext.localPlayerID;
              tempSheet.metPlayer = hasMet;
              if (tempSheet.items.length > 0 || tempSheet.prereqs.length > 0) {
                if (!hasMet) {
                  tempSheet.title = "LOC_UI_UNMET_PLAYER_NAME";
                }
                victorySheets.push(tempSheet);
              }
            } else {
              console.error("victories-screen-model.ts: Couldn't get diplomacy for local player!");
            }
          } else {
            console.error("victories-screen-model.ts: Couldn't get local player!");
          }
        }
      }
    });
    victorySheets.sort((a, b) => b.points - a.points);
    return victorySheets;
  }
  function calcVictoryLeaderboard(victoryHash, countdownDuration) {
    const PlayerList = getPlayerList();
    const leaderboard = [];
    const localPlayer = Players.get(GameContext.localPlayerID);
    if (!localPlayer) {
      console.error("victories-screen-model: Couldn't get local player!");
      return leaderboard;
    }
    const localDiplo = localPlayer.Diplomacy;
    if (!localDiplo) {
      console.error("victories-screen-model: Couldn't get local player's diplomacy!");
      return leaderboard;
    }
    const playerScores = [];
    PlayerList.forEach((player) => {
      if (player && player.Victories && player.isMajor) {
        const points = player.Victories.getPointsForVictoryType(victoryHash);
        const scoring = player.Victories.getVictoryCountdownStatus(victoryHash);
        let turnsProgress = 0;
        let turnsTotal = 0;
        let dominant = false;
        if (scoring) {
          turnsProgress = scoring.turns;
          turnsTotal = countdownDuration;
          if (turnsProgress > turnsTotal) {
            turnsProgress = turnsTotal;
          }
          dominant = scoring.isDominant;
        }
        let isWinner = false;
        if (isOneMoreTurnMode()) {
          const victories = Game.VictoryManager.getVictories();
          const thisVictory = victories.find((v) => v.victory == victoryHash);
          if (thisVictory && thisVictory.team == player.team) {
            isWinner = true;
          }
        }
        playerScores.push({
          player,
          score: points,
          turnsProgress,
          turnsTotal,
          dominant,
          hasMet: mptHasMet(localDiplo, player.id) || player.id == GameContext.localPlayerID,
          winner: isWinner
        });
      }
    });
    playerScores.sort((a, b) => b.score - a.score);
    const numTopPlayers = mptIsObserver(GameContext.localPlayerID) ? playerScores.length : Math.min(playerScores.length, 3);   // MPT: Observer sees all
    let userInTop3 = false;
    for (let i = 0; i < numTopPlayers; i++) {
      if (playerScores[i].player.id == GameContext.localPlayerID) {
        userInTop3 = true;
      }
      leaderboard.push({
        name: playerScores[i].player.leaderName,
        points: playerScores[i].score,
        id: playerScores[i].player.id,
        place: i + 1,
        turnsProgress: playerScores[i].turnsProgress,
        turnsTotal: playerScores[i].turnsTotal,
        dominant: playerScores[i].dominant,
        hasMet: playerScores[i].hasMet,
        winner: playerScores[i].winner
      });
    }
    if (!userInTop3) {
      for (let i = numTopPlayers; i < playerScores.length; i++) {
        if (playerScores[i].player.id == GameContext.localPlayerID) {
          leaderboard.push({
            name: playerScores[i].player.leaderName,
            points: playerScores[i].score,
            id: playerScores[i].player.id,
            place: i + 1,
            turnsProgress: playerScores[i].turnsProgress,
            turnsTotal: playerScores[i].turnsTotal,
            dominant: playerScores[i].dominant,
            hasMet: playerScores[i].hasMet,
            winner: playerScores[i].winner
          });
          break;
        }
      }
    }
    return leaderboard;
  }
  function calcPlayerInfo(player) {
    const playerInfo = {};
    const rowState = getOrCreatePlayerRowState(player.id);
    playerInfo.playerName = player.name;
    playerInfo.playerId = player.id;
    playerInfo.highlighted = rowState.isHighlighted;
    playerInfo.setHighlighted = rowState.setIsHighlighted;
    playerInfo.dimScore = rowState.shouldDimScore;
    playerInfo.setDimScore = rowState.setShouldDimScore;
    playerInfo.focused = rowState.isFocused;
    playerInfo.setFocused = rowState.setIsFocused;
    const localPlayer = Players.get(GameContext.localPlayerID);
    let localPlayerDiplomacy = void 0;
    if (localPlayer) {
      localPlayerDiplomacy = localPlayer.Diplomacy;
    } else {
      console.error(`victories-screen-model: Could not get diplomacy for local player`);
    }
    const bannerData = [];
    const legendPathData = Online.Metaprogression.getLegendPathsData();
    legendPathData.forEach((item) => {
      if (item.legendPathLoc.includes("LOC_LEADER")) {
        const leaderID = item.legendPathLoc.substring(4, item.legendPathLoc.length - 5);
        if (item.rewards) {
          const bannerItem = item.rewards.find((item2) => {
            return item2.gameItemID.slice(0, 7) == "BANNER_";
          });
          if (bannerItem) {
            bannerData.push({ leaderID, bannerURL: bannerItem.reward });
          }
        }
      }
    });
    const leaderDef = GameInfo.Leaders.find((item) => {
      return Database.makeHash(item.LeaderType) == player.leaderType;
    });
    if (leaderDef) {
      playerInfo.leaderName = leaderDef.Name;
      if (player.id == GameContext.localPlayerID) {
        const cardInfo = getPlayerCardInfo();
        playerInfo.playerBanner = cardInfo.BackgroundURL;
      } else {
        const bannerInfo = bannerData.find((reward) => {
          return reward.leaderID == leaderDef.LeaderType;
        });
        if (bannerInfo) {
          playerInfo.playerBanner = bannerInfo.bannerURL;
        }
      }
      if (localPlayerDiplomacy) {
        playerInfo.playerIsMet = mptHasMet(localPlayerDiplomacy, player.id) || player.id == GameContext.localPlayerID;
      }
    }
    if (player.Diplomacy) {
      playerInfo.playerAtWarWith = player.Diplomacy.isAtWarWith(GameContext.localPlayerID);
    }
    if (player.Culture) {
      const ideology = GameInfo.Ideologies.lookup(player.Culture.getChosenIdeology());
      if (ideology) {
        playerInfo.govType = ideology.Name;
      }
    }
    return playerInfo;
  }
  function isOneMoreTurnMode() {
    return Game.AgeProgressManager.isExtendedGame || Game.AgeProgressManager.getMaxAgeProgressionPoints() <= 0;
  }
  function havePrerequisitesBeenMet(spreadsheet) {
    let prereqsMet = true;
    spreadsheet.prereqs.forEach((prereq) => {
      prereqsMet = prereqsMet && prereq.points >= prereq.target;
    });
    return prereqsMet;
  }
  function calcScoreDetails(scoreVictoryHash) {
    const scoreDetail = {
      headerText: "LOC_VICTORY_SCORE_HEADER",
      targetScore: Game.VictoryManager.getCountdownVictoryDominanceScore(scoreVictoryHash),
      playerDetails: []
    };
    const PlayerList = getPlayerList();
    PlayerList.forEach((player) => {
      if (player && player.Victories && player.isMajor) {
        const playerScoreDetail = {};
        playerScoreDetail.playerInfo = calcPlayerInfo(player);
        playerScoreDetail.playerInfo.score = player.Victories.getPointsForVictoryType(scoreVictoryHash);
        playerScoreDetail.playerColor = "#ffffff";
        playerScoreDetail.playerDimColor = "#3f3f3f";
        const dummySheet = {
          header: "",
          title: "",
          playerId: player.id,
          isDominant: false,
          points: 0,
          lastTurnDelta: 0,
          showTotal: false,
          countdownTurns: -1,
          items: [],
          prereqs: [],
          metPlayer: false
        };
        playerScoreDetail.playerInfo.spreadsheet = dummySheet;
        if (playerScoreDetail.playerInfo.playerIsMet) {
          const thisColor = playerColors.get(player.id);
          if (thisColor) {
            playerScoreDetail.playerColor = ObjectToRgbaString({ ...thisColor.primary, a: 255 });
            playerScoreDetail.playerDimColor = ObjectToRgbaString({
              r: thisColor.dim.r,
              g: thisColor.dim.g,
              b: thisColor.dim.b,
              a: 255
            });
          }
        }
        playerScoreDetail.playerInfo.scoreColor = playerScoreDetail.playerColor;
        scoreDetail.playerDetails.push(playerScoreDetail);
      }
    });
    scoreDetail.playerDetails.sort((a, b) => b.playerInfo.score - a.playerInfo.score);
    return scoreDetail;
  }
  function calcMilitaryDetails(militaryVictoryHash) {
    const [infoToggle, setInfoToggle] = createSignal(false);
    const militaryDetail = {
      headerText: "LOC_VICTORY_MILITARY_HEADER",
      targetScore: Game.VictoryManager.getCountdownVictoryDominanceScore(militaryVictoryHash),
      playerDetails: [],
      pointsForIdeologyMismatch: 2,
      // currently not available from GameCore, but we're all plumbed up for when it is
      infoToggle,
      setInfoToggle
    };
    const PlayerList = getPlayerList();
    PlayerList.forEach((player) => {
      if (player && player.Victories && player.isMajor) {
        const playerMilDetail = {};
        playerMilDetail.playerInfo = calcPlayerInfo(player);
        playerMilDetail.playerInfo.score = player.Victories.getPointsForVictoryType(militaryVictoryHash);
        playerMilDetail.structures = [];
        const thisColor = playerColors.get(player.id);
        const primary = thisColor ? thisColor.primary : { r: 255, g: 255, b: 255, a: 255 };
        playerMilDetail.playerInfo.scoreColor = ObjectToRgbaString({
          ...primary,
          a: 255
        });
        const scoring = player.Victories.getScoringForVictoryType(militaryVictoryHash);
        const COMPONENTID_TYPE_CITY = 1;
        scoring.forEach((score) => {
          const cityId = ComponentID.make(player.id, COMPONENTID_TYPE_CITY, score.id);
          const city = Cities.get(cityId);
          const structureInfo = {
            name: score.name,
            points: score.points,
            iconURL: "",
            iconClass: "",
            wasConqueredFromIdeologicalOpponent: false,
            breakdown: [],
            hasMet: false
          };
          const scoreData = GameInfo.VictoryDataUIs.find((a) => a.$hash == score.data);
          const dupe = playerMilDetail.structures.find((a) => a.name == structureInfo.name);
          const name = scoreData ? scoreData.Name : "LOC_VICTORIES_SOURCE_UNKNOWN";
          const sortOrder = scoreData?.SortOrder ?? 100;
          if (dupe) {
            dupe.points += score.points;
            dupe.breakdown.push({ name, points: score.points, sortOrder });
          } else {
            if (city) {
              if (city.isTown) {
                structureInfo.iconURL = "url(blp:victories_towns_256)";
                structureInfo.breakdown.push({
                  name: scoreData ? name : "LOC_CAPITAL_SELECT_PROMOTION_NONE",
                  points: score.points,
                  sortOrder
                });
              } else {
                if (city.isCapital) {
                  structureInfo.iconURL = "url(blp:victories_capital_256)";
                  structureInfo.breakdown.push({
                    name: scoreData ? name : "LOC_CAPITAL_SELECT_PROMOTION_CAPITAL",
                    points: score.points,
                    sortOrder
                  });
                } else {
                  structureInfo.iconURL = "url(blp:victories_city_256)";
                  structureInfo.breakdown.push({
                    name: scoreData ? name : "LOC_CAPITAL_SELECT_PROMOTION_CITY",
                    points: score.points,
                    sortOrder
                  });
                }
              }
              if (city.originalOwner != city.owner) {
                const originalPlayer = Players.get(city.originalOwner);
                if (originalPlayer && originalPlayer.Culture && player.Culture) {
                  const originalIdeology = GameInfo.Ideologies.lookup(
                    originalPlayer.Culture.getChosenIdeology()
                  );
                  const playerIdeology = GameInfo.Ideologies.lookup(
                    player.Culture.getChosenIdeology()
                  );
                  if (originalIdeology && playerIdeology && originalIdeology.IdeologyType != playerIdeology.IdeologyType) {
                    structureInfo.wasConqueredFromIdeologicalOpponent = true;
                  }
                }
              }
            } else {
              structureInfo.iconURL = "url(blp:victories_triumph_256)";
              structureInfo.breakdown.push({
                name: scoreData ? scoreData.Name : "LOC_UI_TRIUMPH",
                points: score.points,
                sortOrder: 0
              });
            }
            const localPlayer = Players.get(GameContext.localPlayerID);
            if (localPlayer && localPlayer.Diplomacy) {
              structureInfo.hasMet = mptHasMet(localPlayer.Diplomacy, player.id) || player.id == GameContext.localPlayerID;
            }
            playerMilDetail.structures.push(structureInfo);
          }
        });
        playerMilDetail.structures.sort((a, b) => b.points - a.points);
        playerMilDetail.structures.forEach((structure) => {
          structure.breakdown.sort((a, b) => a.sortOrder - b.sortOrder);
        });
        militaryDetail.playerDetails.push(playerMilDetail);
      }
    });
    militaryDetail.playerDetails.sort((a, b) => b.playerInfo.score - a.playerInfo.score);
    return militaryDetail;
  }
  function highlightEconPlayer(playerId) {
    const graphLines = model.data.economicDetails.currentChart.graphLines;
    if (!graphLines) {
      return;
    }
    graphLines.forEach((line) => {
      const detail = model.data.economicDetails.playerDetails.find((a) => a.playerInfo.playerId == line.refCon);
      if (detail) {
        if (line.refCon == playerId) {
          line.color = detail.playerColor;
          line.order = 0;
        } else {
          line.color = detail.playerDimColor;
          line.order = 1;
        }
      }
    });
  }
  function highlightAllEconPlayers() {
    const graphLines = model.data.economicDetails.currentChart.graphLines;
    if (!graphLines) {
      return;
    }
    graphLines.forEach((line) => {
      const detail = model.data.economicDetails.playerDetails.find((a) => a.playerInfo.playerId == line.refCon);
      if (detail) {
        line.color = detail.playerColor;
        line.order = 1;
      }
    });
  }
  function calcEconomicChartForAge(age, ageData, playerEcoDetail) {
    const chart = {
      graphTarget: 0,
      graphLines: [],
      maxTurn: 0
    };
    const ageDefinition = GameInfo.Ages.lookup(age);
    if (ageDefinition) {
      const PlayerList = getPlayerList();
      PlayerList.forEach((player) => {
        if (player && player.Victories && player.isMajor) {
          const playerGraphLine = {};
          playerGraphLine.points = [];
          playerGraphLine.refCon = player.id;
          playerGraphLine.order = 1;
          const playerDetail = playerEcoDetail.find((a) => a.playerInfo.playerId == player.id);
          if (playerDetail) {
            playerGraphLine.color = playerDetail.playerColor;
          } else {
            playerGraphLine.color = "#ffffff";
          }
          const thisPlayersData = ageData.find((a) => a.playerId == player.id);
          let turn = 1;
          if (thisPlayersData) {
            thisPlayersData.history.forEach((point) => {
              playerGraphLine.points.push({ x: turn, y: point });
              turn++;
            });
          }
          if (player.id === GameContext.localPlayerID) {
            playerGraphLine.points.pop();
          }
          chart.maxTurn = turn;
          chart.graphLines.push(playerGraphLine);
        }
      });
      const numTurns = chart.graphLines[1] ? chart.graphLines[1].points.length : chart.graphLines[0].points.length;
      const gdpPerTurn = [];
      let highestGDP = 0;
      for (let turn = 0; turn < numTurns; turn++) {
        let gdpThisTurn = 0;
        PlayerList.forEach((player) => {
          if (player && player.Victories && player.isMajor) {
            const playerPoints = chart.graphLines.find((a) => a.refCon == player.id);
            if (playerPoints && playerPoints.points.length > turn) {
              gdpThisTurn += playerPoints.points[turn].y;
            }
          }
        });
        gdpPerTurn.push(gdpThisTurn);
        if (gdpThisTurn > highestGDP) {
          highestGDP = gdpThisTurn;
        }
      }
      let highestPercentage = 0;
      chart.graphLines.forEach((graphLine) => {
        for (let turn = 0; turn < numTurns; turn++) {
          if (graphLine.points[turn]) {
            const divisor = gdpPerTurn[turn] > 0 ? gdpPerTurn[turn] : 1;
            const percent = graphLine.points[turn].y / divisor * 100;
            graphLine.points[turn].y = percent;
            if (percent > highestPercentage) {
              highestPercentage = percent;
            }
          }
        }
      });
      chart.graphTarget = Math.floor((highestPercentage / 2 + 1) * 2);
    }
    return chart;
  }
  function calcEconomicDetails(economicVictoryHash, spreadsheet) {
    const ageDefinition = GameInfo.Ages.lookup(Game.age);
    let ageDefault = 0;
    if (ageDefinition && ageDefinition.$hash) {
      ageDefault = ageDefinition.$hash;
    } else {
      console.error("victories-screen-model: Unable to get AgeDefinition for current Age.");
    }
    const [selectedAge, setSelectedAge] = createSignal(ageDefault);
    const [econInfoToggle, setEconInfoToggle] = createSignal(false);
    const economicDetail = {
      headerText: "LOC_VICTORY_ECONOMIC_HEADER",
      targetScore: Game.VictoryManager.getCountdownVictoryDominanceScore(economicVictoryHash),
      playerDetails: [],
      ageOptions: {},
      ageCharts: /* @__PURE__ */ new Map(),
      currentGDP: 0,
      infoToggle: econInfoToggle,
      setInfoToggle: setEconInfoToggle,
      currentChart: {}
    };
    const thisAge = ageDefinition?.ChronologyIndex != void 0 ? ageDefinition?.ChronologyIndex : 99;
    economicDetail.ageOptions.selectedValue = selectedAge;
    economicDetail.ageOptions.setSelectedValue = setSelectedAge;
    economicDetail.ageOptions.items = /* @__PURE__ */ new Map();
    const currentAgeData = [];
    const PlayerList = getPlayerList();
    let highestPlayerScore = 0;
    PlayerList.forEach((player) => {
      if (player && player.Victories && player.isMajor) {
        const playerEcoDetail = {};
        playerEcoDetail.playerInfo = calcPlayerInfo(player);
        playerEcoDetail.playerInfo.score = player.Victories.getPointsForVictoryType(economicVictoryHash);
        playerEcoDetail.playerColor = "#ffffff";
        playerEcoDetail.playerDimColor = "#3f3f3f";
        const playerSpreadsheet = spreadsheet.find((a) => a.playerId == player.id);
        if (playerSpreadsheet) {
          playerEcoDetail.playerInfo.spreadsheet = playerSpreadsheet;
        } else {
          const dummySheet = {
            header: "",
            title: "",
            playerId: player.id,
            isDominant: false,
            points: 0,
            lastTurnDelta: 0,
            showTotal: false,
            countdownTurns: -1,
            items: [],
            prereqs: [],
            metPlayer: playerEcoDetail.playerInfo.playerIsMet
          };
          playerEcoDetail.playerInfo.spreadsheet = dummySheet;
        }
        if (playerEcoDetail.playerInfo.score > highestPlayerScore) {
          highestPlayerScore = playerEcoDetail.playerInfo.score;
        }
        if (playerEcoDetail.playerInfo.playerIsMet) {
          const thisColor = playerColors.get(player.id);
          if (thisColor) {
            playerEcoDetail.playerColor = ObjectToRgbaString({ ...thisColor.primary, a: 255 });
            playerEcoDetail.playerDimColor = ObjectToRgbaString({
              r: thisColor.dim.r,
              g: thisColor.dim.g,
              b: thisColor.dim.b,
              a: 255
            });
          }
        }
        playerEcoDetail.playerInfo.scoreColor = playerEcoDetail.playerColor;
        economicDetail.playerDetails.push(playerEcoDetail);
        const playerAgeData = {
          playerId: player.id,
          history: player.Victories.getHistoryForVictoryType(economicVictoryHash)
        };
        currentAgeData.push(playerAgeData);
      }
    });
    const numTurns = currentAgeData.length > 1 && currentAgeData[1].history ? currentAgeData[1].history.length : currentAgeData[0].history.length;
    for (let turn = 0; turn < numTurns; turn++) {
      PlayerList.forEach((player) => {
        if (player && player.Victories && player.isMajor) {
          const playerPoints = currentAgeData.find((a) => a.playerId == player.id);
          const playerSheet = spreadsheet.find((a) => a.playerId == player.id);
          if (playerPoints && playerSheet) {
            const lastItem = playerPoints.history?.length ? playerPoints.history?.length - 1 : 0;
            if (lastItem > 0) {
              playerSheet.lastTurnDelta = playerPoints.history[lastItem] - playerPoints.history[lastItem - 1];
            } else {
              playerSheet.lastTurnDelta = 0;
            }
          }
        }
      });
    }
    GameInfo.Ages.forEach((age) => {
      if (age.ChronologyIndex <= thisAge) {
        const name = Locale.compose("LOC_VICTORY_AGE_NAME", age.Name);
        economicDetail.ageOptions.items.set(age.$hash, {
          name,
          description: age.Description ? Locale.compose(age.Description) : ""
        });
        if (age.$hash != Game.age) {
          const agesData = [];
          PlayerList.forEach((player) => {
            if (player && player.Victories && player.isMajor) {
              const thisAgeData = {
                playerId: PlayerIds.NO_PLAYER,
                history: []
              };
              thisAgeData.playerId = player.id;
              thisAgeData.history = player.Victories.getPastAgeHistoryForVictoryType(
                economicVictoryHash,
                age.$hash
              );
              agesData.push(thisAgeData);
            }
          });
          economicDetail.ageCharts.set(
            age.$hash,
            calcEconomicChartForAge(age.AgeType, agesData, economicDetail.playerDetails)
          );
        } else {
          economicDetail.ageCharts.set(
            age.$hash,
            calcEconomicChartForAge(age.AgeType, currentAgeData, economicDetail.playerDetails)
          );
        }
      }
    });
    economicDetail.playerDetails.sort((a, b) => b.playerInfo.score - a.playerInfo.score);
    return economicDetail;
  }
  function calcScienceDetails(scienceVictoryHash, countdownDuration, spreadsheet) {
    const [infoToggle, setInfoToggle] = createSignal(false);
    const scienceDetail = {
      headerText: "LOC_VICTORY_SCIENTIFIC_HEADER",
      targetScore: Game.VictoryManager.getCountdownVictoryDominanceScore(scienceVictoryHash),
      playerDetails: [],
      pointsSectionHeaders: [],
      countdownDuration,
      shortestRemainingCountdownDuration: countdownDuration,
      infoToggle,
      setInfoToggle
    };
    const numPointSections = 4;
    for (let i = 0; i < numPointSections; i++) {
      scienceDetail.pointsSectionHeaders.push(scienceDetail.targetScore / numPointSections * i);
    }
    const ageName = GameInfo.Ages.lookup(Game.age)?.AgeType;
    const PlayerList = getPlayerList();
    PlayerList.forEach((player) => {
      if (player && player.Victories && player.isMajor) {
        const playerSpreadsheetDetails = spreadsheet.find((spreadsheet2) => spreadsheet2.playerId === player.id);
        if (!playerSpreadsheetDetails) {
          console.error(`victories-screen-model: couldn't get spreadsheet details for ID ${player.id}`);
          return;
        }
        const playerScienceDetail = {};
        playerScienceDetail.playerInfo = calcPlayerInfo(player);
        playerScienceDetail.playerInfo.score = player.Victories.getPointsForVictoryType(scienceVictoryHash);
        playerScienceDetail.countdownProgress = playerSpreadsheetDetails.countdownTurns;
        if (countdownDuration - playerScienceDetail.countdownProgress < scienceDetail.shortestRemainingCountdownDuration) {
          scienceDetail.shortestRemainingCountdownDuration = countdownDuration - playerScienceDetail.countdownProgress;
        }
        const isDominant = playerSpreadsheetDetails.isDominant;
        const launchpadBuiltAndUndamaged = havePrerequisitesBeenMet(playerSpreadsheetDetails);
        const launchpadBuilt = player.Stats?.getNumConstructiblesOfType("BUILDING_LAUNCH_PAD") ?? 0 > 0;
        let rocketryResearched = false;
        const playerTechs = player.Techs;
        if (playerTechs) {
          rocketryResearched = playerTechs.isNodeUnlocked("NODE_TECH_MO_ROCKETRY");
        }
        let isWinner = false;
        const victories = Game.VictoryManager.getVictories();
        const thisVictory = victories.find((v) => v.victory == scienceVictoryHash);
        if (thisVictory && thisVictory.team == player.team) {
          isWinner = true;
        }
        if (isDominant) {
          playerScienceDetail.launchpadStatus = {
            status: 5 /* InUse */,
            tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_IN_USE_HEADER",
            tooltipText: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_IN_USE"
          };
        } else if (isWinner) {
          playerScienceDetail.launchpadStatus = {
            status: 5 /* InUse */,
            tooltipHeader: "LOC_VICTORY_SCIENCE_NAME",
            tooltipText: Locale.compose(
              "LOC_VICTORY_LEADER_NAME",
              playerScienceDetail.playerInfo.leaderName
            )
          };
        } else if (launchpadBuiltAndUndamaged) {
          playerScienceDetail.launchpadStatus = {
            status: 4 /* Built */,
            tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_BUILT_HEADER",
            tooltipText: Locale.compose(
              "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_BUILT",
              scienceDetail.targetScore
            )
          };
        } else if (launchpadBuilt) {
          if (playerScienceDetail.playerInfo.score < scienceDetail.targetScore) {
            playerScienceDetail.launchpadStatus = {
              status: 6 /* Damaged */,
              tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_LAUNCHPAD_DAMAGED_HEADER",
              tooltipText: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_LAUNCHPAD_DAMAGED_PRE_COUNTDOWN"
            };
          } else {
            playerScienceDetail.launchpadStatus = {
              status: 6 /* Damaged */,
              tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_LAUNCHPAD_DAMAGED_HEADER",
              tooltipText: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_LAUNCHPAD_DAMAGED"
            };
          }
        } else if (rocketryResearched) {
          playerScienceDetail.launchpadStatus = {
            status: 3 /* NotBuilt */,
            tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_NO_LAUNCHPAD_HEADER",
            tooltipText: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_NO_LAUNCHPAD"
          };
        } else if (ageName === "AGE_MODERN") {
          playerScienceDetail.launchpadStatus = {
            status: 2 /* NeedRocketry */,
            tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_NEED_ROCKETRY_HEADER",
            tooltipText: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_NEED_ROCKETRY"
          };
        } else {
          playerScienceDetail.launchpadStatus = {
            status: 1 /* PreModern */,
            tooltipHeader: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_PRE_MODERN_HEADER",
            tooltipText: "LOC_VICTORIES_SCIENTIFIC_LAUNCHPAD_STATUS_PRE_MODERN"
          };
        }
        playerScienceDetail.starInfo = [];
        playerSpreadsheetDetails.items.forEach((spreadsheetItem) => {
          playerScienceDetail.starInfo.push({
            accumulatedPoints: 0,
            pointsValue: spreadsheetItem.points,
            description: spreadsheetItem.name,
            age: GameInfo.Ages.lookup(spreadsheetItem.age)?.AgeType ?? "AGE_UNKNOWN",
            ageName: GameInfo.Ages.lookup(spreadsheetItem.age)?.Name ?? "AGE_UNKNOWN",
            turn: spreadsheetItem.turn
          });
        });
        playerScienceDetail.starInfo.sort((a, b) => {
          const aChronologyIndex = GameInfo.Ages.find((age) => age.AgeType === a.age)?.ChronologyIndex ?? Number.POSITIVE_INFINITY;
          const bChronologyIndex = GameInfo.Ages.find((age) => age.AgeType === b.age)?.ChronologyIndex ?? Number.POSITIVE_INFINITY;
          if (aChronologyIndex === bChronologyIndex) {
            return a.turn - b.turn;
          }
          return aChronologyIndex - bChronologyIndex;
        });
        let accumulatedPoints = 0;
        playerScienceDetail.starInfo.forEach((star) => {
          star.accumulatedPoints = accumulatedPoints;
          accumulatedPoints += star.pointsValue;
        });
        if (playerScienceDetail.playerInfo.playerIsMet) {
          const thisColor = playerColors.get(player.id);
          if (thisColor) {
            const primary = thisColor.primary;
            playerScienceDetail.rocketColor = `rgba(${primary.r}, ${primary.g}, ${primary.b}, 1.0)`;
            playerScienceDetail.fadedRocketColor = `rgba(${primary.r}, ${primary.g}, ${primary.b}, 0.3)`;
            playerScienceDetail.barColor = `rgba(${primary.r}, ${primary.g}, ${primary.b}, 0.5)`;
            playerScienceDetail.playerInfo.scoreColor = playerScienceDetail.rocketColor;
          }
        } else {
          playerScienceDetail.rocketColor = "rgba(217, 217, 217, 1)";
          playerScienceDetail.fadedRocketColor = "rgba(217, 217, 217, 0.3)";
          playerScienceDetail.barColor = "rgba(217, 217, 217, 0.5)";
        }
        scienceDetail.playerDetails.push(playerScienceDetail);
      }
    });
    scienceDetail.playerDetails.sort((a, b) => b.playerInfo.score - a.playerInfo.score);
    return scienceDetail;
  }
  function calcCultureDetails(cultureVictoryHash, countdownDuration) {
    const ageDefinition = GameInfo.Ages.lookup(Game.age);
    let ageDefault = 0;
    if (ageDefinition && ageDefinition.$hash) {
      ageDefault = ageDefinition.$hash;
    } else {
      console.error("victories-screen-model: Unable to get AgeDefinition for current Age.");
    }
    const [selectedAge, setSelectedAge] = createSignal(ageDefault);
    const [infoToggle, setInfoToggle] = createSignal(false);
    const turnPercentages = [];
    for (let i = 0; i < 100; i++) {
      turnPercentages.push(i);
    }
    const cultureDetail = {
      headerText: "LOC_VICTORY_CULTURAL_HEADER",
      targetScore: Game.VictoryManager.getCountdownVictoryDominanceScore(cultureVictoryHash),
      playerDetails: [],
      infoToggle,
      setInfoToggle,
      ageOptions: {},
      countdownDuration: 0,
      turnPercentages,
      currentAgeProgressPercentage: Math.min(
        100,
        Math.floor(
          Game.AgeProgressManager.getCurrentAgeProgressionPoints() / Game.AgeProgressManager.getMaxAgeProgressionPoints() * 100
        )
      )
    };
    cultureDetail.ageOptions.selectedValue = selectedAge;
    cultureDetail.ageOptions.setSelectedValue = setSelectedAge;
    cultureDetail.ageOptions.items = /* @__PURE__ */ new Map();
    const thisAgeIndex = ageDefinition?.ChronologyIndex != void 0 ? ageDefinition?.ChronologyIndex : 99;
    GameInfo.Ages.forEach((age) => {
      if (age.ChronologyIndex <= thisAgeIndex) {
        const name = Locale.compose("LOC_VICTORY_AGE_NAME", age.Name);
        cultureDetail.ageOptions.items.set(age.$hash, {
          name,
          description: age.Description ? Locale.compose(age.Description) : ""
        });
      }
    });
    const PlayerList = getPlayerList();
    const highestAgeScoreMap = /* @__PURE__ */ new Map();
    PlayerList.forEach((player) => {
      const thisColor = playerColors.get(player.id);
      const primary = thisColor ? thisColor.primary : {
        r: 255,
        g: 255,
        b: 255,
        a: 255
      };
      if (player && player.Victories && player.isMajor && player.Constructibles != void 0) {
        const playerCultureDetail = {
          playerInfo: calcPlayerInfo(player),
          playerColor: `rgba(${primary.r}, ${primary.g}, ${primary.b}, 0.9)`,
          allCulturePips: [],
          greatWorksData: { pointsTotal: "", sources: [] }
        };
        playerCultureDetail.playerInfo.score = player.Victories.getPointsForVictoryType(cultureVictoryHash);
        playerCultureDetail.playerInfo.scoreColor = `rgba(${primary.r}, ${primary.g}, ${primary.b}, 1.0)`;
        let greatWorkPoints = 0;
        const points = player.Victories.getScoringForVictoryType(cultureVictoryHash).sort((a, b) => {
          const aAge = GameInfo.Ages.lookup(a.age)?.ChronologyIndex ?? Infinity;
          const bAge = GameInfo.Ages.lookup(b.age)?.ChronologyIndex ?? Infinity;
          if (aAge !== bAge) return aAge - bAge;
          if (a.turn !== b.turn) return a.turn - b.turn;
          return 0;
        });
        for (const p of points) {
          highestAgeScoreMap.set(p.age, Math.max(highestAgeScoreMap.get(p.age) ?? 0, p.turn));
        }
        points.forEach((point) => {
          if (point.trackerType == VictoryTrackerTypes.VICTORY_TRACKER_GREAT_WORK) {
            greatWorkPoints += point.points;
            return;
          }
          let pipAgeIndex = playerCultureDetail.allCulturePips.findIndex((p) => p.age == point.age);
          if (pipAgeIndex == -1) {
            playerCultureDetail.allCulturePips.push({ age: point.age, pips: [] });
            pipAgeIndex = playerCultureDetail.allCulturePips.length - 1;
          }
          const location = { x: 0, y: 0 };
          const maxProgress = point.age !== Game.age ? highestAgeScoreMap.get(point.age) ?? 0 : Game.AgeProgressManager.getMaxAgeProgressionPoints();
          const pointSource = {};
          pointSource.sourceName = void 0;
          pointSource.typeName = "";
          const scoreData = GameInfo.VictoryDataUIs.find((a) => a.$hash == point.id);
          let iconOverride = false;
          if (scoreData && scoreData.IconOverride) {
            pointSource.iconSrc = "url(" + scoreData.IconOverride + ")";
            pointSource.typeName = Locale.compose(scoreData.Name);
            iconOverride = true;
          }
          switch (point.trackerType) {
            case VictoryTrackerTypes.VICTORY_TRACKER_NATURAL_WONDER: {
              pointSource.isBig = true;
              if (!iconOverride) {
                pointSource.iconSrc = "url(generic_natural_wonder)";
                pointSource.typeName = Locale.compose("LOC_PLOT_TOOLTIP_NATURAL_WONDER");
              }
              const wonderDef = GameInfo.Feature_NaturalWonders.lookup(point.id);
              if (wonderDef) {
                pointSource.sourceName = Locale.compose("LOC_" + wonderDef.FeatureType + "_NAME");
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_WONDER: {
              pointSource.isBig = true;
              pointSource.typeName = Locale.compose("LOC_CONSTRUCTIBLE_CLASS_NAME_WONDER");
              pointSource.isWonder = true;
              const constructible = player.Constructibles.getConstructibles().find((c) => {
                return c.id.id == point.id;
              });
              if (constructible && !iconOverride) {
                const constructibleDef = GameInfo.Constructibles.lookup(constructible.type);
                if (constructibleDef) {
                  pointSource.iconSrc = UI.getIconCSS(constructibleDef.ConstructibleType);
                  pointSource.sourceName = Locale.compose(constructibleDef.Name);
                }
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_UNIQUE_QUARTER: {
              pointSource.typeName = Locale.compose("LOC_PLOT_TOOLTIP_UNIQUE_BUILDING");
              const constructible = player.Constructibles.getConstructibles().find((c) => {
                return c.typeHash == point.id;
              });
              if (constructible && !iconOverride) {
                const constructibleDef = GameInfo.Constructibles.lookup(constructible.type);
                if (constructibleDef) {
                  pointSource.iconSrc = UI.getIconCSS(constructibleDef.ConstructibleType);
                  pointSource.sourceName = Locale.compose(constructibleDef.Name);
                }
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_RESORT_TOWN_TOURISM: {
              if (!iconOverride) {
                pointSource.iconSrc = "url(blp:focus_resort)";
                pointSource.typeName = Locale.compose("LOC_PROJECT_TOWN_RESORT_NAME");
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_CELEBRATIONS: {
              pointSource.sourceName = Locale.compose(point.name);
              if (!iconOverride) {
                const celebrationItemDef = GameInfo.GoldenAges.lookup(point.id);
                if (celebrationItemDef) {
                  pointSource.iconSrc = `url(blp:fonticon_celebration)`;
                  pointSource.typeName = Locale.compose("LOC_POLICIES_HAPPINESS_NEXT_SLOT_TITLE");
                }
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_SUZERAIN: {
              if (!iconOverride) {
                pointSource.typeName = Locale.compose(point.name);
                pointSource.iconSrc = "url('blp:fi_citystate_128')";
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_UNIQUE_IMPROVEMENT: {
              pointSource.sourceName = Locale.compose(point.name);
              const constructible = player.Constructibles.getConstructibles().find((c) => {
                return c.typeHash == point.id;
              });
              if (!iconOverride) {
                pointSource.typeName = Locale.compose("LOC_VICTORIES_UNIQUE_IMPROVEMENT");
                const improvementDef = GameInfo.Constructibles.lookup(constructible?.type ?? 0);
                if (improvementDef) {
                  pointSource.iconSrc = UI.getIconCSS(improvementDef.ConstructibleType);
                }
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_GAME_EFFECTS: {
              if (!iconOverride) {
                pointSource.typeName = Locale.compose(point.name);
                pointSource.iconSrc = "url(blp:victory_cultural)";
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_TRADE_ROUTE: {
              if (!iconOverride) {
                pointSource.typeName = Locale.compose(point.name);
                pointSource.iconSrc = "url(blp:fi_trade_route_128)";
              }
              break;
            }
            case VictoryTrackerTypes.VICTORY_TRACKER_BUILDING_TAG: {
              pointSource.sourceName = Locale.compose(point.name);
              if (!iconOverride) {
                pointSource.iconSrc = "url(blp:victory_cultural)";
                pointSource.typeName = Locale.compose(point.name) + " " + Locale.compose("LOC_VICTORY_TOURISM_NAME");
              } else {
                pointSource.typeName = Locale.compose(pointSource.typeName) + " " + Locale.compose("LOC_VICTORY_TOURISM_NAME");
              }
              break;
            }
            default: {
              console.error(
                "victories-screen-model: Unable to match VictoryTrackerType on culture point source."
              );
              return;
            }
          }
          pointSource.turn = point.turn;
          pointSource.age = point.age;
          pointSource.points = point.points;
          pointSource.position = window.innerWidth <= Layout.pixelsToScreenPixels(1280) ? utils.clamp(Math.floor(point.turn / maxProgress * 100) - 3, 0, 92) : utils.clamp(Math.floor(point.turn / maxProgress * 100) - 3, 0, 96);
          pointSource.id = point.id;
          pointSource.trackerType = point.trackerType;
          const pipListLength = playerCultureDetail.allCulturePips[pipAgeIndex].pips.length;
          const mergeDistance = window.innerWidth < Layout.pixelsToScreenPixels(1280) ? 4 : 6;
          if (pipListLength > 0 && pointSource.position - playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].position < mergeDistance) {
            const sourceIndex = playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources.findIndex((source) => {
              return point.trackerType == source.trackerType && point.id == source.id;
            });
            if (sourceIndex != -1) {
              playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].points += point.points;
              playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources[sourceIndex].points += point.points;
              return;
            }
            playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources.push(
              pointSource
            );
            playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].points += pointSource.points;
            let newPosition = 0;
            playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources.forEach(
              (pip) => {
                newPosition += pip.position;
              }
            );
            newPosition = Math.round(
              newPosition / playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources.length
            );
            if (window.innerWidth <= Layout.pixelsToScreenPixels(1280)) {
              newPosition = utils.clamp(newPosition, 0, 92);
            } else {
              newPosition = utils.clamp(newPosition, 0, 96);
            }
            playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].position = newPosition;
            playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources = playerCultureDetail.allCulturePips[pipAgeIndex].pips[pipListLength - 1].sources.sort(
              (a, b) => b.points - a.points
            );
          } else {
            const culturePip = {
              position: pointSource.position,
              sources: [pointSource],
              age: pointSource.age,
              ageName: GameInfo.Ages.lookup(pointSource.age)?.Name ?? "",
              points: pointSource.points,
              location
            };
            playerCultureDetail.allCulturePips[pipAgeIndex].pips.push(culturePip);
          }
        });
        playerCultureDetail.allCulturePips.forEach((pipList, listIndex) => {
          playerCultureDetail.allCulturePips[listIndex].pips = pipList.pips.sort(
            (a, b) => a.position - b.position
          );
        });
        let numArtifacts = 0;
        let numRelics = 0;
        let artifactIcon = "";
        let relicIcon = "";
        player.Cities?.getCities().forEach((city) => {
          const greatBuildings = city.Constructibles?.getGreatWorkBuildings();
          greatBuildings?.forEach((greatBuilding) => {
            greatBuilding.slots.forEach((slot) => {
              const gwType = Game.Culture.getGreatWorkType(slot.greatWorkIndex);
              const greatWork = GameInfo.GreatWorks.lookup(gwType);
              if (greatWork?.GreatWorkObjectType === "GREATWORKOBJECT_ARTIFACT") {
                numArtifacts += 1;
                if (artifactIcon == "") {
                  artifactIcon = `url(${greatWork.Image})`;
                }
              } else if (greatWork?.GreatWorkObjectType === "GREATWORKOBJECT_RELIC") {
                numRelics += 1;
                if (relicIcon == "") {
                  relicIcon = `url(${greatWork.Image})`;
                }
              }
            });
          });
        });
        playerCultureDetail.greatWorksData.sources = [
          { icon: artifactIcon, points: numArtifacts, typeName: "LOC_VICTORY_TRACKER_ARTIFACTS_NAME" },
          { icon: relicIcon, points: numRelics, typeName: "LOC_VICTORY_TRACKER_RELICS_NAME" }
        ];
        playerCultureDetail.greatWorksData.pointsTotal = greatWorkPoints.toString();
        cultureDetail.playerDetails.push(playerCultureDetail);
      }
    });
    cultureDetail.countdownDuration = countdownDuration;
    cultureDetail.playerDetails.sort((a, b) => b.playerInfo.score - a.playerInfo.score);
    return cultureDetail;
  }
  const model = createMutable({
    data: populateData(),
    tooltipToggle: false,
    clickCloseButton: handleClickClose,
    onGamepadInfoButton: handleGamepadInfoButton,
    onGamepadInspectButton: handleGamepadInspectButton,
    highlightPlayer: handleHighlightPlayer,
    unHighlightPlayer: handleUnHighlightPlayer,
    focusPlayer: handleFocusPlayer,
    unFocusPlayer: handleUnFocusPlayer,
    unFocusAllPlayers: handleUnFocusAllPlayers,
    tabChanged: handleTabChanged,
    tabNavStartup: handleTabNavStartup,
    tabNavShutdown: handleTabNavShutdown
  });
  return model;
}
const VictoriesScreenModel = ModelRegistry.register(
  "VictoriesScreenModel",
  ModelLifecycle.SharedInstance,
  createVictoriesScreenModel
);
const VictoriesScreenContext = createContext();
function useVictoriesScreenContext() {
  const context = useContext(VictoriesScreenContext);
  if (!context) {
    throw new Error("Unable to get Victories Screen context!");
  }
  return context;
}

export { LaunchpadStatus, VictoriesScreenContext, VictoriesScreenModel, VictoryTabType, createVictoriesScreenModel, useVictoriesScreenContext };
//# sourceMappingURL=victories-screen-model.js.map
