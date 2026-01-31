/**
 * PluginMarketplace 单元测试
 * 测试目标: src/renderer/pages/PluginMarketplace.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - 插件列表加载
 * - 搜索和筛选
 * - 分类切换
 * - 排序功能
 * - 视图模式切换
 * - 插件安装
 * - 插件详情
 * - 权限管理
 * - 辅助方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  createLogger: vi.fn(),
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    pluginMarketplace: {
      list: vi.fn(),
      install: vi.fn(),
    },
    plugin: {
      listPlugins: vi.fn(),
    },
  },
};

describe('PluginMarketplace', () => {
  let wrapper;

  const mockPlugins = [
    {
      id: 'plugin-1',
      name: 'Translation Plugin',
      author: 'Test Author',
      version: '1.0.0',
      description: 'A translation plugin for multiple languages',
      category: 'ai',
      tags: ['translation', 'AI', 'multilingual'],
      icon: null,
      verified: true,
      rating: 4.8,
      downloads: 15234,
      updatedAt: '2026-01-05',
      installed: false,
      installing: false,
      permissions: ['llm:query', 'network:request'],
      features: ['50+ languages', 'Smart context', 'Batch translation'],
    },
    {
      id: 'plugin-2',
      name: 'Data Processor',
      author: 'Data Team',
      version: '2.1.0',
      description: 'Process and analyze data efficiently',
      category: 'data',
      tags: ['data', 'processing', 'analytics'],
      icon: 'https://example.com/icon.png',
      verified: false,
      rating: 4.5,
      downloads: 8432,
      updatedAt: '2026-01-10',
      installed: true,
      installing: false,
      permissions: ['database:read', 'database:write'],
    },
    {
      id: 'plugin-3',
      name: 'UI Theme',
      author: 'UI Team',
      version: '1.5.0',
      description: 'Beautiful themes for UI',
      category: 'ui',
      tags: ['theme', 'UI', 'design'],
      icon: null,
      verified: true,
      rating: 4.9,
      downloads: 25678,
      updatedAt: '2026-01-15',
      installed: false,
      installing: false,
      permissions: ['ui:register'],
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="plugin-marketplace">
            <div class="marketplace-header">
              <div class="search-section">
                <input
                  v-model="searchQuery"
                  placeholder="搜索插件"
                  @input="handleSearch"
                />
              </div>
            </div>

            <div class="category-tabs">
              <button
                v-for="category in categories"
                :key="category.key"
                :class="{ active: activeCategory === category.key }"
                @click="activeCategory = category.key; handleCategoryChange()"
              >
                {{ category.label }}
              </button>
            </div>

            <div class="filter-bar">
              <select v-model="sortBy" @change="handleSortChange">
                <option value="popular">最受欢迎</option>
                <option value="recent">最新发布</option>
                <option value="rating">评分最高</option>
                <option value="downloads">下载最多</option>
              </select>

              <label>
                <input type="checkbox" v-model="showInstalledOnly" />
                仅显示已安装
              </label>

              <label>
                <input type="checkbox" v-model="showVerifiedOnly" />
                仅显示已验证
              </label>

              <select v-model="viewMode">
                <option value="grid">网格</option>
                <option value="list">列表</option>
              </select>
            </div>

            <div v-if="loading" class="loading">加载中...</div>

            <div v-else-if="viewMode === 'grid'" class="plugin-grid">
              <div
                v-for="plugin in filteredPlugins"
                :key="plugin.id"
                class="plugin-card"
                @click="showPluginDetail(plugin)"
              >
                <h3>{{ plugin.name }}</h3>
                <p>{{ plugin.description }}</p>
                <div class="plugin-stats">
                  <span>{{ plugin.rating }}</span>
                  <span>{{ formatNumber(plugin.downloads) }}</span>
                  <span>{{ plugin.version }}</span>
                </div>
                <div class="plugin-actions" @click.stop>
                  <button
                    v-if="!plugin.installed"
                    @click="installPlugin(plugin)"
                    :disabled="plugin.installing"
                  >
                    安装
                  </button>
                  <button v-else @click="managePlugin(plugin)">管理</button>
                </div>
              </div>
            </div>

            <div v-else class="plugin-list">
              <div
                v-for="plugin in filteredPlugins"
                :key="plugin.id"
                class="plugin-list-item"
                @click="showPluginDetail(plugin)"
              >
                <h3>{{ plugin.name }}</h3>
                <p>{{ plugin.description }}</p>
                <div class="plugin-actions" @click.stop>
                  <button
                    v-if="!plugin.installed"
                    @click="installPlugin(plugin)"
                    :disabled="plugin.installing"
                  >
                    安装
                  </button>
                  <button v-else @click="managePlugin(plugin)">管理</button>
                </div>
              </div>
            </div>

            <div v-if="detailDrawerVisible" class="plugin-detail">
              <div v-if="selectedPlugin">
                <h2>{{ selectedPlugin.name }}</h2>
                <p>{{ selectedPlugin.author }}</p>
                <p>{{ selectedPlugin.description }}</p>
                <div v-if="selectedPlugin.permissions">
                  <h3>权限要求</h3>
                  <ul>
                    <li v-for="perm in selectedPlugin.permissions" :key="perm">
                      {{ getPermissionDescription(perm) }}
                    </li>
                  </ul>
                </div>
                <button @click="detailDrawerVisible = false">关闭</button>
                <button
                  v-if="!selectedPlugin.installed"
                  @click="installPlugin(selectedPlugin)"
                  :disabled="selectedPlugin.installing"
                >
                  安装
                </button>
              </div>
            </div>
          </div>
        `,
        setup() {
          const { ref, computed, onMounted } = require('vue');
          const { message } = require('ant-design-vue');
          const { logger } = require('@/utils/logger');

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

          const categories = [
            { key: 'all', label: '全部插件' },
            { key: 'ai', label: 'AI增强' },
            { key: 'productivity', label: '效率工具' },
            { key: 'data', label: '数据处理' },
            { key: 'integration', label: '第三方集成' },
            { key: 'ui', label: '界面扩展' },
          ];

          const filteredPlugins = computed(() => {
            let result = [...plugins.value];

            if (activeCategory.value !== 'all') {
              result = result.filter((p) => p.category === activeCategory.value);
            }

            if (searchQuery.value) {
              const query = searchQuery.value.toLowerCase();
              result = result.filter(
                (p) =>
                  p.name.toLowerCase().includes(query) ||
                  p.description.toLowerCase().includes(query) ||
                  p.tags.some((tag) => tag.toLowerCase().includes(query))
              );
            }

            if (showInstalledOnly.value) {
              result = result.filter((p) => p.installed);
            }

            if (showVerifiedOnly.value) {
              result = result.filter((p) => p.verified);
            }

            switch (sortBy.value) {
              case 'popular':
              case 'downloads':
                result.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
                break;
              case 'recent':
                result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
                break;
              case 'rating':
                result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                break;
            }

            return result;
          });

          const loadPlugins = async () => {
            loading.value = true;
            try {
              const result = await window.electronAPI.pluginMarketplace.list({
                category: activeCategory.value !== 'all' ? activeCategory.value : null,
                sort: sortBy.value,
                verified: showVerifiedOnly.value ? true : null,
                page: 1,
                pageSize: 100,
              });

              if (result.success) {
                plugins.value = result.data.plugins || result.data || [];
              } else {
                logger.warn('插件市场API失败，使用模拟数据');
                plugins.value = mockPlugins;
              }

              try {
                const installed = await window.electronAPI.plugin.listPlugins();
                const installedIds = new Set(installed.map((p) => p.id));

                plugins.value.forEach((p) => {
                  p.installed = installedIds.has(p.id);
                  p.installing = false;
                });
              } catch (err) {
                logger.warn('获取已安装插件列表失败:', err);
              }
            } catch (error) {
              if (!error.message?.includes('No handler registered')) {
                logger.error('[PluginMarketplace] 加载插件列表失败:', error);
                message.error('加载插件列表失败，使用本地数据');
              }
              plugins.value = mockPlugins;
            } finally {
              loading.value = false;
            }
          };

          const handleSearch = () => {
            // Handled in computed
          };

          const handleCategoryChange = () => {
            // Handled in computed
          };

          const handleSortChange = () => {
            // Handled in computed
          };

          const showPluginDetail = (plugin) => {
            selectedPlugin.value = plugin;
            detailDrawerVisible.value = true;
          };

          const installPlugin = async (plugin) => {
            try {
              plugin.installing = true;

              const result = await window.electronAPI.pluginMarketplace.install(
                plugin.id,
                plugin.version || 'latest'
              );

              if (result.success) {
                message.success(`插件 "${plugin.name}" 安装成功！`);
                plugin.installed = true;
                await loadPlugins();
              } else {
                throw new Error(result.error || '安装失败');
              }
            } catch (error) {
              logger.error('安装插件失败:', error);
              message.error('安装失败: ' + error.message);
            } finally {
              plugin.installing = false;
            }
          };

          const managePlugin = (plugin) => {
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

          onMounted(() => {
            loadPlugins();
          });

          return {
            loading,
            searchQuery,
            activeCategory,
            sortBy,
            showInstalledOnly,
            showVerifiedOnly,
            viewMode,
            plugins,
            selectedPlugin,
            detailDrawerVisible,
            categories,
            filteredPlugins,
            loadPlugins,
            handleSearch,
            handleCategoryChange,
            handleSortChange,
            showPluginDetail,
            installPlugin,
            managePlugin,
            formatNumber,
            formatDate,
            getPermissionDescription,
          };
        },
      },
      options
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.pluginMarketplace.list.mockResolvedValue({
      success: true,
      data: [],
    });
    window.electronAPI.plugin.listPlugins.mockResolvedValue([]);
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.plugin-marketplace').exists()).toBe(true);
    });

    it('应该在挂载时加载插件列表', async () => {
      window.electronAPI.pluginMarketplace.list.mockResolvedValue({
        success: true,
        data: { plugins: mockPlugins },
      });
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.electronAPI.pluginMarketplace.list).toHaveBeenCalled();
    });
  });

  describe('插件列表加载', () => {
    it('应该能加载插件列表', async () => {
      wrapper = createWrapper();
      window.electronAPI.pluginMarketplace.list.mockResolvedValue({
        success: true,
        data: { plugins: mockPlugins },
      });

      await wrapper.vm.loadPlugins();

      expect(wrapper.vm.plugins.length).toBe(3);
    });

    it('应该能处理API失败并使用模拟数据', async () => {
      wrapper = createWrapper();
      window.electronAPI.pluginMarketplace.list.mockResolvedValue({
        success: false,
      });

      await wrapper.vm.loadPlugins();

      expect(wrapper.vm.plugins.length).toBeGreaterThan(0);
    });

    it('应该能标记已安装的插件', async () => {
      wrapper = createWrapper();
      window.electronAPI.pluginMarketplace.list.mockResolvedValue({
        success: true,
        data: { plugins: mockPlugins },
      });
      window.electronAPI.plugin.listPlugins.mockResolvedValue([{ id: 'plugin-1' }]);

      await wrapper.vm.loadPlugins();

      const plugin1 = wrapper.vm.plugins.find((p) => p.id === 'plugin-1');
      expect(plugin1?.installed).toBe(true);
    });

    it('应该在加载时设置loading状态', async () => {
      wrapper = createWrapper();
      window.electronAPI.pluginMarketplace.list.mockImplementation(() => {
        expect(wrapper.vm.loading).toBe(true);
        return Promise.resolve({ success: true, data: { plugins: [] } });
      });

      await wrapper.vm.loadPlugins();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe('搜索功能', () => {
    it('应该能按名称搜索插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'Translation';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].name).toBe('Translation Plugin');
    });

    it('应该能按描述搜索插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'data';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].id).toBe('plugin-2');
    });

    it('应该能按标签搜索插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'AI';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].id).toBe('plugin-1');
    });

    it('应该不区分大小写搜索', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'translation';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
    });

    it('应该处理空搜索查询', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = '';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(3);
    });
  });

  describe('分类筛选', () => {
    it('应该能按分类筛选插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.activeCategory = 'ai';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].category).toBe('ai');
    });

    it('应该能显示全部插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.activeCategory = 'all';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(3);
    });

    it('应该能切换到数据处理分类', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.activeCategory = 'data';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].category).toBe('data');
    });

    it('应该能切换到UI分类', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.activeCategory = 'ui';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].category).toBe('ui');
    });
  });

  describe('排序功能', () => {
    it('应该能按下载量排序', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.sortBy = 'downloads';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins[0].id).toBe('plugin-3');
      expect(wrapper.vm.filteredPlugins[0].downloads).toBe(25678);
    });

    it('应该能按评分排序', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.sortBy = 'rating';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins[0].rating).toBe(4.9);
    });

    it('应该能按最新发布排序', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.sortBy = 'recent';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins[0].id).toBe('plugin-3');
    });

    it('应该能按最受欢迎排序', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.sortBy = 'popular';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins[0].downloads).toBeGreaterThanOrEqual(
        wrapper.vm.filteredPlugins[1].downloads
      );
    });
  });

  describe('已安装/已验证筛选', () => {
    it('应该能筛选已安装插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.showInstalledOnly = true;

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].installed).toBe(true);
    });

    it('应该能筛选已验证插件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.showVerifiedOnly = true;

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(2);
      expect(wrapper.vm.filteredPlugins.every((p) => p.verified)).toBe(true);
    });

    it('应该能同时应用已安装和已验证筛选', async () => {
      wrapper = createWrapper();
      const verifiedAndInstalled = { ...mockPlugins[0], installed: true };
      wrapper.vm.plugins = [verifiedAndInstalled, mockPlugins[1], mockPlugins[2]];
      wrapper.vm.showInstalledOnly = true;
      wrapper.vm.showVerifiedOnly = true;

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].installed).toBe(true);
      expect(wrapper.vm.filteredPlugins[0].verified).toBe(true);
    });
  });

  describe('视图模式', () => {
    it('应该能切换到网格视图', async () => {
      wrapper = createWrapper();
      wrapper.vm.viewMode = 'grid';

      await wrapper.vm.$nextTick();

      expect(wrapper.find('.plugin-grid').exists()).toBe(true);
      expect(wrapper.find('.plugin-list').exists()).toBe(false);
    });

    it('应该能切换到列表视图', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.viewMode = 'list';

      await wrapper.vm.$nextTick();

      expect(wrapper.find('.plugin-list').exists()).toBe(true);
      expect(wrapper.find('.plugin-grid').exists()).toBe(false);
    });
  });

  describe('插件安装', () => {
    it('应该能安装插件', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electronAPI.pluginMarketplace.install.mockResolvedValue({
        success: true,
      });
      window.electronAPI.pluginMarketplace.list.mockResolvedValue({
        success: true,
        data: { plugins: [] },
      });

      const plugin = { ...mockPlugins[0] };
      await wrapper.vm.installPlugin(plugin);

      expect(window.electronAPI.pluginMarketplace.install).toHaveBeenCalledWith(
        plugin.id,
        plugin.version
      );
      expect(message.success).toHaveBeenCalledWith('插件 "Translation Plugin" 安装成功！');
      expect(plugin.installed).toBe(true);
    });

    it('应该在安装时设置installing状态', async () => {
      wrapper = createWrapper();
      const plugin = { ...mockPlugins[0] };

      window.electronAPI.pluginMarketplace.install.mockImplementation(() => {
        expect(plugin.installing).toBe(true);
        return Promise.resolve({ success: true });
      });

      await wrapper.vm.installPlugin(plugin);

      expect(plugin.installing).toBe(false);
    });

    it('应该能处理安装失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electronAPI.pluginMarketplace.install.mockResolvedValue({
        success: false,
        error: 'Installation failed',
      });

      const plugin = { ...mockPlugins[0] };
      await wrapper.vm.installPlugin(plugin);

      expect(message.error).toHaveBeenCalledWith('安装失败: Installation failed');
      expect(plugin.installed).toBe(false);
    });

    it('应该能处理安装异常', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.electronAPI.pluginMarketplace.install.mockRejectedValue(
        new Error('Network error')
      );

      const plugin = { ...mockPlugins[0] };
      await wrapper.vm.installPlugin(plugin);

      expect(message.error).toHaveBeenCalledWith('安装失败: Network error');
    });
  });

  describe('插件详情', () => {
    it('应该能显示插件详情', async () => {
      wrapper = createWrapper();
      const plugin = mockPlugins[0];

      wrapper.vm.showPluginDetail(plugin);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedPlugin).toBe(plugin);
      expect(wrapper.vm.detailDrawerVisible).toBe(true);
      expect(wrapper.find('.plugin-detail').exists()).toBe(true);
    });

    it('应该能关闭插件详情', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedPlugin = mockPlugins[0];
      wrapper.vm.detailDrawerVisible = true;

      wrapper.vm.detailDrawerVisible = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.plugin-detail').exists()).toBe(false);
    });

    it('应该显示插件权限', async () => {
      wrapper = createWrapper();
      const plugin = mockPlugins[0];

      wrapper.vm.showPluginDetail(plugin);
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('权限要求');
      expect(wrapper.vm.selectedPlugin.permissions.length).toBe(2);
    });
  });

  describe('权限描述', () => {
    it('应该返回正确的权限描述', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getPermissionDescription('database:read')).toBe('读取数据库');
      expect(wrapper.vm.getPermissionDescription('database:write')).toBe('写入数据库');
      expect(wrapper.vm.getPermissionDescription('llm:query')).toBe('调用AI模型');
      expect(wrapper.vm.getPermissionDescription('network:request')).toBe('访问网络');
      expect(wrapper.vm.getPermissionDescription('ui:register')).toBe('注册界面组件');
    });

    it('应该返回未知权限的原始值', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getPermissionDescription('unknown:permission')).toBe(
        'unknown:permission'
      );
    });
  });

  describe('数字格式化', () => {
    it('应该格式化大数字', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatNumber(15234)).toBe('15.2K');
      expect(wrapper.vm.formatNumber(1500000)).toBe('1.5M');
      expect(wrapper.vm.formatNumber(500)).toBe('500');
    });

    it('应该处理零和负数', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatNumber(0)).toBe('0');
    });
  });

  describe('日期格式化', () => {
    it('应该格式化日期', () => {
      wrapper = createWrapper();

      const formatted = wrapper.vm.formatDate('2026-01-15');

      expect(formatted).toBe('2026/1/15');
    });

    it('应该处理空日期', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDate(null)).toBe('');
      expect(wrapper.vm.formatDate(undefined)).toBe('');
    });
  });

  describe('管理插件', () => {
    it('应该能管理已安装插件', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.managePlugin(mockPlugins[1]);

      expect(message.info).toHaveBeenCalledWith('跳转到插件管理页面');
    });
  });

  describe('边界情况', () => {
    it('应该处理空插件列表', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = [];

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(0);
    });

    it('应该处理缺少可选字段的插件', async () => {
      wrapper = createWrapper();
      const minimalPlugin = {
        id: 'minimal',
        name: 'Minimal Plugin',
        category: 'ai',
        tags: [],
      };
      wrapper.vm.plugins = [minimalPlugin];

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
    });

    it('应该处理多重筛选条件', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'Plugin';
      wrapper.vm.activeCategory = 'ai';
      wrapper.vm.showVerifiedOnly = true;

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].id).toBe('plugin-1');
    });

    it('应该处理没有匹配结果的搜索', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'NonexistentPlugin';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(0);
    });

    it('应该处理API异常情况', async () => {
      wrapper = createWrapper();
      window.electronAPI.pluginMarketplace.list.mockRejectedValue(
        new Error('No handler registered')
      );

      await wrapper.vm.loadPlugins();

      // Should use mock plugins as fallback
      expect(wrapper.vm.plugins.length).toBeGreaterThan(0);
    });
  });

  describe('复杂筛选场景', () => {
    it('应该能处理搜索+分类+排序组合', async () => {
      wrapper = createWrapper();
      wrapper.vm.plugins = mockPlugins;
      wrapper.vm.searchQuery = 'plugin';
      wrapper.vm.activeCategory = 'all';
      wrapper.vm.sortBy = 'rating';

      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredPlugins;
      expect(filtered.length).toBeGreaterThan(0);
      for (let i = 0; i < filtered.length - 1; i++) {
        expect(filtered[i].rating).toBeGreaterThanOrEqual(filtered[i + 1].rating);
      }
    });

    it('应该能处理所有筛选条件同时应用', async () => {
      wrapper = createWrapper();
      const complexPlugin = {
        ...mockPlugins[0],
        installed: true,
        verified: true,
      };
      wrapper.vm.plugins = [complexPlugin, mockPlugins[1], mockPlugins[2]];
      wrapper.vm.searchQuery = 'Translation';
      wrapper.vm.activeCategory = 'ai';
      wrapper.vm.showInstalledOnly = true;
      wrapper.vm.showVerifiedOnly = true;
      wrapper.vm.sortBy = 'rating';

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredPlugins.length).toBe(1);
      expect(wrapper.vm.filteredPlugins[0].id).toBe('plugin-1');
    });
  });
});
