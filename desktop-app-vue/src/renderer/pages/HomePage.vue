<template>
  <div class="home-page">
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

    <!-- 快速操作 -->
    <div class="quick-actions">
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :sm="12" :md="6">
          <div class="action-card" @click="openTab('file-import', '/file-import', '文件导入')">
            <div class="action-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">
              <CloudUploadOutlined />
            </div>
            <div class="action-content">
              <div class="action-title">文件导入</div>
              <div class="action-desc">导入文档到知识库</div>
            </div>
          </div>
        </a-col>

        <a-col :xs="24" :sm="12" :md="6">
          <div class="action-card" @click="openTab('image-upload', '/image-upload', '图片上传')">
            <div class="action-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)">
              <FileImageOutlined />
            </div>
            <div class="action-content">
              <div class="action-title">图片识别</div>
              <div class="action-desc">OCR文字识别</div>
            </div>
          </div>
        </a-col>

        <a-col :xs="24" :sm="12" :md="6">
          <div class="action-card" @click="openTab('prompt-templates', '/prompt-templates', '提示词模板')">
            <div class="action-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)">
              <TagsOutlined />
            </div>
            <div class="action-content">
              <div class="action-title">提示词模板</div>
              <div class="action-desc">AI对话模板</div>
            </div>
          </div>
        </a-col>

        <a-col :xs="24" :sm="12" :md="6">
          <div class="action-card" @click="openTab('did', '/did', 'DID身份')">
            <div class="action-icon" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)">
              <IdcardOutlined />
            </div>
            <div class="action-content">
              <div class="action-title">DID身份</div>
              <div class="action-desc">去中心化身份</div>
            </div>
          </div>
        </a-col>
      </a-row>
    </div>

    <!-- 功能模块 -->
    <div class="feature-modules">
      <a-row :gutter="[16, 16]">
        <!-- 知识与AI -->
        <a-col :xs="24" :lg="12">
          <div class="module-card">
            <div class="module-header">
              <div class="module-title">
                <FileTextOutlined class="module-icon" />
                <span>知识与AI</span>
              </div>
            </div>
            <div class="module-grid">
              <div
                v-for="item in knowledgeModules"
                :key="item.key"
                class="module-item"
                @click="openTab(item.key, item.path, item.title)"
              >
                <component :is="item.icon" class="item-icon" />
                <span class="item-title">{{ item.title }}</span>
              </div>
            </div>
          </div>
        </a-col>

        <!-- 身份与社交 -->
        <a-col :xs="24" :lg="12">
          <div class="module-card">
            <div class="module-header">
              <div class="module-title">
                <TeamOutlined class="module-icon" />
                <span>身份与社交</span>
              </div>
            </div>
            <div class="module-grid">
              <div
                v-for="item in socialModules"
                :key="item.key"
                class="module-item"
                @click="openTab(item.key, item.path, item.title)"
              >
                <component :is="item.icon" class="item-icon" />
                <span class="item-title">{{ item.title }}</span>
              </div>
            </div>
          </div>
        </a-col>

        <!-- 交易系统 -->
        <a-col :xs="24" :lg="12">
          <div class="module-card">
            <div class="module-header">
              <div class="module-title">
                <ShopOutlined class="module-icon" />
                <span>交易系统</span>
              </div>
            </div>
            <div class="module-grid">
              <div
                v-for="item in tradeModules"
                :key="item.key"
                class="module-item"
                @click="openTab(item.key, item.path, item.title)"
              >
                <component :is="item.icon" class="item-icon" />
                <span class="item-title">{{ item.title }}</span>
              </div>
            </div>
          </div>
        </a-col>

        <!-- 系统设置 -->
        <a-col :xs="24" :lg="12">
          <div class="module-card">
            <div class="module-header">
              <div class="module-title">
                <SettingOutlined class="module-icon" />
                <span>系统设置</span>
              </div>
            </div>
            <div class="module-grid">
              <div
                v-for="item in systemModules"
                :key="item.key"
                class="module-item"
                @click="openTab(item.key, item.path, item.title)"
              >
                <component :is="item.icon" class="item-icon" />
                <span class="item-title">{{ item.title }}</span>
              </div>
            </div>
          </div>
        </a-col>
      </a-row>
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

    <!-- 最近更新 -->
    <div v-if="recentItems.length > 0" class="recent-section">
      <div class="section-header">
        <h3>最近更新</h3>
      </div>
      <a-list
        :data-source="recentItems"
        :pagination="false"
        class="recent-list"
      >
        <template #renderItem="{ item }">
          <a-list-item class="recent-item" @click="viewItem(item)">
            <a-list-item-meta>
              <template #avatar>
                <a-avatar :style="{ background: getTypeColor(item.type) }">
                  <template #icon>
                    <component :is="getTypeIcon(item.type)" />
                  </template>
                </a-avatar>
              </template>
              <template #title>
                <span class="item-title">{{ item.title }}</span>
              </template>
              <template #description>
                <span class="item-time">{{ formatDate(item.updated_at) }}</span>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a>查看</a>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  FileTextOutlined,
  TeamOutlined,
  ShopOutlined,
  SettingOutlined,
  CloudUploadOutlined,
  FileImageOutlined,
  TagsOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  CommentOutlined,
  MessageOutlined,
  ShoppingCartOutlined,
  AuditOutlined,
  StarOutlined,
  ApiOutlined,
  SyncOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  FileOutlined,
  GlobalOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import LLMStatus from '../components/LLMStatus.vue';
