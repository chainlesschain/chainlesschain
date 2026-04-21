<template>
  <a-modal
    :open="open"
    :width="720"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="企业仪表盘"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BankOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      组织级指标总览——成员、知识条目、协作活动、存储、审计。
      下方为各分区入口（完整仪表盘请访问 <code>/enterprise</code>）。
    </p>

    <a-row :gutter="[12, 12]">
      <a-col v-for="metric in metrics" :key="metric.id" :span="12">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">{{ metric.label }}</span>
            <a-tag :color="metric.tone">
              {{ metric.tag }}
            </a-tag>
          </div>
          <p class="metric-desc">
            {{ metric.desc }}
          </p>
        </div>
      </a-col>
    </a-row>
  </a-modal>
</template>

<script setup lang="ts">
import { BankOutlined } from "@ant-design/icons-vue";

interface Metric {
  id: string;
  label: string;
  tag: string;
  tone: string;
  desc: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const metrics: Metric[] = [
  {
    id: "members",
    label: "成员",
    tag: "RBAC",
    tone: "blue",
    desc: "按角色/部门查看成员及其权限边界。",
  },
  {
    id: "knowledge",
    label: "知识条目",
    tag: "RAG",
    tone: "green",
    desc: "组织级知识库规模、增长与检索命中率。",
  },
  {
    id: "collab",
    label: "协作活动",
    tag: "CRDT",
    tone: "purple",
    desc: "正在进行的协作会话与编辑活跃度。",
  },
  {
    id: "storage",
    label: "存储",
    tag: "SQLCipher",
    tone: "orange",
    desc: "加密存储使用量与备份状态。",
  },
  {
    id: "audit",
    label: "审计日志",
    tag: "Compliance",
    tone: "red",
    desc: "合规事件追踪与不可篡改审计链。",
  },
  {
    id: "sso",
    label: "SSO/认证",
    tag: "OIDC",
    tone: "cyan",
    desc: "企业身份提供方配置与会话。",
  },
];
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

.metric-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.metric-label {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.metric-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}
</style>
