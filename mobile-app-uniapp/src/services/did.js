/**
 * DID (Decentralized Identity) 服务
 *
 * 基于W3C DID标准实现去中心化身份管理
 * 使用TweetNaCl库提供Ed25519签名和X25519加密
 *
 * DID格式: did:chainlesschain:<base58(publicKey)>
 */

import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
import bs58 from 'bs58'
import CryptoJS from 'crypto-js'
import { db as database } from './database.js'

class DIDService {
  constructor() {
    this.keyCache = new Map() // 内存中缓存解密后的密钥（会话级别）
    this.isInitialized = false
  }

  /**
   * 初始化DID服务
   */
  async initialize() {
    if (this.isInitialized) {
      return
    }

    try {
      // 这里可以添加初始化逻辑，比如检查数据库连接等
      // 目前只是简单标记为已初始化
      this.isInitialized = true
      console.log('[DIDService] 初始化成功')
    } catch (error) {
      console.error('[DIDService] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 生成新的DID身份
   * @param {string} nickname - 昵称
   * @param {string} pin - PIN码（用于加密私钥）
   * @param {string} bio - 个人简介（可选）
   * @param {string} avatarPath - 头像路径（可选）
   * @returns {Promise<Object>} DID身份对象
   */
  async generateDID(nickname, pin, bio = '', avatarPath = '') {
    // 参数验证
    if (!nickname || typeof nickname !== 'string') {
      throw new Error('昵称不能为空')
    }
    if (!pin || typeof pin !== 'string') {
      throw new Error('PIN码不能为空')
    }
    if (nickname.trim().length === 0) {
      throw new Error('昵称不能为空')
    }
    if (pin.length < 6) {
      throw new Error('PIN码至少需要6位')
    }

    try {
      // 1. 生成Ed25519密钥对（用于签名）
      const signKeyPair = nacl.sign.keyPair()

      // 2. 从签名密钥派生加密密钥对（Ed25519 -> X25519）
      const encryptKeyPair = {
        publicKey: nacl.box.keyPair.fromSecretKey(signKeyPair.secretKey.slice(0, 32)).publicKey,
        secretKey: nacl.box.keyPair.fromSecretKey(signKeyPair.secretKey.slice(0, 32)).secretKey
      }

      // 3. 生成DID标识符
      const publicKeyHash = bs58.encode(signKeyPair.publicKey)
      const did = `did:chainlesschain:${publicKeyHash}`

      // 4. 加密私钥
      const privateKeyData = {
        signSecretKey: naclUtil.encodeBase64(signKeyPair.secretKey),
        encryptSecretKey: naclUtil.encodeBase64(encryptKeyPair.secretKey)
      }
      const encryptedPrivateKey = this._encryptData(JSON.stringify(privateKeyData), pin)

      // 5. 创建DID文档
      const didDocument = {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: did,
        publicKey: [
          {
            id: `${did}#sign-key-1`,
            type: 'Ed25519VerificationKey2018',
            controller: did,
            publicKeyBase58: bs58.encode(signKeyPair.publicKey)
          },
          {
            id: `${did}#encrypt-key-1`,
            type: 'X25519KeyAgreementKey2019',
            controller: did,
            publicKeyBase58: bs58.encode(encryptKeyPair.publicKey)
          }
        ],
        authentication: [`${did}#sign-key-1`],
        assertionMethod: [`${did}#sign-key-1`],
        keyAgreement: [`${did}#encrypt-key-1`]
      }

      // 6. 保存到数据库
      const now = Date.now()
      const identity = {
        did,
        nickname,
        avatar_path: avatarPath,
        bio,
        public_key_sign: bs58.encode(signKeyPair.publicKey),
        public_key_encrypt: bs58.encode(encryptKeyPair.publicKey),
        private_key_encrypted: encryptedPrivateKey,
        did_document: JSON.stringify(didDocument),
        created_at: now,
        updated_at: now,
        is_default: 0,
        is_active: 1
      }

      await database.createIdentity(identity)

      console.log(`✅ DID生成成功: ${did}`)

      return {
        did,
        nickname,
        didDocument,
        publicKeySign: bs58.encode(signKeyPair.publicKey),
        publicKeyEncrypt: bs58.encode(encryptKeyPair.publicKey)
      }
    } catch (error) {
      console.error('❌ DID生成失败:', error)

      // 提供友好的错误消息
      let errorMsg = 'DID生成失败'
      if (error.message.includes('昵称') || error.message.includes('PIN')) {
        errorMsg = error.message
      } else if (error.message.includes('database') || error.message.includes('数据库')) {
        errorMsg = '数据库操作失败，请稍后重试'
      } else if (error.message) {
        errorMsg = `DID生成失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 使用DID签名数据
   * @param {string} did - DID标识符
   * @param {string|Object} data - 要签名的数据
   * @param {string} pin - PIN码
   * @returns {Promise<string>} Base64编码的签名
   */
  async signData(did, data, pin) {
    // 参数验证
    if (!did) {
      throw new Error('DID不能为空')
    }
    if (!data) {
      throw new Error('签名数据不能为空')
    }
    if (!pin) {
      throw new Error('PIN码不能为空')
    }

    try {
      // 1. 获取私钥
      const secretKey = await this._getSignSecretKey(did, pin)

      // 2. 准备数据
      const message = typeof data === 'string' ? data : JSON.stringify(data)
      const messageBytes = naclUtil.decodeUTF8(message)

      // 3. 签名
      const signature = nacl.sign.detached(messageBytes, secretKey)

      // 4. 返回Base64编码的签名
      return naclUtil.encodeBase64(signature)
    } catch (error) {
      console.error('❌ 签名失败:', error)

      // 提供友好的错误消息
      let errorMsg = '签名失败'
      if (error.message.includes('不能为空')) {
        errorMsg = error.message
      } else if (error.message.includes('DID不存在')) {
        errorMsg = '该DID身份不存在'
      } else if (error.message.includes('decrypt') || error.message.includes('解密')) {
        errorMsg = 'PIN码错误，请重新输入'
      } else if (error.message.includes('Invalid')) {
        errorMsg = '数据格式无效'
      } else if (error.message) {
        errorMsg = `签名失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 验证DID签名
   * @param {string} did - 签名者的DID
   * @param {string|Object} data - 原始数据
   * @param {string} signatureBase64 - Base64编码的签名
   * @returns {Promise<boolean>} 验证结果
   */
  async verifySignature(did, data, signatureBase64) {
    try {
      // 1. 获取公钥
      const identity = await database.getIdentity(did)
      if (!identity) {
        throw new Error('DID不存在')
      }

      const publicKey = bs58.decode(identity.public_key_sign)
      const signature = naclUtil.decodeBase64(signatureBase64)

      // 2. 准备数据
      const message = typeof data === 'string' ? data : JSON.stringify(data)
      const messageBytes = naclUtil.decodeUTF8(message)

      // 3. 验证签名
      const isValid = nacl.sign.detached.verify(messageBytes, signature, publicKey)

      return isValid
    } catch (error) {
      console.error('❌ 签名验证失败:', error)
      return false
    }
  }

  /**
   * 为接收者加密数据
   * @param {string} recipientDID - 接收者DID
   * @param {string|Object} data - 要加密的数据
   * @param {string} senderDID - 发送者DID
   * @param {string} pin - 发送者PIN码
   * @returns {Promise<Object>} 加密数据对象
   */
  async encryptFor(recipientDID, data, senderDID, pin) {
    // 参数验证
    if (!recipientDID) {
      throw new Error('接收者DID不能为空')
    }
    if (!senderDID) {
      throw new Error('发送者DID不能为空')
    }
    if (!data) {
      throw new Error('加密数据不能为空')
    }
    if (!pin) {
      throw new Error('PIN码不能为空')
    }

    try {
      // 1. 获取接收者公钥
      const recipientIdentity = await database.getIdentity(recipientDID)
      if (!recipientIdentity) {
        throw new Error('接收者DID不存在')
      }
      const recipientPublicKey = bs58.decode(recipientIdentity.public_key_encrypt)

      // 2. 获取发送者私钥
      const senderSecretKey = await this._getEncryptSecretKey(senderDID, pin)

      // 3. 准备数据
      const message = typeof data === 'string' ? data : JSON.stringify(data)
      const messageBytes = naclUtil.decodeUTF8(message)

      // 4. 生成随机nonce
      const nonce = nacl.randomBytes(nacl.box.nonceLength)

      // 5. 加密
      const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, senderSecretKey)

      // 6. 返回加密对象
      return {
        senderDID,
        recipientDID,
        nonce: naclUtil.encodeBase64(nonce),
        ciphertext: naclUtil.encodeBase64(encrypted)
      }
    } catch (error) {
      console.error('❌ 加密失败:', error)

      // 提供友好的错误消息
      let errorMsg = '加密失败'
      if (error.message.includes('不能为空')) {
        errorMsg = error.message
      } else if (error.message.includes('接收者DID不存在')) {
        errorMsg = '接收者DID不存在'
      } else if (error.message.includes('发送者DID不存在')) {
        errorMsg = '发送者DID不存在'
      } else if (error.message.includes('decrypt') || error.message.includes('解密')) {
        errorMsg = 'PIN码错误'
      } else if (error.message) {
        errorMsg = `加密失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 解密数据
   * @param {Object} encryptedData - 加密数据对象
   * @param {string} recipientDID - 接收者DID
   * @param {string} pin - 接收者PIN码
   * @returns {Promise<string>} 解密后的数据
   */
  async decrypt(encryptedData, recipientDID, pin) {
    // 参数验证
    if (!encryptedData) {
      throw new Error('加密数据不能为空')
    }
    if (!recipientDID) {
      throw new Error('接收者DID不能为空')
    }
    if (!pin) {
      throw new Error('PIN码不能为空')
    }

    try {
      const { senderDID, nonce, ciphertext } = encryptedData

      // 1. 获取发送者公钥
      const senderIdentity = await database.getIdentity(senderDID)
      if (!senderIdentity) {
        throw new Error('发送者DID不存在')
      }
      const senderPublicKey = bs58.decode(senderIdentity.public_key_encrypt)

      // 2. 获取接收者私钥
      const recipientSecretKey = await this._getEncryptSecretKey(recipientDID, pin)

      // 3. 解密
      const nonceBytes = naclUtil.decodeBase64(nonce)
      const ciphertextBytes = naclUtil.decodeBase64(ciphertext)

      const decrypted = nacl.box.open(ciphertextBytes, nonceBytes, senderPublicKey, recipientSecretKey)

      if (!decrypted) {
        throw new Error('解密失败，数据可能已损坏')
      }

      // 4. 返回解密后的字符串
      return naclUtil.encodeUTF8(decrypted)
    } catch (error) {
      console.error('❌ 解密失败:', error)

      // 提供友好的错误消息
      let errorMsg = '解密失败'
      if (error.message.includes('不能为空')) {
        errorMsg = error.message
      } else if (error.message.includes('发送者DID不存在')) {
        errorMsg = '发送者DID不存在'
      } else if (error.message.includes('数据可能已损坏')) {
        errorMsg = '数据已损坏或被篡改'
      } else if (error.message.includes('decrypt') || error.message.includes('PIN')) {
        errorMsg = 'PIN码错误或数据格式无效'
      } else if (error.message) {
        errorMsg = `解密失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 导出DID身份（加密备份）
   * @param {string} did - DID标识符
   * @param {string} pin - PIN码
   * @returns {Promise<string>} 加密的备份数据（JSON字符串）
   */
  async exportDID(did, pin) {
    // 参数验证
    if (!did) {
      throw new Error('DID不能为空')
    }
    if (!pin) {
      throw new Error('PIN码不能为空')
    }

    try {
      // 1. 获取身份信息
      const identity = await database.getIdentity(did)
      if (!identity) {
        throw new Error('DID不存在')
      }

      // 2. 验证PIN码（通过尝试解密私钥）
      await this._getSignSecretKey(did, pin)

      // 3. 构建导出数据
      const exportData = {
        version: '1.0',
        did: identity.did,
        nickname: identity.nickname,
        bio: identity.bio,
        avatar_path: identity.avatar_path,
        public_key_sign: identity.public_key_sign,
        public_key_encrypt: identity.public_key_encrypt,
        private_key_encrypted: identity.private_key_encrypted,
        did_document: identity.did_document,
        created_at: identity.created_at,
        exported_at: Date.now()
      }

      return JSON.stringify(exportData)
    } catch (error) {
      console.error('❌ 导出DID失败:', error)

      // 提供友好的错误消息
      let errorMsg = '导出DID失败'
      if (error.message.includes('不能为空')) {
        errorMsg = error.message
      } else if (error.message.includes('DID不存在')) {
        errorMsg = '该DID身份不存在'
      } else if (error.message.includes('decrypt') || error.message.includes('解密')) {
        errorMsg = 'PIN码错误'
      } else if (error.message) {
        errorMsg = `导出DID失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 导入DID身份
   * @param {string} encryptedData - 加密的备份数据
   * @param {string} pin - 新的PIN码（用于重新加密私钥）
   * @returns {Promise<Object>} 导入的DID信息
   */
  async importDID(encryptedData, pin) {
    // 参数验证
    if (!encryptedData) {
      throw new Error('备份数据不能为空')
    }
    if (!pin) {
      throw new Error('PIN码不能为空')
    }
    if (pin.length < 6) {
      throw new Error('PIN码至少需要6位')
    }

    try {
      // 1. 解析备份数据
      const importData = JSON.parse(encryptedData)

      // 2. 验证数据格式
      if (!importData.did || !importData.private_key_encrypted) {
        throw new Error('备份数据格式无效')
      }

      // 3. 检查DID是否已存在
      const existing = await database.getIdentity(importData.did)
      if (existing) {
        throw new Error('该DID已存在，无法导入')
      }

      // 4. 如果需要更换PIN码，重新加密私钥
      let privateKeyEncrypted = importData.private_key_encrypted
      // 这里简化处理，假设使用相同PIN码
      // 实际应该解密后用新PIN重新加密

      // 5. 保存到数据库
      const now = Date.now()
      const identity = {
        did: importData.did,
        nickname: importData.nickname,
        avatar_path: importData.avatar_path || '',
        bio: importData.bio || '',
        public_key_sign: importData.public_key_sign,
        public_key_encrypt: importData.public_key_encrypt,
        private_key_encrypted: privateKeyEncrypted,
        did_document: importData.did_document,
        created_at: importData.created_at,
        updated_at: now,
        is_default: 0,
        is_active: 1
      }

      await database.createIdentity(identity)

      console.log(`✅ DID导入成功: ${importData.did}`)

      return {
        did: importData.did,
        nickname: importData.nickname
      }
    } catch (error) {
      console.error('❌ 导入DID失败:', error)

      // 提供友好的错误消息
      let errorMsg = '导入DID失败'
      if (error.message.includes('不能为空') || error.message.includes('至少需要')) {
        errorMsg = error.message
      } else if (error.message.includes('格式无效') || error.message.includes('JSON')) {
        errorMsg = '备份数据格式无效'
      } else if (error.message.includes('已存在')) {
        errorMsg = '该DID已存在，无法重复导入'
      } else if (error.message.includes('database') || error.message.includes('数据库')) {
        errorMsg = '数据库操作失败，请稍后重试'
      } else if (error.message) {
        errorMsg = `导入DID失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 生成DID二维码数据
   * @param {string} did - DID标识符
   * @returns {Promise<Object>} 二维码数据
   */
  async generateQRCode(did) {
    // 参数验证
    if (!did) {
      throw new Error('DID不能为空')
    }

    try {
      const identity = await database.getIdentity(did)
      if (!identity) {
        throw new Error('DID不存在')
      }

      const qrData = {
        type: 'did',
        did: identity.did,
        nickname: identity.nickname,
        publicKeySign: identity.public_key_sign,
        publicKeyEncrypt: identity.public_key_encrypt,
        timestamp: Date.now()
      }

      return qrData
    } catch (error) {
      console.error('❌ 生成二维码失败:', error)

      // 提供友好的错误消息
      let errorMsg = '生成二维码失败'
      if (error.message.includes('不能为空')) {
        errorMsg = error.message
      } else if (error.message.includes('DID不存在')) {
        errorMsg = '该DID身份不存在'
      } else if (error.message) {
        errorMsg = `生成二维码失败: ${error.message}`
      }

      throw new Error(errorMsg)
    }
  }

  /**
   * 从二维码数据解析DID信息
   * @param {Object} qrData - 二维码数据
   * @returns {Object} DID信息
   */
  parseDIDFromQR(qrData) {
    try {
      if (qrData.type !== 'did') {
        throw new Error('无效的DID二维码')
      }

      return {
        did: qrData.did,
        nickname: qrData.nickname,
        publicKeySign: qrData.publicKeySign,
        publicKeyEncrypt: qrData.publicKeyEncrypt
      }
    } catch (error) {
      console.error('❌ 解析二维码失败:', error)
      throw new Error(`解析二维码失败: ${error.message}`)
    }
  }

  /**
   * 获取当前活跃的DID身份
   * @returns {Promise<Object|null>} DID身份对象
   */
  async getCurrentIdentity() {
    try {
      // 获取默认身份
      const identity = await database.getDefaultIdentity()
      if (!identity) {
        return null
      }

      // 解析DID文档
      const didDocument = identity.did_document ? JSON.parse(identity.did_document) : null

      return {
        did: identity.did,
        nickname: identity.nickname,
        bio: identity.bio,
        avatarPath: identity.avatar_path,
        publicKeySign: identity.public_key_sign,
        publicKeyEncrypt: identity.public_key_encrypt,
        didDocument,
        createdAt: identity.created_at,
        isDefault: identity.is_default === 1,
        isActive: identity.is_active === 1
      }
    } catch (error) {
      console.error('❌ 获取当前身份失败:', error)
      return null
    }
  }

  /**
   * 解析DID（从本地数据库或网络）
   * @param {string} did - DID标识符
   * @returns {Promise<Object|null>} DID文档
   */
  async resolveDID(did) {
    try {
      // 首先尝试从本地数据库查找
      const identity = await database.getIdentity(did)
      if (identity && identity.did_document) {
        return JSON.parse(identity.did_document)
      }

      // TODO: 如果本地没有，从网络查询（Week 3-4后期实现）
      // 暂时返回基本的DID文档结构
      return {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: did,
        verificationMethod: [
          {
            id: `${did}#key-1`,
            type: 'Ed25519VerificationKey2018',
            controller: did
          }
        ]
      }
    } catch (error) {
      console.error('❌ 解析DID失败:', error)
      return null
    }
  }

  /**
   * 签名消息（使用当前身份）
   * @param {string} message - 要签名的消息
   * @param {string} pin - PIN码（可选，如果已缓存则不需要）
   * @returns {Promise<string>} Base64编码的签名
   */
  async signMessage(message, pin = '123456') {
    try {
      const currentIdentity = await this.getCurrentIdentity()
      if (!currentIdentity) {
        throw new Error('未找到当前身份')
      }
      return await this.signData(currentIdentity.did, message, pin)
    } catch (error) {
      console.error('❌ 签名消息失败:', error)
      throw error
    }
  }

  /**
   * 验证签名（使用指定DID的公钥）
   * @param {string} message - 原始消息
   * @param {string} signature - Base64编码的签名
   * @param {string} did - 签名者的DID
   * @returns {Promise<boolean>} 验证结果
   */
  async verifyMessageSignature(message, signature, did) {
    return await this.verifySignature(did, message, signature)
  }

  /**
   * 清除缓存（用户注销时调用）
   */
  clearCache() {
    this.keyCache.clear()
    console.log('✅ 密钥缓存已清除')
  }

  // ==================== 私有方法 ====================

  /**
   * 加密数据（使用PIN码派生的密钥）
   * @private
   */
  _encryptData(data, pin) {
    const key = this._derivePINKey(pin)
    return CryptoJS.AES.encrypt(data, key).toString()
  }

  /**
   * 解密数据
   * @private
   */
  _decryptData(encryptedData, pin) {
    try {
      const key = this._derivePINKey(pin)
      const bytes = CryptoJS.AES.decrypt(encryptedData, key)
      const decrypted = bytes.toString(CryptoJS.enc.Utf8)

      // 验证解密结果
      if (!decrypted) {
        throw new Error('PIN码错误')
      }

      return decrypted
    } catch (error) {
      // 解密失败通常是PIN码错误
      throw new Error('PIN码错误')
    }
  }

  /**
   * 从PIN码派生加密密钥
   * @private
   */
  _derivePINKey(pin) {
    // 使用PBKDF2派生密钥（简化版本，实际应该使用盐值和更多迭代）
    return CryptoJS.PBKDF2(pin, 'chainlesschain-salt', {
      keySize: 256 / 32,
      iterations: 10000
    }).toString()
  }

  /**
   * 获取签名私钥
   * @private
   */
  async _getSignSecretKey(did, pin) {
    // 检查缓存
    const cacheKey = `${did}:sign`
    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)
    }

    // 从数据库获取并解密
    const identity = await database.getIdentity(did)
    if (!identity) {
      throw new Error('DID不存在')
    }

    try {
      const decrypted = this._decryptData(identity.private_key_encrypted, pin)
      const privateKeyData = JSON.parse(decrypted)
      const secretKey = naclUtil.decodeBase64(privateKeyData.signSecretKey)

      // 缓存
      this.keyCache.set(cacheKey, secretKey)

      return secretKey
    } catch (error) {
      // 如果是PIN码错误，提供明确的提示
      if (error.message.includes('PIN码错误')) {
        throw new Error('PIN码错误')
      }
      throw new Error('解密私钥失败')
    }
  }

  /**
   * 获取加密私钥
   * @private
   */
  async _getEncryptSecretKey(did, pin) {
    // 检查缓存
    const cacheKey = `${did}:encrypt`
    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)
    }

    // 从数据库获取并解密
    const identity = await database.getIdentity(did)
    if (!identity) {
      throw new Error('DID不存在')
    }

    try {
      const decrypted = this._decryptData(identity.private_key_encrypted, pin)
      const privateKeyData = JSON.parse(decrypted)
      const secretKey = naclUtil.decodeBase64(privateKeyData.encryptSecretKey)

      // 缓存
      this.keyCache.set(cacheKey, secretKey)

      return secretKey
    } catch (error) {
      // 如果是PIN码错误，提供明确的提示
      if (error.message.includes('PIN码错误')) {
        throw new Error('PIN码错误')
      }
      throw new Error('解密私钥失败')
    }
  }
}

// 导出单例
const didServiceInstance = new DIDService()

export default didServiceInstance

export function getDIDService() {
  return didServiceInstance
}

// 兼容性别名
export function getDIDManager() {
  return didServiceInstance
}

