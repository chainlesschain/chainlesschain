<template>
  <div
    class="workflow-designer-page"
    style="height: 100%; display: flex; flex-direction: column"
  >
    <a-page-header title="工作流设计器" sub-title="Workflow Visual Designer">
      <template #extra>
        <a-button @click="createNew"> 新建 </a-button>
        <a-button type="primary" :loading="store.loading" @click="saveWorkflow">
          保存
        </a-button>
        <a-button :loading="executing" @click="executeWorkflow">
          执行
        </a-button>
        <a-button @click="exportPipeline"> 导出为流水线 </a-button>
      </template>
    </a-page-header>

    <div style="flex: 1; display: flex; min-height: 0">
      <!-- Left: Workflow list / Skill palette -->
      <div
        style="
          width: 240px;
          border-right: 1px solid #f0f0f0;
          overflow-y: auto;
          padding: 12px;
        "
      >
        <a-tabs size="small">
          <a-tab-pane key="workflows" tab="工作流">
            <a-list :data-source="store.workflows" size="small">
              <template #renderItem="{ item }">
                <a-list-item
                  style="cursor: pointer"
                  @click="loadWorkflow(item.id)"
                >
                  <a-list-item-meta :title="item.name">
                    <template #description>
                      {{ item.nodeCount }} 节点
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-tab-pane>
          <a-tab-pane key="skills" tab="技能">
            <SkillPalette />
          </a-tab-pane>
        </a-tabs>
      </div>

      <!-- Center: Canvas -->
      <div style="flex: 1; position: relative; background: #fafafa">
        <div
          v-if="!store.currentWorkflow"
          style="
            text-align: center;
            color: #999;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
          "
        >
          <div>
            <p style="font-size: 48px; margin: 0">&#128295;</p>
            <p>选择或创建一个工作流开始设计</p>
          </div>
        </div>
        <WorkflowCanvas
          v-else
          :nodes="store.nodes"
          :edges="store.edges"
          :selected-node="store.selectedNode"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
          @connect="onConnect"
          @drop="onCanvasDrop"
          @update:selected-node="store.selectedNode = $event"
        />
      </div>

      <!-- Right: Properties panel -->
      <NodePropertyPanel
        v-if="selectedNodeData"
        :node="selectedNodeData"
        style="width: 280px; border-left: 1px solid #f0f0f0"
        @update="onNodeDataChange"
        @remove="removeSelectedNode"
      />
    </div>

    <!-- Bottom: Debug panel -->
    <WorkflowDebugPanel
      v-if="store.executionState"
      :execution-state="store.executionState"
      :debug-log="store.debugLog || []"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useWorkflowDesignerStore } from "../stores/workflow-designer";
import WorkflowCanvas from "../components/workflow/WorkflowCanvas.vue";
import SkillPalette from "../components/workflow/SkillPalette.vue";
import NodePropertyPanel from "../components/workflow/NodePropertyPanel.vue";
import WorkflowDebugPanel from "../components/workflow/WorkflowDebugPanel.vue";

const store = useWorkflowDesignerStore();
const executing = ref(false);

const selectedNodeData = computed(() => {
  if (!store.selectedNode) {
    return null;
  }
  return store.nodes.find((n) => n.id === store.selectedNode) || null;
});

onMounted(async () => {
  await store.loadWorkflows();
});

async function createNew() {
  try {
    const id = await store.createWorkflow({ name: "新工作流" });
    if (id) {
      await store.loadWorkflow(id);
      message.success("工作流已创建");
    }
  } catch (error) {
    message.error(error.message);
  }
}

async function loadWorkflow(id) {
  await store.loadWorkflow(id);
}

async function saveWorkflow() {
  await store.saveWorkflow();
  message.success("已保存");
}

async function executeWorkflow() {
  executing.value = true;
  try {
    await store.executeWorkflow();
    message.success("工作流执行完成");
  } catch (error) {
    message.error(`执行失败: ${error.message}`);
  } finally {
    executing.value = false;
  }
}

async function exportPipeline() {
  const def = await store.exportPipeline();
  if (def) {
    message.success("已导出为流水线定义");
  }
}

function onNodeClick(event) {
  store.selectedNode = event.node?.id || null;
}

function onNodeDragStop(event) {
  if (event.node) {
    store.updateNodePosition(event.node.id, event.node.position);
  }
}

function onConnect(connection) {
  store.addConnection(connection);
}

function onCanvasDrop(dropData) {
  const nodeId = `${dropData.type}_${Date.now()}`;
  store.addNode({
    id: nodeId,
    type: dropData.type,
    position: dropData.position,
    data: {
      label: dropData.data?.label || dropData.type,
      ...(dropData.data || {}),
    },
  });
}

function onNodeDataChange() {
  // Auto-save on change
}

function removeSelectedNode() {
  if (store.selectedNode) {
    store.removeNode(store.selectedNode);
    store.selectedNode = null;
  }
}
</script>
