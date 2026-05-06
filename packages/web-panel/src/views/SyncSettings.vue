<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">同步设置</h2>
        <p class="page-sub">通过 web-shell sync.* WS topic 直连主进程同步引擎</p>
      </div>
      <a-button type="primary" ghost :loading="statusLoading" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- 多 provider / WebDAV 提示（保留：本页 push/pull 仍是 cc CLI 桥；
         WebDAV 已在下面单独段独立支持，由 web-shell 的 sync.webdav.* WS topic 直连主进程）-->
    <a-alert
      type="info"
      show-icon
      :message="'本页 status / push / pull 通过 web-shell sync.* WS topic 直连 main 进程；WebDAV 在下方独立段'"
      :description="'其它 provider（Git / P2P / S3 等）的细粒度配置仍在 V5/V6 桌面 shell。'"
      style="margin-bottom: 16px;"
    />

    <!-- WebDAV 同步段 (Phase 3c.4 — web-shell parity) -->
    <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
      <template #title>
        <a-space><CloudSyncOutlined /><span>WebDAV 网盘同步</span></a-space>
      </template>
      <template #extra>
        <a-tag v-if="webdav.configured" :color="webdavStatusColor">
          {{ webdavStatusLabel }}
        </a-tag>
        <a-tag v-else color="default">未配置</a-tag>
      </template>

      <a-form :model="webdav.form" layout="vertical" :disabled="webdav.busy">
        <a-form-item label="服务器 URL" required>
          <a-input v-model:value="webdav.form.url" placeholder="https://dav.jianguoyun.com/dav/" allow-clear />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12">
            <a-form-item label="用户名">
              <a-input v-model:value="webdav.form.username" placeholder="user@example.com" allow-clear />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item label="密码">
              <a-input-password
                v-model:value="webdav.form.password"
                :placeholder="webdav.configured ? (webdav.maskedPassword || '（已保存，留空保持不变）') : '请输入密码'"
                autocomplete="new-password"
              />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="远端路径">
          <a-input v-model:value="webdav.form.remotePath" placeholder="/chainlesschain" allow-clear />
        </a-form-item>
        <a-space wrap>
          <a-button type="primary" :loading="webdav.saving" @click="webdavSave">保存</a-button>
          <a-button :loading="webdav.testing" @click="webdavTest">测试连接</a-button>
          <a-button
            type="primary"
            :loading="webdav.running"
            :disabled="!webdav.configured"
            @click="webdavRun"
          >
            <template #icon><CloudUploadOutlined /></template>
            立即同步
          </a-button>
          <a-popconfirm
            v-if="webdav.configured"
            title="确定要清除 WebDAV 凭证吗？已推送到远端的文件不会被删除。"
            ok-text="清除"
            cancel-text="取消"
            @confirm="webdavClear"
          >
            <a-button danger>断开连接</a-button>
          </a-popconfirm>
        </a-space>
      </a-form>

      <div v-if="webdav.status" style="margin-top: 16px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="上次同步">
            <span v-if="webdav.status.lastSyncAt">{{ formatTime(webdav.status.lastSyncAt) }}</span>
            <span v-else style="color: var(--text-secondary);">未同步过</span>
          </a-descriptions-item>
          <a-descriptions-item label="耗时">
            <span v-if="webdav.status.lastRunDurationMs != null">{{ webdav.status.lastRunDurationMs }} ms</span>
            <span v-else style="color: var(--text-secondary);">—</span>
          </a-descriptions-item>
          <a-descriptions-item label="累积推送" :span="2">
            已推送 <b>{{ webdav.status.itemsPushed }}</b>
            · 已跳过 <b>{{ webdav.status.itemsSkipped }}</b>
            · 已删除 <b>{{ webdav.status.itemsDeleted }}</b>
          </a-descriptions-item>
          <a-descriptions-item v-if="webdav.status.lastRunError" label="错误" :span="2">
            <span style="color: #ff4d4f; word-break: break-all;">{{ webdav.status.lastRunError }}</span>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-card>

    <!-- 状态卡片 -->
    <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
      <template #title>
        <a-space><CloudSyncOutlined /><span>同步状态</span></a-space>
      </template>
      <template #extra>
        <a-tag :color="conflicts > 0 ? 'red' : (synced > 0 ? 'green' : 'default')">
          {{ conflicts > 0 ? `${conflicts} 个冲突` : (totalResources === 0 ? '无资源' : '正常') }}
        </a-tag>
      </template>

      <div v-if="statusLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <a-row v-else :gutter="[16, 16]">
        <a-col :xs="12" :sm="6">
          <a-statistic title="资源总数" :value="totalResources" :value-style="{ fontSize: '20px' }" />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic title="待同步" :value="pending" :value-style="{ color: pending > 0 ? '#faad14' : '#888', fontSize: '20px' }" />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic title="已同步" :value="synced" :value-style="{ color: synced > 0 ? '#52c41a' : '#888', fontSize: '20px' }" />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic title="冲突" :value="conflicts" :value-style="{ color: conflicts > 0 ? '#ff4d4f' : '#888', fontSize: '20px' }" />
        </a-col>
      </a-row>
      <div v-if="statusError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ statusError }}</div>
    </a-card>

    <!-- 操作 -->
    <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
      <template #title>
        <a-space><CloudUploadOutlined /><span>同步操作</span></a-space>
      </template>
      <a-space>
        <a-button type="primary" :loading="pushLoading" @click="doPush">
          <template #icon><CloudUploadOutlined /></template>
          推送本地变更 (push)
        </a-button>
        <a-button :loading="pullLoading" @click="doPull">
          <template #icon><CloudDownloadOutlined /></template>
          拉取远程变更 (pull)
        </a-button>
      </a-space>

      <div v-if="lastActionResult" style="margin-top: 16px;">
        <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">
          最近一次操作 ({{ lastActionLabel }})
        </div>
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: var(--text-primary); font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;">{{ lastActionResult }}</pre>
      </div>
    </a-card>

    <!-- 冲突列表 -->
    <a-card v-if="conflicts > 0" style="background: var(--bg-card); border-color: var(--border-color);">
      <template #title>
        <a-space><WarningOutlined style="color: #ff4d4f;" /><span>待解决冲突</span></a-space>
      </template>

      <div v-if="conflictsLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <a-empty v-else-if="conflictList.length === 0" description="没有详细冲突数据" />
      <a-table
        v-else
        :columns="conflictColumns"
        :data-source="conflictList"
        :pagination="{ pageSize: 10 }"
        size="small"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-space>
              <a-button size="small" type="link" @click="resolveOne(record.id, 'local')">用本地版本</a-button>
              <a-button size="small" type="link" @click="resolveOne(record.id, 'remote')">用远程版本</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  ReloadOutlined,
  CloudSyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  WarningOutlined,
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

