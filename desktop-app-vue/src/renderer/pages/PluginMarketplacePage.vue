<template>
  <div class="plugin-marketplace-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <ShopOutlined />
          插件市场
        </h1>
        <p class="page-description">发现、安装和管理插件，扩展 ChainlessChain 功能</p>
      </div>
      <div class="header-right">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索插件名称、作者、描述..."
          style="width: 360px"
          allow-clear
          size="large"
          @search="handleSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>
      </div>
    </div>

    <!-- 分类过滤 -->
    <div class="category-section">
      <a-radio-group
        v-model:value="activeCategory"
        button-style="solid"
        @change="handleCategoryChange"
      >
        <a-radio-button
          v-for="cat in categories"
          :key="cat.key"
          :value="cat.key"
        >
          <component :is="cat.icon" />
          {{ cat.label }}
        </a-radio-button>
      </a-radio-group>
    </div>

    <!-- 推荐区域 -->
    <div v-if="activeCategory === 'all' && featuredPlugins.length > 0" class="featured-section">
      <h2>精选推荐</h2>
      <div class="featured-scroll">
        <div
          v-for="plugin in featuredPlugins"
          :key="'featured-' + plugin.id"
          class="featured-card"
          @click="openDetail(plugin)"
        >
          <a-card hoverable>
            <div class="featured-icon">
              <img v-if="plugin.icon" :src="plugin.icon" :alt="plugin.name" />
              <AppstoreOutlined v-else style="font-size: 40px; color: #1890ff" />
            </div>
            <h3>{{ plugin.name }}</h3>
            <p class="featured-desc">{{ plugin.description }}</p>
            <div class="featured-meta">
              <span>
                <StarFilled style="color: #faad14" />
                {{ plugin.rating || 0 }}
              </span>
              <span>
                <DownloadOutlined />
                {{ formatNumber(plugin.downloads || 0) }}
              </span>
            </div>
          </a-card>
        </div>
      </div>
    </div>

    <!-- 排序和筛选栏 -->
    <div class="filter-bar">
      <a-space>
        <a-select v-model:value="sortBy" style="width: 140px" @change="handleSortChange">
          <a-select-option value="popular">最受欢迎</a-select-option>
          <a-select-option value="recent">最新发布</a-select-option>
          <a-select-option value="rating">评分最高</a-select-option>
          <a-select-option value="downloads">下载最多</a-select-option>
        </a-select>
        <a-checkbox v-model:checked="showInstalledOnly">仅已安装</a-checkbox>
        <a-checkbox v-model:checked="showVerifiedOnly">仅已验证</a-checkbox>
      </a-space>
      <span class="result-count">共 {{ filteredPlugins.length }} 个插件</span>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="正在加载插件列表..." />
    </div>

    <!-- 插件网格 -->
    <div v-else-if="filteredPlugins.length > 0" class="plugin-grid">
      <a-row :gutter="[20, 20]">
        <a-col
          v-for="plugin in paginatedPlugins"
          :key="plugin.id"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
        >
          <a-card class="plugin-card" hoverable @click="openDetail(plugin)">
            <!-- 插件图标 -->
            <div class="plugin-icon">
              <img v-if="plugin.icon" :src="plugin.icon" :alt="plugin.name" />
              <AppstoreOutlined v-else style="font-size: 48px; color: #1890ff" />
            </div>

            <!-- 插件名称 -->
            <div class="plugin-name">
              <h3>{{ plugin.name }}</h3>
              <a-tag v-if="plugin.verified" color="blue" size="small">
                <SafetyCertificateOutlined />
                已验证
              </a-tag>
            </div>

            <!-- 作者 -->
            <p class="plugin-author">
              <UserOutlined />
              {{ plugin.author }}
            </p>

            <!-- 描述摘要 -->
            <p class="plugin-description">{{ plugin.description }}</p>

            <!-- 评分和下载 -->
            <div class="plugin-stats">
              <span class="rating">
                <StarFilled style="color: #faad14" />
                {{ (plugin.rating || 0).toFixed(1) }}
              </span>
              <span class="downloads">
                <DownloadOutlined />
                {{ formatNumber(plugin.downloads || 0) }}
              </span>
            </div>

            <!-- 安装按钮 -->
            <div class="plugin-actions" @click.stop>
              <a-button
                v-if="!plugin.installed"
                type="primary"
                block
                :loading="plugin.installing"
                @click.stop="handleInstall(plugin)"
              >
                <DownloadOutlined />
                安装
              </a-button>
              <a-button
                v-else
                block
                danger
                @click.stop="handleUninstall(plugin)"
              >
                <DeleteOutlined />
                卸载
              </a-button>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 空状态 -->
    <a-empty
      v-else
      description="暂无匹配的插件"
      style="margin-top: 80px"
    >
      <a-button type="primary" @click="resetFilters">清除筛选条件</a-button>
    </a-empty>

    <!-- 分页 -->
    <div v-if="filteredPlugins.length > pageSize" class="pagination-section">
      <a-pagination
        v-model:current="currentPage"
        :total="filteredPlugins.length"
        :page-size="pageSize"
        show-quick-jumper
        @change="handlePageChange"
      />
    </div>

    <!-- 插件详情抽屉 -->
    <a-drawer
      v-model:open="detailVisible"
      title="插件详情"
      :width="640"
      :destroy-on-close="true"
    >
      <div v-if="selectedPlugin" class="plugin-detail">
        <!-- 详情头部 -->
        <div class="detail-header">
          <a-avatar :size="72" :src="selectedPlugin.icon" shape="square">
            <template #icon>
              <AppstoreOutlined />
            </template>
          </a-avatar>
          <div class="detail-title">
            <h2>{{ selectedPlugin.name }}</h2>
            <p class="detail-author">{{ selectedPlugin.author }}</p>
            <div class="detail-badges">
              <a-tag v-if="selectedPlugin.verified" color="blue">
                <SafetyCertificateOutlined />
                已验证
              </a-tag>
              <a-tag v-if="selectedPlugin.installed" color="green">
                <CheckCircleOutlined />
                已安装
              </a-tag>
              <a-tag>v{{ selectedPlugin.version }}</a-tag>
            </div>
          </div>
        </div>

        <!-- 统计信息 -->
        <a-descriptions :column="2" bordered size="small" style="margin-top: 20px">
          <a-descriptions-item label="评分">
            <a-rate :value="selectedPlugin.rating" disabled allow-half />
            <span style="margin-left: 8px">{{ (selectedPlugin.rating || 0).toFixed(1) }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="下载量">
            {{ formatNumber(selectedPlugin.downloads || 0) }}
          </a-descriptions-item>
          <a-descriptions-item label="版本">
            {{ selectedPlugin.version }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatDate(selectedPlugin.updatedAt) }}
          </a-descriptions-item>
          <a-descriptions-item label="分类" :span="2">
            <a-tag v-for="tag in (selectedPlugin.tags || [])" :key="tag">
              {{ tag }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 完整描述 -->
        <div class="detail-section">
          <h3>插件介绍</h3>
          <p>{{ selectedPlugin.description }}</p>
          <div
            v-if="selectedPlugin.longDescription"
            v-html="selectedPlugin.longDescription"
          />
        </div>

        <!-- 截图预览占位 -->
        <div class="detail-section">
          <h3>截图预览</h3>
          <div v-if="selectedPlugin.screenshots && selectedPlugin.screenshots.length > 0" class="screenshots-grid">
            <img
              v-for="(shot, idx) in selectedPlugin.screenshots"
              :key="idx"
              :src="shot"
              :alt="'Screenshot ' + (idx + 1)"
            />
          </div>
          <a-empty v-else description="暂无截图" :image="simpleImage" />
        </div>

        <!-- 功能特性 -->
        <div v-if="selectedPlugin.features && selectedPlugin.features.length > 0" class="detail-section">
          <h3>功能特性</h3>
          <ul>
            <li v-for="(feature, idx) in selectedPlugin.features" :key="idx">
              {{ feature }}
            </li>
          </ul>
        </div>

        <!-- 评分区域 -->
        <div class="detail-section">
          <h3>用户评分</h3>
          <div class="rating-summary">
            <div class="rating-big">
              <span class="rating-number">{{ (selectedPlugin.rating || 0).toFixed(1) }}</span>
              <a-rate :value="selectedPlugin.rating" disabled allow-half />
              <span class="rating-count">{{ formatNumber(selectedPlugin.downloads || 0) }} 次下载</span>
            </div>
          </div>
        </div>

        <!-- 安装/卸载按钮 -->
        <div class="detail-footer">
          <a-button @click="detailVisible = false">关闭</a-button>
          <a-button
            v-if="!selectedPlugin.installed"
            type="primary"
            :loading="selectedPlugin.installing"
            @click="handleInstall(selectedPlugin)"
          >
            <DownloadOutlined />
            安装插件
          </a-button>
          <a-button
            v-else
            danger
            @click="handleUninstall(selectedPlugin)"
          >
            <DeleteOutlined />
            卸载插件
          </a-button>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue';
import { message, Empty } from 'ant-design-vue';
import {
  ShopOutlined,
  SearchOutlined,
  AppstoreOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  ApiOutlined,
  LayoutOutlined,
  StarFilled,
  DownloadOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { logger, createLogger } from '@/utils/logger';

const marketplaceLogger = createLogger('plugin-marketplace-page');

const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

// ==================== 状态 ====================

const loading = ref(false);
const searchQuery = ref('');
const activeCategory = ref('all');
const sortBy = ref('popular');
const showInstalledOnly = ref(false);
const showVerifiedOnly = ref(false);
const currentPage = ref(1);
const pageSize = 12;

const plugins = ref<any[]>([]);
const featuredPlugins = ref<any[]>([]);
const selectedPlugin = ref<any>(null);
const detailVisible = ref(false);

// ==================== 分类配置 ====================

const categories = [
  { key: 'all', label: '全部插件', icon: AppstoreOutlined },
  { key: 'ai', label: 'AI 增强', icon: RobotOutlined },
  { key: 'productivity', label: '效率工具', icon: ThunderboltOutlined },
  { key: 'data', label: '数据处理', icon: DatabaseOutlined },
  { key: 'integration', label: '第三方集成', icon: ApiOutlined },
  { key: 'ui', label: '界面扩展', icon: LayoutOutlined },
];

// ==================== 计算属性 ====================

const filteredPlugins = computed(() => {
  let result = [...plugins.value];

  // 分类筛选
  if (activeCategory.value !== 'all') {
    result = result.filter((p) => p.category === activeCategory.value);
  }

  // 搜索筛选
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.author && p.author.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)) ||
        (p.tags && p.tags.some((tag: string) => tag.toLowerCase().includes(query)))
    );
  }

  // 已安装筛选
  if (showInstalledOnly.value) {
    result = result.filter((p) => p.installed);
  }

  // 已验证筛选
  if (showVerifiedOnly.value) {
    result = result.filter((p) => p.verified);
  }

  // 排序
  switch (sortBy.value) {
    case 'popular':
      result.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      break;
    case 'recent':
      result.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
      break;
    case 'rating':
      result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case 'downloads':
      result.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      break;
  }

  return result;
});

