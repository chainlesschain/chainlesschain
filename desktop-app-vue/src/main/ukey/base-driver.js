/**
 * U盾驱动基类
 *
 * 所有U盾驱动都必须实现这个基类的方法
 */
class BaseUKeyDriver {
  constructor(config = {}) {
    this.config = config;
    this.isInitialized = false;
    this.isUnlocked = false;
    this.deviceInfo = null;
  }

  /**
   * 初始化驱动
   * @returns {Promise<boolean>}
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * 检测U盾设备
   * @returns {Promise<UKeyStatus>}
   */
  async detect() {
    throw new Error('detect() must be implemented by subclass');
  }

  /**
   * 验证PIN码
   * @param {string} pin - PIN码
   * @returns {Promise<UKeyVerifyResult>}
   */
  async verifyPIN(pin) {
    throw new Error('verifyPIN() must be implemented by subclass');
  }

  /**
   * 数字签名
   * @param {string} data - 待签名数据
   * @returns {Promise<string>} 签名结果（Base64）
   */
  async sign(data) {
    throw new Error('sign() must be implemented by subclass');
  }

  /**
   * 验证签名
   * @param {string} data - 原始数据
   * @param {string} signature - 签名（Base64）
   * @returns {Promise<boolean>}
   */
  async verifySignature(data, signature) {
    throw new Error('verifySignature() must be implemented by subclass');
  }

  /**
   * 加密数据
   * @param {string} data - 待加密数据
   * @returns {Promise<string>} 加密结果（Base64）
   */
  async encrypt(data) {
    throw new Error('encrypt() must be implemented by subclass');
  }

  /**
   * 解密数据
   * @param {string} encryptedData - 加密数据（Base64）
   * @returns {Promise<string>} 解密结果
   */
  async decrypt(encryptedData) {
    throw new Error('decrypt() must be implemented by subclass');
  }

  /**
   * 获取公钥
   * @returns {Promise<string>} 公钥（PEM格式）
   */
  async getPublicKey() {
    throw new Error('getPublicKey() must be implemented by subclass');
  }

  /**
   * 获取设备信息
   * @returns {Promise<UKeyDeviceInfo>}
   */
  async getDeviceInfo() {
    throw new Error('getDeviceInfo() must be implemented by subclass');
  }

  /**
   * 锁定U盾
   */
  lock() {
    this.isUnlocked = false;
  }

  /**
   * 检查是否已解锁
   * @returns {boolean}
   */
  isDeviceUnlocked() {
    return this.isUnlocked;
  }

  /**
   * 关闭驱动
   */
  async close() {
    this.isInitialized = false;
    this.isUnlocked = false;
    this.deviceInfo = null;
  }

  /**
   * 获取驱动名称
   * @returns {string}
   */
  getDriverName() {
    return 'BaseDriver';
  }

  /**
   * 获取驱动版本
   * @returns {string}
   */
  getDriverVersion() {
    return '1.0.0';
  }

  /**
   * 辅助方法：延迟执行
   * @param {number} ms - 延迟时间（毫秒）
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseUKeyDriver;
