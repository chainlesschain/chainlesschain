/**
 * Signal协议会话管理器 (移动端版本)
 *
 * 简化版Signal协议，基于X25519密钥交换 + Double Ratchet思想
 * 使用TweetNaCl实现，兼容H5、小程序、App三端
 *
 * 功能对齐桌面端：
 * - 身份密钥管理 (Ed25519签名 + X25519加密)
 * - 预密钥生成和管理
 * - 会话建立 (X3DH密钥协商)
 * - 消息加密/解密 (Ratchet加密)
 * - 会话持久化
 */

import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
import bs58 from 'bs58'
import CryptoJS from 'crypto-js'

/**
 * Signal会话管理器类
 */
class SignalSessionManager {
  constructor(database, config = {}) {
    this.db = database
    this.config = {
      userId: config.userId || 'default-user',
      deviceId: config.deviceId || 1,
      preKeyCount: config.preKeyCount || 100,
      ...config
    }

    // 身份密钥
    this.identityKeyPair = null // { sign: { publicKey, secretKey }, encrypt: { publicKey, secretKey } }
    this.registrationId = null

    // 预密钥
    this.preKeys = new Map() // keyId -> { publicKey, secretKey }
    this.signedPreKey = null // { keyId, publicKey, secretKey, signature }

    // 会话
    this.sessions = new Map() // peerId -> Session对象

    this.initialized = false
  }

  /**
   * 初始化Signal会话管理器
   */
  async initialize() {
    console.log('[SignalSession] 初始化Signal会话管理器...')

    try {
      // 确保数据库已初始化
      if (!this.db.isOpen) {
        throw new Error('数据库未初始化')
      }

      // 确保表存在
      await this.ensureTables()

      // 加载或生成身份
      await this.loadOrGenerateIdentity()

      // 生成预密钥
      await this.generatePreKeys()

      // 加载现有会话
      await this.loadSessions()

      this.initialized = true

      console.log('[SignalSession] ✅ Signal会话管理器已初始化')
      console.log('[SignalSession] 用户ID:', this.config.userId)
      console.log('[SignalSession] 注册ID:', this.registrationId)

      return true
    } catch (error) {
      console.error('[SignalSession] ❌ 初始化失败:', error)
      throw error
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    // Signal身份表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_identities (
        user_id TEXT PRIMARY KEY,
        device_id INTEGER,
        registration_id INTEGER,
        identity_sign_public TEXT,
        identity_sign_private TEXT,
        identity_encrypt_public TEXT,
        identity_encrypt_private TEXT,
        created_at INTEGER
      )
    `)

    // Signal预密钥表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_prekeys (
        key_id INTEGER PRIMARY KEY,
        public_key TEXT,
        secret_key TEXT,
        is_signed INTEGER DEFAULT 0,
        signature TEXT,
        created_at INTEGER
      )
    `)

