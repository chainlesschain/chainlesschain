/**
 * 可验证凭证 (Verifiable Credentials) 管理器 (Mobile Edition)
 *
 * 实现 W3C Verifiable Credentials 标准
 * 支持凭证创建、签名、验证、撤销等完整生命周期管理
 *
 * @version 2.1.0
 * @module VCManager
 */

import { v4 as uuidv4 } from 'uuid'
import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'

/**
 * VC 类型常量
 */
export const VC_TYPES = {
  SELF_DECLARATION: 'SelfDeclaration',
  SKILL_CERTIFICATE: 'SkillCertificate',
  TRUST_ENDORSEMENT: 'TrustEndorsement',
  EDUCATION_CREDENTIAL: 'EducationCredential',
  WORK_EXPERIENCE: 'WorkExperience',
  PROJECT_CERTIFICATION: 'ProjectCertification'
}

/**
 * VC 状态常量
 */
export const VC_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired'
}

/**
 * VC 管理器类
 */
class VCManager {
  /**
   * 构造函数
   * @param {Object} db - 数据库实例
   * @param {Object} didManager - DID管理器实例
   */
  constructor(db, didManager) {
    this.db = db
    this.didManager = didManager
    this.cache = new Map() // 凭证缓存
    this.statsCache = null // 统计缓存
    this.cacheExpiry = 5 * 60 * 1000 // 缓存过期时间: 5分钟
    this.initialized = false
  }

