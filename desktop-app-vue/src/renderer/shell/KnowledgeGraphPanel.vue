<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="知识图谱"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <NodeIndexOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      将笔记、标签、语义相似度与时间线融合为可视化图谱，用于全局检索与推理。
      下方为图谱维护的常用操作（完整面板请访问 <code>/knowledge/graph</code>）。
    </p>

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button size="small" @click="trigger(action)"> 执行 </a-button>
        </div>
        <p class="action-desc">
          {{ action.desc }}
        </p>
      </li>
    </ul>
  </a-modal>
</template>

<script setup lang="ts">
import { message as antMessage } from "ant-design-vue";
import { NodeIndexOutlined } from "@ant-design/icons-vue";

interface GraphAction {
  id: string;
  label: string;
  desc: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const actions: GraphAction[] = [
  {
    id: "rebuild-all",
    label: "重建完整图谱",
    desc: "扫描所有笔记，重新抽取链接/标签/语义/时间关系。耗时较长。",
  },
  {
    id: "rebuild-tags",
    label: "仅重建标签关系",
    desc: "快速重建基于标签的关联，不触碰语义索引。",
  },
  {
    id: "refresh",
    label: "刷新统计与缓存",
    desc: "重新计算图谱统计信息，不重建数据。",
  },
];

function trigger(action: GraphAction): void {
  antMessage.info(`${action.label}（主进程接入将在后续迭代完成）`);
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
</style>
