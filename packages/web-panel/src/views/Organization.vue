<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">组织管理</h2>
        <p class="page-sub">组织 / 成员 / 审批</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card" @change="onTabChange">
      <!-- Tab 1: Organization List -->
      <a-tab-pane key="orgs">
        <template #tab>
          <TeamOutlined />
          组织列表
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" @click="showCreateOrgModal = true">
            <template #icon><PlusOutlined /></template>
            创建组织
          </a-button>
        </a-space>

        <div v-if="orgLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="orgColumns"
          :data-source="orgList"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'org-row'"
          :custom-row="(record) => ({ onClick: () => showOrgDetail(record) })"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.id }}</span>
            </template>
            <template v-if="column.key === 'name'">
              <a style="color: #1677ff;">{{ record.name }}</a>
            </template>
            <template v-if="column.key === 'owner'">
              <span style="color: var(--text-secondary);">{{ record.owner }}</span>
            </template>
            <template v-if="column.key === 'description'">
              <span style="color: var(--text-muted); font-size: 12px;">{{ record.description }}</span>
            </template>
            <template v-if="column.key === 'memberCount'">
              <a-tag color="blue">{{ record.memberCount }}</a-tag>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无组织，点击「创建组织」添加" />
          </template>
        </a-table>

        <!-- Org Detail Modal -->
        <a-modal
          v-model:open="showDetailModal"
          :title="'组织详情: ' + detailOrg.name"
          :footer="null"
          width="640px"
        >
          <div v-if="detailLoading" style="text-align: center; padding: 40px;"><a-spin /></div>
          <div v-else>
            <a-descriptions :column="1" bordered size="small" style="margin-bottom: 16px;">
              <a-descriptions-item label="ID">
                <span style="font-family: monospace; color: #ccc;">{{ detailOrg.id }}</span>
              </a-descriptions-item>
              <a-descriptions-item label="名称">{{ detailOrg.name }}</a-descriptions-item>
              <a-descriptions-item label="所有者">{{ detailOrg.owner }}</a-descriptions-item>
              <a-descriptions-item label="描述">{{ detailOrg.description || '-' }}</a-descriptions-item>
              <a-descriptions-item label="成员数">{{ detailOrg.memberCount }}</a-descriptions-item>
              <a-descriptions-item v-if="detailOrg.createdAt" label="创建时间">{{ detailOrg.createdAt }}</a-descriptions-item>
            </a-descriptions>
            <pre v-if="detailRaw" style="white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); max-height: 300px; overflow-y: auto;">{{ detailRaw }}</pre>
          </div>
        </a-modal>

        <!-- Create Org Modal -->
        <a-modal
          v-model:open="showCreateOrgModal"
          title="创建组织"
          :confirm-loading="creatingOrg"
          @ok="createOrg"
          ok-text="创建"
          cancel-text="取消"
        >
          <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
            <a-form-item label="名称" required>
              <a-input v-model:value="newOrgName" placeholder="请输入组织名称" />
            </a-form-item>
            <a-form-item label="描述">
              <a-input v-model:value="newOrgDesc" placeholder="请输入组织描述（可选）" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: Member Management -->
      <a-tab-pane key="members">
        <template #tab>
          <UserAddOutlined />
          成员管理
        </template>

        <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
          <a-select
            v-model:value="selectedOrgId"
            placeholder="选择组织"
            style="width: 280px;"
            :options="orgSelectOptions"
            @change="onOrgSelected"
          />
          <a-button type="primary" :disabled="!selectedOrgId" @click="showInviteModal = true">
            <template #icon><UserAddOutlined /></template>
            邀请成员
          </a-button>
        </div>

        <div v-if="memberLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else-if="selectedOrgId"
          :columns="memberColumns"
          :data-source="memberList"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          style="background: var(--bg-card); margin-bottom: 24px;"
          :row-class-name="() => 'org-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'userId'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.userId }}</span>
            </template>
            <template v-if="column.key === 'name'">
              <span style="color: #e0e0e0;">{{ record.name }}</span>
            </template>
            <template v-if="column.key === 'role'">
              <a-tag :color="roleColor(record.role)">{{ record.role }}</a-tag>
            </template>
            <template v-if="column.key === 'joinedAt'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.joinedAt }}</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无成员" />
          </template>
        </a-table>
        <a-empty v-else description="请先选择一个组织" style="padding: 60px 0;" />

        <!-- Teams Section -->
        <template v-if="selectedOrgId">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <h3 style="color: var(--text-primary); margin: 0; font-size: 15px;">团队</h3>
            <a-button size="small" @click="showCreateTeamModal = true">
              <template #icon><PlusOutlined /></template>
              创建团队
            </a-button>
          </div>
          <div v-if="teamLoading" style="text-align: center; padding: 40px;"><a-spin /></div>
          <a-table
            v-else
            :columns="teamColumns"
            :data-source="teamList"
            :pagination="false"
            size="small"
            style="background: var(--bg-card);"
            :row-class-name="() => 'org-row'"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span style="color: #e0e0e0;">{{ record.name }}</span>
              </template>
              <template v-if="column.key === 'description'">
                <span style="color: var(--text-muted); font-size: 12px;">{{ record.description }}</span>
              </template>
              <template v-if="column.key === 'lead'">
                <span style="color: var(--text-secondary);">{{ record.lead }}</span>
              </template>
            </template>
            <template #emptyText>
              <a-empty description="暂无团队" />
            </template>
          </a-table>
        </template>

        <!-- Invite Modal -->
        <a-modal
          v-model:open="showInviteModal"
          title="邀请成员"
          :confirm-loading="inviting"
          @ok="inviteMember"
          ok-text="邀请"
          cancel-text="取消"
        >
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
            <a-form-item label="用户 ID" required>
              <a-input v-model:value="inviteUserId" placeholder="请输入用户 ID" />
            </a-form-item>
            <a-form-item label="名称">
              <a-input v-model:value="inviteName" placeholder="请输入用户名称" />
            </a-form-item>
            <a-form-item label="角色">
              <a-select v-model:value="inviteRole" :options="roleOptions" />
            </a-form-item>
          </a-form>
        </a-modal>

        <!-- Create Team Modal -->
        <a-modal
          v-model:open="showCreateTeamModal"
          title="创建团队"
          :confirm-loading="creatingTeam"
          @ok="createTeam"
          ok-text="创建"
          cancel-text="取消"
        >
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
            <a-form-item label="团队名称" required>
              <a-input v-model:value="newTeamName" placeholder="请输入团队名称" />
            </a-form-item>
            <a-form-item label="描述">
              <a-input v-model:value="newTeamDesc" placeholder="请输入团队描述（可选）" />
            </a-form-item>
            <a-form-item label="负责人">
              <a-input v-model:value="newTeamLead" placeholder="请输入负责人 ID（可选）" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 3: Approval Management -->
      <a-tab-pane key="approvals">
        <template #tab>
          <AuditOutlined />
          审批管理
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" @click="showSubmitApprovalModal = true">
            <template #icon><PlusOutlined /></template>
            提交审批
          </a-button>
        </a-space>

        <div v-if="approvalLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="approvalColumns"
          :data-source="approvalList"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'org-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.id }}</span>
            </template>
            <template v-if="column.key === 'title'">
              <span style="color: #e0e0e0;">{{ record.title }}</span>
            </template>
            <template v-if="column.key === 'type'">
              <a-tag color="blue">{{ record.type }}</a-tag>
            </template>
            <template v-if="column.key === 'requester'">
              <span style="color: var(--text-secondary);">{{ record.requester }}</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="approvalStatusColor(record.status)">{{ record.status }}</a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <a-space v-if="(record.status || '').toLowerCase() === 'pending'">
                <a-button type="primary" size="small" :loading="record._approving" @click.stop="approveItem(record)">
                  <template #icon><CheckOutlined /></template>
                  通过
                </a-button>
                <a-button danger size="small" :loading="record._rejecting" @click.stop="rejectItem(record)">
                  <template #icon><CloseOutlined /></template>
                  拒绝
                </a-button>
              </a-space>
              <span v-else style="color: var(--text-muted); font-size: 12px;">-</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无审批记录" />
          </template>
        </a-table>

        <!-- Submit Approval Modal -->
        <a-modal
          v-model:open="showSubmitApprovalModal"
          title="提交审批"
          :confirm-loading="submittingApproval"
          @ok="submitApproval"
          ok-text="提交"
          cancel-text="取消"
        >
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
            <a-form-item label="组织" required>
              <a-select
                v-model:value="approvalOrgId"
                placeholder="选择组织"
                :options="orgSelectOptions"
              />
            </a-form-item>
            <a-form-item label="标题" required>
              <a-input v-model:value="approvalTitle" placeholder="请输入审批标题" />
            </a-form-item>
            <a-form-item label="类型">
              <a-input v-model:value="approvalType" placeholder="请输入审批类型" />
            </a-form-item>
            <a-form-item label="描述">
              <a-textarea v-model:value="approvalDescription" placeholder="请输入审批描述（可选）" :rows="3" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  TeamOutlined,
  UserAddOutlined,
  AuditOutlined,
  ReloadOutlined,
  PlusOutlined,
  CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

