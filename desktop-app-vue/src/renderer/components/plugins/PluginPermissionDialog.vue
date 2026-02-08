<template>
  <a-modal
    v-model:open="visible"
    :title="null"
    :footer="null"
    :mask-closable="false"
    :closable="false"
    :keyboard="false"
    width="600px"
    centered
    class="permission-dialog"
  >
    <div class="dialog-content">
      <!-- 插件信息头部 -->
      <div class="plugin-header">
        <div class="plugin-icon">
          <AppstoreOutlined style="font-size: 32px; color: #1890ff" />
        </div>
        <div class="plugin-info">
          <h2>{{ pluginInfo?.name || "未知插件" }}</h2>
          <p class="plugin-meta">
            <span>v{{ pluginInfo?.version || "0.0.0" }}</span>
            <a-divider type="vertical" />
            <span>{{ pluginInfo?.author || "未知作者" }}</span>
          </p>
          <p v-if="pluginInfo?.description" class="plugin-description">
            {{ pluginInfo.description }}
          </p>
        </div>
      </div>

      <!-- 权限说明 -->
      <a-alert
        message="此插件请求以下权限"
        description="请仔细查看并选择要授予的权限。授予权限后，插件将能够执行相应操作。"
        type="info"
        show-icon
        style="margin-bottom: 16px"
      />

      <!-- 权限列表 -->
      <div class="permissions-container">
        <div
          v-for="(group, category) in groupedPermissions"
          :key="category"
          class="permission-category"
        >
          <div class="category-header">
            <component
              :is="getCategoryIcon(category)"
              style="margin-right: 8px"
            />
            <span class="category-name">{{ group.name }}</span>
            <span class="category-count"
              >({{ group.permissions.length }}项)</span
            >
            <a-button
              type="link"
              size="small"
              @click="toggleCategory(category)"
            >
              {{ isCategoryAllSelected(category) ? "取消全选" : "全选" }}
            </a-button>
          </div>

          <div class="permission-list">
            <div
              v-for="perm in group.permissions"
              :key="perm.permission"
              class="permission-item"
              :class="{
                'permission-granted': permissionStates[perm.permission],
              }"
            >
              <div class="permission-content">
                <div class="permission-main">
                  <a-checkbox
                    v-model:checked="permissionStates[perm.permission]"
                    class="permission-checkbox"
                  >
                    <span class="permission-name">{{ perm.name }}</span>
                  </a-checkbox>
                  <a-tag :color="perm.riskColor" size="small" class="risk-tag">
                    {{ perm.riskLabel }}
                  </a-tag>
                </div>
                <p class="permission-description">
                  {{ perm.description }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 风险提示 -->
      <div v-if="hasDangerousPermissions" class="danger-warning">
        <a-alert
          message="高风险权限警告"
          :description="dangerousWarningText"
          type="error"
          show-icon
        />
      </div>

      <!-- 记住选择 -->
      <div class="remember-choice">
        <a-checkbox v-model:checked="rememberChoice">
          记住此选择（下次安装此插件时自动应用）
        </a-checkbox>
      </div>

      <!-- 操作按钮 -->
      <div class="dialog-actions">
        <a-space>
          <a-button @click="handleReject">
            <CloseOutlined />
            拒绝
          </a-button>
          <a-button @click="selectAll"> 全部选中 </a-button>
          <a-button @click="unselectAll"> 全部取消 </a-button>
          <a-button
            type="primary"
            :disabled="!hasAnySelected"
            @click="handleApprove"
          >
            <CheckOutlined />
            授权选中的权限 ({{ selectedCount }}/{{ totalCount }})
          </a-button>
        </a-space>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, watch, onMounted, onUnmounted } from "vue";
import {
  AppstoreOutlined,
  CheckOutlined,
  CloseOutlined,
  DatabaseOutlined,
  RobotOutlined,
  LayoutOutlined,
  FolderOutlined,
  GlobalOutlined,
  SettingOutlined,
  SearchOutlined,
  HddOutlined,
} from "@ant-design/icons-vue";

const emit = defineEmits(["approve", "reject"]);

// 状态
const visible = ref(false);
const requestId = ref(null);
const pluginInfo = ref(null);
const permissions = ref([]);
const permissionStates = reactive({});
const rememberChoice = ref(false);

// 分类图标映射
const categoryIcons = {
  database: DatabaseOutlined,
  llm: RobotOutlined,
  ui: LayoutOutlined,
  file: FolderOutlined,
  network: GlobalOutlined,
  system: SettingOutlined,
  rag: SearchOutlined,
  storage: HddOutlined,
};

// 计算属性
const groupedPermissions = computed(() => {
  const grouped = {};

  for (const perm of permissions.value) {
    const category = perm.category;
    if (!grouped[category]) {
      grouped[category] = {
        name: getCategoryName(category),
        category,
        permissions: [],
      };
    }
    grouped[category].permissions.push(perm);
  }

  // 按风险等级排序每个分类中的权限
  for (const group of Object.values(grouped)) {
    group.permissions.sort((a, b) => b.riskLevel - a.riskLevel);
  }

  return grouped;
});

const selectedCount = computed(() => {
  return Object.values(permissionStates).filter(Boolean).length;
});

const totalCount = computed(() => {
  return permissions.value.length;
});

const hasAnySelected = computed(() => {
  return selectedCount.value > 0;
});

const hasDangerousPermissions = computed(() => {
  return permissions.value.some(
    (p) => p.riskLevel >= 3 && permissionStates[p.permission],
  );
});