import GitStatus from '../components/GitStatus.vue';

const router = useRouter();
const store = useAppStore();

// 知识与AI模块
const knowledgeModules = [
  { key: 'file-import', title: '文件导入', path: '/file-import', icon: CloudUploadOutlined },
  { key: 'image-upload', title: '图片上传', path: '/image-upload', icon: FileImageOutlined },
  { key: 'prompt-templates', title: '提示词模板', path: '/prompt-templates', icon: TagsOutlined },
  { key: 'knowledge-store', title: '知识付费', path: '/knowledge-store', icon: ShopOutlined },
  { key: 'my-purchases', title: '我的购买', path: '/my-purchases', icon: ShoppingCartOutlined },
];

// 身份与社交模块
const socialModules = [
  { key: 'did', title: 'DID身份', path: '/did', icon: IdcardOutlined },
  { key: 'credentials', title: '可验证凭证', path: '/credentials', icon: SafetyCertificateOutlined },
  { key: 'contacts', title: '联系人', path: '/contacts', icon: TeamOutlined },
  { key: 'friends', title: '好友管理', path: '/friends', icon: UserOutlined },
  { key: 'posts', title: '动态广场', path: '/posts', icon: CommentOutlined },
  { key: 'p2p-messaging', title: 'P2P消息', path: '/p2p-messaging', icon: MessageOutlined },
];

// 交易系统模块
const tradeModules = [
  { key: 'marketplace', title: '交易市场', path: '/marketplace', icon: ShopOutlined },
  { key: 'contracts', title: '智能合约', path: '/contracts', icon: AuditOutlined },
  { key: 'credit-score', title: '信用评分', path: '/credit-score', icon: StarOutlined },
];

// 系统设置模块
const systemModules = [
  { key: 'settings', title: '通用设置', path: '/settings', icon: SettingOutlined },
  { key: 'llm-settings', title: 'LLM配置', path: '/settings', icon: ApiOutlined },
  { key: 'git-settings', title: 'Git同步', path: '/settings', icon: SyncOutlined },
  { key: 'rag-settings', title: 'RAG配置', path: '/settings', icon: DatabaseOutlined },
  { key: 'ukey-settings', title: 'UKey安全', path: '/settings', icon: SafetyOutlined },
];

// 今日新增数量
const todayCount = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  return store.knowledgeItems.filter(
    (item) => item.created_at >= todayTimestamp
  ).length;
});

// 最近更新的项目
const recentItems = computed(() => {
  return [...store.knowledgeItems]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 6);
});

const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

  return date.toLocaleDateString('zh-CN');
};

const getTypeIcon = (type) => {
  const icons = {
    note: FileTextOutlined,
    document: FileOutlined,
    conversation: CommentOutlined,
    web_clip: GlobalOutlined,
  };
  return icons[type] || FileTextOutlined;
};

const getTypeColor = (type) => {
  const colors = {
    note: '#1890ff',
    document: '#52c41a',
    conversation: '#faad14',
    web_clip: '#722ed1',
  };
  return colors[type] || '#1890ff';
};

const openTab = (key, path, title) => {
  store.addTab({ key, path, title });
  router.push(path);
};

const viewItem = (item) => {
  store.setCurrentItem(item);
  router.push(`/knowledge/${item.id}`);
};

const openSettings = (tab) => {
  const key = `${tab}-settings`;
  store.addTab({ key, path: '/settings', title: `${tab.toUpperCase()}配置` });
  router.push({ path: '/settings', query: { tab } });
};
</script>

<style scoped>
.home-page {
  min-height: 100%;
  padding: 0;
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

/* 快速操作 */
.quick-actions {
  margin-bottom: 24px;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: white;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.action-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.action-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: white;
  flex-shrink: 0;
}

.action-content {
  flex: 1;
}

.action-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  color: rgba(0, 0, 0, 0.85);
}

.action-desc {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

/* 功能模块 */
.feature-modules {
  margin-bottom: 24px;
}

.module-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  height: 100%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.3s;
}

.module-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.module-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}

.module-icon {
  font-size: 18px;
  color: #1890ff;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.module-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  background: #fafafa;
}

.module-item:hover {
  background: #e6f7ff;
  transform: translateY(-2px);
}

.item-icon {
  font-size: 24px;
  color: #1890ff;
}

.item-title {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
  text-align: center;
}

/* 系统状态 */
.system-status {
  margin-bottom: 24px;
}

/* 最近更新 */
.recent-section {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.section-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.section-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}

.recent-list {
  background: transparent;
}

.recent-item {
  cursor: pointer;
  transition: background 0.3s;
  border-radius: 8px;
  padding: 12px;
  margin: -12px;
}

.recent-item:hover {
  background: #fafafa;
}

.item-title {
  color: rgba(0, 0, 0, 0.85);
  font-weight: 500;
}

.item-time {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
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
