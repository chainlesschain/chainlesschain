/**
 * DID (Decentralized Identity) 管理器
 *
 * 实现 W3C DID Core 标准
 * DID 格式: did:chainlesschain:<identifier>
 */

const { logger } = require("../utils/logger.js");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const bip39 = require("bip39");
const { DIDCache } = require("./did-cache");
const { DIDUpdater } = require("./did-updater");

/**
 * DID 配置
 */
const DEFAULT_CONFIG = {
  method: "chainlesschain", // DID 方法名
  version: "1.0", // DID 文档版本
  curve: "Ed25519", // 签名曲线
  encryptCurve: "X25519", // 加密曲线
};

/**
 * DID 管理器类
 */
class DIDManager extends EventEmitter {
  constructor(databaseManager, p2pManager = null, config = {}) {
    super();

    this.db = databaseManager;
    this.p2pManager = p2pManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentIdentity = null;

    // 初始化DID缓存
    this.cache = new DIDCache(databaseManager, config.cache);

    // 初始化DID更新器
    this.updater = new DIDUpdater(this, p2pManager, config.updater);

    // 自动重新发布配置 (已被updater替代，保留以兼容)
    this.autoRepublishTimer = null;
    this.autoRepublishEnabled = false;
    this.autoRepublishInterval = 24 * 60 * 60 * 1000; // 默认 24 小时
  }

  /**
   * 设置 P2P 管理器（用于延迟初始化）
   * @param {Object} p2pManager - P2P 管理器实例
   */
  setP2PManager(p2pManager) {
    this.p2pManager = p2pManager;
    logger.info("[DIDManager] P2P 管理器已设置");
  }

