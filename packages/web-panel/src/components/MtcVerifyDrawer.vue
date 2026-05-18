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
          placeholder="e.g. ./mtc-out/envelope-000000.json"
          allow-clear
        />
      </a-form-item>
      <a-form-item label="Landmark 文件路径">
        <a-input
          v-model:value="landmarkPath"
          placeholder="e.g. ./mtc-out/landmark.json"
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
          <template #icon><SafetyOutlined /></template>
          运行 cc mtc verify
        </a-button>
      </a-form-item>
    </a-form>

    <a-divider />

    <a-card v-if="result" :class="['result-card', result.ok ? 'pass' : 'fail']" size="small">
      <template #title>
        <component :is="result.ok ? CheckCircleOutlined : CloseCircleOutlined" />
        <span style="margin-left: 8px">{{ result.ok ? '验证通过' : '验证失败' }}</span>
      </template>
      <a-descriptions :column="1" size="small" bordered>
        <a-descriptions-item label="结果">
          <a-tag :color="result.ok ? 'green' : 'red'">{{ result.ok ? 'PASS' : 'FAIL' }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="!result.ok && result.code" label="错误码">
          <span class="mono">{{ result.code }}</span>
          <a-tag v-if="result.recoverable" color="orange" style="margin-left: 8px">可恢复</a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="result.leaf?.subject" label="Subject">
          <span class="mono">{{ result.leaf.subject }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="result.leaf?.kind" label="Kind">
          <a-tag>{{ result.leaf.kind }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item v-if="result.treeHead?.tree_size" label="Tree size">
          {{ result.treeHead.tree_size }}
        </a-descriptions-item>
        <a-descriptions-item v-if="result.treeHead?.issuer" label="Issuer">
          <span class="mono">{{ result.treeHead.issuer }}</span>
        </a-descriptions-item>
      </a-descriptions>
      <a-collapse v-if="result.raw" ghost style="margin-top: 12px">
        <a-collapse-panel key="raw" header="原始 JSON 输出">
          <pre class="raw-pre">{{ JSON.stringify(result.raw, null, 2) }}</pre>
        </a-collapse-panel>
      </a-collapse>
    </a-card>

    <a-alert
      v-if="error"
      type="error"
      :message="error"
      style="margin-top: 12px"
    />
  </a-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { SafetyOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { parseVerifyResult } from '../utils/mtc-parser.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: 'MTC 包含证明' },
  /** Optional pre-fill for envelope path (e.g. when invoked from a per-DID row) */
  defaultEnvelopePath: { type: String, default: '' },
  /** Optional pre-fill for landmark path */
  defaultLandmarkPath: { type: String, default: '' },
  /** Custom hint banner (otherwise generic explainer) */
  hint: { type: String, default: '' },
})

defineEmits(['update:open'])

const ws = useWsStore()

const envelopePath = ref(props.defaultEnvelopePath)
const landmarkPath = ref(props.defaultLandmarkPath)
const verifying = ref(false)
const result = ref(null)
const error = ref('')

const hintMessage = computed(() =>
  props.hint ||
  `通过 cc serve 运行 cc mtc verify（多算法 dispatcher 同时支持 Ed25519 和 SLH-DSA-128F）。文件路径应指向本机磁盘上的 envelope 和 landmark JSON — 浏览器只把路径转给 cc serve，不上传文件内容。`
)

watch(
  () => props.open,
  (v) => {
    if (v) {
      envelopePath.value = props.defaultEnvelopePath || envelopePath.value
      landmarkPath.value = props.defaultLandmarkPath || landmarkPath.value
      result.value = null
      error.value = ''
    }
  }
)

async function runVerify() {
  verifying.value = true
  result.value = null
  error.value = ''
  try {
    const env = envelopePath.value.trim().replace(/"/g, '\\"')
    const lm = landmarkPath.value.trim().replace(/"/g, '\\"')
    const { output } = await ws.execute(`mtc verify "${env}" --landmark "${lm}" --json`, 12000)
    const parsed = parseVerifyResult(output)
    if (!parsed.raw) {
      error.value = '验证命令未返回 JSON。请检查路径是否正确。'
      return
    }
    result.value = parsed
  } catch (e) {
    error.value = `验证失败: ${e?.message || e}`
  } finally {
    verifying.value = false
  }
}
</script>

<style scoped>
.mono {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}
.result-card.pass {
  border-color: #b7eb8f;
}
.result-card.fail {
  border-color: #ffccc7;
}
.raw-pre {
  margin: 0;
  padding: 8px 12px;
  background: var(--bg-hover);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  max-height: 320px;
  overflow: auto;
}
</style>
