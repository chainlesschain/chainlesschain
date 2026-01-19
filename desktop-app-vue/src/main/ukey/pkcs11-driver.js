/**
 * PKCS#11 U-Key Driver
 *
 * Cross-platform hardware token driver using PKCS#11 standard
 *
 * Supports:
 * - macOS: OpenSC, YubiKey, etc.
 * - Linux: OpenSC, SoftHSM, etc.
 * - Windows: OpenSC (as alternative to native drivers)
 *
 * PKCS#11 is the industry standard for cryptographic tokens
 * Supported by most hardware security tokens and smart cards
 *
 * Features:
 * - RSA and SM2 (Chinese national algorithm) support
 * - PIN retry counting and secure memory clearing
 * - Both pkcs11-js and CLI fallback modes
 */

const { logger, createLogger } = require('../utils/logger.js');
const BaseUKeyDriver = require("./base-driver");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================
// PKCS#11 Constants (Cryptoki)
// ============================================

const CKO = {
  // Object classes
  DATA: 0x00000000,
  CERTIFICATE: 0x00000001,
  PUBLIC_KEY: 0x00000002,
  PRIVATE_KEY: 0x00000003,
  SECRET_KEY: 0x00000004,
};

const CKA = {
  // Common attributes
  CLASS: 0x00000000,
  TOKEN: 0x00000001,
  PRIVATE: 0x00000002,
  LABEL: 0x00000003,
  VALUE: 0x00000011,
  ID: 0x00000102,
  // Key attributes
  KEY_TYPE: 0x00000100,
  ENCRYPT: 0x00000104,
  DECRYPT: 0x00000105,
  SIGN: 0x00000108,
  VERIFY: 0x0000010a,
  MODULUS: 0x00000120,
  PUBLIC_EXPONENT: 0x00000122,
};

const CKK = {
  // Key types
  RSA: 0x00000000,
  DSA: 0x00000001,
  EC: 0x00000003,
  SM2: 0x80000001, // Vendor-defined for SM2
};

const CKM = {
  // Mechanisms
  RSA_PKCS: 0x00000001,
  RSA_X_509: 0x00000003,
  SHA1_RSA_PKCS: 0x00000006,
  SHA256_RSA_PKCS: 0x00000040,
  SHA384_RSA_PKCS: 0x00000041,
  SHA512_RSA_PKCS: 0x00000042,
  // SM2 mechanisms (vendor-defined)
  SM2: 0x80000001,
  SM2_SM3: 0x80000002,
  SM4_ECB: 0x80000010,
  SM4_CBC: 0x80000011,
};

const CKF = {
  // Session flags
  RW_SESSION: 0x00000002,
  SERIAL_SESSION: 0x00000004,
};

const CKU = {
  // User types
  SO: 0, // Security Officer
  USER: 1,
  CONTEXT_SPECIFIC: 2,
};

const CKR = {
  // Return values
  OK: 0x00000000,
  PIN_INCORRECT: 0x000000a0,
  PIN_LOCKED: 0x000000a4,
  PIN_EXPIRED: 0x000000a3,
  USER_NOT_LOGGED_IN: 0x00000101,
  KEY_NOT_FOUND: 0x00000002,
};

// ============================================
// PKCS#11 Driver Class
// ============================================

