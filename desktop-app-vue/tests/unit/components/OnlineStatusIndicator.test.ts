/**
 * OnlineStatusIndicator 组件单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import OnlineStatusIndicator from '@renderer/components/OnlineStatusIndicator.vue';

// Mock Ant Design Vue components
const globalStubs = {
  'a-tooltip': {
    template: '<div><slot /></div>',
    props: ['title', 'placement'],
  },
};

describe('OnlineStatusIndicator.vue', () => {
  describe('状态显示', () => {
    it('应该正确显示在线状态', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.online-status-indicator').exists()).toBe(true);
      expect(wrapper.find('.status-online').exists()).toBe(true);
      expect(wrapper.find('.status-dot').exists()).toBe(true);
    });

    it('应该正确显示离线状态', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.status-offline').exists()).toBe(true);
    });

    it('应该正确显示离开状态', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'away',
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.status-away').exists()).toBe(true);
    });

    it('应该默认显示离线状态', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.status-offline').exists()).toBe(true);
    });
  });

  describe('状态文本', () => {
    it('在线状态应该显示"在线"', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          showText: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toBe('在线');
    });

    it('在线状态有多设备时应该显示设备数量', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          deviceCount: 3,
          showText: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toBe('在线 (3 台设备)');
    });

    it('离开状态应该显示"离开"', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'away',
          showText: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toBe('离开');
    });

    it('离线状态应该显示"离线"', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          showText: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toBe('离线');
    });

    it('离线状态有lastSeen时应该显示最后在线时间', () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          lastSeen: fiveMinutesAgo,
          showText: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toContain('离线 - 5分钟前');
    });
  });

  describe('最后在线时间格式化', () => {
    it('应该显示"刚刚"（小于1分钟）', () => {
      const now = Date.now();
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          lastSeen: now - 30 * 1000, // 30秒前
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toContain('刚刚');
    });

    it('应该显示分钟数（小于1小时）', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          lastSeen: Date.now() - 15 * 60 * 1000, // 15分钟前
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toContain('15分钟前');
    });

    it('应该显示小时数（小于24小时）', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          lastSeen: Date.now() - 3 * 60 * 60 * 1000, // 3小时前
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toContain('3小时前');
    });

    it('应该显示天数（小于7天）', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          lastSeen: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2天前
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.vm.statusText).toContain('2天前');
    });

    it('应该显示日期（超过7天）', () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'offline',
          lastSeen: eightDaysAgo,
        },
        global: {
          stubs: globalStubs,
        },
      });

      const date = new Date(eightDaysAgo);
      const expectedDate = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      expect(wrapper.vm.statusText).toContain(expectedDate);
    });
  });

  describe('设备数量显示', () => {
    it('应该显示设备数量徽章', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          deviceCount: 2,
          showDeviceCount: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      const deviceCountEl = wrapper.find('.device-count');
      expect(deviceCountEl.exists()).toBe(true);
      expect(deviceCountEl.text()).toBe('2');
    });

    it('单设备时不应该显示设备数量徽章', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          deviceCount: 1,
          showDeviceCount: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.device-count').exists()).toBe(false);
    });

    it('showDeviceCount为false时不应该显示设备数量', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          deviceCount: 3,
          showDeviceCount: false,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.device-count').exists()).toBe(false);
    });
  });

  describe('文本显示控制', () => {
    it('showText为true时应该显示状态文本', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          showText: true,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.status-text').exists()).toBe(true);
      expect(wrapper.find('.status-text').text()).toBe('在线');
    });

    it('showText为false时不应该显示状态文本', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: {
          status: 'online',
          showText: false,
        },
        global: {
          stubs: globalStubs,
        },
      });

      expect(wrapper.find('.status-text').exists()).toBe(false);
    });
  });

  describe('Props验证', () => {
    it('应该接受有效的status值', () => {
      const validStatuses = ['online', 'offline', 'away'];
      validStatuses.forEach((status) => {
        const wrapper = mount(OnlineStatusIndicator, {
          props: { status },
          global: { stubs: globalStubs },
        });
        expect(wrapper.props('status')).toBe(status);
      });
    });

    it('应该接受有效的size值', () => {
      const validSizes = ['small', 'default', 'large'];
      validSizes.forEach((size) => {
        const wrapper = mount(OnlineStatusIndicator, {
          props: { size },
          global: { stubs: globalStubs },
        });
        expect(wrapper.props('size')).toBe(size);
      });
    });

    it('应该接受数字类型的lastSeen', () => {
      const timestamp = Date.now();
      const wrapper = mount(OnlineStatusIndicator, {
        props: { lastSeen: timestamp },
        global: { stubs: globalStubs },
      });
      expect(wrapper.props('lastSeen')).toBe(timestamp);
    });

    it('应该接受数字类型的deviceCount', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: { deviceCount: 5 },
        global: { stubs: globalStubs },
      });
      expect(wrapper.props('deviceCount')).toBe(5);
    });
  });

  describe('CSS类应用', () => {
    it('在线状态应该应用status-online类', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: { status: 'online' },
        global: { stubs: globalStubs },
      });
      expect(wrapper.find('.status-online').exists()).toBe(true);
    });

    it('离线状态应该应用status-offline类', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: { status: 'offline' },
        global: { stubs: globalStubs },
      });
      expect(wrapper.find('.status-offline').exists()).toBe(true);
    });

    it('离开状态应该应用status-away类', () => {
      const wrapper = mount(OnlineStatusIndicator, {
        props: { status: 'away' },
        global: { stubs: globalStubs },
      });
      expect(wrapper.find('.status-away').exists()).toBe(true);
    });
  });
});
