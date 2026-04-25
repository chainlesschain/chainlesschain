<template>
  <div class="projects-page-wrapper">
    <!-- 项目历史侧边栏 -->
    <ProjectSidebar />

    <!-- 中央内容区域 -->
    <div class="main-content">
      <!-- 欢迎头部 (总是显示，优化问候语) -->
      <div class="welcome-header">
        <h1 class="welcome-title">
          {{ greetingMessage }}
        </h1>
      </div>

      <!-- 对话输入框 -->
      <div class="conversation-input-section">
        <ConversationInput
          :placeholder="inputPlaceholder"
          @submit="handleConversationalCreate"
          @file-upload="handleFileUpload"
        />
      </div>

      <!-- 🔥 AI对话消息区域（在对话框中展示创建过程） -->
      <div
        v-if="conversationMessages.length > 0"
        class="conversation-messages-area"
      >
        <div
          v-for="(msg, index) in conversationMessages"
          :key="index"
          class="conversation-message"
          :class="[msg.type, msg.status]"
        >
          <!-- 用户消息 -->
          <div v-if="msg.type === 'user'" class="user-message">
            <div class="message-avatar">👤</div>
            <div class="message-content">
              <div class="message-text">
                {{ msg.content }}
              </div>
              <div class="message-time">
                {{ formatTime(msg.timestamp) }}
              </div>
            </div>
          </div>

          <!-- AI消息 -->
          <div v-else-if="msg.type === 'assistant'" class="assistant-message">
            <div class="message-avatar">🤖</div>
            <div class="message-content">
              <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see AUDIT_2026-04-22.md §3 -->
              <div class="message-text" v-html="safeHtml(msg.content)" />
              <!-- eslint-enable vue/no-v-html -->
              <div class="message-time">
                {{ formatTime(msg.timestamp) }}
              </div>
            </div>
          </div>

          <!-- 项目创建进度消息 -->
          <div v-else-if="msg.type === 'progress'" class="progress-message">
            <div class="message-avatar">⚙️</div>
            <div class="message-content">
              <div class="progress-stage">
                <a-tag :color="getStageColor(msg.stage)">
                  {{ msg.stageName }}
                </a-tag>
              </div>
              <div class="progress-text">
                {{ msg.content }}
              </div>
              <div v-if="msg.details" class="progress-details">
                <pre>{{ msg.details }}</pre>
              </div>
            </div>
          </div>

          <!-- 成功消息 -->
          <div v-else-if="msg.type === 'success'" class="success-message">
            <div class="message-avatar">✅</div>
            <div class="message-content">
              <div class="message-text">
                {{ msg.content }}
              </div>
              <div v-if="msg.projectId" class="message-actions">
                <a-button
                  type="primary"
                  size="small"
                  @click="router.push(`/projects/${msg.projectId}`)"
                >
                  查看项目
                </a-button>
              </div>
            </div>
          </div>

          <!-- 错误消息 -->
          <div v-else-if="msg.type === 'error'" class="error-message">
            <div class="message-avatar">❌</div>
            <div class="message-content">
              <div class="message-text">
                {{ msg.content }}
              </div>
              <div v-if="msg.error" class="error-details">
                <pre>{{ msg.error }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- 清空对话按钮 -->
        <div class="conversation-actions">
          <a-button size="small" @click="clearConversation">
            清空对话
          </a-button>
        </div>
      </div>

      <!-- 第一行：项目类型按钮 -->
      <div class="project-type-buttons">
        <a-button
          v-for="type in displayProjectTypes"
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
      <div v-if="!loading" class="templates-grid-section">
        <TemplateGallery
          :category="
            selectedType && selectedType !== 'all' ? selectedType : null
          "
          :subcategory="activeCategory !== 'all' ? activeCategory : null"
          @template-use="handleTemplateUse"
          @create-custom="handleCreateCustom"
        />
      </div>
    </div>

    <!-- 模板变量填写对话框 -->
    <TemplateVariableModal
      v-model:open="showTemplateModal"
      :template="selectedTemplate"
      @start-create="handleTemplateCreateStart"
      @cancel="showTemplateModal = false"
    />

    <!-- 任务执行监控器弹窗 -->
    <a-modal
      v-model:open="showTaskMonitor"
      title="任务执行监控"
      :width="900"
      :footer="null"
      :mask-closable="false"
      :keyboard="!isExecutingTask"
      class="task-monitor-modal"
      @cancel="handleCloseTaskMonitor"
    >
      <TaskExecutionMonitor
        v-if="currentTaskPlan"
        :task-plan="currentTaskPlan"
        @cancel="handleCancelTask"
        @close="handleCloseTaskMonitor"
        @view-results="handleViewTaskResults"
        @retry="handleRetryTask"
        @file-click="handleFileClick"
        @continue-edit="handleContinueEdit"
        @suggestion-click="handleSuggestionClick"
      />
    </a-modal>

    <!-- 流式创建进度Modal - 已移除，改为在对话框中展示 -->
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, nextTick, h } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import { useProjectStore } from "@/stores/project";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";
import { useTemplateStore } from "@/stores/template";
import { safeHtml } from "@/utils/sanitizeHtml";
import { SearchOutlined, FileTextOutlined } from "@ant-design/icons-vue";
import ConversationInput from "@/components/projects/ConversationInput.vue";
import TaskExecutionMonitor from "@/components/projects/TaskExecutionMonitor.vue";
import ProjectSidebar from "@/components/ProjectSidebar.vue";
import TemplateGallery from "@/components/templates/TemplateGallery.vue";
import TemplateVariableModal from "@/components/templates/TemplateVariableModal.vue";
import {
  formatTime,
  getStageColor,
  detectCreateIntent,
} from "./projectsPageUtils";

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();
const appStore = useAppStore();
const templateStore = useTemplateStore();

