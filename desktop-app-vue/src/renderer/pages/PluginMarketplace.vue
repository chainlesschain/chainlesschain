<template>
  <div class="plugin-marketplace">
    <!-- 页面头部 -->
    <div class="marketplace-header">
      <div class="header-content">
        <h1>
          <ShopOutlined />
          插件市场
        </h1>
        <p class="subtitle">发现和安装优质插件，扩展ChainlessChain功能</p>
      </div>

      <!-- 搜索和筛选 -->
      <div class="search-section">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索插件名称、描述或标签..."
          size="large"
          @search="handleSearch"
          style="max-width: 600px"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>
      </div>
    </div>

    <!-- 分类标签 -->
    <div class="category-tabs">
      <a-tabs v-model:activeKey="activeCategory" @change="handleCategoryChange">
        <a-tab-pane key="all" tab="全部插件">
          <template #tab>
            <AppstoreOutlined />
            全部插件
          </template>
        </a-tab-pane>
        <a-tab-pane key="ai" tab="AI增强">
          <template #tab>
            <RobotOutlined />
            AI增强
          </template>
        </a-tab-pane>
        <a-tab-pane key="productivity" tab="效率工具">
          <template #tab>
            <ThunderboltOutlined />
            效率工具
          </template>
        </a-tab-pane>
        <a-tab-pane key="data" tab="数据处理">
          <template #tab>
            <DatabaseOutlined />
            数据处理
          </template>
        </a-tab-pane>
        <a-tab-pane key="integration" tab="第三方集成">
          <template #tab>
            <ApiOutlined />
            第三方集成
          </template>
        </a-tab-pane>
        <a-tab-pane key="ui" tab="界面扩展">
          <template #tab>
            <LayoutOutlined />
            界面扩展
          </template>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 筛选和排序 -->
    <div class="filter-bar">
      <a-space>
        <a-select
          v-model:value="sortBy"
          style="width: 150px"
          @change="handleSortChange"
        >
          <a-select-option value="popular">最受欢迎</a-select-option>
          <a-select-option value="recent">最新发布</a-select-option>
          <a-select-option value="rating">评分最高</a-select-option>
          <a-select-option value="downloads">下载最多</a-select-option>
        </a-select>

        <a-checkbox v-model:checked="showInstalledOnly">
          仅显示已安装
        </a-checkbox>

        <a-checkbox v-model:checked="showVerifiedOnly">
          仅显示已验证
        </a-checkbox>
      </a-space>

      <div class="view-toggle">
        <a-radio-group v-model:value="viewMode" button-style="solid">
          <a-radio-button value="grid">
            <AppstoreOutlined />
          </a-radio-button>
          <a-radio-button value="list">
            <UnorderedListOutlined />
          </a-radio-button>
        </a-radio-group>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="加载插件中..." />
    </div>

    <!-- 插件列表 - 网格视图 -->
    <div v-else-if="viewMode === 'grid'" class="plugin-grid">
      <a-card
        v-for="plugin in filteredPlugins"
        :key="plugin.id"
        class="plugin-card"
        hoverable
        @click="showPluginDetail(plugin)"
      >
        <!-- 插件图标 -->
        <div class="plugin-icon">
          <img v-if="plugin.icon" :src="plugin.icon" :alt="plugin.name" />
          <AppstoreOutlined v-else style="font-size: 48px; color: #1890ff" />
        </div>

        <!-- 插件信息 -->
        <div class="plugin-info">
          <div class="plugin-header">
            <h3>{{ plugin.name }}</h3>
            <a-tag v-if="plugin.verified" color="blue">
              <SafetyCertificateOutlined />
              已验证
            </a-tag>
          </div>

          <p class="plugin-description">{{ plugin.description }}</p>

          <!-- 标签 -->
          <div class="plugin-tags">
            <a-tag v-for="tag in plugin.tags" :key="tag" color="default">
              {{ tag }}
            </a-tag>
          </div>

          <!-- 统计信息 -->
          <div class="plugin-stats">
            <span>
              <StarFilled style="color: #faad14" />
              {{ plugin.rating || 0 }}
            </span>
            <span>
              <DownloadOutlined />
              {{ formatNumber(plugin.downloads || 0) }}
            </span>
            <span>
              <ClockCircleOutlined />
              {{ plugin.version }}
            </span>
          </div>

          <!-- 操作按钮 -->
          <div class="plugin-actions">
            <a-button
              v-if="!plugin.installed"
              type="primary"
              @click.stop="installPlugin(plugin)"
              :loading="plugin.installing"
            >
              <DownloadOutlined />
              安装
            </a-button>
            <a-button
              v-else
              type="default"
              @click.stop="managePlugin(plugin)"
            >
              <SettingOutlined />
              管理
            </a-button>
          </div>
        </div>
      </a-card>
    </div>

    <!-- 插件列表 - 列表视图 -->
    <div v-else class="plugin-list">
      <a-list
        :data-source="filteredPlugins"
        :pagination="{ pageSize: 10 }"
      >
        <template #renderItem="{ item: plugin }">
          <a-list-item>
            <a-list-item-meta>
              <template #avatar>
                <a-avatar :size="64" :src="plugin.icon">
                  <template #icon><AppstoreOutlined /></template>
                </a-avatar>
              </template>
              <template #title>
                <a @click="showPluginDetail(plugin)">
                  {{ plugin.name }}
                  <a-tag v-if="plugin.verified" color="blue" style="margin-left: 8px">
                    <SafetyCertificateOutlined />
                    已验证
                  </a-tag>
                </a>
              </template>
              <template #description>
                <div>
                  <p>{{ plugin.description }}</p>
                  <div class="list-plugin-meta">
                    <span>
                      <StarFilled style="color: #faad14" />
                      {{ plugin.rating || 0 }}
                    </span>
                    <span>
                      <DownloadOutlined />
                      {{ formatNumber(plugin.downloads || 0) }}
                    </span>
                    <span>
                      <UserOutlined />
                      {{ plugin.author }}
                    </span>
                    <span>
                      <ClockCircleOutlined />
                      v{{ plugin.version }}
                    </span>
                  </div>
                </div>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button
                v-if="!plugin.installed"
                type="primary"
                @click="installPlugin(plugin)"
                :loading="plugin.installing"
              >
                <DownloadOutlined />
                安装
              </a-button>
              <a-button
                v-else
                type="default"
                @click="managePlugin(plugin)"
              >
                <SettingOutlined />
                管理
              </a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </div>

    <!-- 插件详情抽屉 -->
    <a-drawer
      v-model:open="detailDrawerVisible"
      title="插件详情"
      width="600"
      :footer-style="{ textAlign: 'right' }"
    >
      <div v-if="selectedPlugin" class="plugin-detail">
        <!-- 插件头部 -->
        <div class="detail-header">
          <a-avatar :size="80" :src="selectedPlugin.icon">
            <template #icon><AppstoreOutlined /></template>
          </a-avatar>
          <div class="detail-title">
            <h2>{{ selectedPlugin.name }}</h2>
            <p>{{ selectedPlugin.author }}</p>
            <div class="detail-badges">
              <a-tag v-if="selectedPlugin.verified" color="blue">
                <SafetyCertificateOutlined />
                已验证
              </a-tag>
              <a-tag v-if="selectedPlugin.installed" color="green">
                <CheckCircleOutlined />
                已安装
              </a-tag>
            </div>
          </div>
        </div>

        <!-- 统计信息 -->
        <a-descriptions :column="2" bordered size="small" style="margin-top: 24px">
          <a-descriptions-item label="版本">
            {{ selectedPlugin.version }}
          </a-descriptions-item>
          <a-descriptions-item label="评分">
            <a-rate :value="selectedPlugin.rating" disabled allow-half />
            {{ selectedPlugin.rating }}
          </a-descriptions-item>
          <a-descriptions-item label="下载量">
            {{ formatNumber(selectedPlugin.downloads || 0) }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatDate(selectedPlugin.updatedAt) }}
          </a-descriptions-item>
          <a-descriptions-item label="分类" :span="2">
            <a-tag v-for="tag in selectedPlugin.tags" :key="tag">
              {{ tag }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 插件描述 -->
        <div class="detail-section">
          <h3>插件介绍</h3>
          <p>{{ selectedPlugin.description }}</p>
          <div v-if="selectedPlugin.longDescription" v-html="selectedPlugin.longDescription"></div>
        </div>

        <!-- 功能特性 -->
        <div v-if="selectedPlugin.features" class="detail-section">
          <h3>功能特性</h3>
          <ul>
            <li v-for="(feature, index) in selectedPlugin.features" :key="index">
              {{ feature }}
            </li>
          </ul>
        </div>

        <!-- 权限要求 -->
        <div v-if="selectedPlugin.permissions" class="detail-section">
          <h3>权限要求</h3>
          <a-alert
            message="此插件需要以下权限"
            type="info"
            show-icon
            style="margin-bottom: 12px"
          />
          <a-list
            size="small"
            :data-source="selectedPlugin.permissions"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <SafetyOutlined style="margin-right: 8px" />
                {{ getPermissionDescription(item) }}
              </a-list-item>
            </template>
          </a-list>
        </div>

        <!-- 截图 -->
        <div v-if="selectedPlugin.screenshots" class="detail-section">
          <h3>截图预览</h3>
          <div class="screenshots">
            <img
              v-for="(screenshot, index) in selectedPlugin.screenshots"
              :key="index"
              :src="screenshot"
              :alt="`Screenshot ${index + 1}`"
            />
          </div>
        </div>

        <!-- 更新日志 -->
        <div v-if="selectedPlugin.changelog" class="detail-section">
          <h3>更新日志</h3>
          <a-timeline>
            <a-timeline-item
              v-for="(change, index) in selectedPlugin.changelog"
              :key="index"
            >
              <strong>{{ change.version }}</strong> - {{ formatDate(change.date) }}
              <p>{{ change.description }}</p>
            </a-timeline-item>
          </a-timeline>
        </div>
      </div>

      <template #footer>
        <a-space>
          <a-button @click="detailDrawerVisible = false">关闭</a-button>
          <a-button
            v-if="!selectedPlugin.installed"
            type="primary"
            @click="installPlugin(selectedPlugin)"
            :loading="selectedPlugin.installing"
          >
            <DownloadOutlined />
            安装插件
          </a-button>
          <a-button
            v-else
            type="default"
            @click="managePlugin(selectedPlugin)"
          >
            <SettingOutlined />
            管理插件
          </a-button>
        </a-space>
      </template>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  ShopOutlined,
  SearchOutlined,
  AppstoreOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  ApiOutlined,
  LayoutOutlined,
  UnorderedListOutlined,
  StarFilled,
  DownloadOutlined,
  ClockCircleOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  UserOutlined,
  SafetyOutlined,
} from '@ant-design/icons-vue';