  /**
   * 初始化 VC 管理器
   */
  async initialize() {
    if (this.initialized) {
      console.log('[VCManager] 已初始化，跳过')
      return true
    }

    try {
      console.log('[VCManager] 初始化可验证凭证管理器...')

      // 创建表
      await this.createTable()

      this.initialized = true
      console.log('[VCManager] 可验证凭证管理器初始化成功')
      return true
    } catch (error) {
      console.error('[VCManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建数据库表
   */
  async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS verifiable_credentials (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        issuer_did TEXT NOT NULL,
        subject_did TEXT NOT NULL,
        claims TEXT NOT NULL,
        vc_document TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER,
        status TEXT DEFAULT 'active',
        revoked_at INTEGER,
        revocation_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `

    return new Promise((resolve, reject) => {
      this.db.executeSql({
        sql,
        success: () => {
          console.log('[VCManager] 数据库表已创建')
          resolve()
        },
        fail: (err) => {
          console.error('[VCManager] 创建表失败:', err)
          reject(err)
        }
      })
    })
  }

  /**
   * 创建可验证凭证
   * @param {Object} params - 凭证参数
   * @param {string} params.type - 凭证类型
   * @param {string} params.issuerDID - 颁发者 DID
   * @param {string} params.subjectDID - 主体 DID
   * @param {Object} params.claims - 声明数据
   * @param {number} params.expiresIn - 有效期（毫秒，可选）
   * @returns {Promise<Object>} 创建的 VC
   */
  async createCredential(params) {
    const { type, issuerDID, subjectDID, claims, expiresIn } = params

    console.log('[VCManager] 创建可验证凭证:', { type, issuerDID, subjectDID })

    try {
      // 验证颁发者身份
      const issuer = await this.didManager.getIdentityByDID(issuerDID)
      if (!issuer) {
        throw new Error('颁发者身份不存在')
      }

      // 生成 VC ID
      const vcId = `urn:uuid:${uuidv4()}`

      // 当前时间
      const now = Date.now()
      const issuanceDate = new Date(now).toISOString()

      // 过期时间
      let expirationDate = null
      let expiresAt = null
      if (expiresIn) {
        expiresAt = now + expiresIn
        expirationDate = new Date(expiresAt).toISOString()
      }

      // 构建凭证主体
      const credentialSubject = {
        id: subjectDID,
        ...claims
      }

      // 创建 VC 文档（遵循 W3C 标准）
      const vcDocument = {
        '@context': [
          'https://www.w3.org/2018/credentials/v1',
          'https://chainlesschain.com/credentials/v1'
        ],
        id: vcId,
        type: ['VerifiableCredential', type],
        issuer: issuerDID,
        issuanceDate,
        expirationDate,
        credentialSubject
      }

      // 签名 VC 文档
      const signedVC = await this.signCredential(vcDocument, issuer)

      // 保存到数据库
      await this.execute(
        `INSERT INTO verifiable_credentials (
          id, type, issuer_did, subject_did, claims,
          vc_document, issued_at, expires_at, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vcId,
          type,
          issuerDID,
          subjectDID,
          JSON.stringify(claims),
          JSON.stringify(signedVC),
          now,
          expiresAt,
          VC_STATUS.ACTIVE,
          now,
          now
        ]
      )

      // 清除缓存
      this.invalidateCache()

      console.log('[VCManager] 可验证凭证已创建:', vcId)

      return {
        id: vcId,
        type,
        issuer: issuerDID,
        subject: subjectDID,
        claims,
        issuedAt: now,
        expiresAt,
        status: VC_STATUS.ACTIVE,
        document: signedVC
      }
    } catch (error) {
      console.error('[VCManager] 创建可验证凭证失败:', error)
      throw error
    }
  }

  /**
   * 签名 VC 文档
   * @param {Object} vcDocument - VC 文档
   * @param {Object} issuerIdentity - 颁发者身份
   * @returns {Promise<Object>} 签名后的 VC 文档
   */
  async signCredential(vcDocument, issuerIdentity) {
    try {
      // 将文档转换为规范 JSON 字符串
      const message = JSON.stringify(vcDocument)
      const messageBytes = naclUtil.decodeUTF8(message)

      // 获取颁发者私钥
      const privateKeyRef = JSON.parse(issuerIdentity.private_key_ref)
      const secretKey = naclUtil.decodeBase64(privateKeyRef.sign)

      // 使用 Ed25519 签名
      const signature = nacl.sign.detached(messageBytes, secretKey)
      const signatureBase64 = naclUtil.encodeBase64(signature)

      // 添加证明（Proof）
      return {
        ...vcDocument,
        proof: {
          type: 'Ed25519Signature2020',
          created: new Date().toISOString(),
          verificationMethod: `${issuerIdentity.did}#sign-key-1`,
          proofPurpose: 'assertionMethod',
          proofValue: signatureBase64
        }
      }
    } catch (error) {
      console.error('[VCManager] 签名 VC 文档失败:', error)
      throw error
    }
  }

  /**
   * 验证 VC 文档签名
   * @param {Object} signedVC - 签名的 VC 文档
   * @returns {Promise<Object>} 验证结果 { isValid, reason }
   */
  async verifyCredential(signedVC) {
    try {
      const { proof, ...vcDocument } = signedVC

      if (!proof || !proof.proofValue) {
        return { isValid: false, reason: '缺少签名' }
      }

      // 获取颁发者 DID
      const issuerDID = vcDocument.issuer

      // 尝试从本地获取颁发者身份
      let issuerIdentity = await this.didManager.getIdentityByDID(issuerDID)

      // 如果本地没有，尝试从 DHT 解析
      if (!issuerIdentity) {
        console.log('[VCManager] 本地未找到颁发者身份，尝试从 DHT 解析...')
        try {
          const dhtData = await this.didManager.resolveFromDHT(issuerDID)
          issuerIdentity = {
            did: dhtData.did,
            public_key_sign: dhtData.publicKeySign
          }
        } catch (error) {
          return { isValid: false, reason: '无法解析颁发者 DID' }
        }
      }

      // 解码公钥和签名
      const publicKey = naclUtil.decodeBase64(issuerIdentity.public_key_sign)
      const signature = naclUtil.decodeBase64(proof.proofValue)

      // 重建原始消息
      const message = JSON.stringify(vcDocument)
      const messageBytes = naclUtil.decodeUTF8(message)

      // 验证签名
      const isSignatureValid = nacl.sign.detached.verify(messageBytes, signature, publicKey)

      if (!isSignatureValid) {
        return { isValid: false, reason: '签名验证失败' }
      }

      // 检查是否过期
      if (vcDocument.expirationDate) {
        const expirationTime = new Date(vcDocument.expirationDate).getTime()
        if (Date.now() > expirationTime) {
          return { isValid: false, reason: 'VC 已过期' }
        }
      }

      return { isValid: true, reason: '验证成功' }
    } catch (error) {
      console.error('[VCManager] 验证 VC 文档失败:', error)
      return { isValid: false, reason: `验证失败: ${error.message}` }
    }
  }

  /**
   * 根据 ID 获取凭证
   * @param {string} id - 凭证 ID
   * @returns {Promise<Object|null>} 凭证对象
   */
  async getCredentialById(id) {
    try {
      // 检查缓存
      if (this.cache.has(id)) {
        const cached = this.cache.get(id)
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.data
        }
      }

      const credential = await this.queryOne(
        'SELECT * FROM verifiable_credentials WHERE id = ?',
        [id]
      )

      if (!credential) {
        return null
      }

      const parsed = this.parseCredential(credential)

      // 检查并更新过期状态
      if (parsed.expires_at && Date.now() > parsed.expires_at && parsed.status === VC_STATUS.ACTIVE) {
        await this.execute(
          'UPDATE verifiable_credentials SET status = ?, updated_at = ? WHERE id = ?',
          [VC_STATUS.EXPIRED, Date.now(), id]
        )
        parsed.status = VC_STATUS.EXPIRED
      }

      // 缓存结果
      this.cache.set(id, {
        data: parsed,
        timestamp: Date.now()
      })

      return parsed
    } catch (error) {
      console.error('[VCManager] 获取凭证失败:', error)
      return null
    }
  }

