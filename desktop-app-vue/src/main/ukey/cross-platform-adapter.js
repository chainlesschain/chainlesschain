/**
 * Cross-Platform U-Key Adapter
 *
 * Provides unified U-Key interface across Windows, macOS, and Linux
 *
 * Platform Support:
 * - Windows: Native DLL drivers (XinJinKe, FeiTian, etc.)
 * - macOS/Linux: PKCS#11 standard interface + Simulated fallback
 *
 * Architecture:
 * - Detects platform and available hardware
 * - Automatically selects best available driver
 * - Falls back to simulation mode if no hardware detected
 */

const { logger } = require("../utils/logger.js");
const os = require("os");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

// Import drivers
const XinJinKeDriver = require("./xinjinke-driver");
const FeiTianDriver = require("./feitian-driver");
const WatchDataDriver = require("./watchdata-driver");
const HuadaDriver = require("./huada-driver");
const TDRDriver = require("./tdr-driver");
const SimulatedDriver = require("./simulated-driver");
const PKCS11Driver = require("./pkcs11-driver");

/**
 * Platform types
 */
const Platforms = {
  WINDOWS: "win32",
  MACOS: "darwin",
  LINUX: "linux",
};

/**
 * Driver availability by platform
 */
const PlatformDrivers = {
  [Platforms.WINDOWS]: [
    "xinjinke",
    "feitian",
    "watchdata",
    "huada",
    "tdr",
    "pkcs11",
    "simulated",
  ],
  [Platforms.MACOS]: ["pkcs11", "simulated"],
  [Platforms.LINUX]: ["pkcs11", "simulated"],
};

/**
 * Cross-Platform U-Key Adapter
 */