// 响应式状态
const activeCategory = ref("all");
const selectedType = ref("all");
const currentPage = ref(1);
const pageSize = ref(12);
const activeConversationId = ref("");
const activeNavItem = ref("");
const recentConversations = ref([]);

// 任务执行相关
const currentTaskPlan = ref(null);
const showTaskMonitor = ref(false);
const isExecutingTask = ref(false);

// 创建进度相关（已改为在对话框中展示）
const createError = ref("");
const createdProjectId = ref("");

// 🔥 AI对话消息列表（在对话框中展示创建过程）
const conversationMessages = ref([]);

// 项目类型按钮（第一行）
const projectTypes = ref([
  // 职业专用分类（放在前面优先显示）
  { key: "medical", label: "🏥 医疗", prompt: "协助我处理医疗相关的工作..." },
  { key: "legal", label: "⚖️ 法律", prompt: "协助我处理法律相关的工作..." },
  { key: "education", label: "👨‍🏫 教育", prompt: "设计一门...的课程" },
  { key: "research", label: "🔬 研究", prompt: "进行...的研究分析" },
  // 通用分类
  { key: "writing", label: "写作", prompt: "帮我写一篇关于...的文章" },
  { key: "marketing", label: "营销", prompt: "制定一份...的营销方案" },
  { key: "excel", label: "Excel", prompt: "分析...的数据并生成报表" },
  { key: "resume", label: "简历", prompt: "制作一份专业简历" },
  { key: "ppt", label: "PPT", prompt: "制作一份关于...的演示文稿" },
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
  // 医疗子分类（展示Prompt模板）
  medical: [{ key: "all", label: "全部" }],
  // 法律子分类（展示Prompt模板）
  legal: [{ key: "all", label: "全部" }],
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

const categoryLabelMap = {
  // 职业专用分类
  medical: "🏥 医疗",
  legal: "⚖️ 法律",
  education: "👨‍🏫 教育",
  research: "🔬 研究",

  // 通用分类
  writing: "写作",
  translation: "翻译",
  analysis: "分析",
  qa: "问答",
  creative: "创意",
  programming: "编程",
  rag: "检索增强",
  marketing: "营销",
  excel: "Excel",
  resume: "简历",
  ppt: "PPT",
  lifestyle: "生活",
  podcast: "播客",
  design: "设计",
  web: "网页",

  // 其他分类
  video: "视频",
  "social-media": "社交媒体",
  "creative-writing": "创意写作",
  "code-project": "代码项目",
  "data-science": "数据科学",
  "tech-docs": "技术文档",
  ecommerce: "电商",
  "marketing-pro": "营销推广",
  learning: "学习",
  health: "健康",
  "time-management": "时间管理",
  productivity: "效率",
  career: "职业",
  travel: "旅游",
  cooking: "烹饪",
  finance: "财务",
  gaming: "游戏",
  music: "音乐",
  photography: "摄影",

  // 默认
  all: "全部",
  other: "其他",
  general: "通用",
};

const subcategoryLabelOverrides = {
  // 特殊子分类
  prompt: "提示词模板",

  academic: "学术",
  adventure: "冒险",
  analysis: "分析",
  analytics: "数据分析",
  animation: "动画",
  api: "API文档",
  application: "应用程序",
  architecture: "架构设计",
  automation: "自动化",
  backend: "后端",
  backpacking: "背包游",
  baking: "烘焙",
  bilibili: "哔哩哔哩",
  blogging: "博客写作",
  branding: "品牌建设",
  browser: "浏览器插件",
  budgeting: "预算规划",
  business: "商业",
  collaboration: "协作",
  commercial: "商业广告",
  community: "社区",
  content: "内容",
  contract: "合同",
  "corporate-training": "企业培训",
  course: "课程",
  credit: "信用",
  cultural: "文化",
  debt: "债务",
  design: "设计",
  development: "开发",
  education: "教育类",
  email: "邮件营销",
  enterprise: "企业",
  "entry-level": "入门级",
  esports: "电竞",
  event: "活动",
  executive: "高管",
  experiment: "实验",
  family: "家庭",
  fiction: "小说",
  finance: "财务",
  focus: "专注",
  freelance: "自由职业",
  frontend: "前端",
  graphic: "平面设计",
  growth: "增长策略",
  habits: "习惯",
  health: "健康",
  home: "家居",
  hr: "人力资源",
  interview: "面试",
  investment: "投资",
  ip: "知识产权",
  "job-hunting": "求职",
  landing: "落地页",
  landscape: "风景",
  language: "语言",
  "level-design": "关卡设计",
  livestream: "直播",
  "long-form": "长视频",
  luxury: "豪华",
  lyrics: "歌词",
  "machine-learning": "机器学习",
  management: "管理",
  market: "市场",
  marketing: "营销",
  "meal-prep": "备餐",
  medical: "医疗",
  mental: "心理",
  mobile: "移动端",
  music: "音乐",
  negotiation: "谈判",
  networking: "人脉",
  notebook: "Jupyter笔记本",
  novel: "小说",
  office: "办公",
  "online-learning": "在线学习",
  operations: "运营",
  organization: "组织",
  performance: "性能",
  pets: "宠物",
  photography: "摄影",
  planning: "项目规划",
  poetry: "诗歌",
  portfolio: "作品集",
  portrait: "肖像",
  "post-production": "后期制作",
  pr: "公关",
  practice: "实践",
  prioritization: "优先级",
  product: "产品",
  production: "制作",
  professional: "专业",
  python: "Python开发",
  qa: "测试",
  reading: "阅读",
  recipe: "食谱",
  review: "测评",
  "road-trip": "公路旅行",
  romantic: "浪漫",
  safety: "安全",
  sales: "销售",
  savings: "储蓄",
  screenplay: "剧本",
  "series-planning": "系列规划",
  shooting: "拍摄",
  "short-form": "短视频",
  solo: "独自",
  songwriting: "歌曲创作",
  story: "故事",
  strategy: "策略",
  streaming: "流媒体",
  street: "街头",
  support: "支持",
  survey: "调研",
  systems: "系统",
  tax: "税务",
  teaching: "教学",
  tech: "技术",
  theater: "戏剧",
  "time-management": "时间管理",
  training: "培训",
  transition: "转型",
  travel: "旅行",
  tutorial: "教程",
  ui: "界面设计",
  "ui-ux": "UI/UX",
  user: "用户",
  viral: "病毒式传播",
  "visual-design": "视觉设计",
  visualization: "数据可视化",
  vlog: "视频日志",
  wechat: "微信",
  weibo: "微博",
  wellness: "健康",
  workshop: "工作坊",
  xiaohongshu: "小红书",
  youtube: "YouTube视频",
  zhihu: "知乎",
};

const templateCategoryOptions = computed(() => {
  const categories = new Map();
  templateStore.templates.forEach((template) => {
    const key = template.category || "other";
    if (!categories.has(key)) {
      categories.set(key, { key, label: categoryLabelMap[key] || key });
    }
  });
  const items = Array.from(categories.values());
  items.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  return items;
});

const displayProjectTypes = computed(() => {
  const staticList = projectTypes.value || [];
  const staticKeys = new Set(staticList.map((item) => item.key));
  const dynamicList = templateCategoryOptions.value.filter(
    (item) => !staticKeys.has(item.key),
  );
  return [{ key: "all", label: "全部" }, ...staticList, ...dynamicList];
});

const subcategoryLabelMap = computed(() => {
  const labels = { ...subcategoryLabelOverrides };
  Object.values(categoryConfig.value).forEach((items) => {
    items.forEach((item) => {
      if (item?.key && item?.label && !labels[item.key]) {
        labels[item.key] = item.label;
      }
    });
  });
  return labels;
});

const templateSubcategoryOptions = computed(() => {
  const options = {};
  templateStore.templates.forEach((template) => {
    const category = template.category || "other";
    const subcategory = template.subcategory || "";
    if (!subcategory) {
      return;
    }
    if (!options[category]) {
      options[category] = [];
    }
    if (!options[category].some((item) => item.key === subcategory)) {
      options[category].push({
        key: subcategory,
        label: subcategoryLabelMap.value[subcategory] || subcategory,
      });
    }
  });
  Object.keys(options).forEach((category) => {
    options[category].sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  });
  return options;
});

// 当前显示的子分类
const currentCategories = computed(() => {
  if (!selectedType.value || selectedType.value === "all") {
    return [{ key: "all", label: "全部" }];
  }
  const dynamic = templateSubcategoryOptions.value[selectedType.value];
  if (dynamic && dynamic.length > 0) {
    return [{ key: "all", label: "全部" }, ...dynamic];
  }
  return (
    categoryConfig.value[selectedType.value] || [{ key: "all", label: "全部" }]
  );
});

// 智能问候语（根据时间）
const greetingMessage = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) {
    return "深夜好！有什么需要处理的吗？";
  }
  if (hour < 12) {
    return "早上好！有哪些工作要处理？";
  }
  if (hour < 14) {
    return "中午好！有哪些工作要处理？";
  }
  if (hour < 18) {
    return "下午好！有新的工作安排吗？";
  }
  if (hour < 22) {
    return "晚上好！今天还有什么要完成的？";
  }
  return "夜深了！还在工作吗？";
});

