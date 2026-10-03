import { Audio } from '../../../core/ui/audio-base/audio-support.js';
import { ContextManager } from '../../../core/ui/context-manager/context-manager.js';
import { DialogBoxManager } from '../../../core/ui/dialog-box/manager-dialog-box.js';
import { InputEngineEventName } from '../../../core/ui/input/input-support.js';
import NavTray from '../../../core/ui/navigation-tray/model-navigation-tray.js';
import Panel from '../../../core/ui/panel-support.js';
import Databind from '../../../core/ui/utilities/utilities-core-databinding.js';
import { formatStringArrayAsNewLineText } from '../../../core/ui/utilities/utilities-core-textprovider.js';
import { MustGetElement } from '../../../core/ui/utilities/utilities-dom.js';
import { FocusManager } from '../../../core/ui-next/services/focus-manager.js';
import { isMobile } from '../../../core/ui-next/services/view-experience.js';
import { HideMiniMapEvent } from '../mini-map/panel-mini-map.js';
import content from './panel-belief-picker.html.js';
import styles from './panel-belief-picker.scss.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui/panel-belief-picker/panel-belief-picker.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)
const mptReadOnly = () => mptLocalPlayerID() !== GameContext.localPlayerID;   // MPT: viewing another leader: nothing can be chosen

