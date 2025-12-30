<template>
  <a-card class="role-card" :class="{ 'builtin-role': isBuiltin }">
    <template #title>
      <div class="role-card-title">
        <span>{{ role.name }}</span>
        <a-tag v-if="isBuiltin" color="blue">内置</a-tag>
      </div>
    </template>

    <template #extra>
      <a-dropdown v-if="!isBuiltin">
        <a-button type="text" size="small">
          <MoreOutlined />
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="edit" @click="$emit('edit')">
              <EditOutlined /> 编辑
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item key="delete" danger @click="$emit('delete')">
              <DeleteOutlined /> 删除
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </template>

    <div class="role-card-content">
      <p class="role-description">
        {{ role.description || '暂无描述' }}
      </p>

      <div class="role-permissions">
        <div class="permissions-header">
          <SafetyCertificateOutlined />
          <span>权限 ({{ role.permissions.length }})</span>
        </div>
        <div class="permissions-list">
          <a-tag
            v-for="(perm, index) in displayPermissions"
            :key="perm"
            color="green"
            class="permission-tag"
          >
            {{ formatPermission(perm) }}
          </a-tag>
          <a-tag
            v-if="role.permissions.length > maxDisplayPermissions"
            class="more-tag"
            @click="$emit('view')"
          >
            +{{ role.permissions.length - maxDisplayPermissions }} 更多
          </a-tag>
        </div>
      </div>

      <div class="role-footer">
        <a-button type="link" size="small" @click="$emit('view')">
          查看详情 <RightOutlined />
        </a-button>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from 'vue';
import {
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  SafetyCertificateOutlined,
  RightOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
  role: {
    type: Object,
    required: true
  },
  isBuiltin: {
    type: Boolean,
    default: false
  },
  maxDisplayPermissions: {
    type: Number,
    default: 5
  }
});

defineEmits(['edit', 'delete', 'view']);

// 显示的权限（限制数量）
const displayPermissions = computed(() => {
  return props.role.permissions.slice(0, props.maxDisplayPermissions);
});

/**
 * 格式化权限显示
 */
function formatPermission(perm) {
  // 如果是通配符，显示"所有权限"
  if (perm === '*') {
    return '所有权限';
  }

  // 简化显示，例如 "knowledge.create" -> "创建知识"
  const permMap = {
    'org.manage': '管理组织',
    'org.delete': '删除组织',
    'member.invite': '邀请成员',
    'member.manage': '管理成员',
    'member.remove': '移除成员',
    'role.create': '创建角色',
    'role.manage': '管理角色',
    'role.assign': '分配角色',
    'role.delete': '删除角色',
    'knowledge.create': '创建知识',
    'knowledge.read': '查看知识',
    'knowledge.write': '编辑知识',
    'knowledge.delete': '删除知识',
    'project.create': '创建项目',
    'project.read': '查看项目',
    'project.write': '编辑项目',
    'project.delete': '删除项目',
    'message.send': '发送消息',
    'message.read': '阅读消息'
  };

  return permMap[perm] || perm;
}
</script>

<style scoped>
.role-card {
  height: 100%;
  transition: box-shadow 0.3s, transform 0.3s;
}

.role-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.builtin-role {
  border-color: #1890ff;
}

.role-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.role-card-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.role-description {
  color: #595959;
  font-size: 14px;
  margin: 0;
  min-height: 40px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.role-permissions {
  flex: 1;
}

.permissions-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: #8c8c8c;
  font-size: 13px;
}

.permissions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.permission-tag {
  margin: 0;
  font-size: 12px;
}

.more-tag {
  cursor: pointer;
  background-color: #f0f0f0;
  border-color: #d9d9d9;
}

.more-tag:hover {
  background-color: #e6e6e6;
  border-color: #bfbfbf;
}

.role-footer {
  border-top: 1px solid #f0f0f0;
  padding-top: 12px;
  text-align: right;
}
</style>