// 模板相关
const showTemplateModal = ref(false);
const selectedTemplate = ref(null);

// 计算属性
const loading = computed(() => projectStore.loading);
const userName = computed(() => authStore.currentUser?.name || "访客");
const userAvatar = computed(() => authStore.currentUser?.avatar || "");
const hasProjects = computed(() => projectStore.projects.length > 0);
const inputPlaceholder = computed(() => "给我发消息或描述你的任务...");

// 过滤项目
const filteredProjects = computed(() => {
  let projects = projectStore.projects;

  // 按类型筛选
  if (selectedType.value && selectedType.value !== "all") {
    projects = projects.filter((p) => p.project_type === selectedType.value);
  }

  // 按类别筛选
  if (activeCategory.value !== "all") {
    projects = projects.filter((p) => p.category === activeCategory.value);
  }

  return projects;
});

// 分页项目
const paginatedProjects = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredProjects.value.slice(start, end);
});

const filteredTotal = computed(() => filteredProjects.value.length);

// 处理新对话
const handleNewConversation = () => {
  router.push("/projects/new");
};

// 处理对话点击
const handleConversationClick = (conversation) => {
  activeConversationId.value = conversation.id;
  router.push(`/projects/${conversation.project_id}`);
};

// 处理对话操作
const handleConversationAction = ({ action, conversation }) => {
  switch (action) {
    case "rename":
      handleRenameConversation(conversation);
      break;
    case "star":
      handleStarConversation(conversation);
      break;
    case "delete":
      handleDeleteConversation(conversation);
      break;
  }
};