var BeliefPickerSlotState = /* @__PURE__ */ ((BeliefPickerSlotState2) => {
  BeliefPickerSlotState2[BeliefPickerSlotState2["LOCKED"] = 0] = "LOCKED";
  BeliefPickerSlotState2[BeliefPickerSlotState2["OPEN"] = 1] = "OPEN";
  BeliefPickerSlotState2[BeliefPickerSlotState2["FILLEDSWAPPABLE"] = 2] = "FILLEDSWAPPABLE";
  BeliefPickerSlotState2[BeliefPickerSlotState2["FILLEDUNSWAPPABLE"] = 3] = "FILLEDUNSWAPPABLE";
  return BeliefPickerSlotState2;
})(BeliefPickerSlotState || {});
class PanelBeliefPicker extends Panel {
  onBackButtonListener = this.onBackButton.bind(this);
  engineInputListener = this.onEngineInput.bind(this);
  onReligionTabSelectedListener = this.onReligionTabSelected.bind(this);
  beliefConfirmButtonListener = this.onConfirm.bind(this);
  beliefChoiceMenuCloseListener = this.onCloseBeliefChoiceMenu.bind(this);
  beliefConfirmButton;
  backButton;
  allPlayerReligions = [];
  playerReligion;
  viewingReligion;
  beliefsToAdd = [];
  currentlySelectedBeliefSlot = null;
  mustCreateReligion = false;
  beliefChoiceMenuClose;
  religionFollowingPercentages = /* @__PURE__ */ new Map();
  beliefChoiceMenu;
  playerObject;
  customReligionName = "";
  selectedReligionType = "";
  canConfirm = false;
  onInitialize() {
    this.beliefConfirmButton = MustGetElement(".belief-picker_confirm", this.Root);
    this.beliefChoiceMenu = MustGetElement(".belief-choice-menu", this.Root);
    this.backButton = MustGetElement(".belief-picker_back", this.Root);
    this.beliefChoiceMenuClose = MustGetElement(".belief-choice-menu_close", this.beliefChoiceMenu);
    this.enableOpenSound = true;
    this.enableCloseSound = true;
  }
  onAttach() {
    super.onAttach();
    this.playAnimateInSound();
    const beliefSubsystemFrame = MustGetElement(".belief-picker_subsystem-frame", this.Root);
    beliefSubsystemFrame.addEventListener("subsystem-frame-close", () => {
      this.close();
    });
    this.beliefConfirmButton.addEventListener("action-activate", this.beliefConfirmButtonListener);
    this.beliefConfirmButton.setAttribute("data-audio-group-ref", "audio-panel-belief-picker");
    this.beliefConfirmButton.setAttribute("data-audio-activate-ref", "data-audio-confirm");
    this.backButton.addEventListener("action-activate", this.onBackButtonListener);
    this.beliefChoiceMenuClose.addEventListener("action-activate", this.beliefChoiceMenuCloseListener);
    const religionTypeAttribute = this.Root.getAttribute("selectedReligionType");
    const customNameAttribute = this.Root.getAttribute("customReligionName");
    if (religionTypeAttribute) {
      this.selectedReligionType = religionTypeAttribute;
      this.customReligionName = customNameAttribute ?? "";
      this.mustCreateReligion = true;
    }
    this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
    const player = Players.get(mptLocalPlayerID());
    if (!player) {
      console.error("panel-belief-picker: onAttach() - No player object found!");
      return;
    }
    this.playerObject = player;
    const pReligion = player.Religion;
    if (!pReligion) {
      console.error("panel-belief-picker: onAttach() - Player object had no religion!");
      return;
    }
    this.playerReligion = pReligion;
    this.constructAllPlayerReligionInfo();
    this.buildBeliefTabs();
    if (mptReadOnly()) this.beliefConfirmButton.classList.add("hidden");   // MPT: read-only
    const mptBar = globalThis.MPTLeaderView?.playerBar('panel-belief-picker');   // MPT: the Observer's leader picker, above the religion tabs
    const mptTabs = this.Root.querySelector(".belief-picker_belief-tabs");
    if (mptBar && mptTabs?.parentElement) mptTabs.parentElement.insertBefore(mptBar, mptTabs);
    const bottomContainer = MustGetElement(".belief-picker_bottom-container", this.Root);
    Databind.classToggle(bottomContainer, "hidden", `g_NavTray.isTrayRequired`);
    if (!this.mustCreateReligion || !this.allPlayerReligions.includes(this.playerReligion)) {
      this.backButton.classList.add("hidden");
    }
    window.dispatchEvent(new HideMiniMapEvent(true));
    waitForLayout(() => {
      const focusElement = MustGetElement(".belief-picker_belief-choices", this.Root);
      FocusManager.get().setFocus(focusElement);
    });
    if (isMobile()) {
      const religionIcon = MustGetElement(".belief-picker-main-icon", this.Root);
      religionIcon.classList.remove("justify-center");
      religionIcon.classList.add("justify-start");
      religionIcon.classList.add("ml-18");
    }
  }
  onDetach() {
    this.beliefConfirmButton.removeEventListener("action-activate", this.beliefConfirmButtonListener);
    this.backButton.removeEventListener("action-activate", this.onBackButtonListener);
    this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
    this.beliefChoiceMenuClose.removeEventListener("action-activate", this.beliefChoiceMenuCloseListener);
    window.dispatchEvent(new HideMiniMapEvent(false));
    super.onDetach();
  }
  onReceiveFocus() {
    super.onReceiveFocus();
    NavTray.clear();
    NavTray.addOrUpdateGenericBack();
    const focusElement = MustGetElement(".belief-picker_belief-choices", this.Root);
    FocusManager.get().setFocus(focusElement);
  }
  getHolyCityName() {
    if (!this.playerObject.Cities) {
      console.error("panel-belief-picker: getHolyCityName() - playerObject.Cities is undefined!");
      return "";
    }
    const foundCity = this.playerObject.Cities.getCities().find((city) => {
      return city.Constructibles?.hasConstructible("BUILDING_TEMPLE", false) || city.Constructibles?.hasConstructible("BUILDING_MOSQUE", false);
    });
    return foundCity?.name ?? "";
  }
  onBackButton() {
    ContextManager.push("panel-religion-picker", { singleton: true });
    this.close();
  }
  onConfirm() {
    if (mptReadOnly()) return;   // MPT: read-only
    if (this.mustCreateReligion) {
      this.foundReligion();
    } else {
      this.addAllBeliefs();
    }
  }
  onCloseBeliefChoiceMenu() {
    this.beliefChoiceMenu.classList.add("hidden");
    this.currentlySelectedBeliefSlot?.setAttribute("selected", "false");
    const focusElement = this.Root.querySelector(".belief-picker_belief-choices");
    if (focusElement) {
      FocusManager.get().setFocus(focusElement);
    }
  }
  buildBeliefWindow() {
    this.buildBeliefIdentity(this.viewingReligion);
    this.buildBeliefSlots(this.viewingReligion);
  }
  buildBeliefSlots(viewingReligion) {
    const enhancerContainer = MustGetElement(".belief-picker_belief-enhancer-container", this.Root);
    while (enhancerContainer.hasChildNodes()) {
      enhancerContainer.removeChild(enhancerContainer.lastChild);
    }
    const founderContainer = MustGetElement(".belief-picker_belief-founder-container", this.Root);
    while (founderContainer.hasChildNodes()) {
      founderContainer.removeChild(founderContainer.lastChild);
    }
    const relicContainer = MustGetElement(".belief-picker_belief-relic-container", this.Root);
    while (relicContainer.hasChildNodes()) {
      relicContainer.removeChild(relicContainer.lastChild);
    }
    const slotsToShow = [];
    for (let i = 0; i < 5; i++) {
      slotsToShow.push({ state: 0 /* LOCKED */ });
    }
    let currentFounderIndex = 1;
    if ((!this.mustCreateReligion || viewingReligion != this.playerReligion) && viewingReligion.hasCreatedReligion()) {
      const playerBeliefs = viewingReligion.getBeliefs();
      if (playerBeliefs) {
        for (const belief of playerBeliefs) {
          const beliefDef = GameInfo.Beliefs.lookup(belief);
          if (beliefDef == null) {
            console.error(
              `panel-belief-picker: buildBeliefContainer() - No belief definition found for belieftype ${belief}`
            );
            return;
          }
          const beliefSlotToAdd = { state: 3 /* FILLEDUNSWAPPABLE */, beliefDef };
          switch (beliefDef.BeliefClassType) {
            case "BELIEF_CLASS_ENHANCER":
              slotsToShow[4] = beliefSlotToAdd;
              break;
            case "BELIEF_CLASS_RELIQUARY":
              slotsToShow[0] = beliefSlotToAdd;
              break;
            case "BELIEF_CLASS_FOUNDER":
              slotsToShow[currentFounderIndex++] = beliefSlotToAdd;
              break;
          }
        }
      }
    }
    if (this.playerReligion == viewingReligion) {
      for (const [index, belief] of this.beliefsToAdd.entries()) {
        const beliefDef = GameInfo.Beliefs.lookup(belief);
        if (beliefDef == null) {
          console.error(
            `panel-belief-picker: buildBeliefContainer() - No belief definition found for belieftype to add ${belief}`
          );
          return;
        }
        const beliefSlotToAdd = {
          state: 2 /* FILLEDSWAPPABLE */,
          beliefDef,
          toAddIndex: index
        };
        switch (beliefDef.BeliefClassType) {
          case "BELIEF_CLASS_ENHANCER":
            slotsToShow[4] = beliefSlotToAdd;
            break;
          case "BELIEF_CLASS_RELIQUARY":
            slotsToShow[0] = beliefSlotToAdd;
            break;
          case "BELIEF_CLASS_FOUNDER":
            slotsToShow[currentFounderIndex++] = beliefSlotToAdd;
            break;
        }
      }
    }
    if (this.viewingReligion == this.playerReligion) {
      if (this.mustCreateReligion && slotsToShow[0].state != 2 /* FILLEDSWAPPABLE */ && slotsToShow[0].state != 3 /* FILLEDUNSWAPPABLE */) {
        slotsToShow[0].state = 1 /* OPEN */;
      } else if (viewingReligion.hasCreatedReligion() && slotsToShow[0].state != 2 /* FILLEDSWAPPABLE */ && slotsToShow[0].state != 3 /* FILLEDUNSWAPPABLE */) {
        slotsToShow[0].state = 1 /* OPEN */;
      }
      if (viewingReligion.getNumBeliefsEarned() >= 3 && slotsToShow[4].state != 2 /* FILLEDSWAPPABLE */ && slotsToShow[4].state != 3 /* FILLEDUNSWAPPABLE */) {
        slotsToShow[4].state = 1 /* OPEN */;
      }
      for (let i = 0; i < this.getNumFounderSlots(viewingReligion) - currentFounderIndex + 1; i++) {
        if (slotsToShow[currentFounderIndex].state != 2 /* FILLEDSWAPPABLE */ && slotsToShow[currentFounderIndex].state != 3 /* FILLEDUNSWAPPABLE */) {
          slotsToShow[currentFounderIndex].state = 1 /* OPEN */;
        }
      }
    }
    let hasOpenSlot = false;
    for (const [index, slot] of slotsToShow.entries()) {
      let container = null;
      let beliefClass = "";
      if (index == 4) {
        container = enhancerContainer;
        beliefClass = "BELIEF_CLASS_ENHANCER";
      } else if (index == 0) {
        container = relicContainer;
        beliefClass = "BELIEF_CLASS_RELIQUARY";
      } else {
        container = founderContainer;
        beliefClass = "BELIEF_CLASS_FOUNDER";
      }
      switch (slot.state) {
        case 0 /* LOCKED */:
          container.appendChild(this.createLockedSlotElement(beliefClass));
          break;
        case 1 /* OPEN */:
          container.appendChild(this.createOpenSlotElement(beliefClass));
          hasOpenSlot = true;
          break;
        case 2 /* FILLEDSWAPPABLE */:
          if (!slot.beliefDef) {
            console.error(
              `panel-belief-picker: buildBeliefContainer() - No belief definition found for swappable slot`
            );
            return;
          }
          if (slot.toAddIndex === void 0) {
            console.error(`panel-belief-picker: buildBeliefContainer() - Slot toAddIndex was undefined!`);
            return;
          }
          const newReplaceableSlot = this.createFilledSlotElement(slot.beliefDef);
          newReplaceableSlot.setAttribute("replacingIndex", slot.toAddIndex.toString());
          newReplaceableSlot.addEventListener("action-activate", () => {
            this.currentlySelectedBeliefSlot = newReplaceableSlot;
            this.openBeliefChooser(beliefClass);
            newReplaceableSlot.setAttribute("selected", "true");
          });
          container.appendChild(newReplaceableSlot);
          break;
        case 3 /* FILLEDUNSWAPPABLE */:
          if (!slot.beliefDef) {
            console.error(
              `panel-belief-picker: buildBeliefContainer() - No belief definition found for unswappable slot`
            );
            return;
          }
          const newUnreplacableSlot = this.createFilledSlotElement(slot.beliefDef);
          container.appendChild(newUnreplacableSlot);
          break;
        default:
          break;
      }
    }
    this.canConfirm = !hasOpenSlot && this.beliefsToAdd.length > 0 && this.playerReligion == this.viewingReligion;
    if (this.canConfirm) {
      NavTray.addOrUpdateShellAction1("LOC_UI_RESOURCE_ALLOCATION_CONFIRM");
    } else {
      NavTray.removeShellAction1();
    }
    this.beliefConfirmButton.setAttribute("disabled", (!this.canConfirm).toString());
    this.beliefConfirmButton.classList.toggle(
      "hidden",
      this.playerReligion != this.viewingReligion || !hasOpenSlot && this.beliefsToAdd.length == 0
    );
    const focusElement = MustGetElement(".belief-picker_belief-choices", this.Root);
    FocusManager.get().setFocus(focusElement);
  }
  buildBeliefIdentity(viewingReligion) {
    const beliefReligionName = MustGetElement(".belief-picker_belief-info-religion-name", this.Root);
    const beliefReligionIcon = MustGetElement(".belief-picker_belief-info-icon-image", this.Root);
    const beliefReligionFounder = MustGetElement(".belief-picker_belief-info-founder-name", this.Root);
    const beliefReligionHolyCity = MustGetElement(".belief-picker_belief-info-city-name", this.Root);
    const beliefReligionPercentFollowing = MustGetElement(
      ".belief-picker_belief-info-percent-following",
      this.Root
    );
    beliefReligionPercentFollowing.setAttribute(
      "data-l10n-id",
      Locale.compose(
        "LOC_UI_ESTABLISH_BELIEFS_PERCENT_FOLLOWING",
        this.religionFollowingPercentages.get(viewingReligion)
      )
    );
    if (this.mustCreateReligion && viewingReligion == this.playerObject.Religion) {
      const religionDef = GameInfo.Religions.lookup(this.selectedReligionType);
      const baseReligionName = religionDef ? religionDef.Name : "LOC_RELIGION_CUSTOM_NAME";
      if (this.customReligionName && this.customReligionName != baseReligionName) {
        beliefReligionName.setAttribute(
          "data-l10n-id",
          Locale.fromUGC(baseReligionName, this.customReligionName)
        );
      } else {
        beliefReligionName.setAttribute("data-l10n-id", baseReligionName);
      }
      beliefReligionIcon.style.backgroundImage = UI.getIconCSS(this.selectedReligionType, "RELIGION_DECO");
      beliefReligionFounder.setAttribute(
        "data-l10n-id",
        Locale.compose("LOC_UI_ESTABLISH_RELIGION_FOUNDER", this.playerObject.name)
      );
      beliefReligionHolyCity.setAttribute(
        "data-l10n-id",
        Locale.compose("LOC_UI_ESTABLISH_RELIGION_HOLY_CITY", this.getHolyCityName())
      );
    } else if (viewingReligion.hasCreatedReligion()) {
      const religionDef = GameInfo.Religions.lookup(viewingReligion.getReligionType());
      if (religionDef) {
        beliefReligionIcon.style.backgroundImage = UI.getIconCSS(religionDef.ReligionType, "RELIGION_DECO");
      }
      beliefReligionName.setAttribute("data-l10n-id", viewingReligion.getReligionName());
      const religionFounderName = Players.get(
        Game.Religion.getPlayerFromReligion(viewingReligion.getReligionType())
      )?.name;
      if (!religionFounderName) {
        console.error(
          `panel-belief-picker: buildBeliefIdentity() - no leader name found for religion type ${viewingReligion.getReligionType()}!`
        );
        return;
      }
      beliefReligionFounder.setAttribute(
        "data-l10n-id",
        Locale.compose("LOC_UI_ESTABLISH_RELIGION_FOUNDER", religionFounderName)
      );
      beliefReligionHolyCity.setAttribute(
        "data-l10n-id",
        Locale.compose("LOC_UI_ESTABLISH_RELIGION_HOLY_CITY", viewingReligion.getHolyCityName())
      );
    }
  }
  createFilledBeliefPickerNode(beliefDef) {
    let nodeIcon = "";
    switch (beliefDef.BeliefClassType) {
      case "BELIEF_CLASS_ENHANCER":
        nodeIcon = "fs://game/rel_bel_enhancer.png";
        break;
      case "BELIEF_CLASS_RELIQUARY":
        nodeIcon = "fs://game/rel_bel_reliquary.png";
        break;
      case "BELIEF_CLASS_FOUNDER":
        nodeIcon = "fs://game/rel_bel_founder.png";
        break;
    }
    const isSwappable = Game.Religion.isBeliefClaimable(beliefDef.BeliefType);
    return {
      name: beliefDef.Name,
      primaryIcon: nodeIcon,
      description: beliefDef.Description,
      isSwappable,
      isLocked: false
    };
  }
  createFilledSlotElement(beliefDef) {
    const filledSlot = document.createElement(
      "belief-picker-chooser-item"
    );
    filledSlot.whenComponentCreated((chooser) => {
      chooser.beliefPickerChooserNode = this.createFilledBeliefPickerNode(beliefDef);
    });
    return filledSlot;
  }
  createOpenBeliefPickerNode() {
    return {
      name: "",
      primaryIcon: "",
      description: "LOC_UI_ESTABLISH_BELIEFS_ADD_NEW_BELIEF",
      isLocked: false
    };
  }
  createOpenSlotElement(beliefClass) {
    const openSlot = document.createElement("belief-picker-chooser-item");
    openSlot.setAttribute("data-audio-group-ref", "audio-panel-belief-picker");
    openSlot.whenComponentCreated((chooser) => {
      chooser.beliefPickerChooserNode = this.createOpenBeliefPickerNode();
    });
    openSlot.addEventListener("action-activate", () => {
      this.currentlySelectedBeliefSlot = openSlot;
      this.openBeliefChooser(beliefClass);
      openSlot.setAttribute("selected", "true");
    });
    return openSlot;
  }
  createLockedBeliefPickerNode(beliefClass) {
    let lockedNodeDesc = "";
    let lockedNodeIcon = "";
    switch (beliefClass) {
      case "BELIEF_CLASS_ENHANCER":
        lockedNodeDesc = "LOC_UI_ESTABLISH_BELIEFS_ENHANCER_SLOT_LOCKED";
        lockedNodeIcon = "fs://game/rel_bel_enhancer.png";
        break;
      case "BELIEF_CLASS_RELIQUARY":
        lockedNodeDesc = "LOC_UI_ESTABLISH_BELIEFS_RELIC_SLOT_LOCKED";
        lockedNodeIcon = "fs://game/rel_bel_reliquary.png";
        break;
      case "BELIEF_CLASS_FOUNDER":
        lockedNodeDesc = "LOC_UI_ESTABLISH_BELIEFS_FOUNDER_SLOT_LOCKED";
        lockedNodeIcon = "fs://game/rel_bel_founder.png";
        break;
    }
    return {
      name: "",
      primaryIcon: lockedNodeIcon,
      description: lockedNodeDesc,
      isLocked: true
    };
  }
  createLockedSlotElement(beliefClass) {
    const lockedSlot = document.createElement(
      "belief-picker-chooser-item"
    );
    lockedSlot.whenComponentCreated((chooser) => {
      chooser.beliefPickerChooserNode = this.createLockedBeliefPickerNode(beliefClass);
    });
    return lockedSlot;
  }
  openBeliefChooser(beliefClass) {
    if (mptReadOnly()) return;   // MPT: read-only
    this.beliefChoiceMenu.classList.remove("hidden");
    const menuTitle = MustGetElement(".belief-choice-menu_title", this.beliefChoiceMenu);
    const menuSubtitle = MustGetElement(".belief-choice-menu_subtitle", this.beliefChoiceMenu);
    const menuList = MustGetElement(".belief-choice-menu_list", this.beliefChoiceMenu);
    switch (beliefClass) {
      case "BELIEF_CLASS_ENHANCER":
        menuTitle.setAttribute("title", "LOC_UI_ESTABLISH_BELIEFS_CHOOSE_ENHANCER_BELIEF");
        menuSubtitle.setAttribute("data-l10n-id", "LOC_UI_ESTABLISH_BELIEFS_CHOOSE_ENHANCER_BELIEF_DESC");
        break;
      case "BELIEF_CLASS_RELIQUARY":
        menuTitle.setAttribute("title", "LOC_UI_ESTABLISH_BELIEFS_CHOOSE_RELIQUARY_BELIEF");
        menuSubtitle.setAttribute("data-l10n-id", "LOC_UI_ESTABLISH_BELIEFS_CHOOSE_RELIQUARY_BELIEF_DESC");
        break;
      case "BELIEF_CLASS_FOUNDER":
        menuTitle.setAttribute("title", "LOC_UI_ESTABLISH_BELIEFS_CHOOSE_FOUNDER_BELIEF");
        menuSubtitle.setAttribute("data-l10n-id", "LOC_UI_ESTABLISH_BELIEFS_CHOOSE_FOUNDER_BELIEF_DESC");
        break;
    }
    while (menuList.hasChildNodes()) {
      menuList.removeChild(menuList.lastChild);
    }
    for (const belief of GameInfo.Beliefs) {
      if (belief.BeliefClassType == beliefClass) {
        menuList.appendChild(this.createBeliefChoice(belief));
      }
    }
    FocusManager.get().setFocus(menuList);
  }
  createBeliefChoiceNode(belief) {
    let primaryIcon = "";
    switch (belief.BeliefClassType) {
      case "BELIEF_CLASS_ENHANCER":
        primaryIcon = "fs://game/rel_bel_enhancer.png";
        break;
      case "BELIEF_CLASS_RELIQUARY":
        primaryIcon = "fs://game/rel_bel_reliquary.png";
        break;
      case "BELIEF_CLASS_FOUNDER":
        primaryIcon = "fs://game/rel_bel_founder.png";
        break;
    }
    const isLocked = !Game.Religion.isBeliefClaimable(belief.$index) || this.beliefsToAdd.includes(belief.BeliefType);
    return {
      name: Locale.compose(belief.Name),
      primaryIcon,
      description: Locale.stylize(belief.Description),
      isLocked
    };
  }
  createBeliefChoice(belief) {
    const beliefChoice = document.createElement("pantheon-chooser-item");
    beliefChoice.setAttribute("data-audio-group-ref", "audio-panel-belief-picker");
    beliefChoice.setAttribute("data-audio-activate-ref", "data-audio-choose-belief");
    beliefChoice.classList.add("belief-choice");
    beliefChoice.setAttribute("tabIndex", "-1");
    beliefChoice.whenComponentCreated((chooser) => {
      chooser.pantheonChooserNode = this.createBeliefChoiceNode(belief);
      if (!Game.Religion.isBeliefClaimable(belief.BeliefType) || this.beliefsToAdd.includes(belief.BeliefType)) {
        chooser.addLockStyling();
      }
    });
    if (Game.Religion.isBeliefClaimable(belief.$index) && !this.beliefsToAdd.includes(belief.BeliefType)) {
      beliefChoice.addEventListener("action-activate", () => {
        this.onBeliefChoiceMade(belief);
      });
    }
    return beliefChoice;
  }
  calculateReligionPercentage(rType) {
    let numSettlementsFollowingReligion = 0;
    let numSettlementsInWorld = 0;
    const playerList = Players.getAlive();
    for (const player of playerList) {
      const playerCities = player.Cities;
      if (!playerCities) {
        console.error(
          `panel-belief-picker: calculateReligionPercentage() - playerCities for player ${player.name} was undefined!`
        );
        continue;
      }
      const playerStats = player.Stats;
      if (!playerStats) {
        console.error(
          `panel-belief-picker: calculateReligionPercentage() - playerStats for player ${player.name} was undefined!`
        );
        continue;
      }
      numSettlementsInWorld += playerCities.getCities().length;
      numSettlementsFollowingReligion += playerStats.getNumMyCitiesFollowingSpecificReligion(rType, false);
    }
    const religionPercent = Math.round(numSettlementsFollowingReligion / numSettlementsInWorld * 100);
    const religionPercentString = Locale.compose("LOC_METAPROGRESSION_PERCENT", religionPercent.toString());
    return religionPercentString.toString();
  }
  buildBeliefTabs() {
    const tabsContainer = MustGetElement(".belief-picker_belief-tabs", this.Root);
    const tabItems = [];
    for (const pRel of this.allPlayerReligions) {
      const religionLabel = this.religionFollowingPercentages.get(pRel);
      let religionIcon = "";
      if (this.mustCreateReligion && pRel == this.playerReligion) {
        religionIcon = UI.getIconURL(this.selectedReligionType, "RELIGION_DECO");
      } else {
        const religionStringType = GameInfo.Religions.lookup(pRel.getReligionType())?.ReligionType;
        if (!religionStringType) {
          console.error(
            "panel-belief-picker: buildBeliefTabs() - no religion string type for " + pRel.getReligionType
          );
        } else {
          religionIcon = UI.getIconURL(religionStringType, "RELIGION_DECO");
        }
      }
      tabItems.push({
        icon: religionIcon,
        id: "belief-picker-religions",
        label: religionLabel,
        className: "max-w-32",
        iconClass: "size-10 mr-2"
      });
    }
    tabsContainer.addEventListener("tab-selected", this.onReligionTabSelectedListener);
    tabsContainer.setAttribute("tab-items", JSON.stringify(tabItems));
  }
  getNumFounderSlots(viewingReligion) {
    if (this.mustCreateReligion) {
      return 1;
    }
    const numBeliefsEarned = viewingReligion.getNumBeliefsEarned();
    switch (numBeliefsEarned) {
      case 1:
      case 2:
      case 3:
        return 1;
      case 4:
        return 2;
      case 5:
        return 3;
      default:
        return 0;
    }
  }
  onBeliefChoiceMade(belief) {
    let replacingIndex = -1;
    if (this.currentlySelectedBeliefSlot) {
      const replacingIndexString = this.currentlySelectedBeliefSlot.getAttribute("replacingIndex");
      if (replacingIndexString) {
        replacingIndex = Number(replacingIndexString);
      }
    }
    if (replacingIndex == -1) {
      this.beliefsToAdd.push(belief.BeliefType);
    } else {
      this.beliefsToAdd[replacingIndex] = belief.BeliefType;
    }
    this.beliefChoiceMenu.classList.add("hidden");
    this.buildBeliefWindow();
    const focusElement = this.Root.querySelector(".belief-picker_belief-choices");
    if (focusElement) {
      FocusManager.get().setFocus(focusElement);
    }
  }
  constructAllPlayerReligionInfo() {
    this.mustCreateReligion = !mptReadOnly() && this.playerReligion.canCreateReligion();   // MPT: never found a religion for a viewed leader
    if (this.playerReligion.hasCreatedReligion() || this.mustCreateReligion || (mptReadOnly() && GameInfo.Religions.filter((r) => Game.Religion.hasBeenFounded(r.ReligionType)).length > 0)) {   // MPT: a viewed leader without a religion still sees the founded ones
      const religionContent = MustGetElement(".belief-picker_belief-choices", this.Root);
      religionContent.classList.remove("opacity-0");
      const confirmButton = MustGetElement(".belief-picker_confirm", this.Root);
      confirmButton.classList.remove("hidden");
      const bigIcon = MustGetElement(".belief-picker-main-icon", this.Root);
      bigIcon.classList.remove("hidden");
      const tabsContainer = MustGetElement(".belief-picker_belief-tabs", this.Root);
      tabsContainer.classList.remove("hidden");
    }
    if (this.mustCreateReligion) {
      this.allPlayerReligions.push(this.playerReligion);
      this.religionFollowingPercentages.set(this.playerReligion, "0%");
    }
    for (const religion of GameInfo.Religions) {
      if (Game.Religion.hasBeenFounded(religion.ReligionType)) {
        const pLib = Players.get(
          Game.Religion.getPlayerFromReligion(religion.ReligionType)
        );
        if (!pLib) {
          console.error(
            `panel-belief-picker: constructAllPlayerReligionInfo() - Player library for religion ${religion.ReligionType} was null!`
          );
          continue;
        }
        const pRel = pLib.Religion;
        if (!pRel) {
          console.error(
            `panel-belief-picker: constructAllPlayerReligionInfo() - Player id ${pLib.id} had no religion!`
          );
          continue;
        }
        if (pRel == this.playerReligion) {
          this.allPlayerReligions.unshift(pRel);
        } else {
          this.allPlayerReligions.push(pRel);
        }
        this.religionFollowingPercentages.set(pRel, this.calculateReligionPercentage(pRel.getReligionType()));
      }
    }
  }
  addAllBeliefs() {
    for (let i = 0; i < this.beliefsToAdd.length; i++) {
      const bDef = GameInfo.Beliefs.lookup(this.beliefsToAdd[i]);
      if (bDef?.BeliefClassType == "BELIEF_CLASS_RELIQUARY") {
        const t = this.beliefsToAdd[this.beliefsToAdd.length - 1];
        this.beliefsToAdd[this.beliefsToAdd.length - 1] = this.beliefsToAdd[i];
        this.beliefsToAdd[i] = t;
        break;
      }
    }
    this.addNextBelief();
  }
  addNextBelief() {
    const beliefToAdd = this.beliefsToAdd.pop();
    if (!beliefToAdd) {
      this.close();
      return;
    }
    const args = {
      BeliefType: Database.makeHash(beliefToAdd.toString())
    };
    const result = Game.PlayerOperations.canStart(
      GameContext.localPlayerID,
      PlayerOperationTypes.ADD_BELIEF,
      args,
      false
    );
    if (result.Success) {
      Game.PlayerOperations.sendRequest(GameContext.localPlayerID, PlayerOperationTypes.ADD_BELIEF, args);
      const eventHandle = engine.on("BeliefAdded", () => {
        this.addNextBelief();
        eventHandle.clear();
      });
    } else {
      const beliefDef = GameInfo.Beliefs.lookup(beliefToAdd);
      if (result.FailureReasons) {
        DialogBoxManager.createDialog_Confirm({
          title: formatStringArrayAsNewLineText(result.FailureReasons),
          body: beliefDef?.Name ?? ""
        });
      } else {
        console.error(
          `panel-belief-picker: addNextBelief() - Couldn't add belieftype ${Locale.compose(beliefDef?.Name ?? "")}`
        );
      }
      this.beliefsToAdd = [];
      this.buildBeliefWindow();
    }
  }
  foundReligion() {
    const hashNum = Database.makeHash(this.selectedReligionType);
    const args = {
      ReligionType: hashNum
    };
    if (this.customReligionName) {
      args.ReligionCustomName = this.customReligionName;
    }
    const result = Game.PlayerOperations.canStart(
      GameContext.localPlayerID,
      PlayerOperationTypes.FOUND_RELIGION,
      args,
      false
    );
    if (result.Success) {
      Game.PlayerOperations.sendRequest(GameContext.localPlayerID, PlayerOperationTypes.FOUND_RELIGION, args);
      const eventHandle = engine.on("ReligionFounded", () => {
        this.backButton.classList.add("hidden");
        this.mustCreateReligion = false;
        this.addAllBeliefs();
        eventHandle.clear();
      });
    } else if (result.FailureReasons) {
      DialogBoxManager.createDialog_Confirm({
        title: formatStringArrayAsNewLineText(result.FailureReasons)
      });
    } else {
      console.error(
        `panel-belief-picker: foundReligion() - Couldn't add found religion of type ${args.ReligionType}!`
      );
    }
  }
  onEngineInput(inputEvent) {
    if (inputEvent.detail.status != InputActionStatuses.FINISH) {
      return;
    }
    if (inputEvent.isCancelInput() || inputEvent.detail.name == "sys-menu") {
      if (!this.beliefChoiceMenu.classList.contains("hidden")) {
        this.onCloseBeliefChoiceMenu();
      } else if (this.mustCreateReligion && !this.playerReligion.hasCreatedReligion()) {
        this.onBackButton();
      } else {
        this.close();
      }
      inputEvent.stopPropagation();
      inputEvent.preventDefault();
    }
    if (inputEvent.detail.name == "shell-action-1") {
      if (this.canConfirm) {
        this.onConfirm();
        inputEvent.stopPropagation();
        inputEvent.preventDefault();
        Audio.playSound("data-audio-confirm", "audio-panel-belief-picker");
      }
    }
  }
  onReligionTabSelected(e) {
    this.viewingReligion = this.allPlayerReligions[e.detail.index];
    this.buildBeliefWindow();
    if (!this.beliefChoiceMenu.classList.contains("hidden")) {
      this.onCloseBeliefChoiceMenu();
    }
  }
}
Controls.define("panel-belief-picker", {
  createInstance: PanelBeliefPicker,
  description: "Belief picker",
  classNames: ["panel-belief-picker", "fullscreen", "pointer-events-auto", "flex"],
  styles: [styles],
  innerHTML: [content],
  attributes: []
});
//# sourceMappingURL=panel-belief-picker.js.map
