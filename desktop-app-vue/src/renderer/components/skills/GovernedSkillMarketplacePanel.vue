<template>
  <a-card
    title="受治理的 Skill 安装"
    class="governed-marketplace"
    data-testid="governed-marketplace"
  >
    <a-alert
      v-if="!available"
      type="warning"
      show-icon
      message="尚未配置受信任的 Desktop 市场部署，安装与启用不可用。"
    />
    <template v-else>
      <p>
        目标：{{ target.model }} / {{ target.os }} /
        {{ target.runtime }}。安装只落盘候选；启用必须经过逐阶段验证。
      </p>
      <a-space wrap>
        <a-input
          v-model:value="skillId"
          :disabled="busy"
          aria-label="Skill 标识"
          placeholder="Skill 标识，如 safe-refactor"
          data-testid="skill-id"
        />
        <a-input
          v-model:value="version"
          :disabled="busy"
          aria-label="目标版本"
          placeholder="目标版本（留空查询当前目录）"
          data-testid="skill-version"
        />
        <a-button
          :disabled="busy || !skillId.trim()"
          data-testid="inspect"
          @click="inspect"
        >
          检查签名与兼容性
        </a-button>
        <a-button
          :disabled="busy"
          data-testid="refresh-list"
          @click="refreshList"
        >
          刷新列表
        </a-button>
      </a-space>
      <div v-if="inspected" class="evidence" data-testid="inspection">
        <p>
          {{ inspected.skillName }} @ {{ inspected.version }} · 目标评分
          {{ inspected.qualityScore }} · 样本 {{ inspected.sampleCount }}
        </p>
        <p>
          签名目录摘要：<code>{{ inspected.manifestDigest }}</code>
        </p>
        <p>
          评测凭证：<code>{{ inspected.evalBadgeDigest }}</code>
        </p>
        <a-button
          type="primary"
          :disabled="
            busy ||
            (state?.revoked === true &&
              state.manifestDigest === inspected.manifestDigest)
          "
          data-testid="stage"
          @click="stage"
        >
          安装为候选（不启用）
        </a-button>
      </div>
      <div v-if="state" class="evidence" data-testid="current-state">
        <a-tag>
          {{ stateLabel(state.stage, Boolean(state.candidateBinding)) }}
        </a-tag>
        <p v-if="state.candidateBinding">
          候选文件：<code>{{ state.candidateBinding.candidateId }}</code>
        </p>
      </div>
      <a-divider />
      <p>
        阶段推进或撤销需要部署方已签发的回执引用。紧急撤销可填写账本中的精确状态摘要，无需读取损坏的候选文件。
      </p>
      <a-input
        v-model:value="expectedStateDigest"
        :disabled="busy"
        aria-label="精确状态摘要"
        placeholder="sha256:..."
        data-testid="expected-state"
      />
      <a-input
        v-model:value="receiptRef"
        :disabled="busy"
        aria-label="已认证回执引用"
        placeholder="receipt:..."
        data-testid="receipt"
      />
      <a-space class="actions" wrap>
        <a-button
          :disabled="!canRollout"
          data-testid="rollout"
          @click="rollout"
        >
          推进一个验证阶段
        </a-button>
        <a-button
          danger
          :disabled="!canRevoke"
          data-testid="revoke"
          @click="revoke"
        >
          撤销并回滚
        </a-button>
      </a-space>
      <a-table
        :columns="columns"
        :data-source="rows"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 10 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            {{ stateLabel(record.status, record.materialized) }}
          </template>
        </template>
      </a-table>
    </template>
    <a-alert
      v-if="notice"
      type="success"
      :message="notice"
      data-testid="notice"
    />
    <a-alert v-if="error" type="error" :message="error" data-testid="error" />
  </a-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

interface MarketplaceState {
  skillName: string;
  version: string;
  manifestDigest: string;
  stage: string;
  stateDigest: string;
  revoked: boolean;
  candidateBinding?: { candidateId: string };
}
interface Inspection {
  skillName: string;
  version: string;
  manifestDigest: string;
  evalBadgeDigest: string;
  qualityScore: number;
  sampleCount: number;
  state: MarketplaceState | null;
}
interface Row {
  id: string;
  name: string;
  version: string;
  status: string;
  materialized: boolean;
}
const available = ref(false);
const target = ref({ model: "", os: "", runtime: "" });
const skillId = ref("");
const version = ref("");
const inspected = ref<Inspection | null>(null);
const state = ref<MarketplaceState | null>(null);
const rows = ref<Row[]>([]);
const expectedStateDigest = ref("");
const receiptRef = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");
let generation = 0;
const columns = [
  { title: "Skill", dataIndex: "name" },
  { title: "版本", dataIndex: "version" },
  { title: "治理状态", key: "status" },
];
const hasExactReceipt = computed(
  () =>
    /^sha256:[a-f0-9]{64}$/.test(expectedStateDigest.value) &&
    receiptRef.value.trim().length > 0,
);
const canRevoke = computed(
  () =>
    available.value &&
    !busy.value &&
    skillId.value.trim().length > 0 &&
    hasExactReceipt.value,
);
const canRollout = computed(
  () =>
    canRevoke.value &&
    !!state.value?.candidateBinding &&
    !state.value.revoked &&
    ["candidate", "shadow", "canary"].includes(state.value.stage) &&
    state.value.stateDigest === expectedStateDigest.value,
);

