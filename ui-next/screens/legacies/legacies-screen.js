import '../../../../core/vendor/solid-js/web/dist/web.js';
import { onMount, createMemo, createComponent } from '../../../../core/vendor/solid-js/dist/solid.js';
import { defineLegacyComponent } from '../../../../core/ui-next/components/fxs-solid-component.js';
import { Tab } from '../../../../core/ui-next/components/tab.js';
import { useAudio } from '../../../../core/ui-next/services/audio-support.js';
import { ComponentRegistry } from '../../../../core/ui-next/services/component-registry.js';
import { ViewExperience } from '../../../../core/ui-next/services/view-experience.js';
import { ScreenFrame } from '../../components/screen-frame.js';
import { DedicationTab } from './dedication-tab.js';
import { LegaciesUnlocksTab } from './legacies-civ-unlocks-tab.js';
import { createLegaciesScreenModel, LegaciesScreenContext } from './legacies-model.js';
import { LegaciesTriumphTab } from './legacies-triumphs-tab.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui-next/screens/legacies/legacies-screen.js
 * (build dated 2026-09-16). The only changes are marked "MPT:": for the
 * Observer, a row of leader portraits above the tabs picks the leader shown,
 * and the open tab is kept when another leader is picked.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */

const LegaciesScreenComponent = (_props) => {
  const model = createLegaciesScreenModel();
  const audio = useAudio("LegaciesPopup");
  const isMobile = ViewExperience() == UIViewExperience.Mobile;
  onMount(() => {
    audio("popup-open");
  });
  const handleOnClosing = () => {
    audio("popup-close");
  };
  const ornatePanelData = createMemo(() => {
    return {
      name: "Legacies-Screen-Frame",
      id: "legacies-screen-frame",
      topIconSrc: "url('blp:sub_legacy_color')",
      topIconClass: "size-10 -mt-1",
      topIconBackgroundTint: model.playerColor,
      backgroundImageSrc: model.bgSrc
    };
  });
  return createComponent(LegaciesScreenContext.Provider, {
    value: model,
    get children() {
      return createComponent(ScreenFrame, {
        name: "Legacies-Screen",
        title: "LOC_LEGACIES_TITLE",
        panelContext: "screen-legacies",
        audioContext: "LegaciesScreen",
        get ornatePanelData() {
          return ornatePanelData();
        },
        onClosing: handleOnClosing,
        isFullscreen: isMobile,
        get children() {
          return [globalThis.MPTLeaderView?.playerBar('screen-legacies') ?? null, createComponent(Tab, {   // MPT: the Observer's leader picker
            "class": "w-full flex flex-col flex-auto pointer-events-auto relative",
            onTabChanged: globalThis.MPTLeaderView?.trackTab('screen-legacies'),   // MPT: remember the open tab
            get defaultTab() { return globalThis.MPTLeaderView?.restoredTab('screen-legacies'); },   // MPT: same tab after a leader switch
            get children() {
              return [createComponent(Tab.TabList, {
                "class": `${isMobile ? "w-192" : "w-187"} self-center text-base font-base mb-2`,
                nextHotkey: "nav-next",
                previousHotkey: "nav-previous",
                get showNavHelp() {
                  return !model.isShowingDetails();
                }
              }), createComponent(Tab.Output, {}), createComponent(Tab.Item, {
                name: "Triumphs",
                title: () => "LOC_LEGACIES_TRIUMPHS_TITLE",
                body: () => createComponent(LegaciesTriumphTab, {})
              }), createComponent(Tab.Item, {
                name: "Unlocks",
                title: () => "LOC_LEGACIES_UNLOCKS_TITLE",
                body: () => createComponent(LegaciesUnlocksTab, {})
              }), createComponent(Tab.Item, {
                name: "Dedications",
                title: () => "LOC_DEDICATIONS_TITLE",
                body: () => createComponent(DedicationTab, {})
              })];
            }
          })];
        }
      });
    }
  });
};
const LegaciesScreen = ComponentRegistry.register({
  name: "LegaciesScreen",
  createInstance: LegaciesScreenComponent
});
defineLegacyComponent("screen-legacies", {
  classNames: ["fullscreen"]
}, () => {
  Input.setActiveContext(InputContext.Shell);
  return createComponent(LegaciesScreen, {});
});

export { LegaciesScreen, LegaciesScreenComponent };
//# sourceMappingURL=legacies-screen.js.map
