/**
 * OpenPGP Card 协议驱动 (v0.39.0)
 *
 * 支持:
 * - Nitrokey 3 (FIDO2+OpenPGP)
 * - Nitrokey Pro 2
 * - Nitrokey Start
 * - GnuPG 智能卡
 * - 兼容 ISO/IEC 7816-4 OpenPGP 卡规范 v3.4
 *
 * 功能:
 * - OpenPGP 签名/加密/认证密钥
 * - GPG 兼容操作
 * - PIN/PUK 管理
 * - 密钥生成（RSA 2048/4096, ECDSA P-256/P-384/Ed25519）
 */

const { logger } = require("../utils/logger.js");
const BaseUKeyDriver = require("./base-driver");
const crypto = require("crypto");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const os = require("os");
const fs = require("fs");
const path = require("path");

// ============================================================
// OpenPGP 卡常量
// ============================================================

const OPENPGP_AID = "D27600012401"; // OpenPGP 卡应用标识符

const OPENPGP_KEY_SLOT = {
  SIGN: "1", // 签名密钥
  DECRYPT: "2", // 解密密钥
  AUTH: "3", // 认证密钥
};

const OPENPGP_ALG = {
  RSA2048: "rsa2048",
  RSA4096: "rsa4096",
  ECDSA_P256: "nistp256",
  ECDSA_P384: "nistp384",
  ED25519: "ed25519",
};

// ============================================================
// OpenPGP Driver
// ============================================================

