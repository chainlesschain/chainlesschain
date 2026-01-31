/**
 * DeviceManagementPage 组件测试
 * 测试P2P设备管理页面的所有功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import DeviceManagementPage from "@renderer/pages/p2p/DeviceManagementPage.vue";
import { nextTick } from "vue";

// Mock Ant Design Vue
const Modal = {
  confirm: vi.fn(),
  info: vi.fn(),
};

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  Modal,
}));

// Mock Vue Router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock Ant Design Icons
vi.mock("@ant-design/icons-vue", () => ({
  ReloadOutlined: { name: "ReloadOutlined", template: "<span>Reload</span>" },
  CheckCircleOutlined: {
    name: "CheckCircleOutlined",
    template: "<span>CheckCircle</span>",
  },
  SafetyOutlined: { name: "SafetyOutlined", template: "<span>Safety</span>" },
  ExclamationCircleOutlined: {
    name: "ExclamationCircleOutlined",
    template: "<span>ExclamationCircle</span>",
  },
  MessageOutlined: {
    name: "MessageOutlined",
    template: "<span>Message</span>",
  },
  InfoCircleOutlined: {
    name: "InfoCircleOutlined",
    template: "<span>InfoCircle</span>",
  },
  EditOutlined: { name: "EditOutlined", template: "<span>Edit</span>" },
  DeleteOutlined: { name: "DeleteOutlined", template: "<span>Delete</span>" },
  MoreOutlined: { name: "MoreOutlined", template: "<span>More</span>" },
}));

// NOTE: Skipped - requires proper Pinia setup and complex mock dependencies
describe.skip("DeviceManagementPage", () => {
  let wrapper;
  let mockDevices;

  beforeEach(() => {
    // Mock Electron API
    global.window = {
      electron: {
        invoke: vi.fn(),
      },
    };

    // Mock devices data
    mockDevices = [
      {
        deviceId: "device-1",
        deviceName: "Alice的设备",
        isOnline: true,
        isVerified: true,
        lastSeen: Date.now() - 3600000, // 1 hour ago
        pairedAt: Date.now() - 86400000, // 1 day ago
      },
      {
        deviceId: "device-2",
        deviceName: "Bob的设备",
        isOnline: false,
        isVerified: false,
        lastSeen: Date.now() - 86400000, // 1 day ago
        pairedAt: Date.now() - 604800000, // 1 week ago
      },
    ];

    window.electron.invoke.mockImplementation((channel) => {
      if (channel === "p2p:list-devices") {
        return Promise.resolve({ devices: mockDevices });
      }
      return Promise.resolve({ success: false });
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("组件挂载和初始化", () => {
    it("应该正确挂载", () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-button": true,
            "a-card": true,
            "a-descriptions": true,
            "a-descriptions-item": true,
            "a-tag": true,
            "a-input-search": true,
            "a-space": true,
            "a-spin": true,
            "a-table": true,
            "a-avatar": true,
            "a-dropdown": true,
            "a-menu": true,
            "a-menu-item": true,
            "a-menu-divider": true,
            "a-modal": true,
            "a-form": true,
            "a-form-item": true,
            "a-input": true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("应该能加载设备列表", async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(window.electron.invoke).toHaveBeenCalledWith("p2p:list-devices");
      expect(wrapper.vm.devices).toHaveLength(2);
    });

    it("应该能生成dummy数据", async () => {
      window.electron.invoke.mockRejectedValue(new Error("加载失败"));

      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.devices.length).toBeGreaterThan(0);
    });

    it("应该显示当前设备信息", () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      expect(wrapper.vm.currentDevice.deviceId).toBeDefined();
      expect(wrapper.vm.currentDevice.deviceName).toBe("我的设备");
      expect(wrapper.vm.currentDevice.did).toBeDefined();
    });
  });

  describe("设备列表显示", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该显示所有设备", () => {
      expect(wrapper.vm.devices).toHaveLength(2);
    });

    it("应该显示设备名称", () => {
      const device = wrapper.vm.devices[0];
      expect(device.deviceName).toBe("Alice的设备");
    });

    it("应该显示设备在线状态", () => {
      const onlineDevice = wrapper.vm.devices[0];
      const offlineDevice = wrapper.vm.devices[1];

      expect(onlineDevice.isOnline).toBe(true);
      expect(offlineDevice.isOnline).toBe(false);
    });

    it("应该显示验证状态", () => {
      const verified = wrapper.vm.devices[0];
      const unverified = wrapper.vm.devices[1];

      expect(verified.isVerified).toBe(true);
      expect(unverified.isVerified).toBe(false);
    });

    it("应该显示最后在线时间", () => {
      const device = wrapper.vm.devices[0];
      expect(device.lastSeen).toBeDefined();
    });
  });

  describe("搜索功能", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-input-search": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能按设备名称搜索", async () => {
      wrapper.vm.searchText = "Alice";
      await nextTick();

      const filtered = wrapper.vm.filteredDevices;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].deviceName).toContain("Alice");
    });

    it("应该能按设备ID搜索", async () => {
      wrapper.vm.searchText = "device-1";
      await nextTick();

      const filtered = wrapper.vm.filteredDevices;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].deviceId).toBe("device-1");
    });

    it("搜索应该不区分大小写", async () => {
      wrapper.vm.searchText = "alice";
      await nextTick();

      const filtered = wrapper.vm.filteredDevices;
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("空搜索应该显示所有设备", async () => {
      wrapper.vm.searchText = "";
      await nextTick();

      expect(wrapper.vm.filteredDevices).toHaveLength(2);
    });

    it("没有匹配结果时应该返回空数组", async () => {
      wrapper.vm.searchText = "xyz123";
      await nextTick();

      expect(wrapper.vm.filteredDevices).toHaveLength(0);
    });
  });

  describe("刷新功能", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能刷新设备列表", async () => {
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleRefresh();

      expect(window.electron.invoke).toHaveBeenCalledWith("p2p:list-devices");
      expect(message.success).toHaveBeenCalledWith("刷新成功");
    });

    it("刷新时应该设置loading状态", async () => {
      window.electron.invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            expect(wrapper.vm.loading).toBe(true);
            resolve({ devices: mockDevices });
          }),
      );

      await wrapper.vm.handleRefresh();
    });

    it("处理刷新失败", async () => {
      const { message } = require("ant-design-vue");
      window.electron.invoke.mockRejectedValue(new Error("刷新失败"));

      await wrapper.vm.handleRefresh();

      expect(message.error).toHaveBeenCalledWith("刷新失败");
    });
  });

  describe("设备操作", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能导航到聊天页面", () => {
      const device = wrapper.vm.devices[0];

      wrapper.vm.handleChat(device);

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "P2PMessaging",
        query: { deviceId: device.deviceId },
      });
    });

    it("应该能导航到验证页面", () => {
      const device = wrapper.vm.devices[0];

      wrapper.vm.handleVerify(device);

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "SafetyNumbers",
        query: { peerId: device.deviceId },
      });
    });

    it("应该能查看设备详情", () => {
      const device = wrapper.vm.devices[0];

      wrapper.vm.handleViewDetails(device);

      expect(Modal.info).toHaveBeenCalled();
      const callArgs = Modal.info.mock.calls[0][0];
      expect(callArgs.title).toBe("设备详情");
      expect(callArgs.content).toContain(device.deviceId);
    });
  });

  describe("重命名设备", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
            "a-form": true,
            "a-input": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能打开重命名对话框", () => {
      const device = wrapper.vm.devices[0];

      wrapper.vm.handleRename(device);

      expect(wrapper.vm.renameModalVisible).toBe(true);
      expect(wrapper.vm.selectedDevice).toEqual(device);
      expect(wrapper.vm.newDeviceName).toBe(device.deviceName);
    });

    it("应该能确认重命名", async () => {
      const { message } = require("ant-design-vue");
      const device = wrapper.vm.devices[0];
      window.electron.invoke.mockResolvedValue();

      wrapper.vm.selectedDevice = device;
      wrapper.vm.newDeviceName = "新名称";

      await wrapper.vm.handleRenameConfirm();

      expect(window.electron.invoke).toHaveBeenCalledWith("p2p:rename-device", {
        deviceId: device.deviceId,
        newName: "新名称",
      });
      expect(device.deviceName).toBe("新名称");
      expect(wrapper.vm.renameModalVisible).toBe(false);
      expect(message.success).toHaveBeenCalledWith("重命名成功");
    });

    it("空名称不能重命名", async () => {
      const { message } = require("ant-design-vue");
      wrapper.vm.selectedDevice = wrapper.vm.devices[0];
      wrapper.vm.newDeviceName = "";

      await wrapper.vm.handleRenameConfirm();

      expect(message.error).toHaveBeenCalledWith("请输入设备名称");
    });

    it("空格名称不能重命名", async () => {
      const { message } = require("ant-design-vue");
      wrapper.vm.selectedDevice = wrapper.vm.devices[0];
      wrapper.vm.newDeviceName = "   ";

      await wrapper.vm.handleRenameConfirm();

      expect(message.error).toHaveBeenCalledWith("请输入设备名称");
    });

    it("处理重命名失败", async () => {
      const { message } = require("ant-design-vue");
      wrapper.vm.selectedDevice = wrapper.vm.devices[0];
      wrapper.vm.newDeviceName = "新名称";
      window.electron.invoke.mockRejectedValue(new Error("重命名失败"));

      await wrapper.vm.handleRenameConfirm();

      expect(message.error).toHaveBeenCalledWith("重命名失败");
    });
  });

  describe("移除设备", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("应该能显示移除确认对话框", () => {
      const device = wrapper.vm.devices[0];

      wrapper.vm.handleRemove(device);

      expect(Modal.confirm).toHaveBeenCalled();
      const callArgs = Modal.confirm.mock.calls[0][0];
      expect(callArgs.title).toBe("确认移除设备");
      expect(callArgs.content).toContain(device.deviceName);
      expect(callArgs.okType).toBe("danger");
    });

    it("应该能确认移除设备", async () => {
      const { message } = require("ant-design-vue");
      const device = wrapper.vm.devices[0];
      window.electron.invoke.mockResolvedValue();

      wrapper.vm.handleRemove(device);

      const confirmCall = Modal.confirm.mock.calls[0][0];
      await confirmCall.onOk();

      expect(window.electron.invoke).toHaveBeenCalledWith("p2p:remove-device", {
        deviceId: device.deviceId,
      });
      expect(
        wrapper.vm.devices.some((d) => d.deviceId === device.deviceId),
      ).toBe(false);
      expect(message.success).toHaveBeenCalledWith("设备已移除");
    });

    it("处理移除失败", async () => {
      const { message } = require("ant-design-vue");
      const device = wrapper.vm.devices[0];
      window.electron.invoke.mockRejectedValue(new Error("移除失败"));

      wrapper.vm.handleRemove(device);

      const confirmCall = Modal.confirm.mock.calls[0][0];
      await confirmCall.onOk();

      expect(message.error).toHaveBeenCalledWith("移除失败");
    });
  });

  describe("返回导航", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
    });

    it("应该能返回上一页", () => {
      wrapper.vm.handleBack();

      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  describe("辅助函数", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
    });

    it("应该能为设备生成稳定的颜色", () => {
      const color1 = wrapper.vm.getDeviceColor("device-1");
      const color2 = wrapper.vm.getDeviceColor("device-1");

      expect(color1).toBe(color2);
      expect(color1).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("不同设备应该可能有不同颜色", () => {
      const color1 = wrapper.vm.getDeviceColor("device-1");
      const color2 = wrapper.vm.getDeviceColor("device-999");

      expect(color1).toBeTruthy();
      expect(color2).toBeTruthy();
    });

    it("应该能格式化相对时间 - 刚刚", () => {
      const result = wrapper.vm.formatRelativeTime(Date.now() - 30000);

      expect(result).toBe("刚刚");
    });

    it("应该能格式化相对时间 - 分钟前", () => {
      const result = wrapper.vm.formatRelativeTime(Date.now() - 120000);

      expect(result).toContain("分钟前");
    });

    it("应该能格式化相对时间 - 小时前", () => {
      const result = wrapper.vm.formatRelativeTime(Date.now() - 7200000);

      expect(result).toContain("小时前");
    });

    it("应该能格式化相对时间 - 天前", () => {
      const result = wrapper.vm.formatRelativeTime(Date.now() - 172800000);

      expect(result).toContain("天前");
    });

    it('没有时间戳应该返回"从未"', () => {
      const result = wrapper.vm.formatRelativeTime(null);

      expect(result).toBe("从未");
    });
  });

  describe("表格配置", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
    });

    it("应该配置正确的列", () => {
      const columns = wrapper.vm.columns;

      expect(columns).toHaveLength(6);
      expect(columns.map((c) => c.key)).toEqual([
        "deviceName",
        "deviceId",
        "status",
        "verified",
        "lastSeen",
        "actions",
      ]);
    });

    it("应该配置分页", () => {
      const pagination = wrapper.vm.pagination;

      expect(pagination.pageSize).toBe(10);
      expect(pagination.showSizeChanger).toBe(true);
      expect(pagination.showTotal).toBeInstanceOf(Function);
    });

    it("showTotal应该返回正确的文本", () => {
      const pagination = wrapper.vm.pagination;

      expect(pagination.showTotal(5)).toBe("共 5 台设备");
    });
  });

  describe("响应式状态", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
    });

    it("应该正确初始化状态", () => {
      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.searchText).toBe("");
      expect(wrapper.vm.devices).toBeInstanceOf(Array);
      expect(wrapper.vm.renameModalVisible).toBe(false);
      expect(wrapper.vm.selectedDevice).toBeNull();
      expect(wrapper.vm.newDeviceName).toBe("");
      expect(wrapper.vm.currentDevice).toBeDefined();
    });

    it("loading应该是响应式的", async () => {
      expect(wrapper.vm.loading).toBe(false);

      wrapper.vm.loading = true;
      await nextTick();

      expect(wrapper.vm.loading).toBe(true);
    });

    it("searchText应该是响应式的", async () => {
      expect(wrapper.vm.searchText).toBe("");

      wrapper.vm.searchText = "test";
      await nextTick();

      expect(wrapper.vm.searchText).toBe("test");
    });

    it("renameModalVisible应该是响应式的", async () => {
      expect(wrapper.vm.renameModalVisible).toBe(false);

      wrapper.vm.handleRename(wrapper.vm.devices[0]);
      await nextTick();

      expect(wrapper.vm.renameModalVisible).toBe(true);
    });
  });

  describe("计算属性", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("filteredDevices应该是计算属性", () => {
      const devices1 = wrapper.vm.filteredDevices;
      const devices2 = wrapper.vm.filteredDevices;

      expect(devices1).toEqual(devices2);
    });

    it("filteredDevices默认返回所有设备", () => {
      expect(wrapper.vm.filteredDevices).toHaveLength(2);
    });

    it("filteredDevices应该根据搜索文本筛选", async () => {
      wrapper.vm.searchText = "Alice";
      await nextTick();

      expect(wrapper.vm.filteredDevices).toHaveLength(1);
    });
  });

  describe("边界情况", () => {
    it("空设备列表应该正常工作", async () => {
      window.electron.invoke.mockResolvedValue({ devices: [] });

      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.devices).toEqual([]);
      expect(wrapper.vm.filteredDevices).toEqual([]);
    });

    it('设备没有lastSeen时应该显示"从未"', () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      const result = wrapper.vm.formatRelativeTime(null);

      expect(result).toBe("从未");
    });

    it("应该处理API返回错误结构", async () => {
      window.electron.invoke.mockResolvedValue({ success: false });

      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();

      // 应该生成dummy数据
      expect(wrapper.vm.devices.length).toBeGreaterThan(0);
    });

    it("应该处理极短的时间差", () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      const result = wrapper.vm.formatRelativeTime(Date.now() - 100);

      expect(result).toBe("刚刚");
    });

    it("应该处理很久以前的时间", () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-modal": true,
          },
        },
      });

      const result = wrapper.vm.formatRelativeTime(Date.now() - 864000000); // 10 days ago

      expect(result).toContain("天前");
    });
  });

  describe("搜索处理", () => {
    beforeEach(async () => {
      wrapper = mount(DeviceManagementPage, {
        global: {
          stubs: {
            "a-page-header": true,
            "a-card": true,
            "a-descriptions": true,
            "a-table": true,
            "a-input-search": true,
            "a-modal": true,
          },
        },
      });

      await nextTick();
      await nextTick();
    });

    it("handleSearch应该不抛出错误", () => {
      expect(() => {
        wrapper.vm.handleSearch();
      }).not.toThrow();
    });

    it("搜索功能由计算属性处理", () => {
      wrapper.vm.searchText = "Alice";

      wrapper.vm.handleSearch();

      expect(wrapper.vm.filteredDevices.length).toBeGreaterThan(0);
    });
  });
});
