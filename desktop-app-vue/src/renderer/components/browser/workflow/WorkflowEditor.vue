<template>
  <div class="workflow-editor">
    <!-- Header -->
    <div class="editor-header">
      <div class="workflow-info">
        <a-input
          v-model:value="workflowName"
          placeholder="Workflow Name"
          class="workflow-name-input"
          :bordered="false"
          @blur="saveWorkflowName"
        />
        <a-tag v-if="workflow?.is_template" color="purple">Template</a-tag>
        <a-tag v-if="hasUnsavedChanges" color="orange">Unsaved</a-tag>
      </div>
      <div class="header-actions">
        <a-button-group>
          <a-button @click="saveWorkflow" :loading="saving">
            <template #icon><SaveOutlined /></template>
            Save
          </a-button>
          <a-button @click="runWorkflow" :disabled="!canRun" :loading="running">
            <template #icon><PlayCircleOutlined /></template>
            Run
          </a-button>
          <a-button @click="stopWorkflow" v-if="running" danger>
            <template #icon><StopOutlined /></template>
            Stop
          </a-button>
        </a-button-group>
        <a-dropdown>
          <a-button>
            <MoreOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleMenuClick">
              <a-menu-item key="duplicate">
                <CopyOutlined /> Duplicate
              </a-menu-item>
              <a-menu-item key="export">
                <ExportOutlined /> Export
              </a-menu-item>
              <a-menu-item key="import">
                <ImportOutlined /> Import
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item key="delete" danger>
                <DeleteOutlined /> Delete
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <!-- Main Content -->
    <div class="editor-content">
      <!-- Left Panel: Step Palette -->
      <div class="palette-panel" :class="{ collapsed: paletteCollapsed }">
        <div class="panel-header" @click="paletteCollapsed = !paletteCollapsed">
          <span v-if="!paletteCollapsed">Steps</span>
          <RightOutlined :rotate="paletteCollapsed ? 0 : 180" />
        </div>
        <step-palette
          v-if="!paletteCollapsed"
          @add-step="addStep"
        />
      </div>

      <!-- Center: Canvas -->
      <div class="canvas-panel">
        <workflow-canvas
          ref="canvasRef"
          :steps="steps"
          :selected-step="selectedStep"
          :execution-status="executionStatus"
          @select-step="selectStep"
          @reorder-steps="reorderSteps"
          @delete-step="deleteStep"
        />
      </div>

      <!-- Right Panel: Config -->
      <div class="config-panel" :class="{ collapsed: configCollapsed }">
        <div class="panel-header" @click="configCollapsed = !configCollapsed">
          <LeftOutlined :rotate="configCollapsed ? 180 : 0" />
          <span v-if="!configCollapsed">Configuration</span>
        </div>
        <step-config-panel
          v-if="!configCollapsed && selectedStep"
          :step="selectedStep"
          :variables="variables"
          @update-step="updateStep"
        />
        <div v-else-if="!configCollapsed && !selectedStep" class="no-selection">
          <InfoCircleOutlined />
          <p>Select a step to configure</p>
        </div>
      </div>
    </div>

    <!-- Bottom Panel: Variables & Test Runner -->
    <div class="bottom-panel" v-if="showBottomPanel">
      <a-tabs v-model:activeKey="bottomTab">
        <a-tab-pane key="variables" tab="Variables">
          <div class="variables-editor">
            <a-table
              :columns="variableColumns"
              :data-source="variableList"
              :pagination="false"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'value'">
                  <a-input
                    v-model:value="record.value"
                    size="small"
                    @change="updateVariable(record)"
                  />
                </template>
                <template v-if="column.key === 'action'">
                  <a-button type="link" danger size="small" @click="deleteVariable(record.name)">
                    <DeleteOutlined />
                  </a-button>
                </template>
              </template>
            </a-table>
            <a-button type="dashed" block @click="addVariable">
              <PlusOutlined /> Add Variable
            </a-button>
          </div>
        </a-tab-pane>
        <a-tab-pane key="test" tab="Test Runner">
          <workflow-test-runner
            :workflow-id="workflowId"
            :steps="steps"
            :variables="variables"
            @execution-update="handleExecutionUpdate"
          />
        </a-tab-pane>
        <a-tab-pane key="history" tab="History">
          <div class="execution-history">
            <a-list
              :data-source="executionHistory"
              :loading="loadingHistory"
              size="small"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <a-space>
                        <a-tag :color="getStatusColor(item.status)">{{ item.status }}</a-tag>
                        <span>{{ formatDate(item.started_at) }}</span>
                      </a-space>
                    </template>
                    <template #description>
                      <span v-if="item.duration">Duration: {{ item.duration }}ms</span>
                      <span v-if="item.error_message" class="error-text">{{ item.error_message }}</span>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- Toggle Bottom Panel -->
    <div class="bottom-toggle" @click="showBottomPanel = !showBottomPanel">
      <UpOutlined v-if="showBottomPanel" />
      <DownOutlined v-else />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  SaveOutlined,
  PlayCircleOutlined,
  StopOutlined,
  MoreOutlined,
  CopyOutlined,
  ExportOutlined,
  ImportOutlined,
  DeleteOutlined,
  RightOutlined,
  LeftOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons-vue';
