<template>
  <div class="home-page">
    <!-- 项目历史侧边栏 -->
    <ProjectSidebar />

    <!-- 主内容区 -->
    <div class="home-main-content">
      <!-- 欢迎横幅 -->
      <div class="welcome-banner">
        <div class="banner-content">
          <div class="banner-text">
            <h1>欢迎使用 ChainlessChain</h1>
            <p>您的去中心化个人AI知识管理平台</p>
          </div>
          <div class="banner-stats">
            <div class="stat-item">
              <div class="stat-value">
                {{ store.knowledgeItems.length }}
              </div>
              <div class="stat-label">知识条目</div>
            </div>
            <div class="stat-divider" />
            <div class="stat-item">
              <div class="stat-value">
                {{ todayCount }}
              </div>
              <div class="stat-label">今日新增</div>
            </div>
            <div class="stat-divider" />
            <div class="stat-item">
              <div class="stat-value">
                <a-badge status="success" />
              </div>
              <div class="stat-label">同步状态</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 第一行：项目类型按钮 -->
      <div class="project-type-buttons">
        <a-button
          v-for="type in projectTypes"
          :key="type.key"
          :type="selectedType === type.key ? 'primary' : 'default'"
          class="task-quick-button"
          size="large"
          @click="handleTypeQuickSelect(type.key)"
        >
          <span class="button-label">{{ type.label }}</span>
        </a-button>
      </div>

      <!-- 第二行：动态子分类按钮 -->
      <div class="category-buttons-section">
        <a-button
          v-for="category in currentCategories"
          :key="category.key"
          :type="activeCategory === category.key ? 'primary' : 'default'"
          class="category-button"
          @click="handleCategoryChange(category.key)"
        >
          {{ category.label }}
        </a-button>
      </div>

      <!-- 模板展示区域 -->
      <div class="templates-grid-section">
        <TemplateGallery
          :category="selectedType"
          :subcategory="activeCategory !== 'all' ? activeCategory : null"
          @template-use="handleTemplateUse"
          @create-custom="handleCreateCustom"
        />
      </div>

      <!-- 模板变量填写对话框 -->
      <TemplateVariableModal
        v-model:open="showTemplateModal"
        :template="selectedTemplate"
        @success="handleTemplateSuccess"
        @cancel="showTemplateModal = false"
      />

      <!-- 交互式任务规划对话框 -->
      <InteractivePlanningDialog />

      <!-- 系统状态 -->
      <div class="system-status">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :md="12">
            <LLMStatus @open-settings="openSettings('llm')" />
          </a-col>
          <a-col :xs="24" :md="12">
            <GitStatus @open-settings="openSettings('git')" />
          </a-col>
        </a-row>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useAuthStore } from "../stores/auth";
import { usePlanningStore } from "../stores/planning";
import LLMStatus from "../components/LLMStatus.vue";
import GitStatus from "../components/GitStatus.vue";
import ProjectSidebar from "../components/ProjectSidebar.vue";
import TemplateGallery from "../components/templates/TemplateGallery.vue";
import TemplateVariableModal from "../components/templates/TemplateVariableModal.vue";
import InteractivePlanningDialog from "../components/planning/InteractivePlanningDialog.vue";

const router = useRouter();
const store = useAppStore();
const authStore = useAuthStore();
const planningStore = usePlanningStore();

// 状态
const selectedType = ref("");
const activeCategory = ref("all");
const showTemplateModal = ref(false);
const selectedTemplate = ref(null);

// 项目类型按钮（第一行）
const projectTypes = ref([
  { key: "writing", label: "写作", prompt: "帮我写一篇关于...的文章" },
  { key: "marketing", label: "营销", prompt: "制定一份...的营销方案" },
  { key: "excel", label: "Excel", prompt: "分析...的数据并生成报表" },
  { key: "resume", label: "简历", prompt: "制作一份专业简历" },
  { key: "ppt", label: "PPT", prompt: "制作一份关于...的演示文稿" },
  { key: "research", label: "研究", prompt: "进行...的研究分析" },
  { key: "education", label: "教育", prompt: "设计一门...的课程" },
  { key: "lifestyle", label: "生活", prompt: "规划...的生活计划" },
  { key: "podcast", label: "播客", prompt: "为...生成播客脚本" },
  { key: "design", label: "设计", prompt: "设计一个...的海报/Logo" },
  { key: "web", label: "网页", prompt: "创建一个...的网站" },
]);

