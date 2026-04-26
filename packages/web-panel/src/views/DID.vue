<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">DID 身份管理</h2>
        <p class="page-sub">去中心化身份 / 密钥 / 签名验证</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadList">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          创建身份
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="身份数量"
            :value="identities.length"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><IdcardOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="默认身份"
            :value="defaultIdentityDisplay"
            :value-style="{ color: defaultIdentityDisplay !== '未设置' ? '#52c41a' : '#888', fontSize: '13px', fontFamily: 'monospace' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="DID 方法"
            :value="methodDisplay"
            :value-style="{ color: '#722ed1', fontSize: '14px' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="可签名"
            :value="identities.length > 0 ? '是' : '否'"
            :value-style="{ color: identities.length > 0 ? '#52c41a' : '#ff4d4f', fontSize: '20px' }"
          >
            <template #prefix><KeyOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <a-alert
      v-if="!hasDesktopFeatures"
      message="仅 Web 模式"
      description="助记词备份/恢复 与 DHT 网络发布 仅在桌面端可用，本页面禁用相关按钮。所有创建/签名/删除操作通过 CLI 转发执行。"
      type="info"
      show-icon
      closable
      style="margin-bottom: 16px;"
    />

    <div v-if="loading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
    <a-table
      v-else
      :columns="columns"
      :data-source="identities"
      :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
      size="small"
      style="background: var(--bg-card);"
      :row-class-name="() => 'did-row'"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'did'">
          <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">{{ record.did }}</span>
        </template>
        <template v-if="column.key === 'displayName'">
          <span style="color: var(--text-primary);">{{ record.displayName || '-' }}</span>
        </template>
        <template v-if="column.key === 'method'">
          <a-tag color="blue">{{ record.method }}</a-tag>
        </template>
        <template v-if="column.key === 'createdAt'">
          <span style="color: var(--text-secondary); font-size: 12px;">{{ record.createdAt || '-' }}</span>
        </template>
        <template v-if="column.key === 'isDefault'">
          <a-tag :color="record.isDefault ? 'green' : 'default'">
            {{ record.isDefault ? '默认' : '-' }}
          </a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-space size="small">
            <a-button size="small" type="link" @click="openShow(record)">
              详情
            </a-button>
            <a-button size="small" type="link" @click="openSign(record)">
              签名
            </a-button>
            <a-button
              v-if="!record.isDefault"
              size="small"
              type="link"
              :loading="settingDefault === record.did"
              @click="setDefault(record)"
            >
              设为默认
            </a-button>
            <a-popconfirm
              title="确定删除该 DID 身份吗？删除后私钥将无法找回。"
              ok-text="删除"
              ok-type="danger"
              cancel-text="取消"
              @confirm="deleteIdentity(record)"
            >
              <a-button size="small" type="link" danger :loading="deleting === record.did">
                删除
              </a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <a-empty description="暂无 DID 身份，点击「创建身份」添加" />
      </template>
    </a-table>

    <!-- Create Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建 DID 身份"
      :confirm-loading="creating"
      @ok="createIdentity"
      ok-text="创建"
      cancel-text="取消"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="显示名称">
          <a-input v-model:value="newIdentityName" placeholder="可选 — 用于识别身份" allow-clear />
        </a-form-item>
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-tooltip title="桌面应用专属：BIP39 助记词派生密钥">
            <a-button disabled style="margin-right: 8px;">
              <template #icon><FileProtectOutlined /></template>
              从助记词导入
            </a-button>
          </a-tooltip>
          <span style="color: var(--text-muted); font-size: 11px;">需桌面端</span>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Show Details Modal -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="`身份详情：${currentIdentity?.displayName || currentIdentity?.did?.slice(0, 24) || ''}`"
      :width="720"
      :footer="null"
    >
      <div v-if="currentIdentity" style="margin-top: 12px;">
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="DID">
            <span style="font-family: monospace; color: #ccc; word-break: break-all;">{{ currentIdentity.did }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="名称">{{ currentIdentity.displayName || '-' }}</a-descriptions-item>
          <a-descriptions-item label="方法"><a-tag color="blue">{{ currentIdentity.method }}</a-tag></a-descriptions-item>
          <a-descriptions-item label="默认">
            <a-tag :color="currentIdentity.isDefault ? 'green' : 'default'">
              {{ currentIdentity.isDefault ? '是' : '否' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ currentIdentity.createdAt || '-' }}</a-descriptions-item>
          <a-descriptions-item label="公钥（hex）">
            <span style="font-family: monospace; color: #888; font-size: 11px; word-break: break-all;">
              {{ currentIdentity.publicKey || '加载中...' }}
            </span>
          </a-descriptions-item>
        </a-descriptions>

        <div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
          <a-tooltip title="桌面应用专属：导出 BIP39 助记词以备份">
            <a-button disabled>
              <template #icon><FileProtectOutlined /></template>
              导出助记词
            </a-button>
          </a-tooltip>
          <a-tooltip title="桌面应用专属：发布到 P2P DHT 网络以供他人解析">
            <a-button disabled>
              <template #icon><CloudUploadOutlined /></template>
              发布到 DHT
            </a-button>
          </a-tooltip>
          <a-button :loading="loadingDocument" @click="loadDocument(currentIdentity)">
            <template #icon><FileTextOutlined /></template>
            查看 DID Document
          </a-button>
        </div>

        <div v-if="currentDocument" style="margin-top: 16px;">
          <p style="color: var(--text-secondary); margin-bottom: 6px;">DID Document (W3C):</p>
          <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); max-height: 320px; overflow: auto;">{{ currentDocument }}</pre>
        </div>
      </div>
    </a-modal>

    <!-- Sign Modal -->
    <a-modal
      v-model:open="showSignModal"
      :title="`签名消息：${signTargetDid?.slice(0, 28) || '默认身份'}...`"
      :confirm-loading="signing"
      @ok="signMessage"
      ok-text="签名"
      cancel-text="取消"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item label="消息" required>
          <a-textarea v-model:value="signText" placeholder="请输入要签名的消息" :auto-size="{ minRows: 3, maxRows: 8 }" />
        </a-form-item>
      </a-form>
      <div v-if="signResult" style="margin-top: 12px;">
        <p style="color: var(--text-secondary); margin-bottom: 6px;">签名结果（hex）:</p>
        <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">{{ signResult.signature }}</pre>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  IdcardOutlined,
  KeyOutlined,
  FileProtectOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { parseDidList, parseDidShow, parseSignResult } from '../utils/did-parser.js'

