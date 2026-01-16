/**
 * 可验证凭证 (Verifiable Credentials) 管理器
 *
 * 实现 W3C Verifiable Credentials 标准
 * 支持凭证类型：
 * - SelfDeclaration: 自我声明
 * - SkillCertificate: 技能证书
 * - TrustEndorsement: 信任背书
 * - EducationCredential: 教育凭证
 * - WorkExperience: 工作经历
 */

const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

/**
 * VC 类型常量
 */
const VC_TYPES = {
  SELF_DECLARATION: 'SelfDeclaration',
  SKILL_CERTIFICATE: 'SkillCertificate',
  TRUST_ENDORSEMENT: 'TrustEndorsement',
  EDUCATION_CREDENTIAL: 'EducationCredential',
  WORK_EXPERIENCE: 'WorkExperience',
};

/**
 * VC 状态常量
 */
const VC_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

/**
 * VC 管理器类
 */
class VCManager extends EventEmitter {
  constructor(databaseManager, didManager) {
    super();

    this.db = databaseManager;
    this.didManager = didManager;
  }

  /**
   * 初始化 VC 管理器
   */
  async initialize() {
    console.log('[VCManager] 初始化可验证凭证管理器...');

    try {
      // 确保数据库表存在
      await this.ensureTables();

      console.log('[VCManager] 可验证凭证管理器初始化成功');
      this.emit('initialized');

      return true;
    } catch (error) {
      console.error('[VCManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    try {
      const result = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='verifiable_credentials'"
      ).all();

      if (!result || result.length === 0) {
        // 创建可验证凭证表
        this.db.exec(`
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
            created_at INTEGER NOT NULL
          )
        `);

        // 创建索引
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_vc_issuer ON verifiable_credentials(issuer_did);
          CREATE INDEX IF NOT EXISTS idx_vc_subject ON verifiable_credentials(subject_did);
          CREATE INDEX IF NOT EXISTS idx_vc_type ON verifiable_credentials(type);
          CREATE INDEX IF NOT EXISTS idx_vc_status ON verifiable_credentials(status);
        `);

        console.log('[VCManager] verifiable_credentials 表已创建');
      }
    } catch (error) {
      console.error('[VCManager] 检查数据库表失败:', error);
      throw error;
    }
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
    const { type, issuerDID, subjectDID, claims, expiresIn } = params;

    console.log('[VCManager] 创建可验证凭证:', { type, issuerDID, subjectDID });

    try {
      // 验证颁发者身份
      const issuer = this.didManager.getIdentityByDID(issuerDID);
      if (!issuer) {
        throw new Error('颁发者身份不存在');
      }

      // 生成 VC ID
      const vcId = `urn:uuid:${uuidv4()}`;

      // 当前时间
      const now = Date.now();
      const issuanceDate = new Date(now).toISOString();

      // 过期时间
      let expirationDate = null;
      let expiresAt = null;
      if (expiresIn) {
        expiresAt = now + expiresIn;
        expirationDate = new Date(expiresAt).toISOString();
      }

      // 构建凭证主体
      const credentialSubject = {
        id: subjectDID,
        ...claims,
      };

      // 创建 VC 文档
      const vcDocument = {
        '@context': [
          'https://www.w3.org/2018/credentials/v1',
          'https://chainlesschain.com/credentials/v1',
        ],
        id: vcId,
        type: ['VerifiableCredential', type],
        issuer: issuerDID,
        issuanceDate,
        expirationDate,
        credentialSubject,
      };

      // 签名 VC 文档
      const signedVC = await this.signCredential(vcDocument, issuer);

      // 保存到数据库
      const vcRecord = {
        id: vcId,
        type,
        issuer_did: issuerDID,
        subject_did: subjectDID,
        claims: JSON.stringify(claims),
        vc_document: JSON.stringify(signedVC),
        issued_at: now,
        expires_at: expiresAt,
        status: VC_STATUS.ACTIVE,
        created_at: now,
      };

      await this.saveCredential(vcRecord);

      console.log('[VCManager] 可验证凭证已创建:', vcId);
      this.emit('credential-created', { id: vcId, type, issuerDID, subjectDID });

      return {
        id: vcId,
        type,
        issuer: issuerDID,
        subject: subjectDID,
        claims,
        issuedAt: now,
        expiresAt,
        status: VC_STATUS.ACTIVE,
        document: signedVC,
      };
    } catch (error) {
      console.error('[VCManager] 创建可验证凭证失败:', error);
      throw error;
    }
  }

  /**
   * 签名 VC 文档
   * @param {Object} vcDocument - VC 文档
   * @param {Object} issuerIdentity - 颁发者身份
   * @returns {Object} 签名后的 VC 文档
   */
  async signCredential(vcDocument, issuerIdentity) {
    try {
      // 将文档转换为规范 JSON 字符串
      const message = JSON.stringify(vcDocument);
      const messageBytes = naclUtil.decodeUTF8(message);

      // 获取颁发者私钥
      const privateKeyRef = JSON.parse(issuerIdentity.private_key_ref);
      const secretKey = naclUtil.decodeBase64(privateKeyRef.sign);

      // 使用 Ed25519 签名
      const signature = nacl.sign.detached(messageBytes, secretKey);
      const signatureBase64 = naclUtil.encodeBase64(signature);

      // 添加证明
      return {
        ...vcDocument,
        proof: {
          type: 'Ed25519Signature2020',
          created: new Date().toISOString(),
          verificationMethod: `${issuerIdentity.did}#sign-key-1`,
          proofPurpose: 'assertionMethod',
          proofValue: signatureBase64,
        },
      };
    } catch (error) {
      console.error('[VCManager] 签名 VC 文档失败:', error);
      throw error;
    }
  }

  /**
   * 验证 VC 文档签名
   * @param {Object} signedVC - 签名的 VC 文档
   * @returns {Promise<boolean>} 验证结果
   */
  async verifyCredential(signedVC) {
    try {
      const { proof, ...vcDocument } = signedVC;

      if (!proof || !proof.proofValue) {
        throw new Error('缺少签名');
      }

      // 获取颁发者 DID
      const issuerDID = vcDocument.issuer;

      // 尝试从本地获取颁发者身份
      let issuerIdentity = this.didManager.getIdentityByDID(issuerDID);

      // 如果本地没有，尝试从 DHT 解析
      if (!issuerIdentity) {
        console.log('[VCManager] 本地未找到颁发者身份，尝试从 DHT 解析...');
        try {
          const dhtData = await this.didManager.resolveFromDHT(issuerDID);
          issuerIdentity = {
            did: dhtData.did,
            public_key_sign: dhtData.publicKeySign,
          };
        } catch (error) {
          throw new Error('无法解析颁发者 DID');
        }
      }

      // 解码公钥和签名
      const publicKey = naclUtil.decodeBase64(issuerIdentity.public_key_sign);
      const signature = naclUtil.decodeBase64(proof.proofValue);

      // 重建原始消息
      const message = JSON.stringify(vcDocument);
      const messageBytes = naclUtil.decodeUTF8(message);

      // 验证签名
      const isValid = nacl.sign.detached.verify(messageBytes, signature, publicKey);

      // 检查是否过期
      if (isValid && vcDocument.expirationDate) {
        const expirationTime = new Date(vcDocument.expirationDate).getTime();
        if (Date.now() > expirationTime) {
          console.log('[VCManager] VC 已过期');
          return false;
        }
      }

      return isValid;
    } catch (error) {
      console.error('[VCManager] 验证 VC 文档失败:', error);
      return false;
    }
  }

  /**
   * 保存凭证到数据库
   * @param {Object} vcRecord - 凭证记录
   */
  async saveCredential(vcRecord) {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO verifiable_credentials (
          id, type, issuer_did, subject_did, claims,
          vc_document, issued_at, expires_at, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        vcRecord.id,
        vcRecord.type,
        vcRecord.issuer_did,
        vcRecord.subject_did,
        vcRecord.claims,
        vcRecord.vc_document,
        vcRecord.issued_at,
        vcRecord.expires_at,
        vcRecord.status,
        vcRecord.created_at
      );

      this.db.saveToFile();
    } catch (error) {
      console.error('[VCManager] 保存凭证失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有凭证
   * @param {Object} filters - 过滤条件
   * @returns {Array} 凭证列表
   */
  getCredentials(filters = {}) {
    try {
      let query = 'SELECT * FROM verifiable_credentials WHERE 1=1';
      const params = [];

      if (filters.issuerDID) {
        query += ' AND issuer_did = ?';
        params.push(filters.issuerDID);
      }

      if (filters.subjectDID) {
        query += ' AND subject_did = ?';
        params.push(filters.subjectDID);
      }

      if (filters.type) {
        query += ' AND type = ?';
        params.push(filters.type);
      }

      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }

      query += ' ORDER BY created_at DESC';

      const result = this.db.prepare(query).all(params);

      if (!result || result.length === 0 || !result[0].values) {
        return [];
      }

      const columns = result[0].columns;
      const rows = result[0].values;

      return rows.map((row) => {
        const credential = {};
        columns.forEach((col, index) => {
          credential[col] = row[index];
        });
        return credential;
      });
    } catch (error) {
      console.error('[VCManager] 获取凭证列表失败:', error);
      return [];
    }
  }

  /**
   * 根据 ID 获取凭证
   * @param {string} id - 凭证 ID
   * @returns {Object|null} 凭证对象
   */
  getCredentialById(id) {
    try {
      const result = this.db.prepare('SELECT * FROM verifiable_credentials WHERE id = ?').all([id]);

      if (!result || result.length === 0 || !result[0].values || result[0].values.length === 0) {
        return null;
      }

      const columns = result[0].columns;
      const row = result[0].values[0];

      const credential = {};
      columns.forEach((col, index) => {
        credential[col] = row[index];
      });

      return credential;
    } catch (error) {
      console.error('[VCManager] 获取凭证失败:', error);
      return null;
    }
  }

  /**
   * 撤销凭证
   * @param {string} id - 凭证 ID
   * @param {string} issuerDID - 颁发者 DID（用于验证权限）
   * @returns {Promise<boolean>} 操作结果
   */
  async revokeCredential(id, issuerDID) {
    try {
      const credential = this.getCredentialById(id);

      if (!credential) {
        throw new Error('凭证不存在');
      }

      if (credential.issuer_did !== issuerDID) {
        throw new Error('只有颁发者可以撤销凭证');
      }

      this.db.prepare('UPDATE verifiable_credentials SET status = ? WHERE id = ?').run([VC_STATUS.REVOKED, id]);

      this.db.saveToFile();

      console.log('[VCManager] 凭证已撤销:', id);
      this.emit('credential-revoked', { id, issuerDID });

      return true;
    } catch (error) {
      console.error('[VCManager] 撤销凭证失败:', error);
      throw error;
    }
  }

  /**
   * 删除凭证
   * @param {string} id - 凭证 ID
   * @returns {Promise<boolean>} 操作结果
   */
  async deleteCredential(id) {
    try {
      const credential = this.getCredentialById(id);

      if (!credential) {
        throw new Error('凭证不存在');
      }

      this.db.prepare('DELETE FROM verifiable_credentials WHERE id = ?').run([id]);
      this.db.saveToFile();

      console.log('[VCManager] 凭证已删除:', id);
      this.emit('credential-deleted', { id });

      return true;
    } catch (error) {
      console.error('[VCManager] 删除凭证失败:', error);
      throw error;
    }
  }

  /**
   * 导出凭证文档
   * @param {string} id - 凭证 ID
   * @returns {Object} VC 文档
   */
  exportCredential(id) {
    const credential = this.getCredentialById(id);

    if (!credential) {
      throw new Error('凭证不存在');
    }

    return JSON.parse(credential.vc_document);
  }

  /**
   * 获取统计信息
   * @param {string} did - DID（可选，用于筛选）
   * @returns {Object} 统计信息
   */
  getStatistics(did = null) {
    try {
      let issuedQuery = 'SELECT COUNT(*) as count FROM verifiable_credentials WHERE 1=1';
      let receivedQuery = 'SELECT COUNT(*) as count FROM verifiable_credentials WHERE 1=1';
      const issuedParams = [];
      const receivedParams = [];

      if (did) {
        issuedQuery += ' AND issuer_did = ?';
        issuedParams.push(did);
        receivedQuery += ' AND subject_did = ?';
        receivedParams.push(did);
      }

      const issuedResult = this.db.prepare(issuedQuery).all(issuedParams);
      const receivedResult = this.db.prepare(receivedQuery).all(receivedParams);

      const issued = issuedResult?.[0]?.values?.[0]?.[0] || 0;
      const received = receivedResult?.[0]?.values?.[0]?.[0] || 0;

      // 按类型统计
      const typeQuery = did
        ? 'SELECT type, COUNT(*) as count FROM verifiable_credentials WHERE subject_did = ? GROUP BY type'
        : 'SELECT type, COUNT(*) as count FROM verifiable_credentials GROUP BY type';
      const typeParams = did ? [did] : [];
      const typeResult = this.db.prepare(typeQuery).all(...typeParams);

      const byType = {};
      if (typeResult && typeResult[0] && typeResult[0].values) {
        typeResult[0].values.forEach(([type, count]) => {
          byType[type] = count;
        });
      }

      return {
        issued,
        received,
        total: issued + received,
        byType,
      };
    } catch (error) {
      console.error('[VCManager] 获取统计信息失败:', error);
      return {
        issued: 0,
        received: 0,
        total: 0,
        byType: {},
      };
    }
  }

  /**
   * 生成凭证分享数据
   * @param {string} id - 凭证 ID
   * @returns {Promise<Object>} 分享数据（包含二维码数据）
   */
  async generateShareData(id) {
    try {
      console.log('[VCManager] 生成凭证分享数据:', id);

      const credential = this.getCredentialById(id);
      if (!credential) {
        throw new Error('凭证不存在');
      }

      // 导出完整的 VC 文档
      const vcDocument = JSON.parse(credential.vc_document);

      // 生成分享数据
      const shareData = {
        type: 'VerifiableCredential',
        version: '1.0',
        sharedAt: Date.now(),
        credential: vcDocument,
        // 添加元数据
        metadata: {
          issuer: credential.issuer_did,
          subject: credential.subject_did,
          issuedAt: credential.issued_at,
          expiresAt: credential.expires_at,
          status: credential.status,
        },
      };

      // 生成紧凑的 JSON 用于二维码（压缩）
      const compactData = {
        t: 'vc',  // type
        v: '1.0', // version
        c: vcDocument,  // credential
      };

      return {
        fullData: shareData,
        compactData,
        qrCodeData: JSON.stringify(compactData),
        shareUrl: `chainlesschain://vc/${id}`,  // 自定义协议
      };
    } catch (error) {
      console.error('[VCManager] 生成分享数据失败:', error);
      throw error;
    }
  }

  /**
   * 从分享数据导入凭证
   * @param {Object} shareData - 分享数据
   * @returns {Promise<Object>} 导入的凭证
   */
  async importFromShareData(shareData) {
    try {
      console.log('[VCManager] 从分享数据导入凭证');

      // 解析数据格式
      let vcDocument;
      if (shareData.t === 'vc') {
        // 紧凑格式
        vcDocument = shareData.c;
      } else if (shareData.type === 'VerifiableCredential') {
        // 完整格式
        vcDocument = shareData.credential;
      } else {
        throw new Error('不支持的分享数据格式');
      }

      // 验证凭证
      const isValid = await this.verifyCredential(vcDocument);
      if (!isValid) {
        throw new Error('凭证验证失败：签名无效或已过期');
      }

      // 检查是否已存在
      const existing = this.getCredentialById(vcDocument.id);
      if (existing) {
        throw new Error('凭证已存在');
      }

      // 解析凭证数据
      const issuerDID = vcDocument.issuer;
      const subjectDID = vcDocument.credentialSubject.id;
      const type = vcDocument.type.find(t => t !== 'VerifiableCredential');
      const claims = { ...vcDocument.credentialSubject };
      delete claims.id;  // 移除 id 字段

      const issuedAt = new Date(vcDocument.issuanceDate).getTime();
      const expiresAt = vcDocument.expirationDate
        ? new Date(vcDocument.expirationDate).getTime()
        : null;

      // 保存到数据库
      const vcRecord = {
        id: vcDocument.id,
        type,
        issuer_did: issuerDID,
        subject_did: subjectDID,
        claims: JSON.stringify(claims),
        vc_document: JSON.stringify(vcDocument),
        issued_at: issuedAt,
        expires_at: expiresAt,
        status: VC_STATUS.ACTIVE,
        created_at: Date.now(),
      };

      await this.saveCredential(vcRecord);

      console.log('[VCManager] 凭证已从分享数据导入:', vcDocument.id);
      this.emit('credential-imported', vcDocument.id);

      return {
        id: vcDocument.id,
        type,
        issuer_did: issuerDID,
        subject_did: subjectDID,
        issued_at: issuedAt,
        expires_at: expiresAt,
      };
    } catch (error) {
      console.error('[VCManager] 导入分享数据失败:', error);
      throw error;
    }
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log('[VCManager] 关闭可验证凭证管理器');
    this.emit('closed');
  }
}

// 导出常量和类
module.exports = {
  VCManager,
  VC_TYPES,
  VC_STATUS,
};
