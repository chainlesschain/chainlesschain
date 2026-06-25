<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('organization.title') }}</h2>
        <p class="page-sub">{{ t('organization.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        {{ t('organization.refresh') }}
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card" @change="onTabChange">
      <!-- Tab 1: Organization List -->
      <a-tab-pane key="orgs">
        <template #tab>
          <TeamOutlined />
          {{ t('organization.tabs.orgs') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" @click="showCreateOrgModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('organization.orgs.createButton') }}
          </a-button>
        </a-space>

        <div v-if="orgLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="orgColumns"
          :data-source="orgList"
          :pagination="{ pageSize: 20, showTotal: (count) => t('organization.totals.rows', { count }) }"
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
            <a-empty :description="t('organization.orgs.emptyText')" />
          </template>
        </a-table>

        <!-- Org Detail Modal -->
        <a-modal
          v-model:open="showDetailModal"
          :title="t('organization.orgs.detailTitle', { name: detailOrg.name || '' })"
          :footer="null"
          width="640px"
        >
          <div v-if="detailLoading" style="text-align: center; padding: 40px;"><a-spin /></div>
          <div v-else>
            <a-descriptions :column="1" bordered size="small" style="margin-bottom: 16px;">
              <a-descriptions-item :label="t('organization.orgs.detailLabels.id')">
                <span style="font-family: monospace; color: #ccc;">{{ detailOrg.id }}</span>
              </a-descriptions-item>
              <a-descriptions-item :label="t('organization.orgs.detailLabels.name')">{{ detailOrg.name }}</a-descriptions-item>
              <a-descriptions-item :label="t('organization.orgs.detailLabels.owner')">{{ detailOrg.owner }}</a-descriptions-item>
              <a-descriptions-item :label="t('organization.orgs.detailLabels.description')">{{ detailOrg.description || '-' }}</a-descriptions-item>
              <a-descriptions-item :label="t('organization.orgs.detailLabels.memberCount')">{{ detailOrg.memberCount }}</a-descriptions-item>
              <a-descriptions-item v-if="detailOrg.createdAt" :label="t('organization.orgs.detailLabels.createdAt')">{{ detailOrg.createdAt }}</a-descriptions-item>
            </a-descriptions>
            <pre v-if="detailRaw" style="white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); max-height: 300px; overflow-y: auto;">{{ detailRaw }}</pre>
          </div>
        </a-modal>

        <!-- Create Org Modal -->
        <a-modal
          v-model:open="showCreateOrgModal"
          :title="t('organization.orgs.createTitle')"
          :confirm-loading="creatingOrg"
          @ok="createOrg"
          :ok-text="t('organization.orgs.createOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
            <a-form-item :label="t('organization.orgs.nameLabel')" required>
              <a-input v-model:value="newOrgName" :placeholder="t('organization.orgs.namePlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.orgs.descriptionLabel')">
              <a-input v-model:value="newOrgDesc" :placeholder="t('organization.orgs.descriptionPlaceholder')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: Member Management -->
      <a-tab-pane key="members">
        <template #tab>
          <UserAddOutlined />
          {{ t('organization.tabs.members') }}
        </template>

        <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
          <a-select
            v-model:value="selectedOrgId"
            :placeholder="t('organization.members.selectPlaceholder')"
            style="width: 280px;"
            :options="orgSelectOptions"
            @change="onOrgSelected"
          />
          <a-button type="primary" :disabled="!selectedOrgId" @click="showInviteModal = true">
            <template #icon><UserAddOutlined /></template>
            {{ t('organization.members.inviteButton') }}
          </a-button>
        </div>

        <div v-if="memberLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else-if="selectedOrgId"
          :columns="memberColumns"
          :data-source="memberList"
          :pagination="{ pageSize: 20, showTotal: (count) => t('organization.totals.rows', { count }) }"
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
            <a-empty :description="t('organization.members.emptyMembers')" />
          </template>
        </a-table>
        <a-empty v-else :description="t('organization.members.selectFirst')" style="padding: 60px 0;" />

        <!-- Teams Section -->
        <template v-if="selectedOrgId">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <h3 style="color: var(--text-primary); margin: 0; font-size: 15px;">{{ t('organization.members.teamsTitle') }}</h3>
            <a-button size="small" @click="showCreateTeamModal = true">
              <template #icon><PlusOutlined /></template>
              {{ t('organization.members.createTeamButton') }}
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
              <a-empty :description="t('organization.members.emptyTeams')" />
            </template>
          </a-table>
        </template>

        <!-- Invite Modal -->
        <a-modal
          v-model:open="showInviteModal"
          :title="t('organization.members.inviteTitle')"
          :confirm-loading="inviting"
          @ok="inviteMember"
          :ok-text="t('organization.members.inviteOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
            <a-form-item :label="t('organization.members.userIdLabel')" required>
              <a-input v-model:value="inviteUserId" :placeholder="t('organization.members.userIdPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.members.nameLabel')">
              <a-input v-model:value="inviteName" :placeholder="t('organization.members.namePlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.members.roleLabel')">
              <a-select v-model:value="inviteRole" :options="roleOptions" />
            </a-form-item>
          </a-form>
        </a-modal>

        <!-- Create Team Modal -->
        <a-modal
          v-model:open="showCreateTeamModal"
          :title="t('organization.members.createTeamTitle')"
          :confirm-loading="creatingTeam"
          @ok="createTeam"
          :ok-text="t('organization.members.createTeamOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
            <a-form-item :label="t('organization.members.teamNameLabel')" required>
              <a-input v-model:value="newTeamName" :placeholder="t('organization.members.teamNamePlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.members.teamDescLabel')">
              <a-input v-model:value="newTeamDesc" :placeholder="t('organization.members.teamDescPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.members.teamLeadLabel')">
              <a-input v-model:value="newTeamLead" :placeholder="t('organization.members.teamLeadPlaceholder')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 3: Approval Management -->
      <a-tab-pane key="approvals">
        <template #tab>
          <AuditOutlined />
          {{ t('organization.tabs.approvals') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" @click="showSubmitApprovalModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('organization.approvals.submitButton') }}
          </a-button>
        </a-space>

        <div v-if="approvalLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="approvalColumns"
          :data-source="approvalList"
          :pagination="{ pageSize: 20, showTotal: (count) => t('organization.totals.rows', { count }) }"
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
                  {{ t('organization.approvals.approve') }}
                </a-button>
                <a-button danger size="small" :loading="record._rejecting" @click.stop="rejectItem(record)">
                  <template #icon><CloseOutlined /></template>
                  {{ t('organization.approvals.reject') }}
                </a-button>
              </a-space>
              <span v-else style="color: var(--text-muted); font-size: 12px;">-</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty :description="t('organization.approvals.emptyText')" />
          </template>
        </a-table>

        <!-- Submit Approval Modal -->
        <a-modal
          v-model:open="showSubmitApprovalModal"
          :title="t('organization.approvals.submitTitle')"
          :confirm-loading="submittingApproval"
          @ok="submitApproval"
          :ok-text="t('organization.approvals.submitOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
            <a-form-item :label="t('organization.approvals.orgLabel')" required>
              <a-select
                v-model:value="approvalOrgId"
                :placeholder="t('organization.approvals.orgPlaceholder')"
                :options="orgSelectOptions"
              />
            </a-form-item>
            <a-form-item :label="t('organization.approvals.titleLabel')" required>
              <a-input v-model:value="approvalTitle" :placeholder="t('organization.approvals.titlePlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.approvals.typeLabel')">
              <a-input v-model:value="approvalType" :placeholder="t('organization.approvals.typePlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('organization.approvals.descLabel')">
              <a-textarea v-model:value="approvalDescription" :placeholder="t('organization.approvals.descPlaceholder')" :rows="3" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { tryParseJson } from '../utils/community-parser.js'

const { t } = useI18n()
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

const orgColumns = computed(() => [
  { title: t('organization.orgColumns.id'), key: 'id', dataIndex: 'id', width: '100px' },
  { title: t('organization.orgColumns.name'), key: 'name', dataIndex: 'name', width: '180px' },
  { title: t('organization.orgColumns.owner'), key: 'owner', dataIndex: 'owner', width: '140px' },
  { title: t('organization.orgColumns.description'), key: 'description', dataIndex: 'description', ellipsis: true },
  { title: t('organization.orgColumns.memberCount'), key: 'memberCount', dataIndex: 'memberCount', width: '90px' },
])

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
    message.error(t('organization.messages.loadOrgsFailed', { err: e.message }))
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
  if (!newOrgName.value.trim()) { message.warning(t('organization.messages.orgNameRequired')); return }
  creatingOrg.value = true
  try {
    const name = newOrgName.value.trim().replace(/"/g, '\\"')
    const desc = newOrgDesc.value.trim().replace(/"/g, '\\"')
    let cmd = `org create "${name}" --json`
    if (desc) cmd = `org create "${name}" --description "${desc}" --json`
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('organization.messages.orgCreateFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('organization.messages.orgCreateOk'))
      showCreateOrgModal.value = false
      newOrgName.value = ''
      newOrgDesc.value = ''
      await loadOrgList()
    }
  } catch (e) {
    message.error(t('organization.messages.orgCreateFailed', { err: e.message }))
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
    detailRaw.value = t('organization.messages.loadDetailFailed', { err: e.message })
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

const roleOptions = computed(() => [
  { label: t('organization.members.roleAdmin'), value: 'admin' },
  { label: t('organization.members.roleMember'), value: 'member' },
  { label: t('organization.members.roleViewer'), value: 'viewer' },
])

const memberColumns = computed(() => [
  { title: t('organization.memberColumns.userId'), key: 'userId', dataIndex: 'userId', width: '160px' },
  { title: t('organization.memberColumns.name'), key: 'name', dataIndex: 'name', width: '140px' },
  { title: t('organization.memberColumns.role'), key: 'role', dataIndex: 'role', width: '100px' },
  { title: t('organization.memberColumns.joinedAt'), key: 'joinedAt', dataIndex: 'joinedAt', width: '180px' },
])

const teamColumns = computed(() => [
  { title: t('organization.teamColumns.name'), key: 'name', dataIndex: 'name', width: '180px' },
  { title: t('organization.teamColumns.description'), key: 'description', dataIndex: 'description', ellipsis: true },
  { title: t('organization.teamColumns.lead'), key: 'lead', dataIndex: 'lead', width: '140px' },
])

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
    message.error(t('organization.messages.loadMembersFailed', { err: e.message }))
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
      teamList.value = parsed.map((team, i) => ({
        key: team.id || team.name || i,
        name: team.name || '-',
        description: team.description || '',
        lead: team.lead || team.leader || '-',
      }))
    } else {
      teamList.value = []
    }
  } catch (e) {
    message.error(t('organization.messages.loadTeamsFailed', { err: e.message }))
  } finally {
    teamLoading.value = false
  }
}

async function inviteMember() {
  if (!inviteUserId.value.trim()) { message.warning(t('organization.messages.userIdRequired')); return }
  inviting.value = true
  try {
    const userId = inviteUserId.value.trim().replace(/"/g, '\\"')
    const name = inviteName.value.trim().replace(/"/g, '\\"')
    let cmd = `org invite ${selectedOrgId.value} ${userId} --role ${inviteRole.value}`
    if (name) cmd += ` --name "${name}"`
    const { output } = await ws.execute(cmd, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('organization.messages.inviteFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('organization.messages.inviteOk'))
      showInviteModal.value = false
      inviteUserId.value = ''
      inviteName.value = ''
      inviteRole.value = 'member'
      await loadMembers()
    }
  } catch (e) {
    message.error(t('organization.messages.inviteFailed', { err: e.message }))
  } finally {
    inviting.value = false
  }
}

async function createTeam() {
  if (!newTeamName.value.trim()) { message.warning(t('organization.messages.teamNameRequired')); return }
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
      message.error(t('organization.messages.teamCreateFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('organization.messages.teamCreateOk'))
      showCreateTeamModal.value = false
      newTeamName.value = ''
      newTeamDesc.value = ''
      newTeamLead.value = ''
      await loadTeams()
    }
  } catch (e) {
    message.error(t('organization.messages.teamCreateFailed', { err: e.message }))
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

const approvalColumns = computed(() => [
  { title: t('organization.approvalColumns.id'), key: 'id', dataIndex: 'id', width: '100px' },
  { title: t('organization.approvalColumns.title'), key: 'title', dataIndex: 'title', width: '200px' },
  { title: t('organization.approvalColumns.type'), key: 'type', dataIndex: 'type', width: '120px' },
  { title: t('organization.approvalColumns.requester'), key: 'requester', dataIndex: 'requester', width: '140px' },
  { title: t('organization.approvalColumns.status'), key: 'status', dataIndex: 'status', width: '100px' },
  { title: t('organization.approvalColumns.actions'), key: 'actions', width: '180px' },
])

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
    message.error(t('organization.messages.loadApprovalsFailed', { err: e.message }))
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
      message.error(t('organization.messages.approveFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('organization.messages.approveOk'))
      await loadApprovals()
    }
  } catch (e) {
    message.error(t('organization.messages.approveFailed', { err: e.message }))
  } finally {
    record._approving = false
  }
}

async function rejectItem(record) {
  record._rejecting = true
  try {
    const { output } = await ws.execute(`org reject ${record.id}`, 15000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('organization.messages.rejectFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('organization.messages.rejectOk'))
      await loadApprovals()
    }
  } catch (e) {
    message.error(t('organization.messages.rejectFailed', { err: e.message }))
  } finally {
    record._rejecting = false
  }
}

async function submitApproval() {
  if (!approvalOrgId.value) { message.warning(t('organization.messages.orgRequired')); return }
  if (!approvalTitle.value.trim()) { message.warning(t('organization.messages.approvalTitleRequired')); return }
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
      message.error(t('organization.messages.submitFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('organization.messages.submitOk'))
      showSubmitApprovalModal.value = false
      approvalOrgId.value = null
      approvalTitle.value = ''
      approvalType.value = ''
      approvalDescription.value = ''
      await loadApprovals()
    }
  } catch (e) {
    message.error(t('organization.messages.submitFailed', { err: e.message }))
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
