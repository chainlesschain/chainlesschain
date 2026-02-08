<template>
  <div class="shared-workspaces-page">
    <a-page-header title="共享工作空间" sub-title="跨组织协作空间管理">
      <template #extra>
        <a-button type="primary" @click="showCreate = true">
          <template #icon>
            <PlusOutlined />
          </template>
          创建工作空间
        </a-button>
      </template>
    </a-page-header>

    <a-spin :spinning="loading">
      <a-row :gutter="16">
        <a-col v-for="workspace in workspaces" :key="workspace.id" :span="8">
          <a-card
            hoverable
            class="workspace-card"
            @click="goToWorkspace(workspace.id)"
          >
            <template #cover>
              <div
                class="workspace-cover"
                :style="{
                  backgroundColor: getWorkspaceColor(workspace.workspaceType),
                }"
              >
                <TeamOutlined class="workspace-icon" />
              </div>
            </template>
            <a-card-meta
              :title="workspace.name"
              :description="workspace.description"
            />
            <div class="workspace-meta">
              <a-space>
                <a-tag>{{ workspace.workspaceType }}</a-tag>
                <a-tag
                  :color="workspace.orgRole === 'admin' ? 'gold' : 'default'"
                >
                  {{ workspace.orgRole }}
                </a-tag>
              </a-space>
              <div class="workspace-stats">
                <span><TeamOutlined /> {{ workspace.orgCount }} 个组织</span>
                <span><UserOutlined /> {{ workspace.memberCount }} 名成员</span>
              </div>
            </div>
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card
            hoverable
            class="workspace-card create-card"
            @click="showCreate = true"
          >
            <div class="create-placeholder">
              <PlusOutlined class="create-icon" />
              <p>创建新工作空间</p>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <!-- 创建工作空间对话框 -->
    <a-modal
      v-model:open="showCreate"
      title="创建共享工作空间"
      :confirm-loading="creating"
      @ok="handleCreate"
    >
      <a-form :model="newWorkspace" layout="vertical">
        <a-form-item label="工作空间名称" required>
          <a-input v-model:value="newWorkspace.name" placeholder="输入名称" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="newWorkspace.description"
            placeholder="工作空间描述"
          />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="newWorkspace.workspaceType">
            <a-select-option value="project"> 项目协作 </a-select-option>
            <a-select-option value="research"> 研究合作 </a-select-option>
            <a-select-option value="data_sharing"> 数据共享 </a-select-option>
            <a-select-option value="general"> 通用 </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="可见性">
          <a-radio-group v-model:value="newWorkspace.visibility">
            <a-radio value="private"> 私有（仅邀请成员可见） </a-radio>
            <a-radio value="partners"> 合作伙伴可见 </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons-vue";
import { useCrossOrgStore } from "@/stores/crossOrg";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const crossOrgStore = useCrossOrgStore();
const authStore = useAuthStore();

const loading = ref(false);
const creating = ref(false);
const showCreate = ref(false);

const workspaces = computed(() => crossOrgStore.workspaces);

const newWorkspace = ref({
  name: "",
  description: "",
  workspaceType: "project",
  visibility: "private",
});

const getWorkspaceColor = (type) => {
  const colors = {
    project: "#1890ff",
    research: "#52c41a",
    data_sharing: "#722ed1",
    general: "#faad14",
  };
  return colors[type] || "#1890ff";
};

const goToWorkspace = (workspaceId) => {
  router.push(`/crossorg/workspace/${workspaceId}`);
};

const handleCreate = async () => {
  if (!newWorkspace.value.name) {
    message.warning("请输入工作空间名称");
    return;
  }

  creating.value = true;
  try {
    const result = await crossOrgStore.createWorkspace({
      ...newWorkspace.value,
      createdByOrgId: authStore.currentOrg?.id,
      createdByOrgName: authStore.currentOrg?.name,
      createdByDid: authStore.currentUser?.did,
      createdByName: authStore.currentUser?.name,
    });

    if (result.success) {
      message.success("工作空间创建成功");
      showCreate.value = false;
      newWorkspace.value = {
        name: "",
        description: "",
        workspaceType: "project",
        visibility: "private",
      };
      goToWorkspace(result.workspaceId);
    }
  } catch (error) {
    message.error("创建失败");
  } finally {
    creating.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await crossOrgStore.loadWorkspaces(authStore.currentOrg?.id);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.shared-workspaces-page {
  padding: 0 24px 24px;
}

.workspace-card {
  margin-bottom: 16px;
}

.workspace-cover {
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.workspace-icon {
  font-size: 40px;
  color: rgba(255, 255, 255, 0.8);
}

.workspace-meta {
  margin-top: 12px;
}

.workspace-stats {
  margin-top: 8px;
  color: #666;
  font-size: 12px;
}

.workspace-stats span {
  margin-right: 16px;
}

.create-card {
  min-height: 250px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.create-placeholder {
  text-align: center;
  color: #999;
}

.create-icon {
  font-size: 40px;
  margin-bottom: 8px;
}
</style>
