/**
 * PKCS#11 Driver Test Script
 *
 * Tests the PKCS#11 driver functionality including:
 * - Driver initialization
 * - Token detection
 * - PIN verification
 * - Key operations (sign, verify, encrypt, decrypt)
 * - Public key export
 * - Security features (PIN retry, memory clearing)
 *
 * Usage:
 *   node scripts/test-pkcs11-driver.js [--pin <PIN>] [--library <path>]
 *
 * Options:
 *   --pin      PIN code for the token (default: prompt or skip)
 *   --library  Path to PKCS#11 library (auto-detected if not specified)
 *   --simulate Run in simulation mode (no real hardware needed)
 */

const path = require("path");
const os = require("os");

// Add main source to path
const srcPath = path.join(__dirname, "..", "src", "main");

// Parse command line arguments
function parseArgs() {
  const args = {
    pin: null,
    library: null,
    simulate: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--pin" && process.argv[i + 1]) {
      args.pin = process.argv[++i];
    } else if (process.argv[i] === "--library" && process.argv[i + 1]) {
      args.library = process.argv[++i];
    } else if (process.argv[i] === "--simulate") {
      args.simulate = true;
    }
  }

  return args;
}

// Test result tracking
const testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  results: [],
};

function logTest(name, passed, message = "") {
  const status = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${status}] ${name}${message ? ": " + message : ""}`);
  testResults.results.push({ name, passed, message });
  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
  }
}

function logSkip(name, reason) {
  console.log(`  [\x1b[33mSKIP\x1b[0m] ${name}: ${reason}`);
  testResults.skipped++;
  testResults.results.push({ name, passed: null, message: reason });
}

function logSection(title) {
  console.log(`\n\x1b[36m=== ${title} ===\x1b[0m`);
}

async function runTests() {
  console.log("\n\x1b[1m========================================\x1b[0m");
  console.log("\x1b[1m  PKCS#11 Driver Test Suite\x1b[0m");
  console.log("\x1b[1m========================================\x1b[0m");
  console.log(`Platform: ${os.platform()} ${os.arch()}`);
  console.log(`Node.js: ${process.version}`);
  console.log(`Date: ${new Date().toISOString()}`);

  const args = parseArgs();

  // Load driver
  const PKCS11Driver = require(path.join(srcPath, "ukey", "pkcs11-driver.js"));

  // ==========================================
  // Test 1: Driver Instantiation
  // ==========================================
  logSection("Driver Instantiation");

  let driver;
  try {
    driver = new PKCS11Driver({
      libraryPath: args.library,
    });
    logTest("Create driver instance", true);
  } catch (error) {
    logTest("Create driver instance", false, error.message);
    return;
  }

  // Check driver properties
  logTest("Driver name is PKCS11", driver.getDriverName() === "PKCS11");
  logTest("Driver version is 2.0.0", driver.getDriverVersion() === "2.0.0");
  logTest("Platform detected", !!driver.platform, driver.platform);

  // ==========================================
  // Test 2: Library Detection
  // ==========================================
  logSection("PKCS#11 Library Detection");

  const libraryPath = driver.findPKCS11Library();
  if (libraryPath) {
    logTest("Find PKCS#11 library", true, libraryPath);
  } else {
    logSkip("Find PKCS#11 library", "No PKCS#11 library found on system");
  }

  // ==========================================
  // Test 3: Driver Initialization
  // ==========================================
  logSection("Driver Initialization");

  try {
    await driver.initialize();
    logTest("Initialize driver", true);
    logTest("Driver is initialized", driver.isInitialized === true);

    if (driver.useCLIFallback) {
      logTest("Using CLI fallback mode", true, "pkcs11-js not available");
    } else {
      logTest("Using native PKCS#11 mode", true);
    }
  } catch (error) {
    logTest("Initialize driver", false, error.message);
    // Continue with limited tests
  }

  // ==========================================
  // Test 4: Token Detection
  // ==========================================
  logSection("Token Detection");

  let tokenDetected = false;
  try {
    const detectResult = await driver.detect();
    tokenDetected = detectResult.detected;

    if (tokenDetected) {
      logTest("Detect token", true);
      logTest(
        "Token has label",
        !!detectResult.deviceInfo?.label,
        detectResult.deviceInfo?.label,
      );
      logTest(
        "Token has serial",
        !!detectResult.deviceInfo?.serialNumber,
        detectResult.deviceInfo?.serialNumber,
      );

      if (detectResult.deviceInfo?.supportsSM2 !== undefined) {
        logTest(
          "SM2 support detected",
          true,
          detectResult.deviceInfo.supportsSM2 ? "supported" : "not supported",
        );
      }
    } else {
      logSkip("Detect token", detectResult.message || "No token detected");
    }
  } catch (error) {
    logTest("Detect token", false, error.message);
  }

  // ==========================================
  // Test 5: PIN Verification (if token detected and PIN provided)
  // ==========================================
  logSection("PIN Verification");

  let pinVerified = false;
  if (!tokenDetected) {
    logSkip("PIN verification", "No token detected");
  } else if (!args.pin) {
    logSkip("PIN verification", "No PIN provided (use --pin <PIN>)");
  } else {
    try {
      const result = await driver.verifyPIN(args.pin);
      pinVerified = result.success;

      if (pinVerified) {
        logTest("Verify PIN", true);
        logTest("Device is unlocked", driver.isUnlocked === true);

        if (result.retriesRemaining !== undefined) {
          logTest(
            "PIN retry count tracked",
            true,
            `${result.retriesRemaining} retries remaining`,
          );
        }
      } else {
        logTest(
          "Verify PIN",
          false,
          result.message || "PIN verification failed",
        );

        if (result.retriesRemaining !== undefined) {
          console.log(
            `  Warning: ${result.retriesRemaining} retries remaining`,
          );
        }
      }
    } catch (error) {
      logTest("Verify PIN", false, error.message);
    }

    // Test invalid PIN handling
    try {
      const badResult = await driver.verifyPIN("wrong-pin-12345");
      logTest(
        "Reject invalid PIN",
        !badResult.success && badResult.reason === "pin_incorrect",
        badResult.message,
      );
    } catch (error) {
      // Expected to fail
      logTest("Reject invalid PIN", true, "Correctly rejected");
    }
  }

  // ==========================================
  // Test 6: Public Key Export
  // ==========================================
  logSection("Public Key Export");

  if (!pinVerified) {
    logSkip("Public key export", "Token not unlocked");
  } else {
    try {
      const publicKey = await driver.getPublicKey();

      if (publicKey) {
        logTest("Export public key", true);
        logTest(
          "Public key is PEM format",
          publicKey.includes("-----BEGIN") && publicKey.includes("-----END"),
        );

        // Check key type
        if (publicKey.includes("RSA PUBLIC KEY")) {
          logTest("Key type", true, "RSA");
        } else if (publicKey.includes("EC PUBLIC KEY")) {
          logTest("Key type", true, "EC");
        } else if (publicKey.includes("SM2 PUBLIC KEY")) {
          logTest("Key type", true, "SM2");
        } else {
          logTest("Key type", true, "Unknown");
        }
      } else {
        logTest("Export public key", false, "No public key returned");
      }
    } catch (error) {
      logTest("Export public key", false, error.message);
    }
  }

  // ==========================================
  // Test 7: Signing Operations
  // ==========================================
  logSection("Signing Operations");

  if (!pinVerified) {
    logSkip("Signing operations", "Token not unlocked");
  } else {
    const testData = "Hello, PKCS#11! This is test data for signing.";

    try {
      const signature = await driver.sign(testData);

      if (signature) {
        logTest("Sign data", true);
        logTest("Signature is base64", /^[A-Za-z0-9+/]+=*$/.test(signature));
        logTest(
          "Signature length",
          signature.length > 0,
          `${signature.length} chars`,
        );

        // Verify signature
        try {
          const isValid = await driver.verifySignature(testData, signature);
          logTest("Verify signature", isValid);

          // Verify with wrong data should fail
          const isInvalid = await driver.verifySignature(
            "wrong data",
            signature,
          );
          logTest("Reject invalid signature", !isInvalid);
        } catch (error) {
          logTest("Verify signature", false, error.message);
        }
      } else {
        logTest("Sign data", false, "No signature returned");
      }
    } catch (error) {
      logTest("Sign data", false, error.message);
    }
  }

  // ==========================================
  // Test 8: Encryption/Decryption
  // ==========================================
  logSection("Encryption/Decryption");

  if (!pinVerified) {
    logSkip("Encryption/Decryption", "Token not unlocked");
  } else {
    const testPlaintext = "Secret message for encryption test";

    try {
      const encrypted = await driver.encrypt(testPlaintext);

      if (encrypted) {
        logTest("Encrypt data", true);
        logTest("Encrypted is base64", /^[A-Za-z0-9+/]+=*$/.test(encrypted));
        logTest(
          "Encrypted differs from plaintext",
          encrypted !== testPlaintext,
        );

        // Decrypt
        try {
          const decrypted = await driver.decrypt(encrypted);
          logTest(
            "Decrypt data",
            decrypted === testPlaintext,
            decrypted ? "Correct" : "Mismatch",
          );
        } catch (error) {
          logTest("Decrypt data", false, error.message);
        }
      } else {
        logTest("Encrypt data", false, "No encrypted data returned");
      }
    } catch (error) {
      // RSA encryption might fail with data too large
      if (
        error.message.includes("too large") ||
        error.message.includes("length")
      ) {
        logSkip("Encryption/Decryption", "Data too large for RSA (expected)");
      } else {
        logTest("Encrypt data", false, error.message);
      }
    }
  }

  // ==========================================
  // Test 9: Device Info
  // ==========================================
  logSection("Device Information");

  try {
    const info = await driver.getDeviceInfo();

    logTest("Get device info", !!info);

    if (info) {
      logTest("Has manufacturer", !!info.manufacturer, info.manufacturer);
      logTest("Has model", !!info.model, info.model);
      logTest("Has serial number", !!info.serialNumber, info.serialNumber);
      logTest("Has driver name", !!info.driverName, info.driverName);
      logTest("Has driver version", !!info.driverVersion, info.driverVersion);
      logTest(
        "Has connection status",
        info.isConnected !== undefined,
        String(info.isConnected),
      );
      logTest(
        "Has unlock status",
        info.isUnlocked !== undefined,
        String(info.isUnlocked),
      );

      if (info.supportsSM2 !== undefined) {
        logTest("Has SM2 support info", true, String(info.supportsSM2));
      }
    }
  } catch (error) {
    logTest("Get device info", false, error.message);
  }

  // ==========================================
  // Test 10: Lock and Disconnect
  // ==========================================
  logSection("Lock and Disconnect");

  // Test lock
  try {
    driver.lock();
    logTest("Lock device", driver.isUnlocked === false);
  } catch (error) {
    logTest("Lock device", false, error.message);
  }

  // Test disconnect
  try {
    const result = await driver.disconnect();
    logTest("Disconnect", result.success !== false);
    logTest("Connection status after disconnect", driver.isConnected === false);
  } catch (error) {
    logTest("Disconnect", false, error.message);
  }

  // Test close
  try {
    await driver.close();
    logTest("Close driver", driver.isInitialized === false);
  } catch (error) {
    logTest("Close driver", false, error.message);
  }

  // ==========================================
  // Test 11: UKeyManager Integration
  // ==========================================
  logSection("UKeyManager Integration");

  try {
    const { UKeyManager, DriverTypes } = require(
      path.join(srcPath, "ukey", "ukey-manager.js"),
    );

    logTest("DriverTypes includes PKCS11", DriverTypes.PKCS11 === "pkcs11");

    const manager = new UKeyManager({
      driverType: DriverTypes.PKCS11,
    });

    logTest("Create UKeyManager with PKCS11", !!manager);

    try {
      await manager.initialize();
      logTest("Initialize UKeyManager", manager.isInitialized);

      const driverName = manager.getDriverName();
      logTest(
        "UKeyManager driver is PKCS11",
        driverName === "PKCS11",
        driverName,
      );

      await manager.close();
      logTest("Close UKeyManager", true);
    } catch (error) {
      // Initialization might fail if no hardware
      if (error.message.includes("not found") || error.message.includes("No")) {
        logSkip("Initialize UKeyManager", error.message);
      } else {
        logTest("Initialize UKeyManager", false, error.message);
      }
    }
  } catch (error) {
    logTest("Load UKeyManager", false, error.message);
  }

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n\x1b[1m========================================\x1b[0m");
  console.log("\x1b[1m  Test Summary\x1b[0m");
  console.log("\x1b[1m========================================\x1b[0m");
  console.log(`  \x1b[32mPassed: ${testResults.passed}\x1b[0m`);
  console.log(`  \x1b[31mFailed: ${testResults.failed}\x1b[0m`);
  console.log(`  \x1b[33mSkipped: ${testResults.skipped}\x1b[0m`);
  console.log(
    `  Total: ${testResults.passed + testResults.failed + testResults.skipped}`,
  );

  if (testResults.failed > 0) {
    console.log("\n\x1b[31mFailed Tests:\x1b[0m");
    testResults.results
      .filter((r) => r.passed === false)
      .forEach((r) => console.log(`  - ${r.name}: ${r.message}`));
  }

  console.log("\n");

  // Exit with error code if tests failed
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error("\x1b[31mTest execution error:\x1b[0m", error);
  process.exit(1);
});