// 状态
const loading = ref(false);
const searchQuery = ref('');
const activeCategory = ref('all');
const sortBy = ref('popular');
const showInstalledOnly = ref(false);
const showVerifiedOnly = ref(false);
const viewMode = ref('grid');
const plugins = ref([]);
const selectedPlugin = ref(null);
const detailDrawerVisible = ref(false);

// 计算属性 - 过滤后的插件列表
const filteredPlugins = computed(() => {
  let result = [...plugins.value];

  // 分类筛选
  if (activeCategory.value !== 'all') {
    result = result.filter(p => p.category === activeCategory.value);
  }

  // 搜索筛选
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }

  // 已安装筛选
  if (showInstalledOnly.value) {
    result = result.filter(p => p.installed);
  }

  // 已验证筛选
  if (showVerifiedOnly.value) {
    result = result.filter(p => p.verified);
  }

  // 排序
  switch (sortBy.value) {
    case 'popular':
      result.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      break;
    case 'recent':
      result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
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

// 方法
const loadPlugins = async () => {
  loading.value = true;
  try {
    // TODO: 从插件市场API加载插件列表
    // const result = await window.electronAPI.plugin.fetchMarketplacePlugins();

    // 模拟数据
    plugins.value = await getMockPlugins();

    // 检查已安装的插件
    const installed = await window.electronAPI.plugin.listPlugins();
    const installedIds = new Set(installed.map(p => p.id));

    plugins.value.forEach(p => {
      p.installed = installedIds.has(p.id);
      p.installing = false;
    });
  } catch (error) {
    message.error('加载插件列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  // 搜索已在computed中处理
};

const handleCategoryChange = () => {
  // 分类切换已在computed中处理
};

const handleSortChange = () => {
  // 排序已在computed中处理
};

const showPluginDetail = (plugin) => {
  selectedPlugin.value = plugin;
  detailDrawerVisible.value = true;
};

const installPlugin = async (plugin) => {
  try {
    plugin.installing = true;

    // TODO: 从市场下载并安装插件
    // await window.electronAPI.plugin.installFromMarketplace(plugin.id);

    message.success(`插件 "${plugin.name}" 安装成功！`);
    plugin.installed = true;

    // 刷新插件列表
    await loadPlugins();
  } catch (error) {
    message.error('安装失败: ' + error.message);
  } finally {
    plugin.installing = false;
  }
};

const managePlugin = (plugin) => {
  // 跳转到插件管理页面
  // TODO: 实现路由跳转
  message.info('跳转到插件管理页面');
};

const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('zh-CN');
};

const getPermissionDescription = (permission) => {
  const descriptions = {
    'database:read': '读取数据库',
    'database:write': '写入数据库',
    'llm:query': '调用AI模型',
    'rag:search': '搜索知识库',
    'file:read': '读取文件',
    'file:write': '写入文件',
    'network:request': '访问网络',
    'ui:register': '注册界面组件',
    'system:notification': '发送系统通知',
  };
  return descriptions[permission] || permission;
};

// 模拟数据
const getMockPlugins = async () => {
  return [
    {
      id: 'translator-plugin',
      name: '多语言翻译器',
      author: 'ChainlessChain Team',
      version: '1.0.0',
      description: '支持多种语言的智能翻译插件，集成主流翻译API',
      longDescription: '<p>这是一个功能强大的翻译插件...</p>',
      category: 'ai',
      tags: ['翻译', 'AI', '多语言'],
      icon: null,
      verified: true,
      rating: 4.8,
      downloads: 15234,
      updatedAt: '2026-01-05',
      permissions: ['llm:query', 'network:request'],
      features: [
        '支持50+种语言互译',
        '智能上下文理解',
        '批量翻译功能',
        '自定义术语表'
      ],
      screenshots: [],
      changelog: [
        { version: '1.0.0', date: '2026-01-05', description: '首次发布' }
      ]
    },
    // 更多插件...
  ];
};

// 生命周期
onMounted(() => {
  loadPlugins();
});
</script>

<style scoped lang="less">
.plugin-marketplace {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;
}

.marketplace-header {
  background: white;
  padding: 32px;
  border-radius: 8px;
  margin-bottom: 24px;

  .header-content {
    h1 {
      font-size: 32px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .subtitle {
      color: #666;
      font-size: 16px;
      margin-bottom: 24px;
    }
  }
}

.category-tabs {
  background: white;
  padding: 0 24px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
  padding: 16px 24px;
  border-radius: 8px;
  margin-bottom: 24px;
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.plugin-card {
  .plugin-icon {
    text-align: center;
    padding: 24px 0;

    img {
      width: 64px;
      height: 64px;
      object-fit: contain;
    }
  }

  .plugin-info {
    .plugin-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;

      h3 {
        margin: 0;
        font-size: 18px;
      }
    }

    .plugin-description {
      color: #666;
      margin-bottom: 12px;
      min-height: 40px;
    }

    .plugin-tags {
      margin-bottom: 12px;
    }

    .plugin-stats {
      display: flex;
      gap: 16px;
      color: #999;
      font-size: 14px;
      margin-bottom: 16px;

      span {
        display: flex;
        align-items: center;
        gap: 4px;
      }
    }

    .plugin-actions {
      button {
        width: 100%;
      }
    }
  }
}

.plugin-list {
  background: white;
  border-radius: 8px;
  padding: 24px;

  .list-plugin-meta {
    display: flex;
    gap: 16px;
    margin-top: 8px;
    color: #999;
    font-size: 14px;

    span {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }
}

.plugin-detail {
  .detail-header {
    display: flex;
    gap: 16px;
    padding-bottom: 24px;
    border-bottom: 1px solid #f0f0f0;

    .detail-title {
      flex: 1;

      h2 {
        margin: 0 0 4px 0;
      }

      p {
        color: #666;
        margin: 0 0 8px 0;
      }
    }
  }

  .detail-section {
    margin-top: 24px;

    h3 {
      font-size: 16px;
      margin-bottom: 12px;
    }

    ul {
      padding-left: 20px;

      li {
        margin-bottom: 8px;
      }
    }
  }

  .screenshots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;

    img {
      width: 100%;
      border-radius: 4px;
      border: 1px solid #f0f0f0;
    }
  }
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}
</style>
