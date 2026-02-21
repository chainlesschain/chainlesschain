/**
 * SkillWorkflowEngine - 可视化工作流引擎
 *
 * 在 SkillPipelineEngine 之上添加可视化元数据层，
 * 支持节点位置、连线、端口等信息，为前端 Vue Flow 编辑器提供数据。
 *
 * @module ai-engine/cowork/skills/skill-workflow-engine
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../../utils/logger.js");

/**
 * Node types for workflow visual editor
 */
const NodeType = {
  SKILL_NODE: "skill",
  CONDITION_NODE: "condition",
  LOOP_NODE: "loop",
  PARALLEL_NODE: "parallel",
  MERGE_NODE: "merge",
  START_NODE: "start",
  END_NODE: "end",
  TRANSFORM_NODE: "transform",
};

class SkillWorkflowEngine extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.pipelineEngine - SkillPipelineEngine instance
   * @param {Object} [options.skillRegistry] - SkillRegistry instance
   */
  constructor(options = {}) {
    super();
    this.pipelineEngine = options.pipelineEngine;
    this.skillRegistry = options.skillRegistry || null;

    /** @type {Map<string, object>} Workflow definitions */
    this.workflows = new Map();

    logger.info("[SkillWorkflowEngine] Initialized");
  }

  /**
   * Create a new workflow
   * @param {object} definition - Workflow definition with visual metadata
   * @returns {string} Workflow ID
   */
  createWorkflow(definition = {}) {
    const id = definition.id || uuidv4();
    const workflow = {
      id,
      name: definition.name || "Untitled Workflow",
      description: definition.description || "",
      category: definition.category || "custom",
      tags: definition.tags || [],
      nodes: definition.nodes || [
        {
          id: "start-1",
          type: NodeType.START_NODE,
          position: { x: 250, y: 50 },
          data: { label: "Start" },
        },
        {
          id: "end-1",
          type: NodeType.END_NODE,
          position: { x: 250, y: 400 },
          data: { label: "End" },
        },
      ],
      edges: definition.edges || [],
      variables: definition.variables || {},
      viewport: definition.viewport || { x: 0, y: 0, zoom: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      executionCount: 0,
      lastExecutedAt: null,
    };

    this.workflows.set(id, workflow);
    this.emit("workflow:created", { workflowId: id, name: workflow.name });
    logger.info(
      `[SkillWorkflowEngine] Workflow created: ${workflow.name} (${id})`,
    );
    return id;
  }

  /**
   * Update a node's position
   * @param {string} workflowId
   * @param {string} nodeId
   * @param {object} position - { x, y }
   */
  updateNodePosition(workflowId, nodeId, position) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    node.position = position;
    workflow.updatedAt = Date.now();
    this.emit("workflow:node-moved", { workflowId, nodeId, position });
  }

  /**
   * Update a node's data
   * @param {string} workflowId
   * @param {string} nodeId
   * @param {object} data - Node data updates
   */
  updateNodeData(workflowId, nodeId, data) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    node.data = { ...node.data, ...data };
    workflow.updatedAt = Date.now();
    this.emit("workflow:node-updated", { workflowId, nodeId, data: node.data });
  }

  /**
   * Add a node to the workflow
   * @param {string} workflowId
   * @param {object} node - { type, position, data }
   * @returns {string} Node ID
   */
  addNode(workflowId, node) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const nodeId = node.id || `node-${uuidv4().slice(0, 8)}`;
    const newNode = {
      id: nodeId,
      type: node.type || NodeType.SKILL_NODE,
      position: node.position || { x: 250, y: 200 },
      data: node.data || {},
    };

    workflow.nodes.push(newNode);
    workflow.updatedAt = Date.now();
    this.emit("workflow:node-added", { workflowId, node: newNode });
    return nodeId;
  }

  /**
   * Remove a node and its connected edges
   * @param {string} workflowId
   * @param {string} nodeId
   */
  removeNode(workflowId, nodeId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.nodes = workflow.nodes.filter((n) => n.id !== nodeId);
    workflow.edges = workflow.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    );
    workflow.updatedAt = Date.now();
    this.emit("workflow:node-removed", { workflowId, nodeId });
  }

  /**
   * Add a connection between nodes
   * @param {string} workflowId
   * @param {object} edge - { source, target, sourceHandle?, targetHandle?, label? }
   * @returns {string} Edge ID
   */
  addConnection(workflowId, edge) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const edgeId = edge.id || `edge-${uuidv4().slice(0, 8)}`;
    const newEdge = {
      id: edgeId,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label || "",
      type: edge.type || "default",
    };

    workflow.edges.push(newEdge);
    workflow.updatedAt = Date.now();
    this.emit("workflow:edge-added", { workflowId, edge: newEdge });
    return edgeId;
  }

  /**
   * Remove a connection
   * @param {string} workflowId
   * @param {string} edgeId
   */
  removeConnection(workflowId, edgeId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.edges = workflow.edges.filter((e) => e.id !== edgeId);
    workflow.updatedAt = Date.now();
    this.emit("workflow:edge-removed", { workflowId, edgeId });
  }

  /**
   * Execute a workflow by converting to pipeline and executing
   * @param {string} workflowId
   * @param {object} context - Initial context
   * @returns {Promise<object>} Execution result
   */
  async executeWorkflow(workflowId, context = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    if (!this.pipelineEngine) {
      throw new Error("PipelineEngine not available");
    }

    // Convert workflow to pipeline
    const pipelineDef = this.exportToPipeline(workflowId);

    // Create temporary pipeline
    const pipelineId = this.pipelineEngine.createPipeline({
      ...pipelineDef,
      name: `[Workflow] ${workflow.name}`,
    });

    try {
      // Execute the pipeline
      const result = await this.pipelineEngine.executePipeline(pipelineId, {
        ...workflow.variables,
        ...context,
      });

      workflow.executionCount++;
      workflow.lastExecutedAt = Date.now();

      this.emit("workflow:executed", { workflowId, result });

      // Cleanup temp pipeline
      try {
        this.pipelineEngine.deletePipeline(pipelineId);
      } catch (_) {
        /* ignore */
      }

      return result;
    } catch (error) {
      // Cleanup temp pipeline
      try {
        this.pipelineEngine.deletePipeline(pipelineId);
      } catch (_) {
        /* ignore */
      }
      throw error;
    }
  }

  /**
   * Get a workflow
   * @param {string} workflowId
   * @returns {object|null}
   */
  getWorkflow(workflowId) {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * List all workflows
   * @returns {object[]}
   */
  listWorkflows() {
    return Array.from(this.workflows.values()).map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      category: w.category,
      tags: w.tags,
      nodeCount: w.nodes.length,
      edgeCount: w.edges.length,
      executionCount: w.executionCount,
      lastExecutedAt: w.lastExecutedAt,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));
  }

  /**
   * Delete a workflow
   * @param {string} workflowId
   */
  deleteWorkflow(workflowId) {
    if (!this.workflows.has(workflowId)) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    this.workflows.delete(workflowId);
    this.emit("workflow:deleted", { workflowId });
    logger.info(`[SkillWorkflowEngine] Workflow deleted: ${workflowId}`);
  }

  /**
   * Save/update a workflow
   * @param {string} workflowId
   * @param {object} updates
   */
  saveWorkflow(workflowId, updates = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Merge updates (preserving nested structures)
    if (updates.nodes) {
      workflow.nodes = updates.nodes;
    }
    if (updates.edges) {
      workflow.edges = updates.edges;
    }
    if (updates.name) {
      workflow.name = updates.name;
    }
    if (updates.description !== undefined) {
      workflow.description = updates.description;
    }
    if (updates.category) {
      workflow.category = updates.category;
    }
    if (updates.tags) {
      workflow.tags = updates.tags;
    }
    if (updates.variables) {
      workflow.variables = updates.variables;
    }
    if (updates.viewport) {
      workflow.viewport = updates.viewport;
    }

    workflow.updatedAt = Date.now();
    this.emit("workflow:saved", { workflowId });
  }

  /**
   * Import a pipeline as a workflow (add visual metadata)
   * @param {string} pipelineId
   * @returns {string} New workflow ID
   */
  importFromPipeline(pipelineId) {
    if (!this.pipelineEngine) {
      throw new Error("PipelineEngine not available");
    }

    const pipeline = this.pipelineEngine.getPipeline(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }

    // Convert pipeline steps to workflow nodes
    const nodes = [
      {
        id: "start-1",
        type: NodeType.START_NODE,
        position: { x: 250, y: 50 },
        data: { label: "Start" },
      },
    ];
    const edges = [];
    let prevNodeId = "start-1";
    let yPos = 150;

    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      const nodeId = `node-${i + 1}`;

      let nodeType = NodeType.SKILL_NODE;
      if (step.type === "condition") {
        nodeType = NodeType.CONDITION_NODE;
      } else if (step.type === "parallel") {
        nodeType = NodeType.PARALLEL_NODE;
      } else if (step.type === "transform") {
        nodeType = NodeType.TRANSFORM_NODE;
      } else if (step.type === "loop") {
        nodeType = NodeType.LOOP_NODE;
      }

      nodes.push({
        id: nodeId,
        type: nodeType,
        position: { x: 250, y: yPos },
        data: {
          label: step.name || step.skillId || `Step ${i + 1}`,
          skillId: step.skillId,
          inputMapping: step.inputMapping,
          outputVariable: step.outputVariable,
          config: step.config,
          expression: step.expression,
        },
      });

      edges.push({
        id: `edge-${i}`,
        source: prevNodeId,
        target: nodeId,
        type: "default",
      });

      prevNodeId = nodeId;
      yPos += 120;
    }

    // Add end node
    const endNodeId = "end-1";
    nodes.push({
      id: endNodeId,
      type: NodeType.END_NODE,
      position: { x: 250, y: yPos },
      data: { label: "End" },
    });
    edges.push({
      id: `edge-end`,
      source: prevNodeId,
      target: endNodeId,
      type: "default",
    });

    return this.createWorkflow({
      name: `[Imported] ${pipeline.name}`,
      description: pipeline.description,
      category: pipeline.category,
      tags: pipeline.tags,
      nodes,
      edges,
      variables: pipeline.variables,
    });
  }

  /**
   * Export a workflow as a pipeline definition
   * @param {string} workflowId
   * @returns {object} Pipeline definition
   */
  exportToPipeline(workflowId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Topological sort of nodes based on edges
    const sortedNodes = this._topologicalSort(workflow.nodes, workflow.edges);

    // Convert nodes to pipeline steps (skip start/end nodes)
    const steps = sortedNodes
      .filter(
        (node) =>
          node.type !== NodeType.START_NODE &&
          node.type !== NodeType.END_NODE &&
          node.type !== NodeType.MERGE_NODE,
      )
      .map((node) => {
        const step = {
          name: node.data?.label || node.id,
          type: this._nodeTypeToPipelineType(node.type),
        };

        if (node.data?.skillId) {
          step.skillId = node.data.skillId;
        }
        if (node.data?.inputMapping) {
          step.inputMapping = node.data.inputMapping;
        }
        if (node.data?.outputVariable) {
          step.outputVariable = node.data.outputVariable;
        }
        if (node.data?.config) {
          step.config = node.data.config;
        }
        if (node.data?.expression) {
          step.expression = node.data.expression;
        }
        if (node.data?.retries) {
          step.retries = node.data.retries;
        }

        return step;
      });

    return {
      name: workflow.name,
      description: workflow.description,
      category: workflow.category,
      tags: workflow.tags,
      steps,
      variables: workflow.variables,
    };
  }

  // ==========================================
  // Private helpers
  // ==========================================

  /** @private Topological sort using Kahn's algorithm */
  _topologicalSort(nodes, edges) {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const inDegree = new Map(nodes.map((n) => [n.id, 0]));
    const adjacency = new Map(nodes.map((n) => [n.id, []]));

    for (const edge of edges) {
      if (adjacency.has(edge.source)) {
        adjacency.get(edge.source).push(edge.target);
      }
      if (inDegree.has(edge.target)) {
        inDegree.set(edge.target, inDegree.get(edge.target) + 1);
      }
    }

    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const sorted = [];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      const node = nodeMap.get(nodeId);
      if (node) {
        sorted.push(node);
      }

      for (const neighbor of adjacency.get(nodeId) || []) {
        const newDegree = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return sorted;
  }

  /** @private Map NodeType to PipelineEngine StepType */
  _nodeTypeToPipelineType(nodeType) {
    const mapping = {
      [NodeType.SKILL_NODE]: "skill",
      [NodeType.CONDITION_NODE]: "condition",
      [NodeType.PARALLEL_NODE]: "parallel",
      [NodeType.TRANSFORM_NODE]: "transform",
      [NodeType.LOOP_NODE]: "loop",
    };
    return mapping[nodeType] || "skill";
  }
}

module.exports = { SkillWorkflowEngine, NodeType };
