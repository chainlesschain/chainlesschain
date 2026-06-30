<template>
  <a-modal
    :open="open"
    :width="1040"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="权限管理"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <SafetyOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="pm-toolbar">
      <span class="pm-subtitle">管理组织权限、角色和访问控制</span>
      <a-space>
        <a-button type="primary" size="small" @click="showCreateTemplateModal">
          <template #icon><PlusOutlined /></template>
          创建权限模板
        </a-button>
        <a-button size="small" @click="showAuditLogModal">
          <template #icon><AuditOutlined /></template>
          审计日志
        </a-button>
      </a-space>
    </div>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="roles" tab="角色权限">
        <RolePermissionsTab
          :org-id="orgId"
          :user-did="userDID"
          @refresh="loadData"
        />
      </a-tab-pane>
      <a-tab-pane key="resources" tab="资源权限">
        <ResourcePermissionsTab
          :org-id="orgId"
          :user-did="userDID"
          @refresh="loadData"
        />
      </a-tab-pane>
      <a-tab-pane key="overrides" tab="权限覆盖">
        <PermissionOverridesTab
          :org-id="orgId"
          :user-did="userDID"
          :overrides="overrides"
          @create="handleCreateOverride"
          @delete="handleDeleteOverride"
          @refresh="loadOverrides"
        />
      </a-tab-pane>
      <a-tab-pane key="templates" tab="权限模板">
        <PermissionTemplatesTab
          :org-id="orgId"
          :user-did="userDID"
          :templates="templates"
          @create="handleCreateTemplate"
          @apply="handleApplyTemplate"
          @refresh="loadTemplates"
        />
      </a-tab-pane>
      <a-tab-pane key="groups" tab="权限组">
        <PermissionGroupsTab
          :org-id="orgId"
          :user-did="userDID"
          :groups="groups"
          @create="handleCreateGroup"
          @assign="handleAssignGroup"
          @refresh="loadGroups"
        />
      </a-tab-pane>
      <a-tab-pane key="statistics" tab="统计分析">
        <PermissionStatisticsTab
          :org-id="orgId"
          :statistics="statistics"
          @refresh="loadStatistics"
        />
      </a-tab-pane>
    </a-tabs>

    <a-modal
      v-model:open="createTemplateVisible"
      title="创建权限模板"
      width="600px"
      @ok="handleCreateTemplateSubmit"
    >
      <a-form
        :model="templateForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="模板名称" required>
          <a-input
            v-model:value="templateForm.templateName"
            placeholder="输入模板名称"
          />
        </a-form-item>
        <a-form-item label="模板类型" required>
          <a-select v-model:value="templateForm.templateType">
            <a-select-option value="role">角色模板</a-select-option>
            <a-select-option value="resource">资源模板</a-select-option>
            <a-select-option value="custom">自定义模板</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="templateForm.description"
            placeholder="输入模板描述"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="权限列表" required>
          <a-select
            v-model:value="templateForm.permissions"
            mode="multiple"
            placeholder="选择权限"
            style="width: 100%"
          >
            <a-select-opt-group label="组织管理">
              <a-select-option value="org.view">查看组织</a-select-option>
              <a-select-option value="org.edit">编辑组织</a-select-option>
              <a-select-option value="org.settings">组织设置</a-select-option>
              <a-select-option value="org.manage">管理组织</a-select-option>
            </a-select-opt-group>
            <a-select-opt-group label="成员管理">
              <a-select-option value="member.view">查看成员</a-select-option>
              <a-select-option value="member.add">添加成员</a-select-option>
              <a-select-option value="member.remove">移除成员</a-select-option>
              <a-select-option value="member.edit">编辑成员</a-select-option>
              <a-select-option value="member.manage">管理成员</a-select-option>
            </a-select-opt-group>
            <a-select-opt-group label="知识库">
              <a-select-option value="knowledge.view">
                查看知识库
              </a-select-option>
              <a-select-option value="knowledge.create">
                创建内容
              </a-select-option>
              <a-select-option value="knowledge.edit">编辑内容</a-select-option>
              <a-select-option value="knowledge.delete">
                删除内容
              </a-select-option>
              <a-select-option value="knowledge.share">
                分享内容
              </a-select-option>
              <a-select-option value="knowledge.comment">
                评论内容
              </a-select-option>
              <a-select-option value="knowledge.manage">
                管理知识库
              </a-select-option>
            </a-select-opt-group>
            <a-select-opt-group label="项目管理">
              <a-select-option value="project.view">查看项目</a-select-option>
              <a-select-option value="project.create">创建项目</a-select-option>
              <a-select-option value="project.edit">编辑项目</a-select-option>
              <a-select-option value="project.delete">删除项目</a-select-option>
              <a-select-option value="project.manage">管理项目</a-select-option>
            </a-select-opt-group>
            <a-select-opt-group label="特殊权限">
              <a-select-option value="*">所有权限</a-select-option>
            </a-select-opt-group>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="auditLogVisible"
      title="权限审计日志"
      width="1000px"
      :footer="null"
    >
      <PermissionAuditLog
        :org-id="orgId"
        :logs="auditLogs"
        @refresh="loadAuditLogs"
      />
    </a-modal>
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  AuditOutlined,
  SafetyOutlined,
} from "@ant-design/icons-vue";
import { useIdentityStore } from "@/stores/identity";
import { logger } from "@/utils/logger";
import RolePermissionsTab from "../pages/RolePermissionsTab.vue";
import ResourcePermissionsTab from "../pages/ResourcePermissionsTab.vue";
import PermissionOverridesTab from "../pages/PermissionOverridesTab.vue";
import PermissionTemplatesTab from "../pages/PermissionTemplatesTab.vue";
import PermissionGroupsTab from "../pages/PermissionGroupsTab.vue";
import PermissionStatisticsTab from "../pages/PermissionStatisticsTab.vue";
import PermissionAuditLog from "../pages/PermissionAuditLog.vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  prefillText: { type: String, default: "" },
});
defineEmits(["update:open"]);

