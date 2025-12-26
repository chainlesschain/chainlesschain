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
            <div class="stat-value">{{ store.knowledgeItems.length }}</div>
            <div class="stat-label">知识条目</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-value">{{ todayCount }}</div>
            <div class="stat-label">今日新增</div>
          </div>
          <div class="stat-divider"></div>
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
      <a-spin :spinning="loadingTemplates">
        <div v-if="templates.length > 0" class="templates-grid">
          <div
            v-for="template in templates"
            :key="template.id"
            class="template-card"
            @click="handleTemplateClick(template)"
          >
            <div class="template-preview">
              <img v-if="template.preview" :src="template.preview" :alt="template.name" />
              <div v-else class="template-placeholder">{{ template.icon || '📄' }}</div>
            </div>
            <div class="template-info">
              <div class="template-name">{{ template.name }}</div>
              <div class="template-desc">{{ template.description }}</div>
            </div>
          </div>
        </div>
        <div v-else class="empty-templates">
          <div class="empty-icon">
            <FileTextOutlined />
          </div>
          <h3>暂无模板</h3>
          <p>该分类下暂时没有可用的模板</p>
        </div>
      </a-spin>
    </div>

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
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import LLMStatus from '../components/LLMStatus.vue';
import GitStatus from '../components/GitStatus.vue';
import ProjectSidebar from '../components/ProjectSidebar.vue';

const router = useRouter();
const store = useAppStore();
const authStore = useAuthStore();

// 状态
const selectedType = ref('');
const activeCategory = ref('all');
const templates = ref([]);
const loadingTemplates = ref(false);

// 项目类型按钮（第一行）
const projectTypes = ref([
  { key: 'write', label: '写作', prompt: '帮我写一篇关于...的文章' },
  { key: 'ppt', label: 'PPT', prompt: '制作一份关于...的演示文稿' },
  { key: 'design', label: '设计', prompt: '设计一个...的海报/Logo' },
  { key: 'excel', label: 'Excel', prompt: '分析...的数据并生成报表' },
  { key: 'web', label: '网页', prompt: '创建一个...的网站' },
  { key: 'podcast', label: '播客', prompt: '为...生成播客脚本' },
  { key: 'image', label: '图像', prompt: '生成一张...的图片' },
]);

// 子分类配置（第二行，根据项目类型动态变化）
const categoryConfig = ref({
  // 默认分类（未选择项目类型时）
  all: [
    { key: 'all', label: '探索' },
    { key: 'portrait', label: '人像摄影' },
    { key: 'education', label: '教育学习' },
    { key: 'finance', label: '财经分析' },
    { key: 'creative', label: '创意设计' },
    { key: 'life', label: '生活娱乐' },
    { key: 'marketing', label: '市场营销' },
    { key: 'travel', label: '旅游攻略' },
  ],
  // 写作子分类
  write: [
    { key: 'media', label: '自媒体创作' },
    { key: 'market-research', label: '市场调研' },
    { key: 'teaching', label: '教学设计' },
    { key: 'study', label: '学习研究' },
    { key: 'office', label: '办公写作' },
    { key: 'marketing-plan', label: '营销策划' },
    { key: 'resume', label: '简历制作' },
  ],
  // PPT子分类
  ppt: [
    { key: 'featured', label: '精选模板' },
    { key: 'persuasion', label: '说服案例' },
    { key: 'work-report', label: '工作汇报' },
    { key: 'promotion', label: '宣传推广' },
    { key: 'education', label: '教育学习' },
    { key: 'daily', label: '生活日常' },
  ],
  // 设计子分类
  design: [
    { key: 'logo', label: 'Logo设计' },
    { key: 'poster', label: '海报设计' },
    { key: 'banner', label: '横幅设计' },
    { key: 'card', label: '名片设计' },
    { key: 'social', label: '社交媒体' },
  ],
  // Excel子分类
  excel: [
    { key: 'data-analysis', label: '数据分析' },
    { key: 'financial', label: '财务报表' },
    { key: 'project-manage', label: '项目管理' },
    { key: 'schedule', label: '进度安排' },
  ],
  // 网页子分类
  web: [
    { key: 'landing', label: '落地页' },
    { key: 'portfolio', label: '作品集' },
    { key: 'blog', label: '博客' },
    { key: 'ecommerce', label: '电商' },
  ],
  // 播客子分类
  podcast: [
    { key: 'interview', label: '访谈节目' },
    { key: 'storytelling', label: '故事讲述' },
    { key: 'education', label: '教育内容' },
    { key: 'news', label: '新闻评论' },
  ],
  // 图像子分类
  image: [
    { key: 'portrait', label: '人像' },
    { key: 'landscape', label: '风景' },
    { key: 'product', label: '产品' },
    { key: 'abstract', label: '抽象艺术' },
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
    (item) => item.created_at >= todayTimestamp
  ).length;
});

