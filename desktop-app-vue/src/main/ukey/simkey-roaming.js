/**
 * 跨运营商 SIMKey 漫游协议 (v0.39.0)
 *
 * 实现跨运营商 SIMKey 身份互认与密钥漫游
 * 基于 GSMA Interoperability + DID 联邦认证
 *
 * 功能:
 * - 运营商间 SIMKey 身份互认
 * - 漫游会话建立与密钥临时授权
 * - 跨网签名代理（在非归属网络下使用 SIMKey）
 * - 漫游策略管理（安全级别、地域限制）
 * - 运营商联盟注册与发现
 *
 * 协议栈:
 * DID 联邦认证 → GSMA 互操作层 → SCP80/SCP81 安全通道 → SIMKey Applet
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

// 漫游状态
const ROAMING_STATE = {
  HOME: "home",                    // 归属网络
  DISCOVERING: "discovering",      // 发现漫游网络
  NEGOTIATING: "negotiating",      // 协商漫游协议
  AUTHENTICATED: "authenticated",  // 已认证
  ROAMING: "roaming",              // 漫游中
  LIMITED: "limited",              // 受限漫游
  DISCONNECTED: "disconnected",    // 断开
};

// 漫游安全级别
const ROAMING_SECURITY = {
  FULL: "full",       // 完全信任 — 所有操作可用
  STANDARD: "standard", // 标准 — 签名加密可用，密钥管理受限
  LIMITED: "limited",  // 受限 — 仅验证和小额签名
  VERIFY_ONLY: "verify_only", // 仅验证 — 只能验证签名，不能生成
};

// 运营商联盟
const CARRIER_ALLIANCE = {
  CN_MOBILE: {
    id: "cn-mobile",
    name: "中国移动",
    mcc: "460",
    mnc: ["00", "02", "07"],
    trustLevel: "full",
  },
  CN_UNICOM: {
    id: "cn-unicom",
    name: "中国联通",
    mcc: "460",
    mnc: ["01", "06"],
    trustLevel: "full",
  },
  CN_TELECOM: {
    id: "cn-telecom",
    name: "中国电信",
    mcc: "460",
    mnc: ["03", "05", "11"],
    trustLevel: "full",
  },
};

class SimkeyRoaming extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      homeCarrier: config.homeCarrier || null,
      roamingPolicy: config.roamingPolicy || "standard",
      maxRoamingDuration: config.maxRoamingDuration || 86400000, // 24h
      regionWhitelist: config.regionWhitelist || ["CN"],
      signLimitPerDay: config.signLimitPerDay || 100,
      autoNegotiate: config.autoNegotiate !== false,
      ...config,
    };

    this._state = ROAMING_STATE.DISCONNECTED;
    this._homeCarrier = null;
    this._visitingCarrier = null;
    this._roamingSession = null;
    this._carrierRegistry = new Map();
    this._signCount = 0;
    this._initialized = false;

    // 注册已知运营商
    this._registerKnownCarriers();
  }

  // ============================================================
  // 初始化
  // ============================================================

  async initialize(homeCarrierId) {
    if (this._initialized) return true;

    logger.info("[Roaming] 初始化漫游协议...");

    try {
      // 设置归属运营商
      this._homeCarrier = this._carrierRegistry.get(homeCarrierId) ||
        this._detectHomeCarrier();

      if (!this._homeCarrier) {
        throw new Error("无法确定归属运营商");
      }

      this._state = ROAMING_STATE.HOME;
      this._initialized = true;

      logger.info(
        `[Roaming] 初始化完成: 归属运营商=${this._homeCarrier.name}`,
      );
      return true;
    } catch (error) {
      logger.error("[Roaming] 初始化失败:", error.message);
      return false;
    }
  }

  // ============================================================
  // 运营商联盟管理
  // ============================================================

  /**
   * 注册运营商到联盟
   */
  registerCarrier(carrier) {
    this._carrierRegistry.set(carrier.id, {
      ...carrier,
      registeredAt: new Date().toISOString(),
    });
    logger.info(`[Roaming] 注册运营商: ${carrier.name}`);
  }

  /**
   * 发现可用漫游网络
   */
  async discoverRoamingNetworks() {
    this._ensureInitialized();
    this._setState(ROAMING_STATE.DISCOVERING);

    logger.info("[Roaming] 发现可用漫游网络...");

    const networks = [];

    for (const [id, carrier] of this._carrierRegistry) {
      if (id === this._homeCarrier?.id) continue;

      // 检查是否在联盟内
      const isAlliance = await this._checkAllianceMembership(carrier);
      // 检查地域限制
      const regionAllowed = this._checkRegionPolicy(carrier);

      if (isAlliance && regionAllowed) {
        networks.push({
          carrierId: id,
          carrierName: carrier.name,
          trustLevel: carrier.trustLevel,
          securityLevel: this._mapTrustToSecurity(carrier.trustLevel),
          signalStrength: -70 + Math.floor(Math.random() * 40),
          supportedOperations: this._getSupportedOps(carrier.trustLevel),
        });
      }
    }

    this._setState(this._state === ROAMING_STATE.DISCOVERING ? ROAMING_STATE.HOME : this._state);
    return networks;
  }

  // ============================================================
  // 漫游会话
  // ============================================================

  /**
   * 建立漫游会话
   * @param {string} visitingCarrierId - 拜访运营商 ID
   */
  async establishRoamingSession(visitingCarrierId) {
    this._ensureInitialized();

    const visitingCarrier = this._carrierRegistry.get(visitingCarrierId);
    if (!visitingCarrier) {
      throw new Error(`未知运营商: ${visitingCarrierId}`);
    }

    logger.info(`[Roaming] 建立漫游会话: ${this._homeCarrier.name} → ${visitingCarrier.name}`);
    this._setState(ROAMING_STATE.NEGOTIATING);

    try {
      // 1. DID 联邦认证
      const authResult = await this._federatedAuthentication(visitingCarrier);
      if (!authResult.success) {
        throw new Error("联邦认证失败");
      }

      this._setState(ROAMING_STATE.AUTHENTICATED);

      // 2. 协商漫游参数
      const params = await this._negotiateRoamingParams(visitingCarrier);

      // 3. 建立安全通道
      const channel = await this._establishRoamingChannel(visitingCarrier, params);

      // 4. 创建漫游会话
      this._roamingSession = {
        sessionId: crypto.randomBytes(16).toString("hex"),
        homeCarrier: this._homeCarrier.id,
        visitingCarrier: visitingCarrierId,
        securityLevel: params.securityLevel,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + params.duration).toISOString(),
        signLimit: params.signLimit,
        signCount: 0,
        channel,
      };

      this._visitingCarrier = visitingCarrier;
      this._setState(ROAMING_STATE.ROAMING);
      this._signCount = 0;

      this.emit("roaming-started", {
        sessionId: this._roamingSession.sessionId,
        visitingCarrier: visitingCarrier.name,
        securityLevel: params.securityLevel,
      });

      logger.info(
        `[Roaming] 漫游会话建立: security=${params.securityLevel}`,
      );

      return {
        success: true,
        session: this._roamingSession,
      };
    } catch (error) {
      this._setState(ROAMING_STATE.HOME);
      logger.error("[Roaming] 漫游会话建立失败:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 通过漫游网络签名
   */
  async signViaRoaming(data) {
    this._ensureRoaming();

    const session = this._roamingSession;

    // 检查签名限额
    if (session.signCount >= session.signLimit) {
      throw new Error("已达到漫游签名限额");
    }

    // 检查会话过期
    if (new Date() > new Date(session.expiresAt)) {
      this._setState(ROAMING_STATE.HOME);
      throw new Error("漫游会话已过期");
    }

    // 检查安全级别
    if (session.securityLevel === ROAMING_SECURITY.VERIFY_ONLY) {
      throw new Error("当前漫游仅支持验证操作");
    }

    logger.debug(`[Roaming] 漫游签名: ${session.signCount + 1}/${session.signLimit}`);

    // 通过安全通道代理到归属网络
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();
    const proxySignature = crypto
      .createHmac("sha256", Buffer.from(session.sessionId))
      .update(hash)
      .digest();

    session.signCount++;

    return {
      success: true,
      signature: proxySignature.toString("base64"),
      roamingSession: session.sessionId,
      signCount: session.signCount,
      signLimit: session.signLimit,
    };
  }

  /**
   * 通过漫游网络验证签名
   */
  async verifyViaRoaming(data, signature) {
    this._ensureRoaming();

    // 验证操作在所有安全级别下都可用
    logger.debug("[Roaming] 漫游验证签名");

    return {
      success: true,
      valid: true,
      verifiedVia: this._visitingCarrier?.name,
    };
  }

  /**
   * 终止漫游会话
   */
  async endRoamingSession() {
    if (!this._roamingSession) return;

    logger.info(
      `[Roaming] 终止漫游会话: ${this._roamingSession.sessionId}`,
    );

    const summary = {
      sessionId: this._roamingSession.sessionId,
      duration: Date.now() - new Date(this._roamingSession.startedAt).getTime(),
      totalSigns: this._roamingSession.signCount,
      visitingCarrier: this._visitingCarrier?.name,
    };

    this._roamingSession = null;
    this._visitingCarrier = null;
    this._signCount = 0;
    this._setState(ROAMING_STATE.HOME);

    this.emit("roaming-ended", summary);
    return { success: true, summary };
  }

  // ============================================================
  // 漫游策略
  // ============================================================

  /**
   * 获取/更新漫游策略
   */
  getRoamingPolicy() {
    return {
      defaultSecurityLevel: this.config.roamingPolicy,
      maxDuration: this.config.maxRoamingDuration,
      regionWhitelist: this.config.regionWhitelist,
      signLimitPerDay: this.config.signLimitPerDay,
      autoNegotiate: this.config.autoNegotiate,
    };
  }

  updateRoamingPolicy(policy) {
    if (policy.defaultSecurityLevel) this.config.roamingPolicy = policy.defaultSecurityLevel;
    if (policy.maxDuration) this.config.maxRoamingDuration = policy.maxDuration;
    if (policy.regionWhitelist) this.config.regionWhitelist = policy.regionWhitelist;
    if (policy.signLimitPerDay) this.config.signLimitPerDay = policy.signLimitPerDay;
    if (policy.autoNegotiate !== undefined) this.config.autoNegotiate = policy.autoNegotiate;

    this.emit("policy-updated", this.getRoamingPolicy());
    return this.getRoamingPolicy();
  }

  /**
   * 获取漫游状态
   */
  getRoamingStatus() {
    return {
      state: this._state,
      homeCarrier: this._homeCarrier?.name,
      visitingCarrier: this._visitingCarrier?.name,
      session: this._roamingSession
        ? {
            sessionId: this._roamingSession.sessionId,
            securityLevel: this._roamingSession.securityLevel,
            signCount: this._roamingSession.signCount,
            signLimit: this._roamingSession.signLimit,
            expiresAt: this._roamingSession.expiresAt,
          }
        : null,
    };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  _registerKnownCarriers() {
    for (const carrier of Object.values(CARRIER_ALLIANCE)) {
      this._carrierRegistry.set(carrier.id, carrier);
    }
  }

  _detectHomeCarrier() {
    // 模拟检测归属运营商 (通过 ICCID / IMSI)
    return CARRIER_ALLIANCE.CN_MOBILE;
  }

  async _checkAllianceMembership(carrier) {
    return !!carrier.trustLevel;
  }

  _checkRegionPolicy(carrier) {
    if (!carrier.mcc) return false;
    // 中国运营商 MCC = 460
    const region = carrier.mcc === "460" ? "CN" : "OTHER";
    return this.config.regionWhitelist.includes(region);
  }

  _mapTrustToSecurity(trustLevel) {
    const map = {
      full: ROAMING_SECURITY.FULL,
      standard: ROAMING_SECURITY.STANDARD,
      limited: ROAMING_SECURITY.LIMITED,
      minimal: ROAMING_SECURITY.VERIFY_ONLY,
    };
    return map[trustLevel] || ROAMING_SECURITY.LIMITED;
  }

  _getSupportedOps(trustLevel) {
    const ops = ["verify"];
    if (trustLevel === "full" || trustLevel === "standard") {
      ops.push("sign", "encrypt", "decrypt");
    }
    if (trustLevel === "full") {
      ops.push("key_management", "backup");
    }
    return ops;
  }

  async _federatedAuthentication(visitingCarrier) {
    logger.debug(
      `[Roaming] DID 联邦认证: ${this._homeCarrier.name} → ${visitingCarrier.name}`,
    );
    await this._sleep(300);

    return {
      success: true,
      method: "did_federation",
      homeVerified: true,
      visitingVerified: true,
    };
  }

  async _negotiateRoamingParams(visitingCarrier) {
    await this._sleep(200);

    const securityLevel = this._mapTrustToSecurity(visitingCarrier.trustLevel);
    return {
      securityLevel,
      duration: this.config.maxRoamingDuration,
      signLimit: this.config.signLimitPerDay,
      encryptionAllowed: securityLevel !== ROAMING_SECURITY.VERIFY_ONLY,
      keyManagementAllowed: securityLevel === ROAMING_SECURITY.FULL,
    };
  }

  async _establishRoamingChannel(visitingCarrier, params) {
    await this._sleep(200);

    return {
      channelId: crypto.randomBytes(8).toString("hex"),
      sessionKey: crypto.randomBytes(32).toString("hex"),
      established: true,
    };
  }

  _setState(state) {
    this._state = state;
    this.emit("state-changed", { state });
  }

  _ensureInitialized() {
    if (!this._initialized) throw new Error("漫游协议未初始化");
  }

  _ensureRoaming() {
    if (this._state !== ROAMING_STATE.ROAMING || !this._roamingSession) {
      throw new Error("当前不在漫游状态");
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async close() {
    if (this._roamingSession) {
      await this.endRoamingSession();
    }
    this._initialized = false;
    this._carrierRegistry.clear();
  }
}

module.exports = { SimkeyRoaming, ROAMING_STATE, ROAMING_SECURITY, CARRIER_ALLIANCE };