import StepPalette from './StepPalette.vue';
import WorkflowCanvas from './WorkflowCanvas.vue';
import StepConfigPanel from './StepConfigPanel.vue';
import WorkflowTestRunner from './WorkflowTestRunner.vue';

const props = defineProps({
  workflowId: {
    type: String,
    default: null
  }
});

const emit = defineEmits(['saved', 'deleted']);

// State
const workflow = ref(null);
const workflowName = ref('New Workflow');
const steps = ref([]);
const variables = ref({});
const selectedStep = ref(null);
const hasUnsavedChanges = ref(false);
const saving = ref(false);
const running = ref(false);
const executionStatus = ref(null);
const executionHistory = ref([]);
const loadingHistory = ref(false);

// UI State
const paletteCollapsed = ref(false);
const configCollapsed = ref(false);
const showBottomPanel = ref(false);
const bottomTab = ref('variables');
const canvasRef = ref(null);

// Computed
const canRun = computed(() => steps.value.length > 0 && !running.value);

const variableList = computed(() => {
  return Object.entries(variables.value).map(([name, value]) => ({
    key: name,
    name,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value)
  }));
});

const variableColumns = [
  { title: 'Name', dataIndex: 'name', key: 'name', width: 150 },
  { title: 'Value', dataIndex: 'value', key: 'value' },
  { title: '', key: 'action', width: 50 }
];

// Methods
const loadWorkflow = async () => {
  if (!props.workflowId) return;

  try {
    const result = await window.electronAPI.browser.workflow.get(props.workflowId);
    if (result) {
      workflow.value = result;
      workflowName.value = result.name;
      steps.value = JSON.parse(result.steps || '[]');
      variables.value = JSON.parse(result.variables || '{}');
      hasUnsavedChanges.value = false;
    }
  } catch (error) {
    message.error('Failed to load workflow: ' + error.message);
  }
};

const loadHistory = async () => {
  if (!props.workflowId) return;

  loadingHistory.value = true;
  try {
    const result = await window.electronAPI.browser.workflow.listExecutions(props.workflowId, { limit: 20 });
    executionHistory.value = result.executions || [];
  } catch (error) {
    console.error('Failed to load history:', error);
  } finally {
    loadingHistory.value = false;
  }
};

const saveWorkflow = async () => {
  saving.value = true;
  try {
    const workflowData = {
      name: workflowName.value,
      steps: JSON.stringify(steps.value),
      variables: JSON.stringify(variables.value)
    };

    if (props.workflowId) {
      await window.electronAPI.browser.workflow.update(props.workflowId, workflowData);
    } else {
      const result = await window.electronAPI.browser.workflow.create(workflowData);
      emit('saved', result);
    }

    hasUnsavedChanges.value = false;
    message.success('Workflow saved');
  } catch (error) {
    message.error('Failed to save: ' + error.message);
  } finally {
    saving.value = false;
  }
};

const saveWorkflowName = () => {
  if (props.workflowId && workflowName.value !== workflow.value?.name) {
    hasUnsavedChanges.value = true;
  }
};

const runWorkflow = async () => {
  running.value = true;
  executionStatus.value = { status: 'running', currentStep: 0 };

  try {
    const result = await window.electronAPI.browser.workflow.executeInline(
      { steps: steps.value, variables: variables.value },
      null, // targetId will be auto-selected
      variables.value
    );

    executionStatus.value = { status: result.status, results: result.results };

    if (result.status === 'completed') {
      message.success('Workflow completed successfully');
    } else {
      message.error('Workflow failed: ' + result.errorMessage);
    }
  } catch (error) {
    message.error('Execution failed: ' + error.message);
    executionStatus.value = { status: 'failed', error: error.message };
  } finally {
    running.value = false;
    loadHistory();
  }
};

const stopWorkflow = async () => {
  if (executionStatus.value?.executionId) {
    try {
      await window.electronAPI.browser.workflow.cancel(executionStatus.value.executionId);
      message.info('Workflow cancelled');
    } catch (error) {
      message.error('Failed to cancel: ' + error.message);
    }
  }
  running.value = false;
};

const addStep = (stepTemplate) => {
  const newStep = {
    id: `step_${Date.now()}`,
    ...stepTemplate,
    config: { ...stepTemplate.defaultConfig }
  };
  steps.value.push(newStep);
  selectedStep.value = newStep;
  hasUnsavedChanges.value = true;
};

const selectStep = (step) => {
  selectedStep.value = step;
};

const updateStep = (updatedStep) => {
  const index = steps.value.findIndex(s => s.id === updatedStep.id);
  if (index !== -1) {
    steps.value[index] = updatedStep;
    hasUnsavedChanges.value = true;
  }
};

