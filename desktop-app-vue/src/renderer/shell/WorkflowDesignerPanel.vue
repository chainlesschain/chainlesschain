<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="工作流设计器"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <PartitionOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      可视化编排 Agent、工具与条件分支的有向图工作流。 下方常见模板会通过
      <code>useWorkflowDesignerStore</code> 创建一个新的工作流骨架
      （完整设计器请访问 <code>/workflow-designer</code>）。
    </p>

    <ul class="action-list">
      <li v-for="tpl in templates" :key="tpl.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ tpl.label }}</span>
          <a-button
            size="small"
            :loading="creating === tpl.id"
            :disabled="store.loading && creating !== tpl.id"
            @click="pick(tpl)"
          >
            使用模板
          </a-button>
        </div>
        <p class="action-desc">
          {{ tpl.desc }}
        </p>
      </li>
    </ul>

    <a-alert
      v-if="store.error"
      class="error-alert"
      :message="store.error"
      type="error"
      show-icon
      closable
      @close="store.error = null"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { message as antMessage } from "ant-design-vue";
import { PartitionOutlined } from "@ant-design/icons-vue";
import { useWorkflowDesignerStore } from "../stores/workflow-designer";

interface Template {
  id: string;
  label: string;
  desc: string;
  category: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useWorkflowDesignerStore();
const creating = ref<string | null>(null);

const templates: Template[] = [
  {
    id: "blank",
    label: "空白工作流",
    desc: "从零开始编辑节点与连线。",
    category: "blank",
  },
  {
    id: "research",
    label: "研究助手",
    desc: "搜索 → 提取 → 总结 → 产出报告的标准研究管线。",
    category: "research",
  },
  {
    id: "code-review",
    label: "代码评审",
    desc: "检出 → 静态分析 → LLM 评审 → 汇总建议。",
    category: "review",
  },
  {
    id: "daily-digest",
    label: "每日摘要",
    desc: "定时触发 → 聚合最新笔记 → 生成摘要并入库。",
    category: "digest",
  },
];

async function pick(tpl: Template): Promise<void> {
  creating.value = tpl.id;
  try {
    const workflowId = await store.createWorkflow({
      name: tpl.label,
      description: tpl.desc,
      category: tpl.category,
      tags: ["shell-template", tpl.id],
    });
    if (workflowId) {
      antMessage.success(
        `已创建「${tpl.label}」(id: ${workflowId})，请到 /workflow-designer 打开`,
      );
    }
  } catch {
    // store.error surfaces via <a-alert>
  } finally {
    creating.value = null;
  }
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
}

.panel-desc {
  margin: 0 0 16px 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  line-height: 1.6;
}

.panel-desc code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.action-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.action-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.action-title {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.action-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}

.error-alert {
  margin-top: 12px;
}
</style>