watch([skillId, version], () => {
  generation += 1;
  inspected.value = null;
  state.value = null;
  expectedStateDigest.value = "";
  receiptRef.value = "";
  notice.value = "";
  error.value = "";
});

function invoke(channel: string, input?: unknown): Promise<any> {
  const api =
    (window as any).electronAPI || (window as any).electron?.ipcRenderer;
  if (typeof api?.invoke !== "function") {
    return Promise.reject(new Error("Desktop IPC 不可用"));
  }
  return api.invoke(channel, input);
}

async function run<T>(task: () => Promise<T>, apply: (result: T) => void) {
  if (busy.value) {
    return;
  }
  const current = generation;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await task();
    if (current === generation) {
      apply(result);
    }
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    busy.value = false;
  }
}

function stateLabel(stage: string, materialized: boolean) {
  if (stage === "candidate") {
    return materialized ? "候选已落盘（未启用）" : "仅元数据（需补齐文件）";
  }
  return (
    (
      {
        shadow: "影子验证（未启用）",
        canary: "小流量验证",
        active: "已启用",
        "rolled-back": "已撤销",
        unverified: "历史记录（未验证）",
      } as Record<string, string>
    )[stage] || stage
  );
}

function applyState(next: MarketplaceState) {
  state.value = next;
  expectedStateDigest.value = next.stateDigest;
  receiptRef.value = "";
  if (inspected.value) {
    inspected.value = { ...inspected.value, state: next };
  }
  rows.value = [
    {
      id: next.skillName,
      name: next.skillName,
      version: next.version,
      status: next.stage,
      materialized: !!next.candidateBinding,
    },
    ...rows.value.filter((row) => row.id !== next.skillName),
  ];
}

function inspect() {
  const input = {
    skillId: skillId.value.trim(),
    version: version.value.trim() || null,
  };
  inspected.value = null;
  state.value = null;
  expectedStateDigest.value = "";
  return run(
    () => invoke("skill-market:inspect", input),
    (result: Inspection) => {
      inspected.value = result;
      state.value = result.state;
      expectedStateDigest.value = result.state?.stateDigest || "";
    },
  );
}

function stage() {
  if (!inspected.value || inspected.value.skillName !== skillId.value.trim()) {
    return;
  }
  const input = {
    skillId: inspected.value.skillName,
    skillData: {
      version: inspected.value.version,
      manifestDigest: inspected.value.manifestDigest,
      expectedStateDigest: inspected.value.state?.stateDigest ?? null,
    },
  };
  return run(
    () => invoke("skill-market:install", input),
    (result) => {
      if (
        result.status !== "candidate-staged" ||
        result.materialized !== true ||
        result.activated !== false
      ) {
        throw new Error("安装回执未确认候选文件，不能显示为已安装");
      }
      applyState(result.state);
      notice.value = "候选文件已落盘，尚未启用。";
    },
  );
}

function rollout() {
  if (!canRollout.value) {
    return;
  }
  const input = {
    skillId: skillId.value.trim(),
    expectedStateDigest: expectedStateDigest.value,
    receiptRef: receiptRef.value.trim(),
  };
  return run(
    () => invoke("skill-market:rollout", input),
    (next: MarketplaceState) => {
      applyState(next);
      notice.value = stateLabel(next.stage, !!next.candidateBinding);
    },
  );
}

function revoke() {
  if (!canRevoke.value) {
    return;
  }
  const input = {
    skillId: skillId.value.trim(),
    expectedStateDigest: expectedStateDigest.value,
    receiptRef: receiptRef.value.trim(),
  };
  return run(
    () => invoke("skill-market:revoke", input),
    (next: MarketplaceState) => {
      applyState(next);
      notice.value = "撤销已确认，回滚状态已写入账本。";
    },
  );
}

function refreshList() {
  return run(
    () => invoke("skill-market:get-installed"),
    (result: Row[]) => {
      rows.value = result;
    },
  );
}

onMounted(async () => {
  await run(
    () => invoke("skill-market:capabilities", {}),
    (capability) => {
      available.value =
        capability.available === true && capability.target?.tool === "desktop";
      if (available.value) {
        target.value = capability.target;
      }
    },
  );
  if (available.value) {
    await refreshList();
  }
});
</script>

<style scoped>
.governed-marketplace {
  margin: 16px 0;
}
.evidence {
  margin-top: 16px;
  overflow-wrap: anywhere;
}
.actions {
  margin: 12px 0;
}
</style>