// 加载模板
const loadTemplates = async () => {
  loadingTemplates.value = true;
  try {
    // 构建查询参数
    const params = {
      type: selectedType.value || null,
      category: activeCategory.value !== 'all' ? activeCategory.value : null,
    };

    // TODO: 调用后端API加载模板
    // const result = await window.electronAPI.template.list(params);
    // templates.value = result;

    // 临时：使用示例数据
    console.log('[HomePage] 加载模板:', params);
    templates.value = [];
  } catch (error) {
    console.error('加载模板失败:', error);
    message.error('加载模板失败');
  } finally {
    loadingTemplates.value = false;
  }
};

// 处理类型快捷选择
const handleTypeQuickSelect = (typeKey) => {
  // 切换选择状态
  if (selectedType.value === typeKey) {
    // 如果点击已选中的类型，则取消选择，回到默认状态
    selectedType.value = '';
    activeCategory.value = 'all';
  } else {
    // 选择新类型
    selectedType.value = typeKey;
    // 重置子分类为该类型的第一个子分类
    const categories = categoryConfig.value[typeKey];
    if (categories && categories.length > 0) {
      activeCategory.value = categories[0].key;
    }
  }
  // 加载对应的模板
  loadTemplates();
};

// 处理类别切换
const handleCategoryChange = (category) => {
  activeCategory.value = category;
  // 加载对应的模板
  loadTemplates();
};

// 处理模板点击
const handleTemplateClick = async (template) => {
  try {
    message.loading({ content: '正在使用模板创建项目...', key: 'create-from-template', duration: 0 });

    // 使用模板创建项目
    const userId = authStore.currentUser?.id || 'default-user';
    const projectData = {
      name: template.name,
      description: template.description,
      projectType: selectedType.value || template.type,
      category: activeCategory.value,
      templateId: template.id,
      userId: userId,
    };

    // TODO: 调用后端API使用模板创建项目
    // const project = await window.electronAPI.project.createFromTemplate(template.id, projectData);

    message.success({ content: '项目创建成功！', key: 'create-from-template', duration: 2 });

    // 跳转到项目详情页
    // router.push(`/projects/${project.id}`);
  } catch (error) {
    console.error('使用模板创建项目失败:', error);
    message.error({ content: '创建失败：' + error.message, key: 'create-from-template', duration: 3 });
  }
};

const openTab = (key, path, title) => {
  store.addTab({ key, path, title });
  router.push(path);
};

const openSettings = (tab) => {
  const key = `${tab}-settings`;
  store.addTab({ key, path: '/settings', title: `${tab.toUpperCase()}配置` });
  router.push({ path: '/settings', query: { tab } });
};

// 组件挂载时加载模板
onMounted(async () => {
  await loadTemplates();
});
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
    border-color: #E5E7EB;
    color: #666666;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.3s;
    background: #FFFFFF;

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
    border-color: #E5E7EB;
    color: #666666;
    transition: all 0.3s;
    background: #F5F5F5;

    &:hover {
      border-color: #667eea;
      color: #667eea;
      background: #F0F5FF;
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
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
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
    background: #F5F5F5;
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
      color: #D1D5DB;
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
  color: #9CA3AF;

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  h3 {
    font-size: 18px;
    font-weight: 500;
    color: #6B7280;
    margin: 0 0 8px 0;
  }

  p {
    font-size: 14px;
    color: #9CA3AF;
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
