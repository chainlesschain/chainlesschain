/**
 * DeviceManagerHandler 单元测试
 */

import { vi } from 'vitest';
const {
  DeviceManagerHandler,
  DeviceStatus,
  PermissionLevel,
} = require("../../../src/main/remote/handlers/device-manager-handler");

describe("DeviceManagerHandler", () => {
  let handler;
  let mockDatabase;
  let mockP2PManager;
  let mockPermissionGate;

  beforeEach(() => {
    // Mock Database
    mockDatabase = {
      exec: vi.fn(),
      run: vi.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
    };

    // Mock P2P Manager
    mockP2PManager = {
      getConnectedPeers: vi.fn().mockReturnValue([]),
    };

    // Mock Permission Gate
    mockPermissionGate = {
      setDevicePermissionLevel: vi.fn().mockResolvedValue(true),
    };

    handler = new DeviceManagerHandler(
      mockDatabase,
      mockP2PManager,
      mockPermissionGate,
      { autoApprove: false }, // 禁用自动批准以便测试
    );

    // 停止自动监控以避免测试干扰
    if (handler.monitoringTimer) {
      handler.stopDeviceMonitoring();
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (handler.monitoringTimer) {
      handler.stopDeviceMonitoring();
    }
  });

  describe("initialization", () => {
    it("应该初始化数据库表", () => {
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS devices"),
      );

      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS device_groups"),
      );

      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining(
          "CREATE TABLE IF NOT EXISTS device_activity_logs",
        ),
      );
    });
  });

  describe("registerDevice", () => {
    it("应该成功注册新设备", async () => {
      const params = {
        deviceId: "dev-001",
        deviceDid: "did:example:device1",
        deviceName: "测试设备",
        deviceType: "Desktop",
        osType: "Windows",
        osVersion: "10",
        appVersion: "1.0.0",
        peerId: "peer-001",
      };

      const context = {};

      mockDatabase.get.mockResolvedValueOnce({ count: 0 }); // 设备数量检查
      mockDatabase.get.mockResolvedValueOnce(null); // 设备不存在
      mockDatabase.run.mockResolvedValue({ lastID: 1 });

      const result = await handler.registerDevice(params, context);

      expect(result.deviceId).toBe("dev-001");
      expect(result.deviceDid).toBe("did:example:device1");
      expect(result.status).toBe(DeviceStatus.PENDING);
      expect(result.requiresApproval).toBe(true);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO devices"),
        expect.any(Array),
      );
    });

    it("自动批准模式下应该直接批准设备", async () => {
      const handlerWithAutoApprove = new DeviceManagerHandler(
        mockDatabase,
        mockP2PManager,
        mockPermissionGate,
        { autoApprove: true, defaultPermission: PermissionLevel.OPERATOR },
      );

      handlerWithAutoApprove.stopDeviceMonitoring();

      const params = {
        deviceId: "dev-002",
        deviceDid: "did:example:device2",
        deviceName: "自动批准设备",
      };

      mockDatabase.get.mockResolvedValueOnce({ count: 0 });
      mockDatabase.get.mockResolvedValueOnce(null);

      const result = await handlerWithAutoApprove.registerDevice(params, {});

      expect(result.status).toBe(DeviceStatus.OFFLINE);
      expect(result.permissionLevel).toBe(PermissionLevel.OPERATOR);
      expect(result.requiresApproval).toBe(false);
    });

    it("设备已存在时应该更新设备信息", async () => {
      const params = {
        deviceId: "dev-003",
        deviceDid: "did:example:device3",
        deviceName: "已存在设备",
      };

      const existingDevice = {
        device_id: "dev-003",
        device_did: "did:example:device3",
        device_name: "旧名称",
        status: DeviceStatus.OFFLINE,
        permission_level: PermissionLevel.VIEWER,
      };

      mockDatabase.get.mockResolvedValueOnce({ count: 1 });
      mockDatabase.get.mockResolvedValueOnce(existingDevice);

      const result = await handler.registerDevice(params, {});

      expect(result.message).toContain("updated");
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE devices"),
        expect.any(Array),
      );
    });

    it("超过设备数量限制时应该抛出错误", async () => {
      const params = {
        deviceId: "dev-004",
        deviceDid: "did:example:device4",
      };

      mockDatabase.get.mockResolvedValueOnce({ count: 100 }); // 超过限制

      await expect(handler.registerDevice(params, {})).rejects.toThrow(
        "Maximum device limit",
      );
    });
  });

  describe("listDevices", () => {
    it("应该成功列出所有设备", async () => {
      const params = { limit: 50, offset: 0 };
      const context = {};

      const mockDevices = [
        {
          device_id: "dev-001",
          device_did: "did:example:1",
          device_name: "设备1",
          status: DeviceStatus.ONLINE,
          metadata: "{}",
          is_trusted: 1,
        },
      ];

      mockDatabase.all.mockResolvedValue(mockDevices);

      const result = await handler.listDevices(params, context);

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0].is_trusted).toBe(true);
      expect(result.devices[0].metadata).toEqual({});
    });

    it("应该支持按状态筛选", async () => {
      const params = { status: DeviceStatus.ONLINE, limit: 50, offset: 0 };
      const context = {};

      mockDatabase.all.mockResolvedValue([]);

      await handler.listDevices(params, context);

      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining("WHERE 1=1 AND status = ?"),
        expect.arrayContaining([DeviceStatus.ONLINE]),
      );
    });
  });

  describe("approveDevice", () => {
    it("应该成功批准设备", async () => {
      const params = {
        deviceDid: "did:example:device1",
        permissionLevel: PermissionLevel.OPERATOR,
      };

      const context = {};

      const result = await handler.approveDevice(params, context);

      expect(result.deviceDid).toBe("did:example:device1");
      expect(result.permissionLevel).toBe(PermissionLevel.OPERATOR);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE devices SET"),
        expect.arrayContaining([
          DeviceStatus.OFFLINE,
          PermissionLevel.OPERATOR,
          expect.any(Number),
          expect.any(Number),
          "did:example:device1",
        ]),
      );

      expect(mockPermissionGate.setDevicePermissionLevel).toHaveBeenCalledWith(
        "did:example:device1",
        PermissionLevel.OPERATOR,
      );
    });
  });

  describe("rejectDevice", () => {
    it("应该成功拒绝并删除设备", async () => {
      const params = { deviceDid: "did:example:device1" };
      const context = {};

      const result = await handler.rejectDevice(params, context);

      expect(result.message).toContain("rejected and removed");
      expect(mockDatabase.run).toHaveBeenCalledWith(
        "DELETE FROM devices WHERE device_did = ?",
        ["did:example:device1"],
      );
    });
  });

  describe("setDevicePermission", () => {
    it("应该成功设置设备权限", async () => {
      const params = {
        deviceDid: "did:example:device1",
        permissionLevel: PermissionLevel.ADMIN,
      };

      const context = {};

      const result = await handler.setDevicePermission(params, context);

      expect(result.permissionLevel).toBe(PermissionLevel.ADMIN);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE devices SET permission_level = ?"),
        [PermissionLevel.ADMIN, expect.any(Number), "did:example:device1"],
      );

      expect(mockPermissionGate.setDevicePermissionLevel).toHaveBeenCalled();
    });
  });

  describe("removeDevice", () => {
    it("应该成功删除设备", async () => {
      const params = { deviceDid: "did:example:device1" };
      const context = {};

      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handler.removeDevice(params, context);

      expect(result.message).toContain("removed successfully");
    });

    it("设备不存在时应该抛出错误", async () => {
      const params = { deviceDid: "did:example:nonexistent" };
      const context = {};

      mockDatabase.run.mockResolvedValue({ changes: 0 });

      await expect(handler.removeDevice(params, context)).rejects.toThrow(
        "Device not found",
      );
    });
  });

  describe("setTrusted", () => {
    it("应该成功设置信任状态", async () => {
      const params = {
        deviceDid: "did:example:device1",
        trusted: true,
      };

      const context = {};

      const result = await handler.setTrusted(params, context);

      expect(result.trusted).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE devices SET is_trusted = ?"),
        [1, expect.any(Number), "did:example:device1"],
      );
    });
  });

  describe("createGroup", () => {
    it("应该成功创建设备分组", async () => {
      const params = {
        groupName: "办公设备",
        description: "办公室使用的设备",
      };

      const context = {};

      const result = await handler.createGroup(params, context);

      expect(result.groupId).toBeDefined();
      expect(result.groupName).toBe("办公设备");

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO device_groups"),
        expect.any(Array),
      );
    });
  });

  describe("assignDeviceToGroup", () => {
    it("应该成功分配设备到分组", async () => {
      const params = {
        deviceDid: "did:example:device1",
        groupId: "group-001",
      };

      const context = {};

      const result = await handler.assignDeviceToGroup(params, context);

      expect(result.groupId).toBe("group-001");
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE devices SET group_id = ?"),
        ["group-001", expect.any(Number), "did:example:device1"],
      );
    });
  });

  describe("discoverDevices", () => {
    it("应该成功发现设备", async () => {
      const params = {};
      const context = {};

      mockP2PManager.getConnectedPeers.mockReturnValue([
        { peerId: "peer-001" },
        { peerId: "peer-002" },
      ]);

      mockDatabase.get
        .mockResolvedValueOnce({
          device_did: "did:example:1",
          device_name: "设备1",
          status: "online",
        })
        .mockResolvedValueOnce(null);

      const result = await handler.discoverDevices(params, context);

      expect(result.devices).toHaveLength(2);
      expect(result.devices[0].registered).toBe(true);
      expect(result.devices[1].registered).toBe(false);
    });
  });

  describe("getDeviceStatus", () => {
    it("应该成功获取设备状态", async () => {
      const params = { deviceDid: "did:example:device1" };
      const context = {};

      const mockDevice = {
        device_did: "did:example:device1",
        status: DeviceStatus.ONLINE,
        last_seen_at: Date.now(),
      };

      mockDatabase.get.mockResolvedValue(mockDevice);

      const result = await handler.getDeviceStatus(params, context);

      expect(result.deviceDid).toBe("did:example:device1");
      expect(result.status).toBe(DeviceStatus.ONLINE);
      expect(result.isOnline).toBe(true);
    });

    it("设备不存在时应该抛出错误", async () => {
      const params = { deviceDid: "did:example:nonexistent" };
      const context = {};

      mockDatabase.get.mockResolvedValue(null);

      await expect(handler.getDeviceStatus(params, context)).rejects.toThrow(
        "Device not found",
      );
    });
  });

  describe("getActivityLogs", () => {
    it("应该成功获取活动日志", async () => {
      const params = { deviceDid: "did:example:device1", limit: 50 };
      const context = {};

      const mockLogs = [
        {
          id: 1,
          device_did: "did:example:device1",
          activity_type: "device_registered",
          details: "{}",
          timestamp: Date.now(),
        },
      ];

      mockDatabase.all.mockResolvedValue(mockLogs);

      const result = await handler.getActivityLogs(params, context);

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].details).toEqual({});
    });
  });

  describe("updateDeviceStatuses", () => {
    it("应该更新超时设备状态", async () => {
      await handler.updateDeviceStatuses();

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE devices SET status = ?"),
        expect.arrayContaining([
          DeviceStatus.OFFLINE,
          expect.any(Number),
          DeviceStatus.ONLINE,
          expect.any(Number),
        ]),
      );
    });
  });

  describe("handle", () => {
    it("应该正确路由到 registerDevice", async () => {
      const params = {
        deviceId: "dev-001",
        deviceDid: "did:example:device1",
        deviceName: "测试",
      };

      mockDatabase.get.mockResolvedValueOnce({ count: 0 });
      mockDatabase.get.mockResolvedValueOnce(null);

      const result = await handler.handle("register", params, {});

      expect(result.deviceId).toBe("dev-001");
    });

    it("未知动作应该抛出错误", async () => {
      await expect(handler.handle("unknownAction", {}, {})).rejects.toThrow(
        "Unknown action: unknownAction",
      );
    });
  });
});
