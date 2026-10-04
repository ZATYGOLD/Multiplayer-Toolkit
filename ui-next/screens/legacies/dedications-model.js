import { createMemo, createSignal, onMount, onCleanup, createEffect, on } from '../../../../core/vendor/solid-js/dist/solid.js';
import { createStore } from '../../../../core/vendor/solid-js/store/dist/store.js';
import { Layout } from '../../../../core/ui/utilities/utilities-layout.js';
import { ModelRegistry, ModelLifecycle } from '../../../../core/ui-next/services/model-registry.js';
import { useLocalPlayerId, createEngineEvent } from '../../../../core/ui-next/utilities/game-core-utilities.js';
import { LayoutModel } from '../../../../core/ui-next/utilities/layout-utilities.js';
import { addAvailableCard, removeAvailableCard, getLegacyCardStyling, parseCardText, getLegacyTypeFromCardID, isCrisis, getStylingFromTag, selectCapital, markCompletedDeck } from './legacies-support.js';

/*
 * Zatygold's Observer Mode - base-game override.
 * Copied verbatim from the game's base-standard/ui-next/screens/legacies/dedications-model.js
 * (build dated 2026-09-16). The only changes are marked "ZOM:": for the
 * Observer the dedications shown are the viewed leader's; game actions keep the
 * real local player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */

var DedicationsFilterOptions = /* @__PURE__ */ ((DedicationsFilterOptions2) => {
  DedicationsFilterOptions2["ALL"] = "ALL";
  DedicationsFilterOptions2["DEFAULT"] = "DEFAULT";
  DedicationsFilterOptions2["CULTURAL"] = "CULTURAL";
  DedicationsFilterOptions2["DIPLOMATIC"] = "DIPLOMATIC";
  DedicationsFilterOptions2["ECONOMIC"] = "ECONOMIC";
  DedicationsFilterOptions2["EXPANSIONIST"] = "EXPANSIONIST";
  DedicationsFilterOptions2["MILITARISTIC"] = "MILITARISTIC";
  DedicationsFilterOptions2["SCIENTIFIC"] = "SCIENTIFIC";
  DedicationsFilterOptions2["CRISIS"] = "CRISIS";
  return DedicationsFilterOptions2;
})(DedicationsFilterOptions || {});
const CreateDedicationsModel = () => {
  const SMALL_SCREEN_MODE_MAX_HEIGHT = 800;
  const SMALL_SCREEN_MODE_MAX_WIDTH = 1e3;
  const DEDICATIONS_SLOT_IDS = ["Slot1", "Slot2", "Slot3"];
  const DEDICATIONS_AVAILABLE_ID = "Available";
  const isSmallScreen = createMemo(() => {
    const isMobileViewExperience = UI.getViewExperience() == UIViewExperience.Mobile;
    const layoutModel = LayoutModel.get();
    return isMobileViewExperience || layoutModel.screenHeight() <= Layout.pixelsToScreenPixels(SMALL_SCREEN_MODE_MAX_HEIGHT) || layoutModel.screenWidth() <= Layout.pixelsToScreenPixels(SMALL_SCREEN_MODE_MAX_WIDTH);
  });
  const realLocalPlayerID = useLocalPlayerId();
  const localPlayerID = () => globalThis.ZOMLeaderView?.playerID() ?? realLocalPlayerID();   // ZOM: the viewed leader
  const playerLegacyCompleted = createEngineEvent("PlayerLegacyCompleted");
  const [selectedDedicationFilter, setSelectedDedicationFilter] = createSignal(
    "ALL" /* ALL */
  );
  const [selectedCapital, setSelectedCapital] = createSignal(
    getCapital() !== null ? getCapital().id : void 0
  );
  const isAdvancedStart = createMemo(
    () => GameInfo.Ages.lookup(Game.age)?.AgeType != "AGE_ANTIQUITY" && Configuration.getGame().previousAgeCount == 0
  );
  const [state, setState] = createStore({
    assignedItems: [
      ...DEDICATIONS_SLOT_IDS.map((slotID) => {
        return { id: "Empty", containerID: slotID };
      })
    ],
    containers: [
      ...DEDICATIONS_SLOT_IDS.map((slotID) => {
        return { id: slotID, maxCount: 1, canSwap: true };
      }),
      { id: DEDICATIONS_AVAILABLE_ID, maxCount: -1, canSwap: false }
    ],
    items: populateDedicationData(),
    legacies: populateLegaciesData(),
    selectedItems: getSelectedItems()
  });
  const pendingToAdd = [];
  const isDeckFull = createMemo(() => state.selectedItems.length == DEDICATIONS_SLOT_IDS.length);
  onMount(() => {
    autoSlotSelectedItems();
    if (isAdvancedStart()) {
      engine.on("AdvancedStartCardAdded", setSelectedItems);
      engine.on("AdvancedStartCardRemoved", setSelectedItems);
    }
  });
  onCleanup(() => {
    if (isAdvancedStart()) {
      engine.off("AdvancedStartCardAdded", setSelectedItems);
      engine.off("AdvancedStartCardRemoved", setSelectedItems);
    }
  });
  createEffect(() => {
    if (localPlayerID() != PlayerIds.NO_PLAYER) {
      setState("items", populateDedicationData());
      setState("legacies", populateLegaciesData());
      setState("selectedItems", getSelectedItems());
    }
  });
  createEffect(
    on(playerLegacyCompleted, (data) => {
      if (!data) {
        return;
      }
      const legacyDef = GameInfo.Legacies.lookup(data.legacy);
      if (!legacyDef) {
        console.error(
          "dedications-model: Unable to find triumph definition for triumph of type: " + data.legacy
        );
        return;
      }
      if (data.player != localPlayerID()) {
        return;
      }
      setState("legacies", populateLegaciesData());
    })
  );
  const updatePendingCards = () => {
    pendingToAdd.forEach((item2) => {
      if (!isItemInCardDeck(item2)) {
        addAvailableCard(item2);
      }
    });
    pendingToAdd.length = 0;
  };
  createEffect(() => {
    const slotItems = state.items.filter((item2) => DEDICATIONS_SLOT_IDS.includes(item2.containerID));
    const availableItems = state.items.filter((item2) => item2.containerID == DEDICATIONS_AVAILABLE_ID);
    slotItems.forEach((slotItem) => {
      setState("assignedItems", (item2) => item2.containerID == slotItem.containerID, "id", slotItem.id);
      if (!isItemInCardDeck(slotItem.id)) {
        if (isDeckFull()) {
          pendingToAdd.push(slotItem.id);
        } else {
          addAvailableCard(slotItem.id);
        }
      }
    });
    availableItems.forEach((availableItem) => {
      setState("assignedItems", (item2) => item2.id == availableItem.id, "id", "Empty");
      if (isItemInCardDeck(availableItem.id)) {
        removeAvailableCard(availableItem.id);
        updatePendingCards();
      }
    });
    items(DEDICATIONS_AVAILABLE_ID).forEach((item2) => {
      setState("items", (i) => i.id == item2.id, "isDisabled", isCapitalCardSlotted(item2.id));
    });
  });
  function getSelectedItems() {
    const advancedStart = getAdvancedStart();
    if (!advancedStart) {
      return [];
    }
    const selectedCards = advancedStart.getCards();
    return selectedCards;
  }
  function autoSlotSelectedItems() {
    if (isAdvancedStart()) {
      return;
    }
    state.selectedItems.forEach((item2) => {
      if (canAutoSlotItem(item2.info.id)) {
        autoSlotItem(item2.info.id);
      }
    });
  }
  function setSelectedItems() {
    setState("selectedItems", getSelectedItems());
  }
  function updateSelectedItems() {
    const selectedItems = getSelectedItems();
    const modelItems = state.selectedItems;
    if (selectedItems.length == 0 && modelItems.length == 0) {
      return;
    }
    const selectedFiltered = selectedItems.filter(
      (selected) => !modelItems.some((item2) => selected.info.id == item2.info.id)
    );
    const modelFiltered = modelItems.filter(
      (selected) => !selectedItems.some((item2) => selected.info.id == item2.info.id)
    );
    selectedFiltered.forEach((item2) => {
      if (canAutoSlotItem(item2.info.id)) {
        autoSlotItem(item2.info.id);
      }
    });
    modelFiltered.forEach((item2) => {
      unEquipItem(item2.info.id);
    });
    setState("selectedItems", selectedItems);
  }
  function isCapitalCardSlotted(itemID) {
    if (itemID.includes("CHANGE_CAPITAL")) {
      return DEDICATIONS_SLOT_IDS.some((id) => items(id).some((item2) => item2.id.includes("CHANGE_CAPITAL")));
    }
    return false;
  }
  function isCapitalCardInDeck(itemID) {
    if (itemID.includes("CHANGE_CAPITAL")) {
      return getSelectedItems().some((item2) => item2.info.id.includes("CHANGE_CAPITAL"));
    }
    return false;
  }
  function getAdvancedStart() {
    if (GameContext.localObserverID == PlayerIds.NO_PLAYER || GameContext.localObserverID == PlayerIds.OBSERVER_ID || Autoplay.isActive) {
      return null;
    }
    const localPlayer = Players.get(localPlayerID());
    if (!localPlayer) {
      console.error(`dedications-model: Failed to retrieve PlayerLibrary for Player ${localPlayerID()}`);
      return null;
    }
    const playerAdvancedStart = localPlayer.AdvancedStart;
    if (!playerAdvancedStart) {
      console.error(`dedications-model: Failed to retrieve PlayerAdvancedStart for Player ${localPlayerID()}`);
      return null;
    }
    return playerAdvancedStart;
  }
  function populateDedicationData() {
    const allDedicationsData = [];
    const advancedStart = getAdvancedStart();
    if (!advancedStart) {
      return [];
    }
    for (const cardInfo of advancedStart.getAvailableCards()) {
      allDedicationsData.push(createDedicationData(cardInfo));
    }
    return allDedicationsData;
  }
  function populateLegaciesData() {
    const allLegacyData = [];
    const playerLegacies = Players.get(localPlayerID())?.Legacies;
    if (!playerLegacies) {
      return [];
    }
    GameInfo.Legacies.forEach((triumph) => {
      if (!playerLegacies.isValidLegacy(triumph.LegacyType)) {
        return;
      }
      if (triumph.MajorLegacy && playerLegacies.isTriggered(triumph.LegacyType)) {
        allLegacyData.push(createLegacyData(triumph));
      }
    });
    return allLegacyData;
  }
  function createLegacyData(legacyInfo) {
    const { tagType, traitIcon, descriptionBG } = getLegacyCardStyling(legacyInfo.LegacyType);
    const legacyData = {
      containerID: DEDICATIONS_AVAILABLE_ID,
      id: legacyInfo.LegacyType,
      type: legacyInfo.LegacyType,
      title: Locale.compose(legacyInfo.Name),
      description: parseCardText(legacyInfo.Description),
      traitIcon,
      descriptionBG,
      isDisabled: isCapitalCardInDeck(legacyInfo.LegacyType),
      filterOptions: ["ALL" /* ALL */, tagType]
    };
    return legacyData;
  }
  function createDedicationData(cardInfo) {
    let { tagType, traitIcon, descriptionBG } = getLegacyCardStyling(getLegacyTypeFromCardID(cardInfo.id));
    if (tagType.length == 0 && isCrisis(cardInfo)) {
      tagType = "CRISIS";
      traitIcon = getStylingFromTag("CRISIS").traitIcon;
      descriptionBG = getStylingFromTag("CRISIS").descriptionBG;
    }
    const legacyData = {
      containerID: DEDICATIONS_AVAILABLE_ID,
      id: cardInfo.id,
      type: cardInfo.id,
      title: Locale.compose(cardInfo.name),
      description: parseCardText(cardInfo.description),
      traitIcon,
      descriptionBG,
      isDisabled: isCapitalCardInDeck(cardInfo.id),
      filterOptions: ["ALL" /* ALL */, tagType != "" ? tagType : "DEFAULT" /* DEFAULT */]
    };
    return legacyData;
  }
  function contains(itemID, containerID) {
    const item2 = state.items.find((item3) => item3.id == itemID);
    return item2 && item2.containerID == containerID;
  }
  function canContain(containerID) {
    const container = state.containers.find((c) => c.id == containerID);
    if (container == null) {
      return false;
    }
    if (container.canSwap) {
      return true;
    }
    if (container.maxCount != -1) {
      let count = 0;
      for (const item2 of state.items) {
        if (item2.containerID == containerID) {
          count++;
        }
      }
      if (count >= container.maxCount) {
        return false;
      }
    }
    return true;
  }
  function item(itemID) {
    return state.items.find((item2) => item2.id == itemID);
  }
  function items(containerID) {
    return state.items.filter((item2) => item2.containerID == containerID);
  }
  function isItemInCardDeck(itemID) {
    const advancedStart = getAdvancedStart();
    if (!advancedStart) {
      return false;
    }
    const selectedCards = advancedStart.getCards();
    return selectedCards.some((card) => card.info.id == itemID);
  }
  function equipItem(itemID, containerID) {
    const item2 = state.items.find((item3) => item3.id == itemID);
    const container = state.containers.find((c) => c.id == containerID);
    if (item2 == null) {
      return;
    }
    if (container == null) {
      return;
    }
    if (item2.containerID == containerID) {
      return;
    }
    if (!canContain(containerID) || item2.isDisabled) {
      return;
    }
    setState("items", (item3) => item3.id == itemID, "containerID", containerID);
  }
  function unEquipItem(itemID) {
    const item2 = state.items.find((item3) => item3.id == itemID);
    if (item2 == null) {
      return;
    }
    if (item2.containerID == "Available") {
      return;
    }
    setState("items", (item3) => item3.id == itemID, "containerID", "Available");
  }
  function swapItem(itemID, containerID) {
    const container = state.containers.find((c) => c.id == containerID);
    if (container && container.maxCount > 1) {
      return false;
    }
    const itemInContainer = items(containerID)[0];
    const containerFromItem = state.assignedItems.find((i) => i.id == itemID)?.containerID;
    if (containerFromItem && DEDICATIONS_SLOT_IDS.includes(containerFromItem)) {
      equipItem(itemID, containerID);
      equipItem(itemInContainer.id, containerFromItem);
    } else if (itemInContainer && contains(itemInContainer.id, containerID)) {
      unEquipItem(itemInContainer.id);
      equipItem(itemID, containerID);
      return true;
    }
    return false;
  }
  function hasItem(containerID) {
    const container = state.containers.find((c) => c.id == containerID);
    if (container && container.maxCount != 1) {
      return false;
    }
    return items(containerID).length > 0;
  }
  function canAutoSlotItem(itemID) {
    const item2 = state.items.find((e) => e.id == itemID);
    if (item2) {
      if (DEDICATIONS_SLOT_IDS.includes(item2.containerID)) {
        return false;
      }
      for (const containerID of DEDICATIONS_SLOT_IDS) {
        if (state.items.every((e) => e.containerID != containerID) && canContain(containerID)) {
          return true;
        }
      }
    }
    return false;
  }
  function autoSlotItem(itemID) {
    const item2 = state.items.find((e) => e.id == itemID);
    if (item2) {
      if (DEDICATIONS_SLOT_IDS.includes(item2.containerID)) {
        return;
      }
      for (const containerID of DEDICATIONS_SLOT_IDS) {
        if (state.items.every((e) => e.containerID != containerID) && canContain(containerID)) {
          equipItem(itemID, containerID);
          return;
        }
      }
    }
  }
  function confirmDeck() {
    if (pendingToAdd.length > 0) {
      return;
    }
    applyEffects();
    const player = Players.get(localPlayerID());
    const changeName = player ? player.previousAgeCivilizationType != player.civilizationType : false;
    if (selectedCapital() !== void 0) {
      selectCapital(selectedCapital(), changeName);
    }
    markCompletedDeck();
  }
  function applyEffects() {
    const selectedCards = getSelectedItems();
    for (const card of selectedCards) {
      for (const effect of card.info.effects) {
        for (let i = 0; i < effect.amount; i++) {
          const args = { ID: effect.id };
          const result = Game.PlayerOperations.canStart(
            realLocalPlayerID() /* ZOM: real local player */,
            PlayerOperationTypes.ADVANCED_START_USE_EFFECT,
            args,
            false
          );
          if (result.Success) {
            Game.PlayerOperations.sendRequest(
              realLocalPlayerID() /* ZOM: real local player */,
              PlayerOperationTypes.ADVANCED_START_USE_EFFECT,
              args
            );
          } else {
            console.error(`dedications-model: Failed to apply effect when confirm deck: ${effect.id}`);
          }
        }
      }
    }
  }
  function isPlacementComplete() {
    const advancedStart = getAdvancedStart();
    if (!advancedStart) {
      return false;
    }
    return advancedStart.getPlacementComplete();
  }
  function getAllCapitals() {
    const playerCities = Players.get(localPlayerID())?.Cities;
    if (!playerCities) {
      return [];
    }
    const capitalIDs = playerCities.getPotentialSwitchCapitalCityIds();
    const capitals = capitalIDs.map((id) => Cities.get(id)).filter((city) => city != null);
    capitals.push(getCapital());
    return capitals;
  }
  function getSelectedCapitalCity() {
    const currentCapital = selectedCapital();
    return currentCapital ? Cities.get(currentCapital) : getCapital();
  }
  function getCapital() {
    const playerCities = Players.get(localPlayerID())?.Cities;
    if (!playerCities) {
      return null;
    }
    return playerCities.getCapital();
  }
  return {
    DEDICATIONS_SLOT_IDS,
    DEDICATIONS_AVAILABLE_ID,
    state,
    setState,
    contains,
    canContain,
    item,
    items,
    equipItem,
    unEquipItem,
    swapItem,
    hasItem,
    canAutoSlotItem,
    autoSlotItem,
    updateSelectedItems,
    applyEffects,
    confirmDeck,
    isPlacementComplete,
    selectedDedicationFilter,
    setSelectedDedicationFilter,
    selectedCapital,
    setSelectedCapital,
    getAllCapitals,
    getSelectedCapitalCity,
    isSmallScreen
  };
};
const DedicationsModel = ModelRegistry.register(
  "DedicationsModel",
  ModelLifecycle.SharedInstance,
  CreateDedicationsModel
);

export { DedicationsFilterOptions, DedicationsModel };
//# sourceMappingURL=dedications-model.js.map