// --- Shared ---
const activeTab = ref('orgs')
const refreshing = ref(false)

async function refreshCurrentTab() {
  refreshing.value = true
  try {
    if (activeTab.value === 'orgs') await loadOrgList()
    else if (activeTab.value === 'members') {
      await loadOrgList()
      if (selectedOrgId.value) {
        await loadMembers()
        await loadTeams()
      }
    } else if (activeTab.value === 'approvals') await loadApprovals()
  } finally {
    refreshing.value = false
  }
}

function onTabChange(key) {
  if (key === 'orgs' && orgList.value.length === 0) loadOrgList()
  if (key === 'members' && orgList.value.length === 0) loadOrgList()
  if (key === 'approvals' && approvalList.value.length === 0) loadApprovals()
}

function tryParseJson(output) {
  try {
    const trimmed = output.trim()
    // Handle cases where output has text before JSON
    const jsonStart = trimmed.indexOf('[')
    const jsonObjStart = trimmed.indexOf('{')
    const start = jsonStart >= 0 && (jsonObjStart < 0 || jsonStart < jsonObjStart) ? jsonStart : jsonObjStart
    if (start >= 0) {
      return JSON.parse(trimmed.slice(start))
    }
    return null
  } catch (_e) {
    return null
  }
}

// --- Tab 1: Organization List ---
const orgLoading = ref(false)
const orgList = ref([])
const showCreateOrgModal = ref(false)
const creatingOrg = ref(false)
const newOrgName = ref('')
const newOrgDesc = ref('')
const showDetailModal = ref(false)
const detailLoading = ref(false)
const detailOrg = ref({})
const detailRaw = ref('')