  /**
   * 获取凭证列表
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 凭证列表
   */
  async getCredentials(filters = {}) {
    try {
      let sql = 'SELECT * FROM verifiable_credentials WHERE 1=1'
      const params = []

      if (filters.issuerDID) {
        sql += ' AND issuer_did = ?'
        params.push(filters.issuerDID)
      }

      if (filters.subjectDID) {
        sql += ' AND subject_did = ?'
        params.push(filters.subjectDID)
      }

      if (filters.type) {
        sql += ' AND type = ?'
        params.push(filters.type)
      }

      if (filters.status) {
        sql += ' AND status = ?'
        params.push(filters.status)
      }

      if (filters.limit) {
        sql += ' LIMIT ?'
        params.push(filters.limit)
      }

      if (filters.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }

      sql += ' ORDER BY created_at DESC'

      const credentials = await this.query(sql, params)
      return credentials.map(c => this.parseCredential(c))
    } catch (error) {
      console.error('[VCManager] 获取凭证列表失败:', error)
      return []
    }
  }

  /**
   * 撤销凭证
   * @param {string} id - 凭证 ID
   * @param {string} issuerDID - 颁发者 DID（用于验证权限）
   * @param {string} reason - 撤销原因
   * @returns {Promise<boolean>} 操作结果
   */
  async revokeCredential(id, issuerDID, reason = '') {
    try {
      const credential = await this.getCredentialById(id)

      if (!credential) {
        throw new Error('凭证不存在')
      }

      if (credential.issuer_did !== issuerDID) {
        throw new Error('只有颁发者可以撤销凭证')
      }

      if (credential.status === VC_STATUS.REVOKED) {
        throw new Error('凭证已被撤销')
      }

      const now = Date.now()

      await this.execute(
        'UPDATE verifiable_credentials SET status = ?, revoked_at = ?, revocation_reason = ?, updated_at = ? WHERE id = ?',
        [VC_STATUS.REVOKED, now, reason, now, id]
      )

      // 清除缓存
      this.cache.delete(id)
      this.invalidateCache()

      console.log('[VCManager] 凭证已撤销:', id)
      return true
    } catch (error) {
      console.error('[VCManager] 撤销凭证失败:', error)
      throw error
    }
  }

  /**
   * 删除凭证
   * @param {string} id - 凭证 ID
   * @returns {Promise<boolean>} 操作结果
   */
  async deleteCredential(id) {
    try {
      const credential = await this.getCredentialById(id)

      if (!credential) {
        throw new Error('凭证不存在')
      }

      await this.execute('DELETE FROM verifiable_credentials WHERE id = ?', [id])

      // 清除缓存
      this.cache.delete(id)
      this.invalidateCache()

      console.log('[VCManager] 凭证已删除:', id)
      return true
    } catch (error) {
      console.error('[VCManager] 删除凭证失败:', error)
      throw error
    }
  }

  /**
   * 导出凭证文档
   * @param {string} id - 凭证 ID
   * @returns {Promise<Object>} VC 文档
   */
  async exportCredential(id) {
    const credential = await this.getCredentialById(id)

    if (!credential) {
      throw new Error('凭证不存在')
    }

    return JSON.parse(credential.vc_document)
  }

