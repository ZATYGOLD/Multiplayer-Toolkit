import { createSignal } from '../../../core/vendor/solid-js/dist/solid.js';
import { createStore } from '../../../core/vendor/solid-js/store/dist/store.js';

/*
 * Zatygold's Observer Mode - base-game override.
 * Copied verbatim from the game's base-standard/ui/policies/policies-support.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)

function getCivIconFromPolicy(card) {
  if (card.TraitType) {
    if (card.TraitType.includes("ATTRIBUTE")) {
      return "fonticon_attribute";
    } else {
      return card.TraitType.replace("TRAIT_", "civ_sym_").toLowerCase();
    }
  }
  return "fonticon_tradition";
}
function getAdditionalPolicyIcon(card) {
  const localPlayer = Players.get(mptLocalPlayerID());
  const localPlayerCulture = localPlayer.Culture;
  if (!card.TraditionType) {
    return "";
  }
  const policyIdeology = localPlayerCulture.getIdeologyForTradition(card.TraditionType);
  if (policyIdeology) {
    switch (policyIdeology) {
      case Database.makeHash("IDEOLOGY_COMMUNISM"): {
        return "govt_mini_comm";
      }
      case Database.makeHash("IDEOLOGY_DEMOCRACY"): {
        return "govt_mini_demo";
      }
      case Database.makeHash("IDEOLOGY_FASCISM"): {
        return "govt_idea_faci";
      }
      default:
        return "";
    }
  } else {
    return "";
  }
}
function getCivBGFromPolicy(card) {
  if (card.TraitType) {
    return card.TraitType.replace("TRAIT_", "bg-panel-").toLowerCase();
  }
  return "";
}
const calculateGovtCardHeights = (root) => {
  if (!root) {
    return;
  }
  const cards = Array.from(root.querySelectorAll(".policy-base-card"));
  if (cards.length === 0) {
    return;
  }
  cards.forEach((card) => card.style.height = "");
  waitForLayout(() => {
    const tallestCardHeight = Math.max(...cards.map((card) => card.offsetHeight));
    setGovtCardHeight("110px");
    setGovtCardHeight(tallestCardHeight + "px");
  });
};
const [activePolicyCards, setActivePolicyCards] = createStore([]);
const [availablePolicyCards, setAvailablePolicyCards] = createStore([]);
const [activeTraditionCards, setActiveTraditionCards] = createStore([]);
const [availableTraditionCards, setAvailableTraditionCards] = createStore([]);
const [activeCrisisCards, setActiveCrisisCards] = createStore([]);
const [availableCrisisCards, setAvailableCrisisCards] = createStore([]);
const [policiesFocus, setPolicySlotsFocused] = createSignal(false);
const [traditionsFocus, setTraditionSlotsFocused] = createSignal(false);
const [maxGovtCardHeight, setGovtCardHeight] = createSignal(void 0);

export { activeCrisisCards, activePolicyCards, activeTraditionCards, availableCrisisCards, availablePolicyCards, availableTraditionCards, calculateGovtCardHeights, getAdditionalPolicyIcon, getCivBGFromPolicy, getCivIconFromPolicy, maxGovtCardHeight, policiesFocus, setActiveCrisisCards, setActivePolicyCards, setActiveTraditionCards, setAvailableCrisisCards, setAvailablePolicyCards, setAvailableTraditionCards, setGovtCardHeight, setPolicySlotsFocused, setTraditionSlotsFocused, traditionsFocus };
//# sourceMappingURL=policies-support.js.map