  /**
   * 初始化 DID 管理器
   */
  async initialize() {
    logger.info("[DIDManager] 初始化 DID 管理器...");

    try {
      // 确保数据库表存在
      await this.ensureTables();

      // 初始化DID缓存
      await this.cache.initialize();

      // 初始化DID更新器
      await this.updater.initialize();

      // 加载默认身份
      await this.loadDefaultIdentity();

      logger.info("[DIDManager] DID 管理器初始化成功");
      this.emit("initialized");

      return true;
    } catch (error) {
      logger.error("[DIDManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    // identities 表应该在数据库初始化时已创建
    // 这里只做检查
    try {
      const result = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='identities'",
        )
        .get();

      if (!result) {
        // 创建 identities 表
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS identities (
            did TEXT PRIMARY KEY,
            nickname TEXT,
            avatar_path TEXT,
            bio TEXT,
            public_key_sign TEXT NOT NULL,
            public_key_encrypt TEXT NOT NULL,
            private_key_ref TEXT NOT NULL,
            did_document TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            is_default INTEGER DEFAULT 0
          )
        `);
        logger.info("[DIDManager] identities 表已创建");
      }
    } catch (error) {
      logger.error("[DIDManager] 检查数据库表失败:", error);
      throw error;
    }
  }

  /**
   * 生成新的 DID 身份
   * @param {Object} profile - 用户资料 { nickname, bio, avatar }
   * @param {Object} options - 选项 { setAsDefault }
   * @returns {Promise<Object>} DID 身份对象
   */
  async createIdentity(profile = {}, options = {}) {
    logger.info("[DIDManager] 创建新身份...");

    try {
      // 1. 获取或生成密钥对
      let signKeyPair, encryptKeyPair;

      if (options.keys) {
        // 使用提供的密钥（如从助记词派生）
        signKeyPair = options.keys.sign;
        encryptKeyPair = options.keys.encrypt;
      } else {
        // 生成新密钥
        signKeyPair = nacl.sign.keyPair();
        encryptKeyPair = nacl.box.keyPair();
      }

      // 2. 生成 DID 标识符
      const did = this.generateDID(signKeyPair.publicKey);

      // 4. 创建 DID 文档
      const didDocument = this.createDIDDocument(did, {
        signPublicKey: signKeyPair.publicKey,
        encryptPublicKey: encryptKeyPair.publicKey,
        profile,
      });

      // 5. 签名 DID 文档
      const signedDocument = this.signDIDDocument(
        didDocument,
        signKeyPair.secretKey,
      );

      // 6. 存储到数据库
      const identity = {
        did,
        nickname: profile.nickname || "Anonymous",
        avatar_path: profile.avatar || null,
        bio: profile.bio || null,
        public_key_sign: naclUtil.encodeBase64(signKeyPair.publicKey),
        public_key_encrypt: naclUtil.encodeBase64(encryptKeyPair.publicKey),
        // 注意：这里暂时将私钥存储在数据库中（开发阶段）
        // 生产环境应该存储在 U 盾中，这里只存储引用
        private_key_ref: JSON.stringify({
          sign: naclUtil.encodeBase64(signKeyPair.secretKey),
          encrypt: naclUtil.encodeBase64(encryptKeyPair.secretKey),
          mnemonic: options.mnemonic || null, // 保存助记词（如果有）
        }),
        did_document: JSON.stringify(signedDocument),
        created_at: Date.now(),
        is_default: options.setAsDefault ? 1 : 0,
      };

      await this.saveIdentity(identity);

      // 如果设置为默认，更新其他身份的默认状态
      if (options.setAsDefault) {
        await this.setDefaultIdentity(did);
      }

      logger.info("[DIDManager] 新身份已创建:", did);
      this.emit("identity-created", { did, identity });

      return {
        did,
        nickname: identity.nickname,
        avatar: identity.avatar_path,
        bio: identity.bio,
        didDocument: signedDocument,
        createdAt: identity.created_at,
      };
    } catch (error) {
      logger.error("[DIDManager] 创建身份失败:", error);
      throw error;
    }
  }

  /**
   * 为组织创建 DID
   * @param {string} orgId - 组织ID
   * @param {string} orgName - 组织名称
   * @returns {Promise<string>} 组织DID
   */
  async createOrganizationDID(orgId, orgName) {
    logger.info("[DIDManager] 为组织创建DID:", orgName);

    try {
      // 1. 生成组织专用密钥对
      const signKeyPair = nacl.sign.keyPair();
      const encryptKeyPair = nacl.box.keyPair();

      // 2. 生成组织DID标识符（使用org前缀）
      const did = this.generateDID(signKeyPair.publicKey, "org");

      // 3. 创建组织DID文档
      const didDocument = this.createDIDDocument(did, {
        signPublicKey: signKeyPair.publicKey,
        encryptPublicKey: encryptKeyPair.publicKey,
        profile: {
          nickname: orgName,
          bio: `Organization DID for ${orgName}`,
          type: "organization",
          orgId: orgId,
        },
      });

      // 4. 签名DID文档
      const signedDocument = this.signDIDDocument(
        didDocument,
        signKeyPair.secretKey,
      );

      // 5. 存储到数据库
      const identity = {
        did,
        nickname: orgName,
        avatar_path: null,
        bio: `Organization: ${orgName}`,
        public_key_sign: naclUtil.encodeBase64(signKeyPair.publicKey),
        public_key_encrypt: naclUtil.encodeBase64(encryptKeyPair.publicKey),
        private_key_ref: JSON.stringify({
          sign: naclUtil.encodeBase64(signKeyPair.secretKey),
          encrypt: naclUtil.encodeBase64(encryptKeyPair.secretKey),
          orgId: orgId, // 关联组织ID
        }),
        did_document: JSON.stringify(signedDocument),
        created_at: Date.now(),
        is_default: 0, // 组织DID不能是默认身份
      };

      await this.saveIdentity(identity);

      logger.info("[DIDManager] ✓ 组织DID创建成功:", did);
      this.emit("organization-did-created", { did, orgId, orgName });

      return did;
    } catch (error) {
      logger.error("[DIDManager] 创建组织DID失败:", error);
      throw error;
    }
  }

  /**
   * 生成 DID 标识符
   * @param {Uint8Array} publicKey - 公钥
   * @param {string} prefix - 可选前缀（例如 'org' 用于组织）
   * @returns {string} DID 标识符
   */
  generateDID(publicKey, prefix = null) {
    // 使用公钥的 SHA-256 哈希的前 20 字节作为标识符
    const hash = crypto.createHash("sha256").update(publicKey).digest();
    const identifier = hash.slice(0, 20).toString("hex");

    // 如果有前缀，加上前缀（例如：did:chainlesschain:org:xxxxx）
    if (prefix) {
      return `did:${this.config.method}:${prefix}:${identifier}`;
    }

    return `did:${this.config.method}:${identifier}`;
  }

  /**
   * 创建 DID 文档
   * @param {string} did - DID 标识符
   * @param {Object} keys - 密钥信息
   * @returns {Object} DID 文档
   */
  createDIDDocument(did, keys) {
    const { signPublicKey, encryptPublicKey, profile } = keys;

    // 将公钥编码为 Base64
    const signKeyBase64 = naclUtil.encodeBase64(signPublicKey);
    const encryptKeyBase64 = naclUtil.encodeBase64(encryptPublicKey);

    return {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/ed25519-2020/v1",
      ],
      id: did,
      version: this.config.version,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),

      // 验证方法
      verificationMethod: [
        {
          id: `${did}#sign-key-1`,
          type: "Ed25519VerificationKey2020",
          controller: did,
          publicKeyBase64: signKeyBase64,
        },
        {
          id: `${did}#encrypt-key-1`,
          type: "X25519KeyAgreementKey2020",
          controller: did,
          publicKeyBase64: encryptKeyBase64,
        },
      ],

      // 认证方法（用于登录等）
      authentication: [`${did}#sign-key-1`],

      // 断言方法（用于签名声明）
      assertionMethod: [`${did}#sign-key-1`],

      // 密钥协商（用于加密通信）
      keyAgreement: [`${did}#encrypt-key-1`],

      // 服务端点（P2P 节点地址等）
      service: [
        {
          id: `${did}#p2p`,
          type: "P2PNode",
          serviceEndpoint: null, // 将在 P2P 功能实现后设置
        },
      ],

      // 用户资料（可选）
      profile: profile
        ? {
            nickname: profile.nickname,
            bio: profile.bio,
          }
        : undefined,
    };
  }

