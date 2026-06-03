<template>
  <div class="workspace-selector">
    <a-select
      v-model:value="selectedWorkspaceId"
      :placeholder="placeholder"
      :loading="workspaceStore.loading"
      :allow-clear="false"
      :disabled="disabled"
      :size="size"
      :style="{ minWidth: width }"
      @change="handleChange"
    >
      <template #suffixIcon>
        <apartment-outlined />
      </template>

      <!-- 活跃工作区选项 -->
      <a-select-opt-group label="工作区">
        <a-select-option
          v-for="workspace in workspaceStore.activeWorkspaces"
          :key="workspace.id"
          :value="workspace.id"
        >
          <div class="workspace-option">
            <div class="workspace-icon">
              <a-avatar
                :size="avatarSize"
                :style="{ backgroundColor: workspace.color || getTypeColor(workspace.type) }"
              >
                <template v-if="workspace.icon">
                  <component :is="getIcon(workspace.icon)" />
                </template>
                <template v-else>
                  <apartment-outlined />
                </template>
              </a-avatar>
            </div>
            <div class="workspace-info">
              <div class="workspace-name">
                {{ workspace.name }}
                <a-tag
                  v-if="workspace.is_default"
                  color="blue"
                  size="small"
                >
                  默认
                </a-tag>
                <a-tag
                  v-if="workspace.type !== 'default'"
                  :color="getTypeTagColor(workspace.type)"
                  size="small"
                >
                  {{ getTypeLabel(workspace.type) }}
                </a-tag>
              </div>
              <div
                v-if="showDescription && workspace.description"
                class="workspace-desc"
              >
                {{ truncateText(workspace.description, 30) }}
              </div>
            </div>
          </div>
        </a-select-option>
      </a-select-opt-group>

      <!-- 创建新工作区选项 -->
      <a-select-opt-group
        v-if="showCreateOption"
        label="操作"
      >
        <a-select-option value="__create__">
          <div class="workspace-option">
            <div class="workspace-icon">
              <a-avatar
                :size="avatarSize"
                style="background-color: #52c41a"
              >
                <plus-outlined />
              </a-avatar>
            </div>
            <div class="workspace-info">
              <div class="workspace-name">
                创建新工作区
              </div>
            </div>
          </div>
        </a-select-option>

        <a-select-option value="__manage__">
          <div class="workspace-option">
            <div class="workspace-icon">
              <a-avatar
                :size="avatarSize"
                style="background-color: #1890ff"
              >
                <setting-outlined />
              </a-avatar>
            </div>
            <div class="workspace-info">
              <div class="workspace-name">
                管理工作区
              </div>
            </div>
          </div>
        </a-select-option>
      </a-select-opt-group>
    </a-select>

    <!-- 创建工作区对话框 -->
    <a-modal
      v-model:open="createDialogVisible"
      title="创建工作区"
      :width="600"
      @ok="handleCreate"
      @cancel="handleCreateCancel"
    >
      <a-form
        :model="formData"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="工作区名称"
          required
        >
          <a-input
            v-model:value="formData.name"
            placeholder="请输入工作区名称"
          />
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea
            v-model:value="formData.description"
            placeholder="请输入工作区描述"
            :rows="3"
          />
        </a-form-item>

        <a-form-item label="类型">
          <a-select v-model:value="formData.type">
            <a-select-option value="default">
              默认
            </a-select-option>
            <a-select-option value="development">
              开发环境
            </a-select-option>
            <a-select-option value="testing">
              测试环境
            </a-select-option>
            <a-select-option value="production">
              生产环境
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="颜色">
          <a-space>
            <a-radio-group
              v-model:value="formData.color"
              button-style="solid"
            >
              <a-radio-button value="#1890ff">
                蓝色
              </a-radio-button>
              <a-radio-button value="#52c41a">
                绿色
              </a-radio-button>
              <a-radio-button value="#faad14">
                橙色
              </a-radio-button>
              <a-radio-button value="#f5222d">
                红色
              </a-radio-button>
              <a-radio-button value="#722ed1">
                紫色
              </a-radio-button>
            </a-radio-group>
          </a-space>
        </a-form-item>

        <a-form-item label="可见性">
          <a-select v-model:value="formData.visibility">
            <a-select-option value="members">
              所有成员
            </a-select-option>
            <a-select-option value="admins">
              仅管理员
            </a-select-option>
            <a-select-option value="specific_roles">
              特定角色
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          v-if="!workspaceStore.defaultWorkspace"
          label="设为默认"
        >
          <a-switch v-model:checked="formData.isDefault" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  ApartmentOutlined,
  PlusOutlined,
  SettingOutlined,
  CodeOutlined,
  ExperimentOutlined,
  RocketOutlined
} from '@ant-design/icons-vue';
import { useWorkspaceStore } from '../../stores/workspace';
import { useIdentityStore } from '../../stores/identity';

