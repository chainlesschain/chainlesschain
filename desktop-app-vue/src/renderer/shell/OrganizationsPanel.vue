<template>
  <a-modal
    :open="open"
    :width="880"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="我的组织"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <TeamOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="org-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.clearError()"
    />

    <div class="org-toolbar">
      <span class="org-count">共 {{ store.organizations.length }} 个组织</span>
      <a-space>
        <a-button size="small" :loading="store.loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" size="small" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          创建组织
        </a-button>
      </a-space>
    </div>

    <a-spin :spinning="store.loading">
      <a-empty
        v-if="!store.loading && store.organizations.length === 0"
        description="您还没有加入任何组织"
      >
        <a-button type="primary" @click="showCreateModal = true">
          创建第一个组织
        </a-button>
      </a-empty>

      <a-row v-else :gutter="[16, 16]">
        <a-col
          v-for="org in store.organizations"
          :key="org.org_id"
          :xs="24"
          :sm="12"
          :md="8"
        >
          <a-card hoverable size="small" class="org-card">
            <div class="org-card-body" @click="goMembers(org.org_id)">
              <a-avatar :src="org.avatar" :size="56">
                <template v-if="!org.avatar" #icon><TeamOutlined /></template>
              </a-avatar>
              <h3 class="org-name">{{ org.name }}</h3>
              <p class="org-desc">{{ org.description || "暂无描述" }}</p>
              <div class="org-meta">
                <a-tag :color="orgTypeColor(org.type)">
                  {{ orgTypeLabel(org.type) }}
                </a-tag>
                <a-tag :color="roleColor(org.role)">
                  {{ roleLabel(org.role) }}
                </a-tag>
              </div>
              <div class="org-stats">
                <span><UserOutlined /> {{ org.member_count || 0 }} 成员</span>
                <span
                  ><ClockCircleOutlined /> {{ formatDate(org.joined_at) }}</span
                >
              </div>
            </div>
            <template #actions>
              <a-tooltip title="成员管理">
                <TeamOutlined @click.stop="goMembers(org.org_id)" />
              </a-tooltip>
              <a-tooltip title="活动日志">
                <HistoryOutlined @click.stop="goActivities(org.org_id)" />
              </a-tooltip>
              <a-tooltip title="组织设置">
                <SettingOutlined @click.stop="goSettings(org.org_id)" />
              </a-tooltip>
            </template>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <p class="panel-desc">
      组织列表与创建在本面板；成员管理 / 活动日志 / 组织设置仍在 V5
      组织详情页，后续 phase 迁入。
    </p>

    <!-- create modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建新组织"
      :confirm-loading="store.creating"
      @ok="handleCreate"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="组织名称" required>
          <a-input
            v-model:value="createForm.name"
            placeholder="输入组织名称"
            :maxlength="50"
          />
        </a-form-item>
        <a-form-item label="组织类型" required>
          <a-select v-model:value="createForm.type">
            <a-select-option value="startup">初创公司</a-select-option>
            <a-select-option value="company">企业</a-select-option>
            <a-select-option value="community">社区</a-select-option>
            <a-select-option value="opensource">开源项目</a-select-option>
            <a-select-option value="education">教育机构</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="组织描述">
          <a-textarea
            v-model:value="createForm.description"
            :rows="3"
            placeholder="描述您的组织(可选)"
            :maxlength="200"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  TeamOutlined,
  PlusOutlined,
  ReloadOutlined,
  UserOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { useOrganizationsStore } from "../stores/organizations";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

const props = defineProps<{ open: boolean; prefillText?: string }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const router = useRouter();
const store = useOrganizationsStore();

const showCreateModal = ref(false);
const createForm = reactive({ name: "", type: "startup", description: "" });

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      store.loadOrganizations();
    }
  },
  { immediate: true },
);

function refresh(): void {
  store.loadOrganizations();
}

async function handleCreate(): Promise<void> {
  if (!createForm.name.trim()) {
    message.warning("请输入组织名称");
    return;
  }
  const org = await store.createOrganization({ ...createForm });
  if (org) {
    message.success("组织创建成功");
    showCreateModal.value = false;
    createForm.name = "";
    createForm.type = "startup";
    createForm.description = "";
    navigate(`/org/${org.org_id}/members`);
  } else {
    message.error(store.error || "创建组织失败");
  }
}

function navigate(path: string): void {
  emit("update:open", false);
  router.push(path);
}

function goMembers(orgId: string): void {
  navigate(`/org/${orgId}/members`);
}
function goActivities(orgId: string): void {
  navigate(`/org/${orgId}/activities`);
}
function goSettings(orgId: string): void {
  navigate(`/org/${orgId}/settings`);
}

function orgTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    startup: "初创公司",
    company: "企业",
    community: "社区",
    opensource: "开源",
    education: "教育",
  };
  return labels[type] || type;
}
function orgTypeColor(type: string): string {
  const colors: Record<string, string> = {
    startup: "green",
    company: "blue",
    community: "purple",
    opensource: "orange",
    education: "cyan",
  };
  return colors[type] || "default";
}
function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    viewer: "访客",
  };
  return labels[role] || role;
}
function roleColor(role: string): string {
  const colors: Record<string, string> = {
    owner: "gold",
    admin: "red",
    member: "blue",
    viewer: "default",
  };
  return colors[role] || "default";
}
function formatDate(ts?: string | number): string {
  if (ts == null) {
    return "—";
  }
  return dayjs(ts).fromNow();
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.org-error {
  margin-bottom: 12px;
}
.org-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.org-count {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.org-card-body {
  text-align: center;
  cursor: pointer;
}
.org-name {
  margin: 12px 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.org-desc {
  margin: 0 0 8px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
  min-height: 36px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.org-meta {
  margin-bottom: 8px;
}
.org-stats {
  display: flex;
  justify-content: center;
  gap: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
