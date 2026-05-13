<template>
  <a-tooltip :title="tooltip">
    <a-badge
      :count="totalCount"
      :show-zero="false"
      :overflow-count="9"
      :offset="[-2, 4]"
    >
      <button
        type="button"
        class="mbh-btn"
        :class="{ 'mbh-btn--active': totalCount > 0 }"
        @click="onClick"
      >
        <MobileOutlined :style="{ color: iconColor, fontSize: '14px' }" />
        <span v-if="totalCount > 0" class="mbh-count">{{ totalCount }}</span>
      </button>
    </a-badge>
  </a-tooltip>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { MobileOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

// Inline mini-parser — CLI prefixes `[AppConfig] Configuration loaded` /
// `[DatabaseManager]` log lines before/after JSON payload. 必须区分 log 前缀
// 与真 JSON：`[` 后跟字母是 log（[AppConfig]），后跟空白/引号/数字/嵌套/负号
// 才是 JSON array start。MobileBridge.vue 原版同款 regex。
function parseJsonOutput(raw) {
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    // fall through
  }
  const lines = String(raw).split('\n')
  // 跳过 CLI log 前缀 [AppConfig] / [DatabaseManager] 等 — bracket 后跟字母即 log
  const start = lines.findIndex((l) => {
    const t = l.trim()
    if (!t) return false
    const first = t[0]
    if (first !== '[' && first !== '{') return false
    if (t.length === 1) return true
    const second = t[1]
    // 字母 = CLI log 前缀，跳过；其余视作 JSON 开头
    return !((second >= 'A' && second <= 'Z') || (second >= 'a' && second <= 'z'))
  })
  if (start < 0) return []
  // 尾部反向找闭合 `]` / `}`，跳过 `[DatabaseManager]` 等以字母接 `]` 的 log 行
  for (let end = lines.length - 1; end >= start; end--) {
    const t = lines[end].trim()
    if (/^[\]\}]/.test(t) && !/^[\]\}][A-Za-z]/.test(t)) {
      try {
        return JSON.parse(lines.slice(start, end + 1).join('\n'))
      } catch {
        return []
      }
    }
  }
  return []
}

const router = useRouter()
const ws = useWsStore()

const devices = ref([])
let pollTimer = null

const totalCount = computed(() => devices.value.length)
const onlineCount = computed(
  () => devices.value.filter((d) => isOnline(d)).length,
)

const iconColor = computed(() => {
  if (totalCount.value === 0) return 'var(--text-muted, #999)'
  return '#52c41a'
})

const tooltip = computed(() => {
  if (totalCount.value === 0) return '尚未配对任何手机 — 点击进入配对'
  return `已配对 ${totalCount.value} 台手机 — 点击进入管理`
})

function isOnline(d) {
  // 当前没有可靠的"在线"判断（live WS 连接得 query mobileBridge）；header 只展示
  // 已配对数。badge 用 totalCount 即可。
  if (!d) return false
  if (typeof d.online === 'boolean') return d.online
  const s = (d.status || '').toLowerCase()
  return s === 'online' || s === 'connected' || s === 'active' || s === 'paired'
}

async function refresh() {
  if (ws.status !== 'connected') return
  try {
    const { output } = await ws.execute(
      'p2p devices --type mobile --json',
      10000,
    )
    devices.value = parseJsonOutput(output) || []
  } catch {
    // Silent — keep last known list. The badge will simply not update.
  }
}

function onClick() {
  router.push('/mobile-bridge')
}

onMounted(() => {
  refresh()
  pollTimer = setInterval(refresh, 5000)
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<style scoped>
.mbh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.mbh-btn:hover {
  background: var(--bg-card-hover);
  border-color: #52c41a;
  transform: scale(1.04);
}
.mbh-btn--active {
  border-color: rgba(82, 196, 26, 0.6);
}
.mbh-count {
  line-height: 1;
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