const orgColumns = [
  { title: 'ID', key: 'id', dataIndex: 'id', width: '100px' },
  { title: '名称', key: 'name', dataIndex: 'name', width: '180px' },
  { title: '所有者', key: 'owner', dataIndex: 'owner', width: '140px' },
  { title: '描述', key: 'description', dataIndex: 'description', ellipsis: true },
  { title: '成员数', key: 'memberCount', dataIndex: 'memberCount', width: '90px' },
]

const orgSelectOptions = computed(() =>
  orgList.value.map((o) => ({ label: o.name, value: o.id }))
)

async function loadOrgList() {
  orgLoading.value = true
  try {
    const { output } = await ws.execute('org list --json', 15000)
    const parsed = tryParseJson(output)
    if (Array.isArray(parsed)) {
      orgList.value = parsed.map((o, i) => ({
        key: o.id || i,
        id: o.id || '-',
        name: o.name || '-',
        owner: o.owner || '-',
        description: o.description || '',
        memberCount: o.memberCount ?? o.members ?? 0,
      }))
    } else {
      orgList.value = parseOrgListText(output)
    }
  } catch (e) {
    message.error('加载组织列表失败: ' + e.message)
  } finally {
    orgLoading.value = false
  }
}

function parseOrgListText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ org/i)) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 3) {
      result.push({
        key: result.length,
        id: parts[0] || '-',
        name: parts[1] || '-',
        owner: parts[2] || '-',
        description: parts[3] || '',
        memberCount: parseInt(parts[4], 10) || 0,
      })
    }
  }
  return result
}

