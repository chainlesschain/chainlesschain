/**
 * 卫星通信 SIM 驱动 (v0.39.0)
 *
 * 支持天通一号 (Tiantong-1) 卫星通信 SIM 卡
 * 在无地面网络覆盖的环境下提供 SIMKey 安全服务
 *
 * 功能:
 * - 天通一号卫星 SIM 检测与初始化
 * - 卫星链路 SIMKey 签名（高延迟优化）
 * - 卫星短消息签名传输
 * - 离线签名队列（卫星链路中断时缓存）
 * - 地面网络/卫星自动切换
 * - 北斗短报文 + SIMKey 联合认证
 *
 * 支持终端:
 * - 天通卫星电话
 * - 双模手机（地面 + 卫星）
 * - 华为 Mate 60 系列（卫星通信版）
 * - 卫星 IoT 终端
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

// 卫星链路状态
const SAT_LINK_STATE = {
  SEARCHING: "searching",      // 搜索卫星信号
  ACQUIRED: "acquired",        // 已获取信号
  CONNECTED: "connected",      // 已连接
  DEGRADED: "degraded",        // 信号降级
  LOST: "lost",                // 信号丢失
  TERRESTRIAL: "terrestrial",  // 使用地面网络
};

// 传输模式
const TRANSPORT_MODE = {
  SATELLITE: "satellite",       // 纯卫星链路
  TERRESTRIAL: "terrestrial",   // 地面网络
  HYBRID: "hybrid",             // 自动切换
  SMS_SATELLITE: "sms_satellite", // 卫星短消息
  BEIDOU_SMS: "beidou_sms",     // 北斗短报文
};

// 卫星系统
const SAT_SYSTEM = {
  TIANTONG: {
    name: "天通一号",
    constellation: "GEO",
    coverage: "China + Asia-Pacific",
    frequency: "S-band (2 GHz)",
    latency: "600-800ms",
  },
  BEIDOU: {
    name: "北斗三号",
    constellation: "MEO+GEO+IGSO",
    coverage: "Global",
    frequency: "B1I / B3I",
    smsCapacity: "1000 Chinese chars",
  },
};

class SatelliteSimDriver extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      preferredSatSystem: config.preferredSatSystem || "TIANTONG",
      autoSwitch: config.autoSwitch !== false,
      offlineQueueSize: config.offlineQueueSize || 100,
      signatureCompression: config.signatureCompression !== false,
      beidouEnabled: config.beidouEnabled || false,
      retransmitAttempts: config.retransmitAttempts || 3,
      ...config,
    };

    this._linkState = SAT_LINK_STATE.SEARCHING;
    this._transportMode = TRANSPORT_MODE.TERRESTRIAL;
    this._offlineQueue = [];
    this._signalStrength = 0;
    this._satInfo = null;
    this._initialized = false;
  }

  // ============================================================
  // 初始化
  // ============================================================

  async initialize() {
    if (this._initialized) return true;

    logger.info("[SatSIM] 初始化卫星通信 SIM 驱动...");

    try {
      // 检测卫星 SIM
      this._satInfo = await this._detectSatelliteSIM();

      if (!this._satInfo.detected) {
        logger.warn("[SatSIM] 未检测到卫星 SIM，仅地面模式");
        this._linkState = SAT_LINK_STATE.TERRESTRIAL;
        this._transportMode = TRANSPORT_MODE.TERRESTRIAL;
      } else {
        // 搜索卫星信号
        await this._acquireSatelliteSignal();
      }

      this._initialized = true;
      logger.info(
        `[SatSIM] 初始化完成: mode=${this._transportMode}, link=${this._linkState}`,
      );
      return true;
    } catch (error) {
      logger.error("[SatSIM] 初始化失败:", error.message);
      return false;
    }
  }

  /**
   * 获取卫星状态
   */
  getStatus() {
    return {
      linkState: this._linkState,
      transportMode: this._transportMode,
      signalStrength: this._signalStrength,
      satelliteInfo: this._satInfo,
      offlineQueueSize: this._offlineQueue.length,
      beidouEnabled: this.config.beidouEnabled,
    };
  }

  // ============================================================
  // 卫星链路 SIMKey 签名
  // ============================================================

  /**
   * 通过卫星链路签名
   * 针对高延迟优化：批量签名、签名压缩、预签名
   *
   * @param {Buffer|string} data - 待签名数据
   * @param {Object} options - 签名选项
   */
  async sign(data, options = {}) {
    this._ensureInitialized();
    const { priority = "normal", compress = this.config.signatureCompression } = options;

    // 根据当前传输模式选择签名策略
    switch (this._transportMode) {
      case TRANSPORT_MODE.SATELLITE:
        return this._signViaSatellite(data, { priority, compress });
      case TRANSPORT_MODE.TERRESTRIAL:
        return this._signViaTerrestrial(data);
      case TRANSPORT_MODE.HYBRID:
        return this._signHybrid(data, { priority, compress });
      case TRANSPORT_MODE.SMS_SATELLITE:
        return this._signViaSatSMS(data, { compress });
      case TRANSPORT_MODE.BEIDOU_SMS:
        return this._signViaBeidou(data);
      default:
        // 离线：加入队列
        return this._queueOfflineSign(data);
    }
  }

  /**
   * 批量签名（优化卫星链路利用率）
   * 将多个签名请求打包，一次卫星传输完成
   */
  async batchSign(dataArray) {
    this._ensureInitialized();

    logger.info(`[SatSIM] 批量签名: ${dataArray.length} 项`);

    // 合并所有数据的哈希
    const hashes = dataArray.map((d) => {
      const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
      return crypto.createHash("sha256").update(buf).digest();
    });

    // 构造 Merkle Tree
    const merkleRoot = this._buildMerkleRoot(hashes);

    // 只签名 Merkle Root（一次卫星传输）
    const rootSignature = await this.sign(merkleRoot, { priority: "high" });

    if (!rootSignature.success) {
      return { success: false, error: rootSignature.error };
    }

    // 生成每项的 Merkle 证明
    const results = hashes.map((hash, index) => ({
      index,
      hash: hash.toString("hex"),
      merkleProof: this._getMerkleProof(hashes, index),
      rootSignature: rootSignature.signature,
    }));

    return {
      success: true,
      merkleRoot: merkleRoot.toString("hex"),
      rootSignature: rootSignature.signature,
      items: results,
      batchSize: dataArray.length,
      savingsPercent: Math.round((1 - 1 / dataArray.length) * 100),
    };
  }

  /**
   * 处理离线签名队列
   * 当卫星链路恢复时，自动处理排队的签名请求
   */
  async processOfflineQueue() {
    if (this._offlineQueue.length === 0) return { processed: 0 };

    logger.info(`[SatSIM] 处理离线队列: ${this._offlineQueue.length} 项`);

    const results = [];
    const queue = [...this._offlineQueue];
    this._offlineQueue = [];

    for (const item of queue) {
      try {
        const result = await this.sign(item.data, { priority: "batch" });
        results.push({ ...result, originalTimestamp: item.timestamp });
      } catch (error) {
        // 失败的重新入队
        this._offlineQueue.push(item);
        results.push({ success: false, error: error.message });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    logger.info(`[SatSIM] 离线队列处理完成: ${succeeded}/${queue.length}`);

    return { processed: succeeded, total: queue.length, results };
  }

  // ============================================================
  // 网络切换
  // ============================================================

  /**
   * 切换传输模式
   */
  async switchTransportMode(mode) {
    logger.info(`[SatSIM] 切换传输模式: ${this._transportMode} → ${mode}`);

    const previousMode = this._transportMode;
    this._transportMode = mode;

    // 更新链路状态
    if (mode === TRANSPORT_MODE.TERRESTRIAL) {
      this._linkState = SAT_LINK_STATE.TERRESTRIAL;
    } else if (mode === TRANSPORT_MODE.SATELLITE || mode === TRANSPORT_MODE.SMS_SATELLITE) {
      if (this._linkState === SAT_LINK_STATE.TERRESTRIAL) {
        await this._acquireSatelliteSignal();
      }
    }

    this.emit("transport-switched", { from: previousMode, to: mode });
    return { success: true, mode };
  }

  /**
   * 自动网络切换
   * 根据信号质量和延迟自动选择最优传输通道
   */
  async autoSwitch() {
    if (!this.config.autoSwitch) return;

    const terrestrialAvailable = await this._checkTerrestrialNetwork();
    const satelliteAvailable = this._linkState === SAT_LINK_STATE.CONNECTED ||
      this._linkState === SAT_LINK_STATE.ACQUIRED;

    let optimalMode;

    if (terrestrialAvailable) {
      optimalMode = TRANSPORT_MODE.TERRESTRIAL;
    } else if (satelliteAvailable) {
      optimalMode = TRANSPORT_MODE.SATELLITE;
    } else if (this.config.beidouEnabled) {
      optimalMode = TRANSPORT_MODE.BEIDOU_SMS;
    } else {
      optimalMode = TRANSPORT_MODE.SMS_SATELLITE;
    }

    if (optimalMode !== this._transportMode) {
      await this.switchTransportMode(optimalMode);
    }

    return { mode: this._transportMode };
  }

  // ============================================================
  // 北斗短报文集成
  // ============================================================

  /**
   * 通过北斗短报文发送签名请求
   * 适用于：深远海、荒漠、灾区等无任何通信覆盖区域
   */
  async signViaBeidouSMS(data) {
    if (!this.config.beidouEnabled) {
      throw new Error("北斗短报文未启用");
    }

    logger.info("[SatSIM] 通过北斗短报文签名");

    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    // 北斗短报文容量有限（1000汉字 ≈ 2000字节）
    // 压缩签名请求
    const compactRequest = {
      h: hash.toString("base64url").substring(0, 43), // SHA256 = 43 base64url chars
      t: Math.floor(Date.now() / 1000),
      n: crypto.randomBytes(4).toString("hex"),
    };

    // 模拟北斗短报文发送
    await this._sleep(2000); // 北斗短报文延迟约 1-2s

    const signature = crypto
      .createHmac("sha256", Buffer.from("beidou-simkey"))
      .update(hash)
      .digest();

    return {
      success: true,
      signature: signature.toString("base64"),
      transport: TRANSPORT_MODE.BEIDOU_SMS,
      latency: "1-2s",
      compactSize: JSON.stringify(compactRequest).length,
    };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  async _detectSatelliteSIM() {
    await this._sleep(200);

    // 模拟检测结果
    return {
      detected: true,
      simType: "dual-mode",
      satelliteSystem: SAT_SYSTEM.TIANTONG.name,
      terrestrialCarrier: "中国移动",
      iccid: "89860" + crypto.randomBytes(8).toString("hex").substring(0, 15),
      capabilities: ["voice", "data", "sms", "simkey"],
    };
  }

  async _acquireSatelliteSignal() {
    logger.debug("[SatSIM] 搜索卫星信号...");
    this._linkState = SAT_LINK_STATE.SEARCHING;
    this.emit("state-changed", { state: this._linkState });

    await this._sleep(500);

    // 模拟获取信号
    this._signalStrength = -80 + Math.floor(Math.random() * 30);
    this._linkState =
      this._signalStrength > -90
        ? SAT_LINK_STATE.CONNECTED
        : SAT_LINK_STATE.DEGRADED;

    this.emit("state-changed", {
      state: this._linkState,
      signal: this._signalStrength,
    });
  }

  async _signViaSatellite(data, { priority, compress }) {
    logger.debug("[SatSIM] 卫星链路签名");

    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    // 模拟卫星延迟
    const latency = 600 + Math.floor(Math.random() * 200); // 600-800ms
    await this._sleep(Math.min(latency, 300)); // 模拟时缩短

    const signature = crypto
      .createHmac("sha256", Buffer.from("sat-simkey"))
      .update(hash)
      .digest();

    let signatureOutput = signature.toString("base64");
    if (compress) {
      signatureOutput = this._compressSignature(signatureOutput);
    }

    return {
      success: true,
      signature: signatureOutput,
      transport: TRANSPORT_MODE.SATELLITE,
      latency: `${latency}ms`,
      compressed: compress,
    };
  }

  async _signViaTerrestrial(data) {
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    await this._sleep(50);

    const signature = crypto
      .createHmac("sha256", Buffer.from("terrestrial-simkey"))
      .update(hash)
      .digest();

    return {
      success: true,
      signature: signature.toString("base64"),
      transport: TRANSPORT_MODE.TERRESTRIAL,
      latency: "50ms",
    };
  }

  async _signHybrid(data, options) {
    const terrestrialAvailable = await this._checkTerrestrialNetwork();

    if (terrestrialAvailable) {
      return this._signViaTerrestrial(data);
    }

    if (this._linkState === SAT_LINK_STATE.CONNECTED) {
      return this._signViaSatellite(data, options);
    }

    return this._queueOfflineSign(data);
  }

  async _signViaSatSMS(data, { compress }) {
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    // 卫星短消息 — 更高延迟但更可靠
    await this._sleep(200);

    const signature = crypto
      .createHmac("sha256", Buffer.from("satsms-simkey"))
      .update(hash)
      .digest();

    return {
      success: true,
      signature: signature.toString("base64"),
      transport: TRANSPORT_MODE.SMS_SATELLITE,
      latency: "2-5s",
    };
  }

  async _signViaBeidou(data) {
    return this.signViaBeidouSMS(data);
  }

  _queueOfflineSign(data) {
    if (this._offlineQueue.length >= this.config.offlineQueueSize) {
      throw new Error("离线签名队列已满");
    }

    const item = {
      id: crypto.randomBytes(4).toString("hex"),
      data,
      timestamp: new Date().toISOString(),
    };

    this._offlineQueue.push(item);
    logger.debug(
      `[SatSIM] 签名已加入离线队列: ${this._offlineQueue.length}/${this.config.offlineQueueSize}`,
    );

    this.emit("queued", { queueSize: this._offlineQueue.length });

    return {
      success: true,
      queued: true,
      queueId: item.id,
      queueSize: this._offlineQueue.length,
    };
  }

  async _checkTerrestrialNetwork() {
    // 模拟地面网络检测
    return Math.random() > 0.3;
  }

  _compressSignature(signature) {
    // 简单的 base64url 压缩
    return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  _buildMerkleRoot(hashes) {
    if (hashes.length === 0) return Buffer.alloc(32);
    if (hashes.length === 1) return hashes[0];

    const nextLevel = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] || left;
      nextLevel.push(
        crypto
          .createHash("sha256")
          .update(Buffer.concat([left, right]))
          .digest(),
      );
    }

    return this._buildMerkleRoot(nextLevel);
  }

  _getMerkleProof(hashes, index) {
    // 简化的 Merkle 证明
    const proof = [];
    let level = [...hashes];
    let idx = index;

    while (level.length > 1) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < level.length) {
        proof.push({
          hash: level[siblingIdx].toString("hex"),
          position: idx % 2 === 0 ? "right" : "left",
        });
      }

      const nextLevel = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || left;
        nextLevel.push(
          crypto
            .createHash("sha256")
            .update(Buffer.concat([left, right]))
            .digest(),
        );
      }
      level = nextLevel;
      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  _ensureInitialized() {
    if (!this._initialized) throw new Error("卫星 SIM 驱动未初始化");
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async close() {
    this._initialized = false;
    this._offlineQueue = [];
    this._linkState = SAT_LINK_STATE.LOST;
  }
}

module.exports = { SatelliteSimDriver, SAT_LINK_STATE, TRANSPORT_MODE, SAT_SYSTEM };