  /**
   * 生成凭证分享数据
   * @param {string} id - 凭证 ID
   * @returns {Promise<Object>} 分享数据（包含二维码数据）
   */
  async generateShareData(id) {
    try {
      console.log('[VCManager] 生成凭证分享数据:', id)

      const credential = await this.getCredentialById(id)
      if (!credential) {
        throw new Error('凭证不存在')
      }

      // 导出完整的 VC 文档
      const vcDocument = JSON.parse(credential.vc_document)

      // 生成分享数据
      const shareData = {
        type: 'VerifiableCredential',
        version: '1.0',
        sharedAt: Date.now(),
        credential: vcDocument,
        metadata: {
          issuer: credential.issuer_did,
          subject: credential.subject_did,
          issuedAt: credential.issued_at,
          expiresAt: credential.expires_at,
          status: credential.status
        }
      }

      // 生成紧凑的 JSON 用于二维码（压缩）
      const compactData = {
        t: 'vc',
        v: '1.0',
        c: vcDocument
      }

      return {
        fullData: shareData,
        compactData,
        qrCodeData: JSON.stringify(compactData),
        shareUrl: `chainlesschain://vc/${id}`
      }
    } catch (error) {
      console.error('[VCManager] 生成分享数据失败:', error)
      throw error
    }
  }

