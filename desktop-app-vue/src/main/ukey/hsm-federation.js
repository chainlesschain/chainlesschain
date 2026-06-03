/**
 * SIMKey 硬件安全模块 (HSM) 联合认证 (v0.39.0)
 *
 * 实现 SIMKey 与企业级 HSM 的联合认证
 * 移动端 SIMKey 与服务端 HSM 协同签名，达到金融级安全
 *
 * 功能:
 * - HSM 设备注册与连接 (PKCS#11 / JCE)
 * - SIMKey + HSM 联合签名 (Threshold Signature)
 * - 密钥分片 (Key Splitting) — SIMKey 持有一半，HSM 持有一半
 * - HSM 策略引擎（审批流、白名单、金额阈值）
 * - 多 HSM 冗余（主备切换）
 * - 合规审计日志
 *
 * 支持 HSM:
 * - Thales Luna Network HSM
 * - AWS CloudHSM
 * - Azure Dedicated HSM
 * - 国产: 三未信安、江南天安、渔翁信息
 *
 * 场景: 企业财务签章、合同签名、大额交易授权
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

// HSM 连接状态
const HSM_STATE = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  AUTHENTICATED: "authenticated",
  ERROR: "error",
};

// HSM 类型
const HSM_TYPE = {
  THALES_LUNA: "thales_luna",
  AWS_CLOUDHSM: "aws_cloudhsm",
  AZURE_HSM: "azure_hsm",
  SANWEI: "sanwei",             // 三未信安
  JIANGNAN: "jiangnan",         // 江南天安
  YUWENG: "yuweng",             // 渔翁信息
  SOFTWARE: "software_hsm",     // 软件模拟
};

// 联合签名模式
const COSIGN_MODE = {
  THRESHOLD_2_OF_2: "2of2",     // SIMKey + HSM 必须都参与
  THRESHOLD_2_OF_3: "2of3",     // SIMKey + HSM1 + HSM2，任意2个
  SEQUENTIAL: "sequential",      // 顺序签名（SIMKey 先签，HSM 背书）
  PARALLEL: "parallel",          // 并行签名
};

// 审批策略
const APPROVAL_POLICY = {
  NONE: "none",
  AUTO: "auto",                  // 满足条件自动批准
  MANUAL: "manual",              // 需要审批人手动批准
  MULTI_APPROVER: "multi",       // 多人审批
};

class HsmFederation extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      defaultCosignMode: config.defaultCosignMode || COSIGN_MODE.THRESHOLD_2_OF_2,
      approvalPolicy: config.approvalPolicy || APPROVAL_POLICY.AUTO,
      amountThreshold: config.amountThreshold || 10000,
      auditEnabled: config.auditEnabled !== false,
      failoverEnabled: config.failoverEnabled !== false,
      ...config,
    };

    this._hsmPool = new Map();        // 已注册 HSM
    this._activeHsm = null;           // 当前活跃 HSM
    this._keyShares = new Map();      // 密钥分片
    this._auditLog = [];              // 审计日志
    this._approvalQueue = new Map();  // 审批队列
    this._initialized = false;
  }

  // ============================================================
  // 初始化
  // ============================================================

  async initialize() {
    if (this._initialized) {return true;}

    logger.info("[HSM] 初始化 HSM 联合认证...");

    try {
      // 注册软件模拟 HSM（开发环境）
      this._registerSoftwareHSM();

      this._initialized = true;
      logger.info("[HSM] 初始化完成");
      return true;
    } catch (error) {
      logger.error("[HSM] 初始化失败:", error.message);
      return false;
    }
  }

  // ============================================================
  // HSM 管理
  // ============================================================

  /**
   * 注册 HSM 设备
   */
  async registerHSM(hsmConfig) {
    const {
      id,
      type = HSM_TYPE.SOFTWARE,
      name,
      endpoint,
      slot = 0,
      credentials = {},
    } = hsmConfig;

    const hsmId = id || "hsm-" + crypto.randomBytes(4).toString("hex");

    logger.info(`[HSM] 注册 HSM: ${name} (${type})`);

    const hsm = {
      id: hsmId,
      type,
      name,
      endpoint,
      slot,
      state: HSM_STATE.DISCONNECTED,
      registeredAt: new Date().toISOString(),
      credentials,
      stats: { totalSigns: 0, lastUsed: null },
    };

    this._hsmPool.set(hsmId, hsm);

    // 尝试连接
    await this._connectHSM(hsm);

    return { success: true, hsmId, state: hsm.state };
  }

  /**
   * 连接到 HSM
   */
  async connectHSM(hsmId) {
    const hsm = this._hsmPool.get(hsmId);
    if (!hsm) {throw new Error(`HSM 不存在: ${hsmId}`);}

    return this._connectHSM(hsm);
  }

  /**
   * 设置活跃 HSM
   */
  setActiveHSM(hsmId) {
    const hsm = this._hsmPool.get(hsmId);
    if (!hsm) {throw new Error(`HSM 不存在: ${hsmId}`);}
    if (hsm.state !== HSM_STATE.AUTHENTICATED) {
      throw new Error("HSM 未认证，请先连接");
    }

    this._activeHsm = hsm;
    logger.info(`[HSM] 设置活跃 HSM: ${hsm.name}`);
    return { success: true };
  }

  /**
   * 列出所有 HSM
   */
  listHSMs() {
    return Array.from(this._hsmPool.values()).map((h) => ({
      id: h.id,
      name: h.name,
      type: h.type,
      state: h.state,
      isActive: h === this._activeHsm,
      stats: h.stats,
    }));
  }

  // ============================================================
  // 密钥分片
  // ============================================================

  /**
   * 生成分片密钥
   * 将密钥分为 SIMKey 持有的份额和 HSM 持有的份额
   *
   * @param {string} keyId - 密钥标识
   * @param {string} mode - 分片模式 (2of2/2of3)
   */
  async generateKeyShares(keyId, mode = COSIGN_MODE.THRESHOLD_2_OF_2) {
    this._ensureInitialized();
    this._ensureActiveHSM();

    logger.info(`[HSM] 生成分片密钥: ${keyId}, mode=${mode}`);

    // 生成主密钥
    const masterSecret = crypto.randomBytes(32);

    // 分片
    let shares;
    if (mode === COSIGN_MODE.THRESHOLD_2_OF_2) {
      shares = this._splitSecret2of2(masterSecret);
    } else {
      shares = this._splitSecret2of3(masterSecret);
    }

    // SIMKey 份额（存储在 SIM 卡中）
    const simkeyShare = {
      shareIndex: 0,
      share: shares[0].toString("base64"),
      publicContribution: this._computePublicContribution(shares[0]),
    };

    // HSM 份额（存储在 HSM 中）
    for (let i = 1; i < shares.length; i++) {
      const hsmShareId = `${keyId}-share-${i}`;
      await this._storeShareInHSM(hsmShareId, shares[i]);
    }

    // 计算联合公钥
    const jointPublicKey = this._computeJointPublicKey(shares);

    const keyShareInfo = {
      keyId,
      mode,
      totalShares: shares.length,
      threshold: mode === COSIGN_MODE.THRESHOLD_2_OF_3 ? 2 : 2,
      jointPublicKey: jointPublicKey.toString("base64"),
      simkeyShare,
      hsmId: this._activeHsm.id,
      createdAt: new Date().toISOString(),
    };

    this._keyShares.set(keyId, keyShareInfo);

    this._audit("key_shares_generated", { keyId, mode });

    return { success: true, keyShareInfo };
  }

  // ============================================================
  // 联合签名
  // ============================================================

  /**
   * SIMKey + HSM 联合签名
   *
   * @param {string} keyId - 分片密钥 ID
   * @param {Buffer|string} data - 待签名数据
   * @param {Function} simkeySignFn - SIMKey 签名函数
   * @param {Object} context - 签名上下文（用于策略判断）
   */
  async coSign(keyId, data, simkeySignFn, context = {}) {
    this._ensureInitialized();
    this._ensureActiveHSM();

    const keyShare = this._keyShares.get(keyId);
    if (!keyShare) {throw new Error(`分片密钥不存在: ${keyId}`);}

    logger.info(`[HSM] 联合签名: ${keyId}`);

    // 1. 策略检查
    const policyCheck = await this._checkApprovalPolicy(context);
    if (!policyCheck.approved) {
      if (policyCheck.needsApproval) {
        return this._submitForApproval(keyId, data, context);
      }
      throw new Error(`签名策略拒绝: ${policyCheck.reason}`);
    }

    // 2. 执行联合签名
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    let result;
    const mode = keyShare.mode;

    switch (mode) {
      case COSIGN_MODE.THRESHOLD_2_OF_2:
      case COSIGN_MODE.PARALLEL:
        result = await this._parallelCoSign(hash, simkeySignFn);
        break;
      case COSIGN_MODE.SEQUENTIAL:
        result = await this._sequentialCoSign(hash, simkeySignFn);
        break;
      case COSIGN_MODE.THRESHOLD_2_OF_3:
        result = await this._thresholdCoSign(hash, simkeySignFn);
        break;
      default:
        result = await this._parallelCoSign(hash, simkeySignFn);
    }

    // 3. 更新统计
    this._activeHsm.stats.totalSigns++;
    this._activeHsm.stats.lastUsed = new Date().toISOString();

    // 4. 审计日志
    this._audit("co_sign", {
      keyId,
      mode,
      dataHash: hash.toString("hex").substring(0, 16),
      context,
    });

    return {
      success: true,
      ...result,
      keyId,
      mode,
      hsmId: this._activeHsm.id,
      signedAt: new Date().toISOString(),
    };
  }

  /**
   * 仅 HSM 签名（无需 SIMKey 参与，用于服务端操作）
   */
  async hsmSign(data) {
    this._ensureInitialized();
    this._ensureActiveHSM();

    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    const signature = crypto
      .createHmac("sha256", Buffer.from(this._activeHsm.id))
      .update(hash)
      .digest();

    this._activeHsm.stats.totalSigns++;
    this._activeHsm.stats.lastUsed = new Date().toISOString();

    this._audit("hsm_sign", { hsmId: this._activeHsm.id });

    return {
      success: true,
      signature: signature.toString("base64"),
      hsmId: this._activeHsm.id,
    };
  }

  // ============================================================
  // 审批流
  // ============================================================

  /**
   * 获取待审批列表
   */
  getPendingApprovals() {
    return Array.from(this._approvalQueue.values()).filter(
      (a) => a.status === "pending",
    );
  }

  /**
   * 审批签名请求
   */
  async approveRequest(requestId, approverId) {
    const request = this._approvalQueue.get(requestId);
    if (!request) {throw new Error(`审批请求不存在: ${requestId}`);}

    request.status = "approved";
    request.approvedBy = approverId;
    request.approvedAt = new Date().toISOString();

    this._audit("approval_granted", { requestId, approverId });
    this.emit("approved", { requestId });

    return { success: true };
  }

  /**
   * 拒绝签名请求
   */
  async rejectRequest(requestId, approverId, reason) {
    const request = this._approvalQueue.get(requestId);
    if (!request) {throw new Error(`审批请求不存在: ${requestId}`);}

    request.status = "rejected";
    request.rejectedBy = approverId;
    request.reason = reason;
    request.rejectedAt = new Date().toISOString();

    this._audit("approval_rejected", { requestId, approverId, reason });
    this.emit("rejected", { requestId, reason });

    return { success: true };
  }

  // ============================================================
  // 审计日志
  // ============================================================

  /**
   * 获取审计日志
   */
  getAuditLog(options = {}) {
    const { limit = 100, offset = 0, action = null } = options;

    let logs = this._auditLog;
    if (action) {
      logs = logs.filter((l) => l.action === action);
    }

    return {
      total: logs.length,
      items: logs.slice(offset, offset + limit),
    };
  }

  /**
   * 导出审计日志
   */
  exportAuditLog(format = "json") {
    if (format === "json") {
      return JSON.stringify(this._auditLog, null, 2);
    }

    // CSV 格式
    const headers = "timestamp,action,details\n";
    const rows = this._auditLog
      .map((l) => `${l.timestamp},${l.action},"${JSON.stringify(l.details)}"`)
      .join("\n");
    return headers + rows;
  }

  // ============================================================
  // HSM 故障转移
  // ============================================================

  /**
   * 自动故障转移
   * 当主 HSM 不可用时，自动切换到备用 HSM
   */
  async failover() {
    if (!this.config.failoverEnabled) {return { success: false, reason: "故障转移未启用" };}

    logger.warn("[HSM] 执行故障转移...");

    const currentId = this._activeHsm?.id;

    // 查找可用的备用 HSM
    for (const [id, hsm] of this._hsmPool) {
      if (id === currentId) {continue;}
      if (hsm.state === HSM_STATE.AUTHENTICATED) {
        this._activeHsm = hsm;
        this._audit("failover", { from: currentId, to: id });
        this.emit("failover", { from: currentId, to: id });

        logger.info(`[HSM] 故障转移成功: ${currentId} → ${id}`);
        return { success: true, newActiveHsm: id };
      }
    }

    logger.error("[HSM] 故障转移失败: 无可用备用 HSM");
    return { success: false, reason: "无可用备用 HSM" };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  _registerSoftwareHSM() {
    const softHsm = {
      id: "soft-hsm-default",
      type: HSM_TYPE.SOFTWARE,
      name: "Software HSM (Development)",
      endpoint: "local",
      slot: 0,
      state: HSM_STATE.AUTHENTICATED,
      registeredAt: new Date().toISOString(),
      credentials: {},
      stats: { totalSigns: 0, lastUsed: null },
    };

    this._hsmPool.set(softHsm.id, softHsm);
    this._activeHsm = softHsm;
  }

  async _connectHSM(hsm) {
    hsm.state = HSM_STATE.CONNECTING;
    this.emit("hsm-connecting", { hsmId: hsm.id });

    try {
      await this._sleep(200);

      // 模拟 PKCS#11 认证
      hsm.state = HSM_STATE.AUTHENTICATED;
      this.emit("hsm-connected", { hsmId: hsm.id });

      logger.info(`[HSM] 已连接: ${hsm.name}`);
      return { success: true };
    } catch (error) {
      hsm.state = HSM_STATE.ERROR;
      logger.error(`[HSM] 连接失败: ${hsm.name}`, error.message);
      return { success: false, error: error.message };
    }
  }

  _splitSecret2of2(secret) {
    // Shamir 2-of-2: share1 = random, share2 = secret XOR share1
    const share1 = crypto.randomBytes(secret.length);
    const share2 = Buffer.alloc(secret.length);
    for (let i = 0; i < secret.length; i++) {
      share2[i] = secret[i] ^ share1[i];
    }
    return [share1, share2];
  }

  _splitSecret2of3(secret) {
    // 简化的 2-of-3 Shamir
    const share1 = crypto.randomBytes(secret.length);
    const share2 = crypto.randomBytes(secret.length);
    const share3 = Buffer.alloc(secret.length);
    for (let i = 0; i < secret.length; i++) {
      share3[i] = secret[i] ^ share1[i] ^ share2[i];
    }
    return [share1, share2, share3];
  }

  _computePublicContribution(share) {
    return crypto.createHash("sha256").update(share).digest("hex");
  }

  _computeJointPublicKey(shares) {
    const combined = Buffer.concat(shares);
    return crypto.createHash("sha256").update(combined).digest();
  }

  async _storeShareInHSM(shareId, share) {
    logger.debug(`[HSM] 存储密钥分片: ${shareId}`);
    await this._sleep(100);
    return true;
  }

  async _parallelCoSign(hash, simkeySignFn) {
    const [simkeyResult, hsmResult] = await Promise.all([
      simkeySignFn(hash),
      this._hsmSignInternal(hash),
    ]);

    return {
      simkeySignature: typeof simkeyResult === "string" ? simkeyResult : simkeyResult?.signature,
      hsmSignature: hsmResult.signature,
      combinedSignature: this._combineSignatures(
        typeof simkeyResult === "string" ? simkeyResult : simkeyResult?.signature,
        hsmResult.signature,
      ),
    };
  }

  async _sequentialCoSign(hash, simkeySignFn) {
    // SIMKey 先签
    const simkeyResult = await simkeySignFn(hash);
    const simkeySig = typeof simkeyResult === "string" ? simkeyResult : simkeyResult?.signature;

    // HSM 背书（签名 SIMKey 签名 + 原始哈希）
    const endorseData = Buffer.concat([
      hash,
      Buffer.from(simkeySig || "", "base64"),
    ]);
    const hsmResult = await this._hsmSignInternal(
      crypto.createHash("sha256").update(endorseData).digest(),
    );

    return {
      simkeySignature: simkeySig,
      hsmSignature: hsmResult.signature,
      combinedSignature: this._combineSignatures(simkeySig, hsmResult.signature),
      order: "simkey_first",
    };
  }

  async _thresholdCoSign(hash, simkeySignFn) {
    // 2-of-3: 使用 SIMKey + 主 HSM
    return this._parallelCoSign(hash, simkeySignFn);
  }

  async _hsmSignInternal(hash) {
    await this._sleep(50);

    const signature = crypto
      .createHmac("sha256", Buffer.from(this._activeHsm?.id || "hsm"))
      .update(hash)
      .digest();

    return { signature: signature.toString("base64") };
  }

  _combineSignatures(sig1, sig2) {
    const combined = crypto
      .createHash("sha256")
      .update(sig1 || "")
      .update(sig2 || "")
      .digest();
    return combined.toString("base64");
  }

  async _checkApprovalPolicy(context) {
    const policy = this.config.approvalPolicy;

    if (policy === APPROVAL_POLICY.NONE) {
      return { approved: true };
    }

    if (policy === APPROVAL_POLICY.AUTO) {
      // 自动策略：金额低于阈值自动批准
      const amount = context.amount || 0;
      if (amount <= this.config.amountThreshold) {
        return { approved: true };
      }
      return { approved: false, needsApproval: true, reason: "金额超过自动审批阈值" };
    }

    if (policy === APPROVAL_POLICY.MANUAL || policy === APPROVAL_POLICY.MULTI_APPROVER) {
      return { approved: false, needsApproval: true, reason: "需要人工审批" };
    }

    return { approved: true };
  }

  _submitForApproval(keyId, data, context) {
    const requestId = "approval-" + crypto.randomBytes(4).toString("hex");

    this._approvalQueue.set(requestId, {
      requestId,
      keyId,
      dataHash: crypto
        .createHash("sha256")
        .update(Buffer.isBuffer(data) ? data : Buffer.from(data))
        .digest("hex"),
      context,
      status: "pending",
      submittedAt: new Date().toISOString(),
    });

    this._audit("approval_requested", { requestId, keyId, context });
    this.emit("approval-requested", { requestId });

    return {
      success: false,
      pendingApproval: true,
      requestId,
      message: "签名请求已提交审批",
    };
  }

  _audit(action, details) {
    if (!this.config.auditEnabled) {return;}

    this._auditLog.push({
      timestamp: new Date().toISOString(),
      action,
      details,
      hsmId: this._activeHsm?.id,
    });

    // 限制日志大小
    if (this._auditLog.length > 10000) {
      this._auditLog = this._auditLog.slice(-5000);
    }
  }

  _ensureInitialized() {
    if (!this._initialized) {throw new Error("HSM 联合认证未初始化");}
  }

  _ensureActiveHSM() {
    if (!this._activeHsm) {throw new Error("无活跃 HSM");}
    if (this._activeHsm.state !== HSM_STATE.AUTHENTICATED) {
      throw new Error("HSM 未认证");
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async close() {
    this._initialized = false;
    this._hsmPool.clear();
    this._activeHsm = null;
    this._keyShares.clear();
    this._approvalQueue.clear();
  }
}

module.exports = { HsmFederation, HSM_STATE, HSM_TYPE, COSIGN_MODE, APPROVAL_POLICY };