// 重命名对话
const handleRenameConversation = async (conversation) => {
  try {
    const { Modal } = await import("ant-design-vue");

    Modal.confirm({
      title: "重命名对话",
      content: h("div", [
        h(
          "p",
          { style: { marginBottom: "8px" } },
          `当前名称: ${conversation.title}`,
        ),
        h("input", {
          id: "rename-conversation-input",
          type: "text",
          value: conversation.title,
          placeholder: "请输入新名称",
          style: {
            width: "100%",
            padding: "8px",
            border: "1px solid #d9d9d9",
            borderRadius: "4px",
            fontSize: "14px",
          },
          onMounted: () => {
            nextTick(() => {
              const input = document.getElementById(
                "rename-conversation-input",
              );
              if (input) {
                input.focus();
                input.select();
              }
            });
          },
        }),
      ]),
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        const input = document.getElementById("rename-conversation-input");
        const newTitle = input?.value?.trim();

        if (!newTitle) {
          message.warning("对话名称不能为空");
          return Promise.reject();
        }

        if (newTitle === conversation.title) {
          message.info("名称未改变");
          return;
        }

        try {
          const result = await window.electronAPI.conversation.update(
            conversation.id,
            { title: newTitle },
          );
          if (result.success) {
            conversation.title = newTitle;
            await loadRecentConversations();
            message.success("对话已重命名");
          } else {
            message.error(result.error || "重命名失败");
          }
        } catch (err) {
          logger.error("[ProjectsPage] Rename conversation failed:", err);
          message.error("重命名失败：" + err.message);
        }
      },
    });
  } catch (error) {
    logger.error("[ProjectsPage] 打开重命名对话框失败:", error);
    message.error("打开重命名对话框失败");
  }
};

// 收藏/取消收藏对话
const handleStarConversation = async (conversation) => {
  const isStarred = conversation.is_starred || false;
  const newStarredState = !isStarred;

  try {
    const result = await window.electronAPI.conversation.update(
      conversation.id,
      {
        is_starred: newStarredState,
      },
    );
    if (result.success) {
      conversation.is_starred = newStarredState;
      message.success(newStarredState ? "已收藏" : "已取消收藏");
    } else {
      message.error(result.error || "操作失败");
    }
  } catch (error) {
    logger.error("[ProjectsPage] Star conversation failed:", error);
    message.error("操作失败：" + error.message);
  }
};

// 处理导航点击
const handleNavClick = (item) => {
  activeNavItem.value = item.id;
  // 根据不同的导航项执行不同操作
  if (item.id.startsWith("proj-")) {
    const typeMap = {
      "proj-web": "web",
      "proj-doc": "document",
      "proj-excel": "data",
      "proj-ppt": "ppt",
      "proj-video": "video",
      "proj-design": "design",
      "proj-code": "code",
    };
    selectedType.value = typeMap[item.id] || "";
  }
};

// 处理用户操作
const handleUserAction = (action) => {
  switch (action) {
    case "profile":
      router.push("/profile");
      break;
    case "settings":
      router.push("/settings");
      break;
    case "logout":
      authStore.logout();
      router.push("/login");
      break;
  }
};

// 🔥 AI对话辅助方法
// formatTime / getStageColor / detectCreateIntent moved to ./projectsPageUtils.js.

const clearConversation = () => {
  conversationMessages.value = [];
  message.success("对话已清空");
};

const addMessage = (type, content, options = {}) => {
  conversationMessages.value.push({
    type,
    content,
    timestamp: Date.now(),
    ...options,
  });

  // 自动滚动到底部（显示最新消息）
  nextTick(() => {
    const messagesArea = document.querySelector(".conversation-messages-area");
    if (messagesArea) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  });
};