const paginatedPlugins = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredPlugins.value.slice(start, start + pageSize);
});

// ==================== 方法 ====================

async function fetchCategories() {
  try {
    const result = await (window as any).electronAPI.invoke('plugin-marketplace:categories');
    if (result.success && result.data) {
      marketplaceLogger.info('分类加载成功');
    }
  } catch (error) {
    marketplaceLogger.warn('加载分类失败，使用默认分类:', error);
  }
}

async function fetchFeatured() {
  try {
    const result = await (window as any).electronAPI.invoke('plugin-marketplace:featured');
    if (result.success) {
      featuredPlugins.value = result.data || result.plugins || [];
      marketplaceLogger.info(`推荐插件加载成功: ${featuredPlugins.value.length} 个`);
    }
  } catch (error) {
    marketplaceLogger.warn('加载推荐插件失败:', error);
    featuredPlugins.value = [];
  }
}

async function fetchPlugins() {
  loading.value = true;
  try {
    const result = await (window as any).electronAPI.invoke('plugin-marketplace:list', {
      category: activeCategory.value !== 'all' ? activeCategory.value : null,
      sort: sortBy.value,
      page: currentPage.value,
      pageSize: 200,
    });

    if (result.success) {
      plugins.value = (result.data || result.plugins || []).map((p: any) => ({
        ...p,
        installing: false,
      }));
      marketplaceLogger.info(`插件列表加载成功: ${plugins.value.length} 个插件`);
    } else {
      marketplaceLogger.warn('插件列表加载失败，使用模拟数据');
      plugins.value = getMockPlugins();
    }
  } catch (error) {
    marketplaceLogger.warn('插件市场 API 不可用，使用模拟数据:', error);
    plugins.value = getMockPlugins();
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  currentPage.value = 1;
}

function handleCategoryChange() {
  currentPage.value = 1;
}

function handleSortChange() {
  currentPage.value = 1;
}

function handlePageChange(page: number) {
  currentPage.value = page;
}

function openDetail(plugin: any) {
  selectedPlugin.value = plugin;
  detailVisible.value = true;
}

async function handleInstall(plugin: any) {
  try {
    plugin.installing = true;
    const result = await (window as any).electronAPI.invoke('plugin-marketplace:install', {
      pluginId: plugin.id,
      version: plugin.version || 'latest',
    });

    if (result.success) {
      plugin.installed = true;
      message.success(`插件 "${plugin.name}" 安装成功`);
    } else {
      message.error(result.error || '安装失败');
    }
  } catch (error) {
    marketplaceLogger.error('安装插件失败:', error);
    message.error('安装失败: ' + (error as Error).message);
  } finally {
    plugin.installing = false;
  }
}

async function handleUninstall(plugin: any) {
  try {
    const result = await (window as any).electronAPI.invoke('plugin-marketplace:uninstall', {
      pluginId: plugin.id,
    });

    if (result.success) {
      plugin.installed = false;
      message.success(`插件 "${plugin.name}" 已卸载`);
    } else {
      message.error(result.error || '卸载失败');
    }
  } catch (error) {
    marketplaceLogger.error('卸载插件失败:', error);
    message.error('卸载失败: ' + (error as Error).message);
  }
}

function resetFilters() {
  searchQuery.value = '';
  activeCategory.value = 'all';
  sortBy.value = 'popular';
  showInstalledOnly.value = false;
  showVerifiedOnly.value = false;
  currentPage.value = 1;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatDate(date: string | number | undefined): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('zh-CN');
}

function getMockPlugins(): any[] {
  return [
    {
      id: 'translator-plugin',
      name: '多语言翻译器',
      author: 'ChainlessChain Team',
      version: '1.2.0',
      description: '支持 50+ 种语言的智能翻译插件，集成主流翻译 API',
      category: 'ai',
      tags: ['翻译', 'AI', '多语言'],
      icon: null,
      verified: true,
      rating: 4.8,
      downloads: 15234,
      updatedAt: '2026-02-01',
      installed: false,
      installing: false,
      features: ['50+ 种语言互译', '智能上下文理解', '批量翻译', '自定义术语表'],
      screenshots: [],
    },
    {
      id: 'code-analyzer',
      name: '代码分析助手',
      author: 'DevTools Lab',
      version: '2.0.1',
      description: 'AI 驱动的代码分析工具，支持多种编程语言的静态分析和建议',
      category: 'productivity',
      tags: ['代码分析', '开发工具', 'AI'],
      icon: null,
      verified: true,
      rating: 4.6,
      downloads: 8921,
      updatedAt: '2026-01-28',
      installed: false,
      installing: false,
      features: ['多语言支持', '安全漏洞检测', '性能建议', 'Git 集成'],
      screenshots: [],
    },
    {
      id: 'data-visualizer',
      name: '数据可视化引擎',
      author: 'VizCraft',
      version: '1.5.0',
      description: '强大的数据可视化插件，支持图表、地图和仪表盘',
      category: 'data',
      tags: ['可视化', '图表', '数据分析'],
      icon: null,
      verified: false,
      rating: 4.3,
      downloads: 5467,
      updatedAt: '2026-01-15',
      installed: false,
      installing: false,
      features: ['20+ 图表类型', '实时数据流', '交互式仪表盘', '数据导出'],
      screenshots: [],
    },
    {
      id: 'notion-sync',
      name: 'Notion 同步器',
      author: 'SyncBridge',
      version: '1.0.3',
      description: '双向同步 Notion 笔记和知识库内容',
      category: 'integration',
      tags: ['Notion', '同步', '知识库'],
      icon: null,
      verified: true,
      rating: 4.5,
      downloads: 12890,
      updatedAt: '2026-02-10',
      installed: false,
      installing: false,
      features: ['双向同步', '冲突解决', '增量更新', '自动调度'],
      screenshots: [],
    },
    {
      id: 'theme-builder',
      name: '主题构建器',
      author: 'UI Workshop',
      version: '1.1.0',
      description: '可视化主题编辑器，自定义界面外观和配色方案',
      category: 'ui',
      tags: ['主题', '界面', '自定义'],
      icon: null,
      verified: false,
      rating: 4.1,
      downloads: 3200,
      updatedAt: '2026-01-20',
      installed: false,
      installing: false,
      features: ['可视化编辑', '实时预览', '主题导入导出', '暗色模式支持'],
      screenshots: [],
    },
    {
      id: 'smart-scheduler',
      name: '智能日程管理',
      author: 'ChainlessChain Team',
      version: '1.3.2',
      description: 'AI 辅助的日程安排和时间管理工具',
      category: 'productivity',
      tags: ['日程', '时间管理', 'AI'],
      icon: null,
      verified: true,
      rating: 4.7,
      downloads: 9876,
      updatedAt: '2026-02-05',
      installed: false,
      installing: false,
      features: ['AI 日程优化', '冲突检测', '提醒通知', '日历同步'],
      screenshots: [],
    },
  ];
}

// ==================== 生命周期 ====================

onMounted(async () => {
  marketplaceLogger.info('PluginMarketplacePage 挂载');
  await Promise.all([fetchCategories(), fetchFeatured(), fetchPlugins()]);
});
</script>

<style scoped lang="scss">
.plugin-marketplace-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }
  }

  .category-section {
    background: white;
    padding: 16px 24px;
    border-radius: 8px;
    margin-bottom: 16px;
  }

  .featured-section {
    margin-bottom: 24px;

    h2 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .featured-scroll {
      display: flex;
      gap: 16px;
      overflow-x: auto;
      padding-bottom: 8px;

      .featured-card {
        min-width: 240px;
        max-width: 280px;
        cursor: pointer;

        .ant-card {
          border-radius: 8px;
        }

        .featured-icon {
          text-align: center;
          margin-bottom: 12px;

          img {
            width: 48px;
            height: 48px;
            object-fit: contain;
          }
        }

        h3 {
          font-size: 16px;
          margin: 0 0 8px 0;
          text-align: center;
        }

        .featured-desc {
          color: #8c8c8c;
          font-size: 13px;
          margin-bottom: 12px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .featured-meta {
          display: flex;
          justify-content: center;
          gap: 16px;
          color: #8c8c8c;
          font-size: 13px;

          span {
            display: flex;
            align-items: center;
            gap: 4px;
          }
        }
      }
    }
  }

  .filter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: white;
    padding: 12px 24px;
    border-radius: 8px;
    margin-bottom: 24px;

    .result-count {
      color: #8c8c8c;
      font-size: 14px;
    }
  }

  .plugin-grid {
    .plugin-card {
      border-radius: 8px;
      height: 100%;

      .plugin-icon {
        text-align: center;
        padding: 16px 0;

        img {
          width: 56px;
          height: 56px;
          object-fit: contain;
        }
      }

      .plugin-name {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;

        h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      .plugin-author {
        color: #8c8c8c;
        font-size: 13px;
        margin-bottom: 8px;

        :deep(.anticon) {
          margin-right: 4px;
        }
      }

      .plugin-description {
        color: #595959;
        font-size: 13px;
        margin-bottom: 12px;
        min-height: 38px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .plugin-stats {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
        color: #8c8c8c;
        font-size: 13px;

        span {
          display: flex;
          align-items: center;
          gap: 4px;
        }
      }

      .plugin-actions {
        margin-top: auto;
      }
    }
  }

  .pagination-section {
    display: flex;
    justify-content: center;
    margin-top: 32px;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
  }
}

// 详情抽屉
.plugin-detail {
  .detail-header {
    display: flex;
    gap: 16px;
    padding-bottom: 20px;
    border-bottom: 1px solid #f0f0f0;

    .detail-title {
      flex: 1;

      h2 {
        margin: 0 0 4px 0;
        font-size: 20px;
      }

      .detail-author {
        color: #8c8c8c;
        margin: 0 0 8px 0;
      }

      .detail-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
    }
  }

  .detail-section {
    margin-top: 24px;

    h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    ul {
      padding-left: 20px;

      li {
        margin-bottom: 8px;
      }
    }
  }

  .screenshots-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;

    img {
      width: 100%;
      border-radius: 4px;
      border: 1px solid #f0f0f0;
    }
  }

  .rating-summary {
    .rating-big {
      display: flex;
      align-items: center;
      gap: 12px;

      .rating-number {
        font-size: 36px;
        font-weight: 700;
        color: #262626;
      }

      .rating-count {
        color: #8c8c8c;
        font-size: 13px;
      }
    }
  }

  .detail-footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
}

// 响应式调整
@media (max-width: 768px) {
  .plugin-marketplace-page {
    padding: 16px;

    .page-header {
      flex-direction: column;
      gap: 16px;

      .header-right {
        width: 100%;

        :deep(.ant-input-search) {
          width: 100% !important;
        }
      }
    }

    .category-section {
      overflow-x: auto;
    }

    .filter-bar {
      flex-direction: column;
      gap: 12px;
      align-items: flex-start;
    }
  }
}
</style>
