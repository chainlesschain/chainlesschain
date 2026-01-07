/**
 * Device Pairing Handler - PC端设备配对处理器
 *
 * 功能：
 * - 扫描移动端二维码
 * - 验证配对码有效性
 * - 显示确认对话框
 * - 发送配对确认
 * - 注册移动设备
 */

const EventEmitter = require('events');

class DevicePairingHandler extends EventEmitter {
  constructor(p2pManager, mobileBridge, deviceManager) {
    super();

    this.p2pManager = p2pManager;
    this.mobileBridge = mobileBridge;
    this.deviceManager = deviceManager;

    // 配对状态
    this.isPairing = false;
    this.pendingPairings = new Map(); // pairingCode -> { qrData, expiresAt }

    // 配对超时（5分钟）
    this.pairingTimeout = 5 * 60 * 1000;

    // 定期清理过期配对请求
    this.startCleanupTimer();
  }

  /**
   * 扫描并处理二维码
   * @param {string} qrCodeData - 二维码数据（JSON字符串）
   * @returns {Promise<Object>} 配对结果
   */
  async handleQRCodeScan(qrCodeData) {
    console.log('[DevicePairingHandler] 处理二维码扫描...');

    try {
      // 1. 解析二维码数据
      const qrData = JSON.parse(qrCodeData);

      // 2. 验证数据格式
      if (qrData.type !== 'device-pairing') {
        throw new Error('无效的配对二维码');
      }

      // 3. 验证配对码
      const validation = this.validatePairingCode(qrData);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // 4. 保存配对请求
      this.pendingPairings.set(qrData.code, {
        qrData,
        expiresAt: Date.now() + this.pairingTimeout
      });

      // 5. 显示确认对话框（返回Promise等待用户操作）
      const userConfirmed = await this.showConfirmationDialog(qrData);

      if (!userConfirmed) {
        throw new Error('用户取消配对');
      }

      // 6. 发送配对确认
      await this.sendConfirmation(qrData);

      // 7. 注册移动设备
      const mobileDevice = await this.registerMobileDevice(qrData);

      // 8. 等待移动端连接
      await this.waitForMobileConnection(qrData.did);

      console.log('[DevicePairingHandler] ✅ 配对成功');

      // 9. 清理配对请求
      this.pendingPairings.delete(qrData.code);

      return {
        success: true,
        device: mobileDevice
      };

    } catch (error) {
      console.error('[DevicePairingHandler] ❌ 配对失败:', error);
      throw error;
    }
  }

  /**
   * 验证配对码
   */
  validatePairingCode(qrData) {
    // 1. 检查必需字段
    if (!qrData.code || !qrData.did || !qrData.deviceInfo || !qrData.timestamp) {
      return { valid: false, error: '二维码数据不完整' };
    }

    // 2. 检查配对码格式（6位数字）
    if (!/^\d{6}$/.test(qrData.code)) {
      return { valid: false, error: '配对码格式错误' };
    }

    // 3. 检查时间戳（不超过5分钟）
    const age = Date.now() - qrData.timestamp;
    if (age > this.pairingTimeout) {
      return { valid: false, error: '配对码已过期' };
    }

    // 4. 检查是否已被使用
    if (this.deviceManager && this.deviceManager.isDeviceRegistered(qrData.deviceInfo.deviceId)) {
      return { valid: false, error: '设备已配对' };
    }

    return { valid: true };
  }

  /**
   * 显示确认对话框
   * @returns {Promise<boolean>} 用户是否确认
   */
  async showConfirmationDialog(qrData) {
    console.log('[DevicePairingHandler] 显示确认对话框...');

    // 触发事件，让主窗口显示对话框
    return new Promise((resolve, reject) => {
      this.emit('pairing:confirmation-needed', {
        qrData,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });

      // 30秒超时
      setTimeout(() => {
        reject(new Error('用户确认超时'));
      }, 30000);
    });
  }