// 处理对话式创建项目（流式）
const handleConversationalCreate = async ({ text, attachments }) => {
  try {
    // 意图分类（chat / project-creation）— 见 ./projectsPageUtils.js
    const { isChatIntent, isProjectCreationIntent } = detectCreateIntent(text);

    // 1. 纯聊天意图且不是项目创建意图 → 走 AI 对话回路
    if (isChatIntent && !isProjectCreationIntent) {
      logger.info("[ProjectsPage] 检测到聊天咨询意图，不创建项目");

      // 添加用户消息到对话
      addMessage("user", text);

      // 添加AI回复（暂时显示提示消息）
      addMessage(
        "assistant",
        `你好！关于"${text.substring(0, 20)}..."的问题，我建议：<br/><br/>
        1. 如果需要设计Logo，可以使用专业的设计工具如Canva、Adobe Illustrator等<br/>
        2. 如果需要我帮你创建包含Logo的网页，请说"帮我创建一个网页/网站"<br/>
        3. 如果需要Logo文件，请说"创建Logo文件"<br/><br/>
        <em>完整的AI对话功能即将支持，敬请期待！</em>`,
      );

      return;
    }

    // 🔥 新设计：直接创建项目并跳转到详情页，让ChatPanel负责意图识别和任务规划
    createError.value = "";

    // 添加用户消息
    addMessage("user", text);

    const userId = authStore.currentUser?.id || "default-user";
    const projectName = text.substring(0, 50) || "未命名项目";

    try {
      logger.info("[ProjectsPage] 🚀 直接创建项目:", projectName);

      // 直接创建项目（不进行意图识别）
      const createData = {
        name: projectName,
        projectType: "document", // 默认类型，后续由ChatPanel的AI识别
        userId: userId,
        status: "draft",
      };

      const createdProject =
        await window.electronAPI.project.createQuick(createData);
      logger.info("[ProjectsPage] ✅ 项目创建成功:", createdProject.id);

      // 显示成功提示
      addMessage("system", "项目创建成功！正在进入...");

      // 跳转到项目详情页，传递用户输入给ChatPanel
      setTimeout(() => {
        router
          .push({
            path: `/projects/${createdProject.id}`,
            query: {
              autoSendMessage: text, // 传递给ChatPanel自动发送，触发意图识别和任务规划
            },
          })
          .catch((navError) => {
            logger.error("[ProjectsPage] Project navigation failed:", navError);
          });
      }, 300);
    } catch (error) {
      logger.error("[ProjectsPage] ❌ 项目创建失败:", error);
      message.error("项目创建失败: " + error.message);
      addMessage("system", `项目创建失败: ${error.message}`);
    }

    // 2. AI智能拆解任务（已禁用 - 流式创建已完成所有工作）
    // 如果需要额外的任务执行，可以取消下面的注释
    /*
    try {
      message.loading({ content: 'AI正在拆解任务...', key: 'ai-decompose', duration: 0 });

      // 使用正确的projectId（从createProjectStream的回调中获取）
      logger.info('[ProjectsPage] 准备拆解任务');
      logger.info('[ProjectsPage] createdProjectId.value:', createdProjectId.value);
      logger.info('[ProjectsPage] project:', project);
      logger.info('[ProjectsPage] project?.projectId:', project?.projectId);
      logger.info('[ProjectsPage] project?.id:', project?.id);

      const projectId = createdProjectId.value || project?.projectId || project?.id;

      logger.info('[ProjectsPage] 最终使用的projectId:', projectId);

      if (!projectId) {
        logger.error('[ProjectsPage] 错误：projectId为空！');
        throw new Error('项目ID不存在，无法进行任务拆解');
      }

      const contextData = {
        projectId: projectId,
        projectType: project?.project_type || project?.projectType,
        projectName: projectData.name,
        root_path: project?.root_path || project?.rootPath
      };

      logger.info('[ProjectsPage] 任务拆解上下文:', contextData);

      const taskPlan = await window.electronAPI.project.decomposeTask(text, contextData);

      message.success({ content: '任务拆解完成', key: 'ai-decompose', duration: 2 });

      // 3. 显示任务执行监控器
      currentTaskPlan.value = taskPlan;
      showTaskMonitor.value = true;

      // 4. 自动开始执行
      executeTaskPlan(taskPlan);
    } catch (decomposeError) {
      logger.error('Task decompose failed:', decomposeError);
      message.warning({
        content: '任务拆解失败，已创建项目。您可以手动编辑。',
        key: 'ai-decompose',
        duration: 3
      });

      // 即使拆解失败，也跳转到项目页
      router.push(`/projects/${project.projectId || createdProjectId.value}`);
    }
    */
  } catch (error) {
    logger.error("Failed to create project:", error);
    message.error({
      content: "创建失败：" + error.message,
      key: "ai-create",
      duration: 3,
    });
  }
};

// 处理文件上传
const handleFileUpload = async (files) => {
  logger.info("Files uploaded:", files);

  if (!files || files.length === 0) {
    return;
  }

  try {
    message.loading({ content: "正在上传文件...", key: "file-upload" });

    // 遍历上传每个文件
    for (const file of files) {
      const fileData = {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        file: file,
      };

      // 使用 projectStore 上传文件到当前项目
      await projectStore.uploadFile(fileData);
    }

    message.success({
      content: `成功上传 ${files.length} 个文件`,
      key: "file-upload",
    });
  } catch (error) {
    logger.error("文件上传失败:", error);
    message.error({
      content: "文件上传失败: " + error.message,
      key: "file-upload",
    });
  }
};

