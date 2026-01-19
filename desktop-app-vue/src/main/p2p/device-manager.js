/**
 * 设备管理器
 *
 * 负责多设备支持的核心功能:
 * - 设备身份生成和管理
 * - 设备注册和发现
 * - 设备列表同步
 * - 设备间消息路由
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * 设备管理器类
 */
class DeviceManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      userId: config.userId || null,
      dataPath: config.dataPath || null,
      deviceName: config.deviceName || this.generateDeviceName(),
      ...config,
    };

    this.currentDevice = null;
    this.devices = new Map(); // userId -> Device[]
    this.initialized = false;
  }

  /**
   * 初始化设备管理器
   */
  async initialize() {
    logger.info('[DeviceManager] 初始化设备管理器...');

    try {
      // 加载或生成当前设备信息
      await this.loadOrGenerateDevice();

      // 加载已知设备列表
      await this.loadDeviceList();

      this.initialized = true;

      logger.info('[DeviceManager] 设备管理器已初始化');
      logger.info('[DeviceManager] 当前设备:', this.currentDevice);

      this.emit('initialized', {
        device: this.currentDevice,
      });

      return true;
    } catch (error) {
      logger.error('[DeviceManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 生成设备名称
   */
  generateDeviceName() {
    const os = require('os');
    const hostname = os.hostname();
    const platform = os.platform();
    return `${hostname} (${platform})`;
  }

  /**
   * 加载或生成设备信息
   */
  async loadOrGenerateDevice() {
    if (!this.config.dataPath) {
      // 无数据路径，生成临时设备
      this.currentDevice = this.generateDevice();
      return;
    }

    const devicePath = path.join(this.config.dataPath, 'device.json');

    try {
      // 尝试加载现有设备
      if (fs.existsSync(devicePath)) {
        const deviceData = JSON.parse(fs.readFileSync(devicePath, 'utf8'));
        this.currentDevice = deviceData;
        logger.info('[DeviceManager] 已加载现有设备');
        return;
      }
    } catch (error) {
      logger.warn('[DeviceManager] 加载设备失败，将生成新的:', error.message);
    }

    // 生成新设备并保存
    this.currentDevice = this.generateDevice();

    try {
      fs.mkdirSync(path.dirname(devicePath), { recursive: true });
      fs.writeFileSync(devicePath, JSON.stringify(this.currentDevice, null, 2));
      logger.info('[DeviceManager] 设备信息已保存到:', devicePath);
    } catch (error) {
      logger.warn('[DeviceManager] 保存设备信息失败:', error.message);
    }
  }

  /**
   * 生成新设备
   */
  generateDevice() {
    const deviceId = this.generateDeviceId();

    return {
      deviceId,
      deviceName: this.config.deviceName,
      userId: this.config.userId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      platform: process.platform,
      version: require('../../../../package.json').version || '0.14.0',
    };
  }

  /**
   * 生成设备 ID
   */
  generateDeviceId() {
    // 生成一个唯一的设备 ID (32位十六进制)
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 加载已知设备列表
   */
  async loadDeviceList() {
    if (!this.config.dataPath) {
      return;
    }

    const devicesPath = path.join(this.config.dataPath, 'devices.json');

    try {
      if (fs.existsSync(devicesPath)) {
        const devicesData = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));

        // 重建设备映射
        for (const [userId, devices] of Object.entries(devicesData)) {
          this.devices.set(userId, devices);
        }

        logger.info('[DeviceManager] 已加载设备列表:', this.devices.size, '个用户');
      }
    } catch (error) {
      logger.warn('[DeviceManager] 加载设备列表失败:', error.message);
    }
  }

  /**
   * 保存设备列表
   */
  async saveDeviceList() {
    if (!this.config.dataPath) {
      return;
    }

    const devicesPath = path.join(this.config.dataPath, 'devices.json');

    try {
      // 转换 Map 为普通对象
      const devicesData = {};
      for (const [userId, devices] of this.devices.entries()) {
        devicesData[userId] = devices;
      }

      fs.mkdirSync(path.dirname(devicesPath), { recursive: true });
      fs.writeFileSync(devicesPath, JSON.stringify(devicesData, null, 2));
      logger.info('[DeviceManager] 设备列表已保存');
    } catch (error) {
      logger.warn('[DeviceManager] 保存设备列表失败:', error.message);
    }
  }

  /**
   * 注册设备
   * @param {string} userId - 用户 ID
   * @param {Object} device - 设备信息
   */
  async registerDevice(userId, device) {
    logger.info('[DeviceManager] 注册设备:', userId, device.deviceId);

    let userDevices = this.devices.get(userId);

    if (!userDevices) {
      userDevices = [];
      this.devices.set(userId, userDevices);
    }

    // 检查设备是否已存在
    const existingIndex = userDevices.findIndex(d => d.deviceId === device.deviceId);

    if (existingIndex >= 0) {
      // 更新现有设备
      userDevices[existingIndex] = {
        ...userDevices[existingIndex],
        ...device,
        lastActiveAt: Date.now(),
      };
    } else {
      // 添加新设备
      userDevices.push({
        ...device,
        registeredAt: Date.now(),
        lastActiveAt: Date.now(),
      });
    }

    // 保存设备列表
    await this.saveDeviceList();

    this.emit('device:registered', { userId, device });

    return { success: true };
  }

  /**
   * 注销设备
   * @param {string} userId - 用户 ID
   * @param {string} deviceId - 设备 ID
   */
  async unregisterDevice(userId, deviceId) {
    logger.info('[DeviceManager] 注销设备:', userId, deviceId);

    const userDevices = this.devices.get(userId);

    if (!userDevices) {
      return { success: false, error: 'User not found' };
    }

    const index = userDevices.findIndex(d => d.deviceId === deviceId);

    if (index >= 0) {
      userDevices.splice(index, 1);

      // 如果用户没有设备了，删除用户条目
      if (userDevices.length === 0) {
        this.devices.delete(userId);
      }

      // 保存设备列表
      await this.saveDeviceList();

      this.emit('device:unregistered', { userId, deviceId });

      return { success: true };
    }

    return { success: false, error: 'Device not found' };
  }

  /**
   * 获取用户的所有设备
   * @param {string} userId - 用户 ID
   */
  getUserDevices(userId) {
    return this.devices.get(userId) || [];
  }

  /**
   * 获取当前设备信息
   */
  getCurrentDevice() {
    return this.currentDevice;
  }

  /**
   * 更新设备活跃时间
   * @param {string} userId - 用户 ID
   * @param {string} deviceId - 设备 ID
   */
  async updateDeviceActivity(userId, deviceId) {
    const userDevices = this.devices.get(userId);

    if (!userDevices) {
      return;
    }

    const device = userDevices.find(d => d.deviceId === deviceId);

    if (device) {
      device.lastActiveAt = Date.now();
      await this.saveDeviceList();
    }
  }

  /**
   * 获取设备广播信息
   * 用于在网络中广播当前设备信息
   */
  getDeviceBroadcast() {
    if (!this.currentDevice) {
      return null;
    }

    return {
      type: 'device-broadcast',
      device: this.currentDevice,
      timestamp: Date.now(),
    };
  }

  /**
   * 处理设备广播
   * @param {string} peerId - 对等节点 ID
   * @param {Object} broadcast - 广播数据
   */
  async handleDeviceBroadcast(peerId, broadcast) {
    if (broadcast.type !== 'device-broadcast') {
      return;
    }

    const device = broadcast.device;

    if (!device || !device.userId || !device.deviceId) {
      logger.warn('[DeviceManager] 无效的设备广播');
      return;
    }

    // 注册设备
    await this.registerDevice(device.userId, {
      ...device,
      peerId, // 关联 P2P 节点 ID
    });

    logger.info('[DeviceManager] 收到设备广播:', device.userId, device.deviceName);

    this.emit('device:discovered', {
      userId: device.userId,
      device,
      peerId,
    });
  }

  /**
   * 清理不活跃的设备
   * @param {number} maxAge - 最大不活跃时间 (毫秒)
   */
  async cleanupInactiveDevices(maxAge = 7 * 24 * 60 * 60 * 1000) {
    logger.info('[DeviceManager] 清理不活跃设备...');

    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, devices] of this.devices.entries()) {
      const activeDevices = devices.filter(device => {
        const age = now - device.lastActiveAt;
        return age < maxAge;
      });

      if (activeDevices.length < devices.length) {
        cleanedCount += devices.length - activeDevices.length;

        if (activeDevices.length === 0) {
          this.devices.delete(userId);
        } else {
          this.devices.set(userId, activeDevices);
        }
      }
    }

    if (cleanedCount > 0) {
      await this.saveDeviceList();
      logger.info('[DeviceManager] 已清理', cleanedCount, '个不活跃设备');
    }
  }

  /**
   * 获取所有设备统计
   */
  getStatistics() {
    let totalDevices = 0;
    const userCount = this.devices.size;

    for (const devices of this.devices.values()) {
      totalDevices += devices.length;
    }

    return {
      userCount,
      totalDevices,
      currentDevice: this.currentDevice,
    };
  }

  /**
   * 关闭设备管理器
   */
  async close() {
    logger.info('[DeviceManager] 关闭设备管理器');

    // 更新当前设备的活跃时间
    if (this.currentDevice && this.config.userId) {
      await this.updateDeviceActivity(this.config.userId, this.currentDevice.deviceId);
    }

    this.initialized = false;
    this.emit('closed');
  }
}

module.exports = DeviceManager;
