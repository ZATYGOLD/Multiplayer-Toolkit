import { ActiveDeviceTypeChangedEventName } from '../../../core/ui/input/input-events.js';
import { InputEngineEventName } from '../../../core/ui/input/input-support.js';
import NavTray from '../../../core/ui/navigation-tray/model-navigation-tray.js';
import Panel from '../../../core/ui/panel-support.js';
import { applyPlayerColorsToElement } from '../../../core/ui/utilities/utilities-color.js';
import { ComponentID } from '../../../core/ui/utilities/utilities-component-id.js';
import { MustGetElement } from '../../../core/ui/utilities/utilities-dom.js';
import { FocusManager } from '../../../core/ui-next/services/focus-manager.js';
import { IsControllerActive } from '../../../core/ui-next/services/input.js';
import { ViewExperience } from '../../../core/ui-next/services/view-experience.js';
import GreatWorks from './model-great-works.js';
import content from './screen-great-works.html.js';
import styles from './screen-great-works.scss.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui/great-works/screen-great-works.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)

class ScreenGreatWorks extends Panel {
  activeDeviceTypeListener = this.onActiveDeviceTypeChanged.bind(this);
  onGreatWorkUnhovered = this.onFocusOut.bind(this);
  greatWorkSelectedListener = this.onGreatWorkSelected.bind(this);
  emptySlotSelectedListener = this.onEmptySlotSelected.bind(this);
  engineInputListener = this.onEngineInput.bind(this);
  rebuildGreatWorksListener = this.rebuildGreatWorksPanel.bind(this);
  navigateInputListener = this.onNavigateInput.bind(this);
  currentlySelectedWork = null;
  lastSelectedElementId = "";
  settlementFilter = "all";
  constructor(root) {
    super(root);
    this.enableOpenSound = true;
    this.enableCloseSound = true;
    this.Root.setAttribute("data-audio-group-ref", "great-works");
  }
  showcaseList = null;
  settlementTabBar = document.createElement("fxs-tab-bar");
  settlementTabData = [
    { label: "LOC_UI_SETTLEMENT_TAB_BAR_CITIES", id: "city" },
    { label: "LOC_UI_SETTLEMENT_TAB_BAR_TOWNS", id: "town" },
    { label: "LOC_UI_SETTLEMENT_TAB_BAR_ALL", id: "all" }
  ];
  settlementTabBarListener = this.onSettlementTabBarSelected.bind(this);
  onInitialize() {
    super.onInitialize();
    this.settlementTabBar.setAttribute("tabindex", "-1");
  }
  onAttach() {
    super.onAttach();
    this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
    this.Root.addEventListener("navigate-input", this.navigateInputListener);
    window.addEventListener("model-great-works-rebuild-panel", this.rebuildGreatWorksListener);
    window.addEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceTypeListener, true);
    const closeButton = MustGetElement("fxs-close-button", this.Root);
    closeButton.addEventListener("action-activate", () => {
      this.requestClose();
    });
    const frame = MustGetElement("fxs-frame", this.Root);
    frame.setAttribute("outside-safezone-mode", "full");
    if (ViewExperience() == UIViewExperience.Mobile) {
      frame.setAttribute("frame-style", "f1");
      frame.setAttribute("no-filigree", "true");
      frame.setAttribute("override-styling", "relative flex size-full");
      const topFiligree = MustGetElement(".great-works-top-border", this.Root);
      topFiligree.classList.add("hidden");
      const header = MustGetElement(".great-works-header", this.Root);
      const columnsParent = MustGetElement(".great-works-columns", this.Root).parentNode;
      if (columnsParent) {
        columnsParent.insertBefore(header, columnsParent.children[0]);
      }
    }
    this.updateAll();
    const mptBar = globalThis.MPTLeaderView?.playerBar('screen-great-works');   // MPT: the Observer's leader picker, under the title
    const mptHeader = this.Root.querySelector('.great-works-header');
    if (mptBar && mptHeader) mptHeader.parentElement.insertBefore(mptBar, mptHeader.nextSibling);
    const player = mptLocalPlayerID();
    if (Players.isValid(player)) {
      applyPlayerColorsToElement(this.Root, player);
    }
    this.setGamepadControlsVisible(IsControllerActive());
    this.buildSettlementTabBar();
  }
  onDetach() {
    this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
    this.Root.removeEventListener("navigate-input", this.navigateInputListener);
    window.removeEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceTypeListener, true);
    window.removeEventListener("model-great-works-rebuild-panel", this.rebuildGreatWorksListener);
    GreatWorks.clearSelectedGreatWork();
    super.onDetach();
  }
  rebuildGreatWorksPanel() {
    const archivedGreatWorksList = this.Root.querySelector(".archived-great-works-list");
    if (!archivedGreatWorksList) {
      console.error("screen-great-works: onAttach(): Failed to find archived-great-works-list!");
      return;
    }
    const citySlotsGreatWorksList = this.Root.querySelector(".city-slots-displayed-list");
    if (!citySlotsGreatWorksList) {
      console.error("screen-great-works: onAttach(): Failed to find city-slots-displayed-list!");
      return;
    }
    this.showcaseList = this.Root.querySelector(".showcase-list");
    if (!this.showcaseList) {
      console.error("screen-great-works: rebuildGreatWorksPanel(): Failed to find showcase-list!");
      return;
    }
    this.buildArchivedGreatWorks(archivedGreatWorksList);
    while (this.showcaseList?.firstChild) {
      this.showcaseList.firstChild.remove();
    }
    this.buildSlotsBox(citySlotsGreatWorksList);
    const lastSelectedElement = document.getElementById(this.lastSelectedElementId);
    if (lastSelectedElement) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          FocusManager.get().setFocus(lastSelectedElement);
        });
      });
    }
    this.filterSettlementByType(this.settlementFilter);
  }
  onActiveDeviceTypeChanged(event) {
    this.setGamepadControlsVisible(event.detail?.gamepadActive);
  }
  onNavigateInput(navigationEvent) {
    if (navigationEvent.detail.status != InputActionStatuses.FINISH) {
      return;
    }
    if (navigationEvent.getDirection() == InputNavigationAction.RIGHT) {
      if (FocusManager.get().currentFocus().classList.contains("great-work-container")) {
        const citySlotsGreatWorksList = this.Root.querySelector(".city-slots-displayed-list");
        if (citySlotsGreatWorksList) {
          FocusManager.get().setFocus(citySlotsGreatWorksList);
        }
      }
    }
  }
  setGamepadControlsVisible(isVisible) {
    if (isVisible) {
      NavTray.addOrUpdateGenericBack();
      NavTray.addOrUpdateGenericSelect();
    } else {
      NavTray.clear();
    }
  }
  updateAll() {
    GreatWorks.update();
  }
  determineInitialFocus() {
    const archiveList = MustGetElement(".archived-great-works-list", this.Root);
    if (archiveList.hasChildNodes()) {
      FocusManager.get().setFocus(archiveList);
      return;
    }
    const showcaseList = MustGetElement(".showcase-list", this.Root);
    if (showcaseList.hasChildNodes()) {
      FocusManager.get().setFocus(showcaseList);
      return;
    }
    const cityList = MustGetElement(".city-slots-displayed-list", this.Root);
    if (this.hasSettlementsForCurrentFilter(cityList)) {
      FocusManager.get().setFocus(cityList);
      return;
    } else {
      FocusManager.get().setFocus(this.settlementTabBar);
    }
  }
  onReceiveFocus() {
    super.onReceiveFocus();
    this.determineInitialFocus();
  }
  buildSettlementTabBar() {
    const settlementTypeBox = this.Root.querySelector(
      ".settlement-tab-bar-container"
    );
    if (!settlementTypeBox) {
      console.error("screen-great-works: buildSettlementTabBar(): Failed to find settlement-tab-bar-container");
      return;
    }
    this.settlementTabBar.classList.add("settlement_nav", "w-full", "font-title", "text-sm");
    this.settlementTabBar.setAttribute("tab-item-class", "font-title text-xs");
    this.settlementTabBar.setAttribute("tab-items", JSON.stringify(this.settlementTabData));
    this.settlementTabBar.setAttribute("selected-tab-index", "2");
    this.settlementTabBar.addEventListener("tab-selected", this.settlementTabBarListener);
    if (ViewExperience() != UIViewExperience.Mobile) {
      this.settlementTabBar.setAttribute("nav-help-right-class", "relative right-0");
      this.settlementTabBar.setAttribute("nav-help-left-class", "relative left-0");
    }
    settlementTypeBox.appendChild(this.settlementTabBar);
  }
  onFocusOut() {
    const tooltipLocationArchive = this.Root.querySelector(".tooltip-location-archive");
    if (tooltipLocationArchive) {
      tooltipLocationArchive.innerHTML = "";
    }
    const tooltipLocationSlotsbox = this.Root.querySelector(".tooltip-location-slotsbox");
    if (tooltipLocationSlotsbox) {
      tooltipLocationSlotsbox.innerHTML = "";
    }
  }
  onGreatWorkSelected(event) {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const greatWorkIndexAttribute = event.target.getAttribute("data-greatwork-index");
    if (!greatWorkIndexAttribute) {
      console.error("screen-great-works: onArchivedGreatWorkSelected(): Failed to find data-greatwork-index!");
      return;
    }
    const greatWorkIndex = parseInt(greatWorkIndexAttribute);
    const greatWorkCityAttribute = event.target.getAttribute("data-greatwork-city");
    let greatWorkCityID = -1;
    if (greatWorkCityAttribute) {
      greatWorkCityID = parseInt(greatWorkCityAttribute);
    }
    GreatWorks.selectGreatWork(greatWorkIndex, greatWorkCityID);
    if (GreatWorks.hasSelectedGreatWork()) {
      if (this.currentlySelectedWork) {
        this.currentlySelectedWork.classList.remove("great-work-selected");
      }
      this.currentlySelectedWork = event.target;
      this.currentlySelectedWork.classList.add("great-work-selected");
    } else {
      if (this.currentlySelectedWork) {
        this.currentlySelectedWork.classList.remove("great-work-selected");
      }
    }
  }
  onEmptySlotSelected(event) {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const cityIdAttribute = event.target.getAttribute("data-greatwork-city");
    if (!cityIdAttribute) {
      console.error("screen-great-works: onEmptySlotSelected(): Failed to find data-greatwork-city!");
      return;
    }
    const buildingIdAttribute = event.target.getAttribute("data-greatwork-building");
    if (!buildingIdAttribute) {
      console.error("screen-great-works: onEmptySlotSelected(): Failed to find data-greatwork-building!");
      return;
    }
    const greatWorkCityId = parseInt(cityIdAttribute);
    const greatWorkBuildingId = parseInt(buildingIdAttribute);
    GreatWorks.selectEmptySlot(greatWorkCityId, greatWorkBuildingId);
    this.currentlySelectedWork = event.target;
    this.lastSelectedElementId = event.target.id;
  }
  onEngineInput(inputEvent) {
    if (inputEvent.detail.status != InputActionStatuses.FINISH) {
      return;
    }
    if (inputEvent.isCancelInput() || inputEvent.detail.name == "sys-menu") {
      this.close();
      inputEvent.stopPropagation();
      inputEvent.preventDefault();
    }
  }
  requestClose(inputEvent) {
    if (inputEvent) {
      inputEvent.stopPropagation();
      inputEvent.stopImmediatePropagation;
    }
    this.close();
  }
  buildArchivedGreatWorks(parent) {
    const playerCulture = GreatWorks.localPlayer?.Culture;
    if (!playerCulture) {
      console.error("screen-great-works: buildArchivedGreatWorks - no player culture found!");
      return;
    }
    parent.innerHTML = "";
    const numArchivedWorks = playerCulture.getNumWorksInArchive();
    for (let i = 0; i < numArchivedWorks; i++) {
      const greatWorkIndex = playerCulture.getArchivedGreatWork(i);
      const gwType = Game.Culture.getGreatWorkType(greatWorkIndex);
      const greatWork = GameInfo.GreatWorks.lookup(gwType);
      if (greatWork) {
        const greatWorkContainer = document.createElement("div");
        greatWorkContainer.classList.add("great-work-container-entry", "relative", "flex");
        const greatWorkContainerFrame = document.createElement("fxs-activatable");
        greatWorkContainerFrame.classList.add(
          "great-work-frame",
          "m-1",
          "p-2",
          "flex",
          "relative",
          "grow",
          "shrink",
          "hover\\:bg-secondary",
          "focus\\:bg-secondary",
          "active\\:bg-secondary",
          "pressed\\:bg-secondary"
        );
        greatWorkContainerFrame.setAttribute("tabindex", "-1");
        greatWorkContainerFrame.id = `archivedWork${i}`;
        greatWorkContainerFrame.setAttribute("data-greatwork-index", greatWorkIndex.toString());
        greatWorkContainerFrame.addEventListener("action-activate", this.greatWorkSelectedListener);
        greatWorkContainer.appendChild(greatWorkContainerFrame);
        const greatWorkIcon = document.createElement("fxs-icon");
        greatWorkIcon.classList.add("great-work-icon", "size-16");
        const greatWorkImage = document.createElement("img");
        greatWorkImage.classList.add("great-work-icon", "size-16");
        greatWorkIcon.setAttribute("data-icon-context", "DEFAULT");
        const iconID = greatWork.GreatWorkType;
        const imageURL = greatWork.Image;
        if (imageURL) {
          greatWorkImage.setAttribute("src", imageURL);
        } else {
          greatWorkImage.setAttribute("src", "unitflag_missingicon.png");
        }
        if (iconID) {
          greatWorkIcon.setAttribute("data-icon-id", iconID);
        }
        greatWorkContainerFrame.appendChild(greatWorkImage);
        const textContainer = document.createElement("div");
        textContainer.classList.add("great-work-text-container", "shrink", "flex", "flex-col");
        greatWorkContainerFrame.appendChild(textContainer);
        const greatWorkName = document.createElement("div");
        greatWorkName.classList.value = "font-title text-sm text-secondary uppercase mb-2 flex flex-wrap relative";
        let title = "";
        if (playerCulture.isArtifact(greatWork.GreatWorkType)) {
          const extraText = playerCulture.getArtifactCulture(greatWork.GreatWorkType);
          if (extraText !== "") {
            title = Locale.compose("LOC_UI_GREAT_WORKS_NAME_CIVILIZATION", extraText, greatWork.Name);
          } else {
            title = Locale.compose("LOC_UI_GREAT_WORKS_NAME", greatWork.Name);
          }
        } else {
          title = Locale.compose("LOC_UI_GREAT_WORKS_UNIQUE_NAME", greatWork.Name);
        }
        greatWorkName.setAttribute("data-l10n-id", title);
        textContainer.appendChild(greatWorkName);
        const greatWorkBonus = document.createElement("div");
        greatWorkBonus.classList.add("great-work-bonus", "font-body", "text-sm");
        const greatWorkBonusText = greatWork.Description;
        if (greatWorkBonusText) {
          greatWorkBonus.innerHTML = Locale.stylize(greatWorkBonusText);
        }
        textContainer.appendChild(greatWorkBonus);
        parent.appendChild(greatWorkContainer);
      }
    }
  }
  buildSlotsBox(parent) {
    if (!GreatWorks.localPlayer) {
      console.error("screen-great-works: buildSlotsBox() - no local player found!");
      return;
    }
    parent.innerHTML = "";
    const cities = GreatWorks.localPlayer.Cities;
    if (!cities) {
      console.error("screen-great-works: buildSlotsBox() - local player has no cities!");
      return;
    }
    const cityIds = cities.getCityIds();
    let i = 0;
    cityIds.forEach((cityId) => {
      if (ComponentID.isInvalid(cityId)) {
        console.error(`screen-great-works.ts: buildSlotsBox() - cityId ${cityId.id} is invalid!`);
        return;
      }
      const city = Cities.get(cityId);
      if (!city) {
        console.error(`screen-great-works.ts: buildSlotsBox() - no city found for cityID ${cityId.id}`);
        return;
      }
      if (!city.Constructibles) {
        console.error(
          `screen-great-works.ts: buildSlotsBox() - no city constructibles found for cityID ${cityId.id}`
        );
        return;
      }
      const gwBuildings = city.Constructibles.getGreatWorkBuildings();
      if (!gwBuildings || gwBuildings.length == 0) {
        return;
      }
      const cityEntryContainer = document.createElement("div");
      cityEntryContainer.classList.add("city-entry-container", "w-1\\/2");
      cityEntryContainer.setAttribute("settlement-type", "city");
      const settlementIcon = document.createElement("img");
      settlementIcon.classList.add("relative", "size-8", "mx-1");
      settlementIcon.setAttribute("src", "Yield_Cities");
      if (city.isCapital) {
        cityEntryContainer.setAttribute("settlement-type", "capital");
        settlementIcon.setAttribute("src", "res_capital");
      } else if (city.isTown) {
        cityEntryContainer.setAttribute("settlement-type", "town");
        settlementIcon.setAttribute("src", "Yield_Towns");
      }
      const cityEntryFrame = document.createElement("div");
      cityEntryFrame.classList.add("great-work-frame", "m-1", "p-2", "flex-auto");
      cityEntryContainer.appendChild(cityEntryFrame);
      this.createSlotsBoxCityHeader(cityEntryFrame, city, settlementIcon);
      const buildingContainer = document.createElement("div");
      buildingContainer.classList.add("flex-wrap", "flex", "items-start", "gap-2");
      cityEntryFrame.appendChild(buildingContainer);
      gwBuildings.forEach((greatWorkBuilding) => {
        const buildingInstance = Constructibles.getByComponentID(
          greatWorkBuilding.constructibleID
        );
        if (buildingInstance) {
          const info = GameInfo.Constructibles.lookup(buildingInstance.type);
          if (!info) {
            console.error(
              "screen-great-works.ts: buildSlotsBox() - couldn't find constructible definition from constructible!"
            );
            return;
          }
          const buildingPillaged = buildingInstance.damaged;
          const buildingEntry = document.createElement("div");
          buildingEntry.classList.add("building-entry", "mr-3", "flex", "flex-col");
          buildingContainer.appendChild(buildingEntry);
          this.createSlotsBoxBuildingSubHeader(buildingEntry, buildingPillaged, info.Name);
          const buildingSlotsContainer = document.createElement("div");
          buildingSlotsContainer.classList.add("flex-wrap", "flex");
          buildingEntry.appendChild(buildingSlotsContainer);
          greatWorkBuilding.slots.forEach((slot) => {
            const gwType = Game.Culture.getGreatWorkType(slot.greatWorkIndex);
            const greatWork = GameInfo.GreatWorks.lookup(gwType);
            this.createSlotsBoxGreatWorkEntry(
              buildingSlotsContainer,
              greatWork,
              city,
              buildingInstance,
              slot.greatWorkIndex,
              i
            );
            i++;
          });
        }
      });
      parent.appendChild(cityEntryContainer);
    });
  }
  createSlotsBoxCityHeader(parent, city, icon) {
    const slotsBoxCityHeader = document.createElement("div");
    slotsBoxCityHeader.classList.add("slots-box-city-header", "items-center", "mb-2", "flex");
    const cityHeaderFocusButton = document.createElement("fxs-activatable");
    cityHeaderFocusButton.classList.add(
      "more-info-toggle",
      "mr-1",
      "size-5",
      "hover\\:bg-secondary",
      "focus\\:bg-secondary",
      "active\\:bg-secondary",
      "pressed\\:bg-secondary"
    );
    cityHeaderFocusButton.setAttribute("tabindex", "-1");
    slotsBoxCityHeader.appendChild(cityHeaderFocusButton);
    slotsBoxCityHeader.appendChild(icon);
    cityHeaderFocusButton.addEventListener("action-activate", () => {
      UI.Player.lookAtID(city.id, 0);
    });
    const slotsBoxCityHeaderText = document.createElement("div");
    slotsBoxCityHeaderText.classList.add(
      "truncate",
      "flex-auto",
      "uppercase",
      "tracking-100",
      "text-gradient-secondary",
      "font-title",
      "text-lg"
    );
    slotsBoxCityHeaderText.setAttribute("data-l10n-id", city.name);
    slotsBoxCityHeader.appendChild(slotsBoxCityHeaderText);
    parent.appendChild(slotsBoxCityHeader);
  }
  createSlotsBoxBuildingSubHeader(parent, isDamaged, buildingName) {
    const slotsBoxCityHeader = document.createElement("div");
    slotsBoxCityHeader.classList.add("slots-box-building-subheader", "flex", "items-center");
    const slotsBoxCityHeaderName = document.createElement("fxs-header");
    slotsBoxCityHeaderName.classList.add("slots-box-building-name");
    slotsBoxCityHeaderName.setAttribute("class", "font-title text-2xs uppercase my-1 mx-1");
    slotsBoxCityHeaderName.setAttribute("filigree-style", "none");
    slotsBoxCityHeaderName.setAttribute("title", buildingName);
    slotsBoxCityHeader.appendChild(slotsBoxCityHeaderName);
    if (isDamaged) {
      const slotsBoxCityPillagedNotification = document.createElement("div");
      slotsBoxCityPillagedNotification.classList.add("slots-box-building-pillaged", "text-2xs", "ml-1");
      slotsBoxCityPillagedNotification.innerHTML = Locale.compose("LOC_UI_GREAT_WORKS_DISPLAY_PILLAGED");
      slotsBoxCityHeader.appendChild(slotsBoxCityPillagedNotification);
    }
    parent.appendChild(slotsBoxCityHeader);
  }
  createSlotsBoxGreatWorkEntry(parent, greatWork, city, building, listIndex, slotIndex) {
    const slotsBoxGreatWorkEntryContainer = document.createElement("div");
    slotsBoxGreatWorkEntryContainer.classList.add("slots-box-entry-container");
    const greatWorkContainer = document.createElement("fxs-activatable");
    greatWorkContainer.classList.add("great-work-container");
    greatWorkContainer.setAttribute("tabindex", "-1");
    greatWorkContainer.id = `slot${slotIndex}`;
    greatWorkContainer.setAttribute("data-greatwork-city", city.id.id.toString());
    greatWorkContainer.setAttribute("data-greatwork-building", building.type.toString());
    greatWorkContainer.classList.add(
      "pointer-events-auto",
      "hover\\:bg-secondary",
      "focus\\:bg-secondary",
      "active\\:bg-secondary",
      "pressed\\:bg-secondary"
    );
    if (building.damaged) {
      greatWorkContainer.style.backgroundColor = "red";
      return;
    }
    const greatWorkContainerFrame = document.createElement("div");
    greatWorkContainerFrame.classList.add("great-work-container-frame");
    greatWorkContainer.appendChild(greatWorkContainerFrame);
    const greatWorkContainerImage = document.createElement("div");
    greatWorkContainerImage.classList.add("great-work-container-image");
    greatWorkContainerFrame.appendChild(greatWorkContainerImage);
    slotsBoxGreatWorkEntryContainer.appendChild(greatWorkContainer);
    const slotsBoxEntryDescription = document.createElement("div");
    slotsBoxEntryDescription.classList.add("slots-box-entry-description");
    const slotsBoxEntryDescriptionTitle = document.createElement("div");
    slotsBoxEntryDescriptionTitle.classList.add("slots-box-entry-description-title");
    slotsBoxEntryDescription.appendChild(slotsBoxEntryDescriptionTitle);
    const slotsBoxEntryDescriptionText = document.createElement("div");
    slotsBoxEntryDescriptionText.classList.add("slots-box-entry-description-text");
    slotsBoxEntryDescription.appendChild(slotsBoxEntryDescriptionText);
    slotsBoxGreatWorkEntryContainer.appendChild(slotsBoxEntryDescription);
    if (greatWork) {
      const playerCulture = GreatWorks.localPlayer?.Culture;
      if (!playerCulture) {
        console.error("screen-great-works: createSlotsBoxGreatWorkEntry - no player culture found!");
        return;
      }
      let title = "";
      if (playerCulture.isArtifact(greatWork.GreatWorkType)) {
        const extraText = playerCulture.getArtifactCulture(greatWork.GreatWorkType);
        if (extraText !== "") {
          title = Locale.compose("LOC_UI_GREAT_WORKS_NAME_CIVILIZATION", extraText, greatWork.Name);
        } else {
          title = Locale.compose("LOC_UI_GREAT_WORKS_NAME", greatWork.Name);
        }
      } else {
        title = Locale.compose("LOC_UI_GREAT_WORKS_UNIQUE_NAME", greatWork.Name);
      }
      const description = this.getGreatWorkDescription(greatWork, city);
      greatWorkContainer.setAttribute("data-tooltip-content", title + " " + description);
      const greatWorkIcon = document.createElement("fxs-icon");
      greatWorkIcon.classList.add("great-work-icon", "size-16");
      greatWorkIcon.setAttribute("data-icon-context", "DEFAULT");
      const greatWorkImage = document.createElement("img");
      greatWorkImage.classList.add("great-work-icon", "size-16");
      greatWorkIcon.setAttribute("data-icon-context", "DEFAULT");
      const iconID = greatWork.GreatWorkType;
      const imageURL = greatWork.Image;
      if (imageURL) {
        greatWorkImage.setAttribute("src", imageURL);
      } else {
        greatWorkImage.setAttribute("src", "unitflag_missingicon.png");
      }
      if (iconID) {
        greatWorkIcon.setAttribute("data-icon-id", iconID);
      }
      greatWorkContainerFrame.appendChild(greatWorkImage);
      this.showcaseList?.appendChild(greatWorkContainer.cloneNode(true));
      greatWorkContainer.addEventListener("blur", this.onGreatWorkUnhovered);
      greatWorkContainer.addEventListener("mouseleave", this.onGreatWorkUnhovered);
      greatWorkContainer.addEventListener("action-activate", this.greatWorkSelectedListener);
      greatWorkContainer.setAttribute("data-greatwork-index", listIndex.toString());
    } else {
      const emptySlotImage = document.createElement("img");
      emptySlotImage.classList.add("size-16");
      emptySlotImage.setAttribute("src", "base_empty-slot-mini_add");
      greatWorkContainer.appendChild(emptySlotImage);
      greatWorkContainer.addEventListener("action-activate", this.emptySlotSelectedListener);
    }
    parent.appendChild(slotsBoxGreatWorkEntryContainer);
  }
  getGreatWorkDescription(greatWork, city) {
    if (greatWork.Description) {
      return Locale.compose(greatWork.Description);
    } else if (greatWork.Generic) {
      let returnString = "";
      if (city?.Constructibles) {
        for (const yieldType in YieldTypes) {
          const totalYield = city.Constructibles.getYieldFromGreatWork(yieldType, greatWork.$index);
          if (totalYield > 0) {
            returnString += "<p>" + Locale.compose("LOC_UI_POS_YIELD", totalYield, "LOC_" + yieldType) + "</p>";
          }
        }
      } else {
        const gwYieldChange = GameInfo.GreatWork_YieldChanges.lookup(
          greatWork.$index
        );
        if (gwYieldChange) {
          returnString = Locale.compose(
            "LOC_UI_POS_YIELD",
            gwYieldChange.YieldChange,
            "LOC_" + gwYieldChange.YieldType
          );
        }
      }
      return returnString;
    }
    return "Missing description!";
  }
  onSettlementTabBarSelected(event) {
    this.settlementFilter = event.detail.selectedItem.id;
    this.filterSettlementByType(this.settlementFilter);
  }
  hasSettlementsForCurrentFilter(cityList) {
    const filter = this.settlementFilter;
    for (let i = 0; i < cityList.children.length; i++) {
      const type = cityList.children[i].getAttribute("settlement-type");
      if (filter === "all" || type === filter || filter === "city" && type === "capital") {
        return true;
      }
    }
    return false;
  }
  filterSettlementByType(settlementTypeFilter) {
    const cityList = this.Root.querySelector(".city-slots-displayed-list");
    if (!cityList) {
      console.error("screen-great-works: onAttach(): Failed to find city-slots-displayed-list!");
      return;
    }
    const settlements = cityList.children;
    let needRefocus = true;
    for (let i = 0; i < settlements.length; i++) {
      const settlement = settlements[i];
      if (settlement.hasAttribute("settlement-type")) {
        const settlementType = settlement.getAttribute("settlement-type");
        if (settlementType === settlementTypeFilter || settlementTypeFilter === "all") {
          settlement.classList.remove("hidden");
          needRefocus = false;
        } else {
          settlement.classList.add("hidden");
        }
        if (settlementTypeFilter === "city" && settlementType === "capital") {
          settlement.classList.remove("hidden");
        }
      }
    }
    if (needRefocus) {
      this.determineInitialFocus();
    }
  }
}
Controls.define("screen-great-works", {
  createInstance: ScreenGreatWorks,
  description: "Great Works screen.",
  classNames: ["screen-great-works-bounds", "fullscreen"],
  styles: [styles],
  innerHTML: [content],
  attributes: []
});
//# sourceMappingURL=screen-great-works.js.map
