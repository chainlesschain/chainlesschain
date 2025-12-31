<template>
  <div class="knowledge-permission-selector">
    <!-- 共享范围选择 -->
    <a-radio-group v-model:value="selectedScope" @change="handleScopeChange" class="scope-selector">
      <a-space direction="vertical" size="large" style="width: 100%">
        <!-- 私有 -->
        <a-radio value="private">
          <div class="scope-option">
            <div class="scope-header">
              <LockOutlined class="scope-icon" />
              <span class="scope-title">私有</span>
            </div>
            <div class="scope-description">
              仅您自己可见，其他人无法访问
            </div>
          </div>
        </a-radio>

        <!-- 团队（未来扩展） -->
        <a-radio value="team" disabled>
          <div class="scope-option">
            <div class="scope-header">
              <UsergroupAddOutlined class="scope-icon" />
              <span class="scope-title">团队</span>
              <a-tag size="small" color="blue">即将推出</a-tag>
            </div>
            <div class="scope-description">
              指定团队成员可见（功能开发中）
            </div>
          </div>
        </a-radio>

        <!-- 组织 -->
        <a-radio value="org">
          <div class="scope-option">
            <div class="scope-header">
              <TeamOutlined class="scope-icon" />
              <span class="scope-title">组织共享</span>
            </div>
            <div class="scope-description">
              组织内所有成员可见，根据角色权限进行访问控制
            </div>
            <!-- 组织权限详情 -->
            <div v-if="selectedScope === 'org'" class="scope-detail">
              <a-divider style="margin: 12px 0" />
              <div class="permission-preview">
                <h4>组织成员权限：</h4>
                <a-space direction="vertical" size="small" style="width: 100%">
                  <div class="permission-item">
                    <a-tag color="red">所有者</a-tag>
                    <span>完全控制权限（读、写、删除、管理）</span>
                  </div>
                  <div class="permission-item">
                    <a-tag color="orange">管理员</a-tag>
                    <span>读、写、删除权限</span>
                  </div>
                  <div class="permission-item">
                    <a-tag color="blue">成员</a-tag>
                    <span>读、写权限</span>
                  </div>
                  <div class="permission-item">
                    <a-tag color="default">访客</a-tag>
                    <span>仅可查看</span>
                  </div>
                </a-space>
              </div>
            </div>
          </div>
        </a-radio>

        <!-- 公开 -->
        <a-radio value="public">
          <div class="scope-option">
            <div class="scope-header">
              <GlobalOutlined class="scope-icon" />
              <span class="scope-title">公开</span>
            </div>
            <div class="scope-description">
              所有人可见，包括组织外部人员（只读）
            </div>
          </div>
        </a-radio>
      </a-space>
    </a-radio-group>

    <!-- 高级权限设置（可选） -->
    <a-collapse v-if="showAdvanced && selectedScope === 'org'" style="margin-top: 16px">
      <a-collapse-panel key="advanced" header="高级权限设置">
        <a-form layout="vertical">
          <a-form-item label="特定成员权限">
            <a-select
              v-model:value="advancedPermissions.specificMembers"
              mode="multiple"
              placeholder="选择特定成员赋予权限"
              style="width: 100%"
            >
              <a-select-option
                v-for="member in orgMembers"
                :key="member.member_did"
                :value="member.member_did"
              >
                {{ member.display_name || member.member_did }}
              </a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="权限级别">
            <a-select v-model:value="advancedPermissions.permissionLevel">
              <a-select-option value="read">只读</a-select-option>
              <a-select-option value="write">读写</a-select-option>
              <a-select-option value="admin">管理</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="过期时间">
            <a-date-picker
              v-model:value="advancedPermissions.expiresAt"
              show-time
              placeholder="选择过期时间（可选）"
              style="width: 100%"
            />
          </a-form-item>
        </a-form>
      </a-collapse-panel>
    </a-collapse>

    <!-- 权限预览摘要 -->
    <a-alert
      v-if="showSummary"
      :message="getScopeSummary()"
      type="info"
      show-icon
      style="margin-top: 16px"
    >
      <template #icon>
        <InfoCircleOutlined />
      </template>
    </a-alert>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import {
  LockOutlined,
  UsergroupAddOutlined,
  TeamOutlined,
  GlobalOutlined,
  InfoCircleOutlined
} from '@ant-design/icons-vue';