async function createOrg() {
  if (!newOrgName.value.trim()) { message.warning('请输入组织名称'); return }
  creatingOrg.value = true
  try {
    const name = newOrgName.value.trim().replace(/"/g, '\\"')
    const desc = newOrgDesc.value.trim().replace(/"/g, '\\"')
    let cmd = `org create "${name}" --json`
    if (desc) cmd = `org create "${name}" --description "${desc}" --json`
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('创建失败: ' + output.slice(0, 120))
    } else {
      message.success('组织已创建')
      showCreateOrgModal.value = false
      newOrgName.value = ''
      newOrgDesc.value = ''
      await loadOrgList()
    }
  } catch (e) {
    message.error('创建失败: ' + e.message)
  } finally {
    creatingOrg.value = false
  }
}

async function showOrgDetail(record) {
  detailOrg.value = { ...record }
  detailRaw.value = ''
  showDetailModal.value = true
  detailLoading.value = true
  try {
    const { output } = await ws.execute(`org show ${record.id} --json`, 15000)
    const parsed = tryParseJson(output)
    if (parsed && typeof parsed === 'object') {
      detailOrg.value = {
        id: parsed.id || record.id,
        name: parsed.name || record.name,
        owner: parsed.owner || record.owner,
        description: parsed.description || record.description,
        memberCount: parsed.memberCount ?? parsed.members ?? record.memberCount,
        createdAt: parsed.createdAt || parsed.created || '',
      }
      detailRaw.value = JSON.stringify(parsed, null, 2)
    } else {
      detailRaw.value = output
    }
  } catch (e) {
    detailRaw.value = '加载详情失败: ' + e.message
  } finally {
    detailLoading.value = false
  }
}

// --- Tab 2: Member Management ---
const selectedOrgId = ref(null)
const memberLoading = ref(false)
const memberList = ref([])
const teamLoading = ref(false)
const teamList = ref([])
const showInviteModal = ref(false)
const inviting = ref(false)
const inviteUserId = ref('')
const inviteName = ref('')
const inviteRole = ref('member')
const showCreateTeamModal = ref(false)
const creatingTeam = ref(false)
const newTeamName = ref('')
const newTeamDesc = ref('')
const newTeamLead = ref('')

const roleOptions = [
  { label: '管理员 (admin)', value: 'admin' },
  { label: '成员 (member)', value: 'member' },
  { label: '查看者 (viewer)', value: 'viewer' },
]

const memberColumns = [
  { title: '用户 ID', key: 'userId', dataIndex: 'userId', width: '160px' },
  { title: '名称', key: 'name', dataIndex: 'name', width: '140px' },
  { title: '角色', key: 'role', dataIndex: 'role', width: '100px' },
  { title: '加入时间', key: 'joinedAt', dataIndex: 'joinedAt', width: '180px' },
]

const teamColumns = [
  { title: '团队名称', key: 'name', dataIndex: 'name', width: '180px' },
  { title: '描述', key: 'description', dataIndex: 'description', ellipsis: true },
  { title: '负责人', key: 'lead', dataIndex: 'lead', width: '140px' },
]

function roleColor(role) {
  const map = { admin: 'gold', member: 'blue', viewer: 'default', owner: 'purple' }
  return map[(role || '').toLowerCase()] || 'default'
}

async function onOrgSelected() {
  if (selectedOrgId.value) {
    await Promise.all([loadMembers(), loadTeams()])
  }
}

async function loadMembers() {
  if (!selectedOrgId.value) return
  memberLoading.value = true
  try {
    const { output } = await ws.execute(`org members ${selectedOrgId.value} --json`, 15000)
    const parsed = tryParseJson(output)
    if (Array.isArray(parsed)) {
      memberList.value = parsed.map((m, i) => ({
        key: m.userId || m.id || i,
        userId: m.userId || m.id || '-',
        name: m.name || m.displayName || '-',
        role: m.role || 'member',
        joinedAt: m.joinedAt || m.joined || '-',
      }))
    } else {
      memberList.value = parseMemberListText(output)
    }
  } catch (e) {
    message.error('加载成员失败: ' + e.message)
  } finally {
    memberLoading.value = false
  }
}

function parseMemberListText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ member/i)) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 3) {
      result.push({
        key: result.length,
        userId: parts[0] || '-',
        name: parts[1] || '-',
        role: parts[2] || 'member',
        joinedAt: parts[3] || '-',
      })
    }
  }
  return result
}

