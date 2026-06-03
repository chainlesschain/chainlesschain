<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <ApartmentOutlined class="cc-preview-widget__icon" />
      <h3>跨链桥 MTC</h3>
      <p>
        桥操作（lock / mint / swap / msg-send）opt-in 写 MTC envelope， verifier
        不依赖 oracle 单点。详见
        <code>cc crosschain mtc-*</code> 命令组。
      </p>
    </section>

    <dl class="cc-preview-widget__kv">
      <div>
        <dt>桥 MTC 集成</dt>
        <dd>
          <span
            v-if="enabled"
            class="cc-preview-widget__badge cc-preview-widget__badge--ok"
          >
            已启用
          </span>
          <span
            v-else
            class="cc-preview-widget__badge cc-preview-widget__badge--pending"
          >
            未启用 · opt-in
          </span>
        </dd>
      </div>
      <div>
        <dt>互信模式</dt>
        <dd>{{ modeLabel }}</dd>
      </div>
      <div>
        <dt>批次间隔</dt>
        <dd>{{ batchIntervalLabel }}</dd>
      </div>
      <div>
        <dt>信任锚</dt>
        <dd>{{ trustAnchorLabel }}</dd>
      </div>
      <div>
        <dt>待批次关闭</dt>
        <dd>{{ stagingPending }}</dd>
      </div>
      <div>
        <dt>最近批次</dt>
        <dd>{{ lastBatchLabel }}</dd>
      </div>
      <div>
        <dt>签名算法</dt>
        <dd>{{ algLabel }}</dd>
      </div>
    </dl>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openCliHelp">
        查看 CLI 命令
      </a-button>
      <a-button block @click="openDocs"> 打开设计文档 </a-button>
    </div>

    <p class="cc-preview-widget__hint">
      实时状态请运行 <code>cc crosschain mtc-status --json</code>。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApartmentOutlined } from "@ant-design/icons-vue";

interface BridgeMtcStatus {
  config?: {
    enabled?: boolean;
    mode?: "independent" | "federated" | "light-client";
    alg?: string;
    batch_interval_seconds?: number;
    issuer?: string;
  };
  trust_anchors?: {
    chain_count?: number;
    total?: number;
    by_chain?: Record<string, number>;
  };
  staging?: { pending?: number };
  batches?: { total?: number; latest?: string | null };
}

interface MtcApi {
  getBridgeStatus?: () => Promise<BridgeMtcStatus>;
}

const enabled = ref(false);
const mode = ref<string>("independent");
const alg = ref<string>("ed25519");
const batchInterval = ref<number | null>(null);
const trustAnchorTotal = ref<number>(0);
const trustAnchorChainCount = ref<number>(0);
const stagingPending = ref<number | string>("—");
const latestBatch = ref<string | null>(null);

const modeLabel = computed(() => {
  switch (mode.value) {
    case "federated":
      return "Federated (M-of-N)";
    case "light-client":
      return "Light Client";
    default:
      return "Independent";
  }
});

const algLabel = computed(() => {
  if (alg.value === "slh-dsa-128f") {
    return "SLH-DSA-128F (PQC)";
  }
  return "Ed25519 (classical)";
});

const batchIntervalLabel = computed(() => {
  if (batchInterval.value === null) {
    return "—";
  }
  if (batchInterval.value < 60) {
    return `${batchInterval.value}s`;
  }
  if (batchInterval.value < 3600) {
    return `${Math.round(batchInterval.value / 60)}min`;
  }
  return `${Math.round(batchInterval.value / 3600)}h`;
});

const trustAnchorLabel = computed(() => {
  if (trustAnchorTotal.value === 0) {
    return "未配置";
  }
  return `${trustAnchorTotal.value} 锚 / ${trustAnchorChainCount.value} 链`;
});

const lastBatchLabel = computed(() => {
  return latestBatch.value || "尚未关批";
});

function openCliHelp() {
  const text = [
    "cc crosschain mtc-status --json",
    "cc crosschain bridge eth polygon 100 --mtc",
    "cc crosschain mtc-batch",
    "cc crosschain mtc-trust-anchor add ethereum <pubkey> --alg ed25519 --issuer <issuer>",
    "cc crosschain mtc-serve --interval 60",
  ].join("\n");
  // eslint-disable-next-line no-alert
  window.alert?.(`跨链桥 MTC 常用命令：\n\n${text}`);
}

function openDocs() {
  const url =
    "https://design.chainlesschain.com/mtc-cross-chain-bridge-v1.html";
  if (typeof window !== "undefined" && window.open) {
    window.open(url, "_blank", "noopener");
  }
}

onMounted(async () => {
  if (typeof window === "undefined") {
    return;
  }
  const api = (window as unknown as { electronAPI?: { mtc?: MtcApi } })
    .electronAPI?.mtc;
  if (!api?.getBridgeStatus) {
    // No IPC wired — render defaults.
    return;
  }
  try {
    const s = await api.getBridgeStatus();
    enabled.value = !!s?.config?.enabled;
    if (typeof s?.config?.mode === "string") {
      mode.value = s.config.mode;
    }
    if (typeof s?.config?.alg === "string") {
      alg.value = s.config.alg;
    }
    if (typeof s?.config?.batch_interval_seconds === "number") {
      batchInterval.value = s.config.batch_interval_seconds;
    }
    if (typeof s?.trust_anchors?.total === "number") {
      trustAnchorTotal.value = s.trust_anchors.total;
    }
    if (typeof s?.trust_anchors?.chain_count === "number") {
      trustAnchorChainCount.value = s.trust_anchors.chain_count;
    }
    if (typeof s?.staging?.pending === "number") {
      stagingPending.value = s.staging.pending;
    }
    latestBatch.value = s?.batches?.latest ?? null;
  } catch {
    /* keep defaults on IPC failure */
  }
});
</script>

<style scoped>
.cc-preview-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cc-preview-widget__hero {
  text-align: center;
  padding: 16px 8px 4px;
}

.cc-preview-widget__icon {
  font-size: 32px;
  color: var(--cc-preview-accent);
  margin-bottom: 8px;
}

.cc-preview-widget__hero h3 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-widget__hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cc-preview-text-secondary);
}

.cc-preview-widget__kv {
  margin: 0;
  padding: 10px 12px;
  background: var(--cc-preview-bg-hover);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__kv > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  gap: 8px;
}

.cc-preview-widget__kv dt {
  color: var(--cc-preview-text-secondary);
  margin: 0;
}

.cc-preview-widget__kv dd {
  margin: 0;
  color: var(--cc-preview-text-primary);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}

.cc-preview-widget__badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.cc-preview-widget__badge--ok {
  background: rgba(82, 196, 26, 0.15);
  color: #389e0d;
}

.cc-preview-widget__badge--pending {
  background: rgba(250, 173, 20, 0.15);
  color: #d48806;
}

.cc-preview-widget__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__hint {
  margin: 0;
  font-size: 11px;
  color: var(--cc-preview-text-secondary);
  text-align: center;
}

.cc-preview-widget__hint code {
  background: var(--cc-preview-bg-hover);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--cc-preview-font-mono, monospace);
  font-size: 11px;
}
</style>