// 处理类别切换
const handleCategoryChange = (category) => {
  activeCategory.value = category;
  currentPage.value = 1;
};

// 处理类型快捷选择
const handleTypeQuickSelect = (typeKey) => {
  // 切换选择状态
  if (typeKey === "all" || selectedType.value === typeKey) {
    // 如果点击已选中的类型，则取消选择，回到默认状态
    selectedType.value = "all";
    activeCategory.value = "all";
  } else {
    // 选择新类型
    selectedType.value = typeKey;
    // 默认显示该分类下的全部模板
    activeCategory.value = "all";
  }
  currentPage.value = 1;
};

// 处理建议点击（来自TaskExecutionMonitor组件）
const handleSuggestionClick = (params) => {
  if (params && params.question) {
    logger.info("Suggestion clicked from TaskMonitor:", params.question);

    // 将建议作为新的对话输入，跳转到AI对话页面
    // 使用 localStorage 临时存储建议内容
    localStorage.setItem(
      "pendingInsertText",
      JSON.stringify({
        text: params.question,
        source: "task-suggestion",
        timestamp: Date.now(),
      }),
    );

    // 跳转到 AI 对话页面
    router.push("/ai/chat");
    message.success("正在跳转到 AI 对话...");
  }
};

// 处理模板使用
const handleTemplateUse = (template) => {
  logger.info("[ProjectsPage] 使用模板:", template);
  selectedTemplate.value = template;
  showTemplateModal.value = true;
};

// 处理模板创建开始（跳转到 ai-creating 模式，在 ProjectDetailPage 的 AI对话面板中展示进度）
const handleTemplateCreateStart = async (createData) => {
  try {
    logger.info(
      "[ProjectsPage] 模板创建开始，跳转到 ai-creating 模式:",
      createData,
    );

    // 获取用户ID
    const userId = authStore.currentUser?.id || "default-user";

    const aiCreateData = {
      userPrompt: createData.renderedPrompt,
      name: createData.projectName,
      projectType: createData.projectType,
      userId: userId,
      templateId: createData.templateId,
      templateVariables: createData.variables,
    };

    // 🔥 跳转到 ai-creating 模式，在 ProjectDetailPage 的 AI对话面板中展示创建过程
    await router.push({
      path: `/projects/ai-creating`,
      query: {
        createData: JSON.stringify(aiCreateData),
      },
    });

    // 记录模板使用（异步记录，不阻塞跳转）
    templateStore
      .recordUsage(createData.templateId, userId, null, createData.variables)
      .catch((err) => {
        logger.error("[ProjectsPage] 记录模板使用失败:", err);
      });
  } catch (error) {
    logger.error("[ProjectsPage] Failed to start template creation:", error);
    message.error({
      content: "启动创建失败：" + error.message,
      key: "template-create",
      duration: 3,
    });
  }
};

// 处理模板创建成功（已废弃，由 handleTemplateCreateStart 替代）
const handleTemplateSuccess = (result) => {
  logger.info("[ProjectsPage] 项目创建成功:", result);
  // 跳转到项目详情页
  if (result.projectId) {
    router.push(`/projects/${result.projectId}`);
  }
};

// 处理创建自定义项目
const handleCreateCustom = () => {
  router.push("/projects/new");
};

// 处理分页变化
const handlePageChange = (page, size) => {
  currentPage.value = page;
};

const handlePageSizeChange = (current, size) => {
  pageSize.value = size;
  currentPage.value = 1;
};

// 处理查看项目
const handleViewProject = (projectId) => {
  const project = projectStore.projects.find((p) => p.id === projectId);
  const projectName = project ? project.name : "项目详情";

  appStore.addTab({
    key: `project-${projectId}`,
    title: projectName,
    path: `/projects/${projectId}`,
    closable: true,
  });

  router.push(`/projects/${projectId}`);
};

// 处理编辑项目
const handleEditProject = (projectId) => {
  router.push(`/projects/${projectId}/edit`);
};

// 处理删除项目
const handleDeleteProject = async (projectId) => {
  Modal.confirm({
    title: "确认删除",
    content: "确定要删除这个项目吗？此操作不可恢复。",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        await projectStore.deleteProject(projectId);
        message.success("项目已删除");
      } catch (error) {
        logger.error("Delete project failed:", error);
        message.error("删除失败：" + error.message);
      }
    },
  });
};

// 处理删除对话
const handleDeleteConversation = (conversation) => {
  Modal.confirm({
    title: "确认删除",
    content: "确定要删除这个对话吗？",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        // 调用IPC删除对话
        const result = await window.electronAPI.conversation.delete(
          conversation.id,
        );
        if (result.success) {
          // 从本地列表中移除
          recentConversations.value = recentConversations.value.filter(
            (c) => c.id !== conversation.id,
          );
          message.success("对话已删除");
        } else {
          message.error(result.error || "删除失败");
        }
      } catch (error) {
        logger.error("Delete conversation failed:", error);
        message.error("删除失败：" + error.message);
      }
    },
  });
};

