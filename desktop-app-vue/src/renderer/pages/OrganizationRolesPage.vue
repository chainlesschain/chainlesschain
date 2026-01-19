<template>
  <div class="organization-roles-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>角色与权限管理</h2>
        <p class="subtitle">
          管理组织中的角色和权限配置
        </p>
      </div>
      <div class="header-right">
        <PermissionGuard
          permission="role.create"
          mode="custom"
        >
          <a-button
            type="primary"
            @click="showCreateRoleModal"
          >
            <PlusOutlined /> 创建自定义角色
          </a-button>
          <template #denied>
            <a-tooltip title="您没有权限创建角色">
              <a-button
                type="primary"
                disabled
              >
                <PlusOutlined /> 创建自定义角色
              </a-button>
            </a-tooltip>
          </template>
        </PermissionGuard>
      </div>
    </div>

    <!-- 角色列表 -->
    <a-spin :spinning="loading">
      <div class="roles-list">
        <!-- 内置角色 -->
        <div class="role-section">
          <h3>内置角色</h3>
          <p class="section-desc">
            系统预置角色，不可修改或删除
          </p>
          <a-row :gutter="[16, 16]">
            <a-col
              v-for="role in builtinRoles"
              :key="role.id"
              :xs="24"
              :sm="12"
              :lg="8"
            >
              <RoleCard
                :role="role"
                :is-builtin="true"
                @view="handleViewRole(role)"
              />
            </a-col>
          </a-row>
        </div>

        <!-- 自定义角色 -->
        <div class="role-section">
          <h3>自定义角色</h3>
          <p class="section-desc">
            由组织创建的自定义角色
          </p>
          <a-row
            v-if="customRoles.length > 0"
            :gutter="[16, 16]"
          >
            <a-col
              v-for="role in customRoles"
              :key="role.id"
              :xs="24"
              :sm="12"
              :lg="8"
            >
              <RoleCard
                :role="role"
                :is-builtin="false"
                @edit="handleEditRole(role)"
                @delete="handleDeleteRole(role)"
                @view="handleViewRole(role)"
              />
            </a-col>
          </a-row>
          <a-empty
            v-else
            description="暂无自定义角色"
          />
        </div>
      </div>
    </a-spin>

    <!-- 创建/编辑角色弹窗 -->
    <a-modal
      v-model:open="roleModalVisible"
      :title="isEditMode ? '编辑角色' : '创建角色'"
      width="800px"
      @ok="handleRoleModalOk"
      @cancel="handleRoleModalCancel"
    >
      <a-form
        ref="roleFormRef"
        :model="roleForm"
        :rules="roleFormRules"
        layout="vertical"
      >
        <a-form-item
          label="角色名称"
          name="name"
        >
          <a-input
            v-model:value="roleForm.name"
            placeholder="例如：项目经理、技术专家等"
            :maxlength="20"
            show-count
          />
        </a-form-item>

        <a-form-item
          label="角色描述"
          name="description"
        >
          <a-textarea
            v-model:value="roleForm.description"
            placeholder="描述此角色的职责和权限范围"
            :rows="3"
            :maxlength="200"
            show-count
          />
        </a-form-item>

        <a-form-item
          label="权限配置"
          name="permissions"
        >
          <div class="permissions-selector">
            <a-collapse v-model:active-key="activePermissionCategories">
              <a-collapse-panel
                v-for="category in allPermissions"
                :key="category.category"
                :header="category.category"
              >
                <a-checkbox-group
                  v-model:value="roleForm.permissions"
                  class="permission-checkbox-group"
                >
                  <div
                    v-for="perm in category.permissions"
                    :key="perm.value"
                    class="permission-item"
                  >
                    <a-checkbox :value="perm.value">
                      <strong>{{ perm.label }}</strong>
                      <p class="permission-desc">
                        {{ perm.description }}
                      </p>
                    </a-checkbox>
                  </div>
                </a-checkbox-group>
              </a-collapse-panel>
            </a-collapse>

            <div class="selected-permissions-summary">
              <span>已选择 {{ roleForm.permissions.length }} 个权限</span>
              <a-button
                size="small"
                @click="roleForm.permissions = []"
              >
                清空
              </a-button>
            </div>
          </div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 查看角色详情弹窗 -->
    <a-modal
      v-model:open="viewRoleModalVisible"
      title="角色详情"
      width="700px"
      :footer="null"
    >
      <div
        v-if="viewingRole"
        class="role-detail"
      >
        <a-descriptions
          bordered
          :column="1"
        >
          <a-descriptions-item label="角色名称">
            {{ viewingRole.name }}
            <a-tag
              v-if="viewingRole.is_builtin"
              color="blue"
            >
              内置角色
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="角色描述">
            {{ viewingRole.description || '无描述' }}
          </a-descriptions-item>
          <a-descriptions-item label="权限列表">
            <div class="permission-tags">
              <a-tag
                v-for="perm in viewingRole.permissions"
                :key="perm"
                color="green"
              >
                {{ getPermissionLabel(perm) }}
              </a-tag>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatTimestamp(viewingRole.created_at) }}
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import { useIdentityStore } from '../stores/identity';
import PermissionGuard from '../components/PermissionGuard.vue';
import RoleCard from '../components/RoleCard.vue';