// 状态
const statusLoading = ref(false)
const statusError = ref('')
const totalResources = ref(0)
const pending = ref(0)
const synced = ref(0)
const conflicts = ref(0)

// 操作
const pushLoading = ref(false)
const pullLoading = ref(false)
const lastActionResult = ref('')
const lastActionLabel = ref('')

// 冲突列表
const conflictsLoading = ref(false)
const conflictList = ref([])
const conflictColumns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 220, ellipsis: true },
  { title: '资源 ID', dataIndex: 'resource_id', key: 'resource_id', ellipsis: true },
  { title: '类型', dataIndex: 'resource_type', key: 'resource_type', width: 120 },
  { title: '操作', key: 'action', width: 200 },
]

// 改用 web-shell 的 sync.* WS topic 而不是 ws.execute('sync …')：CLI 子进程
// 会撞 main 已开的 SQLite db (Windows + WAL 下 better-sqlite3 报"database disk
// image is malformed")。in-process WS handler 共用同一个 db handle，零冲突。
async function fetchStatus() {
  statusLoading.value = true
  statusError.value = ''
  try {
    const data = await ws.sendRaw({ type: 'sync.status' }, 15000)
    if (data?.success === false) throw new Error(data.error || '获取失败')
    totalResources.value = Number(data?.totalResources ?? 0)
    pending.value = Number(data?.pending ?? 0)
    synced.value = Number(data?.synced ?? 0)
    conflicts.value = Number(data?.conflicts ?? 0)
    if (conflicts.value > 0) {
      await fetchConflicts()
    } else {
      conflictList.value = []
    }
  } catch (err) {
    statusError.value = '获取状态失败：' + (err?.message || String(err))
  } finally {
    statusLoading.value = false
  }
}