// 子分类配置（第二行，根据项目类型动态变化）
const categoryConfig = ref({
  // 默认分类（未选择项目类型时）
  all: [
    { key: "all", label: "全部模板" },
    { key: "office", label: "办公文档" },
    { key: "business", label: "商业" },
    { key: "tech", label: "技术" },
    { key: "event", label: "活动" },
    { key: "finance", label: "财务" },
    { key: "analysis", label: "分析" },
    { key: "职位", label: "求职" },
  ],
  // 写作子分类
  writing: [
    { key: "all", label: "全部" },
    { key: "office", label: "办公写作" },
    { key: "business", label: "商业计划" },
    { key: "tech", label: "技术文档" },
  ],
  // 营销子分类
  marketing: [
    { key: "all", label: "全部" },
    { key: "event", label: "活动策划" },
    { key: "content", label: "内容营销" },
  ],
  // PPT子分类
  ppt: [
    { key: "all", label: "全部" },
    { key: "business", label: "商业路演" },
    { key: "training", label: "培训课件" },
  ],
  // 设计子分类
  design: [
    { key: "all", label: "全部" },
    { key: "poster", label: "海报设计" },
  ],
  // Excel子分类
  excel: [
    { key: "all", label: "全部" },
    { key: "finance", label: "财务预算" },
    { key: "analysis", label: "数据分析" },
  ],
  // 简历子分类
  resume: [
    { key: "all", label: "全部" },
    { key: "职位", label: "产品经理" },
    { key: "职位", label: "设计师" },
    { key: "职位", label: "技术岗位" },
  ],
  // 研究子分类
  research: [
    { key: "all", label: "全部" },
    { key: "user", label: "用户研究" },
    { key: "market", label: "竞品分析" },
  ],
  // 教育子分类
  education: [
    { key: "all", label: "全部" },
    { key: "course", label: "在线课程" },
  ],
  // 生活子分类
  lifestyle: [
    { key: "all", label: "全部" },
    { key: "travel", label: "旅游攻略" },
    { key: "wellness", label: "健康计划" },
  ],
  // 播客子分类
  podcast: [
    { key: "all", label: "全部" },
    { key: "interview", label: "访谈节目" },
    { key: "storytelling", label: "故事讲述" },
  ],
  // 网页子分类
  web: [
    { key: "all", label: "全部" },
    { key: "landing", label: "落地页" },
  ],
});

// 当前显示的子分类
const currentCategories = computed(() => {
  if (selectedType.value && categoryConfig.value[selectedType.value]) {
    return categoryConfig.value[selectedType.value];
  }
  return categoryConfig.value.all;
});

// 今日新增数量
const todayCount = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  return store.knowledgeItems.filter(
    (item) => item.created_at >= todayTimestamp,
  ).length;
});

// 处理类型快捷选择
const handleTypeQuickSelect = (typeKey) => {
  // 切换选择状态
  if (selectedType.value === typeKey) {
    // 如果点击已选中的类型，则取消选择，回到默认状态
    selectedType.value = "";
    activeCategory.value = "all";
  } else {
    // 选择新类型
    selectedType.value = typeKey;
    // 重置子分类为该类型的第一个子分类
    const categories = categoryConfig.value[typeKey];
    if (categories && categories.length > 0) {
      activeCategory.value = categories[0].key;
    }
  }
};

// 处理类别切换
const handleCategoryChange = (category) => {
  activeCategory.value = category;
};

// 处理模板使用
const handleTemplateUse = (template) => {
  logger.info("[HomePage] 使用模板:", template);

  // 使用交互式规划模式
  const userRequest =
    template.description || `使用${template.name}模板创建项目`;
  const projectContext = {
    templateId: template.id,
    templateName: template.name,
    category: template.category,
    type: selectedType.value || "document",
  };

  // 打开交互式规划对话框
  planningStore.openPlanDialog(userRequest, projectContext);
};

