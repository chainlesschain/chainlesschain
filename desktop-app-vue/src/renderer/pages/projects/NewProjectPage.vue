<template>
  <div class="new-project-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <a-button type="text" @click="handleBack">
        <ArrowLeftOutlined />
        返回
      </a-button>
      <h1>新建项目</h1>
    </div>

    <!-- 创建方式选择 -->
    <div class="page-content">
      <a-tabs v-model:active-key="activeTab" type="card" size="large">
        <!-- 自定义创建 -->
        <a-tab-pane key="ai" tab="自定义创建">
          <template #tab>
            <span>
              <RobotOutlined />
              自定义创建
            </span>
          </template>
          <AIProjectCreator
            :initial-template="selectedTemplateForCreator"
            @create="handleCreateProject"
          />
        </a-tab-pane>

        <!-- 手动创建 -->
        <a-tab-pane key="manual" tab="手动创建">
          <template #tab>
            <span>
              <FormOutlined />
              手动创建
            </span>
          </template>
          <ManualProjectForm @create="handleCreateProject" />
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 流式创建进度Modal - 已移除，改为在 ProjectDetailPage 的对话框中展示 -->

    <!-- 模板推荐对话框 -->
    <a-modal
      v-model:open="showTemplateRecommendModal"
      title="使用模板快速开始"
      :width="500"
      :footer="null"
      :closable="false"
    >
      <div class="template-recommend-content">
        <div class="recommend-icon">
          <FileTextOutlined style="font-size: 48px; color: #1890ff" />
        </div>
        <h3>是否要基于模板创建项目？</h3>
        <p>
          我们提供了丰富的项目模板，可以帮助您快速开始。模板包含预设的需求描述、推荐的技能和工具，让创建过程更加高效。
        </p>
        <div class="recommend-features">
          <div class="feature-item">
            <CheckCircleOutlined style="color: #52c41a" />
            <span>预设的项目需求描述</span>
          </div>
          <div class="feature-item">
            <CheckCircleOutlined style="color: #52c41a" />
            <span>推荐的技能和工具配置</span>
          </div>
          <div class="feature-item">
            <CheckCircleOutlined style="color: #52c41a" />
            <span>可自定义修改内容</span>
          </div>
        </div>
        <div class="recommend-actions">
          <a-button size="large" @click="handleTemplateRecommendDecline">
            跳过，手动创建
          </a-button>
          <a-button
            type="primary"
            size="large"
            @click="handleTemplateRecommendAccept"
          >
            <FileTextOutlined />
            浏览模板
          </a-button>
        </div>
      </div>
    </a-modal>

    <!-- 模板选择对话框 -->
    <TemplateSelectionModal
      :open="showTemplateSelectorModal"
      @confirm="handleTemplateSelect"
      @cancel="handleTemplateSelectorCancel"
    />
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { useProjectStore } from "@/stores/project";
import { useAuthStore } from "@/stores/auth";
import {
  ArrowLeftOutlined,
  RobotOutlined,
  FileTextOutlined,
  FormOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons-vue";
import AIProjectCreator from "@/components/projects/AIProjectCreator.vue";
import ManualProjectForm from "@/components/projects/ManualProjectForm.vue";
import TemplateSelectionModal from "@/components/projects/TemplateSelectionModal.vue";

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();

// 响应式状态
const activeTab = ref("ai");
const showTemplateRecommendModal = ref(false);
const showTemplateSelectorModal = ref(false);
const hasShownTemplateRecommend = ref(false);
const selectedTemplateForCreator = ref(null); // 传递给 AIProjectCreator 的模板

// 返回项目列表
const handleBack = () => {
  router.push("/projects");
};

// 处理创建项目（直接跳转到 ai-creating 模式，在 ProjectDetailPage 的对话框中展示创建过程）
const handleCreateProject = async (createData) => {
  await startCreateProcess(createData);
};

// 处理模板选择（第一次，从模板推荐对话框）
const handleTemplateSelect = async (template) => {
  // 构建创建数据，避免 undefined 值
  const createData = {
    userPrompt: `使用${template.name}模板创建项目${template.description ? "：" + template.description : ""}`, // 后端必填
    name: `基于${template.name}的新项目`,
    projectType: template.project_type || "general",
    userId: authStore.currentUser?.id || "default-user",
  };

  // 只有当 templateId 存在时才添加
  if (template.id) {
    createData.templateId = template.id;
  }

  await startCreateProcess(createData);
};

// 开始创建流程 - 跳转到 ai-creating 模式，在 ProjectDetailPage 的对话框中展示创建过程
const startCreateProcess = async (createData) => {
  try {
    // 跳转到特殊的 "ai-creating" 路由
    // ProjectDetailPage 会检测到 ai-creating 模式，并在 ChatPanel 中展示创建过程
    router.push({
      path: `/projects/ai-creating`,
      query: {
        createData: JSON.stringify(createData),
      },
    });
  } catch (error) {
    logger.error("Start create process failed:", error);
    message.error("启动创建流程失败：" + error.message);
  }
};

// 处理模板推荐
const handleTemplateRecommendAccept = () => {
  showTemplateRecommendModal.value = false;
  showTemplateSelectorModal.value = true;
};

const handleTemplateRecommendDecline = () => {
  showTemplateRecommendModal.value = false;
};

const handleTemplateSelectFromModal = async (template) => {
  showTemplateSelectorModal.value = false;
  // 将模板信息传递给 AIProjectCreator
  selectedTemplateForCreator.value = template;
  message.success(`已选择模板：${template.display_name || template.name}`);
  // 切换到 AI 创建标签页
  activeTab.value = "ai";
};

const handleTemplateSelectorCancel = () => {
  showTemplateSelectorModal.value = false;
};

// 检查是否应该显示模板推荐
const checkTemplateRecommend = () => {
  // 如果是首次访问（可以通过 localStorage 或 session 检查）
  let hasVisited = false;
  try {
    hasVisited = localStorage.getItem("hasVisitedNewProject");
  } catch (error) {
    logger.warn("[NewProject] 读取访问记录失败:", error.message);
  }
  if (!hasVisited && !hasShownTemplateRecommend.value) {
    setTimeout(() => {
      showTemplateRecommendModal.value = true;
      hasShownTemplateRecommend.value = true;
    }, 500);
    try {
      localStorage.setItem("hasVisitedNewProject", "true");
    } catch (error) {
      logger.warn("[NewProject] 保存访问记录失败:", error.message);
    }
  }
};

// 组件挂载时检查模板推荐
onMounted(() => {
  checkTemplateRecommend();
});
</script>

<style scoped>
.new-project-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-header {
  background: white;
  border-radius: 8px;
  padding: 16px 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: #1f2937;
}

.page-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  min-height: 600px;
}