class PKCS11Driver extends BaseUKeyDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = "PKCS11";
    this.driverVersion = "2.0.0";
    this.platform = os.platform();

    // PKCS#11 library path
    this.libraryPath = config.libraryPath || this.findPKCS11Library();

    // Token info
    this.tokenLabel = null;
    this.tokenSerial = null;
    this.slotId = null;
    this.tokenInfo = null;

    // Session
    this.sessionHandle = null;
    this.isConnected = false;

    // PIN management
    this.pinRetryCount = null;
    this.maxPinRetries = 10;
    this.currentPin = null; // For CLI mode only, cleared after use

    // Key cache
    this.privateKeyHandle = null;
    this.publicKeyHandle = null;
    this.publicKeyPEM = null;

    // Algorithm support
    this.supportedMechanisms = [];
    this.supportsSM2 = false;

    // Use pkcs11-js for Node.js PKCS#11 bindings
    this.pkcs11 = null;
    this.useCLIFallback = false;
  }

  /**
   * Find PKCS#11 library on system
   */
  findPKCS11Library() {
    const searchPaths = {
      darwin: [
        "/Library/OpenSC/lib/opensc-pkcs11.so",
        "/usr/local/lib/opensc-pkcs11.so",
        "/usr/local/lib/pkcs11/opensc-pkcs11.so",
        "/Library/Frameworks/eToken.framework/Versions/Current/libeToken.dylib",
        "/usr/local/lib/libykcs11.dylib", // YubiKey
      ],
      linux: [
        "/usr/lib/opensc-pkcs11.so",
        "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
        "/usr/lib/x86_64-linux-gnu/pkcs11/opensc-pkcs11.so",
        "/usr/local/lib/opensc-pkcs11.so",
        "/usr/lib/pkcs11/opensc-pkcs11.so",
        "/usr/lib/softhsm/libsofthsm2.so", // SoftHSM for testing
        "/usr/lib/libykcs11.so", // YubiKey
      ],
      win32: [
        "C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
        "C:\\Program Files (x86)\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
        "C:\\Windows\\System32\\eTPKCS11.dll", // Aladdin eToken
        "C:\\Windows\\System32\\eps2003csp11.dll", // EnterSafe
        "C:\\Program Files\\Yubico\\Yubico PIV Tool\\bin\\libykcs11.dll", // YubiKey
      ],
    };

    const paths = searchPaths[this.platform] || [];

    for (const libPath of paths) {
      if (fs.existsSync(libPath)) {
        logger.info(`[PKCS11Driver] Found library: ${libPath}`);
        return libPath;
      }
    }

    // Return first path as default (will fail gracefully if not found)
    return paths[0] || null;
  }

  /**
   * Initialize driver
   */
  async initialize() {
    logger.info("[PKCS11Driver] Initializing PKCS#11 driver...");

    try {
      // Check if library exists
      if (!this.libraryPath) {
        logger.warn(
          "[PKCS11Driver] No PKCS#11 library configured, using CLI fallback",
        );
        this.useCLIFallback = true;
      } else if (!fs.existsSync(this.libraryPath)) {
        logger.warn(
          `[PKCS11Driver] Library not found: ${this.libraryPath}, using CLI fallback`,
        );
        this.useCLIFallback = true;
      }

      // Try to load pkcs11-js module
      if (!this.useCLIFallback) {
        try {
          const pkcs11js = require("pkcs11js");
          this.pkcs11 = new pkcs11js.PKCS11();
          this.pkcs11.load(this.libraryPath);
          this.pkcs11.C_Initialize();

          logger.info("[PKCS11Driver] PKCS#11 library loaded successfully");

          // Get supported mechanisms
          await this.loadSupportedMechanisms();
        } catch (error) {
          logger.warn(
            "[PKCS11Driver] pkcs11-js not available:",
            error.message,
          );
          logger.warn("[PKCS11Driver] Using CLI fallback mode");
          this.pkcs11 = null;
          this.useCLIFallback = true;
        }
      }

      this.isInitialized = true;
      logger.info("[PKCS11Driver] Initialization complete");

      return true;
    } catch (error) {
      logger.error("[PKCS11Driver] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Load supported mechanisms from token
   */
  async loadSupportedMechanisms() {
    if (!this.pkcs11 || this.slotId === null) {return;}

    try {
      const mechanisms = this.pkcs11.C_GetMechanismList(this.slotId);
      this.supportedMechanisms = mechanisms;

      // Check for SM2 support
      this.supportsSM2 = mechanisms.some(
        (m) => m === CKM.SM2 || m === CKM.SM2_SM3,
      );

      logger.info(
        `[PKCS11Driver] Supported mechanisms: ${mechanisms.length}, SM2: ${this.supportsSM2}`,
      );
    } catch (error) {
      logger.warn("[PKCS11Driver] Failed to load mechanisms:", error.message);
    }
  }

  /**
   * Detect available tokens (implements BaseUKeyDriver.detect)
   */
  async detect() {
    logger.info("[PKCS11Driver] Detecting tokens...");

    try {
      if (this.pkcs11) {
        return await this.detectWithPKCS11();
      } else {
        return await this.detectWithCLI();
      }
    } catch (error) {
      logger.error("[PKCS11Driver] Detection failed:", error);
      return {
        detected: false,
        reason: "detection_error",
        message: error.message,
      };
    }
  }

  /**
   * Detect using pkcs11-js
   */
  async detectWithPKCS11() {
    const slots = this.pkcs11.C_GetSlotList(true); // true = only slots with tokens

    if (slots.length === 0) {
      return {
        detected: false,
        reason: "no_token",
        message: "No PKCS#11 tokens detected",
      };
    }

    // Use first slot with token
    this.slotId = slots[0];

    try {
      const tokenInfo = this.pkcs11.C_GetTokenInfo(this.slotId);
      this.tokenLabel = tokenInfo.label.trim();
      this.tokenSerial = tokenInfo.serialNumber.trim();
      this.tokenInfo = tokenInfo;

      // Get PIN retry count if available
      if (tokenInfo.flags !== undefined) {
        // Check if token has PIN retry counter
        this.pinRetryCount =
          tokenInfo.ulMaxPinLen > 0 ? this.maxPinRetries : null;
      }

      logger.info(
        `[PKCS11Driver] Detected token: ${this.tokenLabel} (Serial: ${this.tokenSerial})`,
      );

      // Load supported mechanisms
      await this.loadSupportedMechanisms();

      return {
        detected: true,
        deviceInfo: {
          label: this.tokenLabel,
          serialNumber: this.tokenSerial,
          manufacturer: tokenInfo.manufacturerID?.trim() || "Unknown",
          model: tokenInfo.model?.trim() || "PKCS#11 Token",
          driverName: this.driverName,
          driverVersion: this.driverVersion,
          supportsSM2: this.supportsSM2,
        },
      };
    } catch (error) {
      logger.error("[PKCS11Driver] Failed to get token info:", error);
      return {
        detected: false,
        reason: "token_error",
        message: error.message,
      };
    }
  }

  /**
   * Detect using CLI tools (fallback)
   */
  async detectWithCLI() {
    try {
      const { stdout, stderr } = await execAsync(
        "pkcs11-tool --list-slots 2>&1",
        {
          timeout: 10000,
        },
      );

      const output = stdout + (stderr || "");

      // Parse output to find token
      // Example: "Slot 0 (0x0): ... token label: MyToken"
      const slotMatch = output.match(
        /Slot\s+(\d+).*?token label\s*:\s*(.+?)(?:\n|$)/is,
      );

      if (slotMatch) {
        this.slotId = parseInt(slotMatch[1]);
        this.tokenLabel = slotMatch[2].trim();

        // Try to get serial number
        const serialMatch = output.match(/token serial\s*:\s*(.+?)(?:\n|$)/i);
        this.tokenSerial = serialMatch ? serialMatch[1].trim() : "Unknown";

        logger.info(
          `[PKCS11Driver] Detected token via CLI: ${this.tokenLabel}`,
        );

        return {
          detected: true,
          deviceInfo: {
            label: this.tokenLabel,
            serialNumber: this.tokenSerial,
            manufacturer: "Unknown",
            model: "PKCS#11 Token (CLI)",
            driverName: this.driverName,
            driverVersion: this.driverVersion,
            supportsSM2: false, // Unknown in CLI mode
          },
        };
      }

      // Check if no slots found
      if (output.includes("No slots") || output.includes("0 slots")) {
        return {
          detected: false,
          reason: "no_token",
          message: "No PKCS#11 tokens detected",
        };
      }

      return {
        detected: false,
        reason: "parse_error",
        message: "Failed to parse pkcs11-tool output",
      };
    } catch (error) {
      // Check if pkcs11-tool is not installed
      if (
        error.message.includes("not found") ||
        error.message.includes("not recognized")
      ) {
        return {
          detected: false,
          reason: "tool_not_installed",
          message: "pkcs11-tool not installed. Please install OpenSC.",
        };
      }

      return {
        detected: false,
        reason: "cli_error",
        message: error.message,
      };
    }
  }

  /**
   * Verify PIN (implements BaseUKeyDriver.verifyPIN)
   */
  async verifyPIN(pin) {
    logger.info("[PKCS11Driver] Verifying PIN...");

    if (!pin || typeof pin !== "string") {
      return {
        success: false,
        reason: "invalid_pin",
        message: "PIN must be a non-empty string",
      };
    }

    try {
      if (this.pkcs11) {
        return await this.verifyPINWithPKCS11(pin);
      } else {
        return await this.verifyPINWithCLI(pin);
      }
    } catch (error) {
      logger.error("[PKCS11Driver] PIN verification failed:", error);
      return {
        success: false,
        reason: "verification_error",
        message: error.message,
        retriesRemaining: this.pinRetryCount,
      };
    }
  }

  /**
   * Verify PIN using pkcs11-js
   */
  async verifyPINWithPKCS11(pin) {
    // First detect if not already done
    if (this.slotId === null) {
      const detectResult = await this.detect();
      if (!detectResult.detected) {
        return {
          success: false,
          reason: "no_device",
          message: "No token detected",
        };
      }
    }

    try {
      // Open session
      this.sessionHandle = this.pkcs11.C_OpenSession(
        this.slotId,
        CKF.SERIAL_SESSION | CKF.RW_SESSION,
      );

      // Login with PIN
      this.pkcs11.C_Login(this.sessionHandle, CKU.USER, pin);

      this.isConnected = true;
      this.isUnlocked = true;
      this.pinRetryCount = this.maxPinRetries; // Reset retry count on success

      // Find and cache keys
      await this.findKeys();

      logger.info("[PKCS11Driver] PIN verified successfully");

      return {
        success: true,
        deviceInfo: await this.getDeviceInfo(),
        retriesRemaining: this.pinRetryCount,
      };
    } catch (error) {
      // Handle specific PKCS#11 errors
      const errorCode = error.code || 0;

      if (errorCode === CKR.PIN_INCORRECT) {
        this.pinRetryCount = Math.max(
          0,
          (this.pinRetryCount || this.maxPinRetries) - 1,
        );
        return {
          success: false,
          reason: "pin_incorrect",
          message: "Incorrect PIN",
          retriesRemaining: this.pinRetryCount,
        };
      }

      if (errorCode === CKR.PIN_LOCKED) {
        this.pinRetryCount = 0;
        return {
          success: false,
          reason: "pin_locked",
          message: "Token is locked due to too many failed attempts",
          retriesRemaining: 0,
        };
      }

      throw error;
    }
  }

  /**
   * Verify PIN using CLI
   */
  async verifyPINWithCLI(pin) {
    try {
      // Use --test-login to verify PIN without performing operations
      const { stdout, stderr } = await execAsync(
        `pkcs11-tool --login --pin "${pin}" --list-objects --type privkey 2>&1`,
        { timeout: 15000 },
      );

      const output = stdout + (stderr || "");

      // Check for errors
      if (
        output.includes("CKR_PIN_INCORRECT") ||
        output.includes("incorrect")
      ) {
        this.pinRetryCount = Math.max(
          0,
          (this.pinRetryCount || this.maxPinRetries) - 1,
        );
        return {
          success: false,
          reason: "pin_incorrect",
          message: "Incorrect PIN",
          retriesRemaining: this.pinRetryCount,
        };
      }

      if (output.includes("CKR_PIN_LOCKED") || output.includes("locked")) {
        this.pinRetryCount = 0;
        return {
          success: false,
          reason: "pin_locked",
          message: "Token is locked",
          retriesRemaining: 0,
        };
      }

      if (
        output.includes("error") &&
        !output.includes("Using slot") // This is not an error
      ) {
        return {
          success: false,
          reason: "verification_error",
          message: "PIN verification failed",
        };
      }

      // Success - store PIN for subsequent CLI operations
      this.currentPin = pin;
      this.isConnected = true;
      this.isUnlocked = true;
      this.pinRetryCount = this.maxPinRetries;

      logger.info("[PKCS11Driver] PIN verified via CLI");

      return {
        success: true,
        deviceInfo: await this.getDeviceInfo(),
        retriesRemaining: this.pinRetryCount,
      };
    } catch (error) {
      return {
        success: false,
        reason: "cli_error",
        message: error.message,
      };
    }
  }

  /**
   * Find and cache key handles
   */
  async findKeys() {
    if (!this.pkcs11 || !this.sessionHandle) {return;}

    try {
      // Find private key
      this.pkcs11.C_FindObjectsInit(this.sessionHandle, [
        { type: CKA.CLASS, value: CKO.PRIVATE_KEY },
        { type: CKA.SIGN, value: true },
      ]);

      const privateKeys = this.pkcs11.C_FindObjects(this.sessionHandle, 10);
      this.pkcs11.C_FindObjectsFinal(this.sessionHandle);

      if (privateKeys.length > 0) {
        this.privateKeyHandle = privateKeys[0];
        logger.info(
          `[PKCS11Driver] Found ${privateKeys.length} private key(s)`,
        );
      }

      // Find public key
      this.pkcs11.C_FindObjectsInit(this.sessionHandle, [
        { type: CKA.CLASS, value: CKO.PUBLIC_KEY },
      ]);

      const publicKeys = this.pkcs11.C_FindObjects(this.sessionHandle, 10);
      this.pkcs11.C_FindObjectsFinal(this.sessionHandle);

      if (publicKeys.length > 0) {
        this.publicKeyHandle = publicKeys[0];
        logger.info(`[PKCS11Driver] Found ${publicKeys.length} public key(s)`);

        // Export public key
        await this.exportPublicKey();
      }
    } catch (error) {
      logger.warn("[PKCS11Driver] Failed to find keys:", error.message);
    }
  }

  /**
   * Export public key in PEM format
   */
  async exportPublicKey() {
    if (!this.pkcs11 || !this.publicKeyHandle) {return;}

    try {
      // Get key type
      const keyTypeAttr = this.pkcs11.C_GetAttributeValue(
        this.sessionHandle,
        this.publicKeyHandle,
        [{ type: CKA.KEY_TYPE }],
      );

      const keyType = keyTypeAttr[0].value.readUInt32LE(0);

      if (keyType === CKK.RSA) {
        // Get RSA modulus and exponent
        const attrs = this.pkcs11.C_GetAttributeValue(
          this.sessionHandle,
          this.publicKeyHandle,
          [{ type: CKA.MODULUS }, { type: CKA.PUBLIC_EXPONENT }],
        );

        const modulus = attrs[0].value;
        const exponent = attrs[1].value;

        // Convert to PEM (simplified - in production use ASN.1 encoding)
        this.publicKeyPEM = this.rsaToPEM(modulus, exponent);
        logger.info("[PKCS11Driver] RSA public key exported");
      } else if (keyType === CKK.EC || keyType === CKK.SM2) {
        // For EC/SM2 keys, get EC point
        const attrs = this.pkcs11.C_GetAttributeValue(
          this.sessionHandle,
          this.publicKeyHandle,
          [{ type: CKA.VALUE }],
        );

        // Convert EC point to PEM
        this.publicKeyPEM = this.ecToPEM(attrs[0].value, keyType === CKK.SM2);
        logger.info("[PKCS11Driver] EC/SM2 public key exported");
      }
    } catch (error) {
      logger.warn(
        "[PKCS11Driver] Failed to export public key:",
        error.message,
      );
    }
  }

  /**
   * Convert RSA modulus/exponent to PEM format
   */
  rsaToPEM(modulus, exponent) {
    // Create DER encoded RSA public key
    const modulusHex = modulus.toString("hex");
    const exponentHex = exponent.toString("hex");

    // ASN.1 sequence for RSA public key
    const derHex =
      "30" +
      this.asn1Length(modulusHex.length / 2 + exponentHex.length / 2 + 4) +
      "02" +
      this.asn1Length(modulusHex.length / 2) +
      modulusHex +
      "02" +
      this.asn1Length(exponentHex.length / 2) +
      exponentHex;

    const der = Buffer.from(derHex, "hex");
    const base64 = der.toString("base64");

    // Format as PEM
    const lines = [];
    for (let i = 0; i < base64.length; i += 64) {
      lines.push(base64.substring(i, i + 64));
    }

    return `-----BEGIN RSA PUBLIC KEY-----\n${lines.join("\n")}\n-----END RSA PUBLIC KEY-----`;
  }

  /**
   * ASN.1 length encoding
   */
  asn1Length(len) {
    if (len < 128) {
      return len.toString(16).padStart(2, "0");
    } else if (len < 256) {
      return "81" + len.toString(16).padStart(2, "0");
    } else {
      return "82" + len.toString(16).padStart(4, "0");
    }
  }

  /**
   * Convert EC point to PEM format (simplified)
   */
  ecToPEM(ecPoint, isSM2) {
    // This is a simplified version - in production, use proper ASN.1 encoding
    const base64 = ecPoint.toString("base64");
    const keyType = isSM2 ? "SM2 PUBLIC KEY" : "EC PUBLIC KEY";

    const lines = [];
    for (let i = 0; i < base64.length; i += 64) {
      lines.push(base64.substring(i, i + 64));
    }

    return `-----BEGIN ${keyType}-----\n${lines.join("\n")}\n-----END ${keyType}-----`;
  }

  /**
   * Get public key (implements BaseUKeyDriver.getPublicKey)
   */
  async getPublicKey() {
    if (this.publicKeyPEM) {
      return this.publicKeyPEM;
    }

    if (this.pkcs11 && this.isConnected) {
      await this.findKeys();
      return this.publicKeyPEM;
    }

    // CLI fallback
    if (this.useCLIFallback && this.currentPin) {
      return await this.getPublicKeyWithCLI();
    }

    throw new Error("Not connected or public key not available");
  }

  /**
   * Get public key using CLI
   */
  async getPublicKeyWithCLI() {
    const tempFile = path.join(os.tmpdir(), `pkcs11-pubkey-${Date.now()}.pem`);

    try {
      await execAsync(
        `pkcs11-tool --login --pin "${this.currentPin}" --read-object --type pubkey -o "${tempFile}" 2>&1`,
        { timeout: 15000 },
      );

      if (fs.existsSync(tempFile)) {
        const keyData = fs.readFileSync(tempFile, "utf8");
        this.publicKeyPEM = keyData;
        return keyData;
      }

      throw new Error("Failed to export public key");
    } finally {
      this.cleanupTempFile(tempFile);
    }
  }

  /**
   * Disconnect from token
   */
  async disconnect() {
    logger.info("[PKCS11Driver] Disconnecting...");

    try {
      if (this.pkcs11 && this.sessionHandle) {
        try {
          this.pkcs11.C_Logout(this.sessionHandle);
        } catch (e) {
          // Ignore logout errors
        }
        this.pkcs11.C_CloseSession(this.sessionHandle);
        this.sessionHandle = null;
      }

      this.isConnected = false;
      this.isUnlocked = false;

      // Securely clear sensitive data
      this.clearSensitiveData();

      logger.info("[PKCS11Driver] Disconnected");
      return { success: true };
    } catch (error) {
      logger.error("[PKCS11Driver] Disconnect error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear sensitive data from memory
   */
  clearSensitiveData() {
    // Clear PIN from memory
    if (this.currentPin) {
      // Overwrite with random data before clearing
      this.currentPin = crypto
        .randomBytes(this.currentPin.length)
        .toString("hex");
      this.currentPin = null;
    }

    // Clear key handles
    this.privateKeyHandle = null;
    this.publicKeyHandle = null;
  }

  /**
   * Get device information
   */
  async getDeviceInfo() {
    const baseInfo = {
      manufacturer: "PKCS#11 Token",
      model: this.tokenLabel || "Unknown",
      serialNumber: this.tokenSerial || "Unknown",
      firmwareVersion: "1.0",
      driverName: this.driverName,
      driverVersion: this.driverVersion,
      isConnected: this.isConnected,
      isUnlocked: this.isUnlocked,
      platform: this.platform,
      libraryPath: this.libraryPath,
      useCLIFallback: this.useCLIFallback,
      supportsSM2: this.supportsSM2,
      pinRetryCount: this.pinRetryCount,
    };

    if (this.tokenInfo) {
      baseInfo.manufacturer =
        this.tokenInfo.manufacturerID?.trim() || baseInfo.manufacturer;
      baseInfo.model = this.tokenInfo.model?.trim() || baseInfo.model;
    }

    return baseInfo;
  }

  /**
   * Sign data using token (implements BaseUKeyDriver.sign)
   */
  async sign(data) {
    if (!this.isConnected || !this.isUnlocked) {
      throw new Error("Not connected or not unlocked");
    }

    logger.info("[PKCS11Driver] Signing data...");

    try {
      if (this.pkcs11) {
        return await this.signWithPKCS11(data);
      } else {
        return await this.signWithCLI(data);
      }
    } catch (error) {
      logger.error("[PKCS11Driver] Signing failed:", error);
      throw new Error(`Signing failed: ${error.message}`);
    }
  }

  /**
   * Sign using pkcs11-js
   */
  async signWithPKCS11(data) {
    if (!this.privateKeyHandle) {
      await this.findKeys();
      if (!this.privateKeyHandle) {
        throw new Error("No private key found on token");
      }
    }

    // Determine mechanism based on key type and token capabilities
    let mechanism = CKM.SHA256_RSA_PKCS;

    if (this.supportsSM2) {
      mechanism = CKM.SM2_SM3;
    }

    // Hash the data first if using raw mechanism
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();

    // Sign
    this.pkcs11.C_SignInit(
      this.sessionHandle,
      { mechanism },
      this.privateKeyHandle,
    );
    const signature = this.pkcs11.C_Sign(this.sessionHandle, hash);

    logger.info("[PKCS11Driver] Signature created");
    return signature.toString("base64");
  }

  /**
   * Sign using CLI
   */
  async signWithCLI(data) {
    const tempDir = os.tmpdir();
    const dataFile = path.join(tempDir, `pkcs11-sign-data-${Date.now()}.bin`);
    const sigFile = path.join(tempDir, `pkcs11-sign-sig-${Date.now()}.bin`);

    try {
      // Hash the data
      const dataBuffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data, "utf8");
      const hash = crypto.createHash("sha256").update(dataBuffer).digest();
      fs.writeFileSync(dataFile, hash);

      // Sign using pkcs11-tool
      await execAsync(
        `pkcs11-tool --login --pin "${this.currentPin}" --sign --mechanism RSA-PKCS --input-file "${dataFile}" --output-file "${sigFile}" 2>&1`,
        { timeout: 30000 },
      );

      if (!fs.existsSync(sigFile)) {
        throw new Error("Signature file not created");
      }

      const signature = fs.readFileSync(sigFile);
      logger.info("[PKCS11Driver] CLI signature created");
      return signature.toString("base64");
    } finally {
      this.cleanupTempFile(dataFile);
      this.cleanupTempFile(sigFile);
    }
  }

  /**
   * Verify signature (implements BaseUKeyDriver.verifySignature)
   */
  async verifySignature(data, signature) {
    logger.info("[PKCS11Driver] Verifying signature...");

    try {
      if (this.pkcs11 && this.publicKeyHandle) {
        return await this.verifySignatureWithPKCS11(data, signature);
      } else {
        // Use Node.js crypto for verification if we have the public key
        return await this.verifySignatureWithCrypto(data, signature);
      }
    } catch (error) {
      logger.error("[PKCS11Driver] Verification failed:", error);
      return false;
    }
  }

  /**
   * Verify using pkcs11-js
   */
  async verifySignatureWithPKCS11(data, signature) {
    let mechanism = CKM.SHA256_RSA_PKCS;
    if (this.supportsSM2) {
      mechanism = CKM.SM2_SM3;
    }

    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const hash = crypto.createHash("sha256").update(dataBuffer).digest();
    const sigBuffer = Buffer.from(signature, "base64");

    this.pkcs11.C_VerifyInit(
      this.sessionHandle,
      { mechanism },
      this.publicKeyHandle,
    );

    try {
      this.pkcs11.C_Verify(this.sessionHandle, hash, sigBuffer);
      logger.info("[PKCS11Driver] Signature verified");
      return true;
    } catch (error) {
      logger.info("[PKCS11Driver] Signature verification failed");
      return false;
    }
  }

  /**
   * Verify using Node.js crypto
   */
  async verifySignatureWithCrypto(data, signature) {
    if (!this.publicKeyPEM) {
      logger.warn("[PKCS11Driver] No public key available for verification");
      return false;
    }

    try {
      const dataBuffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data, "utf8");
      const sigBuffer = Buffer.from(signature, "base64");

      const verifier = crypto.createVerify("SHA256");
      verifier.update(dataBuffer);
      verifier.end();

      const isValid = verifier.verify(this.publicKeyPEM, sigBuffer);
      logger.info(`[PKCS11Driver] Crypto verification result: ${isValid}`);
      return isValid;
    } catch (error) {
      logger.warn("[PKCS11Driver] Crypto verification error:", error.message);
      return false;
    }
  }

  /**
   * Encrypt data (implements BaseUKeyDriver.encrypt)
   */
  async encrypt(data) {
    if (!this.isConnected) {
      throw new Error("Not connected to token");
    }

    logger.info("[PKCS11Driver] Encrypting data...");

    try {
      if (this.pkcs11 && this.publicKeyHandle) {
        return await this.encryptWithPKCS11(data);
      } else {
        return await this.encryptWithCLI(data);
      }
    } catch (error) {
      logger.error("[PKCS11Driver] Encryption failed:", error);
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt using pkcs11-js
   */
  async encryptWithPKCS11(data) {
    if (!this.publicKeyHandle) {
      await this.findKeys();
      if (!this.publicKeyHandle) {
        throw new Error("No public key found on token");
      }
    }

    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

    // Use RSA-PKCS for encryption
    this.pkcs11.C_EncryptInit(
      this.sessionHandle,
      { mechanism: CKM.RSA_PKCS },
      this.publicKeyHandle,
    );
    const encrypted = this.pkcs11.C_Encrypt(this.sessionHandle, dataBuffer);

    return encrypted.toString("base64");
  }

  /**
   * Encrypt using CLI tools (fallback)
   */
  async encryptWithCLI(data) {
    const tempDir = os.tmpdir();
    const pubKeyFile = path.join(tempDir, `pkcs11-pubkey-${Date.now()}.pem`);
    const dataFile = path.join(tempDir, `pkcs11-data-${Date.now()}.txt`);
    const encFile = path.join(tempDir, `pkcs11-enc-${Date.now()}.bin`);

    try {
      // Step 1: Export public key from token
      logger.info("[PKCS11Driver] Exporting public key from token...");
      await execAsync(
        `pkcs11-tool --login --pin "${this.currentPin}" --read-object --type pubkey -o "${pubKeyFile}" 2>&1`,
        { timeout: 15000 },
      );

      if (!fs.existsSync(pubKeyFile)) {
        throw new Error("Failed to export public key from token");
      }

      // Step 2: Write data to temp file
      const dataBuffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data, "utf8");
      fs.writeFileSync(dataFile, dataBuffer);

      // Step 3: Encrypt using OpenSSL with RSA public key
      logger.info("[PKCS11Driver] Encrypting with OpenSSL...");
      await execAsync(
        `openssl pkeyutl -encrypt -pubin -inkey "${pubKeyFile}" -in "${dataFile}" -out "${encFile}" 2>&1`,
        { timeout: 15000 },
      );

      if (!fs.existsSync(encFile)) {
        throw new Error("Encryption failed - no output file");
      }

      const encryptedData = fs.readFileSync(encFile);
      logger.info("[PKCS11Driver] CLI encryption successful");
      return encryptedData.toString("base64");
    } finally {
      this.cleanupTempFile(pubKeyFile);
      this.cleanupTempFile(dataFile);
      this.cleanupTempFile(encFile);
    }
  }

  /**
   * Decrypt data (implements BaseUKeyDriver.decrypt)
   */
  async decrypt(encryptedData) {
    if (!this.isConnected || !this.isUnlocked) {
      throw new Error("Not connected or not unlocked");
    }

    logger.info("[PKCS11Driver] Decrypting data...");

    try {
      if (this.pkcs11 && this.privateKeyHandle) {
        return await this.decryptWithPKCS11(encryptedData);
      } else {
        return await this.decryptWithCLI(encryptedData);
      }
    } catch (error) {
      logger.error("[PKCS11Driver] Decryption failed:", error);
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt using pkcs11-js
   */
  async decryptWithPKCS11(encryptedData) {
    if (!this.privateKeyHandle) {
      await this.findKeys();
      if (!this.privateKeyHandle) {
        throw new Error("No private key found on token");
      }
    }

    const encBuffer = Buffer.from(encryptedData, "base64");

    this.pkcs11.C_DecryptInit(
      this.sessionHandle,
      { mechanism: CKM.RSA_PKCS },
      this.privateKeyHandle,
    );
    const decrypted = this.pkcs11.C_Decrypt(this.sessionHandle, encBuffer);

    return decrypted.toString("utf8");
  }

  /**
   * Decrypt using CLI tools (fallback)
   */
  async decryptWithCLI(encryptedData) {
    const tempDir = os.tmpdir();
    const encFile = path.join(tempDir, `pkcs11-enc-${Date.now()}.bin`);
    const decFile = path.join(tempDir, `pkcs11-dec-${Date.now()}.txt`);

    try {
      // Step 1: Write encrypted data to temp file
      const encryptedBuffer = Buffer.from(encryptedData, "base64");
      fs.writeFileSync(encFile, encryptedBuffer);

      // Step 2: Decrypt using pkcs11-tool with private key on token
      logger.info("[PKCS11Driver] Decrypting with pkcs11-tool...");
      await execAsync(
        `pkcs11-tool --login --pin "${this.currentPin}" --decrypt --mechanism RSA-PKCS --input-file "${encFile}" --output-file "${decFile}" 2>&1`,
        { timeout: 30000 },
      );

      if (!fs.existsSync(decFile)) {
        throw new Error("Decryption failed - no output file");
      }

      const decryptedData = fs.readFileSync(decFile, "utf8");
      logger.info("[PKCS11Driver] CLI decryption successful");
      return decryptedData;
    } finally {
      this.cleanupTempFile(encFile);
      this.cleanupTempFile(decFile);
    }
  }

  /**
   * Change PIN
   */
  async changePin(oldPin, newPin) {
    logger.info("[PKCS11Driver] Changing PIN...");

    try {
      if (this.pkcs11) {
        // Must be logged in
        if (!this.isConnected) {
          const result = await this.verifyPIN(oldPin);
          if (!result.success) {
            return result;
          }
        }

        this.pkcs11.C_SetPIN(this.sessionHandle, oldPin, newPin);
        logger.info("[PKCS11Driver] PIN changed successfully");

        // Update stored PIN for CLI mode
        if (this.currentPin === oldPin) {
          this.currentPin = newPin;
        }

        return { success: true };
      } else {
        // CLI fallback
        await execAsync(
          `pkcs11-tool --change-pin --pin "${oldPin}" --new-pin "${newPin}" 2>&1`,
          { timeout: 15000 },
        );

        // Update stored PIN
        if (this.currentPin === oldPin) {
          this.currentPin = newPin;
        }

        logger.info("[PKCS11Driver] PIN changed via CLI");
        return { success: true };
      }
    } catch (error) {
      logger.error("[PKCS11Driver] PIN change failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Lock device (implements BaseUKeyDriver.lock)
   */
  lock() {
    logger.info("[PKCS11Driver] Locking device...");

    try {
      if (this.pkcs11 && this.sessionHandle) {
        try {
          this.pkcs11.C_Logout(this.sessionHandle);
        } catch (e) {
          // Ignore logout errors
        }
      }
    } catch (error) {
      logger.warn("[PKCS11Driver] Error during logout:", error.message);
    }

    this.isUnlocked = false;
    this.clearSensitiveData();

    logger.info("[PKCS11Driver] Device locked");
  }

  /**
   * Close driver
   */
  async close() {
    logger.info("[PKCS11Driver] Closing driver...");

    try {
      await this.disconnect();

      if (this.pkcs11) {
        try {
          this.pkcs11.C_Finalize();
        } catch (e) {
          // Ignore finalize errors
        }
        this.pkcs11 = null;
      }

      this.isInitialized = false;
      this.slotId = null;
      this.tokenLabel = null;
      this.tokenSerial = null;
      this.publicKeyPEM = null;

      logger.info("[PKCS11Driver] Driver closed");
    } catch (error) {
      logger.error("[PKCS11Driver] Close error:", error);
    }
  }

  /**
   * Cleanup temporary file
   */
  cleanupTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        // Overwrite with zeros before deletion for security
        const stats = fs.statSync(filePath);
        fs.writeFileSync(filePath, Buffer.alloc(stats.size, 0));
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      logger.warn(`[PKCS11Driver] Failed to cleanup ${filePath}:`, e.message);
    }
  }

  /**
   * Get driver name
   */
  getDriverName() {
    return this.driverName;
  }

  /**
   * Get driver version
   */
  getDriverVersion() {
    return this.driverVersion;
  }
}

module.exports = PKCS11Driver;