  /**
   * 发送配对确认到移动端
   */
  async sendConfirmation(qrData) {
    console.log('[DevicePairingHandler] 发送配对确认...');

    const confirmationMessage = {
      type: 'pairing:confirmation',
      pairingCode: qrData.code,
      pcPeerId: this.p2pManager.peerId.toString(),
      deviceInfo: {
        name: require('os').hostname(),
        platform: process.platform,
        version: process.env.npm_package_version || '0.16.0'
      },
      timestamp: Date.now()
    };

    // 通过信令服务器发送（因为此时WebRTC还未建立）
    if (this.mobileBridge && this.mobileBridge.isConnected) {
      this.mobileBridge.send({
        type: 'message',
        to: qrData.did, // 暂时使用DID作为临时peerId
        payload: confirmationMessage
      });
    } else {
      throw new Error('信令服务器未连接');
    }
  }

  /**
   * 注册移动设备
   */
  async registerMobileDevice(qrData) {
    console.log('[DevicePairingHandler] 注册移动设备...');

    const device = {
      deviceId: qrData.deviceInfo.deviceId,
      deviceName: qrData.deviceInfo.name,
      did: qrData.did,
      platform: qrData.deviceInfo.platform,
      version: qrData.deviceInfo.version,
      pairedAt: Date.now(),
      lastActiveAt: Date.now()
    };

    // 注册到设备管理器
    if (this.deviceManager) {
      await this.deviceManager.registerDevice(qrData.did, device);
    }

    return device;
  }

  /**
   * 等待移动端连接
   */
  async waitForMobileConnection(mobileDid) {
    console.log('[DevicePairingHandler] 等待移动端连接...');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.mobileBridge.off('peer-connected', handler);
        reject(new Error('等待移动端连接超时'));
      }, 60000); // 60秒

      const handler = (event) => {
        if (event.peerId === mobileDid || event.type === 'mobile') {
          clearTimeout(timeout);
          this.mobileBridge.off('peer-connected', handler);
          resolve();
        }
      };

      this.mobileBridge.on('peer-connected', handler);
    });
  }

  /**
   * 启动二维码扫描（使用摄像头）
   * @returns {Promise<Object>} 扫描结果
   */
  async startQRCodeScanner() {
    console.log('[DevicePairingHandler] 启动二维码扫描器...');

    // 触发事件，让主窗口打开摄像头界面
    return new Promise((resolve, reject) => {
      this.emit('scanner:start', {
        onScanned: async (qrCodeData) => {
          try {
            const result = await this.handleQRCodeScan(qrCodeData);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        onCancel: () => {
          reject(new Error('用户取消扫描'));
        }
      });
    });
  }

  /**
   * 手动输入配对码
   */
  async pairWithCode(pairingCode, mobileDid, deviceInfo) {
    console.log('[DevicePairingHandler] 手动配对:', pairingCode);

    const qrData = {
      type: 'device-pairing',
      code: pairingCode,
      did: mobileDid,
      deviceInfo,
      timestamp: Date.now()
    };

    return this.handleQRCodeScan(JSON.stringify(qrData));
  }

  /**
   * 定期清理过期配对请求
   */
  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      const expired = [];

      for (const [code, data] of this.pendingPairings.entries()) {
        if (data.expiresAt < now) {
          expired.push(code);
        }
      }

      for (const code of expired) {
        this.pendingPairings.delete(code);
      }

      if (expired.length > 0) {
        console.log(`[DevicePairingHandler] 清理 ${expired.length} 个过期配对请求`);
      }
    }, 60000); // 每分钟清理一次
  }

  /**
   * 获取待处理的配对请求
   */
  getPendingPairings() {
    return Array.from(this.pendingPairings.values());
  }

  /**
   * 取消配对
   */
  cancelPairing(pairingCode) {
    console.log('[DevicePairingHandler] 取消配对:', pairingCode);
    this.pendingPairings.delete(pairingCode);
    this.emit('pairing:cancelled', { pairingCode });
  }
}

module.exports = DevicePairingHandler;