async function loadTeams() {
  if (!selectedOrgId.value) return
  teamLoading.value = true
  try {
    const { output } = await ws.execute(`org teams ${selectedOrgId.value} --json`, 15000)
    const parsed = tryParseJson(output)
    if (Array.isArray(parsed)) {
      teamList.value = parsed.map((t, i) => ({
        key: t.id || t.name || i,
        name: t.name || '-',
        description: t.description || '',
        lead: t.lead || t.leader || '-',
      }))
    } else {
      teamList.value = []
    }
  } catch (e) {
    message.error('加载团队失败: ' + e.message)
  } finally {
    teamLoading.value = false
  }
}

async function inviteMember() {
  if (!inviteUserId.value.trim()) { message.warning('请输入用户 ID'); return }
  inviting.value = true
  try {
    const userId = inviteUserId.value.trim().replace(/"/g, '\\"')
    const name = inviteName.value.trim().replace(/"/g, '\\"')
    let cmd = `org invite ${selectedOrgId.value} ${userId} --role ${inviteRole.value}`
    if (name) cmd += ` --name "${name}"`
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('邀请失败: ' + output.slice(0, 120))
    } else {
      message.success('邀请已发送')
      showInviteModal.value = false
      inviteUserId.value = ''
      inviteName.value = ''
      inviteRole.value = 'member'
      await loadMembers()
    }
  } catch (e) {
    message.error('邀请失败: ' + e.message)
  } finally {
    inviting.value = false
  }
}

async function createTeam() {
  if (!newTeamName.value.trim()) { message.warning('请输入团队名称'); return }
  creatingTeam.value = true
  try {
    const name = newTeamName.value.trim().replace(/"/g, '\\"')
    const desc = newTeamDesc.value.trim().replace(/"/g, '\\"')
    const lead = newTeamLead.value.trim().replace(/"/g, '\\"')
    let cmd = `org teams ${selectedOrgId.value} create "${name}"`
    if (desc) cmd += ` --description "${desc}"`
    if (lead) cmd += ` --lead "${lead}"`
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('创建失败: ' + output.slice(0, 120))
    } else {
      message.success('团队已创建')
      showCreateTeamModal.value = false
      newTeamName.value = ''
      newTeamDesc.value = ''
      newTeamLead.value = ''
      await loadTeams()
    }
  } catch (e) {
    message.error('创建失败: ' + e.message)
  } finally {
    creatingTeam.value = false
  }
}

// --- Tab 3: Approval Management ---
const approvalLoading = ref(false)
const approvalList = ref([])
const showSubmitApprovalModal = ref(false)
const submittingApproval = ref(false)
const approvalOrgId = ref(null)
const approvalTitle = ref('')
const approvalType = ref('')
const approvalDescription = ref('')

const approvalColumns = [
  { title: 'ID', key: 'id', dataIndex: 'id', width: '100px' },
  { title: '标题', key: 'title', dataIndex: 'title', width: '200px' },
  { title: '类型', key: 'type', dataIndex: 'type', width: '120px' },
  { title: '申请人', key: 'requester', dataIndex: 'requester', width: '140px' },
  { title: '状态', key: 'status', dataIndex: 'status', width: '100px' },
  { title: '操作', key: 'actions', width: '180px' },
]

function approvalStatusColor(status) {
  const map = { pending: 'orange', approved: 'green', rejected: 'red' }
  return map[(status || '').toLowerCase()] || 'default'
}

async function loadApprovals() {
  approvalLoading.value = true
  try {
    const { output } = await ws.execute('org approvals --json', 15000)
    const parsed = tryParseJson(output)
    if (Array.isArray(parsed)) {
      approvalList.value = parsed.map((a, i) => ({
        key: a.id || i,
        id: a.id || '-',
        title: a.title || '-',
        type: a.type || '-',
        requester: a.requester || a.requestedBy || '-',
        status: a.status || 'pending',
        _approving: false,
        _rejecting: false,
      }))
    } else {
      approvalList.value = parseApprovalListText(output)
    }
  } catch (e) {
    message.error('加载审批列表失败: ' + e.message)
  } finally {
    approvalLoading.value = false
  }
}

function parseApprovalListText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ approval/i)) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 4) {
      result.push({
        key: result.length,
        id: parts[0] || '-',
        title: parts[1] || '-',
        type: parts[2] || '-',
        requester: parts[3] || '-',
        status: parts[4] || 'pending',
        _approving: false,
        _rejecting: false,
      })
    }
  }
  return result
}