// 加载最近对话
const loadRecentConversations = async () => {
  try {
    // 从数据库加载最近对话
    const result = await window.electronAPI.conversation.getRecent({
      limit: 10,
      projectId: createdProjectId.value || null,
    });
    if (result.success) {
      recentConversations.value = result.conversations || [];
    } else {
      recentConversations.value = [];
    }
  } catch (error) {
    logger.error("Load recent conversations failed:", error);
    recentConversations.value = [];
  }
};

// 执行任务计划
const executeTaskPlan = async (taskPlan) => {
  try {
    isExecutingTask.value = true;

    const result = await window.electronAPI.project.executeTaskPlan(
      taskPlan.id,
      {
        projectId: taskPlan.project_id,
        root_path: projectStore.projects.find(
          (p) => p.id === taskPlan.project_id,
        )?.root_path,
      },
    );

    isExecutingTask.value = false;

    if (result.success) {
      message.success("任务执行完成！");
    } else {
      message.error("任务执行失败：" + result.error);
    }
  } catch (error) {
    isExecutingTask.value = false;
    logger.error("Execute task plan failed:", error);
    message.error("任务执行失败：" + error.message);
  }
};

// 处理任务进度更新
const handleTaskProgressUpdate = (progress) => {
  if (
    !currentTaskPlan.value ||
    progress.taskPlan.id !== currentTaskPlan.value.id
  ) {
    return;
  }

  // 更新任务计划状态
  currentTaskPlan.value = progress.taskPlan;

  // 根据进度类型显示消息
  if (progress.type === "subtask-started") {
    logger.info(`开始执行: ${progress.subtask.title}`);
  } else if (progress.type === "subtask-completed") {
    logger.info(`已完成: ${progress.subtask.title}`);
  } else if (progress.type === "task-completed") {
    message.success("所有任务已完成！");
    isExecutingTask.value = false;
  } else if (progress.type === "task-failed") {
    message.error("任务执行失败");
    isExecutingTask.value = false;
  }
};

// 取消任务
const handleCancelTask = async (taskPlanId) => {
  Modal.confirm({
    title: "确认取消",
    content: "确定要取消当前任务吗？",
    okText: "取消任务",
    okType: "danger",
    cancelText: "继续执行",
    onOk: async () => {
      try {
        await window.electronAPI.project.cancelTaskPlan(taskPlanId);
        message.success("任务已取消");
        showTaskMonitor.value = false;
        currentTaskPlan.value = null;
        isExecutingTask.value = false;
      } catch (error) {
        logger.error("Cancel task failed:", error);
        message.error("取消失败：" + error.message);
      }
    },
  });
};

// 关闭任务监控器
const handleCloseTaskMonitor = () => {
  if (isExecutingTask.value) {
    Modal.confirm({
      title: "任务正在执行",
      content: "任务仍在执行中，关闭监控器不会停止任务。确定要关闭吗？",
      okText: "关闭",
      cancelText: "取消",
      onOk: () => {
        showTaskMonitor.value = false;
      },
    });
  } else {
    showTaskMonitor.value = false;
  }
};

// 流式创建相关处理方法（已移除，改为在对话框中展示）

// 查看任务结果
const handleViewTaskResults = (taskPlan) => {
  const project = projectStore.projects.find(
    (p) => p.id === taskPlan.project_id,
  );
  if (project) {
    router.push(`/projects/${project.id}`);
    showTaskMonitor.value = false;
  }
};

// 重试任务
const handleRetryTask = async (taskPlan) => {
  message.info("重新执行任务...");
  executeTaskPlan(taskPlan);
};

// 处理文件点击（预览）
const handleFileClick = async ({ file, subtask, taskPlan }) => {
  logger.info("Preview file:", file);

  try {
    // 获取文件路径
    const filePath = typeof file === "string" ? file : file.path;

    // 调用IPC读取文件内容
    const result = await window.electronAPI.file.readContent(filePath);

    if (result.success) {
      // 打开文件预览模态框
      Modal.info({
        title: `文件预览: ${filePath.split(/[\\/]/).pop()}`,
        width: 800,
        content: h(
          "pre",
          {
            style:
              "max-height: 500px; overflow: auto; background: #f5f5f5; padding: 16px; border-radius: 4px; font-size: 12px;",
          },
          result.content,
        ),
        okText: "关闭",
      });
    } else {
      message.error("无法预览文件: " + (result.error || "未知错误"));
    }
  } catch (error) {
    logger.error("Preview file failed:", error);
    message.error("预览失败: " + error.message);
  }
};

// 处理继续编辑（根据这个来改）
const handleContinueEdit = ({ file, taskPlan }) => {
  logger.info("Continue edit file:", file);

  // 获取文件路径
  const filePath = typeof file === "string" ? file : file.path;
  const fileName = filePath.split(/[\\/]/).pop();

  message.success(`将基于 ${fileName} 继续编辑`);

  // 跳转到项目详情页并打开文件编辑器
  router.push({
    path: `/projects/${taskPlan.project_id}`,
    query: { file: filePath, mode: "edit" },
  });
};

// 项目相关处理函数
// 组件挂载时加载项目并监听进度
// 处理文件更新事件
const handleFilesUpdated = async (data) => {
  logger.info("项目文件已更新:", data);
  try {
    // 重新加载项目列表以显示最新文件数
    const userId = authStore.currentUser?.id || "default-user";
    await projectStore.fetchProjects(userId);
    message.success(`成功注册 ${data.filesCount} 个新文件`);
  } catch (error) {
    logger.error("刷新项目失败:", error);
  }
};

