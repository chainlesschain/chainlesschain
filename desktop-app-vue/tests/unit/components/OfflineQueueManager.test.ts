/**
 * OfflineQueueManager 组件单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import OfflineQueueManager from '@renderer/components/OfflineQueueManager.vue';

// Hoisted mocks for ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

// Mock Ant Design Vue components
const globalStubs = {
  'a-card': {
    template: '<div class="a-card"><div class="card-title"><slot name="title" /></div><div class="card-extra"><slot name="extra" /></div><slot /></div>',
    props: ['title', 'loading'],
  },
  'a-space': {
    template: '<div class="a-space"><slot /></div>',
  },
  'a-badge': {
    template: '<div class="a-badge"><slot /></div>',
    props: ['count', 'numberStyle'],
  },
  'a-button': {
    template: '<button class="a-button" v-bind="$attrs" @click="$attrs.onClick"><slot name="icon" /><slot /></button>',
    props: ['disabled', 'danger'],
  },
  'a-row': {
    template: '<div class="a-row"><slot /></div>',
    props: ['gutter'],
  },
  'a-col': {
    template: '<div class="a-col"><slot /></div>',
    props: ['span'],
  },
  'a-statistic': {
    template: '<div class="a-statistic"><div class="statistic-title">{{ title }}</div><div class="statistic-value">{{ value }}</div><slot name="prefix" /></div>',
    props: ['title', 'value', 'valueStyle'],
  },
  'a-table': {
    template: '<div class="a-table"><div v-for="item in dataSource" :key="item.id"><slot name="bodyCell" :column="{ key: \'status\' }" :record="item" /></div></div>',
    props: ['columns', 'dataSource', 'pagination', 'loading', 'rowKey'],
    emits: ['change'],
  },
  'a-tag': {
    template: '<span class="a-tag" :data-color="color"><slot /></span>',
    props: ['color'],
  },
  'a-typography-text': {
    template: '<span class="a-typography-text"><slot /></span>',
    props: ['copyable'],
  },
  'a-tooltip': {
    template: '<div class="a-tooltip"><slot /></div>',
    props: ['title'],
  },
  'a-modal': {
    template: '<div v-if="open" class="a-modal"><div class="modal-title">{{ title }}</div><slot /><div class="modal-footer"><slot name="footer" /></div></div>',
    props: ['open', 'title', 'width', 'footer'],
    emits: ['update:open', 'ok'],
  },
  'a-descriptions': {
    template: '<div class="a-descriptions"><slot /></div>',
    props: ['bordered', 'column'],
  },
  'a-descriptions-item': {
    template: '<div class="a-descriptions-item"><span class="label">{{ label }}</span><span class="content"><slot /></span></div>',
    props: ['label'],
  },
  'a-typography-paragraph': {
    template: '<div class="a-typography-paragraph"><slot /></div>',
    props: ['copyable'],
  },
  'a-alert': {
    template: '<div class="a-alert"><slot /></div>',
    props: ['message', 'description', 'type', 'showIcon'],
  },
  'ReloadOutlined': { template: '<span>🔄</span>' },
  'SyncOutlined': { template: '<span>🔄</span>' },
  'DeleteOutlined': { template: '<span>🗑️</span>' },
  'ClockCircleOutlined': { template: '<span>🕐</span>' },
  'LoadingOutlined': { template: '<span>⏳</span>' },
  'ExclamationCircleOutlined': { template: '<span>⚠️</span>' },
  'InboxOutlined': { template: '<span>📥</span>' },
  'EyeOutlined': { template: '<span>👁</span>' },
};

// Mock window.electron
const mockIpcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
};

global.window = global.window || {};
(global.window as any).electron = {
  ipcRenderer: mockIpcRenderer,
};

// Mock ant-design-vue message
vi.mock('ant-design-vue', () => ({
  message: mockMessage,
}));

describe('OfflineQueueManager.vue', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('队列加载', () => {
    it('应该在挂载时加载离线队列', async () => {
      const mockMessages = [
        {
          id: 'msg1',
          targetPeerId: 'peer123',
          content: '测试消息1',
          status: 'pending',
          retryCount: 0,
          createdAt: Date.now(),
        },
        {
          id: 'msg2',
          targetPeerId: 'peer456',
          content: '测试消息2',
          status: 'failed',
          retryCount: 2,
          createdAt: Date.now() - 3600000,
        },
      ];

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('p2p:get-message-queue');
      expect(wrapper.vm.queueMessages).toEqual(mockMessages);
    });

    it('加载失败时应该显示错误消息', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: false,
        error: '网络错误',
      });

      const message = mockMessage;

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(message.error).toHaveBeenCalledWith('加载离线队列失败: 网络错误');
    });

    it('应该正确设置loading状态', async () => {
      vi.useFakeTimers();

      mockIpcRenderer.invoke.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, messages: [] }), 100);
        });
      });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      // 初始状态应该是 loading
      expect(wrapper.vm.loading).toBe(true);

      // 推进定时器并等待 Promise 完成
      await vi.advanceTimersByTimeAsync(100);
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('队列统计', () => {
    const mockMessages = [
      { id: '1', status: 'pending', retryCount: 0, createdAt: Date.now() },
      { id: '2', status: 'pending', retryCount: 1, createdAt: Date.now() },
      { id: '3', status: 'sending', retryCount: 0, createdAt: Date.now() },
      { id: '4', status: 'failed', retryCount: 3, createdAt: Date.now() },
      { id: '5', status: 'failed', retryCount: 2, createdAt: Date.now() },
    ];

    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: mockMessages,
      });
    });

    it('应该正确计算待发送消息数量', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.queueStats.pendingMessages).toBe(2);
    });

    it('应该正确计算发送中消息数量', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.queueStats.sendingMessages).toBe(1);
    });

    it('应该正确计算失败消息数量', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.queueStats.failedMessages).toBe(2);
    });

    it('应该正确计算总消息数量', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.queueStats.totalMessages).toBe(5);
    });
  });

  describe('消息操作', () => {
    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: [],
      });
    });

    it('应该重试单条消息', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({ success: true });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const mockMessage = {
        id: 'msg1',
        targetPeerId: 'peer123',
        content: '测试消息',
        status: 'failed',
        retryCount: 2,
      };

      await wrapper.vm.handleRetry(mockMessage);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('p2p:retry-message', 'msg1');
    });

    it('应该批量重试所有消息', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({ success: true, count: 5 });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      await wrapper.vm.handleRetryAll();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('p2p:retry-all-messages');
    });

    it('应该删除单条消息', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({ success: true });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const mockMessage = {
        id: 'msg1',
        targetPeerId: 'peer123',
        content: '测试消息',
        status: 'failed',
      };

      await wrapper.vm.handleDelete(mockMessage);

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('p2p:delete-message', 'msg1');
    });

    it('应该清空整个队列', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({ success: true });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      await wrapper.vm.handleClearAll();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('p2p:clear-message-queue');
    });

    it('应该查看消息详情', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const mockMessage = {
        id: 'msg1',
        targetPeerId: 'peer123',
        content: '测试消息',
        status: 'pending',
      };

      wrapper.vm.handleViewDetails(mockMessage);

      expect(wrapper.vm.selectedMessage).toEqual(mockMessage);
      expect(wrapper.vm.showDetailsModal).toBe(true);
    });
  });

  describe('工具函数', () => {
    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: [],
      });
    });

    it('应该正确获取状态颜色', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.getStatusColor('pending')).toBe('blue');
      expect(wrapper.vm.getStatusColor('sending')).toBe('orange');
      expect(wrapper.vm.getStatusColor('failed')).toBe('red');
      expect(wrapper.vm.getStatusColor('delivered')).toBe('green');
    });

    it('应该正确获取状态文本', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.getStatusText('pending')).toBe('待发送');
      expect(wrapper.vm.getStatusText('sending')).toBe('发送中');
      expect(wrapper.vm.getStatusText('failed')).toBe('失败');
      expect(wrapper.vm.getStatusText('delivered')).toBe('已送达');
    });

    it('应该正确缩短PeerId', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const shortPeerId = 'peer123';
      expect(wrapper.vm.shortenPeerId(shortPeerId)).toBe(shortPeerId);

      const longPeerId = '12345678901234567890abcdefghijklmnopqrstuvwxyz';
      const shortened = wrapper.vm.shortenPeerId(longPeerId);
      expect(shortened).toContain('...');
      expect(shortened.length).toBeLessThan(longPeerId.length);
    });

    it('应该正确截断消息内容', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const shortContent = '短消息';
      expect(wrapper.vm.truncateContent(shortContent)).toBe(shortContent);

      const longContent = '这是一条非常长的消息内容，超过了50个字符的限制，应该被截断并添加省略号';
      const truncated = wrapper.vm.truncateContent(longContent);
      expect(truncated).toContain('...');
      expect(truncated.length).toBeLessThan(longContent.length);
    });

    it('应该正确格式化时间', async () => {
      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const now = Date.now();

      // 刚刚
      expect(wrapper.vm.formatTime(now - 30 * 1000)).toBe('刚刚');

      // 分钟前
      expect(wrapper.vm.formatTime(now - 5 * 60 * 1000)).toBe('5分钟前');

      // 小时前
      expect(wrapper.vm.formatTime(now - 2 * 60 * 60 * 1000)).toBe('2小时前');

      // 天前（显示日期）
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
      const formatted = wrapper.vm.formatTime(twoDaysAgo);
      expect(formatted).toBeTruthy();
    });
  });

  describe('事件监听', () => {
    it('应该监听队列更新事件', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: [],
      });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      // 获取注册的事件处理器
      const queueUpdateHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'p2p:queue-updated'
      )?.[1];

      expect(queueUpdateHandler).toBeDefined();

      // 模拟队列更新事件
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: [{ id: 'new-msg', status: 'pending' }],
      });

      await queueUpdateHandler?.();
      await flushPromises();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('p2p:get-message-queue');
    });
  });

  describe('分页功能', () => {
    it('应该正确处理分页变化', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        messages: [],
      });

      const wrapper = mount(OfflineQueueManager, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const newPagination = {
        current: 2,
        pageSize: 20,
      };

      wrapper.vm.handleTableChange(newPagination);

      expect(wrapper.vm.pagination.current).toBe(2);
      expect(wrapper.vm.pagination.pageSize).toBe(20);
    });
  });
});
