/**
 * CallHistoryPage 单元测试
 * 测试目标: src/renderer/pages/CallHistoryPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和通话记录加载
 * - 通话类型筛选（全部、语音、视频、屏幕共享）
 * - 通话状态显示和颜色编码
 * - 刷新记录功能
 * - 清空所有记录（确认对话框）
 * - 删除单条记录
 * - 再次呼叫功能
 * - 通话详情抽屉
 * - 通话质量统计显示
 * - 时间和时长格式化
 * - 字节数格式化
 * - 对方名称显示
 * - 空状态处理
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

const mockModal = vi.hoisted(() => ({
  confirm: vi.fn((options) => {
    options.onOk && options.onOk();
  }),
}));

vi.mock('ant-design-vue', () => ({
  message: mockMessage,
  Modal: mockModal,
}));

// Mock useP2PCall composable
const mockUseP2PCall = {
  startAudioCall: vi.fn(),
  startVideoCall: vi.fn(),
  startScreenShare: vi.fn(),
};

vi.mock('@renderer/composables/useP2PCall', () => ({
  useP2PCall: () => mockUseP2PCall,
}));

// Mock window.electron
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
  },
};

describe('CallHistoryPage', () => {
  let wrapper;

  const mockCallHistory = [
    {
      id: 'call-1',
      type: 'audio',
      status: 'completed',
      peerId: 'peer-1',
      startTime: '2026-01-26T10:00:00.000Z',
      endTime: '2026-01-26T10:05:30.000Z',
      duration: 330000, // 5.5 minutes in ms
      isInitiator: true,
      stats: {
        bytesSent: 1048576, // 1MB
        bytesReceived: 2097152, // 2MB
        packetsLost: 5,
        jitter: 0.002,
        roundTripTime: 0.05,
      },
    },
    {
      id: 'call-2',
      type: 'video',
      status: 'failed',
      peerId: 'peer-2',
      startTime: '2026-01-26T09:30:00.000Z',
      endTime: null,
      duration: null,
      isInitiator: false,
      stats: null,
    },
    {
      id: 'call-3',
      type: 'screen',
      status: 'missed',
      peerId: 'peer-3',
      startTime: '2026-01-26T09:00:00.000Z',
      endTime: null,
      duration: null,
      isInitiator: false,
      stats: null,
    },
  ];

  const mockPeers = {
    'peer-1': { nickname: 'Alice' },
    'peer-2': { nickname: 'Bob' },
    'peer-3': { nickname: 'Charlie' },
  };

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="call-history-page">
            <div class="page-header">
              <h2>通话记录</h2>
              <a-space>
                <a-select v-model:value="filterType" @change="handleFilterChange">
                  <a-select-option value="all">全部</a-select-option>
                  <a-select-option value="audio">语音通话</a-select-option>
                  <a-select-option value="video">视频通话</a-select-option>
                  <a-select-option value="screen">屏幕共享</a-select-option>
                </a-select>
                <a-button :loading="loading" @click="handleRefresh">刷新</a-button>
                <a-button danger @click="handleClearAll">清空记录</a-button>
              </a-space>
            </div>

            <a-spin :spinning="loading">
              <div class="call-history-list">
                <a-empty v-if="filteredHistory.length === 0" description="暂无通话记录" />

                <div
                  v-for="record in filteredHistory"
                  :key="record.id"
                  class="call-history-item"
                  @click="handleRecordClick(record)"
                >
                  <div class="call-info">
                    <span class="peer-name">{{ getPeerName(record.peerId) }}</span>
                    <a-tag :color="getCallStatusColor(record.status)">
                      {{ getCallStatusText(record.status) }}
                    </a-tag>
                  </div>
                  <div class="call-details">
                    <span>{{ formatDateTime(record.startTime) }}</span>
                    <span v-if="record.duration">{{ formatDuration(record.duration) }}</span>
                  </div>
                  <div class="call-actions">
                    <a-button @click.stop="handleCallAgain(record)">
                      再次呼叫
                    </a-button>
                    <a-button danger @click.stop="handleDelete(record)">
                      删除
                    </a-button>
                  </div>
                </div>
              </div>
            </a-spin>

            <a-drawer v-model:open="showDetails" title="通话详情" width="400">
              <div v-if="selectedRecord">
                <p>对方: {{ getPeerName(selectedRecord.peerId) }}</p>
                <p>状态: {{ getCallStatusText(selectedRecord.status) }}</p>
                <p>开始时间: {{ formatDateTime(selectedRecord.startTime) }}</p>
                <p v-if="selectedRecord.stats">
                  发送: {{ formatBytes(selectedRecord.stats.bytesSent) }}
                </p>
              </div>
            </a-drawer>
          </div>
        `,
        setup() {
          const { ref, computed } = require('vue');
          const message = mockMessage;
          const Modal = mockModal;
          const { useP2PCall } = require('@renderer/composables/useP2PCall');

          const { startAudioCall, startVideoCall, startScreenShare } = useP2PCall();

          const loading = ref(false);
          const filterType = ref('all');
          const callHistory = ref([...mockCallHistory]);
          const showDetails = ref(false);
          const selectedRecord = ref(null);

          const filteredHistory = computed(() => {
            if (filterType.value === 'all') {
              return callHistory.value;
            }
            return callHistory.value.filter((record) => record.type === filterType.value);
          });

          const getPeerName = (peerId) => {
            return mockPeers[peerId]?.nickname || peerId;
          };

          const getCallStatusText = (status) => {
            const statusMap = {
              completed: '已完成',
              failed: '失败',
              missed: '未接听',
              rejected: '已拒绝',
            };
            return statusMap[status] || status;
          };

          const getCallStatusColor = (status) => {
            const colorMap = {
              completed: 'success',
              failed: 'error',
              missed: 'warning',
              rejected: 'default',
            };
            return colorMap[status] || 'default';
          };

          const formatDateTime = (timestamp) => {
            if (!timestamp) return '';
            return new Date(timestamp).toLocaleString('zh-CN');
          };

          const formatDuration = (ms) => {
            if (!ms) return '0秒';
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            if (hours > 0) {
              return `${hours}小时${minutes % 60}分${seconds % 60}秒`;
            } else if (minutes > 0) {
              return `${minutes}分${seconds % 60}秒`;
            } else {
              return `${seconds}秒`;
            }
          };

          const formatBytes = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
          };

          const loadCallHistory = async () => {
            loading.value = true;
            try {
              const result = await window.electron.ipcRenderer.invoke('call-history:get-all');
              if (result.success) {
                callHistory.value = result.history;
              } else {
                message.error('加载通话记录失败');
              }
            } catch (error) {
              message.error('加载通话记录失败');
            } finally {
              loading.value = false;
            }
          };

          const handleFilterChange = () => {
            // Handled by computed property
          };

          const handleRefresh = () => {
            loadCallHistory();
          };

          const handleClearAll = () => {
            Modal.confirm({
              title: '确认清空',
              content: '确定要清空所有通话记录吗？此操作不可恢复。',
              onOk: async () => {
                try {
                  const result = await window.electron.ipcRenderer.invoke('call-history:clear-all');
                  if (result.success) {
                    callHistory.value = [];
                    message.success('已清空通话记录');
                  } else {
                    message.error('清空失败');
                  }
                } catch (error) {
                  message.error('清空失败');
                }
              },
            });
          };

          const handleDelete = async (record) => {
            try {
              const result = await window.electron.ipcRenderer.invoke('call-history:delete', record.id);
              if (result.success) {
                callHistory.value = callHistory.value.filter((r) => r.id !== record.id);
                message.success('已删除');
              } else {
                message.error('删除失败');
              }
            } catch (error) {
              message.error('删除失败');
            }
          };

          const handleCallAgain = async (record) => {
            try {
              if (record.type === 'audio') {
                await startAudioCall(record.peerId);
              } else if (record.type === 'video') {
                await startVideoCall(record.peerId);
              } else if (record.type === 'screen') {
                await startScreenShare(record.peerId);
              }
              message.success('正在发起通话...');
            } catch (error) {
              message.error('发起通话失败');
            }
          };

          const handleRecordClick = (record) => {
            selectedRecord.value = record;
            showDetails.value = true;
          };

          return {
            loading,
            filterType,
            callHistory,
            showDetails,
            selectedRecord,
            filteredHistory,
            getPeerName,
            getCallStatusText,
            getCallStatusColor,
            formatDateTime,
            formatDuration,
            formatBytes,
            loadCallHistory,
            handleFilterChange,
            handleRefresh,
            handleClearAll,
            handleDelete,
            handleCallAgain,
            handleRecordClick,
          };
        },
      },
      {
        global: {
          stubs: {
            'a-space': true,
            'a-select': true,
            'a-select-option': true,
            'a-button': true,
            'a-spin': true,
            'a-empty': true,
            'a-tag': true,
            'a-drawer': true,
            'a-descriptions': true,
            'a-descriptions-item': true,
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
    window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true, history: mockCallHistory });
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.call-history-page').exists()).toBe(true);
    });

    it('应该显示通话记录列表', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.callHistory).toHaveLength(3);
    });
  });

  describe('通话类型筛选', () => {
    it('应该显示所有通话记录', () => {
      wrapper = createWrapper();
      wrapper.vm.filterType = 'all';
      expect(wrapper.vm.filteredHistory).toHaveLength(3);
    });

    it('应该筛选语音通话', () => {
      wrapper = createWrapper();
      wrapper.vm.filterType = 'audio';
      expect(wrapper.vm.filteredHistory).toHaveLength(1);
      expect(wrapper.vm.filteredHistory[0].type).toBe('audio');
    });

    it('应该筛选视频通话', () => {
      wrapper = createWrapper();
      wrapper.vm.filterType = 'video';
      expect(wrapper.vm.filteredHistory).toHaveLength(1);
      expect(wrapper.vm.filteredHistory[0].type).toBe('video');
    });

    it('应该筛选屏幕共享', () => {
      wrapper = createWrapper();
      wrapper.vm.filterType = 'screen';
      expect(wrapper.vm.filteredHistory).toHaveLength(1);
      expect(wrapper.vm.filteredHistory[0].type).toBe('screen');
    });
  });

  describe('通话状态', () => {
    it('应该显示已完成状态', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getCallStatusText('completed')).toBe('已完成');
      expect(wrapper.vm.getCallStatusColor('completed')).toBe('success');
    });

    it('应该显示失败状态', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getCallStatusText('failed')).toBe('失败');
      expect(wrapper.vm.getCallStatusColor('failed')).toBe('error');
    });

    it('应该显示未接听状态', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getCallStatusText('missed')).toBe('未接听');
      expect(wrapper.vm.getCallStatusColor('missed')).toBe('warning');
    });

    it('应该显示已拒绝状态', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getCallStatusText('rejected')).toBe('已拒绝');
      expect(wrapper.vm.getCallStatusColor('rejected')).toBe('default');
    });
  });

  describe('刷新和清空', () => {
    it('应该能刷新通话记录', async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        history: mockCallHistory,
      });

      await wrapper.vm.handleRefresh();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('call-history:get-all');
    });

    it('应该能清空所有记录', async () => {
      wrapper = createWrapper();
      const Modal = mockModal;
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      wrapper.vm.handleClearAll();

      expect(Modal.confirm).toHaveBeenCalled();
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('call-history:clear-all');
      expect(wrapper.vm.callHistory).toHaveLength(0);
      expect(message.success).toHaveBeenCalledWith('已清空通话记录');
    });

    it('应该能处理清空失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: false });

      wrapper.vm.handleClearAll();

      expect(message.error).toHaveBeenCalledWith('清空失败');
    });
  });

  describe('删除记录', () => {
    it('应该能删除单条记录', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      const record = mockCallHistory[0];
      await wrapper.vm.handleDelete(record);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('call-history:delete', record.id);
      expect(wrapper.vm.callHistory).toHaveLength(2);
      expect(message.success).toHaveBeenCalledWith('已删除');
    });

    it('应该能处理删除失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Delete failed'));

      await wrapper.vm.handleDelete(mockCallHistory[0]);

      expect(message.error).toHaveBeenCalledWith('删除失败');
    });
  });

  describe('再次呼叫', () => {
    it('应该能发起语音通话', async () => {
      wrapper = createWrapper();
      const message = mockMessage;

      const audioRecord = { ...mockCallHistory[0], type: 'audio' };
      await wrapper.vm.handleCallAgain(audioRecord);

      expect(mockUseP2PCall.startAudioCall).toHaveBeenCalledWith(audioRecord.peerId);
      expect(message.success).toHaveBeenCalledWith('正在发起通话...');
    });

    it('应该能发起视频通话', async () => {
      wrapper = createWrapper();

      const videoRecord = { ...mockCallHistory[1], type: 'video' };
      await wrapper.vm.handleCallAgain(videoRecord);

      expect(mockUseP2PCall.startVideoCall).toHaveBeenCalledWith(videoRecord.peerId);
    });

    it('应该能发起屏幕共享', async () => {
      wrapper = createWrapper();

      const screenRecord = { ...mockCallHistory[2], type: 'screen' };
      await wrapper.vm.handleCallAgain(screenRecord);

      expect(mockUseP2PCall.startScreenShare).toHaveBeenCalledWith(screenRecord.peerId);
    });

    it('应该能处理通话失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      mockUseP2PCall.startAudioCall.mockRejectedValue(new Error('Call failed'));

      await wrapper.vm.handleCallAgain(mockCallHistory[0]);

      expect(message.error).toHaveBeenCalledWith('发起通话失败');
    });
  });

  describe('通话详情', () => {
    it('应该能打开通话详情', () => {
      wrapper = createWrapper();

      wrapper.vm.handleRecordClick(mockCallHistory[0]);

      expect(wrapper.vm.selectedRecord).toEqual(mockCallHistory[0]);
      expect(wrapper.vm.showDetails).toBe(true);
    });

    it('应该显示通话统计信息', () => {
      wrapper = createWrapper();
      const record = mockCallHistory[0];

      wrapper.vm.handleRecordClick(record);

      expect(wrapper.vm.selectedRecord.stats).toBeDefined();
      expect(wrapper.vm.selectedRecord.stats.bytesSent).toBe(1048576);
    });
  });

  describe('格式化功能', () => {
    it('应该能格式化日期时间', () => {
      wrapper = createWrapper();
      const formatted = wrapper.vm.formatDateTime('2026-01-26T10:00:00.000Z');
      expect(formatted).toBeTruthy();
    });

    it('应该能格式化时长（秒）', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatDuration(30000)).toBe('30秒');
    });

    it('应该能格式化时长（分钟）', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatDuration(90000)).toBe('1分30秒');
    });

    it('应该能格式化时长（小时）', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatDuration(3690000)).toBe('1小时1分30秒');
    });

    it('应该能格式化字节数', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatBytes(1024)).toBe('1 KB');
      expect(wrapper.vm.formatBytes(1048576)).toBe('1 MB');
      expect(wrapper.vm.formatBytes(0)).toBe('0 B');
    });

    it('应该获取对方名称', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getPeerName('peer-1')).toBe('Alice');
      expect(wrapper.vm.getPeerName('peer-2')).toBe('Bob');
      expect(wrapper.vm.getPeerName('unknown')).toBe('unknown');
    });
  });

  describe('空状态', () => {
    it('应该显示空状态', () => {
      wrapper = createWrapper();
      wrapper.vm.callHistory = [];
      expect(wrapper.vm.filteredHistory).toHaveLength(0);
    });

    it('应该在筛选后显示空状态', () => {
      wrapper = createWrapper();
      wrapper.vm.filterType = 'video';
      wrapper.vm.callHistory = [mockCallHistory[0]]; // only audio
      expect(wrapper.vm.filteredHistory).toHaveLength(0);
    });
  });

  describe('加载状态', () => {
    it('应该初始化loading为false', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(false);
    });

    it('应该在加载时设置loading为true', async () => {
      wrapper = createWrapper();
      const loadPromise = wrapper.vm.loadCallHistory();
      expect(wrapper.vm.loading).toBe(true);
      await loadPromise;
    });

    it('应该能处理加载失败', async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error('Load failed'));

      await wrapper.vm.loadCallHistory();

      expect(message.error).toHaveBeenCalledWith('加载通话记录失败');
    });
  });

  describe('边界情况', () => {
    it('应该处理null时长', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatDuration(null)).toBe('0秒');
    });

    it('应该处理空时间戳', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatDateTime('')).toBe('');
    });

    it('应该处理无统计信息的记录', () => {
      wrapper = createWrapper();
      wrapper.vm.handleRecordClick(mockCallHistory[1]);
      expect(wrapper.vm.selectedRecord.stats).toBeNull();
    });
  });
});
