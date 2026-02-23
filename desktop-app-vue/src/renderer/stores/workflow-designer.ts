/**
 * Workflow Designer Store
 * Manages workflow visual editor state including nodes, edges, execution.
 * @version 1.2.0
 */
import { defineStore } from 'pinia';
import { ref, computed, onUnmounted } from 'vue';

interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  type?: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, any>;
  viewport: { x: number; y: number; zoom: number };
  nodeCount: number;
  edgeCount: number;
  executionCount: number;
  lastExecutedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ExecutionState {
  executionId: string;
  state: string;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: any[];
  duration: number;
}

export const useWorkflowDesignerStore = defineStore('workflow-designer', () => {
  // State
  const workflows = ref<Workflow[]>([]);
  const currentWorkflow = ref<Workflow | null>(null);
  const nodes = ref<WorkflowNode[]>([]);
  const edges = ref<WorkflowEdge[]>([]);
  const selectedNode = ref<string | null>(null);
  const executionState = ref<ExecutionState | null>(null);
  const debugLog = ref<any[]>([]);
  const templates = ref<any[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Real-time execution status per node
  const nodeStatuses = ref<Record<string, string>>({});

  // Getters
  const availableSkillNodes = computed(() =>
    nodes.value.filter(n => n.type === 'skill')
  );

  const executingNodes = computed(() => {
    if (!executionState.value) return [];
    const idx = executionState.value.currentStepIndex;
    return nodes.value.filter((_, i) => i === idx + 1); // +1 for start node
  });

  const completedNodes = computed(() => {
    if (!executionState.value) return [];
    return executionState.value.stepResults.map(r => r.stepName);
  });

  // Step event listeners for real-time execution visualization
  const _cleanupListeners: (() => void)[] = [];

  function listenToExecution() {
    // Reset node statuses
    nodeStatuses.value = {};
    for (const node of nodes.value) {
      if (node.type !== 'start' && node.type !== 'end') {
        nodeStatuses.value[node.id] = 'pending';
      }
    }

    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.on) return;

    const onStarted = (_e: any, data: any) => {
      if (data?.nodeId) {
        nodeStatuses.value[data.nodeId] = 'running';
      }
    };
    const onCompleted = (_e: any, data: any) => {
      if (data?.nodeId) {
        nodeStatuses.value[data.nodeId] = 'completed';
      }
    };
    const onFailed = (_e: any, data: any) => {
      if (data?.nodeId) {
        nodeStatuses.value[data.nodeId] = 'failed';
      }
    };

    electronAPI.on('workflow:step:started', onStarted);
    electronAPI.on('workflow:step:completed', onCompleted);
    electronAPI.on('workflow:step:failed', onFailed);

    _cleanupListeners.push(() => {
      electronAPI.off?.('workflow:step:started', onStarted);
      electronAPI.off?.('workflow:step:completed', onCompleted);
      electronAPI.off?.('workflow:step:failed', onFailed);
    });
  }

  function cleanupListeners() {
    for (const cleanup of _cleanupListeners) {
      cleanup();
    }
    _cleanupListeners.length = 0;
  }

  // Actions
  async function loadWorkflows() {
    loading.value = true;
    error.value = null;
    try {
      const result = await (window as any).electronAPI?.invoke('workflow:list');
      if (result?.success) {
        workflows.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function createWorkflow(definition: Partial<Workflow> = {}) {
    try {
      const result = await (window as any).electronAPI?.invoke('workflow:create', definition);
      if (result?.success) {
        await loadWorkflows();
        return result.data.id;
      }
      throw new Error(result?.error || 'Failed to create workflow');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    }
  }

  async function loadWorkflow(workflowId: string) {
    loading.value = true;
    try {
      const result = await (window as any).electronAPI?.invoke('workflow:get', workflowId);
      if (result?.success) {
        currentWorkflow.value = result.data;
        nodes.value = result.data.nodes || [];
        edges.value = result.data.edges || [];
      }
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  function updateNode(nodeId: string, data: Record<string, any>) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (node) {
      node.data = { ...node.data, ...data };
    }
  }

  function updateNodePosition(nodeId: string, position: { x: number; y: number }) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (node) {
      node.position = { ...position };
    }
  }

  function addNode(node: Partial<WorkflowNode>) {
    const newNode: WorkflowNode = {
      id: node.id || `node-${Date.now()}`,
      type: node.type || 'skill',
      position: node.position || { x: 250, y: 200 },
      data: node.data || {},
    };
    nodes.value.push(newNode);
    return newNode.id;
  }

  function addConnection(edge: Partial<WorkflowEdge>) {
    const newEdge: WorkflowEdge = {
      id: edge.id || `edge-${Date.now()}`,
      source: edge.source || '',
      target: edge.target || '',
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      type: edge.type || 'default',
    };
    edges.value.push(newEdge);
    return newEdge.id;
  }

  function removeNode(nodeId: string) {
    nodes.value = nodes.value.filter(n => n.id !== nodeId);
    edges.value = edges.value.filter(e => e.source !== nodeId && e.target !== nodeId);
  }

  async function saveWorkflow() {
    if (!currentWorkflow.value) return;
    try {
      await (window as any).electronAPI?.invoke('workflow:save', {
        workflowId: currentWorkflow.value.id,
        updates: {
          nodes: nodes.value,
          edges: edges.value,
          name: currentWorkflow.value.name,
          description: currentWorkflow.value.description,
          variables: currentWorkflow.value.variables,
        },
      });
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function executeWorkflow(context: Record<string, any> = {}) {
    if (!currentWorkflow.value) return;
    loading.value = true;
    debugLog.value = [];

    // Start listening to step events for real-time visualization
    listenToExecution();

    try {
      const result = await (window as any).electronAPI?.invoke('workflow:execute', {
        workflowId: currentWorkflow.value.id,
        context,
      });
      if (result?.success) {
        executionState.value = result.data;
        return result.data;
      }
      throw new Error(result?.error || 'Execution failed');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function loadTemplates() {
    try {
      const result = await (window as any).electronAPI?.invoke('workflow:get-templates');
      if (result?.success) {
        templates.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function importPipeline(pipelineId: string) {
    try {
      const result = await (window as any).electronAPI?.invoke('workflow:import-pipeline', pipelineId);
      if (result?.success) {
        await loadWorkflows();
        return result.data.workflowId;
      }
    } catch (e: any) {
      error.value = e.message;
    }
    return null;
  }

  async function exportPipeline() {
    if (!currentWorkflow.value) return null;
    try {
      const result = await (window as any).electronAPI?.invoke('workflow:export-pipeline', currentWorkflow.value.id);
      if (result?.success) {
        return result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
    return null;
  }

  async function deleteWorkflow(workflowId: string) {
    try {
      await (window as any).electronAPI?.invoke('workflow:delete', workflowId);
      await loadWorkflows();
      if (currentWorkflow.value?.id === workflowId) {
        currentWorkflow.value = null;
        nodes.value = [];
        edges.value = [];
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function importOrchestrateTemplate(templateName: string) {
    try {
      const result = await (window as any).electronAPI?.invoke(
        'workflow:import-orchestrate',
        { templateName },
      );
      if (result?.success) {
        const data = result.data;
        // Create a new workflow with the orchestrate template nodes/edges
        const workflowId = await createWorkflow({
          name: data.name,
          description: `Imported from orchestrate template: ${templateName}`,
        });
        if (workflowId) {
          // Load and update with template nodes/edges
          await loadWorkflow(workflowId);
          nodes.value = data.nodes;
          edges.value = data.edges;
          await saveWorkflow();
        }
        return workflowId;
      }
      throw new Error(result?.error || 'Failed to import orchestrate template');
    } catch (e: any) {
      error.value = e.message;
      return null;
    }
  }

  return {
    workflows,
    currentWorkflow,
    nodes,
    edges,
    selectedNode,
    executionState,
    debugLog,
    templates,
    loading,
    error,
    nodeStatuses,
    availableSkillNodes,
    executingNodes,
    completedNodes,
    loadWorkflows,
    createWorkflow,
    loadWorkflow,
    updateNode,
    updateNodePosition,
    addNode,
    addConnection,
    removeNode,
    saveWorkflow,
    executeWorkflow,
    loadTemplates,
    importPipeline,
    exportPipeline,
    deleteWorkflow,
    importOrchestrateTemplate,
    cleanupListeners,
  };
});
