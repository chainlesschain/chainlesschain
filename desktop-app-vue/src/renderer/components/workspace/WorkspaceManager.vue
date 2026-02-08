<template>
  <div class="workspace-manager">
    <!-- 页面头部 -->
    <div class="manager-header">
      <h2><apartment-outlined /> 工作区管理</h2>
      <a-button type="primary" @click="showCreateDialog">
        <plus-outlined /> 创建工作区
      </a-button>
    </div>

    <!-- 统计卡片 -->
    <a-row :gutter="[16, 16]" class="stats-cards">
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="总工作区"
            :value="workspaceStore.workspaces.length"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="活跃工作区"
            :value="workspaceStore.activeWorkspaces.length"
            suffix="个"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="归档工作区"
            :value="workspaceStore.archivedWorkspaces.length"
            suffix="个"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="当前工作区"
            :value="workspaceStore.currentWorkspace?.name || '未选择'"
            value-style="{ fontSize: '18px' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- 工作区列表 -->
    <a-card
      title="工作区列表"
      class="workspace-list-card"
      :body-style="{ padding: 0 }"
    >
      <template #extra>
        <a-space>
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索工作区..."
            style="width: 200px"
          />
          <a-radio-group v-model:value="filterType" button-style="solid">
            <a-radio-button value="all"> 全部 </a-radio-button>
            <a-radio-button value="active"> 活跃 </a-radio-button>
            <a-radio-button value="archived"> 归档 </a-radio-button>
          </a-radio-group>
        </a-space>
      </template>

      <a-table
        :columns="columns"
        :data-source="filteredWorkspaces"
        :loading="workspaceStore.loading"
        :pagination="{ pageSize: 10 }"
        row-key="id"
      >
        <!-- 工作区名称列 -->
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div class="workspace-name-cell">
              <a-avatar
                :size="32"
                :style="{ backgroundColor: record.color || '#1890ff' }"
              >
                <component :is="getWorkspaceIcon(record.type)" />
              </a-avatar>
              <div class="name-info">
                <div class="name-text">
                  {{ record.name }}
                  <a-tag v-if="record.is_default" color="blue" size="small">
                    默认
                  </a-tag>
                </div>
                <div v-if="record.description" class="desc-text">
                  {{ record.description }}
                </div>
              </div>
            </div>
          </template>

          <!-- 类型列 -->
          <template v-else-if="column.key === 'type'">
            <a-tag :color="getTypeColor(record.type)">
              {{ getTypeLabel(record.type) }}
            </a-tag>
          </template>

          <!-- 状态列 -->
          <template v-else-if="column.key === 'status'">
            <a-badge
              :status="record.archived ? 'default' : 'success'"
              :text="record.archived ? '归档' : '活跃'"
            />
          </template>

          <!-- 创建时间列 -->
          <template v-else-if="column.key === 'created_at'">
            {{ formatDate(record.created_at) }}
          </template>

          <!-- 操作列 -->
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button type="link" size="small" @click="handleView(record)">
                查看
              </a-button>
              <a-button type="link" size="small" @click="handleEdit(record)">
                编辑
              </a-button>
              <a-dropdown>
                <a-button type="link" size="small">
                  更多 <down-outlined />
                </a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item
                      v-if="!record.archived"
                      @click="handleArchive(record)"
                    >
                      归档
                    </a-menu-item>
                    <a-menu-item v-else @click="handleRestore(record)">
                      恢复
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item danger @click="handleDelete(record)">
                      删除
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 工作区详情抽屉 -->
    <a-drawer v-model:open="detailDrawerVisible" title="工作区详情" width="600">
      <div v-if="selectedWorkspace" class="workspace-detail">
        <a-descriptions :column="1" bordered>
          <a-descriptions-item label="名称">
            {{ selectedWorkspace.name }}
          </a-descriptions-item>
          <a-descriptions-item label="描述">
            {{ selectedWorkspace.description || "无" }}
          </a-descriptions-item>
          <a-descriptions-item label="类型">
            <a-tag :color="getTypeColor(selectedWorkspace.type)">
              {{ getTypeLabel(selectedWorkspace.type) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-badge
              :status="selectedWorkspace.archived ? 'default' : 'success'"
              :text="selectedWorkspace.archived ? '归档' : '活跃'"
            />
          </a-descriptions-item>
          <a-descriptions-item label="创建者">
            {{ selectedWorkspace.created_by }}
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDate(selectedWorkspace.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatDate(selectedWorkspace.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider />

        <h4>成员管理</h4>
        <a-list
          :data-source="workspaceStore.currentWorkspaceMembers"
          :loading="workspaceStore.loading"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <template #actions>
                <a-button type="link" size="small" danger> 移除 </a-button>
              </template>
              <a-list-item-meta>
                <template #avatar>
                  <a-avatar>{{ item.name?.substring(0, 2) }}</a-avatar>
                </template>
                <template #title>
                  {{ item.name }}
                </template>
                <template #description>
                  {{ item.role }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <a-button block style="margin-top: 16px" @click="handleAddMember">
          <plus-outlined /> 添加成员
        </a-button>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, h } from "vue";
import { Modal, message } from "ant-design-vue";
import {
  ApartmentOutlined,
  PlusOutlined,
  DownOutlined,
  CodeOutlined,
  ExperimentOutlined,
  RocketOutlined,
} from "@ant-design/icons-vue";
import { useWorkspaceStore } from "../../stores/workspace";

// Stores
const workspaceStore = useWorkspaceStore();

// State
const searchKeyword = ref("");
const filterType = ref("all");
const detailDrawerVisible = ref(false);
const selectedWorkspace = ref(null);

// Table columns
const columns = [
  {
    title: "工作区名称",
    key: "name",
    dataIndex: "name",
    width: "30%",
  },
  {
    title: "类型",
    key: "type",
    dataIndex: "type",
    width: "15%",
  },
  {
    title: "状态",
    key: "status",
    dataIndex: "archived",
    width: "10%",
  },
  {
    title: "创建时间",
    key: "created_at",
    dataIndex: "created_at",
    width: "20%",
  },
  {
    title: "操作",
    key: "actions",
    width: "25%",
  },
];

// Computed
const filteredWorkspaces = computed(() => {
  let list = workspaceStore.workspaces;

  // Filter by status
  if (filterType.value === "active") {
    list = list.filter((w) => !w.archived);
  } else if (filterType.value === "archived") {
    list = list.filter((w) => w.archived);
  }

  // Filter by search keyword
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    list = list.filter(
      (w) =>
        w.name.toLowerCase().includes(keyword) ||
        w.description?.toLowerCase().includes(keyword),
    );
  }

  return list;
});

// Methods
function getWorkspaceIcon(type) {
  const icons = {
    default: ApartmentOutlined,
    development: CodeOutlined,
    testing: ExperimentOutlined,
    production: RocketOutlined,
  };
  return icons[type] || ApartmentOutlined;
}

function getTypeColor(type) {
  const colors = {
    default: "blue",
    development: "green",
    testing: "orange",
    production: "red",
  };
  return colors[type] || "blue";
}

function getTypeLabel(type) {
  const labels = {
    default: "默认",
    development: "开发",
    testing: "测试",
    production: "生产",
  };
  return labels[type] || type;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN");
}

function showCreateDialog() {
  workspaceStore.createDialogVisible = true;
}

function handleView(workspace) {
  selectedWorkspace.value = workspace;
  detailDrawerVisible.value = true;
  workspaceStore.selectWorkspace(workspace.id);
}

function handleEdit(workspace) {
  // Set the workspace to edit and show the create dialog (which can also edit)
  workspaceStore.editingWorkspace = workspace;
  workspaceStore.createDialogVisible = true;
}

function handleArchive(workspace) {
  Modal.confirm({
    title: "确认归档",
    content: `确定要归档工作区"${workspace.name}"吗？`,
    okText: "归档",
    cancelText: "取消",
    onOk: async () => {
      await workspaceStore.deleteWorkspace(workspace.id);
    },
  });
}

async function handleRestore(workspace) {
  Modal.confirm({
    title: "确认恢复",
    content: `确定要恢复工作区"${workspace.name}"吗？`,
    okText: "恢复",
    cancelText: "取消",
    onOk: async () => {
      try {
        const result = await window.electronAPI.invoke(
          "organization:workspace:restore",
          {
            workspaceId: workspace.id,
          },
        );

        if (result.success) {
          message.success("工作区已恢复");
          await workspaceStore.loadWorkspaces();
        } else {
          message.error(result.error || "恢复工作区失败");
        }
      } catch (error) {
        logger.error("恢复工作区失败:", error);
        message.error("恢复工作区失败");
      }
    },
  });
}

async function handleDelete(workspace) {
  Modal.confirm({
    title: "确认删除",
    content: `确定要永久删除工作区"${workspace.name}"吗？此操作不可撤销！`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        const result = await window.electronAPI.invoke(
          "organization:workspace:permanentDelete",
          {
            workspaceId: workspace.id,
          },
        );

        if (result.success) {
          message.success("工作区已永久删除");
          await workspaceStore.loadWorkspaces();
        } else {
          message.error(result.error || "删除工作区失败");
        }
      } catch (error) {
        logger.error("删除工作区失败:", error);
        message.error("删除工作区失败");
      }
    },
  });
}

function handleAddMember() {
  if (!selectedWorkspace.value) {
    message.warning("请先选择一个工作区");
    return;
  }

  // 显示添加成员对话框
  Modal.confirm({
    title: "添加工作区成员",
    content: h("div", [
      h("p", "请输入成员DID:"),
      h("input", {
        id: "member-did-input",
        type: "text",
        placeholder: "did:example:123456",
        style:
          "width: 100%; padding: 8px; margin: 8px 0; border: 1px solid #d9d9d9; border-radius: 4px;",
      }),
      h("p", { style: "margin-top: 16px;" }, "选择角色:"),
      h(
        "select",
        {
          id: "member-role-select",
          style:
            "width: 100%; padding: 8px; border: 1px solid #d9d9d9; border-radius: 4px;",
        },
        [
          h("option", { value: "member" }, "成员"),
          h("option", { value: "admin" }, "管理员"),
          h("option", { value: "viewer" }, "查看者"),
        ],
      ),
    ]),
    okText: "添加",
    cancelText: "取消",
    onOk: async () => {
      const didInput = document.getElementById("member-did-input");
      const roleSelect = document.getElementById("member-role-select");

      const memberDID = didInput?.value?.trim();
      const role = roleSelect?.value || "member";

      if (!memberDID) {
        message.error("请输入成员DID");
        return Promise.reject();
      }

      if (!memberDID.startsWith("did:")) {
        message.error('DID格式错误，应以 "did:" 开头');
        return Promise.reject();
      }

      try {
        const result = await window.electronAPI.invoke(
          "organization:workspace:addMember",
          {
            workspaceId: selectedWorkspace.value.id,
            memberDID,
            role,
          },
        );

        if (result.success) {
          message.success("成员添加成功");
          // 刷新工作区详情
          await workspaceStore.loadWorkspaces();
        } else {
          message.error(result.error || "添加成员失败");
          return Promise.reject();
        }
      } catch (error) {
        logger.error("添加成员失败:", error);
        message.error("添加成员失败");
        return Promise.reject();
      }
    },
  });
}
</script>

<style scoped lang="less">
.workspace-manager {
  padding: 24px;

  .manager-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .stats-cards {
    margin-bottom: 24px;
  }

  .workspace-list-card {
    .workspace-name-cell {
      display: flex;
      align-items: center;
      gap: 12px;

      .name-info {
        flex: 1;
        min-width: 0;

        .name-text {
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .desc-text {
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

  .workspace-detail {
    h4 {
      margin-top: 24px;
      margin-bottom: 16px;
    }
  }
}
</style>