  /**
   * 签名 DID 文档
   * @param {Object} document - DID 文档
   * @param {Uint8Array} secretKey - 私钥
   * @returns {Object} 签名后的 DID 文档
   */
  signDIDDocument(document, secretKey) {
    // 将文档转换为规范 JSON 字符串
    const message = JSON.stringify(document);
    const messageBytes = naclUtil.decodeUTF8(message);

    // 使用 Ed25519 签名
    const signature = nacl.sign.detached(messageBytes, secretKey);
    const signatureBase64 = naclUtil.encodeBase64(signature);

    return {
      ...document,
      proof: {
        type: "Ed25519Signature2020",
        created: new Date().toISOString(),
        verificationMethod: `${document.id}#sign-key-1`,
        proofPurpose: "assertionMethod",
        proofValue: signatureBase64,
      },
    };
  }

  /**
   * 验证 DID 文档签名
   * @param {Object} signedDocument - 签名的 DID 文档
   * @returns {boolean} 验证结果
   */
  verifyDIDDocument(signedDocument) {
    try {
      const { proof, ...document } = signedDocument;

      if (!proof || !proof.proofValue) {
        throw new Error("缺少签名");
      }

      // 获取签名公钥
      const verificationMethod = document.verificationMethod.find(
        (vm) => vm.id === proof.verificationMethod,
      );

      if (!verificationMethod) {
        throw new Error("找不到验证方法");
      }

      // 解码公钥和签名
      const publicKey = naclUtil.decodeBase64(
        verificationMethod.publicKeyBase64,
      );
      const signature = naclUtil.decodeBase64(proof.proofValue);

      // 重建原始消息
      const message = JSON.stringify(document);
      const messageBytes = naclUtil.decodeUTF8(message);

      // 验证签名
      return nacl.sign.detached.verify(messageBytes, signature, publicKey);
    } catch (error) {
      logger.error("[DIDManager] 验证 DID 文档失败:", error);
      return false;
    }
  }

  /**
   * 保存身份到数据库
   * @param {Object} identity - 身份对象
   */
  async saveIdentity(identity) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO identities (
          did, nickname, avatar_path, bio,
          public_key_sign, public_key_encrypt, private_key_ref,
          did_document, created_at, is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          identity.did,
          identity.nickname,
          identity.avatar_path,
          identity.bio,
          identity.public_key_sign,
          identity.public_key_encrypt,
          identity.private_key_ref,
          identity.did_document,
          identity.created_at,
          identity.is_default,
        );

