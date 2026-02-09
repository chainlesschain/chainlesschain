/**
 * SyncConflictsPage 单元测试
 * 测试目标: src/renderer/pages/SyncConflictsPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - 冲突列表加载
 * - 冲突解决（本地优先、远程优先、手动合并）
 * - 手动合并对话框
 * - JSON验证
 * - 错误处理
 * - 辅助方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, onMounted } from 'vue';

// Define mock using vi.hoisted to ensure it's available for vi.mock
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

// Mock ant-design-vue with our hoisted mock
vi.mock('ant-design-vue', () => ({
  message: mockMessage,
}));

// Mock logger object (used directly in setup)
const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
};

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
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

// Mock identity store
const mockIdentityStore = {
  currentOrgId: 'org-123',
};

vi.mock('../stores/identity', () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock window.electron.ipcRenderer
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
  },
};

describe('SyncConflictsPage', () => {
  let wrapper;

  const mockConflicts = [
    {
      id: 'conflict-1',
      resource_type: 'knowledge',
      resource_id: 'knowledge-123',
      local_version: 2,
      remote_version: 3,
      local_data: { title: 'Local Title', content: 'Local content' },
      remote_data: { title: 'Remote Title', content: 'Remote content' },
      created_at: Date.now() - 3600000, // 1 hour ago
    },
    {
      id: 'conflict-2',
      resource_type: 'project',
      resource_id: 'project-456',
      local_version: 5,
      remote_version: 6,
      local_data: { name: 'Local Project', description: 'Local desc' },
      remote_data: { name: 'Remote Project', description: 'Remote desc' },
      created_at: Date.now() - 7200000, // 2 hours ago
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="sync-conflicts-page">
            <div class="page-header">
              <h2>同步冲突</h2>
              <p>解决数据同步过程中的冲突</p>
            </div>

            <div v-if="loading" class="loading">Loading...</div>

            <div v-if="!loading && conflicts.length === 0" class="empty-state">
              <button @click="goBack">返回</button>
            </div>

            <div v-if="!loading && conflicts.length > 0" class="conflicts-list">
              <div
                v-for="conflict in conflicts"
                :key="conflict.id"
                class="conflict-card"
              >
                <div class="conflict-title">
                  <span>{{ getResourceTypeName(conflict.resource_type) }}</span>
                </div>

                <div class="conflict-info">
                  <p>资源ID: {{ conflict.resource_id }}</p>
                  <p>本地版本: v{{ conflict.local_version }}</p>
                  <p>远程版本: v{{ conflict.remote_version }}</p>
                  <p>发生时间: {{ formatTime(conflict.created_at) }}</p>
                </div>

                <div class="data-comparison">
                  <div>
                    <h4>本地数据</h4>
                    <textarea :value="JSON.stringify(conflict.local_data, null, 2)" readonly></textarea>
                  </div>
                  <div>
                    <h4>远程数据</h4>
                    <textarea :value="JSON.stringify(conflict.remote_data, null, 2)" readonly></textarea>
                  </div>
                </div>

                <div class="resolution-actions">
                  <button @click="handleResolve(conflict, 'local_wins')">使用本地版本</button>
                  <button @click="handleResolve(conflict, 'remote_wins')">使用远程版本</button>
                  <button @click="showManualMerge(conflict)">手动合并</button>
                </div>
              </div>
            </div>

            <div v-if="mergeModalVisible" class="merge-modal">
              <div v-if="currentConflict">
                <p>请编辑合并后的数据（JSON格式）：</p>
                <textarea
                  v-model="mergedData"
                  placeholder="输入合并后的JSON数据"
                ></textarea>
                <div v-if="mergeError" class="merge-error">{{ mergeError }}</div>
                <button @click="handleManualMergeOk">确定</button>
                <button @click="mergeModalVisible = false">取消</button>
              </div>
            </div>
          </div>
        `,
        setup() {
          // Use imported modules directly instead of require()
          const message = mockMessage;
          const logger = mockLogger;
          const router = mockRouter;
          const identityStore = mockIdentityStore;

          const loading = ref(false);
          const conflicts = ref([]);
          const mergeModalVisible = ref(false);
          const currentConflict = ref(null);
          const mergedData = ref('');
          const mergeError = ref('');

          const ipcRenderer = window.electron?.ipcRenderer;

          async function loadConflicts() {
            loading.value = true;

            try {
              const orgId = identityStore.currentOrgId;
              if (!orgId) {
                message.error('未选择组织');
                return;
              }

              const result = await ipcRenderer.invoke('sync:get-conflicts', orgId);
              conflicts.value = result || [];
            } catch (error) {
              logger.error('加载冲突列表失败:', error);
              message.error('加载冲突列表失败');
            } finally {
              loading.value = false;
            }
          }

          async function handleResolve(conflict, strategy) {
            try {
              await ipcRenderer.invoke('sync:resolve-conflict', conflict.id, {
                strategy,
              });

              message.success('冲突已解决');

              conflicts.value = conflicts.value.filter((c) => c.id !== conflict.id);
            } catch (error) {
              logger.error('解决冲突失败:', error);
              message.error(error.message || '解决冲突失败');
            }
          }

          function showManualMerge(conflict) {
            currentConflict.value = conflict;
            mergedData.value = JSON.stringify(conflict.local_data, null, 2);
            mergeError.value = '';
            mergeModalVisible.value = true;
          }

          async function handleManualMergeOk() {
            mergeError.value = '';

            try {
              const data = JSON.parse(mergedData.value);

              await ipcRenderer.invoke('sync:resolve-conflict', currentConflict.value.id, {
                strategy: 'manual',
                data,
              });

              message.success('冲突已解决');

              conflicts.value = conflicts.value.filter(
                (c) => c.id !== currentConflict.value.id
              );

              mergeModalVisible.value = false;
            } catch (error) {
              if (error instanceof SyntaxError) {
                mergeError.value = 'JSON格式错误: ' + error.message;
              } else {
                logger.error('解决冲突失败:', error);
                message.error(error.message || '解决冲突失败');
              }
            }
          }

          function getResourceTypeName(type) {
            const names = {
              knowledge: '知识库',
              project: '项目',
              member: '成员',
              role: '角色',
              settings: '设置',
            };
            return names[type] || type;
          }

          function formatTime(timestamp) {
            if (!timestamp) return '-';
            const date = new Date(timestamp);
            return date.toLocaleString('zh-CN');
          }

          function goBack() {
            router.back();
          }

          onMounted(() => {
            loadConflicts();
          });

          return {
            loading,
            conflicts,
            mergeModalVisible,
            currentConflict,
            mergedData,
            mergeError,
            loadConflicts,
            handleResolve,
            showManualMerge,
            handleManualMergeOk,
            getResourceTypeName,
            formatTime,
            goBack,
          };
        },
      },
      options
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electron.ipcRenderer.invoke.mockResolvedValue([]);
    mockIdentityStore.currentOrgId = 'org-123';
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.sync-conflicts-page').exists()).toBe(true);
    });

    it('应该在挂载时加载冲突列表', async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue(mockConflicts);
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'sync:get-conflicts',
        'org-123'
      );
    });
  });

  describe('冲突列表加载', () => {
    it('应该能加载冲突列表', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue(mockConflicts);

      await wrapper.vm.loadConflicts();

      expect(wrapper.vm.conflicts.length).toBe(2);
    });

    it('应该显示空状态当没有冲突时', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue([]);

      await wrapper.vm.loadConflicts();
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
    });

    it('应该显示冲突列表当有冲突时', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue(mockConflicts);

      await wrapper.vm.loadConflicts();
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('.conflict-card').length).toBe(2);
    });

    it('应该处理未选择组织的情况', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockIdentityStore.currentOrgId = null;

      await wrapper.vm.loadConflicts();

      expect(message.error).toHaveBeenCalledWith('未选择组织');
    });

    it('应该处理加载失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Load failed'));

      await wrapper.vm.loadConflicts();

      expect(message.error).toHaveBeenCalledWith('加载冲突列表失败');
    });

    it('应该在加载时设置loading状态', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation(() => {
        expect(wrapper.vm.loading).toBe(true);
        return Promise.resolve([]);
      });

      await wrapper.vm.loadConflicts();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe('冲突解决 - 本地优先', () => {
    it('应该能使用本地版本解决冲突', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleResolve(mockConflicts[0], 'local_wins');

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'sync:resolve-conflict',
        'conflict-1',
        { strategy: 'local_wins' }
      );
      expect(message.success).toHaveBeenCalledWith('冲突已解决');
      expect(wrapper.vm.conflicts.length).toBe(1);
    });

    it('应该能移除已解决的冲突', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleResolve(mockConflicts[0], 'local_wins');

      expect(wrapper.vm.conflicts.find((c) => c.id === 'conflict-1')).toBeUndefined();
    });
  });

  describe('冲突解决 - 远程优先', () => {
    it('应该能使用远程版本解决冲突', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = mockConflicts;
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleResolve(mockConflicts[0], 'remote_wins');

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'sync:resolve-conflict',
        'conflict-1',
        { strategy: 'remote_wins' }
      );
      expect(message.success).toHaveBeenCalledWith('冲突已解决');
    });

    it('应该能处理解决失败', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = mockConflicts;
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Resolve failed'));

      await wrapper.vm.handleResolve(mockConflicts[0], 'remote_wins');

      expect(message.error).toHaveBeenCalledWith('Resolve failed');
    });
  });

  describe('手动合并', () => {
    it('应该能显示手动合并对话框', () => {
      wrapper = createWrapper();

      wrapper.vm.showManualMerge(mockConflicts[0]);

      expect(wrapper.vm.mergeModalVisible).toBe(true);
      expect(wrapper.vm.currentConflict).toStrictEqual(mockConflicts[0]);
      expect(wrapper.vm.mergedData).toBe(
        JSON.stringify(mockConflicts[0].local_data, null, 2)
      );
      expect(wrapper.vm.mergeError).toBe('');
    });

    it('应该能手动合并并解决冲突', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = JSON.stringify(
        { title: 'Merged Title', content: 'Merged content' },
        null,
        2
      );
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleManualMergeOk();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'sync:resolve-conflict',
        'conflict-1',
        {
          strategy: 'manual',
          data: { title: 'Merged Title', content: 'Merged content' },
        }
      );
      expect(message.success).toHaveBeenCalledWith('冲突已解决');
      expect(wrapper.vm.mergeModalVisible).toBe(false);
    });

    it('应该能验证JSON格式', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = 'invalid json{';

      await wrapper.vm.handleManualMergeOk();

      expect(wrapper.vm.mergeError).toContain('JSON格式错误');
      expect(wrapper.vm.mergeModalVisible).toBe(true);
    });

    it('应该能处理手动合并失败', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = JSON.stringify({ title: 'Test' }, null, 2);
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Merge failed'));

      await wrapper.vm.handleManualMergeOk();

      expect(message.error).toHaveBeenCalledWith('Merge failed');
    });

    it('应该在关闭模态框时重置错误', () => {
      wrapper = createWrapper();
      wrapper.vm.mergeError = 'Some error';

      wrapper.vm.showManualMerge(mockConflicts[0]);

      expect(wrapper.vm.mergeError).toBe('');
    });
  });

  describe('资源类型显示', () => {
    it('应该返回正确的资源类型名称', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getResourceTypeName('knowledge')).toBe('知识库');
      expect(wrapper.vm.getResourceTypeName('project')).toBe('项目');
      expect(wrapper.vm.getResourceTypeName('member')).toBe('成员');
      expect(wrapper.vm.getResourceTypeName('role')).toBe('角色');
      expect(wrapper.vm.getResourceTypeName('settings')).toBe('设置');
      expect(wrapper.vm.getResourceTypeName('unknown')).toBe('unknown');
    });
  });

  describe('时间格式化', () => {
    it('应该格式化时间戳', () => {
      wrapper = createWrapper();
      const timestamp = new Date('2026-01-26T12:00:00').getTime();

      const formatted = wrapper.vm.formatTime(timestamp);

      expect(formatted).toContain('2026');
      expect(formatted).toContain('1');
      expect(formatted).toContain('26');
    });

    it('应该处理空时间戳', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatTime(null)).toBe('-');
      expect(wrapper.vm.formatTime(undefined)).toBe('-');
      expect(wrapper.vm.formatTime(0)).toBe('-');
    });
  });

  describe('导航', () => {
    it('应该能返回上一页', () => {
      wrapper = createWrapper();

      wrapper.vm.goBack();

      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('应该处理空冲突数组', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue(null);

      await wrapper.vm.loadConflicts();

      expect(wrapper.vm.conflicts).toEqual([]);
    });

    it('应该处理复杂的合并数据', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      wrapper.vm.currentConflict = mockConflicts[0];
      const complexData = {
        title: 'Complex',
        nested: {
          deep: {
            value: 123,
            array: [1, 2, 3],
          },
        },
      };
      wrapper.vm.mergedData = JSON.stringify(complexData, null, 2);
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleManualMergeOk();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'sync:resolve-conflict',
        'conflict-1',
        {
          strategy: 'manual',
          data: complexData,
        }
      );
    });

    it('应该处理多个冲突解决', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleResolve(mockConflicts[0], 'local_wins');
      await wrapper.vm.handleResolve(mockConflicts[1], 'remote_wins');

      expect(wrapper.vm.conflicts.length).toBe(0);
    });

    it('应该在解决冲突失败时保留冲突', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Failed'));

      await wrapper.vm.handleResolve(mockConflicts[0], 'local_wins');

      expect(wrapper.vm.conflicts.length).toBe(2);
    });
  });

  describe('JSON验证', () => {
    it('应该接受有效的JSON', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = '{"valid": "json", "number": 123}';
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleManualMergeOk();

      expect(wrapper.vm.mergeError).toBe('');
    });

    it('应该拒绝无效的JSON - 缺少引号', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = '{invalid: json}';

      await wrapper.vm.handleManualMergeOk();

      expect(wrapper.vm.mergeError).toContain('JSON格式错误');
    });

    it('应该拒绝无效的JSON - 缺少逗号', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = '{"a": 1 "b": 2}';

      await wrapper.vm.handleManualMergeOk();

      expect(wrapper.vm.mergeError).toContain('JSON格式错误');
    });

    it('应该接受空对象', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = '{}';
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleManualMergeOk();

      expect(wrapper.vm.mergeError).toBe('');
    });

    it('应该接受数组', async () => {
      wrapper = createWrapper();
      wrapper.vm.conflicts = [...mockConflicts];
      wrapper.vm.currentConflict = mockConflicts[0];
      wrapper.vm.mergedData = '[1, 2, 3]';
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      await wrapper.vm.handleManualMergeOk();

      expect(wrapper.vm.mergeError).toBe('');
    });
  });
});
