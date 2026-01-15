/**
 * FriendsPage 组件单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import FriendsPage from '@renderer/pages/FriendsPage.vue';

// Mock Ant Design Vue components
const globalStubs = {
  'a-card': {
    template: '<div class="a-card"><slot name="title" /><slot /></div>',
    props: ['bordered'],
  },
  'a-tabs': {
    template: '<div class="a-tabs"><slot /></div>',
    props: ['activeKey'],
    emits: ['change', 'update:activeKey'],
  },
  'a-tab-pane': {
    template: '<div class="a-tab-pane"><slot name="tab" /><slot /></div>',
    props: ['key', 'tab'],
  },
  'a-list': {
    template: '<div class="a-list"><div v-for="item in dataSource" :key="item.id"><slot name="renderItem" :item="item" /></div></div>',
    props: ['dataSource', 'locale'],
  },
  'a-list-item': {
    template: '<div class="a-list-item" @click="$attrs.onClick"><slot /></div>',
  },
  'a-list-item-meta': {
    template: '<div class="a-list-item-meta"><slot name="avatar" /><slot name="title" /><slot name="description" /></div>',
  },
  'a-avatar': {
    template: '<div class="a-avatar"><slot /></div>',
    props: ['size', 'src'],
  },
  'a-badge': {
    template: '<div class="a-badge"><slot /></div>',
    props: ['count', 'dot', 'offset', 'numberStyle'],
  },
  'a-button': {
    template: '<button class="a-button" v-bind="$attrs" @click="$attrs.onClick"><slot name="icon" /><slot /></button>',
    props: ['type', 'danger'],
  },
  'a-input-search': {
    template: '<input class="a-input-search" v-bind="$attrs" @search="$attrs.onSearch" />',
    props: ['value', 'placeholder'],
    emits: ['update:value', 'search'],
  },
  'a-tooltip': {
    template: '<div class="a-tooltip"><slot /></div>',
    props: ['title'],
  },
  'a-dropdown': {
    template: '<div class="a-dropdown"><slot /><slot name="overlay" /></div>',
  },
  'a-menu': {
    template: '<div class="a-menu" @click="$attrs.onClick"><slot /></div>',
  },
  'a-menu-item': {
    template: '<div class="a-menu-item" :data-key="key"><slot /></div>',
    props: ['key', 'danger'],
  },
  'a-menu-divider': {
    template: '<div class="a-menu-divider"></div>',
  },
  'a-modal': {
    template: '<div v-if="open" class="a-modal"><slot /></div>',
    props: ['open', 'title'],
    emits: ['update:open', 'ok', 'cancel'],
  },
  'a-form': {
    template: '<form class="a-form"><slot /></form>',
    props: ['model', 'layout'],
  },
  'a-form-item': {
    template: '<div class="a-form-item"><slot /></div>',
    props: ['label', 'required'],
  },
  'a-input': {
    template: '<input class="a-input" v-bind="$attrs" />',
    props: ['value', 'placeholder'],
    emits: ['update:value'],
  },
  'a-textarea': {
    template: '<textarea class="a-textarea" v-bind="$attrs"></textarea>',
    props: ['value', 'placeholder', 'rows'],
    emits: ['update:value'],
  },
  'a-select': {
    template: '<select class="a-select" v-bind="$attrs"><slot /></select>',
    props: ['value', 'placeholder'],
    emits: ['update:value'],
  },
  'a-select-option': {
    template: '<option class="a-select-option" :value="value"><slot /></option>',
    props: ['value'],
  },
  'a-spin': {
    template: '<div class="a-spin" :class="{ spinning }"><slot /></div>',
    props: ['spinning'],
  },
  'OnlineStatusIndicator': {
    template: '<span class="online-status-indicator" :data-status="status"></span>',
    props: ['status', 'lastSeen', 'deviceCount', 'showDeviceCount', 'size'],
  },
  'TeamOutlined': { template: '<span>👥</span>' },
  'UserAddOutlined': { template: '<span>➕</span>' },
  'MessageOutlined': { template: '<span>💬</span>' },
  'PhoneOutlined': { template: '<span>📞</span>' },
  'VideoCameraOutlined': { template: '<span>📹</span>' },
  'EllipsisOutlined': { template: '<span>⋯</span>' },
  'EditOutlined': { template: '<span>✏️</span>' },
  'FolderOutlined': { template: '<span>📁</span>' },
  'DeleteOutlined': { template: '<span>🗑️</span>' },
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
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

describe('FriendsPage.vue', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('好友列表加载', () => {
    it('应该在挂载时加载好友列表', async () => {
      const mockFriends = [
        {
          id: 1,
          friend_did: 'did:example:123',
          nickname: '测试好友1',
          group_name: '我的好友',
          onlineStatus: { status: 'online', lastSeen: Date.now(), deviceCount: 1 },
        },
        {
          id: 2,
          friend_did: 'did:example:456',
          nickname: '测试好友2',
          group_name: '同事',
          onlineStatus: { status: 'offline', lastSeen: Date.now() - 3600000, deviceCount: 0 },
        },
      ];

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        friends: mockFriends,
      });

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('friend:get-list');
      expect(wrapper.vm.allFriends).toEqual(mockFriends);
    });

    it('加载失败时应该显示错误消息', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: false,
        error: '网络错误',
      });

      const { message } = await import('ant-design-vue');

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(message.error).toHaveBeenCalledWith('加载好友列表失败: 网络错误');
    });

    it('应该正确设置loading状态', async () => {
      mockIpcRenderer.invoke.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, friends: [] }), 100);
        });
      });

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.loading).toBe(true);

      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe('好友分组和过滤', () => {
    const mockFriends = [
      {
        id: 1,
        friend_did: 'did:example:123',
        nickname: '在线好友',
        group_name: '我的好友',
        onlineStatus: { status: 'online', lastSeen: Date.now(), deviceCount: 1 },
      },
      {
        id: 2,
        friend_did: 'did:example:456',
        nickname: '离线好友',
        group_name: '同事',
        onlineStatus: { status: 'offline', lastSeen: Date.now() - 3600000, deviceCount: 0 },
      },
      {
        id: 3,
        friend_did: 'did:example:789',
        nickname: '另一个在线好友',
        group_name: '我的好友',
        onlineStatus: { status: 'online', lastSeen: Date.now(), deviceCount: 2 },
      },
    ];

    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        friends: mockFriends,
      });
    });

    it('应该正确计算在线好友数量', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.onlineFriendsCount).toBe(2);
    });

    it('应该正确提取好友分组', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      expect(wrapper.vm.friendGroups).toEqual(['我的好友', '同事']);
    });

    it('应该按分组过滤好友', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.vm.activeGroup = '我的好友';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredFriends).toHaveLength(2);
      expect(wrapper.vm.filteredFriends.every((f: any) => f.group_name === '我的好友')).toBe(true);
    });

    it('应该只显示在线好友', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.vm.activeGroup = 'online';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredFriends).toHaveLength(2);
      expect(wrapper.vm.filteredFriends.every((f: any) => f.onlineStatus?.status === 'online')).toBe(true);
    });

    it('应该按关键词搜索好友', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.vm.searchKeyword = '在线';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredFriends).toHaveLength(2);
      expect(wrapper.vm.filteredFriends.every((f: any) => f.nickname.includes('在线'))).toBe(true);
    });
  });

  describe('好友操作', () => {
    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        friends: [],
      });
    });

    it('应该发送好友请求', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({ success: true });

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.vm.addFriendForm = {
        did: 'did:example:new-friend',
        message: '你好，我想加你为好友',
      };

      await wrapper.vm.handleAddFriend();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('friend:send-request', {
        targetDid: 'did:example:new-friend',
        message: '你好，我想加你为好友',
      });
    });

    it('DID为空时不应该发送好友请求', async () => {
      const { message } = await import('ant-design-vue');

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.vm.addFriendForm = { did: '', message: '' };
      await wrapper.vm.handleAddFriend();

      expect(message.warning).toHaveBeenCalledWith('请输入好友DID');
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('friend:send-request', expect.anything());
    });

    it('应该更新好友信息', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({ success: true });

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.vm.editForm = {
        friendDid: 'did:example:123',
        nickname: '新昵称',
        groupName: '家人',
        notes: '这是备注',
      };

      await wrapper.vm.handleSaveEdit();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('friend:update', {
        friendDid: 'did:example:123',
        nickname: '新昵称',
        groupName: '家人',
        notes: '这是备注',
      });
    });
  });

  describe('在线状态监听', () => {
    const mockFriends = [
      {
        id: 1,
        friend_did: 'did:example:123',
        nickname: '测试好友',
        onlineStatus: { status: 'offline', lastSeen: Date.now() - 3600000, deviceCount: 0 },
      },
    ];

    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        friends: mockFriends,
      });
    });

    it('应该监听好友上线事件', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      // 获取注册的事件处理器
      const onlineHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'friend:online'
      )?.[1];

      expect(onlineHandler).toBeDefined();

      // 模拟好友上线事件
      onlineHandler?.(null, { friendDid: 'did:example:123' });
      await wrapper.vm.$nextTick();

      const friend = wrapper.vm.allFriends.find((f: any) => f.friend_did === 'did:example:123');
      expect(friend?.onlineStatus?.status).toBe('online');
    });

    it('应该监听好友离线事件', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      // 先设置为在线
      wrapper.vm.allFriends[0].onlineStatus.status = 'online';

      // 获取注册的事件处理器
      const offlineHandler = mockIpcRenderer.on.mock.calls.find(
        (call) => call[0] === 'friend:offline'
      )?.[1];

      expect(offlineHandler).toBeDefined();

      // 模拟好友离线事件
      offlineHandler?.(null, { friendDid: 'did:example:123' });
      await wrapper.vm.$nextTick();

      const friend = wrapper.vm.allFriends.find((f: any) => f.friend_did === 'did:example:123');
      expect(friend?.onlineStatus?.status).toBe('offline');
    });

    it('应该在组件卸载时移除事件监听', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      wrapper.unmount();

      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith('friend:online', expect.any(Function));
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith('friend:offline', expect.any(Function));
    });
  });

  describe('工具函数', () => {
    beforeEach(() => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        friends: [],
      });
    });

    it('应该正确格式化DID', async () => {
      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const shortDid = 'did:example:123';
      expect(wrapper.vm.formatDID(shortDid)).toBe(shortDid);

      const longDid = 'did:example:1234567890abcdefghijklmnopqrstuvwxyz';
      const formatted = wrapper.vm.formatDID(longDid);
      expect(formatted).toContain('...');
      expect(formatted.length).toBeLessThan(longDid.length);
    });

    it('应该按分组获取好友', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        friends: [
          { id: 1, friend_did: 'did:1', group_name: '家人' },
          { id: 2, friend_did: 'did:2', group_name: '同事' },
          { id: 3, friend_did: 'did:3', group_name: '家人' },
        ],
      });

      const wrapper = mount(FriendsPage, {
        global: {
          plugins: [pinia],
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const familyFriends = wrapper.vm.getFriendsByGroup('家人');
      expect(familyFriends).toHaveLength(2);
      expect(familyFriends.every((f: any) => f.group_name === '家人')).toBe(true);
    });
  });
});