async function approveItem(record) {
  record._approving = true
  try {
    const { output } = await ws.execute(`org approve ${record.id}`, 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('审批失败: ' + output.slice(0, 120))
    } else {
      message.success('已通过')
      await loadApprovals()
    }
  } catch (e) {
    message.error('审批失败: ' + e.message)
  } finally {
    record._approving = false
  }
}

async function rejectItem(record) {
  record._rejecting = true
  try {
    const { output } = await ws.execute(`org reject ${record.id}`, 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('拒绝失败: ' + output.slice(0, 120))
    } else {
      message.success('已拒绝')
      await loadApprovals()
    }
  } catch (e) {
    message.error('拒绝失败: ' + e.message)
  } finally {
    record._rejecting = false
  }
}

async function submitApproval() {
  if (!approvalOrgId.value) { message.warning('请选择组织'); return }
  if (!approvalTitle.value.trim()) { message.warning('请输入审批标题'); return }
  submittingApproval.value = true
  try {
    const title = approvalTitle.value.trim().replace(/"/g, '\\"')
    const type = approvalType.value.trim().replace(/"/g, '\\"')
    const desc = approvalDescription.value.trim().replace(/"/g, '\\"')
    let cmd = `org approve --submit --org ${approvalOrgId.value} --title "${title}"`
    if (type) cmd += ` --type "${type}"`
    if (desc) cmd += ` --description "${desc}"`
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error('提交失败: ' + output.slice(0, 120))
    } else {
      message.success('审批已提交')
      showSubmitApprovalModal.value = false
      approvalOrgId.value = null
      approvalTitle.value = ''
      approvalType.value = ''
      approvalDescription.value = ''
      await loadApprovals()
    }
  } catch (e) {
    message.error('提交失败: ' + e.message)
  } finally {
    submittingApproval.value = false
  }
}

onMounted(() => {
  loadOrgList()
})
</script>

<style scoped>
:deep(.org-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-tabs-tab) { color: var(--text-secondary) !important; }
:deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #1677ff !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
