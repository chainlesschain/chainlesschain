<template>
  <div class="permission-management-page">
    <a-page-header
      title="权限管理"
      sub-title="管理组织权限、角色和访问控制"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-button type="primary" @click="showCreateTemplateModal">
          <template #icon>
            <PlusOutlined />
          </template>
          创建权限模板
        </a-button>
        <a-button @click="showAuditLogModal">
          <template #icon>
            <AuditOutlined />
          </template>
          审计日志
        </a-button>
      </template>
    </a-page-header>

    <div class="permission-content">
      <a-tabs v-model:active-key="activeTab">
        <!-- 角色权限 -->
        <a-tab-pane key="roles" tab="角色权限">
          <RolePermissionsTab
            :org-id="orgId"
            :user-did="userDID"
            @refresh="loadData"
          />
        </a-tab-pane>

        <!-- 资源权限 -->
        <a-tab-pane key="resources" tab="资源权限">
          <ResourcePermissionsTab
            :org-id="orgId"
            :user-did="userDID"
            @refresh="loadData"
          />
        </a-tab-pane>

        <!-- 权限覆盖 -->
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

        <!-- 权限模板 -->
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

        <!-- 权限组 -->
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

        <!-- 统计分析 -->
        <a-tab-pane key="statistics" tab="统计分析">
          <PermissionStatisticsTab
            :org-id="orgId"
            :statistics="statistics"
            @refresh="loadStatistics"
          />
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 创建权限模板对话框 -->
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
            <a-select-option value="role"> 角色模板 </a-select-option>
            <a-select-option value="resource"> 资源模板 </a-select-option>
            <a-select-option value="custom"> 自定义模板 </a-select-option>
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
              <a-select-option value="org.view"> 查看组织 </a-select-option>
              <a-select-option value="org.edit"> 编辑组织 </a-select-option>
              <a-select-option value="org.settings"> 组织设置 </a-select-option>
              <a-select-option value="org.manage"> 管理组织 </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="成员管理">
              <a-select-option value="member.view"> 查看成员 </a-select-option>
              <a-select-option value="member.add"> 添加成员 </a-select-option>
              <a-select-option value="member.remove">
                移除成员
              </a-select-option>
              <a-select-option value="member.edit"> 编辑成员 </a-select-option>
              <a-select-option value="member.manage">
                管理成员
              </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="知识库">
              <a-select-option value="knowledge.view">
                查看知识库
              </a-select-option>
              <a-select-option value="knowledge.create">
                创建内容
              </a-select-option>
              <a-select-option value="knowledge.edit">
                编辑内容
              </a-select-option>
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
              <a-select-option value="project.view"> 查看项目 </a-select-option>
              <a-select-option value="project.create">
                创建项目
              </a-select-option>
              <a-select-option value="project.edit"> 编辑项目 </a-select-option>
              <a-select-option value="project.delete">
                删除项目
              </a-select-option>
              <a-select-option value="project.manage">
                管理项目
              </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="特殊权限">
              <a-select-option value="*"> 所有权限 </a-select-option>
            </a-select-opt-group>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 审计日志对话框 -->
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
  </div>
</template>

<script>
import { logger } from "@/utils/logger";