async function fetchConflicts() {
  conflictsLoading.value = true
  try {
    const data = await ws.sendRaw({ type: 'sync.conflicts' }, 15000)
    const list = Array.isArray(data?.conflicts) ? data.conflicts : []
    conflictList.value = list
  } catch (err) {
    // 静默失败 — 状态卡片已经显示 conflicts 计数
    conflictList.value = []
  } finally {
    conflictsLoading.value = false
  }
}

async function doPush() {
  pushLoading.value = true
  lastActionLabel.value = 'sync.push'
  try {
    const result = await ws.sendRaw({ type: 'sync.push' }, 60000)
    lastActionResult.value = JSON.stringify(result, null, 2)
    if (result?.success) {
      message.success(`推送完成 (${result.pushed ?? 0} / ${result.total ?? 0})`)
      await fetchStatus()
    } else {
      message.error('推送失败：' + (result?.error || ''))
    }
  } catch (err) {
    lastActionResult.value = err?.message || String(err)
    message.error('推送失败：' + (err?.message || ''))
  } finally {
    pushLoading.value = false
  }
}

async function doPull() {
  pullLoading.value = true
  lastActionLabel.value = 'sync.pull'
  try {
    const result = await ws.sendRaw({ type: 'sync.pull' }, 60000)
    lastActionResult.value = JSON.stringify(result, null, 2)
    if (result?.success) {
      message.success(`拉取完成 (检查 ${result.checked ?? 0}, 更新 ${result.updated ?? 0})`)
      await fetchStatus()
    } else {
      message.error('拉取失败：' + (result?.error || ''))
    }
  } catch (err) {
    lastActionResult.value = err?.message || String(err)
    message.error('拉取失败：' + (err?.message || ''))
  } finally {
    pullLoading.value = false
  }
}

async function resolveOne(id, side) {
  try {
    const result = await ws.sendRaw(
      { type: 'sync.resolve', conflictId: id, side },
      30000,
    )
    if (result?.success) {
      message.success(`已用${side === 'local' ? '本地' : '远程'}版本解决`)
      await fetchStatus()
    } else {
      message.error('解决失败：' + (result?.error || ''))
    }
  } catch (err) {
    message.error('解决失败：' + (err?.message || ''))
  }
}

// ── WebDAV 同步段 (Phase 3c.4) ──────────────────────────────
const webdav = reactive({
  configured: false,
  maskedPassword: '',
  form: { url: '', username: '', password: '', remotePath: '/chainlesschain' },
  status: null,
  saving: false,
  testing: false,
  running: false,
  busy: computed(() => webdav.saving || webdav.testing || webdav.running),
})

const webdavStatusColor = computed(() => {
  const s = webdav.status?.lastRunStatus
  if (s === 'success') return 'green'
  if (s === 'conflict') return 'orange'
  if (s === 'failed') return 'red'
  return 'default'
})

const webdavStatusLabel = computed(() => {
  const s = webdav.status?.lastRunStatus
  if (!s) return webdav.configured ? '已配置' : '未配置'
  if (s === 'success') return '成功'
  if (s === 'conflict') return '有冲突跳过'
  if (s === 'failed') return '失败'
  return s
})

