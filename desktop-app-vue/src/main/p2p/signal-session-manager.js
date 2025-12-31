/**
 * Signal 协议会话管理器
 *
 * 实现端到端加密的消息通信
 * 基于 Signal 协议 (X3DH + Double Ratchet)
 *
 * 核心功能：
 * - 身份密钥管理
 * - 预密钥生成和管理
 * - 会话建立 (X3DH 密钥协商)
 * - 消息加密/解密 (Double Ratchet)
 * - 会话持久化
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Signal 协议库
let KeyHelper, SessionBuilder, SessionCipher, SignalProtocolAddress;

/**
 * Signal 会话管理器类
 */
class SignalSessionManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      userId: config.userId || 'default-user',
      deviceId: config.deviceId || 1,
      dataPath: config.dataPath || null,
      ...config,
    };

    this.store = null;
    this.identityKeyPair = null;
    this.registrationId = null;
    this.preKeys = new Map();
    this.signedPreKey = null;
    this.sessions = new Map();
    this.initialized = false;
  }

  /**
   * 初始化 Signal 会话管理器
   */
  async initialize() {
    console.log('[SignalSession] 初始化 Signal 会话管理器...');

    try {
      // 动态导入 Signal 协议库
      await this.loadSignalLibrary();

      // 创建存储
      this.store = new LocalSignalProtocolStore();

      // 加载或生成身份
      await this.loadOrGenerateIdentity();

      // 生成预密钥
      await this.generatePreKeys();

      this.initialized = true;

      console.log('[SignalSession] Signal 会话管理器已初始化');
      console.log('[SignalSession] 用户 ID:', this.config.userId);
      console.log('[SignalSession] 设备 ID:', this.config.deviceId);
      console.log('[SignalSession] 注册 ID:', this.registrationId);

      this.emit('initialized', {
        userId: this.config.userId,
        deviceId: this.config.deviceId,
        registrationId: this.registrationId,
      });

      return true;
    } catch (error) {
      console.error('[SignalSession] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加载 Signal 协议库
   */
  async loadSignalLibrary() {
    try {
      const signal = await import('@privacyresearch/libsignal-protocol-typescript');

      KeyHelper = signal.KeyHelper;
      SessionBuilder = signal.SessionBuilder;
      SessionCipher = signal.SessionCipher;
      SignalProtocolAddress = signal.SignalProtocolAddress;

      console.log('[SignalSession] Signal 协议库已加载');
    } catch (error) {
      console.error('[SignalSession] 加载 Signal 协议库失败:', error);
      throw new Error('Failed to load Signal protocol library');
    }
  }

  /**
   * 加载或生成身份
   */
  async loadOrGenerateIdentity() {
    if (!this.config.dataPath) {
      // 无数据路径，生成临时身份
      await this.generateIdentity();
      return;
    }

    const identityPath = path.join(this.config.dataPath, 'signal-identity.json');

    try {
      // 尝试加载现有身份
      if (fs.existsSync(identityPath)) {
        const identityData = JSON.parse(fs.readFileSync(identityPath, 'utf8'));

        // 重建身份密钥对 - 从 JSON 序列化格式转换回 ArrayBuffer
        this.identityKeyPair = {
          pubKey: this.arrayBufferFromObject(identityData.identityKeyPair.pubKey),
          privKey: this.arrayBufferFromObject(identityData.identityKeyPair.privKey),
        };
        this.registrationId = identityData.registrationId;

        // 存储到 Signal Store
        await this.store.put('identityKey', this.identityKeyPair);
        await this.store.put('registrationId', this.registrationId);

        console.log('[SignalSession] 已加载现有身份');
        return;
      }
    } catch (error) {
      console.warn('[SignalSession] 加载身份失败，将生成新的:', error.message);
    }

    // 生成新身份并保存
    await this.generateIdentity();

    try {
      fs.mkdirSync(path.dirname(identityPath), { recursive: true });

      // 序列化身份数据 - 将 ArrayBuffer 转换为可序列化的数组
      const serializableIdentity = {
        identityKeyPair: {
          pubKey: Array.from(new Uint8Array(this.identityKeyPair.pubKey)),
          privKey: Array.from(new Uint8Array(this.identityKeyPair.privKey)),
        },
        registrationId: this.registrationId,
      };

      fs.writeFileSync(identityPath, JSON.stringify(serializableIdentity, null, 2));
      console.log('[SignalSession] 身份已保存到:', identityPath);
    } catch (error) {
      console.warn('[SignalSession] 保存身份失败:', error.message);
    }
  }

  /**
   * 生成新身份
   */
  async generateIdentity() {
    console.log('[SignalSession] 生成新身份...');

    // 生成身份密钥对
    this.identityKeyPair = await KeyHelper.generateIdentityKeyPair();

    // 生成注册 ID
    this.registrationId = KeyHelper.generateRegistrationId();

    // 存储到 Signal Store
    await this.store.put('identityKey', this.identityKeyPair);
    await this.store.put('registrationId', this.registrationId);

    console.log('[SignalSession] 新身份已生成');
  }

  /**
   * 生成预密钥
   */
  async generatePreKeys() {
    console.log('[SignalSession] 生成预密钥...');

    // 生成签名预密钥
    const signedPreKeyId = Math.floor(Math.random() * 16777215);
    this.signedPreKey = await KeyHelper.generateSignedPreKey(
      this.identityKeyPair,
      signedPreKeyId
    );

    // 存储签名预密钥
    await this.store.storeSignedPreKey(signedPreKeyId, this.signedPreKey.keyPair);

    // 生成一批一次性预密钥 (100个)
    const basePreKeyId = Math.floor(Math.random() * 16777215);
    const preKeyCount = 100;
    const preKeys = [];

    for (let i = 0; i < preKeyCount; i++) {
      const preKeyId = (basePreKeyId + i) % 16777215;
      const preKey = await KeyHelper.generatePreKey(preKeyId);
      preKeys.push(preKey);

      // 存储预密钥
      await this.store.storePreKey(preKey.keyId, preKey.keyPair);
      this.preKeys.set(preKey.keyId, preKey);
    }

    console.log('[SignalSession] 预密钥已生成:', preKeys.length, '个');
  }

  /**
   * 获取预密钥包 (Pre Key Bundle)
   * 用于建立新会话
   */
  async getPreKeyBundle() {
    if (!this.initialized) {
      throw new Error('Signal session manager not initialized');
    }

    // 获取一个一次性预密钥
    const preKeyArray = Array.from(this.preKeys.values());
    const preKey = preKeyArray[Math.floor(Math.random() * preKeyArray.length)];

    if (!preKey) {
      throw new Error('No pre keys available');
    }

    return {
      registrationId: this.registrationId,
      identityKey: this.identityKeyPair.pubKey,
      signedPreKey: {
        keyId: this.signedPreKey.keyId,
        publicKey: this.signedPreKey.keyPair.pubKey,
        signature: this.signedPreKey.signature,
      },
      preKey: {
        keyId: preKey.keyId,
        publicKey: preKey.keyPair.pubKey,
      },
    };
  }

  /**
   * 处理预密钥包并建立会话
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID
   * @param {Object} preKeyBundle - 预密钥包
   */
  async processPreKeyBundle(recipientId, deviceId, preKeyBundle) {
    console.log('[SignalSession] 处理预密钥包，建立会话:', recipientId, deviceId);

    try {
      const address = new SignalProtocolAddress(recipientId, deviceId);

      // 创建会话构建器
      const sessionBuilder = new SessionBuilder(this.store, address);

      // 处理预密钥包
      await sessionBuilder.processPreKey({
        registrationId: preKeyBundle.registrationId,
        identityKey: preKeyBundle.identityKey,
        signedPreKey: {
          keyId: preKeyBundle.signedPreKey.keyId,
          publicKey: preKeyBundle.signedPreKey.publicKey,
          signature: preKeyBundle.signedPreKey.signature,
        },
        preKey: preKeyBundle.preKey
          ? {
              keyId: preKeyBundle.preKey.keyId,
              publicKey: preKeyBundle.preKey.publicKey,
            }
          : undefined,
      });

      console.log('[SignalSession] 会话已建立:', recipientId);

      this.emit('session:created', { recipientId, deviceId });

      return { success: true };
    } catch (error) {
      console.error('[SignalSession] 建立会话失败:', error);
      throw error;
    }
  }

  /**
   * 加密消息
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID
   * @param {string|Buffer} plaintext - 明文消息
   */
  async encryptMessage(recipientId, deviceId, plaintext) {
    console.log('[SignalSession] 加密消息:', recipientId);

    try {
      const address = new SignalProtocolAddress(recipientId, deviceId);

      // 创建会话加密器
      const sessionCipher = new SessionCipher(this.store, address);

      // 加密消息
      const ciphertext = await sessionCipher.encrypt(
        typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
      );

      console.log('[SignalSession] 消息已加密');

      return {
        type: ciphertext.type, // 1: PreKeyWhisperMessage, 3: WhisperMessage
        body: ciphertext.body,
        registrationId: ciphertext.registrationId,
      };
    } catch (error) {
      console.error('[SignalSession] 加密消息失败:', error);
      throw error;
    }
  }

  /**
   * 解密消息
   * @param {string} senderId - 发送者 ID
   * @param {number} deviceId - 设备 ID
   * @param {Object} ciphertext - 密文消息
   */
  async decryptMessage(senderId, deviceId, ciphertext) {
    console.log('[SignalSession] 解密消息:', senderId);

    try {
      const address = new SignalProtocolAddress(senderId, deviceId);

      // 创建会话加密器
      const sessionCipher = new SessionCipher(this.store, address);

      let plaintext;

      if (ciphertext.type === 1) {
        // PreKeyWhisperMessage (首次消息)
        plaintext = await sessionCipher.decryptPreKeyWhisperMessage(
          ciphertext.body,
          'binary'
        );
      } else if (ciphertext.type === 3) {
        // WhisperMessage (后续消息)
        plaintext = await sessionCipher.decryptWhisperMessage(
          ciphertext.body,
          'binary'
        );
      } else {
        throw new Error('Unknown message type: ' + ciphertext.type);
      }

      console.log('[SignalSession] 消息已解密');

      return Buffer.from(plaintext).toString('utf8');
    } catch (error) {
      console.error('[SignalSession] 解密消息失败:', error);
      throw error;
    }
  }

  /**
   * 检查是否存在会话
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID
   */
  async hasSession(recipientId, deviceId) {
    const address = new SignalProtocolAddress(recipientId, deviceId);
    return await this.store.loadSession(address.toString()) !== undefined;
  }

  /**
   * 删除会话
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID
   */
  async deleteSession(recipientId, deviceId) {
    console.log('[SignalSession] 删除会话:', recipientId);

    try {
      const address = new SignalProtocolAddress(recipientId, deviceId);
      await this.store.removeSession(address.toString());

      console.log('[SignalSession] 会话已删除');

      this.emit('session:deleted', { recipientId, deviceId });

      return { success: true };
    } catch (error) {
      console.error('[SignalSession] 删除会话失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有会话列表
   */
  async getSessions() {
    try {
      const sessions = await this.store.getAllSessions();
      return Array.from(sessions.keys());
    } catch (error) {
      console.error('[SignalSession] 获取会话列表失败:', error);
      return [];
    }
  }

  /**
   * 从 JSON 对象重建 ArrayBuffer
   * @param {Object} obj - JSON 对象 (可能是 { type: 'Buffer', data: [...] } 或数组)
   * @returns {ArrayBuffer} ArrayBuffer
   */
  arrayBufferFromObject(obj) {
    if (!obj) {
      return new ArrayBuffer(0);
    }

    // 已经是 ArrayBuffer - 直接返回
    if (obj instanceof ArrayBuffer) {
      return obj;
    }

    // Buffer 类型 - 转换为 ArrayBuffer
    if (Buffer.isBuffer(obj)) {
      return obj.buffer.slice(obj.byteOffset, obj.byteOffset + obj.byteLength);
    }

    // TypedArray 或 DataView - 提取底层 ArrayBuffer
    if (ArrayBuffer.isView(obj)) {
      return obj.buffer.slice(obj.byteOffset, obj.byteOffset + obj.byteLength);
    }

    // 处理数组格式
    let array;
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      // Node.js Buffer 序列化格式
      array = obj.data;
    } else if (Array.isArray(obj)) {
      // 普通数组格式
      array = obj;
    } else {
      console.warn('[SignalSession] 未知的 ArrayBuffer 格式:', typeof obj);
      return new ArrayBuffer(0);
    }

    // 从数组创建 ArrayBuffer
    const buffer = new ArrayBuffer(array.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < array.length; i++) {
      view[i] = array[i];
    }
    return buffer;
  }

  /**
   * 关闭会话管理器
   */
  async close() {
    console.log('[SignalSession] 关闭会话管理器');

    this.initialized = false;
    this.sessions.clear();
    this.preKeys.clear();

    this.emit('closed');
  }
}

/**
 * Signal Protocol Store 实现
 * 存储会话、身份密钥、预密钥等
 */
class LocalSignalProtocolStore {
  constructor() {
    this.store = new Map();
  }

  async getIdentityKeyPair() {
    return this.store.get('identityKey');
  }

  async getLocalRegistrationId() {
    return this.store.get('registrationId');
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async get(key, defaultValue) {
    if (this.store.has(key)) {
      return this.store.get(key);
    }
    return defaultValue;
  }

  async remove(key) {
    this.store.delete(key);
  }

  // Session 相关
  async loadSession(identifier) {
    const session = this.store.get(`session_${identifier}`);
    return session || null;
  }

  async storeSession(identifier, record) {
    this.store.set(`session_${identifier}`, record);
  }

  async removeSession(identifier) {
    this.store.delete(`session_${identifier}`);
  }

  async getAllSessions() {
    const sessions = new Map();
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith('session_')) {
        sessions.set(key.replace('session_', ''), value);
      }
    }
    return sessions;
  }

  // PreKey 相关
  async loadPreKey(keyId) {
    return this.store.get(`preKey_${keyId}`);
  }

  async storePreKey(keyId, keyPair) {
    this.store.set(`preKey_${keyId}`, keyPair);
  }

  async removePreKey(keyId) {
    this.store.delete(`preKey_${keyId}`);
  }

  // Signed PreKey 相关
  async loadSignedPreKey(keyId) {
    return this.store.get(`signedPreKey_${keyId}`);
  }

  async storeSignedPreKey(keyId, keyPair) {
    this.store.set(`signedPreKey_${keyId}`, keyPair);
  }

  async removeSignedPreKey(keyId) {
    this.store.delete(`signedPreKey_${keyId}`);
  }

  // Identity Key 相关
  async isTrustedIdentity(identifier, identityKey, direction) {
    // 简单实现：信任所有密钥
    // 生产环境应该验证密钥指纹
    return true;
  }

  async loadIdentityKey(identifier) {
    return this.store.get(`identityKey_${identifier}`);
  }

  async saveIdentity(identifier, identityKey) {
    const existing = this.store.get(`identityKey_${identifier}`);
    this.store.set(`identityKey_${identifier}`, identityKey);

    if (existing && existing !== identityKey) {
      return true; // Identity changed
    }
    return false;
  }
}

module.exports = SignalSessionManager;
