<template>
  <!--
    #21 B.1 PR2b — multisig 提案签名 Modal。
    设计：A.2 §2.4 高风险二次确认；§2.4.c payload hash 短码 (head 8 + tail 4)
         §2.1.a 高风险红 (danger 主按钮)
    架构：renderer 永远不持私钥。source='ukey' 走主进程 ukeyManager (默认推荐)；
         source='hex' 仅调试用 hidden by default。
  -->
  <a-modal
    :open="open"
    title="签名提案"
    :width="600"
    :mask-closable="false"
    :keyboard="false"
    destroy-on-close
    @update:open="onUpdateOpen"
  >
    <template v-if="proposal">
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="Domain">
          <a-tag color="purple">{{ detail.domain }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="Proposal ID">
          <code style="font-size: 12px;">{{ detail.id }}</code>
        </a-descriptions-item>
        <a-descriptions-item label="阈值">
          {{ detail.thresholdM }}-of-{{ detail.memberSet.length }}
        </a-descriptions-item>
        <a-descriptions-item label="已签 / 需签">
          {{ signedCount }} / {{ detail.thresholdM }}
        </a-descriptions-item>
        <a-descriptions-item label="Payload hash">
          <code
            v-if="!hashExpanded"
            class="hash-short"
            style="cursor: pointer; font-size: 12px;"
            @click="hashExpanded = true"
            :title="'点击展开完整 hash'"
          >{{ shortHash }}</code>
          <code
            v-else
            class="hash-full"
            style="cursor: pointer; font-size: 11px; word-break: break-all;"
            @click="hashExpanded = false"
          >{{ detail.payloadHash || '(unavailable)' }}</code>
        </a-descriptions-item>
        <a-descriptions-item label="Payload">
          <details>
            <summary style="cursor: pointer; color: var(--text-secondary);">
              展开 (JCS)
            </summary>
            <pre style="margin: 8px 0 0; max-height: 200px; overflow: auto; font-size: 11px;">{{ payloadJson }}</pre>
          </details>
        </a-descriptions-item>
      </a-descriptions>

      <a-divider />

      <!-- Signer DID 选择 -->
      <div style="margin-bottom: 16px;">
        <div style="margin-bottom: 8px; font-weight: 500;">签名身份 (DID)</div>
        <a-select
          v-model:value="signerDid"
          style="width: 100%;"
          placeholder="选择签名成员"
          :disabled="signing"
        >
          <a-select-option
            v-for="m in pendingMembers"
            :key="m.did"
            :value="m.did"
          >
            <code style="font-size: 12px;">{{ shortDid(m.did) }}</code>
            <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">
              ({{ m.alg }})
            </span>
          </a-select-option>
        </a-select>
        <a-typography-text
          v-if="pendingMembers.length === 0"
          type="warning"
          style="font-size: 12px;"
        >
          所有成员均已签名 (达阈值)
        </a-typography-text>
      </div>

      <!-- 密钥来源 -->
      <div style="margin-bottom: 16px;">
        <div style="margin-bottom: 8px; font-weight: 500;">密钥来源</div>
        <a-radio-group v-model:value="keySource" :disabled="signing">
          <a-radio value="ukey">
            <strong>U-Key 硬件</strong>
            <span style="color: var(--text-secondary); margin-left: 8px; font-size: 12px;">
              推荐 (PIN 确认 via 主进程)
            </span>
          </a-radio>
          <br>
          <a-radio value="hex" style="margin-top: 6px;">
            <strong>软件 hex</strong>
            <span style="color: var(--text-secondary); margin-left: 8px; font-size: 12px;">
              调试用 — 私钥不应在 UI 输入
            </span>
          </a-radio>
        </a-radio-group>
        <a-input-password
          v-if="keySource === 'hex'"
          v-model:value="hexInput"
          placeholder="hex (32 bytes = 64 chars Ed25519)"
          style="margin-top: 8px;"
          :disabled="signing"
        />
      </div>

      <!-- 警示 -->
      <a-alert
        message="高风险操作"
        :description="riskDescription"
        type="warning"
        show-icon
        style="margin-bottom: 8px;"
      />
    </template>

    <template #footer>
      <a-space>
        <a-button :disabled="signing" @click="onCancel">取消</a-button>
        <a-button
          type="primary"
          danger
          :loading="signing"
          :disabled="!canSign"
          @click="onConfirmSign"
        >立即签名</a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from '../composables/useShellMode.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  // proposal: full detail from multisig.show — { proposal: {...}, signatures: [...] }
  proposal: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'signed'])

const ws = useWsStore()
const { isEmbedded } = useShellMode()

const signing = ref(false)
const signerDid = ref(null)
const keySource = ref('ukey')
const hexInput = ref('')
const hashExpanded = ref(false)

