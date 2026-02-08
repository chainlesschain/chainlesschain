<template>
  <div class="step-palette">
    <a-input-search
      v-model:value="searchQuery"
      placeholder="Search steps..."
      class="search-input"
    />

    <div class="step-categories">
      <a-collapse v-model:active-key="activeCategories" :bordered="false">
        <a-collapse-panel
          v-for="category in filteredCategories"
          :key="category.key"
          :header="category.name"
        >
          <template #extra>
            <component :is="category.icon" />
          </template>
          <div class="step-list">
            <div
              v-for="step in category.steps"
              :key="step.type"
              class="step-item"
              draggable="true"
              @dragstart="handleDragStart($event, step)"
              @click="$emit('add-step', step)"
            >
              <div class="step-icon" :style="{ background: step.color }">
                <component :is="step.icon" />
              </div>
              <div class="step-info">
                <div class="step-name">
                  {{ step.name }}
                </div>
                <div class="step-desc">
                  {{ step.description }}
                </div>
              </div>
            </div>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import {
  GlobalOutlined,
  FormOutlined,
  SelectOutlined,
  SearchOutlined,
  ArrowDownOutlined,
  KeyOutlined,
  UploadOutlined,
  CopyOutlined,
  CodeOutlined,
  BranchesOutlined,
  RetweetOutlined,
  ClockCircleOutlined,
  SettingOutlined,
  CameraOutlined,
  EyeOutlined,
  ApiOutlined,
  DownloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons-vue";

const emit = defineEmits(["add-step"]);

const searchQuery = ref("");
const activeCategories = ref(["actions", "navigation"]);

const stepCategories = [
  {
    key: "navigation",
    name: "Navigation",
    icon: GlobalOutlined,
    steps: [
      {
        type: "action",
        action: "navigate",
        name: "Navigate",
        description: "Go to a URL",
        icon: GlobalOutlined,
        color: "#1890ff",
        defaultConfig: { url: "", waitUntil: "load" },
      },
      {
        type: "action",
        action: "goBack",
        name: "Go Back",
        description: "Navigate back",
        icon: ArrowDownOutlined,
        color: "#1890ff",
        defaultConfig: {},
      },
      {
        type: "action",
        action: "goForward",
        name: "Go Forward",
        description: "Navigate forward",
        icon: ArrowDownOutlined,
        color: "#1890ff",
        defaultConfig: {},
      },
      {
        type: "action",
        action: "reload",
        name: "Reload",
        description: "Refresh page",
        icon: RetweetOutlined,
        color: "#1890ff",
        defaultConfig: {},
      },
    ],
  },
  {
    key: "actions",
    name: "Actions",
    icon: ThunderboltOutlined,
    steps: [
      {
        type: "action",
        action: "click",
        name: "Click",
        description: "Click an element",
        icon: SelectOutlined,
        color: "#52c41a",
        defaultConfig: { selector: "", clickCount: 1 },
      },
      {
        type: "action",
        action: "type",
        name: "Type",
        description: "Enter text",
        icon: FormOutlined,
        color: "#52c41a",
        defaultConfig: { selector: "", text: "", clearFirst: false },
      },
      {
        type: "action",
        action: "select",
        name: "Select",
        description: "Select from dropdown",
        icon: SelectOutlined,
        color: "#52c41a",
        defaultConfig: { selector: "", value: "" },
      },
      {
        type: "action",
        action: "hover",
        name: "Hover",
        description: "Mouse over element",
        icon: EyeOutlined,
        color: "#52c41a",
        defaultConfig: { selector: "" },
      },
      {
        type: "action",
        action: "scroll",
        name: "Scroll",
        description: "Scroll page or element",
        icon: ArrowDownOutlined,
        color: "#52c41a",
        defaultConfig: { direction: "down", distance: 500 },
      },
      {
        type: "action",
        action: "keyboard",
        name: "Keyboard",
        description: "Press keys",
        icon: KeyOutlined,
        color: "#52c41a",
        defaultConfig: { keys: [], modifiers: [] },
      },
      {
        type: "action",
        action: "upload",
        name: "Upload",
        description: "Upload files",
        icon: UploadOutlined,
        color: "#52c41a",
        defaultConfig: { selector: "", files: [] },
      },
    ],
  },
  {
    key: "extraction",
    name: "Extraction",
    icon: DownloadOutlined,
    steps: [
      {
        type: "action",
        action: "extract",
        name: "Extract Data",
        description: "Extract text/attributes",
        icon: CopyOutlined,
        color: "#722ed1",
        defaultConfig: { selector: "", extractType: "text", variable: "" },
      },
      {
        type: "action",
        action: "screenshot",
        name: "Screenshot",
        description: "Capture screenshot",
        icon: CameraOutlined,
        color: "#722ed1",
        defaultConfig: { fullPage: false, element: "" },
      },
      {
        type: "action",
        action: "evaluate",
        name: "Run Script",
        description: "Execute JavaScript",
        icon: CodeOutlined,
        color: "#722ed1",
        defaultConfig: { script: "", variable: "" },
      },
    ],
  },
  {
    key: "control",
    name: "Control Flow",
    icon: BranchesOutlined,
    steps: [
      {
        type: "condition",
        name: "If Condition",
        description: "Conditional branch",
        icon: BranchesOutlined,
        color: "#fa8c16",
        defaultConfig: {
          condition: { left: "", operator: "==", right: "" },
          thenSteps: [],
          elseSteps: [],
        },
      },
      {
        type: "loop",
        name: "Loop",
        description: "Repeat steps",
        icon: RetweetOutlined,
        color: "#fa8c16",
        defaultConfig: { loopType: "for", count: 5, steps: [] },
      },
      {
        type: "wait",
        name: "Wait",
        description: "Wait for condition",
        icon: ClockCircleOutlined,
        color: "#fa8c16",
        defaultConfig: { waitType: "time", duration: 1000, selector: "" },
      },
      {
        type: "variable",
        name: "Set Variable",
        description: "Set a variable",
        icon: SettingOutlined,
        color: "#fa8c16",
        defaultConfig: { name: "", value: "" },
      },
    ],
  },
  {
    key: "advanced",
    name: "Advanced",
    icon: ApiOutlined,
    steps: [
      {
        type: "subprocess",
        name: "Sub-Workflow",
        description: "Run another workflow",
        icon: ApiOutlined,
        color: "#eb2f96",
        defaultConfig: { workflowId: "", passVariables: true },
      },
      {
        type: "try_catch",
        name: "Try/Catch",
        description: "Handle errors",
        icon: BranchesOutlined,
        color: "#eb2f96",
        defaultConfig: { trySteps: [], catchSteps: [] },
      },
    ],
  },
];

const filteredCategories = computed(() => {
  if (!searchQuery.value) {
    return stepCategories;
  }

  const query = searchQuery.value.toLowerCase();
  return stepCategories
    .map((category) => ({
      ...category,
      steps: category.steps.filter(
        (step) =>
          step.name.toLowerCase().includes(query) ||
          step.description.toLowerCase().includes(query),
      ),
    }))
    .filter((category) => category.steps.length > 0);
});

const handleDragStart = (event, step) => {
  event.dataTransfer.setData("step-template", JSON.stringify(step));
  event.dataTransfer.effectAllowed = "copy";
};
</script>

<style scoped>
.step-palette {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.search-input {
  margin: 12px;
}

.step-categories {
  flex: 1;
  overflow: auto;
}

.step-categories :deep(.ant-collapse-header) {
  padding: 8px 12px !important;
  font-weight: 500;
}

.step-categories :deep(.ant-collapse-content-box) {
  padding: 0 !important;
}

.step-list {
  display: flex;
  flex-direction: column;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.2s;
  border-bottom: 1px solid #f0f0f0;
}

.step-item:hover {
  background: #f5f5f5;
}

.step-item:active {
  background: #e6f7ff;
}

.step-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  flex-shrink: 0;
}

.step-info {
  flex: 1;
  min-width: 0;
}

.step-name {
  font-weight: 500;
  font-size: 13px;
}

.step-desc {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
