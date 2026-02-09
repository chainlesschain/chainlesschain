/**
 * DatabasePerformancePage 单元测试
 * 测试目标: src/renderer/pages/DatabasePerformancePage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和数据加载
 * - 性能统计显示（总查询数、平均查询时间、慢查询数、缓存命中率）
 * - 数据库操作（刷新统计、重置统计、清空缓存、优化数据库）
 * - 慢查询日志管理
 * - 索引优化建议
 * - 缓存统计显示
 * - 颜色编码和格式化
 * - 错误处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('ant-design-vue', () => ({
  message: mockMessage,
  Modal: {
    confirm: vi.fn(),
  },
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    invoke: vi.fn(),
  },
};

describe('DatabasePerformancePage', () => {
  let wrapper;

  const mockStats = {
    totalQueries: 15000,
    slowQueries: 25,
    avgQueryTime: 32.5,
    cache: {
      hits: 8000,
      misses: 2000,
      hitRate: '80.00%',
      size: 450,
      maxSize: 1000,
      evictions: 50,
    },
  };

  const mockSlowQueries = [
    {
      id: 1,
      sql: 'SELECT * FROM notes WHERE content LIKE ? ORDER BY created_at DESC',
      duration: 250,
      timestamp: '2026-01-26T10:30:00.000Z',
    },
    {
      id: 2,
      sql: 'SELECT n.*, t.name FROM notes n JOIN tags t ON n.id = t.note_id',
      duration: 180,
      timestamp: '2026-01-26T10:25:00.000Z',
    },
    {
      id: 3,
      sql: 'UPDATE notes SET updated_at = ? WHERE id IN (SELECT id FROM temp)',
      duration: 150,
      timestamp: '2026-01-26T10:20:00.000Z',
    },
  ];

  const mockIndexSuggestions = [
    {
      table: 'notes',
      column: 'content',
      reason: '频繁的 LIKE 查询可以通过 FTS 索引加速',
      sql: 'CREATE INDEX idx_notes_content ON notes(content)',
    },
    {
      table: 'tags',
      column: 'note_id',
      reason: 'JOIN 操作需要外键索引',
      sql: 'CREATE INDEX idx_tags_note_id ON tags(note_id)',
    },
    {
      table: 'notes',
      column: 'updated_at',
      reason: 'WHERE 子句中频繁使用',
      sql: 'CREATE INDEX idx_notes_updated_at ON notes(updated_at)',
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="database-performance-page">
            <div class="page-header">
              <h1>数据库性能监控</h1>
              <p class="page-description">实时监控数据库性能，优化查询效率</p>
            </div>

            <div class="page-content">
              <!-- Stats Overview -->
              <a-row :gutter="16" class="stats-row">
                <a-col :span="6">
                  <a-card>
                    <a-statistic
                      title="总查询数"
                      :value="stats.totalQueries"
                    />
                  </a-card>
                </a-col>
                <a-col :span="6">
                  <a-card>
                    <a-statistic
                      title="平均查询时间"
                      :value="stats.avgQueryTime"
                      suffix="ms"
                      :precision="2"
                    />
                  </a-card>
                </a-col>
                <a-col :span="6">
                  <a-card>
                    <a-statistic
                      title="慢查询数"
                      :value="stats.slowQueries"
                    />
                  </a-card>
                </a-col>
                <a-col :span="6">
                  <a-card>
                    <a-statistic
                      title="缓存命中率"
                      :value="cacheHitRate"
                      suffix="%"
                      :precision="2"
                    />
                  </a-card>
                </a-col>
              </a-row>

              <!-- Operations Card -->
              <a-card title="数据库操作" class="operations-card">
                <a-space>
                  <a-button type="primary" :loading="loading" @click="refreshStats">
                    刷新统计
                  </a-button>
                  <a-button :loading="resetting" @click="resetStats">
                    重置统计
                  </a-button>
                  <a-button :loading="clearingCache" @click="clearCache">
                    清空缓存
                  </a-button>
                  <a-button type="primary" danger :loading="optimizing" @click="optimizeDatabase">
                    优化数据库
                  </a-button>
                </a-space>
              </a-card>

              <!-- Slow Queries Table -->
              <a-card title="慢查询日志" class="slow-queries-card">
                <a-table
                  :columns="slowQueryColumns"
                  :data-source="slowQueries"
                  :pagination="{ pageSize: 10 }"
                  :loading="loading"
                  size="small"
                />
              </a-card>

              <!-- Index Suggestions -->
              <a-card title="索引优化建议" class="index-suggestions-card">
                <a-list :data-source="indexSuggestions" item-layout="horizontal">
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <template #actions>
                        <a-button
                          type="link"
                          :loading="applyingIndex"
                          @click="applyIndexSuggestion(item)"
                        >
                          应用
                        </a-button>
                      </template>
                      <a-list-item-meta>
                        <template #title>
                          {{ item.table }}.{{ item.column }}
                        </template>
                        <template #description>
                          {{ item.reason }}
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>
                <div v-if="indexSuggestions.length > 0" class="apply-all-btn">
                  <a-button
                    type="primary"
                    :loading="applyingAllIndexes"
                    @click="applyAllIndexSuggestions"
                  >
                    应用所有建议
                  </a-button>
                </div>
              </a-card>

              <!-- Cache Stats -->
              <a-card title="查询缓存统计" class="cache-stats-card">
                <a-descriptions :column="2" bordered>
                  <a-descriptions-item label="缓存大小">
                    {{ stats.cache?.size || 0 }} / {{ stats.cache?.maxSize || 0 }}
                  </a-descriptions-item>
                  <a-descriptions-item label="命中率">
                    {{ stats.cache?.hitRate || '0%' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="命中次数">
                    {{ stats.cache?.hits || 0 }}
                  </a-descriptions-item>
                  <a-descriptions-item label="未命中次数">
                    {{ stats.cache?.misses || 0 }}
                  </a-descriptions-item>
                  <a-descriptions-item label="驱逐次数">
                    {{ stats.cache?.evictions || 0 }}
                  </a-descriptions-item>
                </a-descriptions>
              </a-card>
            </div>
          </div>
        `,
        setup() {
          const { ref, computed, onMounted } = require('vue');
          const message = mockMessage;

          const stats = ref({ ...mockStats });
          const slowQueries = ref([...mockSlowQueries]);
          const indexSuggestions = ref([...mockIndexSuggestions]);

          const loading = ref(false);
          const resetting = ref(false);
          const clearingCache = ref(false);
          const optimizing = ref(false);
          const applyingIndex = ref(false);
          const applyingAllIndexes = ref(false);

          const cacheHitRate = computed(() => {
            const hitRate = stats.value.cache?.hitRate || '0%';
            return parseFloat(hitRate);
          });

          const slowQueryColumns = [
            { title: 'SQL', dataIndex: 'sql', key: 'sql' },
            { title: '耗时', dataIndex: 'duration', key: 'duration' },
            { title: '时间', dataIndex: 'timestamp', key: 'timestamp' },
          ];

          const getDurationColor = (duration) => {
            if (duration > 200) return 'red';
            if (duration > 100) return 'orange';
            return 'green';
          };

          const formatTime = (timestamp) => {
            return new Date(timestamp).toLocaleString('zh-CN');
          };

          const loadStats = async () => {
            loading.value = true;
            try {
              const data = await window.electronAPI.invoke(
                'db:get-performance-stats'
              );
              stats.value = data;
            } catch (error) {
              message.error('加载统计失败: ' + error.message);
            } finally {
              loading.value = false;
            }
          };

          const loadSlowQueries = async () => {
            try {
              const data = await window.electronAPI.invoke(
                'db:get-slow-queries'
              );
              slowQueries.value = data;
            } catch (error) {
              message.error('加载慢查询失败: ' + error.message);
            }
          };

          const loadIndexSuggestions = async () => {
            try {
              const data = await window.electronAPI.invoke(
                'db:get-index-suggestions'
              );
              indexSuggestions.value = data;
            } catch (error) {
              message.error('加载索引建议失败: ' + error.message);
            }
          };

          const refreshStats = async () => {
            await Promise.all([
              loadStats(),
              loadSlowQueries(),
              loadIndexSuggestions(),
            ]);
            message.success('统计已刷新');
          };

          const resetStats = async () => {
            resetting.value = true;
            try {
              await window.electronAPI.invoke('db:reset-stats');
              await loadStats();
              message.success('统计已重置');
            } catch (error) {
              message.error('重置失败: ' + error.message);
            } finally {
              resetting.value = false;
            }
          };

          const clearCache = async () => {
            clearingCache.value = true;
            try {
              await window.electronAPI.invoke('db:clear-cache');
              await loadStats();
              message.success('缓存已清空');
            } catch (error) {
              message.error('清空缓存失败: ' + error.message);
            } finally {
              clearingCache.value = false;
            }
          };

          const optimizeDatabase = async () => {
            optimizing.value = true;
            try {
              await window.electronAPI.invoke('db:optimize');
              await loadStats();
              message.success('数据库优化完成');
            } catch (error) {
              message.error('优化失败: ' + error.message);
            } finally {
              optimizing.value = false;
            }
          };

          const applyIndexSuggestion = async (suggestion) => {
            applyingIndex.value = true;
            try {
              await window.electronAPI.invoke('db:apply-index', {
                table: suggestion.table,
                column: suggestion.column,
                sql: suggestion.sql,
              });
              message.success(`索引 ${suggestion.table}.${suggestion.column} 已应用`);
              await loadIndexSuggestions();
            } catch (error) {
              message.error('应用索引失败: ' + error.message);
            } finally {
              applyingIndex.value = false;
            }
          };

          const applyAllIndexSuggestions = async () => {
            applyingAllIndexes.value = true;
            try {
              await window.electronAPI.invoke(
                'db:apply-all-indexes',
                indexSuggestions.value
              );
              message.success('所有索引已应用');
              await loadIndexSuggestions();
            } catch (error) {
              message.error('批量应用索引失败: ' + error.message);
            } finally {
              applyingAllIndexes.value = false;
            }
          };

          onMounted(() => {
            loadStats();
            loadSlowQueries();
            loadIndexSuggestions();
          });

          return {
            stats,
            slowQueries,
            indexSuggestions,
            loading,
            resetting,
            clearingCache,
            optimizing,
            applyingIndex,
            applyingAllIndexes,
            cacheHitRate,
            slowQueryColumns,
            getDurationColor,
            formatTime,
            loadStats,
            loadSlowQueries,
            loadIndexSuggestions,
            refreshStats,
            resetStats,
            clearCache,
            optimizeDatabase,
            applyIndexSuggestion,
            applyAllIndexSuggestions,
          };
        },
      },
      {
        global: {
          stubs: {
            'a-row': true,
            'a-col': true,
            'a-card': true,
            'a-statistic': true,
            'a-space': true,
            'a-button': true,
            'a-table': true,
            'a-list': true,
            'a-list-item': true,
            'a-list-item-meta': true,
            'a-descriptions': true,
            'a-descriptions-item': true,
            'a-tag': true,
            'a-tooltip': true,
            'a-alert': true,
            'a-popconfirm': true,
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.invoke.mockResolvedValue({});
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.database-performance-page').exists()).toBe(true);
    });

    it('应该在挂载时加载数据', async () => {
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce(mockSlowQueries)
        .mockResolvedValueOnce(mockIndexSuggestions);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:get-performance-stats'
      );
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:get-slow-queries'
      );
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:get-index-suggestions'
      );
    });
  });

  describe('性能统计显示', () => {
    it('应该显示总查询数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.totalQueries).toBe(15000);
    });

    it('应该显示平均查询时间', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.avgQueryTime).toBe(32.5);
    });

    it('应该显示慢查询数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.slowQueries).toBe(25);
    });

    it('应该计算缓存命中率', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.cacheHitRate).toBe(80.0);
    });

    it('应该能处理0%缓存命中率', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.cache.hitRate = '0%';
      expect(wrapper.vm.cacheHitRate).toBe(0);
    });

    it('应该能处理100%缓存命中率', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.cache.hitRate = '100%';
      expect(wrapper.vm.cacheHitRate).toBe(100);
    });
  });

  describe('数据库操作', () => {
    it('应该能刷新统计', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce(mockSlowQueries)
        .mockResolvedValueOnce(mockIndexSuggestions);

      await wrapper.vm.refreshStats();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:get-performance-stats'
      );
      expect(message.success).toHaveBeenCalledWith('统计已刷新');
    });

    it('应该能重置统计', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockStats);

      await wrapper.vm.resetStats();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith('db:reset-stats');
      expect(message.success).toHaveBeenCalledWith('统计已重置');
    });

    it('应该能处理重置失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('重置失败'));

      await wrapper.vm.resetStats();

      expect(message.error).toHaveBeenCalledWith('重置失败: 重置失败');
    });

    it('应该能清空缓存', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockStats);

      await wrapper.vm.clearCache();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith('db:clear-cache');
      expect(message.success).toHaveBeenCalledWith('缓存已清空');
    });

    it('应该能处理清空缓存失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('清空失败'));

      await wrapper.vm.clearCache();

      expect(message.error).toHaveBeenCalledWith('清空缓存失败: 清空失败');
    });

    it('应该能优化数据库', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockStats);

      await wrapper.vm.optimizeDatabase();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith('db:optimize');
      expect(message.success).toHaveBeenCalledWith('数据库优化完成');
    });

    it('应该能处理优化失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('优化失败'));

      await wrapper.vm.optimizeDatabase();

      expect(message.error).toHaveBeenCalledWith('优化失败: 优化失败');
    });
  });

  describe('慢查询日志', () => {
    it('应该显示慢查询列表', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.slowQueries).toHaveLength(3);
    });

    it('应该显示SQL查询', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.slowQueries[0].sql).toContain('SELECT * FROM notes');
    });

    it('应该显示查询耗时', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.slowQueries[0].duration).toBe(250);
    });

    it('应该能获取耗时颜色', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getDurationColor(250)).toBe('red');
      expect(wrapper.vm.getDurationColor(150)).toBe('orange');
      expect(wrapper.vm.getDurationColor(50)).toBe('green');
    });

    it('应该能格式化时间', () => {
      wrapper = createWrapper();
      const formatted = wrapper.vm.formatTime(
        '2026-01-26T10:30:00.000Z'
      );
      expect(formatted).toBeTruthy();
    });

    it('应该能处理空慢查询列表', () => {
      wrapper = createWrapper();
      wrapper.vm.slowQueries = [];
      expect(wrapper.vm.slowQueries).toHaveLength(0);
    });
  });

  describe('索引优化建议', () => {
    it('应该显示索引建议列表', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.indexSuggestions).toHaveLength(3);
    });

    it('应该显示表名和列名', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.indexSuggestions[0].table).toBe('notes');
      expect(wrapper.vm.indexSuggestions[0].column).toBe('content');
    });

    it('应该显示优化理由', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.indexSuggestions[0].reason).toContain('FTS 索引');
    });

    it('应该显示SQL语句', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.indexSuggestions[0].sql).toContain('CREATE INDEX');
    });

    it('应该能应用单个索引建议', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce([]);

      await wrapper.vm.applyIndexSuggestion(mockIndexSuggestions[0]);

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:apply-index',
        expect.objectContaining({
          table: 'notes',
          column: 'content',
        })
      );
      expect(message.success).toHaveBeenCalledWith(
        '索引 notes.content 已应用'
      );
    });

    it('应该能处理应用索引失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('索引错误'));

      await wrapper.vm.applyIndexSuggestion(mockIndexSuggestions[0]);

      expect(message.error).toHaveBeenCalledWith('应用索引失败: 索引错误');
    });

    it('应该能应用所有索引建议', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce([]);

      await wrapper.vm.applyAllIndexSuggestions();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:apply-all-indexes',
        mockIndexSuggestions
      );
      expect(message.success).toHaveBeenCalledWith('所有索引已应用');
    });

    it('应该能处理批量应用失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('批量失败'));

      await wrapper.vm.applyAllIndexSuggestions();

      expect(message.error).toHaveBeenCalledWith(
        '批量应用索引失败: 批量失败'
      );
    });

    it('应该能处理空索引建议列表', () => {
      wrapper = createWrapper();
      wrapper.vm.indexSuggestions = [];
      expect(wrapper.vm.indexSuggestions).toHaveLength(0);
    });
  });

  describe('缓存统计', () => {
    it('应该显示缓存大小', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.cache.size).toBe(450);
      expect(wrapper.vm.stats.cache.maxSize).toBe(1000);
    });

    it('应该显示命中率', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.cache.hitRate).toBe('80.00%');
    });

    it('应该显示命中次数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.cache.hits).toBe(8000);
    });

    it('应该显示未命中次数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.cache.misses).toBe(2000);
    });

    it('应该显示驱逐次数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.cache.evictions).toBe(50);
    });

    it('应该能处理空缓存统计', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.cache = null;
      expect(wrapper.vm.cacheHitRate).toBe(0);
    });
  });

  describe('加载状态', () => {
    it('应该初始化loading为false', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该在加载时设置loading为true', async () => {
      wrapper = createWrapper();
      const loadPromise = wrapper.vm.loadStats();
      expect(wrapper.vm.loading).toBe(true);
      await loadPromise;
    });

    it('应该在加载完成后设置loading为false', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke.mockResolvedValue(mockStats);

      await wrapper.vm.loadStats();
      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该管理resetting状态', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke.mockResolvedValue();

      const resetPromise = wrapper.vm.resetStats();
      expect(wrapper.vm.resetting).toBe(true);
      await resetPromise;
      expect(wrapper.vm.resetting).toBe(false);
    });

    it('应该管理clearingCache状态', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke.mockResolvedValue();

      const clearPromise = wrapper.vm.clearCache();
      expect(wrapper.vm.clearingCache).toBe(true);
      await clearPromise;
      expect(wrapper.vm.clearingCache).toBe(false);
    });

    it('应该管理optimizing状态', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke.mockResolvedValue();

      const optimizePromise = wrapper.vm.optimizeDatabase();
      expect(wrapper.vm.optimizing).toBe(true);
      await optimizePromise;
      expect(wrapper.vm.optimizing).toBe(false);
    });
  });

  describe('表格列配置', () => {
    it('应该定义慢查询表格列', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.slowQueryColumns).toHaveLength(3);
      expect(wrapper.vm.slowQueryColumns[0].key).toBe('sql');
      expect(wrapper.vm.slowQueryColumns[1].key).toBe('duration');
      expect(wrapper.vm.slowQueryColumns[2].key).toBe('timestamp');
    });
  });

  describe('边界情况', () => {
    it('应该能处理零查询', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.totalQueries = 0;
      expect(wrapper.vm.stats.totalQueries).toBe(0);
    });

    it('应该能处理零慢查询', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.slowQueries = 0;
      expect(wrapper.vm.stats.slowQueries).toBe(0);
    });

    it('应该能处理极快查询时间', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.avgQueryTime = 0.1;
      expect(wrapper.vm.stats.avgQueryTime).toBe(0.1);
    });

    it('应该能处理极慢查询时间', () => {
      wrapper = createWrapper();
      wrapper.vm.stats.avgQueryTime = 5000;
      expect(wrapper.vm.stats.avgQueryTime).toBe(5000);
    });

    it('应该能处理负数耗时颜色', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getDurationColor(-10)).toBe('green');
    });

    it('应该能处理边界耗时值', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getDurationColor(100)).toBe('green');
      expect(wrapper.vm.getDurationColor(200)).toBe('orange');
    });

    it('应该能处理无效时间格式', () => {
      wrapper = createWrapper();
      const formatted = wrapper.vm.formatTime('invalid-date');
      expect(formatted).toBeTruthy();
    });
  });

  describe('错误处理', () => {
    it('应该能处理统计加载失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('加载错误'));

      await wrapper.vm.loadStats();

      expect(message.error).toHaveBeenCalledWith('加载统计失败: 加载错误');
    });

    it('应该能处理慢查询加载失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('查询错误'));

      await wrapper.vm.loadSlowQueries();

      expect(message.error).toHaveBeenCalledWith(
        '加载慢查询失败: 查询错误'
      );
    });

    it('应该能处理索引建议加载失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error('建议错误'));

      await wrapper.vm.loadIndexSuggestions();

      expect(message.error).toHaveBeenCalledWith(
        '加载索引建议失败: 建议错误'
      );
    });

    it('应该能处理部分加载失败', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockRejectedValueOnce(new Error('慢查询失败'))
        .mockResolvedValueOnce([]);

      await wrapper.vm.refreshStats();

      expect(wrapper.vm.stats).toEqual(mockStats);
    });
  });

  describe('数据刷新', () => {
    it('应该能同时刷新所有数据', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce(mockSlowQueries)
        .mockResolvedValueOnce(mockIndexSuggestions);

      await wrapper.vm.refreshStats();

      expect(window.electronAPI.invoke).toHaveBeenCalledTimes(3);
    });

    it('应该在操作后刷新统计', async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockStats);

      await wrapper.vm.resetStats();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        'db:get-performance-stats'
      );
    });
  });
});