import { defineComponent, ref, reactive, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { message } from "ant-design-vue";
import { PlusOutlined, AuditOutlined } from "@ant-design/icons-vue";
import { useIdentityStore } from "@/stores/identity";

import RolePermissionsTab from "./RolePermissionsTab.vue";
import ResourcePermissionsTab from "./ResourcePermissionsTab.vue";
import PermissionOverridesTab from "./PermissionOverridesTab.vue";
import PermissionTemplatesTab from "./PermissionTemplatesTab.vue";
import PermissionGroupsTab from "./PermissionGroupsTab.vue";
import PermissionStatisticsTab from "./PermissionStatisticsTab.vue";
import PermissionAuditLog from "./PermissionAuditLog.vue";

export default defineComponent({
  name: "PermissionManagementPage",

  components: {
    PlusOutlined,
    AuditOutlined,
    RolePermissionsTab,
    ResourcePermissionsTab,
    PermissionOverridesTab,
    PermissionTemplatesTab,
    PermissionGroupsTab,
    PermissionStatisticsTab,
    PermissionAuditLog,
  },

  setup() {
    const route = useRoute();
    const identityStore = useIdentityStore();

    const activeTab = ref("roles");
    const loading = ref(false);

    const orgId = computed(() => identityStore.currentOrgId);
    const userDID = computed(() => identityStore.currentDID);

    // Data
    const overrides = ref([]);
    const templates = ref([]);
    const groups = ref([]);
    const statistics = ref(null);
    const auditLogs = ref([]);

    // Modals
    const createTemplateVisible = ref(false);
    const auditLogVisible = ref(false);

    // Forms
    const templateForm = reactive({
      templateName: "",
      templateType: "role",
      description: "",
      permissions: [],
    });

    // Load data
    const loadData = async () => {
      await Promise.all([
        loadOverrides(),
        loadTemplates(),
        loadGroups(),
        loadStatistics(),
      ]);
    };

    const loadOverrides = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:get-overrides",
          {
            orgId: orgId.value,
          },
        );

        if (result.success) {
          overrides.value = result.overrides;
        }
      } catch (error) {
        logger.error("Failed to load overrides:", error);
      }
    };

    const loadTemplates = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:get-templates",
          {
            orgId: orgId.value,
          },
        );

        if (result.success) {
          templates.value = result.templates;
        }
      } catch (error) {
        logger.error("Failed to load templates:", error);
      }
    };

    const loadGroups = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:get-groups",
          {
            orgId: orgId.value,
          },
        );

        if (result.success) {
          groups.value = result.groups;
        }
      } catch (error) {
        logger.error("Failed to load groups:", error);
      }
    };

    const loadStatistics = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:get-statistics",
          {
            orgId: orgId.value,
            userDID: userDID.value,
          },
        );

        if (result.success) {
          statistics.value = result.statistics;
        }
      } catch (error) {
        logger.error("Failed to load statistics:", error);
      }
    };

    const loadAuditLogs = async (options = {}) => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:get-audit-log",
          {
            orgId: orgId.value,
            userDID: userDID.value,
            ...options,
          },
        );

        if (result.success) {
          auditLogs.value = result.logs;
        }
      } catch (error) {
        logger.error("Failed to load audit logs:", error);
      }
    };

    // Handlers
    const showCreateTemplateModal = () => {
      createTemplateVisible.value = true;
    };

    const showAuditLogModal = async () => {
      auditLogVisible.value = true;
      await loadAuditLogs({ limit: 100 });
    };

    const handleCreateTemplateSubmit = async () => {
      try {
        loading.value = true;

        const result = await window.electron.ipcRenderer.invoke(
          "permission:create-template",
          {
            orgId: orgId.value,
            userDID: userDID.value,
            ...templateForm,
          },
        );

        if (result.success) {
          message.success("权限模板创建成功");
          createTemplateVisible.value = false;
          await loadTemplates();

          // Reset form
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
    };

    const handleCreateOverride = async (override) => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:create-override",
          {
            orgId: orgId.value,
            userDID: userDID.value,
            ...override,
          },
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
    };

    const handleDeleteOverride = async (overrideId) => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:delete-override",
          {
            orgId: orgId.value,
            userDID: userDID.value,
            overrideId,
          },
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
    };

    const handleCreateTemplate = async (template) => {
      await handleCreateTemplateSubmit();
    };

    const handleApplyTemplate = async (templateId, targetType, targetId) => {
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
    };

    const handleCreateGroup = async (group) => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:create-group",
          {
            orgId: orgId.value,
            userDID: userDID.value,
            ...group,
          },
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
    };

    const handleAssignGroup = async (roleName, groupId) => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "permission:assign-group",
          {
            orgId: orgId.value,
            userDID: userDID.value,
            roleName,
            groupId,
          },
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
    };

    onMounted(() => {
      loadData();
    });

    return {
      activeTab,
      loading,
      orgId,
      userDID,
      overrides,
      templates,
      groups,
      statistics,
      auditLogs,
      createTemplateVisible,
      auditLogVisible,
      templateForm,
      loadData,
      loadOverrides,
      loadTemplates,
      loadGroups,
      loadStatistics,
      loadAuditLogs,
      showCreateTemplateModal,
      showAuditLogModal,
      handleCreateTemplateSubmit,
      handleCreateOverride,
      handleDeleteOverride,
      handleCreateTemplate,
      handleApplyTemplate,
      handleCreateGroup,
      handleAssignGroup,
    };
  },
});
</script>

<style scoped lang="less">
.permission-management-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;

  .permission-content {
    flex: 1;
    padding: 24px;
    overflow: auto;

    :deep(.ant-tabs) {
      background: white;
      padding: 16px;
      border-radius: 4px;
    }
  }
}
</style>
