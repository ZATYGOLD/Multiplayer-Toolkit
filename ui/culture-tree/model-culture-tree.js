import { ActiveDeviceTypeChangedEventName } from '../../../core/ui/input/input-events.js';
import UpdateGate from '../../../core/ui/utilities/utilities-update-gate.js';
import { IsMouseKeyboardActive, IsControllerActive } from '../../../core/ui-next/services/input.js';
import { TreeGridSourceType, TreeGrid } from '../tree-grid/tree-grid.js';
import { TreeGridDirection } from '../tree-grid/tree-support.js';

/*
 * Zatygold's Observer Mode - base-game override.
 * Copied verbatim from the game's base-standard/ui/culture-tree/model-culture-tree.js
 * (build dated 2026-09-16). The only changes are marked "MPT:", plus every
 * GameContext.localPlayerID read as mptLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const mptLocalPlayerID = () => globalThis.MPTLeaderView?.playerID() ?? GameContext.localPlayerID;   // MPT: the leader the Observer views (everyone else: the local player)

class CultureTreeModel {
  onUpdate;
  updateGate = new UpdateGate(this.update.bind(this));
  wasMouseKeyboard = IsMouseKeyboardActive();
  _trees = [];
  _activeTree = void 0;
  _sourceProgressionTrees = void 0;
  _iconCallback = () => "";
  _lastHighlightTree = null;
  constructor() {
    window.addEventListener(ActiveDeviceTypeChangedEventName, () => {
      if (!this.wasMouseKeyboard || !IsMouseKeyboardActive()) {
        this.updateGate.call("ModelCultureTree-ActiveDeviceTypeChanged");
      }
      this.wasMouseKeyboard = IsMouseKeyboardActive();
    });
    this.updateGate.call("constructor");
  }
  set updateCallback(callback) {
    this.onUpdate = callback;
  }
  get playerId() {
    return mptLocalPlayerID();
  }
  get trees() {
    return this._trees;
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
    this._sourceProgressionTrees.sort((tree) => {
      const definitionTree = GameInfo.ProgressionTrees.lookup(tree);
      if (definitionTree == null) {
        return 0;
      }
      const isMainTree = definitionTree.ProgressionTreeType.includes("MAIN");
      return isMainTree ? -1 : 1;
    });
    this.update();
  }
  update() {
    this._trees = [];
    const localPlayerID = mptLocalPlayerID();
    const localPlayer = Players.get(localPlayerID);
    if (!localPlayer) {
      return;
    }
    const availableTrees = this._sourceProgressionTrees;
    if (availableTrees == void 0) {
      console.warn("model-culture-tree: No available trees to generate");
      return;
    }
    const treeCulture = localPlayer.Culture?.getActiveTree();
    if (treeCulture) {
      this.activeTree = GameInfo.ProgressionTrees.lookup(treeCulture)?.ProgressionTreeType;
    }
    for (const tree of availableTrees) {
      const definition = GameInfo.ProgressionTrees.lookup(tree);
      if (!definition) {
        console.warn("model-culture-tree: update(): No definition for tree: " + tree);
        continue;
      }
      const turnsCallback = (nodeType) => {
        const player = Players.get(mptLocalPlayerID());
        const turnsLeft = player ? player.Culture ? player.Culture.getTurnsForNode(nodeType) : 0 : 0;
        return turnsLeft;
      };
      const treeConfig = {
        activeTree: this.activeTree,
        direction: TreeGridDirection.HORIZONTAL,
        delegateGetIconPath: this.iconCallback,
        delegateTurnForNode: turnsCallback,
        delegateCostForNode: (nodeType) => {
          const culture = localPlayer.Culture;
          if (!culture) {
            return null;
          }
          return culture.getNodeCost(nodeType);
        },
        treeType: TreeGridSourceType.CULTURE
      };
      const treeGrid = new TreeGrid(definition.ProgressionTreeType, treeConfig);
      treeGrid.initialize();
      const attrData = {
        type: definition.ProgressionTreeType,
        treeGrid
      };
      this._trees.push(attrData);
    }
    if (this.onUpdate) {
      this.onUpdate(this);
    }
  }
  getCultureTreeData(attr) {
    for (const data of this._trees) {
      if (data.type == attr) {
        return data;
      }
    }
    const newData = {
      type: attr
    };
    this._trees.push(newData);
    return newData;
  }
  getCard(type) {
    if (type == void 0) {
      return void 0;
    }
    for (let iTree = 0; iTree < this._trees.length; iTree++) {
      const targetTree = this._trees[iTree];
      const targetCard = targetTree.treeGrid?.getCard(type);
      if (targetCard != void 0) {
        return targetCard;
      }
    }
    return void 0;
  }
  findNode(id) {
    return this.getCard(id);
  }
  findTree(type) {
    for (let iTree = 0; iTree < this._trees.length; iTree++) {
      const targetTree = this._trees[iTree];
      const targetCard = targetTree.treeGrid?.getCard(type);
      if (targetCard != void 0) {
        return targetTree;
      }
    }
    return null;
  }
  hoverItems(type) {
    const tree = this.findTree(type);
    if (!tree || !tree.treeGrid) {
      return [];
    }
    this._lastHighlightTree = tree;
    return tree.treeGrid.setHoverItem(type);
  }
  clearHoverItems() {
    return this._lastHighlightTree?.treeGrid?.clearHoverItems();
  }
}
const CultureTree = new CultureTreeModel();
engine.whenReady.then(() => {
  const updateModel = () => {
    engine.updateWholeModel(CultureTree);
  };
  engine.createJSModel("g_CultureTree", CultureTree);
  CultureTree.updateCallback = updateModel;
  engine.synchronizeModels();
});

export { CultureTreeModel, CultureTree as default };
//# sourceMappingURL=model-culture-tree.js.map