const ws = useWsStore()

const hasDesktopFeatures = ref(false)
const loading = ref(false)
const creating = ref(false)
const signing = ref(false)
const settingDefault = ref('')
const deleting = ref('')
const loadingDocument = ref(false)

const identities = ref([])

const showCreateModal = ref(false)
const showDetailsModal = ref(false)
const showSignModal = ref(false)
const newIdentityName = ref('')
const currentIdentity = ref(null)
const currentDocument = ref('')
const signTargetDid = ref('')
const signText = ref('')
const signResult = ref(null)

const columns = [
  { title: 'DID', key: 'did', dataIndex: 'did', ellipsis: true },
  { title: '名称', key: 'displayName', dataIndex: 'displayName', width: '160px' },
  { title: '方法', key: 'method', dataIndex: 'method', width: '110px' },
  { title: '创建时间', key: 'createdAt', dataIndex: 'createdAt', width: '180px' },
  { title: '默认', key: 'isDefault', width: '90px' },
  { title: '操作', key: 'action', width: '280px' },
]

const defaultIdentityDisplay = computed(() => {
  const def = identities.value.find(i => i.isDefault)
  if (!def) return '未设置'
  const did = def.did
  return did.length > 24 ? did.slice(0, 12) + '...' + did.slice(-8) : did
})