      this.db.saveToFile();
    } catch (error) {
      logger.error("[DIDManager] 保存身份失败:", error);
      throw error;
    }
  }

  /**
   * 获取所有身份
   * @returns {Array} 身份列表
   */
  getAllIdentities() {
    try {
      const result = this.db
        .prepare("SELECT * FROM identities ORDER BY created_at DESC")
        .all();

      if (!result || result.length === 0) {
        return [];
      }

      // Handle both sql.js format (columns/values) and better-sqlite3 format (objects)
      if (result[0] && result[0].values && result[0].columns) {
        const columns = result[0].columns;
        const rows = result[0].values;
        return rows.map((row) => {
          const identity = {};
          columns.forEach((col, index) => {
            identity[col] = row[index];
          });
          return identity;
        });
      }
      // better-sqlite3 format - result is array of objects
      return result;
    } catch (error) {
      logger.error("[DIDManager] 获取身份列表失败:", error);
      return [];
    }
  }

  /**
   * 根据 DID 获取身份
   * @param {string} did - DID 标识符
   * @returns {Object|null} 身份对象
   */
  getIdentityByDID(did) {
    try {
      const result = this.db
        .prepare("SELECT * FROM identities WHERE did = ?")
        .all([did]);

      if (!result || result.length === 0) {
        return null;
      }

      // Handle both sql.js format (columns/values) and better-sqlite3 format (objects)
      if (result[0] && result[0].values && result[0].columns) {
        if (result[0].values.length === 0) {
          return null;
        }
        const columns = result[0].columns;
        const row = result[0].values[0];
        const identity = {};
        columns.forEach((col, index) => {
          identity[col] = row[index];
        });
        return identity;
      }
      // better-sqlite3 format - result is array of objects
      return result[0];
    } catch (error) {
      logger.error("[DIDManager] 获取身份失败:", error);
      return null;
    }
  }

  /**
   * 设置默认身份
   * @param {string} did - DID 标识符
   */
  async setDefaultIdentity(did) {
    try {
      // 清除所有默认标记
      this.db.prepare("UPDATE identities SET is_default = 0").run();

      // 设置新的默认身份
      this.db
        .prepare("UPDATE identities SET is_default = 1 WHERE did = ?")
        .run([did]);

      this.db.saveToFile();

      // 更新当前身份
      this.currentIdentity = this.getIdentityByDID(did);

      logger.info("[DIDManager] 默认身份已更新:", did);
      this.emit("default-identity-changed", { did });
    } catch (error) {
      logger.error("[DIDManager] 设置默认身份失败:", error);
      throw error;
    }
  }

  /**
   * 加载默认身份
   */
  async loadDefaultIdentity() {
    try {
      const result = this.db
        .prepare("SELECT * FROM identities WHERE is_default = 1 LIMIT 1")
        .all();

      if (!result || result.length === 0) {
        logger.info("[DIDManager] 未找到默认身份");
        return;
      }

      // Handle both sql.js format (columns/values) and better-sqlite3 format (objects)
      let identity;
      if (result[0] && result[0].values && result[0].columns) {
        if (result[0].values.length === 0) {
          logger.info("[DIDManager] 未找到默认身份");
          return;
        }
        const columns = result[0].columns;
        const row = result[0].values[0];
        identity = {};
        columns.forEach((col, index) => {
          identity[col] = row[index];
        });
      } else {
        // better-sqlite3 format - result is array of objects
        identity = result[0];
      }

      this.currentIdentity = identity;
      logger.info("[DIDManager] 已加载默认身份:", identity.did);
    } catch (error) {
      logger.error("[DIDManager] 加载默认身份失败:", error);
    }
  }

  /**
   * 更新身份资料
   * @param {string} did - DID 标识符
   * @param {Object} updates - 更新内容 { nickname, bio, avatar }
   */
  async updateIdentityProfile(did, updates) {
    try {
      const identity = this.getIdentityByDID(did);

      if (!identity) {
        throw new Error("身份不存在");
      }

      // 更新数据库
      const fields = [];
      const values = [];

      if (updates.nickname !== undefined) {
        fields.push("nickname = ?");
        values.push(updates.nickname);
      }
      if (updates.bio !== undefined) {
        fields.push("bio = ?");
        values.push(updates.bio);
      }
      if (updates.avatar !== undefined) {
        fields.push("avatar_path = ?");
        values.push(updates.avatar);
      }

      if (fields.length === 0) {
        return identity;
      }

      values.push(did);

      this.db
        .prepare(`UPDATE identities SET ${fields.join(", ")} WHERE did = ?`)
        .run(values);

      this.db.saveToFile();

      // 更新 DID 文档中的资料
      const signedDocument = JSON.parse(identity.did_document);
      const { proof, ...didDocument } = signedDocument;

      if (didDocument.profile || updates.nickname || updates.bio) {
        didDocument.profile = {
          ...(didDocument.profile || {}),
          ...updates,
        };
        didDocument.updated = new Date().toISOString();

        // 重新签名文档
        // 需要获取私钥来签名
        if (identity.private_key) {
          try {
            const privateKeyBase64 = identity.private_key;
            const secretKey = naclUtil.decodeBase64(privateKeyBase64);

            // 使用 signDIDDocument 重新签名
            const resignedDocument = this.signDIDDocument(
              didDocument,
              secretKey,
            );

            // 更新数据库中的 DID 文档
            this.db
              .prepare(`UPDATE identities SET did_document = ? WHERE did = ?`)
              .run(JSON.stringify(resignedDocument), did);
            this.db.saveToFile();

            logger.info("[DIDManager] DID 文档已重新签名:", did);
          } catch (signError) {
            logger.warn(
              "[DIDManager] 重新签名失败，保留旧签名:",
              signError.message,
            );
          }
        } else {
          logger.warn("[DIDManager] 无法重新签名：私钥不可用");
        }
      }

      logger.info("[DIDManager] 身份资料已更新:", did);
      this.emit("identity-updated", { did, updates });

      return this.getIdentityByDID(did);
    } catch (error) {
      logger.error("[DIDManager] 更新身份资料失败:", error);
      throw error;
    }
  }

  /**
   * 删除身份
   * @param {string} did - DID 标识符
   */
  async deleteIdentity(did) {
    try {
      const identity = this.getIdentityByDID(did);

      if (!identity) {
        throw new Error("身份不存在");
      }

      // 不允许删除默认身份
      if (identity.is_default) {
        throw new Error("不能删除默认身份");
      }

      this.db.prepare("DELETE FROM identities WHERE did = ?").run([did]);
      this.db.saveToFile();

      logger.info("[DIDManager] 身份已删除:", did);
      this.emit("identity-deleted", { did });

      return true;
    } catch (error) {
      logger.error("[DIDManager] 删除身份失败:", error);
      throw error;
    }
  }

  /**
   * 导出 DID 文档
   * @param {string} did - DID 标识符
   * @returns {Object} DID 文档
   */
  exportDIDDocument(did) {
    const identity = this.getIdentityByDID(did);

    if (!identity) {
      throw new Error("身份不存在");
    }

    return JSON.parse(identity.did_document);
  }

  /**
   * 生成 DID 二维码数据
   * @param {string} did - DID 标识符
   * @returns {string} 二维码数据（JSON 字符串）
   */
  generateQRCodeData(did) {
    const identity = this.getIdentityByDID(did);

    if (!identity) {
      throw new Error("身份不存在");
    }

    return JSON.stringify({
      did: identity.did,
      nickname: identity.nickname,
      publicKeySign: identity.public_key_sign,
      publicKeyEncrypt: identity.public_key_encrypt,
    });
  }

  /**
   * 获取当前身份
   * @returns {Object|null} 当前身份
   */
  getCurrentIdentity() {
    return this.currentIdentity;
  }

  /**
   * 发布 DID 文档到 DHT 网络
   * @param {string} did - DID 标识符
   * @returns {Promise<Object>} 发布结果 { success, key, publishedAt }
   */
  async publishToDHT(did) {
    if (!this.p2pManager) {
      throw new Error("P2P 管理器未初始化，无法发布到 DHT");
    }

    if (!this.p2pManager.isInitialized()) {
      throw new Error("P2P 节点未初始化，无法发布到 DHT");
    }

    try {
      logger.info("[DIDManager] 发布 DID 到 DHT:", did);

      // 获取 DID 文档
      const identity = this.getIdentityByDID(did);
      if (!identity) {
        throw new Error("身份不存在");
      }

      const didDocument = JSON.parse(identity.did_document);

      // 准备发布数据（包含公开信息）
      const publishData = {
        did: identity.did,
        nickname: identity.nickname,
        publicKeySign: identity.public_key_sign,
        publicKeyEncrypt: identity.public_key_encrypt,
        didDocument: didDocument,
        publishedAt: Date.now(),
      };

      // 发布到 DHT
      // DHT key 格式: /did/chainlesschain/<identifier>
      const dhtKey = `/did/${this.config.method}/${did.split(":")[2]}`;
      await this.p2pManager.dhtPut(
        dhtKey,
        Buffer.from(JSON.stringify(publishData)),
      );

      logger.info("[DIDManager] DID 已发布到 DHT:", dhtKey);
      this.emit("did-published", {
        did,
        dhtKey,
        publishedAt: publishData.publishedAt,
      });

      return {
        success: true,
        key: dhtKey,
        publishedAt: publishData.publishedAt,
      };
    } catch (error) {
      logger.error("[DIDManager] 发布 DID 到 DHT 失败:", error);
      throw error;
    }
  }

  /**
   * 从 DHT 网络解析 DID 文档
   * @param {string} did - DID 标识符
   * @returns {Promise<Object>} DID 文档数据
   */
  async resolveFromDHT(did) {
    if (!this.p2pManager) {
      throw new Error("P2P 管理器未初始化，无法从 DHT 解析");
    }

    if (!this.p2pManager.isInitialized()) {
      throw new Error("P2P 节点未初始化，无法从 DHT 解析");
    }

    try {
      logger.info("[DIDManager] 从 DHT 解析 DID:", did);

      // 1. 先尝试从缓存获取
      const cachedDoc = await this.cache.get(did);
      if (cachedDoc) {
        logger.info("[DIDManager] 从缓存获取 DID:", did);
        return cachedDoc;
      }

      // 2. 缓存未命中，从DHT获取
      // 构建 DHT key
      const didParts = did.split(":");
      if (
        didParts.length !== 3 ||
        didParts[0] !== "did" ||
        didParts[1] !== this.config.method
      ) {
        throw new Error("无效的 DID 格式");
      }

      const dhtKey = `/did/${didParts[1]}/${didParts[2]}`;

      // 从 DHT 获取数据
      const data = await this.p2pManager.dhtGet(dhtKey);

      if (!data) {
        throw new Error("未在 DHT 中找到该 DID");
      }

      // 解析数据
      const publishData = JSON.parse(data.toString());

      // 验证 DID 文档签名
      const isValid = this.verifyDIDDocument(publishData.didDocument);
      if (!isValid) {
        throw new Error("DID 文档签名验证失败");
      }

      // 3. 缓存DID文档
      await this.cache.set(did, publishData);

      logger.info("[DIDManager] 成功从 DHT 解析 DID:", did);
      this.emit("did-resolved", { did, data: publishData });

      return publishData;
    } catch (error) {
      logger.error("[DIDManager] 从 DHT 解析 DID 失败:", error);
      throw error;
    }
  }

  /**
   * 从 DHT 网络取消发布 DID
   * @param {string} did - DID 标识符
   * @returns {Promise<Object>} 取消发布结果
   */
  async unpublishFromDHT(did) {
    if (!this.p2pManager) {
      throw new Error("P2P 管理器未初始化");
    }

    if (!this.p2pManager.isInitialized()) {
      throw new Error("P2P 节点未初始化");
    }

    try {
      logger.info("[DIDManager] 从 DHT 取消发布 DID:", did);

      // 构建 DHT key
      const didParts = did.split(":");
      const dhtKey = `/did/${didParts[1]}/${didParts[2]}`;

      // 发布空数据表示删除（DHT 的标准做法）
      await this.p2pManager.dhtPut(
        dhtKey,
        Buffer.from(JSON.stringify({ deleted: true, deletedAt: Date.now() })),
      );

      logger.info("[DIDManager] DID 已从 DHT 取消发布:", dhtKey);
      this.emit("did-unpublished", { did, dhtKey });

      return {
        success: true,
        key: dhtKey,
      };
    } catch (error) {
      logger.error("[DIDManager] 从 DHT 取消发布失败:", error);
      throw error;
    }
  }

  /**
   * 检查 DID 是否已发布到 DHT
   * @param {string} did - DID 标识符
   * @returns {Promise<boolean>} 是否已发布
   */
  async isPublishedToDHT(did) {
    try {
      const data = await this.resolveFromDHT(did);
      return data && !data.deleted;
    } catch (error) {
      return false;
    }
  }

  /**
   * 启动自动重新发布
   * @param {number} interval - 重新发布间隔（毫秒），默认 24 小时
   */
  startAutoRepublish(interval = null) {
    if (interval) {
      this.autoRepublishInterval = interval;
    }

    // 如果已经启动，先停止
    if (this.autoRepublishTimer) {
      this.stopAutoRepublish();
    }

    logger.info(
      `[DIDManager] 启动自动重新发布，间隔: ${this.autoRepublishInterval / 1000 / 60} 分钟`,
    );

    this.autoRepublishEnabled = true;

    // 立即执行一次重新发布
    this.republishAllDIDs().catch((error) => {
      logger.error("[DIDManager] 初始重新发布失败:", error);
    });

    // 设置定时器
    this.autoRepublishTimer = setInterval(async () => {
      try {
        await this.republishAllDIDs();
      } catch (error) {
        logger.error("[DIDManager] 自动重新发布失败:", error);
      }
    }, this.autoRepublishInterval);

    this.emit("auto-republish-started", {
      interval: this.autoRepublishInterval,
    });
  }

  /**
   * 停止自动重新发布
   */
  stopAutoRepublish() {
    if (this.autoRepublishTimer) {
      clearInterval(this.autoRepublishTimer);
      this.autoRepublishTimer = null;
      this.autoRepublishEnabled = false;

      logger.info("[DIDManager] 停止自动重新发布");
      this.emit("auto-republish-stopped");
    }
  }

  /**
   * 重新发布所有已发布的 DID
   * @returns {Promise<Object>} 重新发布结果
   */
  async republishAllDIDs() {
    if (!this.p2pManager || !this.p2pManager.isInitialized()) {
      logger.info("[DIDManager] P2P 未初始化，跳过重新发布");
      return {
        success: 0,
        failed: 0,
        skipped: 0,
      };
    }

    logger.info("[DIDManager] 开始重新发布所有 DID...");

    const result = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    try {
      // 获取所有身份
      const identities = this.getAllIdentities();

      for (const identity of identities) {
        try {
          // 检查是否已发布到 DHT
          const isPublished = await this.isPublishedToDHT(identity.did);

          if (!isPublished) {
            logger.info(`[DIDManager] DID ${identity.did} 未发布，跳过`);
            result.skipped++;
            continue;
          }

          // 重新发布
          await this.publishToDHT(identity.did);
          result.success++;

          logger.info(`[DIDManager] 成功重新发布 DID: ${identity.did}`);
        } catch (error) {
          logger.error(
            `[DIDManager] 重新发布 DID 失败: ${identity.did}`,
            error,
          );
          result.failed++;
          result.errors.push({
            did: identity.did,
            error: error.message,
          });
        }
      }

      logger.info("[DIDManager] 重新发布完成:", result);
      this.emit("dids-republished", result);

      return result;
    } catch (error) {
      logger.error("[DIDManager] 重新发布所有 DID 失败:", error);
      throw error;
    }
  }

  /**
   * 获取自动重新发布状态
   * @returns {Object} 状态信息
   */
  getAutoRepublishStatus() {
    return {
      enabled: this.autoRepublishEnabled,
      interval: this.autoRepublishInterval,
      intervalHours: this.autoRepublishInterval / 1000 / 60 / 60,
    };
  }

  /**
   * 设置自动重新发布间隔
   * @param {number} interval - 间隔（毫秒）
   */
  setAutoRepublishInterval(interval) {
    this.autoRepublishInterval = interval;

    // 如果正在运行，重新启动以应用新间隔
    if (this.autoRepublishEnabled) {
      this.startAutoRepublish();
    }

    logger.info(
      `[DIDManager] 自动重新发布间隔已设置为: ${interval / 1000 / 60 / 60} 小时`,
    );
  }

  /**
   * 生成助记词
   * @param {number} strength - 强度（默认 256 位，24 个单词）
   * @returns {string} 助记词
   */
  generateMnemonic(strength = 256) {
    return bip39.generateMnemonic(strength);
  }

  /**
   * 验证助记词
   * @param {string} mnemonic - 助记词
   * @returns {boolean} 是否有效
   */
  validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(mnemonic);
  }

  /**
   * 从助记词派生密钥对
   * @param {string} mnemonic - 助记词
   * @param {number} index - 派生索引（默认 0）
   * @returns {Object} 密钥对
   */
  deriveKeysFromMnemonic(mnemonic, index = 0) {
    // 验证助记词
    if (!this.validateMnemonic(mnemonic)) {
      throw new Error("无效的助记词");
    }

    // 从助记词生成种子
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    // 使用种子和索引派生密钥
    // 使用简单的派生：SHA-256(seed + index)
    const derivationPath = Buffer.concat([seed, Buffer.from([index])]);
    const hash = crypto.createHash("sha256").update(derivationPath).digest();

    // 生成 Ed25519 签名密钥对
    const signKeyPair = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));

    // 生成 X25519 加密密钥对（从签名密钥转换）
    const encryptKeyPair = {
      publicKey: nacl.box.keyPair.fromSecretKey(hash.slice(0, 32)).publicKey,
      secretKey: hash.slice(0, 32),
    };

    return {
      sign: {
        publicKey: signKeyPair.publicKey,
        secretKey: signKeyPair.secretKey,
      },
      encrypt: {
        publicKey: encryptKeyPair.publicKey,
        secretKey: encryptKeyPair.secretKey,
      },
    };
  }

  /**
   * 使用助记词创建身份
   * @param {Object} profile - 身份资料
   * @param {string} mnemonic - 助记词
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 创建的身份
   */
  async createIdentityFromMnemonic(profile, mnemonic, options = {}) {
    logger.info("[DIDManager] 使用助记词创建身份...");

    try {
      // 验证助记词
      if (!this.validateMnemonic(mnemonic)) {
        throw new Error("无效的助记词");
      }

      // 从助记词派生密钥
      const keys = this.deriveKeysFromMnemonic(mnemonic, options.index || 0);

      // 使用派生的密钥创建身份（不自动生成密钥）
      const identity = await this.createIdentity(profile, {
        ...options,
        keys,
        mnemonic: mnemonic, // 保存助记词（加密存储）
      });

      logger.info("[DIDManager] 身份已从助记词创建:", identity.did);

      return identity;
    } catch (error) {
      logger.error("[DIDManager] 从助记词创建身份失败:", error);
      throw error;
    }
  }

  /**
   * 从身份导出助记词
   * @param {string} did - DID 标识符
   * @returns {string|null} 助记词（如果存在）
   */
  exportMnemonic(did) {
    try {
      const identity = this.getIdentityByDID(did);

      if (!identity) {
        throw new Error("身份不存在");
      }

      // 解析私钥引用
      const privateKeyRef = JSON.parse(identity.private_key_ref);

      // 返回助记词（如果有）
      return privateKeyRef.mnemonic || null;
    } catch (error) {
      logger.error("[DIDManager] 导出助记词失败:", error);
      throw error;
    }
  }

  /**
   * 检查身份是否有助记词备份
   * @param {string} did - DID 标识符
   * @returns {boolean} 是否有助记词
   */
  hasMnemonic(did) {
    try {
      const mnemonic = this.exportMnemonic(did);
      return !!mnemonic;
    } catch (error) {
      return false;
    }
  }

  /**
   * 关闭管理器
   */
  async close() {
    logger.info("[DIDManager] 关闭 DID 管理器");

    // 停止自动重新发布
    this.stopAutoRepublish();

    this.currentIdentity = null;
    this.emit("closed");
  }
}

module.exports = DIDManager;
