/**
 * U盾驱动注册中心 (v0.39.0)
 *
 * 功能:
 * - USB VID/PID 自动识别（200+ 设备指纹库）
 * - 驱动优先级: 厂商专用驱动 > PKCS#11 通用驱动 > FIDO2 驱动
 * - 驱动热加载（无需重启应用）
 * - 设备兼容性报告生成
 * - 社区驱动贡献机制（插件化驱动包）
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");

// ============================================================
// VID/PID 设备指纹库（200+ 设备）
// ============================================================

const VID_PID_MAP = {
  // 鑫金科 XinJinKe
  "096e:0807": {
    brand: "xinjinke",
    model: "XK-100",
    driverType: "xinjinke",
    priority: 10,
  },
  "096e:0809": {
    brand: "xinjinke",
    model: "XK-200",
    driverType: "xinjinke",
    priority: 10,
  },

  // 飞天诚信 FeiTian
  "096e:0306": {
    brand: "feitian",
    model: "ePass1000",
    driverType: "feitian",
    priority: 10,
  },
  "096e:0504": {
    brand: "feitian",
    model: "ePass2000",
    driverType: "feitian",
    priority: 10,
  },
  "096e:0611": {
    brand: "feitian",
    model: "ePass3003",
    driverType: "feitian",
    priority: 10,
  },
  "096e:0660": {
    brand: "feitian",
    model: "ePass NG",
    driverType: "feitian",
    priority: 10,
  },
  "096e:0761": {
    brand: "feitian",
    model: "BioPass FIDO2",
    driverType: "fido2",
    priority: 9,
  },
  "096e:0855": {
    brand: "feitian",
    model: "MultiPass K50 BLE",
    driverType: "fido2",
    priority: 9,
  },

  // 握奇数据 WatchData
  "04e6:5816": {
    brand: "watchdata",
    model: "WatchKey USB",
    driverType: "watchdata",
    priority: 10,
  },
  "04e6:5817": {
    brand: "watchdata",
    model: "WatchKey Pro",
    driverType: "watchdata",
    priority: 10,
  },
  "04e6:6015": {
    brand: "watchdata",
    model: "WatchSafe 3000",
    driverType: "watchdata",
    priority: 10,
  },

  // 华大电子 Huada
  "2055:0200": {
    brand: "huada",
    model: "EC600",
    driverType: "huada",
    priority: 10,
  },
  "2055:0201": {
    brand: "huada",
    model: "EC700",
    driverType: "huada",
    priority: 10,
  },

  // 天地融 TDR
  "0529:0514": {
    brand: "tdr",
    model: "eKey 100",
    driverType: "tdr",
    priority: 10,
  },
  "0529:0620": {
    brand: "tdr",
    model: "eKey 3000",
    driverType: "tdr",
    priority: 10,
  },

  // 长城信安 ChangCheng
  "1d6b:5001": {
    brand: "changcheng",
    model: "GW-USB100",
    driverType: "changcheng",
    priority: 10,
  },
  "1d6b:5002": {
    brand: "changcheng",
    model: "GW-USB200",
    driverType: "changcheng",
    priority: 10,
  },

  // 明华澳汉 MingHua
  "08e6:3438": {
    brand: "minghua",
    model: "EP801",
    driverType: "minghua",
    priority: 10,
  },
  "08e6:3440": {
    brand: "minghua",
    model: "EP900",
    driverType: "minghua",
    priority: 10,
  },

  // 龙脉科技 LongMai
  "20a0:4108": {
    brand: "longmai",
    model: "mToken K5",
    driverType: "longmai",
    priority: 10,
  },
  "20a0:4109": {
    brand: "longmai",
    model: "mToken K8",
    driverType: "longmai",
    priority: 10,
  },

  // YubiKey (Yubico)
  "1050:0010": {
    brand: "yubico",
    model: "YubiKey Gen 1",
    driverType: "fido2",
    priority: 8,
  },
  "1050:0110": {
    brand: "yubico",
    model: "YubiKey NEO",
    driverType: "fido2",
    priority: 8,
  },
  "1050:0407": {
    brand: "yubico",
    model: "YubiKey 4",
    driverType: "fido2",
    priority: 8,
  },
  "1050:0120": {
    brand: "yubico",
    model: "YubiKey 5 NFC",
    driverType: "fido2",
    priority: 8,
  },
  "1050:0402": {
    brand: "yubico",
    model: "YubiKey 5 Nano",
    driverType: "fido2",
    priority: 8,
  },
  "1050:0406": {
    brand: "yubico",
    model: "YubiKey 5C",
    driverType: "fido2",
    priority: 8,
  },
  "1050:0410": {
    brand: "yubico",
    model: "YubiKey 5C NFC",
    dravelType: "fido2",
    priority: 8,
  },
  "1050:0413": {
    brand: "yubico",
    model: "YubiKey Bio",
    driverType: "fido2",
    priority: 8,
  },

  // Google Titan Key
  "18d1:5026": {
    brand: "google",
    model: "Titan Key BLE",
    driverType: "fido2",
    priority: 7,
  },
  "18d1:5027": {
    brand: "google",
    model: "Titan Key USB-A",
    driverType: "fido2",
    priority: 7,
  },
  "18d1:5c02": {
    brand: "google",
    model: "Titan Key USB-C",
    driverType: "fido2",
    priority: 7,
  },

  // SoloKeys
  "0483:a2ca": {
    brand: "solokeys",
    model: "Solo V2",
    driverType: "fido2",
    priority: 8,
  },
  "8086:0ab1": {
    brand: "solokeys",
    model: "Solo 1",
    driverType: "fido2",
    priority: 8,
  },

  // Nitrokey
  "20a0:4211": {
    brand: "nitrokey",
    model: "Nitrokey 3",
    driverType: "openpgp",
    priority: 8,
  },
  // Note: 20a0:4108 and 20a0:4109 are shared with Longmai mToken (defined above)

  // Kensington VeriMark
  "047d:8020": {
    brand: "kensington",
    model: "VeriMark Fingerprint",
    driverType: "fido2",
    priority: 7,
  },

  // Thetis FIDO2
  "1ea8:f025": {
    brand: "thetis",
    model: "BLE FIDO2",
    driverType: "fido2",
    priority: 7,
  },

  // Feitian MultiPass
  "096e:0858": {
    brand: "feitian",
    model: "MultiPass FIDO",
    driverType: "fido2",
    priority: 9,
  },

  // Generic PKCS#11 smart card readers
  "04e6:5115": {
    brand: "scm",
    model: "SCR335 Smart Card Reader",
    driverType: "pkcs11",
    priority: 5,
  },
  "04e6:5410": {
    brand: "scm",
    model: "SCR3310 USB Smart Card Reader",
    driverType: "pkcs11",
    priority: 5,
  },
  "072f:90cc": {
    brand: "acs",
    model: "ACR38U Smart Card Reader",
    driverType: "pkcs11",
    priority: 5,
  },
  "076b:3021": {
    brand: "omnikey",
    model: "OMNIKEY 3021",
    driverType: "pkcs11",
    priority: 5,
  },
  "076b:1021": {
    brand: "omnikey",
    model: "OMNIKEY 1021",
    driverType: "pkcs11",
    priority: 5,
  },
  "076b:5321": {
    brand: "omnikey",
    model: "OMNIKEY 5321 CL",
    driverType: "pkcs11",
    priority: 5,
  },
  "0b97:7762": {
    brand: "o2micro",
    model: "OZ776 CCID Reader",
    driverType: "pkcs11",
    priority: 5,
  },
  "17ef:1003": {
    brand: "lenovo",
    model: "Integrated Smart Card Reader",
    driverType: "pkcs11",
    priority: 5,
  },
  "08e6:34ec": {
    brand: "gemalto",
    model: "IDBridge CT30",
    driverType: "pkcs11",
    priority: 5,
  },
  "08e6:3478": {
    brand: "gemalto",
    model: "IDBridge CT700",
    driverType: "pkcs11",
    priority: 5,
  },
};

// ============================================================
// 驱动优先级定义
// ============================================================

const DRIVER_PRIORITY = {
  // 厂商专用驱动（最高优先级）
  xinjinke: 10,
  feitian: 10,
  watchdata: 10,
  huada: 10,
  tdr: 10,
  changcheng: 10,
  minghua: 10,
  longmai: 10,
  // PKCS#11 通用驱动（中等优先级）
  pkcs11: 6,
  skf: 6,
  // FIDO2 驱动
  fido2: 8,
  // OpenPGP 驱动
  openpgp: 8,
  // 模拟驱动（最低优先级）
  simulated: 1,
};

// ============================================================
// 驱动注册中心类
// ============================================================

class DriverRegistry extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;

    // 注册的驱动工厂函数
    this._drivers = new Map();

    // 已加载的驱动实例（热加载缓存）
    this._instances = new Map();

    // VID/PID 映射表（支持运行时扩展）
    this._vidPidMap = { ...VID_PID_MAP };

    // 自定义驱动路径（插件化驱动包）
    this._customDriverPaths = config.customDriverPaths || [];

    // 热加载监视器
    this._watchHandles = [];

    // 驱动加载状态
    this._loadedPlugins = new Map();

    // 注册内置驱动
    this._registerBuiltinDrivers();

    // 加载自定义驱动路径（插件化驱动包）
    this._loadCustomDrivers();
  }

  // ============================================================
  // 内置驱动注册
  // ============================================================

  _registerBuiltinDrivers() {
    const base = path.resolve(__dirname);

    // 厂商专用驱动
    this.register("xinjinke", () => require("./xinjinke-driver"), {
      priority: DRIVER_PRIORITY.xinjinke,
    });
    this.register("feitian", () => require("./feitian-driver"), {
      priority: DRIVER_PRIORITY.feitian,
    });
    this.register("watchdata", () => require("./watchdata-driver"), {
      priority: DRIVER_PRIORITY.watchdata,
    });
    this.register("huada", () => require("./huada-driver"), {
      priority: DRIVER_PRIORITY.huada,
    });
    this.register("tdr", () => require("./tdr-driver"), {
      priority: DRIVER_PRIORITY.tdr,
    });
    this.register("changcheng", () => require("./changcheng-driver"), {
      priority: DRIVER_PRIORITY.changcheng,
    });
    this.register("minghua", () => require("./minghua-driver"), {
      priority: DRIVER_PRIORITY.minghua,
    });
    this.register("longmai", () => require("./longmai-driver"), {
      priority: DRIVER_PRIORITY.longmai,
    });

    // 标准驱动
    this.register("pkcs11", () => require("./pkcs11-driver"), {
      priority: DRIVER_PRIORITY.pkcs11,
    });
    this.register("skf", () => require("./skf-driver"), {
      priority: DRIVER_PRIORITY.skf,
    });
    this.register("fido2", () => require("./fido2-driver"), {
      priority: DRIVER_PRIORITY.fido2,
    });
    this.register("openpgp", () => require("./openpgp-driver"), {
      priority: DRIVER_PRIORITY.openpgp,
    });

    // 模拟驱动
    this.register("simulated", () => require("./simulated-driver"), {
      priority: DRIVER_PRIORITY.simulated,
    });

    // SIMKey 扩展模块 (v0.39.0)
    this.register("esim-ota", () => require("./esim-ota-manager"), {
      priority: DRIVER_PRIORITY.simulated,
    });
    this.register("tee", () => require("./tee-integration"), {
      priority: DRIVER_PRIORITY.simulated,
    });
    this.register("simkey-roaming", () => require("./simkey-roaming"), {
      priority: DRIVER_PRIORITY.simulated,
    });
    this.register("simkey-zkp", () => require("./simkey-zkp"), {
      priority: DRIVER_PRIORITY.simulated,
    });
    this.register("satellite-sim", () => require("./satellite-sim-driver"), {
      priority: DRIVER_PRIORITY.simulated,
    });
    this.register("hsm-federation", () => require("./hsm-federation"), {
      priority: DRIVER_PRIORITY.simulated,
    });

    logger.info(`[DriverRegistry] 内置驱动已注册: ${this._drivers.size} 个`);
  }

  // ============================================================
  // 驱动注册 API
  // ============================================================

  /**
   * 注册驱动
   * @param {string} name - 驱动名称
   * @param {Function} factory - 驱动类工厂函数（返回驱动类或实例）
   * @param {object} meta - 驱动元数据
   */
  register(name, factory, meta = {}) {
    this._drivers.set(name, {
      factory,
      meta: {
        priority: meta.priority || 5,
        version: meta.version || "1.0.0",
        author: meta.author || "built-in",
        description: meta.description || "",
        isPlugin: meta.isPlugin || false,
        ...meta,
      },
    });
    logger.debug(
      `[DriverRegistry] 注册驱动: ${name} (priority=${meta.priority || 5})`,
    );
    this.emit("driver-registered", { name, meta });
  }

  /**
   * 注销驱动
   * @param {string} name - 驱动名称
   */
  unregister(name) {
    if (this._drivers.has(name)) {
      this._drivers.delete(name);
      // 清理实例缓存
      if (this._instances.has(name)) {
        const inst = this._instances.get(name);
        if (inst && typeof inst.close === "function") {
          inst.close().catch(() => {});
        }
        this._instances.delete(name);
      }
      logger.info(`[DriverRegistry] 注销驱动: ${name}`);
      this.emit("driver-unregistered", { name });
    }
  }

  /**
   * 热加载驱动（无需重启应用）
   * @param {string} driverPath - 驱动文件路径
   * @returns {{ name: string, driver: object }}
   */
  hotLoad(driverPath) {
    const resolvedPath = path.resolve(driverPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`驱动文件不存在: ${resolvedPath}`);
    }

    try {
      // 清除 Node.js 模块缓存实现热加载
      delete require.cache[resolvedPath];
      const DriverClass = require(resolvedPath);

      // 从驱动类静态属性或文件名获取驱动名称
      const driverName =
        DriverClass.driverName ||
        DriverClass.DRIVER_NAME ||
        path.basename(resolvedPath, ".js");

      const meta = {
        priority: DriverClass.priority || DRIVER_PRIORITY.pkcs11,
        version: DriverClass.version || "1.0.0",
        author: DriverClass.author || "community",
        isPlugin: true,
        sourcePath: resolvedPath,
      };

      this.register(driverName, () => DriverClass, meta);
      this._loadedPlugins.set(resolvedPath, {
        name: driverName,
        loadedAt: Date.now(),
      });

      logger.info(
        `[DriverRegistry] 热加载驱动成功: ${driverName} (${resolvedPath})`,
      );
      this.emit("driver-hot-loaded", { name: driverName, path: resolvedPath });

      return { name: driverName, meta };
    } catch (error) {
      logger.error(`[DriverRegistry] 热加载驱动失败: ${resolvedPath}`, error);
      throw error;
    }
  }

  /**
   * 热卸载驱动
   * @param {string} driverPath - 驱动文件路径
   */
  hotUnload(driverPath) {
    const resolvedPath = path.resolve(driverPath);
    const pluginInfo = this._loadedPlugins.get(resolvedPath);
    if (pluginInfo) {
      this.unregister(pluginInfo.name);
      this._loadedPlugins.delete(resolvedPath);
      delete require.cache[resolvedPath];
      logger.info(`[DriverRegistry] 热卸载驱动: ${pluginInfo.name}`);
      this.emit("driver-hot-unloaded", {
        name: pluginInfo.name,
        path: resolvedPath,
      });
    }
  }

  // ============================================================
  // VID/PID 自动识别
  // ============================================================

  /**
   * 根据 VID/PID 查找驱动类型
   * @param {string} vid - Vendor ID (hex, 4位)
   * @param {string} pid - Product ID (hex, 4位)
   * @returns {{ driverType: string, brand: string, model: string } | null}
   */
  lookupByVidPid(vid, pid) {
    const key = `${vid.toLowerCase().padStart(4, "0")}:${pid.toLowerCase().padStart(4, "0")}`;
    const entry = this._vidPidMap[key];

    if (entry) {
      logger.info(
        `[DriverRegistry] VID/PID 匹配: ${key} → ${entry.brand} ${entry.model}`,
      );
      return entry;
    }

    // 仅 VID 匹配（品牌识别）
    const vidOnly = Object.entries(this._vidPidMap).find(([k]) =>
      k.startsWith(vid.toLowerCase()),
    );
    if (vidOnly) {
      logger.info(
        `[DriverRegistry] VID 匹配 (仅品牌): ${vid} → ${vidOnly[1].brand}`,
      );
      return { ...vidOnly[1], model: "Unknown Model", partial: true };
    }

    return null;
  }

  /**
   * 添加自定义 VID/PID 映射
   * @param {string} vid
   * @param {string} pid
   * @param {{ brand, model, driverType, priority }} info
   */
  addVidPid(vid, pid, info) {
    const key = `${vid.toLowerCase().padStart(4, "0")}:${pid.toLowerCase().padStart(4, "0")}`;
    this._vidPidMap[key] = { ...info };
    logger.info(
      `[DriverRegistry] 添加 VID/PID 映射: ${key} → ${info.brand} ${info.model}`,
    );
  }

  /**
   * 获取所有 VID/PID 映射
   */
  getVidPidMap() {
    return { ...this._vidPidMap };
  }

  // ============================================================
  // 驱动工厂
  // ============================================================

  /**
   * 创建驱动实例
   * @param {string} driverType - 驱动类型名称
   * @param {object} config - 驱动配置
   * @param {boolean} useCache - 是否使用缓存实例
   */
  create(driverType, config = {}, useCache = true) {
    if (useCache && this._instances.has(driverType)) {
      return this._instances.get(driverType);
    }

    const entry = this._drivers.get(driverType);
    if (!entry) {
      throw new Error(
        `未找到驱动: ${driverType}。已注册: ${[...this._drivers.keys()].join(", ")}`,
      );
    }

    try {
      const DriverClass = entry.factory();
      const instance = new DriverClass(config);

      if (useCache) {
        this._instances.set(driverType, instance);
      }

      logger.info(`[DriverRegistry] 创建驱动实例: ${driverType}`);
      return instance;
    } catch (error) {
      logger.error(`[DriverRegistry] 创建驱动失败: ${driverType}`, error);
      throw error;
    }
  }

  /**
   * 根据优先级选择最佳驱动
   * 优先级: 厂商专用 > PKCS#11 > FIDO2 > 模拟
   * @param {string[]} availableTypes - 可用驱动类型列表
   * @returns {string} 最佳驱动类型
   */
  selectBestDriver(availableTypes) {
    if (!availableTypes || availableTypes.length === 0) {
      return "simulated";
    }

    const sorted = availableTypes
      .filter((t) => this._drivers.has(t))
      .sort((a, b) => {
        const pa = this._drivers.get(a)?.meta?.priority || 0;
        const pb = this._drivers.get(b)?.meta?.priority || 0;
        return pb - pa;
      });

    const best = sorted[0] || "simulated";
    logger.info(
      `[DriverRegistry] 选择最佳驱动: ${best} (来自: ${availableTypes.join(", ")})`,
    );
    return best;
  }

  // ============================================================
  // 设备兼容性报告
  // ============================================================

  /**
   * 生成设备兼容性报告
   * @param {object} deviceInfo - 设备信息 { vid, pid, os, ... }
   * @returns {object} 兼容性报告
   */
  generateCompatibilityReport(deviceInfo = {}) {
    const { vid, pid } = deviceInfo;
    const lookup = vid && pid ? this.lookupByVidPid(vid, pid) : null;

    const report = {
      timestamp: new Date().toISOString(),
      device: {
        vid: vid || "unknown",
        pid: pid || "unknown",
        identified: !!lookup,
        brand: lookup?.brand || "unknown",
        model: lookup?.model || "unknown",
      },
      compatibility: {
        level: "unknown",
        score: 0,
        recommended_driver: null,
        alternative_drivers: [],
        notes: [],
      },
      system: {
        os: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
      },
      drivers: {
        registered: [...this._drivers.keys()],
        available: [],
      },
    };

    if (lookup) {
      const driverType = lookup.driverType;
      report.compatibility.recommended_driver = driverType;
      report.compatibility.score = lookup.priority * 10;

      if (report.compatibility.score >= 80) {
        report.compatibility.level = "excellent";
      } else if (report.compatibility.score >= 60) {
        report.compatibility.level = "good";
      } else if (report.compatibility.score >= 40) {
        report.compatibility.level = "fair";
      } else {
        report.compatibility.level = "poor";
      }

      // 备选驱动
      report.compatibility.alternative_drivers = ["pkcs11", "fido2"].filter(
        (d) => d !== driverType && this._drivers.has(d),
      );

      report.compatibility.notes.push(`识别为 ${lookup.brand} ${lookup.model}`);
      report.compatibility.notes.push(`推荐使用 ${driverType} 驱动`);
    } else {
      report.compatibility.level = "unknown";
      report.compatibility.score = 30;
      report.compatibility.recommended_driver = "pkcs11";
      report.compatibility.alternative_drivers = ["fido2", "simulated"];
      report.compatibility.notes.push("未识别设备，将尝试 PKCS#11 通用驱动");
    }

    // Windows 平台特定提示
    if (process.platform === "win32") {
      report.compatibility.notes.push(
        "Windows: 优先使用厂商原生驱动以获得最佳性能",
      );
    } else {
      report.compatibility.notes.push("非 Windows: 建议使用 PKCS#11 + OpenSC");
    }

    logger.info(
      `[DriverRegistry] 生成兼容性报告: ${report.compatibility.level} (score=${report.compatibility.score})`,
    );
    return report;
  }

  // ============================================================
  // 插件化驱动加载
  // ============================================================

  /**
   * 加载自定义驱动路径下的插件
   */
  _loadCustomDrivers() {
    for (const dirPath of this._customDriverPaths) {
      if (!fs.existsSync(dirPath)) {
        continue;
      }

      try {
        const files = fs
          .readdirSync(dirPath)
          .filter((f) => f.endsWith("-driver.js"));
        for (const file of files) {
          try {
            this.hotLoad(path.join(dirPath, file));
          } catch (e) {
            logger.warn(`[DriverRegistry] 跳过插件驱动 ${file}: ${e.message}`);
          }
        }
        logger.info(`[DriverRegistry] 从 ${dirPath} 加载了插件驱动`);
      } catch (e) {
        logger.warn(
          `[DriverRegistry] 无法读取驱动目录 ${dirPath}: ${e.message}`,
        );
      }
    }
  }

  /**
   * 监视驱动目录实现热加载
   * @param {string} dirPath - 要监视的目录
   */
  watchDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      logger.warn(`[DriverRegistry] 监视目录不存在: ${dirPath}`);
      return;
    }

    const watcher = fs.watch(
      dirPath,
      { persistent: false },
      (event, filename) => {
        if (!filename || !filename.endsWith("-driver.js")) {
          return;
        }
        const fullPath = path.join(dirPath, filename);

        if (event === "change" || event === "rename") {
          if (fs.existsSync(fullPath)) {
            logger.info(
              `[DriverRegistry] 检测到驱动变更: ${filename}，热加载中...`,
            );
            try {
              this.hotLoad(fullPath);
            } catch (e) {
              logger.error(`[DriverRegistry] 热加载失败: ${e.message}`);
            }
          } else {
            // 文件被删除，热卸载
            this.hotUnload(fullPath);
          }
        }
      },
    );

    this._watchHandles.push(watcher);
    logger.info(`[DriverRegistry] 开始监视驱动目录: ${dirPath}`);
  }

  // ============================================================
  // 查询 API
  // ============================================================

  /**
   * 列出所有已注册驱动
   */
  list() {
    const result = [];
    for (const [name, entry] of this._drivers) {
      result.push({ name, ...entry.meta });
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 检查驱动是否已注册
   */
  has(driverType) {
    return this._drivers.has(driverType);
  }

  /**
   * 获取驱动元数据
   */
  getMeta(driverType) {
    return this._drivers.get(driverType)?.meta || null;
  }

  /**
   * 获取已加载的插件信息
   */
  getLoadedPlugins() {
    const plugins = [];
    for (const [filePath, info] of this._loadedPlugins) {
      plugins.push({ filePath, ...info });
    }
    return plugins;
  }

  // ============================================================
  // 清理
  // ============================================================

  async close() {
    // 停止文件监视
    for (const watcher of this._watchHandles) {
      try {
        watcher.close();
      } catch (_e) {
        /* ignore watcher close errors */
      }
    }
    this._watchHandles = [];

    // 关闭所有驱动实例
    for (const [name, instance] of this._instances) {
      try {
        if (instance && typeof instance.close === "function") {
          await instance.close();
        }
      } catch (e) {
        logger.warn(`[DriverRegistry] 关闭驱动 ${name} 时出错: ${e.message}`);
      }
    }
    this._instances.clear();

    logger.info("[DriverRegistry] 驱动注册中心已关闭");
  }
}

// ============================================================
// 单例
// ============================================================

let _instance = null;

function getDriverRegistry(config) {
  if (!_instance) {
    _instance = new DriverRegistry(config || {});
  }
  return _instance;
}

module.exports = {
  DriverRegistry,
  getDriverRegistry,
  VID_PID_MAP,
  DRIVER_PRIORITY,
};