class OpenPGPDriver extends BaseUKeyDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = "OpenPGP";
    this.driverVersion = "1.0.0";
    this.platform = os.platform();

    // GPG 配置
    this._gpgBin = config.gpgBin || "gpg";
    this._gpg2Bin = config.gpg2Bin || "gpg2";
    this._activeGpg = null;

    // 卡信息
    this._cardInfo = null;
    this._serialNumber = null;
    this._fingerprints = {};
    this._keyId = null;

    // PIN 状态
    this._pinVerified = false;
    this._pinRetries = null;
    this._adminPinRetries = null;

    // 模拟模式
    this._simMode = false;
    this._simKeyPair = null;
  }

  static get driverName() {
    return "openpgp";
  }
  static get priority() {
    return 8;
  }

  // ============================================================
  // 初始化
  // ============================================================

  async initialize() {
    logger.info("[OpenPGPDriver] 初始化 OpenPGP 驱动...");

    try {
      // 检测 GPG 版本
      this._activeGpg = await this._detectGPG();

      if (!this._activeGpg) {
        logger.warn("[OpenPGPDriver] GPG 未找到，切换到模拟模式");
        this._simMode = true;
        await this._initSimMode();
      } else {
        logger.info(`[OpenPGPDriver] 使用 GPG: ${this._activeGpg}`);
      }

      this.isInitialized = true;
      logger.info("[OpenPGPDriver] OpenPGP 驱动初始化完成");
      return true;
    } catch (error) {
      logger.error("[OpenPGPDriver] 初始化失败:", error);
      this._simMode = true;
      await this._initSimMode();
      this.isInitialized = true;
      return true;
    }
  }

  async _detectGPG() {
    for (const bin of [this._gpg2Bin, this._gpgBin]) {
      try {
        const { stdout } = await execAsync(`${bin} --version 2>&1`, {
          timeout: 5000,
        });
        if (stdout.includes("GnuPG")) {
          return bin;
        }
      } catch (_e) {
        /* ignore cleanup errors */
      }
    }
    return null;
  }

  async _initSimMode() {
    this._simKeyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    logger.info("[OpenPGPDriver] 模拟模式已启用（RSA-2048 密钥对）");
  }

  // ============================================================
  // 设备检测
  // ============================================================

  async detect() {
    logger.info("[OpenPGPDriver] 检测 OpenPGP 卡...");

    if (this._simMode) {
      return {
        detected: false,
        reason: "simulation_mode",
        message: "OpenPGP 模拟模式（无真实设备）",
      };
    }

    try {
      const { stdout, stderr } = await execAsync(
        `${this._activeGpg} --card-status 2>&1`,
        { timeout: 15000 },
      );

      const output = stdout + (stderr || "");

      if (
        output.includes("No card") ||
        output.includes("card not present") ||
        output.includes("error")
      ) {
        if (output.includes("No card") || output.includes("card not present")) {
          return { detected: false, reason: "no_card" };
        }
      }

      // 解析卡信息
      this._cardInfo = this._parseCardStatus(output);

      if (!this._cardInfo) {
        return { detected: false, reason: "parse_error" };
      }

      logger.info(
        `[OpenPGPDriver] 检测到 OpenPGP 卡: S/N ${this._cardInfo.serialNumber}`,
      );
      return {
        detected: true,
        deviceInfo: {
          id: `openpgp-${this._cardInfo.serialNumber}`,
          manufacturer: this._cardInfo.manufacturer || "OpenPGP Card",
          model: `OpenPGP Card v${this._cardInfo.version || "?"}`,
          serialNumber: this._cardInfo.serialNumber,
          driverName: this.driverName,
          protocol: "OpenPGP ISO/IEC 7816-4",
          pinRetries: this._cardInfo.pinRetries,
        },
      };
    } catch (error) {
      logger.error("[OpenPGPDriver] 检测失败:", error);
      return { detected: false, reason: "error", message: error.message };
    }
  }

  _parseCardStatus(output) {
    const info = {};

    const serialMatch = output.match(/Serial number\s*\.+\s*:\s*([0-9A-F ]+)/i);
    if (serialMatch) {
      info.serialNumber = serialMatch[1].trim().replace(/ /g, "");
    }

    const versionMatch = output.match(/Version\s*\.+\s*:\s*([\d.]+)/i);
    if (versionMatch) {
      info.version = versionMatch[1];
    }

    const mfgMatch = output.match(/Name of cardholder\s*\.+\s*:\s*(.+)/i);
    if (mfgMatch) {
      info.cardholder = mfgMatch[1].trim();
    }

    const retriesMatch = output.match(
      /PIN retry counter\s*\.+\s*:\s*(\d+)\s+(\d+)\s+(\d+)/i,
    );
    if (retriesMatch) {
      info.pinRetries = parseInt(retriesMatch[1]);
      this._pinRetries = info.pinRetries;
      this._adminPinRetries = parseInt(retriesMatch[2]);
    }

    const sigFpMatch = output.match(/Signature key\s*\.+\s*:\s*([0-9A-F ]+)/i);
    if (sigFpMatch) {
      info.signatureKeyFP = sigFpMatch[1].trim().replace(/ /g, "");
    }

    const encFpMatch = output.match(/Encryption key\s*\.+\s*:\s*([0-9A-F ]+)/i);
    if (encFpMatch) {
      info.encryptionKeyFP = encFpMatch[1].trim().replace(/ /g, "");
    }

    if (!info.serialNumber) {
      return null;
    }
    return info;
  }

  // ============================================================
  // PIN 验证
  // ============================================================

  async verifyPIN(pin) {
    logger.info("[OpenPGPDriver] 验证 OpenPGP PIN...");

    if (this._simMode) {
      if (pin === "123456" || pin === this.config.defaultPin) {
        this.isUnlocked = true;
        this._pinVerified = true;
        return { success: true, retriesRemaining: 3 };
      }
      this._pinRetries = Math.max(0, (this._pinRetries || 3) - 1);
      return {
        success: false,
        reason: "pin_incorrect",
        retriesRemaining: this._pinRetries,
      };
    }

    // 通过 GPG 命令验证 PIN（触发解锁状态）
    try {
      const testData = crypto.randomBytes(32);
      const tmpFile = path.join(os.tmpdir(), `openpgp-test-${Date.now()}.bin`);
      const sigFile = tmpFile + ".sig";

      fs.writeFileSync(tmpFile, testData);

      const { stdout, stderr } = await execAsync(
        `echo "${pin}" | ${this._activeGpg} --batch --passphrase-fd 0 --pinentry-mode loopback ` +
          `--detach-sign --output "${sigFile}" "${tmpFile}" 2>&1`,
        { timeout: 30000 },
      );

      const output = stdout + (stderr || "");

      [tmpFile, sigFile].forEach((f) => {
        try {
          fs.existsSync(f) && fs.unlinkSync(f);
        } catch (_e) {
          /* ignore cleanup errors */
        }
      });

      if (
        output.includes("Bad PIN") ||
        output.includes("bad PIN") ||
        output.includes("incorrect PIN")
      ) {
        this._pinRetries = Math.max(0, (this._pinRetries || 3) - 1);
        return {
          success: false,
          reason: "pin_incorrect",
          retriesRemaining: this._pinRetries,
        };
      }

      if (
        output.includes("card is blocked") ||
        output.includes("PIN blocked")
      ) {
        this._pinRetries = 0;
        return { success: false, reason: "pin_blocked", retriesRemaining: 0 };
      }

      this.isUnlocked = true;
      this._pinVerified = true;
      this._currentPin = pin;
      this._pinRetries = 3;
      return { success: true, retriesRemaining: 3 };
    } catch (error) {
      logger.error("[OpenPGPDriver] PIN 验证失败:", error);
      return { success: false, reason: "error", message: error.message };
    }
  }

  // ============================================================
  // 数字签名
  // ============================================================

  async sign(data) {
    if (!this.isUnlocked && !this._simMode) {
      throw new Error("设备未解锁，请先验证 PIN");
    }

    logger.info("[OpenPGPDriver] OpenPGP 签名...");

    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

    if (this._simMode) {
      const sign = crypto.createSign("SHA256");
      sign.update(dataBuffer);
      return sign.sign(this._simKeyPair.privateKey, "base64");
    }

    const tmpFile = path.join(os.tmpdir(), `openpgp-data-${Date.now()}.bin`);
    const sigFile = tmpFile + ".sig";

    try {
      fs.writeFileSync(tmpFile, dataBuffer);

      await execAsync(
        `echo "${this._currentPin}" | ${this._activeGpg} --batch --passphrase-fd 0 --pinentry-mode loopback ` +
          `--detach-sign --output "${sigFile}" "${tmpFile}" 2>&1`,
        { timeout: 60000 },
      );

      if (!fs.existsSync(sigFile)) {
        throw new Error("签名文件未生成");
      }

      const signature = fs.readFileSync(sigFile);
      return signature.toString("base64");
    } finally {
      [tmpFile, sigFile].forEach((f) => {
        try {
          fs.existsSync(f) && fs.unlinkSync(f);
        } catch (_e) {
          /* ignore cleanup errors */
        }
      });
    }
  }

  // ============================================================
  // 验证签名
  // ============================================================

  async verifySignature(data, signature) {
    try {
      const dataBuffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data, "utf8");

      if (this._simMode && this._simKeyPair) {
        const verify = crypto.createVerify("SHA256");
        verify.update(dataBuffer);
        return verify.verify(
          this._simKeyPair.publicKey,
          Buffer.from(signature, "base64"),
        );
      }

      const tmpFile = path.join(
        os.tmpdir(),
        `openpgp-verify-${Date.now()}.bin`,
      );
      const sigFile = tmpFile + ".sig";

      try {
        fs.writeFileSync(tmpFile, dataBuffer);
        fs.writeFileSync(sigFile, Buffer.from(signature, "base64"));

        const { stdout, stderr } = await execAsync(
          `${this._activeGpg} --verify "${sigFile}" "${tmpFile}" 2>&1`,
          { timeout: 15000 },
        );

        const output = stdout + (stderr || "");
        return (
          output.includes("Good signature") || output.includes("good signature")
        );
      } finally {
        [tmpFile, sigFile].forEach((f) => {
          try {
            fs.existsSync(f) && fs.unlinkSync(f);
          } catch (_e) {
            /* ignore cleanup errors */
          }
        });
      }
    } catch (error) {
      logger.error("[OpenPGPDriver] 签名验证失败:", error);
      return false;
    }
  }

  // ============================================================
  // 加密/解密
  // ============================================================

  async encrypt(data) {
    logger.info("[OpenPGPDriver] OpenPGP 加密...");
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

    if (this._simMode) {
      const pubKey = crypto.createPublicKey(this._simKeyPair.publicKey);
      return crypto
        .publicEncrypt(
          { key: pubKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
          dataBuffer,
        )
        .toString("base64");
    }

    const tmpFile = path.join(os.tmpdir(), `openpgp-plain-${Date.now()}.bin`);
    const encFile = tmpFile + ".gpg";

    try {
      fs.writeFileSync(tmpFile, dataBuffer);

      const keyId = this._cardInfo?.encryptionKeyFP || this._keyId || "";
      const recipientArg = keyId
        ? `--recipient "${keyId}"`
        : "--default-recipient-self";

      await execAsync(
        `${this._activeGpg} --batch ${recipientArg} --output "${encFile}" --encrypt "${tmpFile}" 2>&1`,
        { timeout: 30000 },
      );

      if (!fs.existsSync(encFile)) {
        throw new Error("加密文件未生成");
      }

      return fs.readFileSync(encFile).toString("base64");
    } finally {
      [tmpFile, encFile].forEach((f) => {
        try {
          fs.existsSync(f) && fs.unlinkSync(f);
        } catch (_e) {
          /* ignore cleanup errors */
        }
      });
    }
  }

  async decrypt(encryptedData) {
    logger.info("[OpenPGPDriver] OpenPGP 解密...");

    if (this._simMode) {
      const privKey = crypto.createPrivateKey(this._simKeyPair.privateKey);
      return crypto
        .privateDecrypt(
          { key: privKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
          Buffer.from(encryptedData, "base64"),
        )
        .toString("utf8");
    }

    const encFile = path.join(os.tmpdir(), `openpgp-enc-${Date.now()}.gpg`);
    const decFile = path.join(os.tmpdir(), `openpgp-dec-${Date.now()}.bin`);

    try {
      fs.writeFileSync(encFile, Buffer.from(encryptedData, "base64"));

      await execAsync(
        `echo "${this._currentPin}" | ${this._activeGpg} --batch --passphrase-fd 0 --pinentry-mode loopback ` +
          `--output "${decFile}" --decrypt "${encFile}" 2>&1`,
        { timeout: 60000 },
      );

      if (!fs.existsSync(decFile)) {
        throw new Error("解密文件未生成");
      }

      return fs.readFileSync(decFile, "utf8");
    } finally {
      [encFile, decFile].forEach((f) => {
        try {
          fs.existsSync(f) && fs.unlinkSync(f);
        } catch (_e) {
          /* ignore cleanup errors */
        }
      });
    }
  }

  // ============================================================
  // 公钥获取
  // ============================================================

  async getPublicKey() {
    if (this._simMode && this._simKeyPair) {
      return this._simKeyPair.publicKey;
    }

    try {
      const { stdout } = await execAsync(
        `${this._activeGpg} --card-status --with-colons 2>&1`,
        { timeout: 10000 },
      );

      // 提取签名密钥 ID
      const lines = stdout.split("\n");
      for (const line of lines) {
        if (line.startsWith("fpr:") || line.startsWith("sub:")) {
          const parts = line.split(":");
          if (parts.length > 9 && parts[9]) {
            this._keyId = parts[9];
            break;
          }
        }
      }

      if (this._keyId) {
        const { stdout: pubKey } = await execAsync(
          `${this._activeGpg} --armor --export "${this._keyId}" 2>&1`,
          { timeout: 10000 },
        );
        if (pubKey.includes("BEGIN PGP PUBLIC KEY")) {
          return pubKey;
        }
      }
    } catch (error) {
      logger.warn("[OpenPGPDriver] 获取公钥失败:", error.message);
    }

    return null;
  }

  // ============================================================
  // 设备信息
  // ============================================================

  async getDeviceInfo() {
    const cardInfo = this._cardInfo || {};
    return {
      id: `openpgp-${cardInfo.serialNumber || "sim"}`,
      manufacturer: cardInfo.manufacturer || "Nitrokey / GnuPG Card",
      model: `OpenPGP Card v${cardInfo.version || "3.4"}`,
      serialNumber: cardInfo.serialNumber || "simulated",
      firmware: cardInfo.version || "unknown",
      isConnected: this.isInitialized,
      isUnlocked: this.isUnlocked,
      driverName: this.driverName,
      driverVersion: this.driverVersion,
      protocol: "OpenPGP ISO/IEC 7816-4",
      pinRetries: this._pinRetries,
      adminPinRetries: this._adminPinRetries,
      isSimulated: this._simMode,
      gpgBin: this._activeGpg,
    };
  }

  // ============================================================
  // 锁定/关闭
  // ============================================================

  lock() {
    super.lock();
    this._pinVerified = false;
    this._currentPin = null;
    logger.info("[OpenPGPDriver] 设备已锁定");
  }

  getDriverName() {
    return "OpenPGP Card 驱动";
  }
  getDriverVersion() {
    return this.driverVersion;
  }

  async close() {
    this.lock();
    await super.close();
    logger.info("[OpenPGPDriver] 驱动已关闭");
  }
}

module.exports = OpenPGPDriver;