const methodDisplay = computed(() => {
  const methods = new Set(identities.value.map(i => i.method).filter(Boolean))
  if (methods.size === 0) return '无'
  if (methods.size === 1) return [...methods][0]
  return [...methods].join(', ')
})

async function loadList() {
  loading.value = true
  try {
    const { output } = await ws.execute('did list --json', 15000)
    identities.value = parseDidList(output)
  } catch (e) {
    message.error('加载 DID 列表失败: ' + e.message)
    identities.value = []
  } finally {
    loading.value = false
  }
}

async function createIdentity() {
  creating.value = true
  try {
    const name = newIdentityName.value.trim()
    const cmd = name
      ? `did create --name "${name.replace(/"/g, '\\"')}" --json`
      : 'did create --json'
    const { output } = await ws.execute(cmd, 20000)
    if (/error|失败/i.test(output) && !output.includes('"did"')) {
      message.error('创建失败: ' + output.slice(0, 120))
    } else {
      message.success('DID 身份已创建')
      showCreateModal.value = false
      newIdentityName.value = ''
      await loadList()
    }
  } catch (e) {
    message.error('创建失败: ' + e.message)
  } finally {
    creating.value = false
  }
}

async function setDefault(record) {
  settingDefault.value = record.did
  try {
    const { output, exitCode } = await ws.execute(`did set-default ${record.did}`, 15000)
    if (exitCode !== 0 || /error|not found|失败/i.test(output)) {
      message.error('设置失败: ' + output.slice(0, 120))
    } else {
      message.success('已设为默认身份')
      await loadList()
    }
  } catch (e) {
    message.error('设置失败: ' + e.message)
  } finally {
    settingDefault.value = ''
  }
}

async function deleteIdentity(record) {
  deleting.value = record.did
  try {
    const { output, exitCode } = await ws.execute(`did delete ${record.did} --force`, 15000)
    if (exitCode !== 0 || /error|not found|失败/i.test(output)) {
      message.error('删除失败: ' + output.slice(0, 120))
    } else {
      message.success('身份已删除')
      await loadList()
    }
  } catch (e) {
    message.error('删除失败: ' + e.message)
  } finally {
    deleting.value = ''
  }
}

async function openShow(record) {
  currentIdentity.value = { ...record }
  currentDocument.value = ''
  showDetailsModal.value = true
  if (!record.publicKey) {
    try {
      const { output } = await ws.execute(`did show ${record.did} --json`, 10000)
      const detail = parseDidShow(output)
      if (detail) {
        currentIdentity.value = { ...currentIdentity.value, ...detail }
      }
    } catch {
      /* keep summary fields visible even when show fails */
    }
  }
}

async function loadDocument(record) {
  loadingDocument.value = true
  try {
    const { output } = await ws.execute(`did resolve ${record.did}`, 10000)
    try {
      currentDocument.value = JSON.stringify(JSON.parse(output.trim()), null, 2)
    } catch {
      currentDocument.value = output.trim()
    }
  } catch (e) {
    message.error('加载 DID Document 失败: ' + e.message)
  } finally {
    loadingDocument.value = false
  }
}

function openSign(record) {
  signTargetDid.value = record.did
  signText.value = ''
  signResult.value = null
  showSignModal.value = true
}

async function signMessage() {
  if (!signText.value.trim()) {
    message.warning('请输入要签名的消息')
    return
  }
  signing.value = true
  signResult.value = null
  try {
    const escapedMsg = signText.value.replace(/"/g, '\\"')
    const cmd = `did sign "${escapedMsg}" --did ${signTargetDid.value} --json`
    const { output, exitCode } = await ws.execute(cmd, 15000)
    const parsed = parseSignResult(output)
    if (parsed && parsed.signature) {
      signResult.value = parsed
      message.success('签名成功')
    } else {
      message.error('签名失败: ' + (output || `exit ${exitCode}`).slice(0, 120))
    }
  } catch (e) {
    message.error('签名失败: ' + e.message)
  } finally {
    signing.value = false
  }
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
:deep(.did-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
