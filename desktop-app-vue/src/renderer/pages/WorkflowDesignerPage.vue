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
            <div
              v-for="nodeType in nodeTypes"
              :key="nodeType.type"
              class="skill-palette-item"
              draggable="true"
              style="
                padding: 8px;
                margin: 4px 0;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                cursor: grab;
              "
              @dragstart="onDragStart($event, nodeType)"
            >
              <strong>{{ nodeType.label }}</strong>
              <div style="font-size: 12px; color: #999">
                {{ nodeType.description }}
              </div>
            </div>
          </a-tab-pane>
        </a-tabs>
      </div>

      <!-- Center: Canvas placeholder -->
      <div
        style="
          flex: 1;
          position: relative;
          background: #fafafa;
          display: flex;
          align-items: center;
          justify-content: center;
        "
      >
        <div
          v-if="!store.currentWorkflow"
          style="text-align: center; color: #999"
        >
          <p style="font-size: 48px; margin: 0">&#128295;</p>
          <p>选择或创建一个工作流开始设计</p>
          <p style="font-size: 12px">
            安装 @vue-flow/core 后可启用可视化拖拽编辑器
          </p>
        </div>
        <div
          v-else
          style="width: 100%; height: 100%; padding: 16px; overflow: auto"
        >
          <!-- Simple node display (replace with Vue Flow when dependency installed) -->
          <div
            v-for="node in store.nodes"
            :key="node.id"
            :style="{
              position: 'absolute',
              left: node.position.x + 'px',
              top: node.position.y + 60 + 'px',
              padding: '8px 16px',
              border: '2px solid ' + getNodeColor(node.type),
              borderRadius: node.type === 'condition' ? '0' : '8px',
              background: 'white',
              transform: node.type === 'condition' ? 'rotate(45deg)' : 'none',
              cursor: 'pointer',
              boxShadow:
                store.selectedNode === node.id ? '0 0 0 2px #1890ff' : 'none',
            }"
            @click="store.selectedNode = node.id"
          >
            <span
              :style="{
                transform:
                  node.type === 'condition' ? 'rotate(-45deg)' : 'none',
                display: 'inline-block',
              }"
            >
              {{ node.data?.label || node.id }}
            </span>
          </div>
        </div>
      </div>

      <!-- Right: Properties panel -->
      <div
        v-if="selectedNodeData"
        style="
          width: 280px;
          border-left: 1px solid #f0f0f0;
          overflow-y: auto;
          padding: 12px;
        "
      >
        <h4>节点属性</h4>
        <a-form layout="vertical" size="small">
          <a-form-item label="标签">
            <a-input
              v-model:value="selectedNodeData.data.label"
              @change="onNodeDataChange"
            />
          </a-form-item>
          <a-form-item v-if="selectedNodeData.type === 'skill'" label="技能ID">
            <a-input
              v-model:value="selectedNodeData.data.skillId"
              @change="onNodeDataChange"
            />
          </a-form-item>
          <a-form-item label="输出变量">
            <a-input
              v-model:value="selectedNodeData.data.outputVariable"
              @change="onNodeDataChange"
            />
          </a-form-item>
          <a-form-item
            v-if="
              selectedNodeData.type === 'condition' ||
              selectedNodeData.type === 'transform'
            "
            label="表达式"
          >
            <a-textarea
              v-model:value="selectedNodeData.data.expression"
              :rows="3"
              @change="onNodeDataChange"
            />
          </a-form-item>
          <a-form-item>
            <a-button danger size="small" block @click="removeSelectedNode">
              删除节点
            </a-button>
          </a-form-item>
        </a-form>
      </div>
    </div>

    <!-- Bottom: Debug panel -->
    <div
      v-if="store.executionState"
      style="
        height: 150px;
        border-top: 1px solid #f0f0f0;
        overflow-y: auto;
        padding: 8px 16px;
      "
    >
      <strong>执行日志</strong>
      <a-tag
        :color="
          store.executionState.state === 'completed'
            ? 'green'
            : store.executionState.state === 'failed'
              ? 'red'
              : 'blue'
        "
      >
        {{ store.executionState.state }}
      </a-tag>
      <span style="margin-left: 8px; color: #999"
        >{{ store.executionState.duration }}ms</span
      >
      <div
        v-for="step in store.executionState.stepResults"
        :key="step.stepIndex"
        style="font-size: 12px; padding: 2px 0"
      >
        <a-tag :color="step.success ? 'green' : 'red'" size="small">
          {{ step.success ? "OK" : "FAIL" }}
        </a-tag>
        {{ step.stepName }} — {{ step.duration }}ms
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useWorkflowDesignerStore } from "../stores/workflow-designer";

const store = useWorkflowDesignerStore();
const executing = ref(false);

const nodeTypes = [
  { type: "skill", label: "技能节点", description: "执行一个技能" },
  { type: "condition", label: "条件节点", description: "条件分支" },
  { type: "parallel", label: "并行节点", description: "并行执行" },
  { type: "transform", label: "转换节点", description: "数据转换" },
  { type: "loop", label: "循环节点", description: "遍历执行" },
];

const selectedNodeData = computed(() => {
  if (!store.selectedNode) {
    return null;
  }
  return store.nodes.find((n) => n.id === store.selectedNode) || null;
});

onMounted(async () => {
  await store.loadWorkflows();
});

function getNodeColor(type) {
  const colors = {
    start: "#52c41a",
    end: "#ff4d4f",
    skill: "#1890ff",
    condition: "#faad14",
    parallel: "#722ed1",
    transform: "#13c2c2",
    loop: "#eb2f96",
    merge: "#595959",
  };
  return colors[type] || "#d9d9d9";
}

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

function onDragStart(event, nodeType) {
  event.dataTransfer?.setData("application/json", JSON.stringify(nodeType));
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