function formatTime(ms) {
  const d = new Date(ms)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}

async function webdavLoad() {
  try {
    const reply = await ws.sendRaw({ type: 'sync.webdav.config-get' }, 10000)
    if (!reply || reply.ok === false) {
      // topic 不存在（旧版桌面）→ 静默：UI 仍可见但保存/同步会拿到 ok:false
      return
    }
    const d = reply.result?.data || {}
    webdav.form.url = d.url || ''
    webdav.form.username = d.username || ''
    webdav.form.remotePath = d.remotePath || '/chainlesschain'
    webdav.form.password = ''
    webdav.maskedPassword = d.password || ''
    webdav.configured = !!d.configured
    webdav.status = d.status || null
  } catch (err) {
    // 老桌面或断连：保持默认空表单
    console.warn('[SyncSettings] webdav.config-get failed:', err?.message)
  }
}

async function webdavSave() {
  webdav.saving = true
  try {
    const reply = await ws.sendRaw({
      type: 'sync.webdav.config-set',
      payload: {
        url: webdav.form.url.trim(),
        username: webdav.form.username,
        password: webdav.form.password,
        remotePath: webdav.form.remotePath || '/',
      },
    }, 15000)
    const r = reply?.result
    if (reply?.ok && r?.success) {
      message.success('WebDAV 配置已保存')
      webdav.form.password = ''
      await webdavLoad()
    } else {
      message.error('保存失败：' + (r?.error || reply?.error || '未知错误'))
    }
  } catch (err) {
    message.error('保存失败：' + (err?.message || ''))
  } finally {
    webdav.saving = false
  }
}

async function webdavTest() {
  if (webdav.form.url && webdav.form.password && !webdav.configured) {
    await webdavSave()
  }
  webdav.testing = true
  try {
    const reply = await ws.sendRaw({ type: 'sync.webdav.test' }, 30000)
    const r = reply?.result
    if (reply?.ok && r?.success) {
      message.success('WebDAV 连接成功')
    } else {
      message.error('连接失败：' + (r?.error || reply?.error || '未知错误'))
    }
  } catch (err) {
    message.error('连接失败：' + (err?.message || ''))
  } finally {
    webdav.testing = false
  }
}

async function webdavRun() {
  webdav.running = true
  try {
    const reply = await ws.sendRaw({ type: 'sync.webdav.run' }, 300000)
    const r = reply?.result
    if (reply?.ok && r?.success) {
      const detail = `推送 ${r.pushed} / 跳过 ${r.skipped} / 删除 ${r.deleted}`
      if (r.status === 'conflict') {
        message.warning('同步完成（有跳过）：' + detail)
      } else {
        message.success('同步完成：' + detail)
      }
    } else {
      message.error('同步失败：' + (r?.error || reply?.error || '未知错误'))
    }
    await webdavLoad()
  } catch (err) {
    message.error('同步失败：' + (err?.message || ''))
  } finally {
    webdav.running = false
  }
}

async function webdavClear() {
  try {
    const reply = await ws.sendRaw({ type: 'sync.webdav.config-clear' }, 5000)
    const r = reply?.result
    if (reply?.ok && r?.success) {
      message.success('已清除 WebDAV 凭证')
      webdav.form.url = ''
      webdav.form.username = ''
      webdav.form.password = ''
      webdav.form.remotePath = '/chainlesschain'
      webdav.configured = false
      webdav.maskedPassword = ''
      webdav.status = null
    } else {
      message.error('清除失败：' + (r?.error || reply?.error || '未知错误'))
    }
  } catch (err) {
    message.error('清除失败：' + (err?.message || ''))
  }
}

async function refreshAll() {
  await Promise.all([fetchStatus(), webdavLoad()])
}

onMounted(refreshAll)
</script>

<style scoped>
.page-title {
  margin: 0;
  color: var(--text-primary);
}
.page-sub {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