  /**
   * 从分享数据导入凭证
   * @param {Object} shareData - 分享数据
   * @returns {Promise<Object>} 导入的凭证
   */
  async importFromShareData(shareData) {
    try {
      console.log('[VCManager] 从分享数据导入凭证')

      // 解析数据格式
      let vcDocument
      if (shareData.t === 'vc') {
        // 紧凑格式
        vcDocument = shareData.c
      } else if (shareData.type === 'VerifiableCredential') {
        // 完整格式
        vcDocument = shareData.credential
      } else {
        throw new Error('不支持的分享数据格式')
      }

      // 验证凭证
      const verification = await this.verifyCredential(vcDocument)
      if (!verification.isValid) {
        throw new Error(`凭证验证失败: ${verification.reason}`)
      }

      // 检查是否已存在
      const existing = await this.getCredentialById(vcDocument.id)
      if (existing) {
        throw new Error('凭证已存在')
      }

      // 解析凭证数据
      const issuerDID = vcDocument.issuer
      const subjectDID = vcDocument.credentialSubject.id
      const type = vcDocument.type.find(t => t !== 'VerifiableCredential')
      const claims = { ...vcDocument.credentialSubject }
      delete claims.id

      const issuedAt = new Date(vcDocument.issuanceDate).getTime()
      const expiresAt = vcDocument.expirationDate
        ? new Date(vcDocument.expirationDate).getTime()
        : null

      const now = Date.now()

      // 保存到数据库
      await this.execute(
        `INSERT INTO verifiable_credentials (
          id, type, issuer_did, subject_did, claims,
          vc_document, issued_at, expires_at, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vcDocument.id,
          type,
          issuerDID,
          subjectDID,
          JSON.stringify(claims),
          JSON.stringify(vcDocument),
          issuedAt,
          expiresAt,
          VC_STATUS.ACTIVE,
          now,
          now
        ]
      )

      // 清除缓存
      this.invalidateCache()

      console.log('[VCManager] 凭证已从分享数据导入:', vcDocument.id)

      return {
        id: vcDocument.id,
        type,
        issuer_did: issuerDID,
        subject_did: subjectDID,
        issued_at: issuedAt,
        expires_at: expiresAt
      }
    } catch (error) {
      console.error('[VCManager] 导入分享数据失败:', error)
      throw error
    }
  }

  /**
   * 获取统计信息
   * @param {string} did - DID（可选，用于筛选）
   * @returns {Promise<Object>} 统计信息
   */
  async getStatistics(did = null) {
    // 检查缓存
    const cacheKey = did || 'global'
    if (this.statsCache && this.statsCache[cacheKey]) {
      const cached = this.statsCache[cacheKey]
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.data
      }
    }

    try {
      let issuedQuery = 'SELECT COUNT(*) as count FROM verifiable_credentials WHERE 1=1'
      let receivedQuery = 'SELECT COUNT(*) as count FROM verifiable_credentials WHERE 1=1'
      const issuedParams = []
      const receivedParams = []

      if (did) {
        issuedQuery += ' AND issuer_did = ?'
        issuedParams.push(did)
        receivedQuery += ' AND subject_did = ?'
        receivedParams.push(did)
      }

      const issuedResult = await this.queryOne(issuedQuery, issuedParams)
      const receivedResult = await this.queryOne(receivedQuery, receivedParams)

      const issued = issuedResult?.count || 0
      const received = receivedResult?.count || 0

      // 按类型统计
      const typeQuery = did
        ? 'SELECT type, COUNT(*) as count FROM verifiable_credentials WHERE subject_did = ? GROUP BY type'
        : 'SELECT type, COUNT(*) as count FROM verifiable_credentials GROUP BY type'
      const typeParams = did ? [did] : []
      const typeResult = await this.query(typeQuery, typeParams)

      const byType = {}
      typeResult.forEach(row => {
        byType[row.type] = row.count
      })

      // 按状态统计
      const statusQuery = did
        ? 'SELECT status, COUNT(*) as count FROM verifiable_credentials WHERE subject_did = ? OR issuer_did = ? GROUP BY status'
        : 'SELECT status, COUNT(*) as count FROM verifiable_credentials GROUP BY status'
      const statusParams = did ? [did, did] : []
      const statusResult = await this.query(statusQuery, statusParams)

      const byStatus = {}
      statusResult.forEach(row => {
        byStatus[row.status] = row.count
      })

      const stats = {
        issued,
        received,
        total: issued + received,
        byType,
        byStatus
      }

      // 缓存结果
      if (!this.statsCache) {
        this.statsCache = {}
      }
      this.statsCache[cacheKey] = {
        data: stats,
        timestamp: Date.now()
      }

      return stats
    } catch (error) {
      console.error('[VCManager] 获取统计信息失败:', error)
      return {
        issued: 0,
        received: 0,
        total: 0,
        byType: {},
        byStatus: {}
      }
    }
  }

  /**
   * 搜索凭证
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 匹配的凭证列表
   */
  async searchCredentials(query, options = {}) {
    try {
      const lowerQuery = query.toLowerCase()

      const credentials = await this.getCredentials(options)

      return credentials.filter(credential => {
        const claims = JSON.parse(credential.claims)
        const claimsStr = JSON.stringify(claims).toLowerCase()

        return (
          credential.type.toLowerCase().includes(lowerQuery) ||
          credential.issuer_did.toLowerCase().includes(lowerQuery) ||
          credential.subject_did.toLowerCase().includes(lowerQuery) ||
          claimsStr.includes(lowerQuery)
        )
      })
    } catch (error) {
      console.error('[VCManager] 搜索凭证失败:', error)
      return []
    }
  }

  /**
   * 解析凭证对象（处理JSON字段）
   * @param {Object} credential - 原始凭证对象
   * @returns {Object} 解析后的凭证对象
   */
  parseCredential(credential) {
    return {
      ...credential,
      claims: credential.claims ? JSON.parse(credential.claims) : {},
      vc_document: credential.vc_document ? JSON.parse(credential.vc_document) : null
    }
  }

  /**
   * 清除缓存
   */
  invalidateCache() {
    this.statsCache = null
  }

  /**
   * 清除所有缓存
   */
  clearAllCache() {
    this.cache.clear()
    this.statsCache = null
  }

  // ============================================================
  // 数据库辅助方法
  // ============================================================

  /**
   * 执行SQL语句
   * @param {string} sql - SQL语句
   * @param {Array} params - 参数
   */
  execute(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.executeSql({
        sql,
        args: params,
        success: () => resolve(),
        fail: (err) => reject(err)
      })
    })
  }

  /**
   * 查询多行
   * @param {string} sql - SQL语句
   * @param {Array} params - 参数
   * @returns {Promise<Array>} 结果数组
   */
  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.selectSql({
        sql,
        args: params,
        success: (res) => resolve(res || []),
        fail: (err) => reject(err)
      })
    })
  }

  /**
   * 查询单行
   * @param {string} sql - SQL语句
   * @param {Array} params - 参数
   * @returns {Promise<Object|null>} 结果对象
   */
  async queryOne(sql, params = []) {
    const results = await this.query(sql, params)
    return results.length > 0 ? results[0] : null
  }
}

/**
 * 工厂函数：创建或获取VCManager实例（单例模式）
 */
let vcManagerInstance = null

export function createVCManager(db, didManager) {
  if (!vcManagerInstance) {
    vcManagerInstance = new VCManager(db, didManager)
  }
  return vcManagerInstance
}

export default VCManager