// 处理模板创建成功
const handleTemplateSuccess = (result) => {
  logger.info("[HomePage] 项目创建成功:", result);
  // 跳转到项目详情页
  if (result.projectId) {
    router.push(`/projects/${result.projectId}`);
  }
};

// 处理创建自定义项目
const handleCreateCustom = () => {
  router.push("/projects/new");
};

const openTab = (key, path, title) => {
  store.addTab({ key, path, title });
  router.push(path);
};

const openSettings = (tab) => {
  const key = `${tab}-settings`;
  store.addTab({ key, path: "/settings", title: `${tab.toUpperCase()}配置` });
  router.push({ path: "/settings", query: { tab } });
};
</script>

<style scoped>
.home-page {
  display: flex;
  min-height: 100%;
  padding: 0;
  margin: -24px; /* 抵消 layout-content 的 padding */
  height: calc(100vh - 56px - 40px); /* 减去 header 和 tabs-bar 的高度 */
  overflow: hidden;
}

.home-main-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: #f5f5f5;
}

.home-main-content::-webkit-scrollbar {
  width: 6px;
}

.home-main-content::-webkit-scrollbar-track {
  background: transparent;
}

.home-main-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

.home-main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

/* 欢迎横幅 */
.welcome-banner {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 32px;
  margin-bottom: 24px;
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.banner-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 24px;
}

.banner-text h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 600;
  color: white;
}

.banner-text p {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
}

.banner-stats {
  display: flex;
  gap: 24px;
  align-items: center;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 12px;
  opacity: 0.8;
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.3);
}

/* 第一行：项目类型按钮 */
.project-type-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  justify-content: center;

  .task-quick-button {
    border-radius: 20px;
    padding: 10px 28px;
    height: auto;
    font-size: 15px;
    border-color: #e5e7eb;
    color: #666666;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.3s;
    background: #ffffff;

    .button-label {
      font-weight: 500;
    }

    &:hover {
      border-color: #667eea;
      color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }

    &.ant-btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
      color: white;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);

      &:hover {
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
      }
    }
  }
}

/* 第二行：子分类按钮 */
.category-buttons-section {
  display: flex;
  gap: 12px;
  margin-bottom: 40px;
  flex-wrap: wrap;
  justify-content: center;

  .category-button {
    border-radius: 16px;
    padding: 8px 20px;
    height: auto;
    font-size: 14px;
    border-color: #e5e7eb;
    color: #666666;
    transition: all 0.3s;
    background: #f5f5f5;

    &:hover {
      border-color: #667eea;
      color: #667eea;
      background: #f0f5ff;
    }

    &.ant-btn-primary {
      background: #667eea;
      border-color: #667eea;
      color: white;

      &:hover {
        background: #764ba2;
        border-color: #764ba2;
      }
    }
  }
}

/* 模板展示区域 */
.templates-grid-section {
  margin: 40px 0;
  min-height: 400px;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 24px;
  margin-bottom: 40px;
}

.template-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    border-color: #667eea;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
    transform: translateY(-4px);

    .template-preview img {
      transform: scale(1.05);
    }
  }

  .template-preview {
    width: 100%;
    height: 180px;
    background: #f5f5f5;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s;
    }

    .template-placeholder {
      font-size: 64px;
      color: #d1d5db;
    }
  }

  .template-info {
    padding: 16px;
  }

  .template-name {
    font-size: 15px;
    font-weight: 600;
    color: #333333;
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .template-desc {
    font-size: 13px;
    color: #666666;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

.empty-templates {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  color: #9ca3af;

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  h3 {
    font-size: 18px;
    font-weight: 500;
    color: #6b7280;
    margin: 0 0 8px 0;
  }

  p {
    font-size: 14px;
    color: #9ca3af;
    margin: 0;
  }
}

/* 系统状态 */
.system-status {
  margin-bottom: 24px;
}

/* 响应式 */
@media (max-width: 768px) {
  .welcome-banner {
    padding: 24px 20px;
  }

  .banner-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .banner-text h1 {
    font-size: 24px;
  }

  .module-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .stat-value {
    font-size: 24px;
  }
}
</style>