// Props
const props = defineProps({
  placeholder: {
    type: String,
    default: '选择工作区'
  },
  size: {
    type: String,
    default: 'default'
  },
  width: {
    type: String,
    default: '260px'
  },
  disabled: {
    type: Boolean,
    default: false
  },
  showDescription: {
    type: Boolean,
    default: true
  },
  showCreateOption: {
    type: Boolean,
    default: true
  },
  avatarSize: {
    type: Number,
    default: 24
  }
});

// Emits
const emit = defineEmits(['change', 'create', 'manage']);

// Stores
const workspaceStore = useWorkspaceStore();
const identityStore = useIdentityStore();
const router = useRouter();

// State
const selectedWorkspaceId = ref(null);
const createDialogVisible = ref(false);
const formData = ref({
  name: '',
  description: '',
  type: 'default',
  color: '#1890ff',
  visibility: 'members',
  isDefault: false
});

// Computed
const currentOrgId = computed(() => identityStore.currentOrgId);

// 工作区类型图标映射
const typeIcons = {
  default: ApartmentOutlined,
  development: CodeOutlined,
  testing: ExperimentOutlined,
  production: RocketOutlined
};

// Methods
function getIcon(iconName) {
  return typeIcons[iconName] || ApartmentOutlined;
}

function getTypeColor(type) {
  const colors = {
    default: '#1890ff',
    development: '#52c41a',
    testing: '#faad14',
    production: '#f5222d'
  };
  return colors[type] || '#1890ff';
}

function getTypeTagColor(type) {
  const colors = {
    development: 'green',
    testing: 'orange',
    production: 'red'
  };
  return colors[type] || 'blue';
}

function getTypeLabel(type) {
  const labels = {
    default: '默认',
    development: '开发',
    testing: '测试',
    production: '生产'
  };
  return labels[type] || type;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) {return text;}
  return text.substring(0, maxLength) + '...';
}

async function handleChange(value) {
  if (value === '__create__') {
    // 打开创建对话框
    selectedWorkspaceId.value = workspaceStore.currentWorkspaceId;
    createDialogVisible.value = true;
    emit('create');
  } else if (value === '__manage__') {
    // 跳转到管理页面
    selectedWorkspaceId.value = workspaceStore.currentWorkspaceId;
    router.push('/workspace/manage');
    emit('manage');
  } else {
    // 切换工作区
    await workspaceStore.selectWorkspace(value);
    emit('change', value);
  }
}

async function handleCreate() {
  if (!formData.value.name) {
    return;
  }

  const created = await workspaceStore.createWorkspace(currentOrgId.value, {
    name: formData.value.name,
    description: formData.value.description,
    type: formData.value.type,
    color: formData.value.color,
    visibility: formData.value.visibility,
    isDefault: formData.value.isDefault
  });

  if (created) {
    createDialogVisible.value = false;
    resetFormData();
  }
}

function handleCreateCancel() {
  createDialogVisible.value = false;
  resetFormData();
}

function resetFormData() {
  formData.value = {
    name: '',
    description: '',
    type: 'default',
    color: '#1890ff',
    visibility: 'members',
    isDefault: false
  };
}

// Watch
watch(
  () => workspaceStore.currentWorkspaceId,
  (newId) => {
    selectedWorkspaceId.value = newId;
  },
  { immediate: true }
);

watch(
  () => currentOrgId.value,
  async (newOrgId) => {
    if (newOrgId) {
      await workspaceStore.loadWorkspaces(newOrgId);
    }
  },
  { immediate: true }
);

// Lifecycle
onMounted(async () => {
  // 初始化时加载工作区列表
  if (currentOrgId.value) {
    await workspaceStore.loadWorkspaces(currentOrgId.value);
  }
});
</script>

<style scoped lang="less">
.workspace-selector {
  display: inline-block;

  .workspace-option {
    display: flex;
    align-items: center;
    gap: 12px;

    .workspace-icon {
      flex-shrink: 0;
    }

    .workspace-info {
      flex: 1;
      min-width: 0;

      .workspace-name {
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .workspace-desc {
        font-size: 12px;
        color: #8c8c8c;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}
</style>