const identityStore = useIdentityStore();

const activeTab = ref("roles");
const loading = ref(false);

const orgId = computed(() => identityStore.currentOrgId);
const userDID = computed(() => identityStore.currentDID);

const overrides = ref([]);
const templates = ref([]);
const groups = ref([]);
const statistics = ref(null);
const auditLogs = ref([]);

const createTemplateVisible = ref(false);
const auditLogVisible = ref(false);

const templateForm = reactive({
  templateName: "",
  templateType: "role",
  description: "",
  permissions: [],
});

async function loadData() {
  await Promise.all([
    loadOverrides(),
    loadTemplates(),
    loadGroups(),
    loadStatistics(),
  ]);
}

async function loadOverrides() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:get-overrides",
      { orgId: orgId.value },
    );
    if (result.success) {
      overrides.value = result.overrides;
    }
  } catch (error) {
    logger.error("Failed to load overrides:", error);
  }
}

async function loadTemplates() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:get-templates",
      { orgId: orgId.value },
    );
    if (result.success) {
      templates.value = result.templates;
    }
  } catch (error) {
    logger.error("Failed to load templates:", error);
  }
}

async function loadGroups() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:get-groups",
      { orgId: orgId.value },
    );
    if (result.success) {
      groups.value = result.groups;
    }
  } catch (error) {
    logger.error("Failed to load groups:", error);
  }
}

async function loadStatistics() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:get-statistics",
      { orgId: orgId.value, userDID: userDID.value },
    );
    if (result.success) {
      statistics.value = result.statistics;
    }
  } catch (error) {
    logger.error("Failed to load statistics:", error);
  }
}

async function loadAuditLogs(options = {}) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:get-audit-log",
      { orgId: orgId.value, userDID: userDID.value, ...options },
    );
    if (result.success) {
      auditLogs.value = result.logs;
    }
  } catch (error) {
    logger.error("Failed to load audit logs:", error);
  }
}

function showCreateTemplateModal() {
  createTemplateVisible.value = true;
}

async function showAuditLogModal() {
  auditLogVisible.value = true;
  await loadAuditLogs({ limit: 100 });
}

async function handleCreateTemplateSubmit() {
  try {
    loading.value = true;
    const result = await window.electron.ipcRenderer.invoke(
      "permission:create-template",
      { orgId: orgId.value, userDID: userDID.value, ...templateForm },
    );
    if (result.success) {
      message.success("权限模板创建成功");
      createTemplateVisible.value = false;
      await loadTemplates();
      Object.assign(templateForm, {
        templateName: "",
        templateType: "role",
        description: "",
        permissions: [],
      });
    } else {
      message.error(result.error || "创建失败");
    }
  } catch (error) {
    logger.error("Failed to create template:", error);
    message.error("创建失败");
  } finally {
    loading.value = false;
  }
}

async function handleCreateOverride(override) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:create-override",
      { orgId: orgId.value, userDID: userDID.value, ...override },
    );
    if (result.success) {
      message.success("权限覆盖创建成功");
      await loadOverrides();
    } else {
      message.error(result.error || "创建失败");
    }
  } catch (error) {
    logger.error("Failed to create override:", error);
    message.error("创建失败");
  }
}

async function handleDeleteOverride(overrideId) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:delete-override",
      { orgId: orgId.value, userDID: userDID.value, overrideId },
    );
    if (result.success) {
      message.success("权限覆盖已删除");
      await loadOverrides();
    } else {
      message.error(result.error || "删除失败");
    }
  } catch (error) {
    logger.error("Failed to delete override:", error);
    message.error("删除失败");
  }
}

async function handleCreateTemplate() {
  await handleCreateTemplateSubmit();
}

async function handleApplyTemplate(templateId, targetType, targetId) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:apply-template",
      {
        orgId: orgId.value,
        userDID: userDID.value,
        templateId,
        targetType,
        targetId,
      },
    );
    if (result.success) {
      message.success("权限模板应用成功");
      await loadData();
    } else {
      message.error(result.error || "应用失败");
    }
  } catch (error) {
    logger.error("Failed to apply template:", error);
    message.error("应用失败");
  }
}

async function handleCreateGroup(group) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:create-group",
      { orgId: orgId.value, userDID: userDID.value, ...group },
    );
    if (result.success) {
      message.success("权限组创建成功");
      await loadGroups();
    } else {
      message.error(result.error || "创建失败");
    }
  } catch (error) {
    logger.error("Failed to create group:", error);
    message.error("创建失败");
  }
}

async function handleAssignGroup(roleName, groupId) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "permission:assign-group",
      { orgId: orgId.value, userDID: userDID.value, roleName, groupId },
    );
    if (result.success) {
      message.success("权限组分配成功");
      await loadData();
    } else {
      message.error(result.error || "分配失败");
    }
  } catch (error) {
    logger.error("Failed to assign group:", error);
    message.error("分配失败");
  }
}

// Load all permission data on open.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    loadData();
  },
  { immediate: true },
);
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
.pm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.pm-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