const deleteStep = (stepId) => {
  const index = steps.value.findIndex(s => s.id === stepId);
  if (index !== -1) {
    steps.value.splice(index, 1);
    if (selectedStep.value?.id === stepId) {
      selectedStep.value = null;
    }
    hasUnsavedChanges.value = true;
  }
};

const reorderSteps = (newSteps) => {
  steps.value = newSteps;
  hasUnsavedChanges.value = true;
};

const addVariable = () => {
  const name = `var_${Object.keys(variables.value).length + 1}`;
  variables.value[name] = '';
  hasUnsavedChanges.value = true;
};

const updateVariable = (record) => {
  try {
    variables.value[record.name] = JSON.parse(record.value);
  } catch {
    variables.value[record.name] = record.value;
  }
  hasUnsavedChanges.value = true;
};

const deleteVariable = (name) => {
  delete variables.value[name];
  hasUnsavedChanges.value = true;
};

const handleMenuClick = async ({ key }) => {
  switch (key) {
    case 'duplicate':
      if (props.workflowId) {
        try {
          const result = await window.electronAPI.browser.workflow.duplicate(
            props.workflowId,
            workflowName.value + ' (Copy)'
          );
          message.success('Workflow duplicated');
          emit('saved', result);
        } catch (error) {
          message.error('Failed to duplicate: ' + error.message);
        }
      }
      break;
    case 'export':
      if (props.workflowId) {
        try {
          const data = await window.electronAPI.browser.workflow.export(props.workflowId);
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${workflowName.value}.workflow.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (error) {
          message.error('Failed to export: ' + error.message);
        }
      }
      break;
    case 'import':
      // Handle import via file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
          const text = await file.text();
          try {
            const data = JSON.parse(text);
            const result = await window.electronAPI.browser.workflow.import(data);
            message.success('Workflow imported');
            emit('saved', result);
          } catch (error) {
            message.error('Failed to import: ' + error.message);
          }
        }
      };
      input.click();
      break;
    case 'delete':
      Modal.confirm({
        title: 'Delete Workflow',
        content: 'Are you sure you want to delete this workflow?',
        okText: 'Delete',
        okType: 'danger',
        onOk: async () => {
          if (props.workflowId) {
            try {
              await window.electronAPI.browser.workflow.delete(props.workflowId);
              message.success('Workflow deleted');
              emit('deleted', props.workflowId);
            } catch (error) {
              message.error('Failed to delete: ' + error.message);
            }
          }
        }
      });
      break;
  }
};

const handleExecutionUpdate = (status) => {
  executionStatus.value = status;
  if (status.status === 'completed' || status.status === 'failed') {
    running.value = false;
    loadHistory();
  }
};

const getStatusColor = (status) => {
  const colors = {
    pending: 'default',
    running: 'processing',
    paused: 'warning',
    completed: 'success',
    failed: 'error',
    cancelled: 'default'
  };
  return colors[status] || 'default';
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
};

// Event listener for workflow events
let unsubscribe = null;

onMounted(async () => {
  await loadWorkflow();
  await loadHistory();

  // Subscribe to workflow events
  unsubscribe = window.electronAPI.browser.workflow.onEvent((event) => {
    if (event.workflowId === props.workflowId) {
      handleExecutionUpdate(event);
    }
  });
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
});

// Watch for changes
watch(() => props.workflowId, () => {
  loadWorkflow();
  loadHistory();
});
</script>

<style scoped>
.workflow-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color, #f5f5f5);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
}

.workflow-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workflow-name-input {
  font-size: 18px;
  font-weight: 500;
  width: 300px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.editor-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.palette-panel,
.config-panel {
  width: 280px;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
}

.config-panel {
  border-right: none;
  border-left: 1px solid #e8e8e8;
}

.palette-panel.collapsed,
.config-panel.collapsed {
  width: 40px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  cursor: pointer;
  font-weight: 500;
}

.canvas-panel {
  flex: 1;
  overflow: auto;
  position: relative;
}

.no-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #999;
}

.no-selection .anticon {
  font-size: 32px;
  margin-bottom: 12px;
}

.bottom-panel {
  height: 250px;
  background: #fff;
  border-top: 1px solid #e8e8e8;
  overflow: hidden;
}

.bottom-panel :deep(.ant-tabs) {
  height: 100%;
}

.bottom-panel :deep(.ant-tabs-content) {
  height: calc(100% - 46px);
  overflow: auto;
}

.bottom-toggle {
  display: flex;
  justify-content: center;
  padding: 4px;
  background: #fff;
  border-top: 1px solid #e8e8e8;
  cursor: pointer;
}

.variables-editor {
  padding: 12px;
}

.execution-history {
  padding: 12px;
  max-height: 200px;
  overflow: auto;
}

.error-text {
  color: #ff4d4f;
  font-size: 12px;
}
</style>
