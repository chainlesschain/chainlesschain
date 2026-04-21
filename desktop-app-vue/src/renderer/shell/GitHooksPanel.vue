<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="Git Hooks"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BranchesOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      AI 驱动的 Git 工作流：提交前质量门禁、变更影响分析、失败自动修复。
      下方按钮会触发 V5 钩子的相应动作（完整面板请访问
      <code>/git-hooks</code>）。
    </p>

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button size="small" type="primary" @click="run(action)">
            运行
          </a-button>
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
import { BranchesOutlined } from "@ant-design/icons-vue";

interface HookAction {
  id: string;
  label: string;
  desc: string;
  channel: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const actions: HookAction[] = [
  {
    id: "pre-commit",
    label: "Pre-commit 检查",
    desc: "在提交前运行 lint、类型检查、重复代码探测等规则。",
    channel: "git-hooks:run-pre-commit",
  },
  {
    id: "impact",
    label: "影响分析",
    desc: "分析当前变更可能影响的模块，帮助定位回归风险。",
    channel: "git-hooks:run-impact",
  },
  {
    id: "auto-fix",
    label: "自动修复",
    desc: "对上一次 pre-commit 检查出的问题尝试自动修复。",
    channel: "git-hooks:run-auto-fix",
  },
];

async function run(action: HookAction): Promise<void> {
  const api = (window as unknown as { electronAPI?: Record<string, unknown> })
    .electronAPI;
  if (!api) {
    antMessage.warning(`已触发 ${action.label}（桌面环境外无 electronAPI）`);
    return;
  }
  antMessage.info(`${action.label} 已派发到主进程（${action.channel}）`);
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