class CrossPlatformAdapter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.platform = os.platform();
    this.currentDriver = null;
    this.availableDrivers = [];
    this.isInitialized = false;

    // Driver preference order (can be overridden in config)
    this.driverPreference =
      config.driverPreference || this.getDefaultDriverPreference();
  }

  /**
   * Get default driver preference based on platform
   */
  getDefaultDriverPreference() {
    switch (this.platform) {
      case Platforms.WINDOWS:
        return [
          "xinjinke",
          "feitian",
          "watchdata",
          "huada",
          "tdr",
          "pkcs11",
          "simulated",
        ];

      case Platforms.MACOS:
      case Platforms.LINUX:
        return ["pkcs11", "simulated"];

      default:
        return ["simulated"];
    }
  }

  /**
   * Initialize adapter
   */
  async initialize() {
    logger.info(`[CrossPlatformAdapter] Initializing on ${this.platform}...`);

    try {
      // Detect available drivers
      this.availableDrivers = await this.detectAvailableDrivers();
      logger.info(
        `[CrossPlatformAdapter] Available drivers:`,
        this.availableDrivers,
      );

      // Select and initialize best driver
      const selectedDriver = await this.selectBestDriver();

      if (!selectedDriver) {
        throw new Error("No suitable U-Key driver found");
      }

      this.currentDriver = selectedDriver;
      await this.currentDriver.initialize();

      this.isInitialized = true;
      logger.info(
        `[CrossPlatformAdapter] Initialized with driver: ${this.currentDriver.driverName}`,
      );

      this.emit("initialized", {
        platform: this.platform,
        driver: this.currentDriver.driverName,
        isHardware: this.currentDriver.driverName !== "Simulated",
      });

      return true;
    } catch (error) {
      logger.error("[CrossPlatformAdapter] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Detect available drivers on current platform
   */
  async detectAvailableDrivers() {
    const platformDrivers = PlatformDrivers[this.platform] || ["simulated"];
    const available = [];

    for (const driverType of platformDrivers) {
      try {
        const isAvailable = await this.checkDriverAvailability(driverType);
        if (isAvailable) {
          available.push(driverType);
        }
      } catch (error) {
        logger.warn(
          `[CrossPlatformAdapter] Driver ${driverType} check failed:`,
          error.message,
        );
      }
    }

    // Always include simulated as fallback
    if (!available.includes("simulated")) {
      available.push("simulated");
    }

    return available;
  }

  /**
   * Check if a specific driver is available
   */
  async checkDriverAvailability(driverType) {
    switch (driverType) {
      case "xinjinke":
      case "feitian":
      case "watchdata":
      case "huada":
      case "tdr":
        // Windows-only drivers - check for DLL
        if (this.platform !== Platforms.WINDOWS) {
          return false;
        }
        return this.checkWindowsDriverDLL(driverType);

      case "pkcs11":
        // PKCS#11 - check for library
        return this.checkPKCS11Library();

      case "simulated":
        // Always available
        return true;

      default:
        return false;
    }
  }

  /**
   * Check if Windows driver DLL exists
   */
  checkWindowsDriverDLL(driverType) {
    const dllNames = {
      xinjinke: "xjk.dll",
      feitian: "ft.dll",
      watchdata: "wd.dll",
      huada: "hd.dll",
      tdr: "tdr.dll",
    };

    const dllName = dllNames[driverType];
    if (!dllName) {
      return false;
    }

    // Check common locations
    const searchPaths = [
      path.join(process.cwd(), "resources", dllName),
      path.join(
        process.env.ProgramFiles || "C:\\Program Files",
        driverType,
        dllName,
      ),
      path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        driverType,
        dllName,
      ),
      path.join("C:\\Windows\\System32", dllName),
    ];

    return searchPaths.some((p) => fs.existsSync(p));
  }

  /**
   * Check if PKCS#11 library is available
   */
  checkPKCS11Library() {
    // Common PKCS#11 library locations by platform
    const pkcs11Paths = {
      [Platforms.MACOS]: [
        "/Library/OpenSC/lib/opensc-pkcs11.so",
        "/usr/local/lib/opensc-pkcs11.so",
        "/usr/local/lib/pkcs11/opensc-pkcs11.so",
      ],
      [Platforms.LINUX]: [
        "/usr/lib/opensc-pkcs11.so",
        "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
        "/usr/local/lib/opensc-pkcs11.so",
        "/usr/lib/pkcs11/opensc-pkcs11.so",
      ],
      [Platforms.WINDOWS]: [
        "C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
        "C:\\Program Files (x86)\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
      ],
    };

    const paths = pkcs11Paths[this.platform] || [];
    return paths.some((p) => fs.existsSync(p));
  }

  /**
   * Select best available driver based on preference
   */
  async selectBestDriver() {
    for (const preferredDriver of this.driverPreference) {
      if (this.availableDrivers.includes(preferredDriver)) {
        try {
          const driver = await this.createDriver(preferredDriver);
          logger.info(
            `[CrossPlatformAdapter] Selected driver: ${preferredDriver}`,
          );
          return driver;
        } catch (error) {
          logger.warn(
            `[CrossPlatformAdapter] Failed to create ${preferredDriver} driver:`,
            error.message,
          );
        }
      }
    }

    // Fallback to simulated
    logger.info("[CrossPlatformAdapter] Falling back to simulated driver");
    return this.createDriver("simulated");
  }

  /**
   * Create driver instance
   */
  async createDriver(driverType) {
    const config = {
      ...this.config,
      platform: this.platform,
    };

    switch (driverType) {
      case "xinjinke":
        return new XinJinKeDriver(config);

      case "feitian":
        return new FeiTianDriver(config);

      case "watchdata":
        return new WatchDataDriver(config);

      case "huada":
        return new HuadaDriver(config);

      case "tdr":
        return new TDRDriver(config);

      case "pkcs11":
        return new PKCS11Driver(config);

      case "simulated":
        return new SimulatedDriver(config);

      default:
        throw new Error(`Unknown driver type: ${driverType}`);
    }
  }

  /**
   * Get platform information
   */
  getPlatformInfo() {
    return {
      platform: this.platform,
      arch: os.arch(),
      release: os.release(),
      availableDrivers: this.availableDrivers,
      currentDriver: this.currentDriver ? this.currentDriver.driverName : null,
      isHardwareSupported:
        this.platform === Platforms.WINDOWS ||
        this.availableDrivers.includes("pkcs11"),
    };
  }

  /**
   * Switch to different driver
   */
  async switchDriver(driverType) {
    if (!this.availableDrivers.includes(driverType)) {
      throw new Error(`Driver ${driverType} is not available on this platform`);
    }

    logger.info(`[CrossPlatformAdapter] Switching to ${driverType} driver...`);

    try {
      // Close current driver
      if (this.currentDriver) {
        await this.currentDriver.close();
      }

      // Create and initialize new driver
      this.currentDriver = await this.createDriver(driverType);
      await this.currentDriver.initialize();

      this.emit("driver-changed", {
        driver: this.currentDriver.driverName,
        isHardware: this.currentDriver.driverName !== "Simulated",
      });

      logger.info(
        `[CrossPlatformAdapter] Switched to ${driverType} driver successfully`,
      );
      return true;
    } catch (error) {
      logger.error(`[CrossPlatformAdapter] Failed to switch driver:`, error);
      throw error;
    }
  }

  /**
   * Proxy all driver methods to current driver
   */
  async connect(pin) {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.connect(pin);
  }

  async disconnect() {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.disconnect();
  }

  async getDeviceInfo() {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.getDeviceInfo();
  }

  async sign(data) {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.sign(data);
  }

  async verify(data, signature) {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.verify(data, signature);
  }

  async encrypt(data) {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.encrypt(data);
  }

  async decrypt(encryptedData) {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.decrypt(encryptedData);
  }

  async changePin(oldPin, newPin) {
    if (!this.currentDriver) {
      throw new Error("Adapter not initialized");
    }
    return this.currentDriver.changePin(oldPin, newPin);
  }

  async close() {
    if (this.currentDriver) {
      await this.currentDriver.close();
      this.currentDriver = null;
    }
    this.isInitialized = false;
  }
}

module.exports = CrossPlatformAdapter;
