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
      下方按钮通过
      <code>useGitHooksStore</code> 调用主进程钩子（完整面板请访问
      <code>/git-hooks</code>）。
    </p>

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button
            size="small"
            type="primary"
            :loading="store.loading && lastAction === action.id"
            :disabled="store.loading && lastAction !== action.id"
            @click="run(action)"
          >
            运行
          </a-button>
        </div>
        <p class="action-desc">
          {{ action.desc }}
        </p>
        <div
          v-if="resultFor(action.id)"
          class="action-result"
          :class="resultTone(action.id)"
        >
          {{ resultFor(action.id) }}
        </div>
      </li>
    </ul>

    <a-alert
      v-if="store.error"
      class="error-alert"
      :message="store.error"
      type="error"
      show-icon
      closable
      @close="store.$patch({ error: null })"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { BranchesOutlined } from "@ant-design/icons-vue";
import { useGitHooksStore } from "../stores/git-hooks";

interface HookAction {
  id: "pre-commit" | "impact" | "auto-fix";
  label: string;
  desc: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useGitHooksStore();
const lastAction = ref<HookAction["id"] | null>(null);

const actions: HookAction[] = [
  {
    id: "pre-commit",
    label: "Pre-commit 检查",
    desc: "在提交前运行 lint、类型检查、重复代码探测等规则。",
  },
  {
    id: "impact",
    label: "影响分析",
    desc: "分析当前变更可能影响的模块，帮助定位回归风险。",
  },
  {
    id: "auto-fix",
    label: "自动修复",
    desc: "对上一次 pre-commit 检查出的问题尝试自动修复。",
  },
];

const preCommitSummary = computed(() => {
  const r = store.preCommitResults;
  if (!r) {
    return "";
  }
  const issues = r.issues?.length ?? 0;
  return r.passed
    ? `通过（${r.duration}ms，0 个问题）`
    : `未通过：${issues} 个问题（${r.duration}ms）`;
});

const impactSummary = computed(() => {
  const r = store.impactResults;
  if (!r) {
    return "";
  }
  return `风险评分 ${r.riskScore}，影响 ${r.affectedFiles.length} 个文件（${r.duration}ms）`;
});

const autoFixSummary = computed(() => {
  const r = store.autoFixResults;
  if (!r) {
    return "";
  }
  return `已修复 ${r.fixed.length} 项，剩余 ${r.remaining.length} 项（${r.duration}ms）`;
});

function resultFor(id: HookAction["id"]): string {
  if (id === "pre-commit") {
    return preCommitSummary.value;
  }
  if (id === "impact") {
    return impactSummary.value;
  }
  return autoFixSummary.value;
}

function resultTone(id: HookAction["id"]): string {
  if (id === "pre-commit") {
    return store.preCommitResults?.passed ? "tone-ok" : "tone-warn";
  }
  if (id === "impact") {
    const score = store.impactResults?.riskScore ?? 0;
    return score >= 0.7 ? "tone-warn" : "tone-ok";
  }
  return store.autoFixResults?.remaining.length ? "tone-warn" : "tone-ok";
}

async function run(action: HookAction): Promise<void> {
  lastAction.value = action.id;
  try {
    if (action.id === "pre-commit") {
      await store.runPreCommit([]);
    } else if (action.id === "impact") {
      await store.runImpactAnalysis([]);
    } else {
      await store.runAutoFix([]);
    }
  } catch {
    // store.error is displayed via <a-alert> — no further handling here
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

.action-result {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.action-result.tone-ok {
  background: var(--cc-shell-success-bg, #f6ffed);
  color: var(--cc-shell-success, #389e0d);
  border: 1px solid var(--cc-shell-success-border, #b7eb8f);
}

.action-result.tone-warn {
  background: var(--cc-shell-warn-bg, #fffbe6);
  color: var(--cc-shell-warn, #d48806);
  border: 1px solid var(--cc-shell-warn-border, #ffe58f);
}

.error-alert {
  margin-top: 12px;
}
</style>
