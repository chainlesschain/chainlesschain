<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <SafetyOutlined class="cc-preview-widget__icon" />
      <h3>默克尔树证书 (MTC)</h3>
      <p>
        后量子安全签名压缩 — 批量签发 + inclusion proof，单证书携带物 ~700B 节省
        97%。已支持 SLH-DSA-SHA2-128F (FIPS 205)。
      </p>
    </section>

    <dl class="cc-preview-widget__kv">
      <div>
        <dt>Audit MTC</dt>
        <dd>
          <span
            v-if="auditEnabled"
            class="cc-preview-widget__badge cc-preview-widget__badge--ok"
          >
            已启用
          </span>
          <span
            v-else
            class="cc-preview-widget__badge cc-preview-widget__badge--pending"
          >
            未启用 · 已就绪
          </span>
        </dd>
      </div>
      <div>
        <dt>批次间隔</dt>
        <dd>{{ batchIntervalLabel }}</dd>
      </div>
      <div>
        <dt>待批次关闭</dt>
        <dd>{{ stagingCount }}</dd>
      </div>
      <div>
        <dt>最近批次</dt>
        <dd>{{ lastBatchLabel }}</dd>
      </div>
      <div>
        <dt>签名算法</dt>
        <dd>{{ signingAlgLabel }}</dd>
      </div>
    </dl>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openCliHelp">
        查看 CLI 命令
      </a-button>
      <a-button block @click="openDocs"> 打开使用指南 </a-button>
    </div>

    <p class="cc-preview-widget__hint">
      实时状态请运行 <code>cc audit mtc status --json</code>。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { SafetyOutlined } from "@ant-design/icons-vue";

interface AuditMtcStatus {
  config?: {
    enabled?: boolean;
    batch_interval_seconds?: number;
    namespace_prefix?: string;
  };
  staging?: { count?: number };
  batches?: {
    count?: number;
    last_batch_id?: string | null;
    last_closed_at?: string | null;
  };
}

interface MtcApi {
  getAuditStatus?: () => Promise<AuditMtcStatus>;
  getActiveAlg?: () => Promise<string>;
}

const auditEnabled = ref(false);
const batchInterval = ref<number | null>(null);
const stagingCount = ref<number | string>("—");
const lastBatchId = ref<string | null>(null);
const lastClosedAt = ref<string | null>(null);
const activeAlg = ref<string>("ed25519");

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

const lastBatchLabel = computed(() => {
  if (!lastBatchId.value) {
    return "尚未关批";
  }
  if (!lastClosedAt.value) {
    return `#${lastBatchId.value}`;
  }
  return `#${lastBatchId.value} · ${formatRelative(lastClosedAt.value)}`;
});

const signingAlgLabel = computed(() => {
  if (activeAlg.value === "slh-dsa-128f") {
    return "SLH-DSA-128F (PQC)";
  }
  return "Ed25519 (classical)";
});

function formatRelative(iso: string): string {
  try {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) {
      return iso;
    }
    const delta = Math.round((Date.now() - t) / 1000);
    if (delta < 60) {
      return `${delta}s 前`;
    }
    if (delta < 3600) {
      return `${Math.round(delta / 60)}min 前`;
    }
    if (delta < 86400) {
      return `${Math.round(delta / 3600)}h 前`;
    }
    return `${Math.round(delta / 86400)}d 前`;
  } catch {
    return iso;
  }
}

function openCliHelp() {
  // Show a notification with the canonical commands; routing to a full
  // settings panel for MTC is a future Phase 4 follow-up.
  const text = [
    "cc mtc batch <input> --alg slh-dsa-128f",
    "cc mtc publish-skills --once",
    "cc audit mtc status --json",
    "cc audit mtc enable --interval 3600",
  ].join("\n");
  // eslint-disable-next-line no-alert
  window.alert?.(`MTC CLI 常用命令：\n\n${text}`);
}

function openDocs() {
  const url =
    "https://docs.chainlesschain.com/guide/mtc-merkle-tree-certs.html";
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
  if (!api?.getAuditStatus) {
    // No IPC wired yet — leave defaults. Field labels render as "—" / "尚未关批".
    return;
  }
  try {
    const s = await api.getAuditStatus();
    auditEnabled.value = !!s?.config?.enabled;
    if (typeof s?.config?.batch_interval_seconds === "number") {
      batchInterval.value = s.config.batch_interval_seconds;
    }
    if (typeof s?.staging?.count === "number") {
      stagingCount.value = s.staging.count;
    }
    lastBatchId.value = s?.batches?.last_batch_id ?? null;
    lastClosedAt.value = s?.batches?.last_closed_at ?? null;
  } catch {
    /* keep defaults on IPC failure */
  }
  if (api.getActiveAlg) {
    try {
      const alg = await api.getActiveAlg();
      if (typeof alg === "string") {
        activeAlg.value = alg;
      }
    } catch {
      /* keep default */
    }
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