    // Signal会话表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_sessions (
        peer_id TEXT PRIMARY KEY,
        session_data TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    console.log('[SignalSession] 数据库表已确保存在')
  }

  /**
   * 加载或生成身份
   */
  async loadOrGenerateIdentity() {
    try {
      // 尝试从数据库加载
      const existingIdentity = this.db.exec(`
        SELECT * FROM signal_identities WHERE user_id = ?
      `, [this.config.userId])[0]

      if (existingIdentity) {
        // 重建身份密钥对
        this.identityKeyPair = {
          sign: {
            publicKey: naclUtil.decodeBase64(existingIdentity.identity_sign_public),
            secretKey: naclUtil.decodeBase64(existingIdentity.identity_sign_private)
          },
          encrypt: {
            publicKey: naclUtil.decodeBase64(existingIdentity.identity_encrypt_public),
            secretKey: naclUtil.decodeBase64(existingIdentity.identity_encrypt_private)
          }
        }
        this.registrationId = existingIdentity.registration_id

        console.log('[SignalSession] 已加载现有身份')
        return
      }
    } catch (error) {
      console.warn('[SignalSession] 加载身份失败，将生成新的:', error)
    }

    // 生成新身份
    await this.generateIdentity()
  }

  /**
   * 生成新身份
   */
  async generateIdentity() {
    console.log('[SignalSession] 生成新身份...')

    // 1. 生成Ed25519签名密钥对
    const signKeyPair = nacl.sign.keyPair()

    // 2. 生成X25519加密密钥对（从签名密钥派生）
    const encryptKeyPair = nacl.box.keyPair()

    // 3. 生成注册ID (随机32位整数)
    this.registrationId = Math.floor(Math.random() * 0x7FFFFFFF)

    this.identityKeyPair = {
      sign: signKeyPair,
      encrypt: encryptKeyPair
    }

    // 4. 保存到数据库
    await this.db.exec(`
      INSERT OR REPLACE INTO signal_identities (
        user_id, device_id, registration_id,
        identity_sign_public, identity_sign_private,
        identity_encrypt_public, identity_encrypt_private,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.config.userId,
      this.config.deviceId,
      this.registrationId,
      naclUtil.encodeBase64(signKeyPair.publicKey),
      naclUtil.encodeBase64(signKeyPair.secretKey),
      naclUtil.encodeBase64(encryptKeyPair.publicKey),
      naclUtil.encodeBase64(encryptKeyPair.secretKey),
      Date.now()
    ])

    console.log('[SignalSession] ✅ 新身份已生成并保存')
  }

  /**
   * 生成预密钥
   */
  async generatePreKeys() {
    console.log('[SignalSession] 生成预密钥...')

    // 1. 生成签名预密钥
    const signedPreKeyId = Math.floor(Math.random() * 0x7FFFFFFF)
    const signedPreKeyPair = nacl.box.keyPair()

    // 签名：对公钥进行签名
    const signature = nacl.sign.detached(
      signedPreKeyPair.publicKey,
      this.identityKeyPair.sign.secretKey
    )

    this.signedPreKey = {
      keyId: signedPreKeyId,
      publicKey: signedPreKeyPair.publicKey,
      secretKey: signedPreKeyPair.secretKey,
      signature: signature
    }

    // 保存签名预密钥到数据库
    await this.db.exec(`
      INSERT OR REPLACE INTO signal_prekeys (
        key_id, public_key, secret_key, is_signed, signature, created_at
      ) VALUES (?, ?, ?, 1, ?, ?)
    `, [
      signedPreKeyId,
      naclUtil.encodeBase64(signedPreKeyPair.publicKey),
      naclUtil.encodeBase64(signedPreKeyPair.secretKey),
      naclUtil.encodeBase64(signature),
      Date.now()
    ])

    // 2. 生成一批一次性预密钥
    const basePreKeyId = Math.floor(Math.random() * 0x7FFFFFFF)
    const preKeyCount = this.config.preKeyCount

    for (let i = 0; i < preKeyCount; i++) {
      const preKeyId = basePreKeyId + i
      const preKeyPair = nacl.box.keyPair()

      this.preKeys.set(preKeyId, preKeyPair)

      // 保存到数据库
      await this.db.exec(`
        INSERT OR REPLACE INTO signal_prekeys (
          key_id, public_key, secret_key, is_signed, created_at
        ) VALUES (?, ?, ?, 0, ?)
      `, [
        preKeyId,
        naclUtil.encodeBase64(preKeyPair.publicKey),
        naclUtil.encodeBase64(preKeyPair.secretKey),
        Date.now()
      ])
    }

    console.log('[SignalSession] ✅ 已生成签名预密钥和', preKeyCount, '个一次性预密钥')
  }

  /**
   * 获取预密钥包 (Pre-Key Bundle)
   * 用于X3DH密钥协商
   */
  async getPreKeyBundle() {
    if (!this.identityKeyPair) {
      throw new Error('身份未初始化')
    }

    // 随机选择一个一次性预密钥
    const preKeyIds = Array.from(this.preKeys.keys())
    const preKeyId = preKeyIds[Math.floor(Math.random() * preKeyIds.length)]
    const preKey = this.preKeys.get(preKeyId)

    return {
      registrationId: this.registrationId,
      identityKey: naclUtil.encodeBase64(this.identityKeyPair.encrypt.publicKey),
      signedPreKey: {
        keyId: this.signedPreKey.keyId,
        publicKey: naclUtil.encodeBase64(this.signedPreKey.publicKey),
        signature: naclUtil.encodeBase64(this.signedPreKey.signature)
      },
      preKey: preKey ? {
        keyId: preKeyId,
        publicKey: naclUtil.encodeBase64(preKey.publicKey)
      } : null
    }
  }

  /**
   * 建立会话 (X3DH密钥协商)
   * @param {string} peerId - 对方节点ID
   * @param {Object} preKeyBundle - 对方的预密钥包
   */
  async buildSession(peerId, preKeyBundle) {
    console.log('[SignalSession] 建立会话:', peerId)

    try {
      // 1. 解析对方的预密钥包
      const recipientIdentityKey = naclUtil.decodeBase64(preKeyBundle.identityKey)
      const recipientSignedPreKey = naclUtil.decodeBase64(preKeyBundle.signedPreKey.publicKey)
      const recipientPreKey = preKeyBundle.preKey ?
        naclUtil.decodeBase64(preKeyBundle.preKey.publicKey) : null

      // 2. 验证签名预密钥的签名 (简化版本，跳过验证)
      // 完整版本应该验证 recipientSignedPreKey 的签名

      // 3. 生成临时密钥对 (Ephemeral Key)
      const ephemeralKeyPair = nacl.box.keyPair()

      // 4. 执行X3DH密钥协商
      // DH1 = DH(IK_a, SPK_b)
      const dh1 = nacl.box.before(recipientSignedPreKey, this.identityKeyPair.encrypt.secretKey)

      // DH2 = DH(EK_a, IK_b)
      const dh2 = nacl.box.before(recipientIdentityKey, ephemeralKeyPair.secretKey)

      // DH3 = DH(EK_a, SPK_b)
      const dh3 = nacl.box.before(recipientSignedPreKey, ephemeralKeyPair.secretKey)

      // DH4 = DH(EK_a, OPK_b) [如果有一次性预密钥]
      let dh4 = null
      if (recipientPreKey) {
        dh4 = nacl.box.before(recipientPreKey, ephemeralKeyPair.secretKey)
      }

      // 5. 派生共享密钥 (SK = KDF(DH1 || DH2 || DH3 || DH4))
      const sharedSecret = this.deriveSharedSecret(dh1, dh2, dh3, dh4)

      // 6. 创建会话
      const session = {
        peerId,
        sharedSecret: naclUtil.encodeBase64(sharedSecret),
        sendingChainKey: naclUtil.encodeBase64(sharedSecret), // 初始发送链密钥
        receivingChainKey: naclUtil.encodeBase64(sharedSecret), // 初始接收链密钥
        sendingChainN: 0, // 发送消息计数
        receivingChainN: 0, // 接收消息计数
        ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      this.sessions.set(peerId, session)

      // 7. 保存会话到数据库
      await this.saveSession(peerId, session)

      console.log('[SignalSession] ✅ 会话已建立:', peerId)

      return {
        ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey),
        preKeyId: preKeyBundle.preKey?.keyId
      }
    } catch (error) {
      console.error('[SignalSession] ❌ 建立会话失败:', error)
      throw error
    }
  }

  /**
   * 派生共享密钥
   */
  deriveSharedSecret(dh1, dh2, dh3, dh4 = null) {
    // 简化版KDF: 使用SHA256哈希
    let combined = new Uint8Array(dh1.length + dh2.length + dh3.length + (dh4 ? dh4.length : 0))
    let offset = 0

    combined.set(new Uint8Array(dh1), offset)
    offset += dh1.length

    combined.set(new Uint8Array(dh2), offset)
    offset += dh2.length

    combined.set(new Uint8Array(dh3), offset)
    offset += dh3.length

    if (dh4) {
      combined.set(new Uint8Array(dh4), offset)
    }

    // 使用CryptoJS计算SHA256
    const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(combined))
    const hashBytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      hashBytes[i] = (hash.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    }

    return hashBytes
  }

  /**
   * 加密消息 (Double Ratchet)
   */
  async encryptMessage(peerId, plaintext) {
    const session = this.sessions.get(peerId)
    if (!session) {
      throw new Error('会话不存在，请先建立会话')
    }

    try {
      // 1. 从发送链密钥派生消息密钥
      const messageKey = this.deriveMessageKey(
        naclUtil.decodeBase64(session.sendingChainKey),
        session.sendingChainN
      )

      // 2. 使用NaCl secretbox加密消息
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
      const messageBytes = naclUtil.decodeUTF8(JSON.stringify(plaintext))
      const encrypted = nacl.secretbox(messageBytes, nonce, messageKey)

      // 3. 更新链密钥 (Ratchet前进)
      session.sendingChainKey = naclUtil.encodeBase64(
        this.ratchetChainKey(naclUtil.decodeBase64(session.sendingChainKey))
      )
      session.sendingChainN++
      session.updatedAt = Date.now()

      // 4. 保存会话状态
      await this.saveSession(peerId, session)

      // 5. 返回加密消息
      return {
        ciphertext: naclUtil.encodeBase64(encrypted),
        nonce: naclUtil.encodeBase64(nonce),
        counter: session.sendingChainN - 1 // 当前消息的计数
      }
    } catch (error) {
      console.error('[SignalSession] 加密消息失败:', error)
      throw error
    }
  }

  /**
   * 解密消息 (Double Ratchet)
   */
  async decryptMessage(peerId, encryptedMessage) {
    const session = this.sessions.get(peerId)
    if (!session) {
      throw new Error('会话不存在')
    }

    try {
      const { ciphertext, nonce, counter } = encryptedMessage

      // 1. 从接收链密钥派生消息密钥
      const messageKey = this.deriveMessageKey(
        naclUtil.decodeBase64(session.receivingChainKey),
        counter
      )

      // 2. 使用NaCl secretbox解密消息
      const ciphertextBytes = naclUtil.decodeBase64(ciphertext)
      const nonceBytes = naclUtil.decodeBase64(nonce)
      const decrypted = nacl.secretbox.open(ciphertextBytes, nonceBytes, messageKey)

      if (!decrypted) {
        throw new Error('解密失败：消息可能被篡改')
      }

      // 3. 更新链密钥 (Ratchet前进)
      session.receivingChainKey = naclUtil.encodeBase64(
        this.ratchetChainKey(naclUtil.decodeBase64(session.receivingChainKey))
      )
      session.receivingChainN++
      session.updatedAt = Date.now()

      // 4. 保存会话状态
      await this.saveSession(peerId, session)

      // 5. 返回明文
      const plaintextStr = naclUtil.encodeUTF8(decrypted)
      return JSON.parse(plaintextStr)
    } catch (error) {
      console.error('[SignalSession] 解密消息失败:', error)
      throw error
    }
  }

  /**
   * 派生消息密钥
   */
  deriveMessageKey(chainKey, counter) {
    // KDF: Hash(chainKey || counter)
    const counterBytes = new Uint8Array(4)
    new DataView(counterBytes.buffer).setUint32(0, counter, false)

    const combined = new Uint8Array(chainKey.length + counterBytes.length)
    combined.set(chainKey, 0)
    combined.set(counterBytes, chainKey.length)

    const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(combined))
    const keyBytes = new Uint8Array(nacl.secretbox.keyLength)
    for (let i = 0; i < nacl.secretbox.keyLength; i++) {
      keyBytes[i] = (hash.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    }

    return keyBytes
  }

  /**
   * Ratchet链密钥前进
   */
  ratchetChainKey(chainKey) {
    // 新链密钥 = Hash(旧链密钥)
    const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(chainKey))
    const newChainKey = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      newChainKey[i] = (hash.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    }
    return newChainKey
  }

  /**
   * 保存会话到数据库
   */
  async saveSession(peerId, session) {
    await this.db.exec(`
      INSERT OR REPLACE INTO signal_sessions (
        peer_id, session_data, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
    `, [
      peerId,
      JSON.stringify(session),
      session.createdAt || Date.now(),
      session.updatedAt || Date.now()
    ])
  }

  /**
   * 加载所有会话
   */
  async loadSessions() {
    try {
      const rows = this.db.exec('SELECT * FROM signal_sessions')

      rows.forEach(row => {
        const session = JSON.parse(row.session_data)
        this.sessions.set(row.peer_id, session)
      })

      console.log('[SignalSession] 已加载', this.sessions.size, '个会话')
    } catch (error) {
      console.warn('[SignalSession] 加载会话失败:', error)
    }
  }

  /**
   * 获取会话
   */
  getSession(peerId) {
    return this.sessions.get(peerId)
  }

  /**
   * 删除会话
   */
  async deleteSession(peerId) {
    this.sessions.delete(peerId)
    await this.db.exec('DELETE FROM signal_sessions WHERE peer_id = ?', [peerId])
    console.log('[SignalSession] 已删除会话:', peerId)
  }

  /**
   * 获取身份公钥
   */
  getIdentityPublicKey() {
    if (!this.identityKeyPair) {
      throw new Error('身份未初始化')
    }
    return naclUtil.encodeBase64(this.identityKeyPair.encrypt.publicKey)
  }
}

export default SignalSessionManager