onMounted(async () => {
  const userId = authStore.currentUser?.id || "default-user";

  try {
    await projectStore.fetchProjects(userId);
    await loadRecentConversations();
  } catch (error) {
    logger.error("Failed to load projects:", error);
    message.error("加载项目失败：" + error.message);
  }

  try {
    await templateStore.fetchTemplates();
  } catch (error) {
    logger.error("[ProjectsPage] 加载模板失败:", error);
    message.error("加载模板失败：" + error.message);
  }

  // 监听任务进度更新
  window.electronAPI.project.onTaskProgressUpdate(handleTaskProgressUpdate);

  // 监听项目文件更新
  window.electronAPI.project.onFilesUpdated(handleFilesUpdated);
});

// 组件卸载时清理监听
onUnmounted(() => {
  if (window.electronAPI?.project?.offTaskProgressUpdate) {
    window.electronAPI.project.offTaskProgressUpdate(handleTaskProgressUpdate);
  }
  if (window.electronAPI?.project?.offFilesUpdated) {
    window.electronAPI.project.offFilesUpdated(handleFilesUpdated);
  }
});
</script>

<style scoped lang="scss">
/* 扣子空间风格 - 项目列表页 */
.projects-page-wrapper {
  display: flex;
  min-height: 100%;
  padding: 0;
  margin: -24px; /* 抵消 layout-content 的 padding */
  height: calc(100vh - 56px - 40px); /* 减去 header 和 tabs-bar 的高度 */
  background: #ffffff;
  overflow: hidden;
}

/* 中央内容区域 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 40px 80px;
  background: #ffffff;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.25);
  }
}

/* 欢迎头部 */
.welcome-header {
  text-align: center;
  margin-bottom: 20px;
  padding: 20px 0 10px;
}

.welcome-title {
  font-size: 24px;
  font-weight: 400;
  color: #333333;
  margin: 0;
  line-height: 1.4;
}

/* 对话输入框区域 */
.conversation-input-section {
  max-width: 900px;
  width: 100%;
  margin: 0 auto 32px;
}

/* 🔥 AI对话消息区域 */
.conversation-messages-area {
  max-width: 900px;
  width: 100%;
  margin: 0 auto 32px;
  padding: 20px;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px solid #e5e7eb;

  .conversation-message {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .user-message,
  .assistant-message,
  .progress-message,
  .success-message,
  .error-message {
    display: flex;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    background: white;

    .message-avatar {
      font-size: 24px;
      line-height: 1;
      flex-shrink: 0;
    }

    .message-content {
      flex: 1;
      min-width: 0;
    }

    .message-text {
      color: #374151;
      line-height: 1.6;
      margin-bottom: 4px;
    }

    .message-time {
      font-size: 12px;
      color: #9ca3af;
    }
  }

  .progress-message {
    background: #eff6ff;
    border-left: 3px solid #3b82f6;

    .progress-stage {
      margin-bottom: 8px;
    }

    .progress-text {
      color: #1e40af;
      font-weight: 500;
      margin-bottom: 4px;
    }

    .progress-details {
      margin-top: 8px;
      padding: 8px;
      background: white;
      border-radius: 4px;
      font-size: 12px;

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    }
  }

  .success-message {
    background: #f0fdf4;
    border-left: 3px solid #10b981;

    .message-text {
      color: #065f46;
      font-weight: 500;
    }

    .message-actions {
      margin-top: 12px;
    }
  }

  .error-message {
    background: #fef2f2;
    border-left: 3px solid #ef4444;

    .message-text {
      color: #991b1b;
      font-weight: 500;
    }

    .error-details {
      margin-top: 8px;
      padding: 8px;
      background: white;
      border-radius: 4px;
      font-size: 12px;
      color: #dc2626;

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    }
  }

  .conversation-actions {
    margin-top: 16px;
    text-align: right;
  }
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

/* 加载状态 */
.loading-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

/* 项目网格区域 */
.projects-grid-section {
  flex: 1;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
}

/* 分页 */
.pagination-container {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

/* 空结果状态 */
.empty-result {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  text-align: center;
  padding: 80px 40px;

  .empty-icon {
    font-size: 72px;
    color: #d1d5db;
    margin-bottom: 24px;
  }

  h3 {
    font-size: 20px;
    font-weight: 500;
    color: #374151;
    margin: 0 0 12px 0;
  }

  p {
    font-size: 15px;
    color: #6b7280;
    margin: 0;
  }
}

/* 滚动条样式 */
.main-content {
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;

    &:hover {
      background: #9ca3af;
    }
  }

  &::-webkit-scrollbar-track {
    background: #f9fafb;
  }
}

/* 任务监控器弹窗样式 */
:deep(.task-monitor-modal) {
  .ant-modal-body {
    padding: 0;
    max-height: 70vh;
    overflow-y: auto;
  }

  .ant-modal-header {
    padding: 16px 24px;
    border-bottom: 1px solid #e8e8e8;
  }
}
</style>
