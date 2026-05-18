/**
 * 设备管理处理器
 *
 * 功能：
 * - 设备注册与授权
 * - 设备发现与连接
 * - 设备权限管理
 * - 设备状态监控
 * - 设备分组管理
 *
 * @module remote/handlers/device-manager-handler
 */

const { logger } = require("../../utils/logger");
const EventEmitter = require("events");

/**
 * 设备状态
 */
const DeviceStatus = {
  ONLINE: "online",
  OFFLINE: "offline",
  CONNECTING: "connecting",
  DISCONNECTED: "disconnected",
  PENDING: "pending", // 等待授权
};

/**
 * 权限级别
 */
const PermissionLevel = {
  NONE: 0, // 无权限
  VIEWER: 1, // 查看权限
  OPERATOR: 2, // 操作权限
  ADMIN: 3, // 管理员权限
  OWNER: 4, // 所有者权限
};

/**
 * 设备管理处理器类
 */
class DeviceManagerHandler extends EventEmitter {
  constructor(database, p2pManager, permissionGate, options = {}) {
    super();

    this.database = database;
    this.p2pManager = p2pManager;
    this.permissionGate = permissionGate;

    this.options = {
      autoApprove: options.autoApprove || false,
      defaultPermission: options.defaultPermission || PermissionLevel.VIEWER,
      maxDevices: options.maxDevices || 50,
      deviceTimeout: options.deviceTimeout || 5 * 60 * 1000, // 5分钟
      ...options,
    };

    // 设备状态缓存
    this.deviceCache = new Map();

    // 初始化数据库表
    this.initializeDatabase();

    logger.info("[DeviceManagerHandler] 设备管理处理器已初始化");

    // 启动设备状态监控
    this.startDeviceMonitoring();
  }