/* Tabs样式 */
.page-content :deep(.ant-tabs-nav) {
  margin-bottom: 32px;
}

.page-content :deep(.ant-tabs-tab) {
  padding: 12px 24px;
  font-size: 16px;
}

.page-content :deep(.ant-tabs-tab .anticon) {
  margin-right: 8px;
  font-size: 18px;
}

/* 进度Modal */
.progress-content {
  padding: 24px 0;
}

.progress-text {
  text-align: center;
  margin-top: 16px;
  font-size: 16px;
  color: #374151;
  font-weight: 500;
}

.error-message {
  margin-top: 24px;
  padding: 12px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-message :deep(.anticon) {
  font-size: 18px;
}

.success-actions,
.error-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
  gap: 12px;
}

/* 模板推荐对话框 */
.template-recommend-content {
  text-align: center;
  padding: 24px 0;
}

.recommend-icon {
  margin-bottom: 24px;
}

.template-recommend-content h3 {
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 16px 0;
}

.template-recommend-content p {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
  margin-bottom: 24px;
}

.recommend-features {
  background: #f9fafb;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  text-align: left;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 14px;
  color: #374151;
}

.feature-item:last-child {
  margin-bottom: 0;
}

.feature-item .anticon {
  font-size: 18px;
}

.recommend-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.recommend-actions .ant-btn {
  min-width: 140px;
}
</style>