// ==================== Props & Emits ====================
const props = defineProps({
  value: {
    type: String,
    default: 'org'
  },
  orgId: {
    type: String,
    default: null
  },
  showAdvanced: {
    type: Boolean,
    default: false
  },
  showSummary: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update:value', 'change']);

// ==================== State ====================
const selectedScope = ref(props.value);
const orgMembers = ref([]);
const advancedPermissions = ref({
  specificMembers: [],
  permissionLevel: 'read',
  expiresAt: null
});

// ==================== Computed ====================
const scopeConfig = computed(() => {
  return {
    scope: selectedScope.value,
    advancedPermissions: props.showAdvanced ? advancedPermissions.value : null
  };
});

// ==================== Methods ====================

/**
 * 处理范围变更
 */
function handleScopeChange(e) {
  const newScope = e.target.value;
  selectedScope.value = newScope;
  emit('update:value', newScope);
  emit('change', scopeConfig.value);
}

/**
 * 获取范围摘要
 */
function getScopeSummary() {
  const summaries = {
    private: '这条知识将保持私有，只有您可以查看和编辑。',
    team: '这条知识将对指定团队成员可见。',
    org: `这条知识将对组织内所有成员可见，根据其角色自动分配权限。`,
    public: '这条知识将公开可见，任何人都可以查看（只读）。'
  };
  return summaries[selectedScope.value] || '';
}

/**
 * 加载组织成员（用于高级权限设置）
 */
async function loadOrgMembers() {
  if (!props.orgId || !props.showAdvanced) return;

  try {
    const result = await window.electron.invoke('org:get-members', props.orgId);
    if (result.success) {
      orgMembers.value = result.members || [];
    }
  } catch (error) {
    console.error('加载组织成员失败:', error);
  }
}

// ==================== Watchers ====================
watch(() => props.value, (newValue) => {
  selectedScope.value = newValue;
});

watch(() => props.orgId, () => {
  loadOrgMembers();
});

// ==================== Lifecycle ====================
onMounted(() => {
  loadOrgMembers();
});
</script>

<style scoped lang="less">
.knowledge-permission-selector {
  .scope-selector {
    width: 100%;

    :deep(.ant-radio-wrapper) {
      display: block;
      width: 100%;
      padding: 16px;
      border: 1px solid #d9d9d9;
      border-radius: 4px;
      transition: all 0.3s;

      &:hover {
        border-color: #1890ff;
        background-color: #f0f7ff;
      }

      &.ant-radio-wrapper-checked {
        border-color: #1890ff;
        background-color: #e6f7ff;
      }

      &.ant-radio-wrapper-disabled {
        cursor: not-allowed;
        opacity: 0.6;

        &:hover {
          border-color: #d9d9d9;
          background-color: transparent;
        }
      }
    }

    .scope-option {
      margin-left: 8px;

      .scope-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;

        .scope-icon {
          font-size: 18px;
          color: #1890ff;
        }

        .scope-title {
          font-size: 16px;
          font-weight: 600;
          color: #333;
        }
      }

      .scope-description {
        margin-left: 26px;
        color: #666;
        font-size: 14px;
        line-height: 1.6;
      }

      .scope-detail {
        margin-left: 26px;

        .permission-preview {
          h4 {
            margin: 0 0 8px;
            font-size: 14px;
            font-weight: 600;
            color: #333;
          }

          .permission-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            font-size: 13px;
            color: #666;
          }
        }
      }
    }
  }

  :deep(.ant-collapse) {
    border: 1px solid #d9d9d9;
    border-radius: 4px;
  }
}
</style>