  /**
   * 初始化数据库表
   */
  initializeDatabase() {
    try {
      // 创建设备表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT UNIQUE NOT NULL,
          device_did TEXT UNIQUE NOT NULL,
          device_name TEXT,
          device_type TEXT,
          os_type TEXT,
          os_version TEXT,
          app_version TEXT,
          peer_id TEXT,
          permission_level INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending',
          is_trusted INTEGER DEFAULT 0,
          group_id TEXT,
          metadata TEXT,
          last_seen_at INTEGER,
          registered_at INTEGER NOT NULL,
          approved_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // 创建设备分组表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS device_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id TEXT UNIQUE NOT NULL,
          group_name TEXT NOT NULL,
          description TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      // 创建设备活动日志表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS device_activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_did TEXT NOT NULL,
          activity_type TEXT NOT NULL,
          details TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      // 创建索引
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_devices_did ON devices(device_did);
        CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
        CREATE INDEX IF NOT EXISTS idx_devices_peer_id ON devices(peer_id);
        CREATE INDEX IF NOT EXISTS idx_device_activity_logs_did ON device_activity_logs(device_did);
      `);

      logger.info("[DeviceManagerHandler] 数据库表已初始化");
    } catch (error) {
      logger.error("[DeviceManagerHandler] 初始化数据库表失败:", error);
    }
  }

  /**
   * 处理命令
   */
  async handle(action, params, context) {
    logger.debug("[DeviceManagerHandler] 处理命令: " + action);

    switch (action) {
      case "register":
        return await this.registerDevice(params, context);

      case "list":
        return await this.listDevices(params, context);

      case "getById":
        return await this.getDeviceById(params, context);

      case "updateDevice":
        return await this.updateDevice(params, context);

      case "removeDevice":
        return await this.removeDevice(params, context);

      case "setPermission":
        return await this.setDevicePermission(params, context);

      case "approve":
        return await this.approveDevice(params, context);

      case "reject":
        return await this.rejectDevice(params, context);

      case "setTrusted":
        return await this.setTrusted(params, context);

      case "getStatus":
        return await this.getDeviceStatus(params, context);

      case "createGroup":
        return await this.createGroup(params, context);

      case "assignGroup":
        return await this.assignDeviceToGroup(params, context);

      case "getActivityLogs":
        return await this.getActivityLogs(params, context);

      case "discover":
        return await this.discoverDevices(params, context);

      case "connect":
        return await this.connectToDevice(params, context);

      case "disconnect":
        return await this.disconnectDevice(params, context);

      default:
        throw new Error("Unknown action: " + action);
    }
  }

  /**
   * 注册设备
   */
  async registerDevice(params, context) {
    const {
      deviceId,
      deviceDid,
      deviceName,
      deviceType,
      osType,
      osVersion,
      appVersion,
      peerId,
      metadata = {},
    } = params;

    if (!deviceId || !deviceDid) {
      throw new Error("Device ID and DID are required");
    }

    logger.info(
      `[DeviceManagerHandler] 注册设备: ${deviceName} (${deviceDid})`,
    );

    // 检查设备数量限制
    const countRow = await this.database.get(
      "SELECT COUNT(*) as count FROM devices",
    );
    if (countRow.count >= this.options.maxDevices) {
      throw new Error(
        `Maximum device limit (${this.options.maxDevices}) reached`,
      );
    }

    // 检查设备是否已存在
    const existing = await this.database.get(
      "SELECT * FROM devices WHERE device_did = ?",
      [deviceDid],
    );

    const now = Date.now();

    if (existing) {
      // 更新已存在的设备
      await this.database.run(
        `UPDATE devices SET
          device_name = ?,
          peer_id = ?,
          os_version = ?,
          app_version = ?,
          metadata = ?,
          last_seen_at = ?,
          updated_at = ?
        WHERE device_did = ?`,
        [
          deviceName || existing.device_name,
          peerId || existing.peer_id,
          osVersion || existing.os_version,
          appVersion || existing.app_version,
          JSON.stringify(metadata),
          now,
          now,
          deviceDid,
        ],
      );

      await this.logActivity(deviceDid, "device_updated", { deviceName });

      return {
        deviceId: existing.device_id,
        deviceDid,
        status: existing.status,
        permissionLevel: existing.permission_level,
        message: "Device updated successfully",
      };
    } else {
      // 插入新设备
      const status = this.options.autoApprove
        ? DeviceStatus.OFFLINE
        : DeviceStatus.PENDING;
      const permissionLevel = this.options.autoApprove
        ? this.options.defaultPermission
        : PermissionLevel.NONE;

      const result = await this.database.run(
        `INSERT INTO devices (
          device_id, device_did, device_name, device_type,
          os_type, os_version, app_version, peer_id,
          permission_level, status, metadata,
          last_seen_at, registered_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          deviceId,
          deviceDid,
          deviceName,
          deviceType,
          osType,
          osVersion,
          appVersion,
          peerId,
          permissionLevel,
          status,
          JSON.stringify(metadata),
          now,
          now,
          now,
          now,
        ],
      );

      await this.logActivity(deviceDid, "device_registered", { deviceName });

      // 如果需要手动批准，触发事件
      if (!this.options.autoApprove) {
        this.emit("device:pending", { deviceDid, deviceName });
      }

      return {
        deviceId,
        deviceDid,
        status,
        permissionLevel,
        requiresApproval: !this.options.autoApprove,
        message: this.options.autoApprove
          ? "Device registered and approved"
          : "Device registered, waiting for approval",
      };
    }
  }

  /**
   * 列出设备
   */
  async listDevices(params, context) {
    const { status = null, groupId = null, limit = 50, offset = 0 } = params;

    let query = "SELECT * FROM devices WHERE 1=1";
    const args = [];

    if (status) {
      query += " AND status = ?";
      args.push(status);
    }

    if (groupId) {
      query += " AND group_id = ?";
      args.push(groupId);
    }

    query += " ORDER BY last_seen_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);

    const rows = await this.database.all(query, args);

    const devices = rows.map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      is_trusted: Boolean(row.is_trusted),
    }));

    return {
      devices,
      total: devices.length,
      limit,
      offset,
    };
  }

  /**
   * 根据 ID 获取设备
   */
  async getDeviceById(params, context) {
    const { deviceDid } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    const row = await this.database.get(
      "SELECT * FROM devices WHERE device_did = ?",
      [deviceDid],
    );

    if (!row) {
      throw new Error("Device not found");
    }

    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      is_trusted: Boolean(row.is_trusted),
    };
  }

  /**
   * 更新设备信息
   */
  async updateDevice(params, context) {
    const { deviceDid, deviceName, groupId, metadata } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    const updates = [];
    const args = [];

    if (deviceName) {
      updates.push("device_name = ?");
      args.push(deviceName);
    }

    if (groupId !== undefined) {
      updates.push("group_id = ?");
      args.push(groupId);
    }

    if (metadata) {
      updates.push("metadata = ?");
      args.push(JSON.stringify(metadata));
    }

    updates.push("updated_at = ?");
    args.push(Date.now());

    args.push(deviceDid);

    await this.database.run(
      `UPDATE devices SET ${updates.join(", ")} WHERE device_did = ?`,
      args,
    );

    await this.logActivity(deviceDid, "device_updated", {
      deviceName,
      groupId,
    });

    return {
      deviceDid,
      message: "Device updated successfully",
    };
  }

  /**
   * 移除设备
   */
  async removeDevice(params, context) {
    const { deviceDid } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    logger.info(`[DeviceManagerHandler] 移除设备: ${deviceDid}`);

    const result = await this.database.run(
      "DELETE FROM devices WHERE device_did = ?",
      [deviceDid],
    );

    if (result.changes === 0) {
      throw new Error("Device not found");
    }

    await this.logActivity(deviceDid, "device_removed", {});

    // 从缓存中移除
    this.deviceCache.delete(deviceDid);

    return {
      deviceDid,
      message: "Device removed successfully",
    };
  }

  /**
   * 设置设备权限
   */
  async setDevicePermission(params, context) {
    const { deviceDid, permissionLevel } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }
    if (permissionLevel === undefined) {
      throw new Error("Permission level is required");
    }

    logger.info(
      `[DeviceManagerHandler] 设置设备权限: ${deviceDid} -> ${permissionLevel}`,
    );

    await this.database.run(
      "UPDATE devices SET permission_level = ?, updated_at = ? WHERE device_did = ?",
      [permissionLevel, Date.now(), deviceDid],
    );

    // 同步到 PermissionGate
    if (this.permissionGate) {
      await this.permissionGate.setDevicePermissionLevel(
        deviceDid,
        permissionLevel,
      );
    }

    await this.logActivity(deviceDid, "permission_changed", {
      permissionLevel,
    });

    return {
      deviceDid,
      permissionLevel,
      message: "Permission updated successfully",
    };
  }

  /**
   * 批准设备
   */
  async approveDevice(params, context) {
    const { deviceDid, permissionLevel } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    const level = permissionLevel || this.options.defaultPermission;

    logger.info(`[DeviceManagerHandler] 批准设备: ${deviceDid}`);

    await this.database.run(
      `UPDATE devices SET
        status = ?,
        permission_level = ?,
        approved_at = ?,
        updated_at = ?
      WHERE device_did = ?`,
      [DeviceStatus.OFFLINE, level, Date.now(), Date.now(), deviceDid],
    );

    // 同步到 PermissionGate
    if (this.permissionGate) {
      await this.permissionGate.setDevicePermissionLevel(deviceDid, level);
    }

    await this.logActivity(deviceDid, "device_approved", {
      permissionLevel: level,
    });

    this.emit("device:approved", { deviceDid, permissionLevel: level });

    return {
      deviceDid,
      permissionLevel: level,
      message: "Device approved successfully",
    };
  }

  /**
   * 拒绝设备
   */
  async rejectDevice(params, context) {
    const { deviceDid } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    logger.info(`[DeviceManagerHandler] 拒绝设备: ${deviceDid}`);

    await this.database.run("DELETE FROM devices WHERE device_did = ?", [
      deviceDid,
    ]);

    await this.logActivity(deviceDid, "device_rejected", {});

    this.emit("device:rejected", { deviceDid });

    return {
      deviceDid,
      message: "Device rejected and removed",
    };
  }

  /**
   * 设置信任状态
   */
  async setTrusted(params, context) {
    const { deviceDid, trusted } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    await this.database.run(
      "UPDATE devices SET is_trusted = ?, updated_at = ? WHERE device_did = ?",
      [trusted ? 1 : 0, Date.now(), deviceDid],
    );

    await this.logActivity(deviceDid, "trust_changed", { trusted });

    return {
      deviceDid,
      trusted,
      message: "Trust status updated successfully",
    };
  }

  /**
   * 获取设备状态
   */
  async getDeviceStatus(params, context) {
    const { deviceDid } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    // 从缓存获取
    if (this.deviceCache.has(deviceDid)) {
      return this.deviceCache.get(deviceDid);
    }

    // 从数据库获取
    const device = await this.database.get(
      "SELECT device_did, status, last_seen_at FROM devices WHERE device_did = ?",
      [deviceDid],
    );

    if (!device) {
      throw new Error("Device not found");
    }

    const status = {
      deviceDid: device.device_did,
      status: device.status,
      lastSeenAt: device.last_seen_at,
      isOnline: device.status === DeviceStatus.ONLINE,
    };

    this.deviceCache.set(deviceDid, status);

    return status;
  }

  /**
   * 创建设备分组
   */
  async createGroup(params, context) {
    const { groupName, description = "" } = params;
    if (!groupName) {
      throw new Error("Group name is required");
    }

    const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    await this.database.run(
      "INSERT INTO device_groups (group_id, group_name, description, created_at) VALUES (?, ?, ?, ?)",
      [groupId, groupName, description, Date.now()],
    );

    return {
      groupId,
      groupName,
      message: "Group created successfully",
    };
  }

  /**
   * 分配设备到分组
   */
  async assignDeviceToGroup(params, context) {
    const { deviceDid, groupId } = params;
    if (!deviceDid || !groupId) {
      throw new Error("Device DID and Group ID are required");
    }

    await this.database.run(
      "UPDATE devices SET group_id = ?, updated_at = ? WHERE device_did = ?",
      [groupId, Date.now(), deviceDid],
    );

    await this.logActivity(deviceDid, "group_assigned", { groupId });

    return {
      deviceDid,
      groupId,
      message: "Device assigned to group successfully",
    };
  }

  /**
   * 获取活动日志
   */
  async getActivityLogs(params, context) {
    const { deviceDid, limit = 50 } = params;

    let query = "SELECT * FROM device_activity_logs";
    const args = [];

    if (deviceDid) {
      query += " WHERE device_did = ?";
      args.push(deviceDid);
    }

    query += " ORDER BY timestamp DESC LIMIT ?";
    args.push(limit);

    const rows = await this.database.all(query, args);

    const logs = rows.map((row) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : {},
    }));

    return {
      logs,
      total: logs.length,
    };
  }

  /**
   * 发现设备（使用 P2P）
   */
  async discoverDevices(params, context) {
    logger.info("[DeviceManagerHandler] 发现设备...");

    if (!this.p2pManager) {
      throw new Error("P2P Manager not available");
    }

    // 获取当前连接的对等节点
    const peers = this.p2pManager.getConnectedPeers();

    const discoveredDevices = [];

    for (const peer of peers) {
      // 检查是否已注册
      const device = await this.database.get(
        "SELECT * FROM devices WHERE peer_id = ?",
        [peer.peerId],
      );

      discoveredDevices.push({
        peerId: peer.peerId,
        registered: !!device,
        deviceDid: device?.device_did || null,
        deviceName: device?.device_name || "Unknown Device",
        status: device?.status || "unknown",
      });
    }

    return {
      devices: discoveredDevices,
      total: discoveredDevices.length,
    };
  }

  /**
   * 连接到设备
   */
  async connectToDevice(params, context) {
    const { deviceDid, timeout = 30000 } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    logger.info(`[DeviceManagerHandler] 连接到设备: ${deviceDid}`);

    // 更新设备状态为连接中
    await this.database.run(
      "UPDATE devices SET status = ?, last_seen_at = ?, updated_at = ? WHERE device_did = ?",
      [DeviceStatus.CONNECTING, Date.now(), Date.now(), deviceDid],
    );

    await this.logActivity(deviceDid, "connection_attempt", {});

    // 执行 P2P 连接
    try {
      if (!this.p2pManager) {
        throw new Error("P2P Manager not initialized");
      }

      // 查找设备的 Peer ID
      const device = this.database
        .prepare("SELECT peer_id, multiaddr FROM devices WHERE device_did = ?")
        .get(deviceDid);

      if (!device) {
        throw new Error("Device not found in database");
      }

      let connected = false;

      // 尝试通过 Peer ID 或多地址连接
      if (device.peer_id) {
        // 使用 P2P Manager 连接到 Peer
        if (typeof this.p2pManager.connectToPeer === 'function') {
          connected = await Promise.race([
            this.p2pManager.connectToPeer(device.peer_id, device.multiaddr),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout')), timeout)
            ),
          ]);
        } else if (typeof this.p2pManager.dial === 'function') {
          // 兼容 libp2p dial 方法
          const multiaddr = device.multiaddr || `/p2p/${device.peer_id}`;
          await Promise.race([
            this.p2pManager.dial(multiaddr),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout')), timeout)
            ),
          ]);
          connected = true;
        }
      }

      if (connected) {
        // 连接成功，更新状态
        await this.database.run(
          "UPDATE devices SET status = ?, last_seen_at = ?, updated_at = ? WHERE device_did = ?",
          [DeviceStatus.ONLINE, Date.now(), Date.now(), deviceDid],
        );

        await this.logActivity(deviceDid, "connected", {
          peerId: device.peer_id,
        });

        // 发送连接事件
        this.emit("device:connected", { deviceDid, peerId: device.peer_id });

        logger.info(`[DeviceManagerHandler] ✓ 设备连接成功: ${deviceDid}`);

        return {
          deviceDid,
          peerId: device.peer_id,
          status: DeviceStatus.ONLINE,
          message: "Device connected successfully",
        };
      } else {
        throw new Error("Connection failed");
      }
    } catch (error) {
      // 连接失败，更新状态
      await this.database.run(
        "UPDATE devices SET status = ?, updated_at = ? WHERE device_did = ?",
        [DeviceStatus.OFFLINE, Date.now(), deviceDid],
      );

      await this.logActivity(deviceDid, "connection_failed", {
        error: error.message,
      });

      logger.error(`[DeviceManagerHandler] 设备连接失败: ${deviceDid}`, error);

      return {
        deviceDid,
        status: DeviceStatus.OFFLINE,
        message: `Connection failed: ${error.message}`,
        error: error.message,
      };
    }
  }

  /**
   * 断开设备连接
   */
  async disconnectDevice(params, context) {
    const { deviceDid } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    logger.info(`[DeviceManagerHandler] 断开设备: ${deviceDid}`);

    await this.database.run(
      "UPDATE devices SET status = ?, updated_at = ? WHERE device_did = ?",
      [DeviceStatus.DISCONNECTED, Date.now(), deviceDid],
    );

    await this.logActivity(deviceDid, "disconnected", {});

    return {
      deviceDid,
      status: DeviceStatus.DISCONNECTED,
      message: "Device disconnected",
    };
  }

  /**
   * 记录设备活动
   */
  async logActivity(deviceDid, activityType, details) {
    try {
      await this.database.run(
        "INSERT INTO device_activity_logs (device_did, activity_type, details, timestamp) VALUES (?, ?, ?, ?)",
        [deviceDid, activityType, JSON.stringify(details), Date.now()],
      );
    } catch (error) {
      logger.error("[DeviceManagerHandler] 记录活动失败:", error);
    }
  }

  /**
   * 启动设备状态监控
   */
  startDeviceMonitoring() {
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.updateDeviceStatuses();
      } catch (error) {
        logger.error("[DeviceManagerHandler] 状态监控失败:", error);
      }
    }, 60 * 1000); // 每分钟检查一次

    logger.info("[DeviceManagerHandler] 设备状态监控已启动");
  }

  /**
   * 更新设备状态
   */
  async updateDeviceStatuses() {
    const timeout = this.options.deviceTimeout;
    const cutoffTime = Date.now() - timeout;

    // 将超时的在线设备标记为离线
    await this.database.run(
      `UPDATE devices SET status = ?, updated_at = ?
       WHERE status = ? AND last_seen_at < ?`,
      [DeviceStatus.OFFLINE, Date.now(), DeviceStatus.ONLINE, cutoffTime],
    );

    // 清理缓存
    this.deviceCache.clear();
  }

  /**
   * 停止设备监控
   */
  stopDeviceMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      logger.info("[DeviceManagerHandler] 设备状态监控已停止");
    }
  }
}

module.exports = {
  DeviceManagerHandler,
  DeviceStatus,
  PermissionLevel,
};
