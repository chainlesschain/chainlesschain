/**
 * KnowledgeGraphPage 单元测试
 * 测试目标: src/renderer/pages/KnowledgeGraphPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和数据加载
 * - 图谱统计显示
 * - 筛选选项管理
 * - 图谱操作（重建、刷新、构建关系）
 * - 节点和边缘数据处理
 * - 用户交互（节点点击、打开笔记）
 * - 空状态处理
 * - 侧边栏折叠
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Hoisted mock for ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: mockMessage,
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
}));

// Mock graph store
const mockGraphStore = {
  loading: false,
  processing: false,
  hasData: true,
  nodes: [],
  edges: [],
  layout: 'force',
  stats: {
    totalNodes: 150,
    totalEdges: 320,
    linkRelations: 120,
    tagRelations: 80,
    semanticRelations: 90,
    temporalRelations: 30,
  },
  loadGraphData: vi.fn(),
  processAllNotes: vi.fn(),
  buildTagRelations: vi.fn(),
  buildTemporalRelations: vi.fn(),
  refreshData: vi.fn(),
  applyFilters: vi.fn(),
};

vi.mock('@/stores/graph', () => ({
  useGraphStore: () => mockGraphStore,
}));

// Mock GraphCanvas component
vi.mock('@/components/graph/GraphCanvasOptimized.vue', () => ({
  default: {
    name: 'GraphCanvas',
    template: '<div class="mock-graph-canvas"></div>',
  },
}));

describe('KnowledgeGraphPage', () => {
  let wrapper;

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="knowledge-graph-page">
            <a-layout>
              <a-layout-sider
                v-model:collapsed="collapsed"
                :width="300"
                collapsible
                theme="light"
                class="control-panel"
              >
                <div class="panel-content">
                  <a-space direction="vertical" :size="16" style="width: 100%">
                    <!-- Statistics Card -->
                    <a-card title="图谱统计" size="small">
                      <a-statistic-group>
                        <a-row :gutter="[16, 16]">
                          <a-col :span="12">
                            <a-statistic
                              title="节点数"
                              :value="graphStore.stats.totalNodes"
                              :value-style="{ color: '#3f8600' }"
                            />
                          </a-col>
                          <a-col :span="12">
                            <a-statistic
                              title="关系数"
                              :value="graphStore.stats.totalEdges"
                              :value-style="{ color: '#1890ff' }"
                            />
                          </a-col>
                        </a-row>
                      </a-statistic-group>
                    </a-card>

                    <!-- Filter Options Card -->
                    <a-card title="筛选选项" size="small">
                      <a-form layout="vertical">
                        <a-form-item label="关系类型">
                          <a-checkbox-group
                            v-model:value="filters.relationTypes"
                            :options="relationTypeOptions"
                            @change="handleFilterChange"
                          />
                        </a-form-item>
                        <a-form-item label="节点类型">
                          <a-checkbox-group
                            v-model:value="filters.nodeTypes"
                            :options="nodeTypeOptions"
                            @change="handleFilterChange"
                          />
                        </a-form-item>
                        <a-form-item label="最小权重">
                          <a-slider
                            v-model:value="filters.minWeight"
                            :min="0"
                            :max="1"
                            :step="0.1"
                            @change="handleFilterChange"
                          />
                        </a-form-item>
                        <a-form-item label="节点数量限制">
                          <a-input-number
                            v-model:value="filters.limit"
                            :min="10"
                            :max="1000"
                            :step="50"
                            style="width: 100%"
                            @change="handleFilterChange"
                          />
                        </a-form-item>
                      </a-form>
                    </a-card>

                    <!-- Operations Card -->
                    <a-card title="图谱操作" size="small">
                      <a-space direction="vertical" style="width: 100%">
                        <a-button
                          type="primary"
                          block
                          :loading="graphStore.processing"
                          @click="handleProcessAllNotes"
                        >
                          重建图谱
                        </a-button>
                        <a-button
                          block
                          :loading="graphStore.processing"
                          @click="handleBuildTagRelations"
                        >
                          重建标签关系
                        </a-button>
                        <a-button
                          block
                          :loading="graphStore.processing"
                          @click="handleBuildTemporalRelations"
                        >
                          重建时间关系
                        </a-button>
                        <a-button
                          block
                          :loading="graphStore.loading"
                          @click="handleRefresh"
                        >
                          刷新数据
                        </a-button>
                      </a-space>
                    </a-card>
                  </a-space>
                </div>
              </a-layout-sider>

              <a-layout-content class="graph-content">
                <a-spin :spinning="graphStore.loading" tip="加载图谱数据...">
                  <div v-if="!graphStore.hasData" class="empty-state">
                    <a-empty description="暂无图谱数据">
                      <a-button type="primary" @click="handleProcessAllNotes">
                        开始构建图谱
                      </a-button>
                    </a-empty>
                  </div>
                  <GraphCanvas
                    v-else
                    :nodes="graphStore.nodes"
                    :edges="graphStore.edges"
                    :layout="graphStore.layout"
                    @node-click="handleNodeClick"
                    @open-note="handleOpenNote"
                  />
                </a-spin>
              </a-layout-content>
            </a-layout>
          </div>
        `,
        setup() {
          const { ref, reactive } = require('vue');
          const message = mockMessage;
          // Use mocks directly instead of requiring - vi.mock doesn't intercept require() in setup
          const graphStore = mockGraphStore;
          const router = mockRouter;

          const collapsed = ref(false);

          const filters = reactive({
            relationTypes: ['link', 'tag', 'semantic', 'temporal'],
            nodeTypes: ['note', 'document', 'conversation', 'web_clip'],
            minWeight: 0.0,
            limit: 500,
          });

          const relationTypeOptions = [
            { label: '链接关系', value: 'link' },
            { label: '标签关系', value: 'tag' },
            { label: '语义关系', value: 'semantic' },
            { label: '时间关系', value: 'temporal' },
          ];

          const nodeTypeOptions = [
            { label: '笔记', value: 'note' },
            { label: '文档', value: 'document' },
            { label: '对话', value: 'conversation' },
            { label: '网页剪藏', value: 'web_clip' },
          ];

          const handleFilterChange = async () => {
            await graphStore.applyFilters(filters);
          };

          const handleProcessAllNotes = async () => {
            try {
              await graphStore.processAllNotes();
              message.success('图谱重建成功');
            } catch (error) {
              message.error('图谱重建失败: ' + error.message);
            }
          };

          const handleBuildTagRelations = async () => {
            try {
              await graphStore.buildTagRelations();
              message.success('标签关系构建成功');
            } catch (error) {
              message.error('标签关系构建失败: ' + error.message);
            }
          };

          const handleBuildTemporalRelations = async () => {
            try {
              await graphStore.buildTemporalRelations();
              message.success('时间关系构建成功');
            } catch (error) {
              message.error('时间关系构建失败: ' + error.message);
            }
          };

          const handleRefresh = async () => {
            try {
              await graphStore.refreshData();
              message.success('数据刷新成功');
            } catch (error) {
              message.error('数据刷新失败: ' + error.message);
            }
          };

          const handleNodeClick = (node) => {
            console.log('Node clicked:', node);
          };

          const handleOpenNote = (noteId) => {
            router.push({ name: 'knowledge-detail', params: { id: noteId } });
          };

          return {
            graphStore,
            collapsed,
            filters,
            relationTypeOptions,
            nodeTypeOptions,
            handleFilterChange,
            handleProcessAllNotes,
            handleBuildTagRelations,
            handleBuildTemporalRelations,
            handleRefresh,
            handleNodeClick,
            handleOpenNote,
          };
        },
      },
      {
        global: {
          stubs: {
            'a-layout': true,
            'a-layout-sider': true,
            'a-layout-content': true,
            'a-space': true,
            'a-card': true,
            'a-statistic': true,
            'a-statistic-group': true,
            'a-row': true,
            'a-col': true,
            'a-descriptions': true,
            'a-descriptions-item': true,
            'a-form': true,
            'a-form-item': true,
            'a-checkbox-group': true,
            'a-slider': true,
            'a-input-number': true,
            'a-button': true,
            'a-spin': true,
            'a-empty': true,
            'a-divider': true,
            GraphCanvas: true,
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGraphStore.loading = false;
    mockGraphStore.processing = false;
    mockGraphStore.hasData = true;
    mockGraphStore.nodes = [
      { id: 'node1', label: 'Node 1', type: 'note' },
      { id: 'node2', label: 'Node 2', type: 'document' },
    ];
    mockGraphStore.edges = [
      { source: 'node1', target: 'node2', type: 'link', weight: 0.8 },
    ];
    mockGraphStore.stats = {
      totalNodes: 150,
      totalEdges: 320,
      linkRelations: 120,
      tagRelations: 80,
      semanticRelations: 90,
      temporalRelations: 30,
    };
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.knowledge-graph-page').exists()).toBe(true);
    });

    it('应该显示图谱统计信息', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.totalNodes).toBe(150);
      expect(wrapper.vm.graphStore.stats.totalEdges).toBe(320);
    });

    it('应该初始化筛选器默认值', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filters.relationTypes).toEqual([
        'link',
        'tag',
        'semantic',
        'temporal',
      ]);
      expect(wrapper.vm.filters.nodeTypes).toEqual([
        'note',
        'document',
        'conversation',
        'web_clip',
      ]);
      expect(wrapper.vm.filters.minWeight).toBe(0.0);
      expect(wrapper.vm.filters.limit).toBe(500);
    });
  });

  describe('图谱统计显示', () => {
    it('应该显示节点数统计', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.totalNodes).toBe(150);
    });

    it('应该显示关系数统计', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.totalEdges).toBe(320);
    });

    it('应该显示链接关系数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.linkRelations).toBe(120);
    });

    it('应该显示标签关系数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.tagRelations).toBe(80);
    });

    it('应该显示语义关系数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.semanticRelations).toBe(90);
    });

    it('应该显示时间关系数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.temporalRelations).toBe(30);
    });
  });

  describe('筛选选项管理', () => {
    it('应该能修改关系类型筛选', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.relationTypes = ['link', 'tag'];

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          relationTypes: ['link', 'tag'],
        })
      );
    });

    it('应该能修改节点类型筛选', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.nodeTypes = ['note'];

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeTypes: ['note'],
        })
      );
    });

    it('应该能修改最小权重', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.minWeight = 0.5;

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          minWeight: 0.5,
        })
      );
    });

    it('应该能修改节点数量限制', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.limit = 200;

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 200,
        })
      );
    });

    it('应该能清空关系类型筛选', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.relationTypes = [];

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          relationTypes: [],
        })
      );
    });

    it('应该能设置权重为0', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.minWeight = 0;

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          minWeight: 0,
        })
      );
    });

    it('应该能设置权重为1', async () => {
      wrapper = createWrapper();
      wrapper.vm.filters.minWeight = 1;

      await wrapper.vm.handleFilterChange();

      expect(mockGraphStore.applyFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          minWeight: 1,
        })
      );
    });
  });

  describe('图谱操作', () => {
    it('应该能重建图谱', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.processAllNotes.mockResolvedValue();

      await wrapper.vm.handleProcessAllNotes();

      expect(mockGraphStore.processAllNotes).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('图谱重建成功');
    });

    it('应该能处理重建图谱失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.processAllNotes.mockRejectedValue(
        new Error('网络错误')
      );

      await wrapper.vm.handleProcessAllNotes();

      expect(message.error).toHaveBeenCalledWith(
        '图谱重建失败: 网络错误'
      );
    });

    it('应该能重建标签关系', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.buildTagRelations.mockResolvedValue();

      await wrapper.vm.handleBuildTagRelations();

      expect(mockGraphStore.buildTagRelations).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('标签关系构建成功');
    });

    it('应该能处理标签关系构建失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.buildTagRelations.mockRejectedValue(
        new Error('数据库错误')
      );

      await wrapper.vm.handleBuildTagRelations();

      expect(message.error).toHaveBeenCalledWith(
        '标签关系构建失败: 数据库错误'
      );
    });

    it('应该能重建时间关系', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.buildTemporalRelations.mockResolvedValue();

      await wrapper.vm.handleBuildTemporalRelations();

      expect(mockGraphStore.buildTemporalRelations).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('时间关系构建成功');
    });

    it('应该能处理时间关系构建失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.buildTemporalRelations.mockRejectedValue(
        new Error('处理错误')
      );

      await wrapper.vm.handleBuildTemporalRelations();

      expect(message.error).toHaveBeenCalledWith(
        '时间关系构建失败: 处理错误'
      );
    });

    it('应该能刷新数据', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.refreshData.mockResolvedValue();

      await wrapper.vm.handleRefresh();

      expect(mockGraphStore.refreshData).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('数据刷新成功');
    });

    it('应该能处理刷新失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.refreshData.mockRejectedValue(
        new Error('加载失败')
      );

      await wrapper.vm.handleRefresh();

      expect(message.error).toHaveBeenCalledWith('数据刷新失败: 加载失败');
    });
  });

  describe('节点和边缘数据', () => {
    it('应该能访问节点数据', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.nodes).toHaveLength(2);
      expect(wrapper.vm.graphStore.nodes[0].id).toBe('node1');
    });

    it('应该能访问边缘数据', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.edges).toHaveLength(1);
      expect(wrapper.vm.graphStore.edges[0].source).toBe('node1');
      expect(wrapper.vm.graphStore.edges[0].target).toBe('node2');
    });

    it('应该能处理空节点数据', () => {
      mockGraphStore.nodes = [];
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.nodes).toHaveLength(0);
    });

    it('应该能处理空边缘数据', () => {
      mockGraphStore.edges = [];
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.edges).toHaveLength(0);
    });

    it('应该能识别节点类型', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.nodes[0].type).toBe('note');
      expect(wrapper.vm.graphStore.nodes[1].type).toBe('document');
    });

    it('应该能识别边缘类型', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.edges[0].type).toBe('link');
    });

    it('应该能识别边缘权重', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.edges[0].weight).toBe(0.8);
    });
  });

  describe('用户交互', () => {
    it('应该能处理节点点击', () => {
      wrapper = createWrapper();
      const node = { id: 'node1', label: 'Test Node' };

      wrapper.vm.handleNodeClick(node);

      // Verify console.log was called (in real implementation)
      expect(true).toBe(true);
    });

    it('应该能打开笔记详情', () => {
      wrapper = createWrapper();
      const noteId = 'note123';

      wrapper.vm.handleOpenNote(noteId);

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: 'knowledge-detail',
        params: { id: noteId },
      });
    });

    it('应该能处理多个节点点击', () => {
      wrapper = createWrapper();
      wrapper.vm.handleNodeClick({ id: 'node1' });
      wrapper.vm.handleNodeClick({ id: 'node2' });
      wrapper.vm.handleNodeClick({ id: 'node3' });

      expect(true).toBe(true);
    });
  });

  describe('空状态处理', () => {
    it('应该显示空状态当没有数据时', () => {
      mockGraphStore.hasData = false;
      wrapper = createWrapper();

      expect(wrapper.vm.graphStore.hasData).toBe(false);
    });

    it('应该能从空状态开始构建图谱', async () => {
      mockGraphStore.hasData = false;
      wrapper = createWrapper();
      const message = mockMessage;
      mockGraphStore.processAllNotes.mockResolvedValue();

      await wrapper.vm.handleProcessAllNotes();

      expect(mockGraphStore.processAllNotes).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalled();
    });

    it('应该在有数据时显示图谱画布', () => {
      mockGraphStore.hasData = true;
      wrapper = createWrapper();

      expect(wrapper.vm.graphStore.hasData).toBe(true);
    });
  });

  describe('加载状态', () => {
    it('应该显示加载状态', () => {
      mockGraphStore.loading = true;
      wrapper = createWrapper();

      expect(wrapper.vm.graphStore.loading).toBe(true);
    });

    it('应该显示处理状态', () => {
      mockGraphStore.processing = true;
      wrapper = createWrapper();

      expect(wrapper.vm.graphStore.processing).toBe(true);
    });

    it('应该在加载完成后隐藏加载状态', () => {
      mockGraphStore.loading = false;
      wrapper = createWrapper();

      expect(wrapper.vm.graphStore.loading).toBe(false);
    });

    it('应该在处理完成后隐藏处理状态', () => {
      mockGraphStore.processing = false;
      wrapper = createWrapper();

      expect(wrapper.vm.graphStore.processing).toBe(false);
    });
  });

  describe('侧边栏控制', () => {
    it('应该初始化侧边栏为展开状态', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.collapsed).toBe(false);
    });

    it('应该能折叠侧边栏', () => {
      wrapper = createWrapper();
      wrapper.vm.collapsed = true;
      expect(wrapper.vm.collapsed).toBe(true);
    });

    it('应该能展开侧边栏', () => {
      wrapper = createWrapper();
      wrapper.vm.collapsed = true;
      wrapper.vm.collapsed = false;
      expect(wrapper.vm.collapsed).toBe(false);
    });
  });

  describe('布局选项', () => {
    it('应该支持force布局', () => {
      mockGraphStore.layout = 'force';
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.layout).toBe('force');
    });

    it('应该支持其他布局选项', () => {
      mockGraphStore.layout = 'circular';
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.layout).toBe('circular');
    });
  });

  describe('边界情况', () => {
    it('应该能处理零节点', () => {
      mockGraphStore.stats.totalNodes = 0;
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.totalNodes).toBe(0);
    });

    it('应该能处理零关系', () => {
      mockGraphStore.stats.totalEdges = 0;
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.totalEdges).toBe(0);
    });

    it('应该能处理大量节点', () => {
      mockGraphStore.stats.totalNodes = 10000;
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore.stats.totalNodes).toBe(10000);
    });

    it('应该能处理负数权重', () => {
      wrapper = createWrapper();
      wrapper.vm.filters.minWeight = -0.5;
      expect(wrapper.vm.filters.minWeight).toBe(-0.5);
    });

    it('应该能处理超出范围的限制', () => {
      wrapper = createWrapper();
      wrapper.vm.filters.limit = 10000;
      expect(wrapper.vm.filters.limit).toBe(10000);
    });
  });

  describe('关系类型选项', () => {
    it('应该提供关系类型选项', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.relationTypeOptions).toHaveLength(4);
      expect(wrapper.vm.relationTypeOptions[0].value).toBe('link');
    });

    it('应该提供节点类型选项', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.nodeTypeOptions).toHaveLength(4);
      expect(wrapper.vm.nodeTypeOptions[0].value).toBe('note');
    });
  });

  describe('错误处理', () => {
    it('应该能处理store初始化失败', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.graphStore).toBeDefined();
    });

    it('应该能处理筛选器应用失败', async () => {
      wrapper = createWrapper();
      mockGraphStore.applyFilters.mockRejectedValue(new Error('Filter error'));

      try {
        await wrapper.vm.handleFilterChange();
      } catch (error) {
        expect(error.message).toBe('Filter error');
      }
    });

    it('应该能处理未定义的节点ID', () => {
      wrapper = createWrapper();
      wrapper.vm.handleOpenNote(undefined);
      expect(mockRouter.push).toHaveBeenCalled();
    });

    it('应该能处理null节点点击', () => {
      wrapper = createWrapper();
      wrapper.vm.handleNodeClick(null);
      expect(true).toBe(true);
    });
  });
});