const { ipcRenderer } = window.electron || {};

const identityStore = useIdentityStore();

// 数据
const loading = ref(false);
const roles = ref([]);
const allPermissions = ref([]);
const roleModalVisible = ref(false);
const viewRoleModalVisible = ref(false);
const isEditMode = ref(false);
const viewingRole = ref(null);
const activePermissionCategories = ref([]);

// 表单
const roleFormRef = ref(null);
const roleForm = ref({
  name: '',
  description: '',
  permissions: []
});

const roleFormRules = {
  name: [
    { required: true, message: '请输入角色名称', trigger: 'blur' },
    { min: 2, max: 20, message: '角色名称长度在2-20个字符', trigger: 'blur' }
  ],
  permissions: [
    { type: 'array', required: true, message: '请至少选择一个权限', trigger: 'change' }
  ]
};

// 计算属性
const builtinRoles = computed(() => roles.value.filter(r => r.is_builtin));
const customRoles = computed(() => roles.value.filter(r => !r.is_builtin));

/**
 * 加载角色列表
 */
async function loadRoles() {
  loading.value = true;

  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId) {
      throw new Error('未选择组织');
    }

    const result = await ipcRenderer.invoke('org:get-roles', orgId);
    roles.value = result || [];
  } catch (error) {
    logger.error('加载角色列表失败:', error);
    message.error(error.message || '加载角色列表失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 加载所有权限列表
 */
async function loadAllPermissions() {
  try {
    const result = await ipcRenderer.invoke('org:get-all-permissions');
    allPermissions.value = result || [];

    // 默认展开第一个分类
    if (allPermissions.value.length > 0) {
      activePermissionCategories.value = [allPermissions.value[0].category];
    }
  } catch (error) {
    logger.error('加载权限列表失败:', error);
    message.error('加载权限列表失败');
  }
}

/**
 * 显示创建角色弹窗
 */
function showCreateRoleModal() {
  isEditMode.value = false;
  roleForm.value = {
    name: '',
    description: '',
    permissions: []
  };
  roleModalVisible.value = true;
}

/**
 * 编辑角色
 */
function handleEditRole(role) {
  isEditMode.value = true;
  roleForm.value = {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: [...role.permissions]
  };
  roleModalVisible.value = true;
}

/**
 * 删除角色
 */
function handleDeleteRole(role) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除角色"${role.name}"吗？此操作不可撤销。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        const userDID = identityStore.primaryDID;
        await ipcRenderer.invoke('org:delete-role', role.id, userDID);

        message.success('角色删除成功');
        await loadRoles();
      } catch (error) {
        logger.error('删除角色失败:', error);
        message.error(error.message || '删除角色失败');
      }
    }
  });
}

/**
 * 查看角色详情
 */
function handleViewRole(role) {
  viewingRole.value = role;
  viewRoleModalVisible.value = true;
}

/**
 * 角色弹窗确认
 */
async function handleRoleModalOk() {
  try {
    await roleFormRef.value.validate();

    const userDID = identityStore.primaryDID;
    const orgId = identityStore.currentOrgId;

    if (isEditMode.value) {
      // 更新角色
      await ipcRenderer.invoke('org:update-role', roleForm.value.id, {
        name: roleForm.value.name,
        description: roleForm.value.description,
        permissions: roleForm.value.permissions
      }, userDID);

      message.success('角色更新成功');
    } else {
      // 创建角色
      await ipcRenderer.invoke('org:create-custom-role', orgId, {
        name: roleForm.value.name,
        description: roleForm.value.description,
        permissions: roleForm.value.permissions
      }, userDID);

      message.success('角色创建成功');
    }

    roleModalVisible.value = false;
    await loadRoles();
  } catch (error) {
    if (error.errorFields) {
      return; // 表单验证失败
    }
    logger.error('保存角色失败:', error);
    message.error(error.message || '保存角色失败');
  }
}

/**
 * 角色弹窗取消
 */
function handleRoleModalCancel() {
  roleModalVisible.value = false;
  roleFormRef.value?.resetFields();
}

/**
 * 获取权限显示名称
 */
function getPermissionLabel(permValue) {
  for (const category of allPermissions.value) {
    const perm = category.permissions.find(p => p.value === permValue);
    if (perm) {
      return perm.label;
    }
  }
  return permValue;
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp) {
  if (!timestamp) {return '-';}
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

onMounted(async () => {
  await Promise.all([
    loadRoles(),
    loadAllPermissions()
  ]);
});
</script>

<style scoped>
.organization-roles-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header-left h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.subtitle {
  margin: 4px 0 0 0;
  color: #8c8c8c;
  font-size: 14px;
}

.roles-list {
  margin-top: 24px;
}

.role-section {
  margin-bottom: 40px;
}

.role-section h3 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

.section-desc {
  color: #8c8c8c;
  font-size: 14px;
  margin-bottom: 16px;
}

/* 权限选择器样式 */
.permissions-selector {
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 16px;
}

.permission-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.permission-item {
  padding: 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.permission-item:hover {
  background-color: #f5f5f5;
}

.permission-desc {
  margin: 4px 0 0 24px;
  color: #8c8c8c;
  font-size: 12px;
}

.selected-permissions-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

/* 角色详情样式 */
.role-detail {
  padding: 16px 0;
}

.permission-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
