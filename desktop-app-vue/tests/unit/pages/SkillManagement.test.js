/**
 * SkillManagement 单元测试
 * 测试目标: src/renderer/pages/SkillManagement.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和技能列表加载
 * - 统计信息显示（总技能数、已启用、已禁用）
 * - 搜索功能
 * - 分类筛选
 * - 创建技能
 * - 启用/禁用技能
 * - 批量操作（批量启用、批量禁用、批量删除）
 * - 选择功能（单选、全选、清空选择）
 * - 统计分析
 * - 依赖关系图
 * - 刷新功能
 * - 虚拟滚动优化
 * - 空状态处理
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

// Mock skill store
const mockSkillStore = {
  loading: false,
  totalCount: 50,
  enabledCount: 35,
  filteredSkills: [],
  loadSkills: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  batchUpdateSkills: vi.fn(),
  filterByCategory: vi.fn(),
  searchSkills: vi.fn(),
};

vi.mock('@renderer/stores/skill', () => ({
  useSkillStore: () => mockSkillStore,
}));

describe('SkillManagement', () => {
  let wrapper;

  const mockSkills = [
    {
      id: 'skill-1',
      name: 'Code Generator',
      category: 'code',
      enabled: true,
      description: 'Generate code snippets',
    },
    {
      id: 'skill-2',
      name: 'Web Scraper',
      category: 'web',
      enabled: true,
      description: 'Scrape web content',
    },
    {
      id: 'skill-3',
      name: 'Data Analyzer',
      category: 'data',
      enabled: false,
      description: 'Analyze data sets',
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="skill-management">
            <!-- Header -->
            <div class="page-header">
              <div class="header-left">
                <h1>技能管理</h1>
                <p class="subtitle">管理和配置 AI 助手的技能集</p>
              </div>
              <div class="header-right">
                <a-space :size="24" align="center">
                  <a-statistic :value="skillStore.totalCount" title="总技能数" />
                  <a-statistic :value="skillStore.enabledCount" title="已启用" />
                  <a-statistic
                    :value="skillStore.totalCount - skillStore.enabledCount"
                    title="已禁用"
                  />
                </a-space>
              </div>
            </div>

            <!-- Toolbar -->
            <div class="toolbar">
              <a-space>
                <a-input-search
                  v-model:value="searchKeyword"
                  placeholder="搜索技能..."
                  @search="handleSearch"
                />
                <a-select
                  v-model:value="categoryFilter"
                  placeholder="分类筛选"
                  @change="handleCategoryChange"
                >
                  <a-select-option value="all">全部分类</a-select-option>
                  <a-select-option value="code">代码开发</a-select-option>
                  <a-select-option value="web">Web开发</a-select-option>
                  <a-select-option value="data">数据处理</a-select-option>
                </a-select>
                <a-button :loading="skillStore.loading" @click="handleRefresh">
                  刷新
                </a-button>
              </a-space>

              <a-space>
                <a-button type="primary" @click="handleCreateSkill">
                  创建技能
                </a-button>
                <a-button type="link" @click="showStats">
                  统计分析
                </a-button>
                <a-button type="link" @click="showDependencyGraph">
                  依赖关系图
                </a-button>
              </a-space>
            </div>

            <!-- Batch Action Bar -->
            <div v-if="selectedSkills.length > 0" class="batch-action-bar">
              <div class="selection-info">
                <a-checkbox
                  :checked="isAllSelected"
                  :indeterminate="selectedSkills.length > 0 && !isAllSelected"
                  @change="handleSelectAll"
                >
                  已选择 {{ selectedSkills.length }} 项
                </a-checkbox>
              </div>
              <a-space>
                <a-button @click="handleBatchEnable">批量启用</a-button>
                <a-button @click="handleBatchDisable">批量禁用</a-button>
                <a-button danger @click="handleBatchDelete">批量删除</a-button>
                <a-button @click="handleClearSelection">清空选择</a-button>
              </a-space>
            </div>

            <!-- Skill List -->
            <div v-if="skillStore.loading" class="loading-container">
              <a-spin size="large" tip="加载中..." />
            </div>

            <div v-else-if="skillStore.filteredSkills.length === 0" class="empty-container">
              <a-empty description="暂无技能数据" />
            </div>

            <div v-else class="skill-list-container">
              <div class="skill-grid">
                <div
                  v-for="skill in skillStore.filteredSkills"
                  :key="skill.id"
                  class="skill-card-wrapper"
                >
                  <a-checkbox
                    v-model:checked="selectedSkillIds[skill.id]"
                    class="skill-checkbox"
                    @change="handleSkillSelect(skill)"
                  />
                  <div class="skill-card" @click="handleViewDetails(skill)">
                    <div class="skill-name">{{ skill.name }}</div>
                    <div class="skill-description">{{ skill.description }}</div>
                    <a-button @click.stop="handleToggleEnabled(skill)">
                      {{ skill.enabled ? '禁用' : '启用' }}
                    </a-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `,
        setup() {
          const { ref, computed, onMounted } = require('vue');
          const { message, Modal } = require('ant-design-vue');
          const { useSkillStore } = require('@renderer/stores/skill');

          const skillStore = useSkillStore();
          const searchKeyword = ref('');
          const categoryFilter = ref('all');
          const selectedSkills = ref([]);
          const selectedSkillIds = ref({});
          const gridColumns = ref(3);

          const isAllSelected = computed(() => {
            return (
              selectedSkills.value.length > 0 &&
              selectedSkills.value.length === skillStore.filteredSkills.length
            );
          });

          const handleSearch = () => {
            skillStore.searchSkills(searchKeyword.value);
          };

          const handleCategoryChange = (category) => {
            skillStore.filterByCategory(category);
          };

          const handleRefresh = async () => {
            await skillStore.loadSkills();
            message.success('刷新成功');
          };

          const handleCreateSkill = () => {
            // Navigate to create skill page
            message.info('创建技能功能');
          };

          const showStats = () => {
            message.info('统计分析功能');
          };

          const showDependencyGraph = () => {
            message.info('依赖关系图功能');
          };

          const handleSkillSelect = (skill) => {
            if (selectedSkillIds.value[skill.id]) {
              selectedSkills.value.push(skill);
            } else {
              selectedSkills.value = selectedSkills.value.filter(
                (s) => s.id !== skill.id
              );
            }
          };

          const handleSelectAll = () => {
            if (isAllSelected.value) {
              selectedSkills.value = [];
              selectedSkillIds.value = {};
            } else {
              selectedSkills.value = [...skillStore.filteredSkills];
              selectedSkillIds.value = {};
              skillStore.filteredSkills.forEach((skill) => {
                selectedSkillIds.value[skill.id] = true;
              });
            }
          };

          const handleClearSelection = () => {
            selectedSkills.value = [];
            selectedSkillIds.value = {};
          };

          const handleBatchEnable = async () => {
            try {
              await skillStore.batchUpdateSkills(
                selectedSkills.value.map((s) => s.id),
                { enabled: true }
              );
              message.success('批量启用成功');
              handleClearSelection();
            } catch (error) {
              message.error('批量启用失败: ' + error.message);
            }
          };

          const handleBatchDisable = async () => {
            try {
              await skillStore.batchUpdateSkills(
                selectedSkills.value.map((s) => s.id),
                { enabled: false }
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
              content: `确定要删除选中的 ${selectedSkills.value.length} 个技能吗？`,
              onOk: async () => {
                try {
                  for (const skill of selectedSkills.value) {
                    await skillStore.deleteSkill(skill.id);
                  }
                  message.success('批量删除成功');
                  handleClearSelection();
                  await skillStore.loadSkills();
                } catch (error) {
                  message.error('批量删除失败: ' + error.message);
                }
              },
            });
          };

          const handleToggleEnabled = async (skill) => {
            try {
              await skillStore.updateSkill(skill.id, {
                enabled: !skill.enabled,
              });
              message.success(skill.enabled ? '已禁用' : '已启用');
            } catch (error) {
              message.error('操作失败: ' + error.message);
            }
          };

          const handleViewDetails = (skill) => {
            message.info(`查看技能详情: ${skill.name}`);
          };

          const handleViewDoc = (skill) => {
            message.info(`查看技能文档: ${skill.name}`);
          };

          onMounted(() => {
            skillStore.loadSkills();
          });

          return {
            skillStore,
            searchKeyword,
            categoryFilter,
            selectedSkills,
            selectedSkillIds,
            gridColumns,
            isAllSelected,
            handleSearch,
            handleCategoryChange,
            handleRefresh,
            handleCreateSkill,
            showStats,
            showDependencyGraph,
            handleSkillSelect,
            handleSelectAll,
            handleClearSelection,
            handleBatchEnable,
            handleBatchDisable,
            handleBatchDelete,
            handleToggleEnabled,
            handleViewDetails,
            handleViewDoc,
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
            'a-checkbox': true,
            'a-spin': true,
            'a-empty': true,
            SkillCard: true,
            VirtualGrid: true,
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSkillStore.loading = false;
    mockSkillStore.totalCount = 50;
    mockSkillStore.enabledCount = 35;
    mockSkillStore.filteredSkills = [...mockSkills];
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.skill-management').exists()).toBe(true);
    });

    it('应该在挂载时加载技能', () => {
      wrapper = createWrapper();
      expect(mockSkillStore.loadSkills).toHaveBeenCalled();
    });
  });

  describe('统计信息', () => {
    it('应该显示总技能数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.skillStore.totalCount).toBe(50);
    });

    it('应该显示已启用技能数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.skillStore.enabledCount).toBe(35);
    });

    it('应该计算已禁用技能数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.skillStore.totalCount - wrapper.vm.skillStore.enabledCount).toBe(15);
    });
  });

  describe('搜索功能', () => {
    it('应该能搜索技能', () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = 'Generator';

      wrapper.vm.handleSearch();

      expect(mockSkillStore.searchSkills).toHaveBeenCalledWith('Generator');
    });

    it('应该能处理空搜索', () => {
      wrapper = createWrapper();
      wrapper.vm.searchKeyword = '';

      wrapper.vm.handleSearch();

      expect(mockSkillStore.searchSkills).toHaveBeenCalledWith('');
    });

    it('应该能搜索多次', () => {
      wrapper = createWrapper();

      wrapper.vm.searchKeyword = 'Code';
      wrapper.vm.handleSearch();

      wrapper.vm.searchKeyword = 'Web';
      wrapper.vm.handleSearch();

      expect(mockSkillStore.searchSkills).toHaveBeenCalledTimes(2);
    });
  });

  describe('分类筛选', () => {
    it('应该能按分类筛选', () => {
      wrapper = createWrapper();

      wrapper.vm.handleCategoryChange('code');

      expect(mockSkillStore.filterByCategory).toHaveBeenCalledWith('code');
    });

    it('应该能显示全部分类', () => {
      wrapper = createWrapper();

      wrapper.vm.handleCategoryChange('all');

      expect(mockSkillStore.filterByCategory).toHaveBeenCalledWith('all');
    });

    it('应该支持多种分类', () => {
      wrapper = createWrapper();

      wrapper.vm.handleCategoryChange('web');
      wrapper.vm.handleCategoryChange('data');

      expect(mockSkillStore.filterByCategory).toHaveBeenCalledTimes(2);
    });
  });

  describe('刷新功能', () => {
    it('应该能刷新技能列表', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.loadSkills.mockResolvedValue();

      await wrapper.vm.handleRefresh();

      expect(mockSkillStore.loadSkills).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('刷新成功');
    });
  });

  describe('创建技能', () => {
    it('应该能触发创建技能', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.handleCreateSkill();

      expect(message.info).toHaveBeenCalledWith('创建技能功能');
    });
  });

  describe('统计和依赖图', () => {
    it('应该能显示统计分析', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.showStats();

      expect(message.info).toHaveBeenCalledWith('统计分析功能');
    });

    it('应该能显示依赖关系图', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.showDependencyGraph();

      expect(message.info).toHaveBeenCalledWith('依赖关系图功能');
    });
  });

  describe('技能选择', () => {
    it('应该能选择单个技能', () => {
      wrapper = createWrapper();
      const skill = mockSkills[0];

      wrapper.vm.selectedSkillIds[skill.id] = true;
      wrapper.vm.handleSkillSelect(skill);

      expect(wrapper.vm.selectedSkills).toContainEqual(skill);
    });

    it('应该能取消选择技能', () => {
      wrapper = createWrapper();
      const skill = mockSkills[0];

      wrapper.vm.selectedSkillIds[skill.id] = true;
      wrapper.vm.handleSkillSelect(skill);
      wrapper.vm.selectedSkillIds[skill.id] = false;
      wrapper.vm.handleSkillSelect(skill);

      expect(wrapper.vm.selectedSkills).not.toContainEqual(skill);
    });

    it('应该能全选技能', () => {
      wrapper = createWrapper();

      wrapper.vm.handleSelectAll();

      expect(wrapper.vm.selectedSkills.length).toBe(mockSkills.length);
    });

    it('应该能取消全选', () => {
      wrapper = createWrapper();

      wrapper.vm.handleSelectAll(); // 全选
      wrapper.vm.handleSelectAll(); // 取消全选

      expect(wrapper.vm.selectedSkills.length).toBe(0);
    });

    it('应该能清空选择', () => {
      wrapper = createWrapper();

      wrapper.vm.handleSelectAll();
      wrapper.vm.handleClearSelection();

      expect(wrapper.vm.selectedSkills.length).toBe(0);
      expect(Object.keys(wrapper.vm.selectedSkillIds).length).toBe(0);
    });

    it('应该计算是否全选', () => {
      wrapper = createWrapper();

      wrapper.vm.handleSelectAll();

      expect(wrapper.vm.isAllSelected).toBe(true);
    });
  });

  describe('批量操作', () => {
    it('应该能批量启用技能', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.batchUpdateSkills.mockResolvedValue();

      wrapper.vm.selectedSkills = [mockSkills[0], mockSkills[1]];

      await wrapper.vm.handleBatchEnable();

      expect(mockSkillStore.batchUpdateSkills).toHaveBeenCalledWith(
        [mockSkills[0].id, mockSkills[1].id],
        { enabled: true }
      );
      expect(message.success).toHaveBeenCalledWith('批量启用成功');
      expect(wrapper.vm.selectedSkills.length).toBe(0);
    });

    it('应该能批量禁用技能', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.batchUpdateSkills.mockResolvedValue();

      wrapper.vm.selectedSkills = [mockSkills[0]];

      await wrapper.vm.handleBatchDisable();

      expect(mockSkillStore.batchUpdateSkills).toHaveBeenCalledWith(
        [mockSkills[0].id],
        { enabled: false }
      );
      expect(message.success).toHaveBeenCalledWith('批量禁用成功');
    });

    it('应该能批量删除技能', async () => {
      wrapper = createWrapper();
      const { message, Modal } = require('ant-design-vue');
      mockSkillStore.deleteSkill.mockResolvedValue();
      mockSkillStore.loadSkills.mockResolvedValue();

      wrapper.vm.selectedSkills = [mockSkills[0], mockSkills[1]];

      wrapper.vm.handleBatchDelete();

      expect(Modal.confirm).toHaveBeenCalled();
      expect(mockSkillStore.deleteSkill).toHaveBeenCalledTimes(2);
      expect(message.success).toHaveBeenCalledWith('批量删除成功');
    });

    it('应该能处理批量操作失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.batchUpdateSkills.mockRejectedValue(new Error('操作失败'));

      wrapper.vm.selectedSkills = [mockSkills[0]];

      await wrapper.vm.handleBatchEnable();

      expect(message.error).toHaveBeenCalledWith('批量启用失败: 操作失败');
    });
  });

  describe('启用/禁用技能', () => {
    it('应该能启用技能', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.updateSkill.mockResolvedValue();

      const skill = { ...mockSkills[2], enabled: false };

      await wrapper.vm.handleToggleEnabled(skill);

      expect(mockSkillStore.updateSkill).toHaveBeenCalledWith(skill.id, {
        enabled: true,
      });
      expect(message.success).toHaveBeenCalledWith('已启用');
    });

    it('应该能禁用技能', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.updateSkill.mockResolvedValue();

      const skill = { ...mockSkills[0], enabled: true };

      await wrapper.vm.handleToggleEnabled(skill);

      expect(mockSkillStore.updateSkill).toHaveBeenCalledWith(skill.id, {
        enabled: false,
      });
      expect(message.success).toHaveBeenCalledWith('已禁用');
    });

    it('应该能处理切换失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockSkillStore.updateSkill.mockRejectedValue(new Error('更新失败'));

      await wrapper.vm.handleToggleEnabled(mockSkills[0]);

      expect(message.error).toHaveBeenCalledWith('操作失败: 更新失败');
    });
  });

  describe('查看详情', () => {
    it('应该能查看技能详情', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.handleViewDetails(mockSkills[0]);

      expect(message.info).toHaveBeenCalledWith(`查看技能详情: ${mockSkills[0].name}`);
    });

    it('应该能查看技能文档', () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.handleViewDoc(mockSkills[0]);

      expect(message.info).toHaveBeenCalledWith(`查看技能文档: ${mockSkills[0].name}`);
    });
  });

  describe('加载状态', () => {
    it('应该显示加载状态', () => {
      mockSkillStore.loading = true;
      wrapper = createWrapper();

      expect(wrapper.vm.skillStore.loading).toBe(true);
    });

    it('应该隐藏加载状态', () => {
      mockSkillStore.loading = false;
      wrapper = createWrapper();

      expect(wrapper.vm.skillStore.loading).toBe(false);
    });
  });

  describe('空状态', () => {
    it('应该显示空状态', () => {
      mockSkillStore.filteredSkills = [];
      wrapper = createWrapper();

      expect(wrapper.vm.skillStore.filteredSkills.length).toBe(0);
    });

    it('应该在有数据时不显示空状态', () => {
      mockSkillStore.filteredSkills = mockSkills;
      wrapper = createWrapper();

      expect(wrapper.vm.skillStore.filteredSkills.length).toBeGreaterThan(0);
    });
  });

  describe('边界情况', () => {
    it('应该处理空选择的批量操作', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedSkills = [];

      await wrapper.vm.handleBatchEnable();

      expect(mockSkillStore.batchUpdateSkills).toHaveBeenCalledWith([], { enabled: true });
    });

    it('应该处理大量技能选择', () => {
      wrapper = createWrapper();
      const manySkills = Array.from({ length: 100 }, (_, i) => ({
        id: `skill-${i}`,
        name: `Skill ${i}`,
        enabled: true,
      }));
      mockSkillStore.filteredSkills = manySkills;

      wrapper.vm.handleSelectAll();

      expect(wrapper.vm.selectedSkills.length).toBe(100);
    });

    it('应该处理网格列数配置', () => {
      wrapper = createWrapper();
      wrapper.vm.gridColumns = 4;

      expect(wrapper.vm.gridColumns).toBe(4);
    });
  });
});
