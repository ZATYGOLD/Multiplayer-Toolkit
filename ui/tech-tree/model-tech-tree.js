import { ActiveDeviceTypeChangedEventName } from '../../../core/ui/input/input-events.js';
import UpdateGate from '../../../core/ui/utilities/utilities-update-gate.js';
import { IsMouseKeyboardActive, IsControllerActive } from '../../../core/ui-next/services/input.js';
import { TreeGridSourceType, TreeGrid } from '../tree-grid/tree-grid.js';
import { TreeGridDirection } from '../tree-grid/tree-support.js';

/*
 * Zatygold's Observer Mode - base-game override.
 * Copied verbatim from the game's base-standard/ui/tech-tree/model-tech-tree.js
 * (build dated 2026-09-16). The only changes are marked "ZOM:", plus every
 * GameContext.localPlayerID read as zomLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const zomLocalPlayerID = () => globalThis.ZOMLeaderView?.playerID() ?? GameContext.localPlayerID;   // ZOM: the leader the Observer views (everyone else: the local player)

class TechTreeModel {
  onUpdate;
  updateGate = new UpdateGate(this.update.bind(this));
  wasMouseKeyboard = IsMouseKeyboardActive();
  _tree = null;
  _activeTree = null;
  _sourceProgressionTrees = void 0;
  _iconCallback = () => "";
  constructor() {
    window.addEventListener(ActiveDeviceTypeChangedEventName, () => {
      if (!this.wasMouseKeyboard || !IsMouseKeyboardActive()) {
        this.updateGate.call("ModelTechTree-ActiveDeviceTypeChanged");
      }
      this.wasMouseKeyboard = IsMouseKeyboardActive();
    });
    this.updateGate.call("constructor");
  }
  set updateCallback(callback) {
    this.onUpdate = callback;
  }
  get playerId() {
    return zomLocalPlayerID();
  }
  get tree() {
    return this._tree;
  }
  get isGamepadActive() {
    return IsControllerActive();
  }
  get activeTree() {
    return this._activeTree;
  }
  set activeTree(eType) {
    this._activeTree = eType;
  }
  set iconCallback(iconCallback) {
    this._iconCallback = iconCallback;
  }
  get iconCallback() {
    return this._iconCallback;
  }
  set sourceProgressionTrees(sourceCSV) {
    this._sourceProgressionTrees = [];
    const sourceTreeTypes = sourceCSV.split(",");
    sourceTreeTypes.forEach((sourceString) => {
      const id = parseInt(sourceString);
      if (id) {
        this._sourceProgressionTrees?.push(id);
      } else {
        this._sourceProgressionTrees?.push(sourceString);
      }
    });
    this.update();
  }
  update() {
    this._tree = null;
    const localPlayerID = zomLocalPlayerID();
    const localPlayer = Players.get(localPlayerID);
    if (!localPlayer) {
      return;
    }
    const availableTrees = this._sourceProgressionTrees;
    if (availableTrees == void 0) {
      console.warn("model-tech-tree: No available trees to generate");
      return;
    }
    for (const tree of availableTrees) {
      const definition = GameInfo.ProgressionTrees.lookup(tree);
      if (!definition) {
        console.warn("model-tech-tree: update(): No definition for tree: " + tree);
        continue;
      }
      const turnsCallback = (nodeType) => {
        const player = Players.get(zomLocalPlayerID());
        const turnsLeft = player ? player.Techs ? player.Techs.getTurnsForNode(nodeType) : 0 : 0;
        return turnsLeft;
      };
      const currentAge = GameInfo.Ages.lookup(Game.age);
      const ageType = currentAge ? currentAge.AgeType : "";
      const treeConfig = {
        direction: TreeGridDirection.HORIZONTAL,
        delegateTurnForNode: turnsCallback,
        delegateGetIconPath: this.iconCallback,
        delegateCostForNode: (nodeType) => {
          const techs = localPlayer.Techs;
          if (!techs) {
            return null;
          }
          return techs.getNodeCost(nodeType);
        },
        treeType: TreeGridSourceType.TECHS,
        flipColumns: ageType == "AGE_ANTIQUITY" ? true : false
      };
      const treeGrid = new TreeGrid(definition.ProgressionTreeType, treeConfig);
      treeGrid.initialize();
      const attrData = {
        type: definition.ProgressionTreeType,
        treeGrid
      };
      this._tree = attrData;
    }
    if (this._activeTree == null && this._tree != null) {
      this._activeTree = this._tree.type;
    }
    if (this.onUpdate) {
      this.onUpdate(this);
    }
  }
  getCard(type) {
    if (type == void 0) {
      return void 0;
    }
    const targetTree = this._tree;
    const targetCard = targetTree?.treeGrid?.getCard(type);
    if (targetCard != void 0) {
      return targetCard;
    }
    return void 0;
  }
  findNode(id) {
    return this.getCard(id);
  }
  hoverItems(type) {
    if (!this._tree || !this._tree.treeGrid) {
      return [];
    }
    return this._tree.treeGrid.setHoverItem(type);
  }
  clearHoverItems() {
    return this._tree?.treeGrid?.clearHoverItems();
  }
  canAddChooseNotification() {
    if (!this._tree || !this._tree.treeGrid) {
      console.log("model-tech-tree: canAddChooseNotification(): No tree or grid to add notification check");
      return false;
    }
    return this._tree.treeGrid.canAddChooseNotification();
  }
}
const TechTree = new TechTreeModel();
engine.whenReady.then(() => {
  const updateModel = () => {
    engine.updateWholeModel(TechTree);
  };
  engine.createJSModel("g_TechTree", TechTree);
  TechTree.updateCallback = updateModel;
  engine.synchronizeModels();
});

export { TechTreeModel, TechTree as default };
//# sourceMappingURL=model-tech-tree.js.map
