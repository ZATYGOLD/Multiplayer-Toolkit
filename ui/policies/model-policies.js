import { createMemo, onCleanup, createContext, useContext } from '../../../core/vendor/solid-js/dist/solid.js';
import { createMutable } from '../../../core/vendor/solid-js/store/dist/store.js';
import { ContextManager } from '../../../core/ui/context-manager/context-manager.js';
import { Layout } from '../../../core/ui/utilities/utilities-layout.js';
import { IsControllerActive } from '../../../core/ui-next/services/input.js';
import { ModelRegistry, ModelLifecycle } from '../../../core/ui-next/services/model-registry.js';
import { LayoutModel } from '../../../core/ui-next/utilities/layout-utilities.js';
import { activeTraditionCards, activePolicyCards, activeCrisisCards, availablePolicyCards, setAvailablePolicyCards, setActivePolicyCards, setActiveTraditionCards, availableTraditionCards, setAvailableTraditionCards, availableCrisisCards, setAvailableCrisisCards, setActiveCrisisCards } from './policies-support.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui/policies/model-policies.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)

var PolicyCardIdeology = /* @__PURE__ */ ((PolicyCardIdeology2) => {
  PolicyCardIdeology2[PolicyCardIdeology2["NONE"] = 0] = "NONE";
  PolicyCardIdeology2[PolicyCardIdeology2["COMMUNISM"] = 1] = "COMMUNISM";
  PolicyCardIdeology2[PolicyCardIdeology2["DEMOCRACY"] = 2] = "DEMOCRACY";
  PolicyCardIdeology2[PolicyCardIdeology2["FASCISM"] = 3] = "FASCISM";
  PolicyCardIdeology2[PolicyCardIdeology2["TRADITION"] = 4] = "TRADITION";
  return PolicyCardIdeology2;
})(PolicyCardIdeology || {});
let policiesToAdd = [];
let policiesToRemove = [];
let policiesWasTradition = [];
const allActive = createMemo(() => [...activeTraditionCards, ...activePolicyCards]);
function createPoliciesModel() {
  onCleanup(() => {
    clearArrays();
    handleConsideredPolicies();
  });
  let _activePolicies = [];
  let _availablePolicies = [];
  let _activeTraditions = [];
  let _availableTraditions = [];
  let _activeCrisisPolicies = [];
  let _availableCrisisPolicies = [];
  let _slots = 0;
  let _policySlots = 0;
  let _tradSlots = 0;
  let _crisisSlots = 0;
  const localPlayer = Players.get(mptLocalPlayerID());
  const localPlayerCulture = localPlayer.Culture;
  const unlockedPolicies = localPlayerCulture.getUnlockedTraditions(
    CultureSlotTypes.POLICY_CULTURE_SLOT
  );
  const unlockedTraditions = localPlayerCulture.getUnlockedTraditions(
    CultureSlotTypes.TRADITION_CULTURE_SLOT
  );
  const unlockedCrises = localPlayerCulture.getUnlockedTraditions(
    CultureSlotTypes.CRISIS_CULTURE_SLOT
  );
  _slots = localPlayerCulture.getNumAllCultureSlots();
  _tradSlots = localPlayerCulture.getNumCultureSlots(CultureSlotTypes.TRADITION_CULTURE_SLOT);
  _policySlots = localPlayerCulture.getNumCultureSlots(CultureSlotTypes.POLICY_CULTURE_SLOT);
  _crisisSlots = localPlayerCulture.getNumCultureSlots(CultureSlotTypes.CRISIS_CULTURE_SLOT);
  const canSwapNormalPolicies = localPlayerCulture.canSwapCultureSlot(
    CultureSlotTypes.POLICY_CULTURE_SLOT || CultureSlotTypes.TRADITION_CULTURE_SLOT
  );
  const canSwapCrisisPolicies = localPlayerCulture.canSwapCultureSlot(CultureSlotTypes.CRISIS_CULTURE_SLOT);
  const newTraditionsAndPolicies = localPlayerCulture.getAllRecentUnlockedTraditions();
  const newCardsDot = [];
  for (const item of newTraditionsAndPolicies) {
    const newItem = GameInfo.Traditions.lookup(item);
    newCardsDot.push(newItem);
  }
  const SMALL_SCREEN_MODE_MAX_HEIGHT = 1e3;
  const SMALL_SCREEN_MODE_MAX_WIDTH = 1700;
  const layout = LayoutModel.get();
  const isSmallScreenSize = createMemo(() => {
    const isMobileViewExperience = UI.getViewExperience() == UIViewExperience.Mobile;
    return isMobileViewExperience || layout.screenHeight() <= Layout.pixelsToScreenPixels(SMALL_SCREEN_MODE_MAX_HEIGHT) || layout.screenWidth() <= Layout.pixelsToScreenPixels(SMALL_SCREEN_MODE_MAX_WIDTH) || layout.screenWidth() / layout.screenHeight() < 1.34;
  });
  function getAvailablePolicies() {
    _availablePolicies = [];
    for (const policyTypeHash of unlockedPolicies) {
      const policyInfo = GameInfo.Traditions.lookup(policyTypeHash);
      if (policyInfo && !localPlayerCulture.isTraditionActive(policyTypeHash)) {
        _availablePolicies.push(policyInfo);
      }
    }
    return _availablePolicies.reverse();
  }
  function getAvailableTraditions() {
    _availableTraditions = [];
    for (const policyTypeHash of unlockedTraditions) {
      const policyInfo = GameInfo.Traditions.lookup(policyTypeHash);
      if (policyInfo && !localPlayerCulture.isTraditionActive(policyTypeHash)) {
        _availableTraditions.push(policyInfo);
      }
    }
    return _availableTraditions.reverse();
  }
  function getAvailableCrises() {
    _availableCrisisPolicies = [];
    for (const policyTypeHash of unlockedCrises) {
      const policyInfo = GameInfo.Traditions.lookup(policyTypeHash);
      if (policyInfo && !localPlayerCulture.isTraditionActive(policyTypeHash)) {
        _availableCrisisPolicies.push(policyInfo);
      }
    }
    return _availableCrisisPolicies.reverse();
  }
  function getActivePolicies() {
    _activePolicies = [];
    const activeLaws = localPlayerCulture.getActiveTraditions(
      CultureSlotTypes.POLICY_CULTURE_SLOT
    );
    for (const policy of activeLaws) {
      const policyDef = GameInfo.Traditions.lookup(policy);
      if (policyDef) {
        _activePolicies.push(policyDef);
      }
    }
    return _activePolicies;
  }
  function getActiveTraditions() {
    _activeTraditions = [];
    const activeTraditions = localPlayerCulture.getActiveTraditions(
      CultureSlotTypes.TRADITION_CULTURE_SLOT
    );
    for (const policy of activeTraditions) {
      const policyDef = GameInfo.Traditions.lookup(policy);
      if (policyDef) {
        _activeTraditions.push(policyDef);
      }
    }
    return _activeTraditions;
  }
  function getActiveCrises() {
    _activeCrisisPolicies = [];
    const activeCrises = localPlayerCulture.getActiveTraditions(
      CultureSlotTypes.CRISIS_CULTURE_SLOT
    );
    for (const policy of activeCrises) {
      const policyDef = GameInfo.Traditions.lookup(policy);
      if (policyDef) {
        _activeCrisisPolicies.push(policyDef);
      }
    }
    return _activeCrisisPolicies;
  }
  const tradSlotsAvail = createMemo(() => _tradSlots - activeTraditionCards.length);
  const policySlotsAvail = createMemo(() => _policySlots - activePolicyCards.length);
  const crisisSlotsAvail = createMemo(() => _crisisSlots - activeCrisisCards.length);
  function moveItem(card, source, setSource, setTarget, target) {
    const item = source.find((i) => i === card);
    if (!item) return;
    setSource(source.filter((i) => i !== card));
    setTarget([...target, item]);
  }
  const policyToActive = (card) => moveItem(card, availablePolicyCards, setAvailablePolicyCards, setActivePolicyCards, activePolicyCards);
  const policyToAvailable = (card) => moveItem(card, activePolicyCards, setActivePolicyCards, setAvailablePolicyCards, availablePolicyCards);
  const policyToTradition = (card) => moveItem(card, availablePolicyCards, setAvailablePolicyCards, setActiveTraditionCards, activeTraditionCards);
  const traditionToPolicy = (card) => moveItem(card, activeTraditionCards, setActiveTraditionCards, setAvailablePolicyCards, availablePolicyCards);
  const traditionToActive = (card) => moveItem(
    card,
    availableTraditionCards,
    setAvailableTraditionCards,
    setActiveTraditionCards,
    activeTraditionCards
  );
  const traditionToAvailable = (card) => moveItem(
    card,
    activeTraditionCards,
    setActiveTraditionCards,
    setAvailableTraditionCards,
    availableTraditionCards
  );
  const crisisToActive = (card) => moveItem(card, availableCrisisCards, setAvailableCrisisCards, setActiveCrisisCards, activeCrisisCards);
  const crisisToAvailable = (card) => moveItem(card, activeCrisisCards, setActiveCrisisCards, setAvailableCrisisCards, availableCrisisCards);
  const activeTraditionToActivePolicy = (card) => moveItem(card, activeTraditionCards, setActiveTraditionCards, setActivePolicyCards, activePolicyCards);
  function isInTradSlot(card) {
    if (activeTraditionCards.includes(card)) {
      return true;
    } else {
      return false;
    }
  }
  function fallbackPolicyFocus(card) {
    if (availableTraditionCards.length > 0) {
      model.autoFocusCard = availableTraditionCards[availableTraditionCards.indexOf(card) + 1].$index ?? -1;
    } else {
      model.autoFocusCard = allActive()[allActive().indexOf(card) + 1].$index ?? -1;
    }
  }
  function fallbackTraditionFocus(card) {
    if (availablePolicyCards.length > 0) {
      model.autoFocusCard = availablePolicyCards[availablePolicyCards.indexOf(card) + 1].$index ?? -1;
    } else {
      model.autoFocusCard = allActive()[allActive().indexOf(card) + 1].$index ?? -1;
    }
  }
  function fallbackActivePolicyFocus(card) {
    if (availableTraditionCards.length > 0) {
      model.autoFocusCard = availableTraditionCards[availableTraditionCards.indexOf(card) + 1].$index ?? -1;
    } else {
      model.autoFocusCard = availablePolicyCards[availablePolicyCards.indexOf(card) + 1].$index ?? -1;
    }
  }
  function resolveLocalFocus(card) {
    if (activeCrisisCards.includes(card) || availableCrisisCards.includes(card)) {
      return;
    }
    if (availablePolicyCards.includes(card)) {
      if (availablePolicyCards.indexOf(card) == 0) {
        if (availablePolicyCards.length > 1) {
          model.autoFocusCard = availablePolicyCards[availablePolicyCards.indexOf(card) + 1].$index ?? -1;
          return;
        } else {
          fallbackPolicyFocus(card);
          return;
        }
      }
      model.autoFocusCard = availablePolicyCards[availablePolicyCards.indexOf(card) - 1].$index ?? -1;
      if (model.autoFocusCard == -1) {
        fallbackPolicyFocus(card);
      }
    }
    if (availableTraditionCards.includes(card)) {
      if (availableTraditionCards.indexOf(card) == 0) {
        if (availableTraditionCards.length > 1) {
          model.autoFocusCard = availableTraditionCards[availableTraditionCards.indexOf(card) + 1].$index ?? -1;
          return;
        } else {
          fallbackTraditionFocus(card);
          return;
        }
      }
      model.autoFocusCard = availableTraditionCards[availableTraditionCards.indexOf(card) - 1].$index ?? -1;
      if (model.autoFocusCard == -1) {
        fallbackTraditionFocus(card);
      }
    }
    if (allActive().includes(card)) {
      if (allActive().indexOf(card) == 0) {
        if (allActive().length > 1) {
          model.autoFocusCard = allActive()[allActive().indexOf(card) + 1].$index ?? -1;
          return;
        } else {
          fallbackActivePolicyFocus(card);
          return;
        }
      }
      model.autoFocusCard = allActive()[allActive().indexOf(card) - 1].$index ?? -1;
      if (model.autoFocusCard == -1) {
        fallbackActivePolicyFocus(card);
      }
    }
  }
  function handleOnCardClick(card, active) {
    if (IsControllerActive()) {
      resolveLocalFocus(card);
    }
    if (active) {
      activeToAvailable(card);
      if (policiesToAdd.includes(card)) {
        const index = policiesToAdd.indexOf(card);
        policiesToAdd.splice(index, 1);
      } else {
        policiesToRemove.push(card);
      }
    } else {
      if (availableToActive(card)) {
        if (policiesToRemove.includes(card) && !policiesWasTradition.includes(card)) {
          const index = policiesToRemove.indexOf(card);
          policiesToRemove.splice(index, 1);
        } else {
          policiesToAdd.push(card);
        }
      }
    }
  }
  function activeToAvailable(card) {
    const c = card.CultureSlotType;
    if (c == "CRISIS_CULTURE_SLOT") {
      crisisToAvailable(card);
    }
    if (c == "POLICY_CULTURE_SLOT" && !isInTradSlot(card)) {
      policyToAvailable(card);
    }
    if (c == "POLICY_CULTURE_SLOT" && isInTradSlot(card)) {
      traditionToPolicy(card);
      if (!policiesWasTradition.includes(card)) {
        policiesWasTradition.push(card);
      }
    } else if (c == "TRADITION_CULTURE_SLOT") {
      traditionToAvailable(card);
    }
  }
  function availableToActive(card) {
    const c = card.CultureSlotType;
    if (c == "CRISIS_CULTURE_SLOT") {
      if (crisisSlotsAvail() < 1) {
        return false;
      }
      crisisToActive(card);
      return true;
    }
    if (c == "POLICY_CULTURE_SLOT") {
      if (policySlotsAvail() < 1 && tradSlotsAvail() > 0) {
        policyToTradition(card);
        return true;
      } else if (policySlotsAvail() > 0) {
        policyToActive(card);
        return true;
      } else {
        return false;
      }
    }
    if (c == "TRADITION_CULTURE_SLOT") {
      if (tradSlotsAvail() > 0) {
        traditionToActive(card);
        return true;
      }
      const policiesInTraditionSlots = activeTraditionCards.filter(
        (card2) => card2.CultureSlotType == "POLICY_CULTURE_SLOT"
      );
      if (policiesInTraditionSlots.length > 0 && policySlotsAvail() > 0) {
        const movingCard = policiesInTraditionSlots[0];
        activeTraditionToActivePolicy(movingCard);
        traditionToActive(card);
        if (!policiesWasTradition.includes(movingCard)) {
          policiesWasTradition.push(movingCard);
        }
        if (policiesToAdd.includes(movingCard)) {
          const index = policiesToAdd.indexOf(movingCard);
          policiesToAdd.splice(index, 1);
        } else {
          policiesToRemove.push(movingCard);
        }
        if (policiesToRemove.includes(movingCard) && !policiesWasTradition.includes(movingCard)) {
          const index = policiesToRemove.indexOf(movingCard);
          policiesToRemove.splice(index, 1);
        } else {
          policiesToAdd.push(movingCard);
        }
        return true;
      } else {
        return false;
      }
    }
    return false;
  }
  function handleCanSlotCard(card) {
    const c = card.CultureSlotType;
    if (c == "CRISIS_CULTURE_SLOT") {
      return crisisSlotsAvail() > 0;
    } else if (c == "POLICY_CULTURE_SLOT") {
      if (policySlotsAvail() < 1 && tradSlotsAvail() > 0) {
        return true;
      } else if (policySlotsAvail() > 0) {
        return true;
      }
      return false;
    } else if (c == "TRADITION_CULTURE_SLOT") {
      if (tradSlotsAvail() > 0) {
        return true;
      }
      const policiesInTraditionSlots = activeTraditionCards.filter(
        (card2) => card2.CultureSlotType == "POLICY_CULTURE_SLOT"
      );
      if (policiesInTraditionSlots.length > 0 && policySlotsAvail() > 0) {
        return true;
      }
    }
    return false;
  }
  function clearArrays() {
    policiesToAdd = [];
    policiesToRemove = [];
    policiesWasTradition = [];
    _activeCrisisPolicies = [];
    _activePolicies = [];
    _activeTraditions = [];
    _availableCrisisPolicies = [];
    _availablePolicies = [];
    _availableTraditions = [];
    setActivePolicyCards([]);
    setActiveTraditionCards([]);
    setActiveCrisisCards([]);
    setAvailablePolicyCards([]);
    setAvailableTraditionCards([]);
    setAvailableCrisisCards([]);
  }
  function handleOnConfirmClick() {
    model.confirmDisable = true;
    applyNextPolicy();
  }
  function handleConsideredPolicies() {
    const result = Game.PlayerOperations.canStart(
      GameContext.localPlayerID,
      PlayerOperationTypes.CONSIDER_ASSIGN_TRADITIONS,
      {},
      false
    );
    if (result.Success) {
      Game.PlayerOperations.sendRequest(
        GameContext.localPlayerID,
        PlayerOperationTypes.CONSIDER_ASSIGN_TRADITIONS,
        {}
      );
    }
  }
  function applyNextPolicy() {
    if (policiesToRemove.length + policiesToAdd.length == 0) {
      model.confirmDisable = false;
      handleOnClose();
      return;
    }
    let policy = void 0;
    let operationParameter = null;
    if (policiesToRemove.length > 0) {
      policy = policiesToRemove.pop();
      operationParameter = PlayerOperationParameters.Deactivate;
    } else if (policiesToAdd.length > 0) {
      policy = policiesToAdd.pop();
      operationParameter = PlayerOperationParameters.Activate;
    }
    if (policy && operationParameter) {
      const args = {
        TraditionType: policy.$index,
        Action: operationParameter
      };
      const result = Game.PlayerOperations.canStart(
        GameContext.localPlayerID,
        PlayerOperationTypes.CHANGE_TRADITION,
        args,
        false
      );
      if (result.Success) {
        Game.PlayerOperations.sendRequest(
          GameContext.localPlayerID,
          PlayerOperationTypes.CHANGE_TRADITION,
          args
        );
        const eventHandle = engine.on("TraditionChanged", () => {
          applyNextPolicy();
          eventHandle.clear();
        });
      } else {
        console.error(
          "screen-policies: applyNextPolicy(): Unable to successfully activate/deactivate policy with index: ",
          policy.$index,
          " and type: ",
          policy.TraditionType
        );
      }
    } else {
      console.error("screen-policies: applyNextPolicy() - failed to start a tradition change operation!");
    }
  }
  function handleOnClose() {
    ContextManager.pop("screen-policies");
  }
  const mptReadOnly = mptLocalPlayerID() !== GameContext.localPlayerID;   // MPT: a viewed leader's policies cannot be changed
  const model = createMutable({
    activePolicies: getActivePolicies(),
    availablePolicies: getAvailablePolicies(),
    activeTraditions: getActiveTraditions(),
    availableTraditions: getAvailableTraditions(),
    activeCrisisPolicies: getActiveCrises(),
    availableCrisisPolicies: getAvailableCrises(),
    newCards: newCardsDot,
    numSlots: _slots,
    policySlots: _policySlots,
    tradSlots: _tradSlots,
    crisisSlots: _crisisSlots,
    canSwapPolicies: !mptReadOnly && canSwapNormalPolicies,   // MPT
    canSwapCrisis: !mptReadOnly && canSwapCrisisPolicies,   // MPT
    confirmDisable: false,
    isSmallScreen: isSmallScreenSize,
    onCardClick: mptReadOnly ? () => {} : handleOnCardClick,   // MPT
    onConfirmClick: mptReadOnly ? handleOnClose : handleOnConfirmClick,   // MPT
    onCloseClick: handleOnClose,
    clearArrays,
    canSlotCard: mptReadOnly ? () => false : handleCanSlotCard,   // MPT
    autoFocusCard: getAvailablePolicies()[0] != void 0 ? getAvailablePolicies()[0].$index : -1
  });
  return model;
}
const PoliciesModel = ModelRegistry.register(
  "PoliciesScreenModel",
  ModelLifecycle.SharedInstance,
  createPoliciesModel
);
const PoliciesModelContext = createContext();
function usePoliciesModelContext() {
  const context = useContext(PoliciesModelContext);
  if (!context) {
    throw new Error("usePoliciesModelContext: Cannot find context!");
  }
  return context;
}

export { PoliciesModel, PoliciesModelContext, PolicyCardIdeology, createPoliciesModel, usePoliciesModelContext };
//# sourceMappingURL=model-policies.js.map
