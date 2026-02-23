<template>
  <a-modal
    :open="visible"
    title="导入编排模板"
    :footer="null"
    @cancel="$emit('close')"
  >
    <div class="template-list">
      <div
        v-for="tmpl in orchestrateTemplates"
        :key="tmpl.name"
        class="template-card"
        @click="importTemplate(tmpl.name)"
      >
        <div class="template-header">
          <span class="template-name">{{ tmpl.label }}</span>
          <a-tag color="blue">{{ tmpl.agentCount }} 步骤</a-tag>
        </div>
        <div class="template-desc">{{ templateDescriptions[tmpl.name] }}</div>
      </div>
    </div>

    <div v-if="loading" class="template-loading">
      <a-spin />
      <span>正在导入模板...</span>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useWorkflowDesignerStore } from "../../stores/workflow-designer";

defineProps({
  visible: { type: Boolean, default: false },
});

const emit = defineEmits(["close", "imported"]);
const store = useWorkflowDesignerStore();

const orchestrateTemplates = ref([]);
const loading = ref(false);

const templateDescriptions = {
  feature: "新功能开发: planner → architect → coder → reviewer → verify",
  bugfix: "Bug修复: debugger → coder → tester → verify",
  refactor: "代码重构: architect → coder → reviewer → verify",
  "security-audit": "安全审计: security → coder → security → verify",
};

onMounted(async () => {
  try {
    const result = await window.electronAPI?.invoke(
      "workflow:get-orchestrate-templates",
    );
    if (result?.success) {
      orchestrateTemplates.value = result.data;
    }
  } catch (e) {
    console.error("Failed to load orchestrate templates:", e);
  }
});

async function importTemplate(name) {
  loading.value = true;
  try {
    const workflowId = await store.importOrchestrateTemplate(name);
    if (workflowId) {
      emit("imported", workflowId);
      emit("close");
    }
  } catch (e) {
    console.error("Failed to import template:", e);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.template-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-card {
  padding: 12px 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.template-card:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.12);
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: #262626;
}

.template-desc {
  font-size: 12px;
  color: #8c8c8c;
}

.template-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: #8c8c8c;
  font-size: 13px;
}
</style>
