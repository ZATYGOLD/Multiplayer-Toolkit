import '../../../core/vendor/solid-js/web/dist/web.js';
import { onMount, onCleanup, createComponent, Show } from '../../../core/vendor/solid-js/dist/solid.js';
import { ContextManager } from '../../../core/ui/context-manager/context-manager.js';
import { defineLegacyComponent } from '../../../core/ui-next/components/fxs-solid-component.js';
import { Tab } from '../../../core/ui-next/components/tab.js';
import { useAudio } from '../../../core/ui-next/services/audio-support.js';
import { ComponentRegistry } from '../../../core/ui-next/services/component-registry.js';
import { isMobile } from '../../../core/ui-next/services/view-experience.js';
import { CrisisPolicies } from './crisis-policies.js';
import { GovernmentOverview } from './government-overview.js';
import { GovtScreenModel, setActivePolicyTab, GovtScreenModelContext, activePolicyTab } from './model-government.js';
import { PoliciesModel, PoliciesModelContext } from './model-policies.js';
import { PoliciesAndTraditions } from './policies-and-traditions.js';
import { ScreenFrame } from '../../ui-next/components/screen-frame.js';
import style from './screen-policies.scss.js';

/*
 * Multiplayer Toolkit - base-game override.
 * Copied verbatim from the game's base-standard/ui/policies/government-hub.js
 * (build dated 2026-09-16). The only changes are marked "MPT:": for the
 * Observer, a row of leader portraits above the tabs picks the leader shown,
 * and the open tab is kept when another leader is picked.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */

const GovermentScreenComponent = (_props) => {
  const policiesModel = PoliciesModel.get();
  const model = GovtScreenModel.get();
  const audio = useAudio("GovernmentOverview1");
  onMount(() => {
    audio("popup-open");
  });
  onCleanup(() => {
    setActivePolicyTab("gov-overview");
  });
  const handleOnClosing = () => {
    audio("popup-close");
  };
  return createComponent(GovtScreenModelContext.Provider, {
    value: model,
    get children() {
      return createComponent(PoliciesModelContext.Provider, {
        value: policiesModel,
        get children() {
          return createComponent(ScreenFrame, {
            name: "Government Screen",
            panelContext: "screen-policies",
            audioContext: "GovernmentScreen",
            title: "LOC_UI_MINI_MAP_GOVERNMENT",
            get ornatePanelData() {
              return model.data.ornatePanelData;
            },
            onClosing: handleOnClosing,
            doNotStretch: true,
            get isFullscreen() {
              return isMobile();
            },
            get children() {
              return [globalThis.MPTLeaderView?.playerBar('screen-policies') ?? null, createComponent(Tab, {   // MPT: the Observer's leader picker
                activeTab: () => { const tab = activePolicyTab(); return globalThis.MPTLeaderView?.restoredTab('screen-policies') ?? tab; },   // MPT: same tab after a leader switch
                get defaultTab() { return globalThis.MPTLeaderView?.restoredTab('screen-policies'); },   // MPT: applied as the tabs register
                onTabChanged: globalThis.MPTLeaderView?.trackTab('screen-policies'),   // MPT: remember the open tab
                "class": "w-full relative flex flex-col flex-auto pointer-events-auto",
                get children() {
                  return [createComponent(Tab.TabList, {
                    "class": "min-w-187 self-center text-base font-base policies__tab-bar",
                    nextHotkey: "nav-next",
                    previousHotkey: "nav-previous"
                  }), createComponent(Tab.Output, {}), createComponent(Tab.Item, {
                    name: "gov-overview",
                    title: () => "LOC_UI_POLICIES_OVERVIEW_TAB",
                    body: () => createComponent(GovernmentOverview, {
                      name: "gov-overview",
                      id: "gov-overview",
                      "class": "flex flex-auto"
                    })
                  }), createComponent(Tab.Item, {
                    name: "policies-and-traditions",
                    title: () => "LOC_UI_POLICIES_POLICIES_TAB",
                    body: () => createComponent(PoliciesAndTraditions, {
                      name: "policies-and-traditions",
                      id: "policies-and-traditions",
                      "class": "flex flex-auto"
                    })
                  }), createComponent(Show, {
                    get when() {
                      return model.data.displayCrisisTab();
                    },
                    get children() {
                      return createComponent(Tab.Item, {
                        name: "crisis-policies",
                        title: () => "LOC_UI_POLICIES_CRISIS_TAB",
                        body: () => createComponent(CrisisPolicies, {
                          name: "crisis-policies",
                          id: "crisis-policies",
                          "class": "flex flex-auto"
                        })
                      });
                    }
                  })];
                }
              })];
            }
          });
        }
      });
    }
  });
};
window.addEventListener("hotkey-open-traditions", () => {
  if (ContextManager.isCurrentClass("screen-policies")) {
    ContextManager.pop("screen-policies");
  } else {
    ContextManager.push("screen-policies", {
      singleton: true,
      createMouseGuard: true
    });
  }
});
defineLegacyComponent("screen-policies", {
  tabIndex: -1,
  classNames: ["screen-policies", "fullscreen"]
}, (_attrs, _element) => {
  Input.setActiveContext(InputContext.Shell);
  return createComponent(GovermentScreenComponent, {});
});
const PoliciesScreen = ComponentRegistry.register({
  name: "PoliciesScreen",
  styles: [style],
  createInstance: GovermentScreenComponent
});

export { PoliciesScreen };
//# sourceMappingURL=government-hub.js.map