const dangerousWarningText = computed(() => {
  const dangerousPerms = permissions.value.filter(
    (p) => p.riskLevel >= 3 && permissionStates[p.permission],
  );
  const names = dangerousPerms.map((p) => p.name).join("、");
  return `您选择了高风险权限：${names}。这些权限可能会修改或删除您的数据，或执行系统命令。请确保您信任此插件。`;
});

// 方法
const getCategoryIcon = (category) => {
  return categoryIcons[category] || SettingOutlined;
};

const getCategoryName = (category) => {
  const names = {
    database: "数据库",
    llm: "AI模型",
    ui: "界面扩展",
    file: "文件系统",
    network: "网络访问",
    system: "系统功能",
    rag: "知识检索",
    storage: "插件存储",
  };
  return names[category] || category;
};

const isCategoryAllSelected = (category) => {
  const group = groupedPermissions.value[category];
  if (!group) {
    return false;
  }
  return group.permissions.every((p) => permissionStates[p.permission]);
};

const toggleCategory = (category) => {
  const group = groupedPermissions.value[category];
  if (!group) {
    return;
  }

  const allSelected = isCategoryAllSelected(category);
  for (const perm of group.permissions) {
    permissionStates[perm.permission] = !allSelected;
  }
};

const selectAll = () => {
  for (const perm of permissions.value) {
    permissionStates[perm.permission] = true;
  }
};

const unselectAll = () => {
  for (const perm of permissions.value) {
    permissionStates[perm.permission] = false;
  }
};

const handleApprove = async () => {
  // 构建权限响应
  const grantedPermissions = {};
  for (const perm of permissions.value) {
    grantedPermissions[perm.permission] = permissionStates[perm.permission];
  }

  try {
    await window.electronAPI.plugin.respondToPermissionRequest(
      requestId.value,
      {
        granted: true,
        permissions: grantedPermissions,
        remember: rememberChoice.value,
      },
    );

    emit("approve", {
      requestId: requestId.value,
      permissions: grantedPermissions,
      remember: rememberChoice.value,
    });

    visible.value = false;
  } catch (error) {
    logger.error("发送权限响应失败:", error);
  }
};

const handleReject = async () => {
  try {
    await window.electronAPI.plugin.respondToPermissionRequest(
      requestId.value,
      {
        granted: false,
        permissions: {},
        remember: rememberChoice.value,
      },
    );

    emit("reject", {
      requestId: requestId.value,
    });

    visible.value = false;
  } catch (error) {
    logger.error("发送权限拒绝响应失败:", error);
  }
};

// 处理权限请求事件
const handlePermissionRequest = (data) => {
  requestId.value = data.requestId;
  pluginInfo.value = data.plugin;
  permissions.value = data.permissions || [];

  // 初始化权限状态（默认全部选中）
  for (const perm of permissions.value) {
    permissionStates[perm.permission] = true;
  }

  visible.value = true;
};

// 生命周期
onMounted(() => {
  // 监听权限请求事件
  if (window.electronAPI && window.electronAPI.plugin) {
    window.electronAPI.plugin.on(
      "plugin:permission-request",
      handlePermissionRequest,
    );
  }
});

onUnmounted(() => {
  // 移除事件监听
  if (window.electronAPI && window.electronAPI.plugin) {
    window.electronAPI.plugin.off(
      "plugin:permission-request",
      handlePermissionRequest,
    );
  }
});

// 暴露方法供外部调用
defineExpose({
  show: handlePermissionRequest,
});
</script>

<style scoped lang="less">
.permission-dialog {
  .dialog-content {
    padding: 0;
  }

  .plugin-header {
    display: flex;
    align-items: flex-start;
    padding: 16px;
    background: linear-gradient(135deg, #f6f8fc 0%, #eef2f7 100%);
    border-radius: 8px;
    margin-bottom: 16px;

    .plugin-icon {
      width: 64px;
      height: 64px;
      background: white;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 16px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .plugin-info {
      flex: 1;

      h2 {
        margin: 0 0 4px 0;
        font-size: 20px;
        font-weight: 600;
      }

      .plugin-meta {
        margin: 0 0 8px 0;
        color: #666;
        font-size: 13px;
      }

      .plugin-description {
        margin: 0;
        color: #888;
        font-size: 13px;
        line-height: 1.5;
      }
    }
  }

  .permissions-container {
    max-height: 350px;
    overflow-y: auto;
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    margin-bottom: 16px;

    .permission-category {
      border-bottom: 1px solid #f0f0f0;

      &:last-child {
        border-bottom: none;
      }

      .category-header {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        background: #fafafa;
        font-weight: 500;

        .category-name {
          flex: 1;
        }

        .category-count {
          color: #999;
          font-size: 12px;
          margin-right: 8px;
        }
      }

      .permission-list {
        .permission-item {
          padding: 12px 16px;
          border-top: 1px solid #f5f5f5;
          transition: background-color 0.2s;

          &:hover {
            background-color: #fafafa;
          }

          &.permission-granted {
            background-color: #f6ffed;
          }

          .permission-content {
            .permission-main {
              display: flex;
              align-items: center;
              margin-bottom: 4px;

              .permission-checkbox {
                flex: 1;

                .permission-name {
                  font-weight: 500;
                }
              }

              .risk-tag {
                margin-left: 8px;
              }
            }

            .permission-description {
              margin: 0;
              padding-left: 24px;
              color: #888;
              font-size: 12px;
            }
          }
        }
      }
    }
  }

  .danger-warning {
    margin-bottom: 16px;
  }

  .remember-choice {
    margin-bottom: 16px;
    padding: 8px 12px;
    background: #fafafa;
    border-radius: 4px;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 16px;
    border-top: 1px solid #f0f0f0;
  }
}
</style>
