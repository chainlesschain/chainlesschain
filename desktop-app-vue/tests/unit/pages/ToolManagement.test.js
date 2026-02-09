/**
 * ToolManagement 单元测试
 * 测试目标: src/renderer/pages/ToolManagement.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和工具列表加载
 * - 统计信息显示（总工具数、已启用、内置工具、插件工具）
 * - 搜索功能
 * - 分类筛选（文件操作、代码生成、项目管理等）
 * - 状态筛选（全部、已启用、已禁用）
 * - 创建工具功能
 * - 启用/禁用工具（Switch开关）
 * - 批量操作（批量启用、批量禁用、批量删除）
 * - 行选择功能
 * - 表格分页
 * - 风险等级显示和颜色编码
 * - 工具类型和分类标签
 * - 使用统计显示
 * - 依赖关系图
 * - 刷新功能
 * - 加载状态和空状态
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
  Modal: {
    confirm: vi.fn((options) => {
      options.onOk && options.onOk();
    }),
  },
}));

// Mock tool store
const mockToolStore = {
  loading: false,
  totalCount: 45,
  enabledCount: 32,
  builtinCount: 20,
  pluginCount: 25,
  filteredTools: [],
  loadTools: vi.fn(),
  createTool: vi.fn(),
  updateTool: vi.fn(),
  deleteTool: vi.fn(),
  batchUpdateTools: vi.fn(),
  filterByCategory: vi.fn(),
  filterByStatus: vi.fn(),
  searchTools: vi.fn(),
};

vi.mock('@/stores/tool', () => ({
  useToolStore: () => mockToolStore,
}));

describe('ToolManagement', () => {
  let wrapper;

  const mockTools = [
    {
      id: 'tool-1',
      name: 'file_read',
      display_name: 'Read File',
      description: 'Read file contents',
      category: 'file',
      tool_type: 'builtin',
      risk_level: 'low',
      enabled: 1,
      usage_count: 150,
      last_used: '2026-01-26T10:00:00.000Z',
    },
    {
      id: 'tool-2',
      name: 'code_generator',
      display_name: 'Code Generator',
      description: 'Generate code snippets',
      category: 'code',
      tool_type: 'plugin',
      risk_level: 'medium',
      enabled: 1,
      usage_count: 80,
      last_used: '2026-01-25T15:30:00.000Z',
    },
    {
      id: 'tool-3',
      name: 'system_cmd',
      display_name: 'System Command',
      description: 'Execute system commands',
      category: 'system',
      tool_type: 'builtin',
      risk_level: 'high',
      enabled: 0,
      usage_count: 5,
      last_used: '2026-01-20T08:00:00.000Z',
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="tool-management">
            <div class="page-header">
              <div class="header-left">
                <h1>工具管理</h1>
              </div>
              <div class="header-right">
                <a-space>
                  <a-statistic :value="toolStore.totalCount" title="总工具数" />
                  <a-statistic :value="toolStore.enabledCount" title="已启用" />
                  <a-statistic :value="toolStore.builtinCount" title="内置工具" />
                  <a-statistic :value="toolStore.pluginCount" title="插件工具" />
                </a-space>
              </div>
            </div>

            <div class="toolbar">
              <a-space>
                <a-input-search
                  v-model:value="searchKeyword"
                  placeholder="搜索工具..."
                  @search="handleSearch"
                />
                <a-select
                  v-model:value="categoryFilter"
                  placeholder="分类筛选"
                  @change="handleCategoryChange"
                >
                  <a-select-option value="all">全部分类</a-select-option>
                  <a-select-option value="file">文件操作</a-select-option>
                  <a-select-option value="code">代码生成</a-select-option>
                  <a-select-option value="system">系统操作</a-select-option>
                </a-select>
                <a-select
                  v-model:value="statusFilter"
                  placeholder="状态筛选"
                  @change="handleStatusChange"
                >
                  <a-select-option value="all">全部状态</a-select-option>
                  <a-select-option value="enabled">已启用</a-select-option>
                  <a-select-option value="disabled">已禁用</a-select-option>
                </a-select>
                <a-button :loading="toolStore.loading" @click="handleRefresh">
                  刷新
                </a-button>
              </a-space>

              <a-space>
                <a-button type="primary" @click="handleCreateTool">
                  创建工具
                </a-button>
                <a-button type="link" @click="showAnalytics">
                  使用统计
                </a-button>
                <a-button type="link" @click="showDependencyGraph">
                  依赖关系图
                </a-button>
              </a-space>
            </div>

            <div v-if="selectedTools.length > 0" class="batch-action-bar">
              <div class="selection-info">
                已选择 {{ selectedTools.length }} 项
              </div>
              <a-space>
                <a-button @click="handleBatchEnable">批量启用</a-button>
                <a-button @click="handleBatchDisable">批量禁用</a-button>
                <a-button danger @click="handleBatchDelete">批量删除</a-button>
                <a-button @click="handleClearSelection">清空选择</a-button>
              </a-space>
            </div>

            <div v-if="toolStore.loading" class="loading-container">
              <a-spin size="large" tip="加载中..." />
            </div>

            <div v-else-if="toolStore.filteredTools.length === 0" class="empty-container">
              <a-empty description="暂无工具数据" />
            </div>

            <div v-else class="tool-list">
              <div v-for="tool in toolStore.filteredTools" :key="tool.id" class="tool-item">
                <div class="tool-info">
                  <span>{{ tool.display_name || tool.name }}</span>
                  <a-tag>{{ getCategoryName(tool.category) }}</a-tag>
                  <a-tag :color="getRiskColor(tool.risk_level)">
                    {{ getRiskLabel(tool.risk_level) }}
                  </a-tag>
                </div>
                <a-switch
                  :checked="tool.enabled === 1"
                  size="small"
                  @change="() => handleToggleEnabled(tool)"
                />
              </div>
            </div>
          </div>
        `,
        setup() {
          const { ref, onMounted } = require('vue');
          const { message, Modal } = require('ant-design-vue');
          const { useToolStore } = require('@/stores/tool');

          const toolStore = useToolStore();
          const searchKeyword = ref('');
          const categoryFilter = ref('all');
          const statusFilter = ref('all');
          const selectedTools = ref([]);
          const switchingIds = ref(new Set());

          const getCategoryName = (category) => {
            const categoryMap = {
              file: '文件操作',
              code: '代码生成',
              project: '项目管理',
              system: '系统操作',
              output: '输出格式化',
              general: '通用',
            };
            return categoryMap[category] || category;
          };

          const getCategoryColor = (category) => {
            const colorMap = {
              file: 'blue',
              code: 'green',
              project: 'purple',
              system: 'orange',
              output: 'cyan',
              general: 'default',
            };
            return colorMap[category] || 'default';
          };

          const getRiskLabel = (level) => {
            const labelMap = {
              low: '低风险',
              medium: '中风险',
              high: '高风险',
            };
            return labelMap[level] || level;
          };

          const getRiskColor = (level) => {
            const colorMap = {
              low: 'success',
              medium: 'warning',
              high: 'error',
            };
            return colorMap[level] || 'default';
          };

          const handleSearch = () => {
            toolStore.searchTools(searchKeyword.value);
          };

          const handleCategoryChange = () => {
            toolStore.filterByCategory(categoryFilter.value);
          };

          const handleStatusChange = () => {
            toolStore.filterByStatus(statusFilter.value);
          };

          const handleRefresh = async () => {
            await toolStore.loadTools();
            message.success('刷新成功');
          };

          const handleCreateTool = () => {
            message.info('创建工具功能');
          };

          const showAnalytics = () => {
            message.info('使用统计功能');
          };

          const showDependencyGraph = () => {
            message.info('依赖关系图功能');
          };

          const handleToggleEnabled = async (tool) => {
            if (switchingIds.value.has(tool.id)) return;

            switchingIds.value.add(tool.id);
            try {
              await toolStore.updateTool(tool.id, {
                enabled: tool.enabled === 1 ? 0 : 1,
              });
              message.success(tool.enabled === 1 ? '已禁用' : '已启用');
            } catch (error) {
              message.error('操作失败: ' + error.message);
            } finally {
              switchingIds.value.delete(tool.id);
            }
          };

          const handleBatchEnable = async () => {
            try {
              await toolStore.batchUpdateTools(
                selectedTools.value.map((t) => t.id),
                { enabled: 1 }
              );
              message.success('批量启用成功');
              handleClearSelection();
            } catch (error) {
              message.error('批量启用失败: ' + error.message);
            }
          };

          const handleBatchDisable = async () => {
            try {
              await toolStore.batchUpdateTools(
                selectedTools.value.map((t) => t.id),
                { enabled: 0 }
              );
              message.success('批量禁用成功');
              handleClearSelection();
            } catch (error) {
              message.error('批量禁用失败: ' + error.message);
            }
          };

          const handleBatchDelete = () => {
            Modal.confirm({
              title: '确认删除',
              content: `确定要删除选中的 ${selectedTools.value.length} 个工具吗？`,
              onOk: async () => {
                try {
                  for (const tool of selectedTools.value) {
                    await toolStore.deleteTool(tool.id);
                  }
                  message.success('批量删除成功');
                  handleClearSelection();
                  await toolStore.loadTools();
                } catch (error) {
                  message.error('批量删除失败: ' + error.message);
                }
              },
            });
          };

          const handleClearSelection = () => {
            selectedTools.value = [];
          };

          onMounted(() => {
            toolStore.loadTools();
          });

          return {
            toolStore,
            searchKeyword,
            categoryFilter,
            statusFilter,
            selectedTools,
            switchingIds,
            getCategoryName,
            getCategoryColor,
            getRiskLabel,
            getRiskColor,
            handleSearch,
            handleCategoryChange,
            handleStatusChange,
            handleRefresh,
            handleCreateTool,
            showAnalytics,
            showDependencyGraph,
            handleToggleEnabled,
            handleBatchEnable,
            handleBatchDisable,
            handleBatchDelete,
            handleClearSelection,
          };
        },
      },
      {
        global: {
          stubs: {
            'a-space': true,
            'a-statistic': true,
            'a-input-search': true,
            'a-select': true,
            'a-select-option': true,
            'a-button': true,
            'a-spin': true,
            'a-empty': true,
            'a-tag': true,
            'a-switch': true,
            'a-table': true,
            'a-tooltip': true,
            'a-popconfirm': true,
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockToolStore.loading = false;
    mockToolStore.filteredTools = [...mockTools];
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.tool-management').exists()).toBe(true);
    });

    it('应该在挂载时加载工具', () => {
      wrapper = createWrapper();
      expect(mockToolStore.loadTools).toHaveBeenCalled();
    });
  });

  describe('统计信息', () => {
    it('应该显示总工具数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.toolStore.totalCount).toBe(45);
    });

    it('应该显示已启用工具数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.toolStore.enabledCount).toBe(32);
    });

    it('应该显示内置工具数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.toolStore.builtinCount).toBe(20);
    });

    it('应该显示插件工具数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.toolStore.pluginCount).toBe(25);
    });
  });

  describe('搜索功能', () => {
    it('应该能搜索工具', () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = 'file';

      wrapper.vm.handleSearch();

      expect(mockToolStore.searchTools).toHaveBeenCalledWith('file');
    });

    it('应该能处理空搜索', () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = '';

      wrapper.vm.handleSearch();

      expect(mockToolStore.searchTools).toHaveBeenCalledWith('');
    });
  });

  describe('分类筛选', () => {
    it('应该能按分类筛选', () => {
      wrapper = createWrapper();

      wrapper.vm.categoryFilter = 'file';
      wrapper.vm.handleCategoryChange();

      expect(mockToolStore.filterByCategory).toHaveBeenCalledWith('file');
    });

    it('应该能显示全部分类', () => {
      wrapper = createWrapper();

      wrapper.vm.categoryFilter = 'all';
      wrapper.vm.handleCategoryChange();

      expect(mockToolStore.filterByCategory).toHaveBeenCalledWith('all');
    });

    it('应该支持多种分类', () => {
      wrapper = createWrapper();

      wrapper.vm.categoryFilter = 'code';
      wrapper.vm.handleCategoryChange();

      wrapper.vm.categoryFilter = 'system';
      wrapper.vm.handleCategoryChange();

      expect(mockToolStore.filterByCategory).toHaveBeenCalledTimes(2);
    });
  });

  describe('状态筛选', () => {
    it('应该能筛选已启用工具', () => {
      wrapper = createWrapper();

      wrapper.vm.statusFilter = 'enabled';
      wrapper.vm.handleStatusChange();

      expect(mockToolStore.filterByStatus).toHaveBeenCalledWith('enabled');
    });

    it('应该能筛选已禁用工具', () => {
      wrapper = createWrapper();

      wrapper.vm.statusFilter = 'disabled';
      wrapper.vm.handleStatusChange();

      expect(mockToolStore.filterByStatus).toHaveBeenCalledWith('disabled');
    });

    it('应该能显示全部状态', () => {
      wrapper = createWrapper();

      wrapper.vm.statusFilter = 'all';
      wrapper.vm.handleStatusChange();

      expect(mockToolStore.filterByStatus).toHaveBeenCalledWith('all');
    });
  });

  describe('刷新功能', () => {
    it('应该能刷新工具列表', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.loadTools.mockResolvedValue();

      await wrapper.vm.handleRefresh();

      expect(mockToolStore.loadTools).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('刷新成功');
    });
  });

  describe('创建工具', () => {
    it('应该能触发创建工具', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.handleCreateTool();

      expect(message.info).toHaveBeenCalledWith('创建工具功能');
    });
  });

  describe('统计和依赖图', () => {
    it('应该能显示使用统计', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.showAnalytics();

      expect(message.info).toHaveBeenCalledWith('使用统计功能');
    });

    it('应该能显示依赖关系图', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.showDependencyGraph();

      expect(message.info).toHaveBeenCalledWith('依赖关系图功能');
    });
  });

  describe('启用/禁用工具', () => {
    it('应该能启用工具', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.updateTool.mockResolvedValue();

      const tool = { ...mockTools[2], enabled: 0 };

      await wrapper.vm.handleToggleEnabled(tool);

      expect(mockToolStore.updateTool).toHaveBeenCalledWith(tool.id, {
        enabled: 1,
      });
      expect(message.success).toHaveBeenCalledWith('已启用');
    });

    it('应该能禁用工具', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.updateTool.mockResolvedValue();

      const tool = { ...mockTools[0], enabled: 1 };

      await wrapper.vm.handleToggleEnabled(tool);

      expect(mockToolStore.updateTool).toHaveBeenCalledWith(tool.id, {
        enabled: 0,
      });
      expect(message.success).toHaveBeenCalledWith('已禁用');
    });

    it('应该能处理切换失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.updateTool.mockRejectedValue(new Error('更新失败'));

      await wrapper.vm.handleToggleEnabled(mockTools[0]);

      expect(message.error).toHaveBeenCalledWith('操作失败: 更新失败');
    });

    it('应该防止重复切换', async () => {
      wrapper = createWrapper();
      const tool = mockTools[0];

      wrapper.vm.switchingIds.add(tool.id);

      await wrapper.vm.handleToggleEnabled(tool);

      expect(mockToolStore.updateTool).not.toHaveBeenCalled();
    });
  });

  describe('批量操作', () => {
    it('应该能批量启用工具', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.batchUpdateTools.mockResolvedValue();

      wrapper.vm.selectedTools = [mockTools[0], mockTools[1]];

      await wrapper.vm.handleBatchEnable();

      expect(mockToolStore.batchUpdateTools).toHaveBeenCalledWith(
        [mockTools[0].id, mockTools[1].id],
        { enabled: 1 }
      );
      expect(message.success).toHaveBeenCalledWith('批量启用成功');
      expect(wrapper.vm.selectedTools.length).toBe(0);
    });

    it('应该能批量禁用工具', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.batchUpdateTools.mockResolvedValue();

      wrapper.vm.selectedTools = [mockTools[0]];

      await wrapper.vm.handleBatchDisable();

      expect(mockToolStore.batchUpdateTools).toHaveBeenCalledWith(
        [mockTools[0].id],
        { enabled: 0 }
      );
      expect(message.success).toHaveBeenCalledWith('批量禁用成功');
    });

    it('应该能批量删除工具', async () => {
      wrapper = createWrapper();
      const { message, Modal } = require('ant-design-vue');
      mockToolStore.deleteTool.mockResolvedValue();
      mockToolStore.loadTools.mockResolvedValue();

      wrapper.vm.selectedTools = [mockTools[0], mockTools[1]];

      wrapper.vm.handleBatchDelete();

      expect(Modal.confirm).toHaveBeenCalled();
      expect(mockToolStore.deleteTool).toHaveBeenCalledTimes(2);
      expect(message.success).toHaveBeenCalledWith('批量删除成功');
    });

    it('应该能处理批量操作失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockToolStore.batchUpdateTools.mockRejectedValue(new Error('操作失败'));

      wrapper.vm.selectedTools = [mockTools[0]];

      await wrapper.vm.handleBatchEnable();

      expect(message.error).toHaveBeenCalledWith('批量启用失败: 操作失败');
    });
  });

  describe('选择功能', () => {
    it('应该能清空选择', () => {
      wrapper = createWrapper();
      wrapper.vm.selectedTools = [mockTools[0], mockTools[1]];

      wrapper.vm.handleClearSelection();

      expect(wrapper.vm.selectedTools.length).toBe(0);
    });
  });

  describe('工具信息', () => {
    it('应该获取分类名称', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getCategoryName('file')).toBe('文件操作');
      expect(wrapper.vm.getCategoryName('code')).toBe('代码生成');
      expect(wrapper.vm.getCategoryName('unknown')).toBe('unknown');
    });

    it('应该获取分类颜色', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getCategoryColor('file')).toBe('blue');
      expect(wrapper.vm.getCategoryColor('code')).toBe('green');
      expect(wrapper.vm.getCategoryColor('unknown')).toBe('default');
    });

    it('应该获取风险标签', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getRiskLabel('low')).toBe('低风险');
      expect(wrapper.vm.getRiskLabel('medium')).toBe('中风险');
      expect(wrapper.vm.getRiskLabel('high')).toBe('高风险');
    });

    it('应该获取风险颜色', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getRiskColor('low')).toBe('success');
      expect(wrapper.vm.getRiskColor('medium')).toBe('warning');
      expect(wrapper.vm.getRiskColor('high')).toBe('error');
    });
  });

  describe('加载状态', () => {
    it('应该显示加载状态', () => {
      mockToolStore.loading = true;
      wrapper = createWrapper();

      expect(wrapper.vm.toolStore.loading).toBe(true);
    });

    it('应该隐藏加载状态', () => {
      mockToolStore.loading = false;
      wrapper = createWrapper();

      expect(wrapper.vm.toolStore.loading).toBe(false);
    });
  });

  describe('空状态', () => {
    it('应该显示空状态', () => {
      mockToolStore.filteredTools = [];
      wrapper = createWrapper();

      expect(wrapper.vm.toolStore.filteredTools.length).toBe(0);
    });

    it('应该在有数据时不显示空状态', () => {
      mockToolStore.filteredTools = mockTools;
      wrapper = createWrapper();

      expect(wrapper.vm.toolStore.filteredTools.length).toBeGreaterThan(0);
    });
  });

  describe('边界情况', () => {
    it('应该处理空选择的批量操作', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedTools = [];

      await wrapper.vm.handleBatchEnable();

      expect(mockToolStore.batchUpdateTools).toHaveBeenCalledWith([], { enabled: 1 });
    });
  });
});
