<template>
  <a-drawer
    :open="open"
    :title="title"
    :width="560"
    placement="right"
    @update:open="(v) => $emit('update:open', v)"
  >
    <a-alert
      type="info"
      show-icon
      :message="hintMessage"
      style="margin-bottom: 16px"
    />

    <a-form layout="vertical">
      <a-form-item label="Envelope 文件路径">
        <a-input
          v-model:value="envelopePath"
          placeholder="e.g. ~/.chainlesschain/marketplace-batches/000001/envelope-000000.json"
          allow-clear
        />
      </a-form-item>
      <a-form-item label="Landmark 文件路径">
        <a-input
          v-model:value="landmarkPath"
          placeholder="e.g. ~/.chainlesschain/marketplace-batches/000001/landmark.json"
          allow-clear
        />
      </a-form-item>
      <a-form-item>
        <a-button
          type="primary"
          :loading="verifying"
          :disabled="!envelopePath || !landmarkPath"
          @click="runVerify"
        >
          <template #icon>
            <SafetyOutlined />
          </template>
          运行验证
        </a-button>
      </a-form-item>
    </a-form>

    <a-divider />

    <div
      v-if="result"
      class="result-card"
      :class="{ pass: result.ok, fail: !result.ok }"
    >
      <div class="result-header">
        <component
          :is="result.ok ? CheckCircleOutlined : CloseCircleOutlined"
          class="result-icon"
        />
        <span class="result-text">{{
          result.ok ? "验证通过" : "验证失败"
        }}</span>
      </div>
      <a-descriptions :column="1" size="small" bordered>
        <a-descriptions-item label="结果">
          <a-tag :color="result.ok ? 'green' : 'red'">
            {{ result.ok ? "PASS" : "FAIL" }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="!result.ok && result.code" label="错误码">
          <span class="mono">{{ result.code }}</span>
          <a-tag
            v-if="result.recoverable"
            color="orange"
            style="margin-left: 8px"
          >
            可恢复
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="result.leaf?.subject" label="Subject">
          <span class="mono">{{ result.leaf.subject }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="result.leaf?.kind" label="Kind">
          <a-tag>{{ result.leaf.kind }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item
          v-if="result.treeHead?.tree_size"
          label="Tree size"
        >
          {{ result.treeHead.tree_size }}
        </a-descriptions-item>
        <a-descriptions-item v-if="result.treeHead?.issuer" label="Issuer">
          <span class="mono">{{ result.treeHead.issuer }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="signatureAlg" label="签名算法">
          <a-tag :color="signatureAlg.includes('SLH-DSA') ? 'cyan' : 'blue'">
            {{ signatureAlg }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <div v-if="error" class="error-card">
      <CloseCircleOutlined />
      <span>{{ error }}</span>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  SafetyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons-vue";

const props = defineProps<{
  open: boolean;
  title?: string;
  /** Optional pre-fill for envelope path (e.g. when invoked from a per-skill row) */
  defaultEnvelopePath?: string;
  /** Optional pre-fill for landmark path */
  defaultLandmarkPath?: string;
  /** Custom hint banner (otherwise a generic explainer) */
  hint?: string;
}>();

defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const envelopePath = ref(props.defaultEnvelopePath ?? "");
const landmarkPath = ref(props.defaultLandmarkPath ?? "");
const verifying = ref(false);
const result = ref<{
  ok: boolean;
  code?: string;
  recoverable?: boolean;
  leaf?: { subject?: string; kind?: string };
  treeHead?: { tree_size?: number; issuer?: string };
} | null>(null);
const error = ref<string>("");

watch(
  () => props.open,
  (v) => {
    if (v) {
      // Re-prefill on every open in case parent passed updated paths
      envelopePath.value = props.defaultEnvelopePath ?? envelopePath.value;
      landmarkPath.value = props.defaultLandmarkPath ?? landmarkPath.value;
      result.value = null;
      error.value = "";
    }
  },
);

const title = computed(() => props.title ?? "MTC 包含证明");
const hintMessage = computed(
  () =>
    props.hint ??
    "通过 electronAPI.mtc.verifyEnvelope 在主进程内执行验证（多算法 dispatcher 同时支持 Ed25519 和 SLH-DSA-128F）。文件路径应指向 cc mtc batch / publish-skills 输出的 envelope 和 landmark JSON。",
);
const signatureAlg = computed<string | null>(() => {
  // signature.alg is on the landmark snapshot, not the verify result.
  // We surface it here only when the renderer also fetched the landmark to read it.
  // Future enhancement: include alg in IPC return; for now derived externally.
  return null;
});

interface MtcApi {
  verifyEnvelope?: (
    envelope: unknown,
    landmark: unknown,
    opts?: unknown,
  ) => Promise<{
    ok: boolean;
    code?: string;
    recoverable?: boolean;
    leaf?: { subject?: string; kind?: string };
    treeHead?: { tree_size?: number; issuer?: string };
    error?: string;
  }>;
}

interface FsApi {
  readFile?: (path: string) => Promise<string>;
}

async function readJsonFile(path: string): Promise<unknown> {
  if (typeof window === "undefined") {
    throw new Error("not in renderer");
  }
  const fs = (window as unknown as { electronAPI?: { fs?: FsApi } }).electronAPI
    ?.fs;
  if (fs?.readFile) {
    const content = await fs.readFile(path);
    return JSON.parse(content);
  }
  // Fallback: use fetch with file:// protocol (only works for absolute paths in Electron)
  const url =
    path.startsWith("/") || /^[a-zA-Z]:/.test(path)
      ? `file:///${path.replace(/\\/g, "/")}`
      : path;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`无法读取文件: ${path}`);
  }
  return await r.json();
}

async function runVerify() {
  verifying.value = true;
  result.value = null;
  error.value = "";
  try {
    const [envelope, landmark] = await Promise.all([
      readJsonFile(envelopePath.value.trim()),
      readJsonFile(landmarkPath.value.trim()),
    ]);

    const api = (window as unknown as { electronAPI?: { mtc?: MtcApi } })
      .electronAPI?.mtc;
    if (!api?.verifyEnvelope) {
      error.value =
        "electronAPI.mtc.verifyEnvelope 未注册（需要 Phase 4.2 IPC）";
      return;
    }
    const r = await api.verifyEnvelope(envelope, landmark);
    result.value = r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    error.value = `验证失败: ${msg}`;
  } finally {
    verifying.value = false;
  }
}
</script>

<style scoped>
.mono {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}
.result-card {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--cc-preview-border, #d9d9d9);
}
.result-card.pass {
  background: rgba(82, 196, 26, 0.06);
  border-color: rgba(82, 196, 26, 0.3);
}
.result-card.fail {
  background: rgba(255, 77, 79, 0.06);
  border-color: rgba(255, 77, 79, 0.3);
}
.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 500;
}
.result-card.pass .result-header {
  color: #389e0d;
}
.result-card.fail .result-header {
  color: #cf1322;
}
.result-icon {
  font-size: 20px;
}
.error-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(255, 77, 79, 0.06);
  border: 1px solid rgba(255, 77, 79, 0.3);
  border-radius: 8px;
  color: #cf1322;
  font-size: 13px;
}
</style>