// Mirror callMultisigTopic from Multisig.vue
async function callMultisigTopic(topic, msg, fallbackCmd, timeoutMs = 15000) {
  if (isEmbedded) {
    const reply = await ws.sendRaw({ type: topic, ...msg }, timeoutMs)
    if (!reply?.ok) {
      const err = reply?.error
      throw new Error(typeof err === 'string' ? err : err?.message || `${topic} failed`)
    }
    return reply.result
  }
  return ws.executeJson(fallbackCmd, timeoutMs)
}

const detail = computed(() => props.proposal?.proposal ?? {})
const signedSet = computed(() => new Set((props.proposal?.signatures ?? []).map((s) => s.signerDid)))
const signedCount = computed(() => signedSet.value.size)
const pendingMembers = computed(() =>
  (detail.value?.memberSet ?? []).filter((m) => !signedSet.value.has(m.did)),
)

// Per A.2 §2.4.c — head 8 + tail 4 (13 chars including '…')
const shortHash = computed(() => {
  const h = detail.value?.payloadHash
  if (!h || typeof h !== 'string') return '(unavailable)'
  if (h.length <= 12) return h
  return `${h.slice(0, 8)}…${h.slice(-4)}`
})

const payloadJson = computed(() => {
  const p = detail.value?.payload
  try {
    return p ? JSON.stringify(p, null, 2) : detail.value?.payloadJcs || '(empty)'
  } catch {
    return String(p)
  }
})

const canSign = computed(() => {
  if (signing.value) return false
  if (!signerDid.value) return false
  if (keySource.value === 'hex') {
    return /^[0-9a-fA-F]{2,}$/.test(hexInput.value.trim())
  }
  if (keySource.value === 'ukey') {
    // ukey is wired in main process — renderer can always attempt; failure
    // surfaces as 'UKEY_NOT_WIRED' / 'sign_callback_failed' soft-error.
    return true
  }
  return false
})

const riskDescription = computed(() => {
  if (keySource.value === 'ukey') {
    return '签名将通过主进程调用 U-Key 硬件 (Windows) / simulation 驱动 (macOS/Linux)。'
      + ' 请确认 payload hash 与发起方提供的一致。私钥不出硬件边界。'
  }
  return '调试模式：私钥 hex 仅供 CLI / dev 测试。生产环境请使用 U-Key 硬件源。'
})

function shortDid(did) {
  if (!did) return ''
  // A.2 §2.2 Standard: head(20) + '…' + tail(8)
  if (did.length <= 28) return did
  return `${did.slice(0, 20)}…${did.slice(-8)}`
}

function reset() {
  signerDid.value = null
  keySource.value = 'ukey'
  hexInput.value = ''
  hashExpanded.value = false
  signing.value = false
}

watch(
  () => props.open,
  (v) => {
    if (v) reset()
  },
)

// Auto-pick the first pending member when modal opens.
watch(pendingMembers, (members) => {
  if (members.length > 0 && !signerDid.value) {
    signerDid.value = members[0].did
  }
})

function onUpdateOpen(v) {
  if (signing.value) return // disallow close while signing
  emit('update:open', v)
}

function onCancel() {
  if (signing.value) return
  emit('update:open', false)
}

async function onConfirmSign() {
  if (!canSign.value) return
  const params = keySource.value === 'hex'
    ? { secretKeyHex: hexInput.value.trim() }
    : {}
  const member = detail.value.memberSet.find((m) => m.did === signerDid.value)
  signing.value = true
  try {
    const r = await callMultisigTopic(
      'multisig.sign',
      {
        proposalId: detail.value.id,
        signerDid: signerDid.value,
        alg: member?.alg ?? 'Ed25519',
        source: keySource.value,
        params,
      },
      // cc serve fallback — only meaningful for source='hex'
      keySource.value === 'hex'
        ? `multisig sign ${detail.value.id} --signer ${signerDid.value} --key ${params.secretKeyHex} --json`
        : `multisig sign ${detail.value.id} --signer ${signerDid.value} --json`,
      20000,
    )
    if (r.accepted) {
      message.success(
        r.reachedThreshold
          ? '✓ 签名已接受 — 达到阈值'
          : '✓ 签名已接受',
      )
      emit('signed', r)
      emit('update:open', false)
    } else {
      const reason = r.reason || 'unknown'
      const detail = r.detail ? ` (${r.detail})` : ''
      message.error(`签名失败: ${reason}${detail}`)
    }
  } catch (err) {
    message.error(err.message || String(err))
  } finally {
    signing.value = false
  }
}
</script>

<style scoped>
.hash-short,
.hash-full {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg-card, rgba(0, 0, 0, 0.04));
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
