import { Graph } from '../../../core/ui/graph-layout/graph.js';
import { GraphLayout } from '../../../core/ui/graph-layout/layout.js';
import { utils } from '../../../core/ui/graph-layout/utils.js';
import { formatStringArrayAsNewLineText } from '../../../core/ui/utilities/utilities-core-textprovider.js';
import { TreeGridDirection, LineDirection, TreeNodesSupport } from './tree-support.js';
import { getUnlockTargetName, getUnlockTargetDescriptions } from '../utilities/utilities-textprovider.js';
import { getUnlockTargetIconUrl } from '../../ui-next/screens/choosers/helpers.js';

/*
 * Zatygold's Observer Mode - base-game override.
 * Copied verbatim from the game's base-standard/ui/tree-grid/tree-grid.js
 * (build dated 2026-09-16). The only changes are marked "ZOM:", plus every
 * GameContext.localPlayerID read as zomLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/mp-observer/mp-observer-leader-view.js.
 */
const zomLocalPlayerID = () => globalThis.ZOMLeaderView?.playerID() ?? GameContext.localPlayerID;   // ZOM: the leader the Observer views (everyone else: the local player)

var TreeGridSourceType = /* @__PURE__ */ ((TreeGridSourceType2) => {
  TreeGridSourceType2[TreeGridSourceType2["ATTRIBUTES"] = 0] = "ATTRIBUTES";
  TreeGridSourceType2[TreeGridSourceType2["TECHS"] = 1] = "TECHS";
  TreeGridSourceType2[TreeGridSourceType2["CULTURE"] = 2] = "CULTURE";
  return TreeGridSourceType2;
})(TreeGridSourceType || {});
class TreeGrid {
  _player = -1;
  _sourceProgressionTree;
  _treeData;
  _grid = [];
  _lines = [];
  _direction = TreeGridDirection.HORIZONTAL;
  _activeTree;
  _extraColumns = 1;
  _extraRows = 1;
  _originRow = 1;
  _originColumn = 1;
  _collisionOffsetPX = 6;
  treeType = 0 /* ATTRIBUTES */;
  // Why not use progression tree type?
  targetRows = 0;
  targetColumns = 0;
  delegateGetIconPath;
  delegateTurnForNode;
  delegateCostForNode;
  canPurchaseNode;
  flipColumns;
  flipRows;
  currentResearching = null;
  queuedElements = 0;
  prerequisiteQueue = [];
  constructor(progressTreeType, configuration) {
    this._sourceProgressionTree = progressTreeType;
    if (configuration) {
      this._direction = configuration.direction;
      this._activeTree = configuration.activeTree;
      this._originRow = configuration.originRow ?? 1;
      this._originColumn = configuration.originColumn ?? 1;
      this._extraRows = configuration.extraRows ?? 1;
      this._extraColumns = configuration.extraColumns ?? 1;
      this.delegateGetIconPath = configuration.delegateGetIconPath;
      this.delegateTurnForNode = configuration.delegateTurnForNode;
      this.delegateCostForNode = configuration.delegateCostForNode;
      this.canPurchaseNode = configuration.canPurchaseNode;
      this.flipColumns = configuration.flipColumns;
      this.flipRows = configuration.flipRows;
      this.treeType = configuration.treeType ?? 0 /* ATTRIBUTES */;
    }
    this._player = zomLocalPlayerID();
    this._treeData = {
      rows: 0,
      columns: 0,
      dataHeight: 0,
      dataWidth: 0,
      layoutWidth: 0,
      layoutHeight: 0,
      extraRows: 0,
      extraColumns: 0,
      originRow: 0,
      originColumn: 0,
      horizontalCardSeparation: 0,
      verticalCardSeparation: 0,
      graphLayout: new Graph(),
      nodesAtDepth: [],
      cards: []
    };
  }
  initialize() {
    this.generateData();
    this.generateLayoutData();
    this.generateLinesData();
    this.generateGrid();
    this.generateCollisionData();
  }
  updateLines() {
    this._lines.length = 0;
    this.generateLinesData();
    this._lines.push({
      to: "none",
      from: "none",
      dummy: false,
      direction: LineDirection.SAME_LEVEL_LINE,
      level: 0,
      position: 0,
      locked: false
    });
  }
  get grid() {
    return this._grid;
  }
  get lines() {
    return this._lines;
  }
  generateData() {
    if (!this._sourceProgressionTree) {
      console.error("TreeGrid: generateData(): No available tree to generate");
      return;
    }
    const treeStructureNodes = Game.ProgressionTrees.getTreeStructure(
      this._sourceProgressionTree
    );
    if (!treeStructureNodes) {
      console.error("TreeGrid: generateData(): No nodes available for this tree: " + this._sourceProgressionTree);
      return;
    }
    this._treeData = {
      rows: 0,
      columns: 0,
      dataHeight: 0,
      dataWidth: 0,
      layoutWidth: 0,
      layoutHeight: 0,
      extraRows: 0,
      extraColumns: 0,
      originRow: 0,
      originColumn: 0,
      horizontalCardSeparation: 0,
      verticalCardSeparation: 0,
      graphLayout: new Graph(),
      nodesAtDepth: [],
      cards: []
    };
    const nodesAtDepth = [];
    const graph = new Graph();
    graph.setGraph({});
    graph.setDefaultEdgeLabel(function() {
      return {};
    });
    const localPlayerID = zomLocalPlayerID();
    const treeObject = Game.ProgressionTrees.getTree(zomLocalPlayerID(), this._sourceProgressionTree);
    if (!treeObject) {
      console.warn("tree-grid: No tree-object for tree with id: ", this._sourceProgressionTree);
    }
    const currentResearchIndex = treeObject?.nodes[treeObject.activeNodeIndex]?.nodeType;
    const lockedNodes = new Array();
    const contentTreeStructureNodes = treeStructureNodes.filter((structureNodeData) => {
      const contentVal = Game.ProgressionTrees.canEverUnlock(localPlayerID, structureNodeData.nodeType);
      const isLocked = contentVal.isLocked;
      if (isLocked) {
        lockedNodes.push(structureNodeData.nodeType);
      }
      return !isLocked;
    });
    const contentConnectedTreeStructureNodes = contentTreeStructureNodes.map((structureNodeData) => {
      structureNodeData.connectedNodeTypes = structureNodeData.connectedNodeTypes.filter((node) => {
        return !lockedNodes.includes(node);
      });
      return structureNodeData;
    });
    const localPlayer = Players.get(localPlayerID);
    let targetNode = void 0;
    if (!localPlayer) {
      console.warn(`tree-grid: Unable to find local player with ID ${localPlayer}`);
    } else {
      switch (this.treeType) {
        case 2 /* CULTURE */:
          targetNode = localPlayer.Culture?.getTargetNode();
          break;
        case 1 /* TECHS */:
          targetNode = localPlayer.Techs?.getTargetNode();
          break;
        case 0 /* ATTRIBUTES */:
        default:
          break;
      }
    }
    const AI = localPlayer?.AI;
    let path = [];
    if (!AI) {
      console.warn("tree-grid: Unable to get AI object for local player");
    } else {
      if (targetNode != void 0 && targetNode != -1) {
        path = AI.getProgressionTreePath(targetNode, 1);
      }
    }
    contentConnectedTreeStructureNodes.forEach((structureNodeData) => {
      const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(
        structureNodeData.nodeType
      );
      if (!nodeInfo) {
        console.warn("model-rectangular-grid: No information for node with id: ", structureNodeData.nodeType);
        return;
      }
      const id = structureNodeData.nodeType.toString();
      const identifier = id;
      graph.setNode(identifier, { label: `${identifier}` });
      structureNodeData.connectedNodeTypes.forEach((node) => {
        const childId = node.toString();
        const childIdentifier = childId;
        graph.setNode(childIdentifier, { label: `${childIdentifier}` });
        graph.setEdge(identifier, childIdentifier);
      });
      this._treeData.dataHeight = Math.max(this._treeData.dataHeight, structureNodeData.treeDepth);
      while (nodesAtDepth.length <= this._treeData.dataHeight) {
        nodesAtDepth.push([]);
      }
      const foundIndex = nodesAtDepth[structureNodeData.treeDepth].indexOf(structureNodeData.nodeType);
      if (foundIndex == -1) {
        nodesAtDepth[structureNodeData.treeDepth].push(structureNodeData.nodeType);
      }
      let localeName = Locale.compose(nodeInfo.Name ?? nodeInfo.ProgressionTreeNodeType);
      if (nodeInfo?.CivInjectedName && treeObject?.playerId != void 0) {
        const player = Players.get(treeObject?.playerId);
        const args = player ? [player.civilizationAdjective] : [];
        localeName = Locale.compose(nodeInfo.CivInjectedName, ...args);
      }
      const localeDescription = Locale.compose(nodeInfo.Description ?? "");
      const nodeState = Game.ProgressionTrees.getNodeState(
        this._player,
        structureNodeData.nodeType
      );
      const nodeData = Game.ProgressionTrees.getNode(
        this._player,
        structureNodeData.nodeType
      );
      const iconPath = this.delegateGetIconPath ? this.delegateGetIconPath(nodeInfo) : "";
      let isLocked = nodeState === ProgressionTreeNodeState.NODE_STATE_CLOSED;
      let lockedReason = "";
      if (nodeState <= ProgressionTreeNodeState.NODE_STATE_OPEN && this.canPurchaseNode != void 0 && !this.canPurchaseNode(structureNodeData.nodeType)) {
        isLocked = true;
        if (Game.ProgressionTrees.hasLegendUnlocked(this._player, structureNodeData.nodeType).isLocked) {
          lockedReason = Locale.compose(
            Game.ProgressionTrees.getLegendAttributeNodeLockedString(
              this._player,
              structureNodeData.nodeType
            )
          ) || "";
        }
      }
      let queued = false;
      let queueOrder = -1;
      if (path && path.length > 1 && nodeData) {
        for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
          if (path[pathIndex].nodeType == nodeData.nodeType) {
            queued = true;
            queueOrder = pathIndex + 1;
            break;
          }
        }
      }
      if (nodeData) {
        const turnsLeft = this.delegateTurnForNode ? this.delegateTurnForNode(nodeData.nodeType) : 0;
        const cost = this.delegateCostForNode ? this.delegateCostForNode(nodeData.nodeType) : nodeInfo.Cost;
        const costValue = cost ?? nodeInfo.Cost;
        const progressPercentage = 100 - (1 - nodeData.progress / costValue) * 100;
        const unlocksData = [];
        const unlocksByDepth = [];
        const treeNodeUnlocks = TreeNodesSupport.getValidNodeUnlocks(nodeData);
        const removableUnlocks = TreeNodesSupport.getRepeatedUniqueUnits(treeNodeUnlocks);
        for (const i of nodeData.unlockIndices) {
          const unlockInfo = GameInfo.ProgressionTreeNodeUnlocks[i];
          if (unlockInfo && !unlockInfo.Hidden) {
            if (unlockInfo.TargetKind == "KIND_UNIT") {
              const player = Players.get(zomLocalPlayerID());
              if (player && player.Units?.isBuildPermanentlyDisabled(unlockInfo.TargetType)) {
                continue;
              }
              if (removableUnlocks.includes(unlockInfo.TargetType)) {
                continue;
              }
            }
            const unlockName = getUnlockTargetName(unlockInfo.TargetType, unlockInfo.TargetKind);
            const unlockDescriptions = getUnlockTargetDescriptions(
              unlockInfo.TargetType,
              unlockInfo.TargetKind
            );
            const unlockFullDesc = formatStringArrayAsNewLineText(unlockDescriptions);
            const unlockIcon = getUnlockTargetIconUrl(unlockInfo.TargetType, unlockInfo.TargetKind);
            const unlockToolTip = unlockName.length ? unlockName : unlockFullDesc;
            if (!unlockFullDesc && !unlockName) {
              continue;
            }
            const nodeUIDisplayData = {
              name: unlockName,
              description: unlockFullDesc,
              depth: unlockInfo.UnlockDepth,
              icon: unlockIcon,
              tooltip: unlockToolTip,
              kind: unlockInfo.TargetKind,
              type: unlockInfo.TargetType
            };
            unlocksData.push(nodeUIDisplayData);
            while (unlocksByDepth.length < unlockInfo.UnlockDepth) {
              const currentDepth = Locale.toRomanNumeral(unlocksByDepth.length + 1);
              const isCompleted = unlocksByDepth.length < nodeData.depthUnlocked;
              const isCurrent = unlocksByDepth.length == nodeData.depthUnlocked && currentResearchIndex == structureNodeData.nodeType && (this._activeTree ? this._activeTree == this._sourceProgressionTree : true);
              const isLocked2 = nodeState == ProgressionTreeNodeState.NODE_STATE_CLOSED || !(unlocksByDepth.length <= nodeData.depthUnlocked);
              const unlockHeader = currentDepth;
              const depthLevel = [];
              for (let depth = 0; depth <= unlocksByDepth.length; depth++) {
                depthLevel.push({
                  /*empty object for now*/
                });
              }
              const newDepth = {
                header: unlockHeader,
                unlocks: [],
                isCompleted,
                isCurrent,
                isLocked: isLocked2,
                depthLevel,
                iconURL: iconPath
              };
              unlocksByDepth.push(newDepth);
            }
            unlocksByDepth[unlockInfo.UnlockDepth - 1].unlocks.push(nodeUIDisplayData);
          }
        }
        this._treeData.cards.push({
          row: -1,
          column: -1,
          name: localeName,
          hasData: false,
          isDummy: false,
          description: localeDescription,
          icon: iconPath,
          cost: costValue,
          progress: nodeData.progress,
          progressPercentage,
          turns: turnsLeft,
          currentDepthUnlocked: nodeData.depthUnlocked,
          maxDepth: nodeData.maxDepth,
          repeatedDepth: nodeData.repeatedDepth,
          unlocks: unlocksData,
          unlocksByDepth,
          unlocksByDepthString: JSON.stringify(unlocksByDepth),
          nodeState,
          isAvailable: this.isAvailable(nodeState),
          canBegin: this.canBegin(nodeState),
          isCurrent: nodeState === ProgressionTreeNodeState.NODE_STATE_IN_PROGRESS,
          isLocked,
          isCompleted: nodeState === ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED,
          isRepeatable: nodeData.depthUnlocked == 0 && nodeData.repeatedDepth > 0,
          isQueued: queued,
          queueOrder: queueOrder.toString(),
          isHoverQueued: false,
          treeDepth: structureNodeData.treeDepth,
          nodeType: nodeData.nodeType,
          lockedReason,
          connectedNodeTypes: structureNodeData.connectedNodeTypes,
          isContent: true,
          canPurchase: this.canPurchaseNode ? this.canPurchaseNode(structureNodeData.nodeType) : false
        });
      } else {
        this._treeData.cards.push({
          row: -1,
          column: -1,
          name: localeName,
          hasData: false,
          isDummy: false,
          description: localeDescription,
          icon: iconPath,
          cost: nodeInfo.Cost,
          progress: 0,
          progressPercentage: 0,
          unlocksByDepthString: "",
          turns: 0,
          currentDepthUnlocked: 0,
          maxDepth: 1,
          //TODO: need correct data
          repeatedDepth: 0,
          unlocks: [],
          nodeState,
          isAvailable: this.isAvailable(nodeState),
          canBegin: this.canBegin(nodeState),
          isCurrent: nodeState === ProgressionTreeNodeState.NODE_STATE_IN_PROGRESS,
          isLocked,
          isCompleted: nodeState === ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED,
          isRepeatable: false,
          isQueued: queued,
          queueOrder: queueOrder.toString(),
          isHoverQueued: false,
          treeDepth: structureNodeData.treeDepth,
          nodeType: structureNodeData.nodeType,
          connectedNodeTypes: structureNodeData.connectedNodeTypes,
          isContent: true,
          canPurchase: this.canPurchaseNode ? this.canPurchaseNode(structureNodeData.nodeType) : false
        });
      }
    });
    const layout = new GraphLayout(graph);
    const layoutGraph = layout.getLayoutGraph();
    this._treeData.cards.forEach((card) => {
      const nodeId = card.nodeType.toString();
      const rank = card.treeDepth;
      layoutGraph.setNode(nodeId, { ...layoutGraph.node(nodeId), rank });
    });
    layout.normalize(layoutGraph);
    layout.order(layoutGraph);
    this._treeData.graphLayout = layoutGraph;
    this._treeData.nodesAtDepth = nodesAtDepth;
    let max = -1;
    let indexOfLongestConnectionArray = -1;
    nodesAtDepth.forEach(function(a, i) {
      if (a.length > max) {
        max = a.length;
        indexOfLongestConnectionArray = i;
      }
    });
    this._treeData.dataWidth = nodesAtDepth.length;
    this._treeData.dataHeight = nodesAtDepth[indexOfLongestConnectionArray].length;
    if (this._direction == TreeGridDirection.HORIZONTAL) {
      this._treeData.layoutWidth = utils.maxRank(this._treeData.graphLayout) + 1;
      this._treeData.layoutHeight = utils.maxOrder(this._treeData.graphLayout) + 1;
    } else {
      this._treeData.layoutWidth = utils.maxOrder(this._treeData.graphLayout) + 1;
      this._treeData.layoutHeight = utils.maxRank(this._treeData.graphLayout) + 1;
    }
    this._treeData.horizontalCardSeparation = 2;
    this._treeData.verticalCardSeparation = 2;
    this._treeData.extraColumns = this._extraColumns;
    this._treeData.extraRows = this._extraRows;
    this._treeData.originColumn = this._originColumn;
    this._treeData.originRow = this._originRow;
    this._treeData.rows = this._treeData.layoutHeight * this._treeData.horizontalCardSeparation + this._treeData.extraRows;
    this._treeData.columns = this._treeData.layoutWidth * this._treeData.verticalCardSeparation + this._treeData.extraColumns;
  }
  generateLayoutData() {
    const graphLayout = this._treeData.graphLayout;
    const dummyNodes = graphLayout.nodes().filter((v) => {
      const node = graphLayout.node(v);
      return node.dummy == "edge";
    });
    if (dummyNodes.length > 0) {
      dummyNodes.forEach((v) => {
        const node = graphLayout.node(v);
        const predecessors = graphLayout.predecessors(v);
        const successors = graphLayout.successors(v);
        const from = predecessors[0];
        const to = successors ? successors[0] : node.edgeObj.w;
        if (from) {
          const card = this.getCard(from);
          if (card) {
            const index = card.connectedNodeTypes.indexOf(from);
            card.connectedNodeTypes.splice(index, 1);
            card.connectedNodeTypes.push(v);
          }
        }
        const dummyCard = {
          row: -1,
          column: -1,
          name: v,
          isDummy: true,
          hasData: false,
          description: "",
          icon: "",
          cost: 0,
          progress: 0,
          turns: 0,
          progressPercentage: 0,
          unlocksByDepthString: "",
          currentDepthUnlocked: 0,
          maxDepth: 0,
          repeatedDepth: 0,
          unlocks: [],
          nodeState: -1,
          canBegin: false,
          isAvailable: false,
          isContent: true,
          isCurrent: false,
          isCompleted: false,
          isHoverQueued: false,
          isLocked: true,
          isQueued: false,
          isRepeatable: false,
          nodeType: v,
          treeDepth: -1,
          connectedNodeTypes: [],
          canPurchase: false,
          queueOrder: ""
        };
        if (to) {
          const card = this.getCard(to);
          if (card) {
            dummyCard.isLocked = card.isLocked;
          }
          dummyCard.connectedNodeTypes.push(to);
        }
        this._treeData.cards.push(dummyCard);
      });
    }
    const layerOffsets = this.getVerticalOffsets(graphLayout);
    if (this.flipColumns === true) {
      const maxRank = utils.maxRank(this._treeData.graphLayout);
      for (let rank = 0; rank < maxRank; rank++) {
        let maxOrderThisRank = 0;
        this._treeData.cards.forEach((infoCard) => {
          const nodeId = infoCard.nodeType.toString();
          const node = graphLayout.node(nodeId);
          if (node.rank == rank) {
            if (node.order > maxOrderThisRank) {
              maxOrderThisRank = node.order;
            }
          }
        });
        this._treeData.cards.forEach((infoCard) => {
          const nodeId = infoCard.nodeType.toString();
          let node = graphLayout.node(nodeId);
          if (node.rank == rank) {
            node.order = maxOrderThisRank - node.order;
          }
        });
      }
    }
    if (this.flipRows === true) {
      const maxRank = utils.maxRank(this._treeData.graphLayout);
      this._treeData.cards.forEach((infoCard) => {
        const nodeId = infoCard.nodeType.toString();
        const node = graphLayout.node(nodeId);
        node.rank = maxRank - node.rank;
      });
    }
    const orderedCards = this._treeData.cards.sort((cardA, cardB) => {
      const nodeA = this._treeData.graphLayout.node(cardA.nodeType.toString());
      const nodeB = this._treeData.graphLayout.node(cardB.nodeType.toString());
      return nodeA.rank - nodeB.rank;
    });
    this._treeData.cards = orderedCards;
    this._treeData.cards.forEach((infoCard) => {
      let nodeId = infoCard.nodeType.toString();
      if (infoCard.isDummy) {
        nodeId = infoCard.name;
      }
      const node = graphLayout.node(nodeId);
      let row;
      let column;
      if (this._direction == TreeGridDirection.HORIZONTAL) {
        row = node.order;
        column = node.rank;
      } else {
        row = node.rank;
        column = node.order;
      }
      const offset = layerOffsets[this._direction == TreeGridDirection.HORIZONTAL ? column : row];
      const horizontalSeparation = this._treeData.horizontalCardSeparation;
      const verticalSeparation = this._treeData.verticalCardSeparation;
      const isSink = infoCard.connectedNodeTypes.length == 0;
      const isDummy = infoCard.isDummy;
      if (infoCard.row == -1) {
        infoCard.row = this._treeData.originRow + row * horizontalSeparation + (this._direction == TreeGridDirection.HORIZONTAL ? offset : 0);
      }
      if (infoCard.column == -1) {
        infoCard.column = this._treeData.originColumn + column * verticalSeparation + (this._direction == TreeGridDirection.VERTICAL ? offset : 0);
      }
      if (isSink) {
        const predecessors = graphLayout.predecessors(nodeId);
        if (predecessors.length == 1) {
          const lastParent = predecessors[predecessors.length - 1];
          const parentCard = this.getCard(lastParent);
          let parentChildSinks = 0;
          const parentChildrenGrids = [];
          parentCard?.connectedNodeTypes.forEach((node2) => {
            const card = this.getCard(node2.toString());
            const isSink2 = card?.connectedNodeTypes.length == 0;
            if (card) {
              parentChildrenGrids.push(card);
            }
            if (isSink2) {
              parentChildSinks++;
            }
          });
          if (parentCard && parentChildSinks == 1) {
            if (this._direction == TreeGridDirection.HORIZONTAL) {
              infoCard.row = parentCard.row;
            } else {
              infoCard.column = parentCard.column;
              while (this._treeData.cards.find(
                (child) => child.row === infoCard.row && child.column === infoCard.column && child.nodeType !== infoCard.nodeType
              )) {
                if (parentCard.column < this._treeData.columns / 2) {
                  infoCard.column -= this._treeData.verticalCardSeparation;
                } else {
                  infoCard.column += this._treeData.verticalCardSeparation;
                }
              }
            }
          }
        }
      }
      if (isDummy) {
        const connectedCardId = infoCard.connectedNodeTypes[0].toString();
        const connectedNode = graphLayout.node(nodeId);
        const childCard = this.getCard(connectedCardId);
        if (connectedNode && childCard) {
          if (this._direction == TreeGridDirection.HORIZONTAL) {
            childCard.row = infoCard.row;
          } else {
            childCard.column = infoCard.column;
          }
        }
      }
      infoCard.hasData = true;
      const cardInQueue = this.prerequisiteQueue.find((card) => {
        return card.nodeType == infoCard.nodeType;
      });
      if (cardInQueue) {
        infoCard.queuePriority = cardInQueue.queuePriority;
      }
      if (this.currentResearching && infoCard.nodeType == this.currentResearching.nodeType) {
        infoCard.queuePriority = this.currentResearching.queuePriority;
      }
    });
  }
  generateLinesData() {
    for (let i = 0; i < this._treeData.cards.length; i++) {
      const card = this._treeData.cards[i];
      const nodeId = card.nodeType;
      const nodeName = card.name;
      const connectedNodes = card.connectedNodeTypes;
      const isDummyFrom = card.isDummy;
      const fromLevel = this._direction == TreeGridDirection.HORIZONTAL ? card.column : card.row;
      const fromPosition = this._direction == TreeGridDirection.HORIZONTAL ? card.row : card.column;
      connectedNodes.forEach((nodeType) => {
        const childCard = this.getCard(nodeType.toString());
        if (!childCard) {
          console.log("tree-grid: generateLinesData(): No child card data for type: " + nodeType);
          return;
        }
        const toPosition = this._direction == TreeGridDirection.HORIZONTAL ? childCard.row : childCard.column;
        const direction = fromPosition > toPosition ? LineDirection.UP_LINE : fromPosition < toPosition ? LineDirection.DOWN_LINE : LineDirection.SAME_LEVEL_LINE;
        this._lines.push({
          from: nodeId,
          to: nodeType,
          locked: childCard.isLocked,
          dummy: isDummyFrom || childCard.isDummy,
          level: fromLevel,
          position: toPosition,
          direction,
          aliasFrom: nodeName,
          aliasTo: childCard.name
        });
      });
    }
  }
  getCard(type) {
    return this._treeData.cards.find((t) => t.nodeType == type);
  }
  getVerticalOffsets(graph) {
    const maxRank = utils.maxRank(graph);
    const maxOrder = utils.maxOrder(graph);
    const layers = utils.range(0, maxRank + 1).map(function() {
      return [];
    });
    graph.nodes().forEach((v) => {
      const node = graph.node(v);
      const rank = node.rank;
      const order = node.order;
      const layerNode = { v, order, rank };
      if (node) {
        layers[rank].push(layerNode);
      }
    });
    const maxHeight = maxOrder + 1;
    const layerOffsets = [];
    layers.forEach((layer) => {
      const layerOffset = maxHeight - layer.length;
      layerOffsets.push(layerOffset);
    });
    return layerOffsets;
  }
  generateGrid() {
    this.targetRows = this._treeData.rows;
    this.targetColumns = this._treeData.columns;
    if (this._direction == TreeGridDirection.HORIZONTAL) {
      for (let i = 0; i < this.targetColumns; i++) {
        this._grid[i] = [];
        for (let j = 0; j < this.targetRows; j++) {
          const card = { row: j, column: i };
          const dataCard = this._treeData.cards.find(
            (card2) => card2.row == j && card2.column == i
          );
          this._grid[i].push(dataCard || card);
        }
      }
    } else {
      for (let i = 0; i < this.targetRows; i++) {
        this._grid[i] = [];
        for (let j = 0; j < this.targetColumns; j++) {
          const card = { row: i, column: j };
          const dataCard = this._treeData.cards.find(
            (card2) => card2.row == i && card2.column == j
          );
          this._grid[i].push(dataCard || card);
        }
      }
    }
  }
  generateCollisionData() {
    if (this._direction == TreeGridDirection.VERTICAL) {
      return;
    }
    const toDummyLine = this._lines.find((line) => {
      const goesToDummy = line.dummy && String(line.to).includes("_d");
      const toLine = this._lines.find((toLine2) => toLine2.from == line.to);
      if (!toLine) {
        return;
      }
      const goesToAnotherDummy = toLine.dummy && String(toLine.to).includes("_d");
      return goesToDummy && !goesToAnotherDummy;
    });
    const toDummyLineLevel = toDummyLine?.level;
    if (!toDummyLineLevel) {
      return;
    }
    const levelLines = this._lines.filter((line) => line.level == toDummyLineLevel);
    const sameDirectionLines = levelLines.filter((line) => line.direction == toDummyLine.direction);
    const nextPositionLine = sameDirectionLines.find((line) => {
      if (toDummyLine.direction == LineDirection.UP_LINE) {
        return toDummyLine.position + this._treeData.horizontalCardSeparation == line.position;
      } else if (toDummyLine.direction == LineDirection.DOWN_LINE) {
        return toDummyLine.position - this._treeData.horizontalCardSeparation == line.position;
      }
      return void 0;
    });
    if (nextPositionLine) {
      toDummyLine.collisionOffset = toDummyLine.direction == LineDirection.UP_LINE ? -this._collisionOffsetPX : toDummyLine.direction == LineDirection.DOWN_LINE ? this._collisionOffsetPX : 0;
      nextPositionLine.collisionOffset = -toDummyLine.collisionOffset;
    }
  }
  /**
   * Helper to evaluate if we show the available visual state on a card based on a node state
   * @param state
   * @returns
   */
  isAvailable(state) {
    switch (state) {
      case ProgressionTreeNodeState.NODE_STATE_OPEN:
      case ProgressionTreeNodeState.NODE_STATE_IN_PROGRESS:
      case ProgressionTreeNodeState.NODE_STATE_UNLOCKED:
      case ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED:
        return true;
      case ProgressionTreeNodeState.NODE_STATE_INVALID:
      case ProgressionTreeNodeState.NODE_STATE_CLOSED:
        return false;
    }
    return false;
  }
  /**
   * Helper to evaluate if the card can be started based on node state
   * @param state
   * @returns
   */
  canBegin(state) {
    switch (state) {
      case ProgressionTreeNodeState.NODE_STATE_OPEN:
      case ProgressionTreeNodeState.NODE_STATE_IN_PROGRESS:
      case ProgressionTreeNodeState.NODE_STATE_UNLOCKED:
        return true;
      case ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED:
      case ProgressionTreeNodeState.NODE_STATE_INVALID:
      case ProgressionTreeNodeState.NODE_STATE_CLOSED:
        return false;
    }
    return false;
  }
  queueCardItems(nodeIndex) {
    this.queueItems(nodeIndex);
    this.activateQueueItems();
  }
  setHoverItem(nodeIndex) {
    const player = Players.get(zomLocalPlayerID());
    const AI = player?.AI;
    let highlightNodes;
    if (!AI) {
      console.error(`tree-grid: Can't get AI for player ${player?.id}`);
      return;
    }
    highlightNodes = [];
    const path = AI.getProgressionTreePath(nodeIndex, 1);
    if (!path) {
      console.warn(`tree-grid: No path found for ${nodeIndex}`);
      const card = this.getCard(nodeIndex.toString());
      if (!card) {
        console.error(`tree-grid: Can't get hovered card with nodeType ${nodeIndex}`);
        return highlightNodes;
      }
      card.isHoverQueued = true;
    }
    for (const qualifiedNode of path) {
      const type = qualifiedNode.nodeType;
      const card = this.getCard(type.toString());
      highlightNodes.push(type);
      if (!card) {
        console.error(`tree-grid: Can't get hovered card with nodeType ${type}`);
        return highlightNodes;
      }
      card.isHoverQueued = true;
    }
    return highlightNodes;
  }
  clearHoverItems() {
    let clearNodes;
    clearNodes = [];
    this._treeData.cards.forEach((card) => {
      if (card.isHoverQueued) {
        card.isHoverQueued = false;
        clearNodes.push(card.nodeType);
      }
    });
    return clearNodes;
  }
  /**
   * Queues the prerequisite nodes for a given node
   * @param {ProgressionTreeNodeType} nodeIndex Id for the selected node
   * @returns
   */
  queueItems(nodeIndex) {
    this.prerequisiteQueue.length = 0;
    this.queuedElements = 0;
    const player = Players.get(zomLocalPlayerID());
    const AI = player?.AI;
    if (!AI) {
      console.error(`model-rectangular-grid: Can't get AI for player ${player?.id}`);
      return;
    }
    const path = AI.getProgressionTreePath(nodeIndex, 1);
    if (!path) {
      console.warn(`model-rectangular-grid: No path found for ${nodeIndex}`);
      const card = this.getCard(nodeIndex.toString());
      if (!card) {
        console.error(`model-rectangular-grid: Can't get selected card with nodeType ${nodeIndex}`);
        return;
      }
      card.queuePriority = 0;
    }
    for (const qualifiedNode of path) {
      const type = qualifiedNode.nodeType;
      const card = this.getCard(type.toString());
      if (!card) {
        console.error(`model-rectangular-grid: Can't get selected card with nodeType ${type}`);
        return;
      }
      this.prerequisiteQueue.push(card);
      this.queuedElements++;
      card.queuePriority = this.queuedElements;
    }
  }
  /**
   * Activates by sendRequest the next queue item
   */
  activateQueueItems() {
    if (this.prerequisiteQueue.length > 0 && this.queuedElements > 0) {
      this.updateQueuePriorities();
      this.currentResearching = this.prerequisiteQueue.shift() || null;
      if (!this.currentResearching) {
        return;
      }
      this.queuedElements--;
      const args = { ProgressionTreeNodeType: this.currentResearching.nodeType };
      const result = Game.PlayerOperations.canStart(
        GameContext.localPlayerID,
        PlayerOperationTypes.SET_TECH_TREE_NODE,
        args,
        false
      );
      if (result.Success) {
        Game.PlayerOperations.sendRequest(
          GameContext.localPlayerID,
          PlayerOperationTypes.SET_TECH_TREE_NODE,
          args
        );
      }
    } else {
      this.currentResearching = null;
    }
  }
  updateQueuePriorities() {
    for (let [index, item] of this.prerequisiteQueue.entries()) {
      item.queuePriority = ++index;
    }
  }
  /**
   *  If true notifications for ChooseTech handler can be added and not automatically dismissed
   */
  canAddChooseNotification() {
    const player = zomLocalPlayerID();
    if (this.currentResearching) {
      const nodeState = Game.ProgressionTrees.getNodeState(
        player,
        this.currentResearching.nodeType
      );
      if (nodeState == ProgressionTreeNodeState.NODE_STATE_UNLOCKED || nodeState == ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED) {
        this.activateQueueItems();
        return false;
      }
    }
    return true;
  }
  getLastAvailableNodeType() {
    const card = this._treeData.cards.find((card2) => card2.isAvailable);
    if (card) {
      return card.nodeType.toString();
    }
    return this._treeData.cards[0].nodeType.toString();
  }
}

export { TreeGrid, TreeGridSourceType };
//# sourceMappingURL=tree-grid.js.map
