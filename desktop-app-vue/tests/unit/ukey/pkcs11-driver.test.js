/**
 * PKCS#11 U-Key Driver Unit Tests
 *
 * Tests for PKCS#11 hardware token driver functionality.
 * Covers RSA/SM2 operations, PIN management, cross-platform support.
 *
 * Mocking strategy: uses the `_deps` injection pattern (see
 * .claude/rules/cli-dev.md and testing.md). `vi.mock()` does not reliably
 * intercept CommonJS require() calls under Vitest's forks pool for Node
 * built-ins, so instead we reassign fields on PKCS11Driver._deps in
 * beforeEach, restoring the originals in afterAll to keep tests isolated.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";

// ============================================
// Mock function handles (reassigned per beforeEach)
// ============================================

const mockPlatform = vi.fn(() => "linux");
const mockHomedir = vi.fn(() => "/mock/home");
const mockTmpdir = vi.fn(() => "/mock/tmp");
const mockExistsSync = vi.fn((path) => {
  // Simulate library exists on Linux
  if (path.includes("/usr/lib/opensc-pkcs11.so")) {
    return true;
  }
  return false;
});
const mockUnlinkSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn(() => Buffer.from("mock-signature"));
const mockStatSync = vi.fn(() => ({ size: 16 }));

// Default execAsync mock: reproduces the old child_process.exec mock logic
// but in promisified form.
const defaultExecAsync = vi.fn(async (cmd) => {
  if (cmd.includes("--list-slots")) {
    return {
      stdout:
        "Available slots:\nSlot 0 (0x0): Test Token\n  token label: TestToken\n  token serial: 12345678",
      stderr: "",
    };
  }
  if (cmd.includes("--login") && cmd.includes("--pin")) {
    return { stdout: "Logged in successfully", stderr: "" };
  }
  if (cmd.includes("--read-object")) {
    return {
      stdout: Buffer.from("mock-public-key").toString("hex"),
      stderr: "",
    };
  }
  if (cmd.includes("--sign")) {
    return {
      stdout: Buffer.from("mock-signature").toString("hex"),
      stderr: "",
    };
  }
  return { stdout: "", stderr: "" };
});

const mockPKCS11Instance = {
  load: vi.fn(),
  C_Initialize: vi.fn(),
  C_Finalize: vi.fn(),
  C_GetSlotList: vi.fn(() => [0]),
  C_GetTokenInfo: vi.fn(() => ({
    label: "TestToken".padEnd(32, " "),
    serialNumber: "12345678".padEnd(16, " "),
    manufacturerID: "MockCorp".padEnd(32, " "),
    model: "MockModel".padEnd(16, " "),
    flags: 0x00000001,
    ulMaxPinLen: 10,
  })),
  C_GetMechanismList: vi.fn(() => [
    0x00000001, // CKM_RSA_PKCS
    0x00000040, // CKM_SHA256_RSA_PKCS
    0x80000001, // CKM_SM2
  ]),
  C_GetMechanismInfo: vi.fn(() => ({
    minKeySize: 1024,
    maxKeySize: 4096,
    flags: 0x00000001,
  })),
  C_OpenSession: vi.fn(() => 1),
  C_CloseSession: vi.fn(),
  C_Login: vi.fn(),
  C_Logout: vi.fn(),
  C_FindObjectsInit: vi.fn(),
  C_FindObjects: vi.fn(() => [100, 101]),
  C_FindObjectsFinal: vi.fn(),
  C_GetAttributeValue: vi.fn((session, handle, attrs) => {
    if (attrs.some((a) => a.type === 0x00000120)) {
      // CKA_MODULUS + CKA_PUBLIC_EXPONENT
      return [
        { type: 0x00000120, value: Buffer.alloc(256).fill(0x01) },
        { type: 0x00000122, value: Buffer.from([0x01, 0x00, 0x01]) },
      ];
    }
    if (attrs.some((a) => a.type === 0x00000100)) {
      // CKA_KEY_TYPE — default to RSA
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0x00000000, 0); // CKK_RSA
      return [{ type: 0x00000100, value: buf }];
    }
    return attrs.map((a) => ({ ...a, value: Buffer.from("test") }));
  }),
  C_SignInit: vi.fn(),
  C_Sign: vi.fn((session, data) =>
    Buffer.from("mock-signature-" + data.toString("hex").substring(0, 10)),
  ),
  C_VerifyInit: vi.fn(),
  C_Verify: vi.fn(() => true),
  C_EncryptInit: vi.fn(),
  C_Encrypt: vi.fn((session, data) =>
    Buffer.from("encrypted-" + data.toString()),
  ),
  C_DecryptInit: vi.fn(),
  C_Decrypt: vi.fn((session, data) => {
    const str = data.toString();
    return Buffer.from(str.replace("encrypted-", ""));
  }),
  C_SetPIN: vi.fn(),
};

// Import driver (real CommonJS module, no vi.mock needed)
const PKCS11Driver = require("../../../src/main/ukey/pkcs11-driver");

// Save original _deps so we can restore after all tests run
const ORIGINAL_DEPS = { ...PKCS11Driver._deps };

describe("PKCS11Driver", () => {
  let driver;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset default mock implementations (clearAllMocks wipes them)
    mockPlatform.mockImplementation(() => "linux");
    mockHomedir.mockImplementation(() => "/mock/home");
    mockTmpdir.mockImplementation(() => "/mock/tmp");
    mockExistsSync.mockImplementation((p) =>
      p.includes("/usr/lib/opensc-pkcs11.so"),
    );
    mockReadFileSync.mockImplementation(() => Buffer.from("mock-signature"));
    mockStatSync.mockImplementation(() => ({ size: 16 }));
    defaultExecAsync.mockImplementation(async (cmd) => {
      if (cmd.includes("--list-slots")) {
        return {
          stdout:
            "Available slots:\nSlot 0 (0x0): Test Token\n  token label: TestToken\n  token serial: 12345678",
          stderr: "",
        };
      }
      if (cmd.includes("--login") && cmd.includes("--pin")) {
        return { stdout: "Logged in successfully", stderr: "" };
      }
      if (cmd.includes("--read-object")) {
        return {
          stdout: Buffer.from("mock-public-key").toString("hex"),
          stderr: "",
        };
      }
      if (cmd.includes("--sign")) {
        return {
          stdout: Buffer.from("mock-signature").toString("hex"),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });
    // Reset pkcs11js instance methods to defaults
    mockPKCS11Instance.C_GetSlotList.mockImplementation(() => [0]);
    mockPKCS11Instance.C_OpenSession.mockImplementation(() => 1);
    mockPKCS11Instance.C_FindObjects.mockImplementation(() => [100, 101]);
    mockPKCS11Instance.C_Login.mockImplementation(() => {});
    mockPKCS11Instance.C_Sign.mockImplementation((session, data) =>
      Buffer.from("mock-signature-" + data.toString("hex").substring(0, 10)),
    );
    mockPKCS11Instance.C_Verify.mockImplementation(() => true);
    mockPKCS11Instance.C_Encrypt.mockImplementation((session, data) =>
      Buffer.from("encrypted-" + data.toString()),
    );
    mockPKCS11Instance.C_Decrypt.mockImplementation((session, data) => {
      const str = data.toString();
      return Buffer.from(str.replace("encrypted-", ""));
    });
    mockPKCS11Instance.C_SetPIN.mockImplementation(() => {});
    mockPKCS11Instance.C_GetTokenInfo.mockImplementation(() => ({
      label: "TestToken".padEnd(32, " "),
      serialNumber: "12345678".padEnd(16, " "),
      manufacturerID: "MockCorp".padEnd(32, " "),
      model: "MockModel".padEnd(16, " "),
      flags: 0x00000001,
      ulMaxPinLen: 10,
    }));
    mockPKCS11Instance.C_GetMechanismList.mockImplementation(() => [
      0x00000001, 0x00000040, 0x80000001,
    ]);
    mockPKCS11Instance.C_GetAttributeValue.mockImplementation(
      (session, handle, attrs) => {
        if (attrs.some((a) => a.type === 0x00000120)) {
          return [
            { type: 0x00000120, value: Buffer.alloc(256).fill(0x01) },
            { type: 0x00000122, value: Buffer.from([0x01, 0x00, 0x01]) },
          ];
        }
        if (attrs.some((a) => a.type === 0x00000100)) {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(0x00000000, 0);
          return [{ type: 0x00000100, value: buf }];
        }
        return attrs.map((a) => ({ ...a, value: Buffer.from("test") }));
      },
    );

    // Inject mocks via _deps
    PKCS11Driver._deps.os = {
      platform: mockPlatform,
      homedir: mockHomedir,
      tmpdir: mockTmpdir,
    };
    PKCS11Driver._deps.fs = {
      existsSync: mockExistsSync,
      unlinkSync: mockUnlinkSync,
      writeFileSync: mockWriteFileSync,
      readFileSync: mockReadFileSync,
      statSync: mockStatSync,
    };
    PKCS11Driver._deps.execAsync = defaultExecAsync;
    PKCS11Driver._deps.loadPkcs11js = () => ({
      PKCS11: vi.fn(() => mockPKCS11Instance),
    });

    driver = new PKCS11Driver();
  });

  afterEach(() => {
    if (driver) {
      driver.clearSensitiveData();
      driver = null;
    }
  });

  afterAll(() => {
    // Restore real deps so other test files aren't affected
    PKCS11Driver._deps.os = ORIGINAL_DEPS.os;
    PKCS11Driver._deps.fs = ORIGINAL_DEPS.fs;
    PKCS11Driver._deps.execAsync = ORIGINAL_DEPS.execAsync;
    PKCS11Driver._deps.loadPkcs11js = ORIGINAL_DEPS.loadPkcs11js;
  });

  // Basic constructor tests that don't depend on mocks
  describe("Constructor (basic)", () => {
    it("should initialize with default config", () => {
      expect(driver.driverName).toBe("PKCS11");
      expect(driver.driverVersion).toBe("2.0.0");
      expect(driver.isConnected).toBe(false);
      expect(driver.sessionHandle).toBeNull();
    });

    it("should accept custom library path", () => {
      const customDriver = new PKCS11Driver({
        libraryPath: "/custom/path/pkcs11.so",
      });

      expect(customDriver.libraryPath).toBe("/custom/path/pkcs11.so");
    });

    it("should initialize PIN management state", () => {
      expect(driver.pinRetryCount).toBeNull();
      expect(driver.maxPinRetries).toBe(10);
      expect(driver.currentPin).toBeNull();
    });

    it("should initialize key cache", () => {
      expect(driver.privateKeyHandle).toBeNull();
      expect(driver.publicKeyHandle).toBeNull();
      expect(driver.publicKeyPEM).toBeNull();
    });

    it("should initialize supported mechanisms", () => {
      expect(driver.supportedMechanisms).toEqual([]);
      expect(driver.supportsSM2).toBe(false);
    });

    it("should set pkcs11 to null initially", () => {
      expect(driver.pkcs11).toBeNull();
    });

    it("should default to not using CLI fallback", () => {
      expect(driver.useCLIFallback).toBe(false);
    });
  });

  describe("findPKCS11Library", () => {
    it("should find OpenSC library on Linux", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation(
        (p) => p === "/usr/lib/opensc-pkcs11.so",
      );

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe("/usr/lib/opensc-pkcs11.so");
    });

    it("should search multiple paths on macOS", () => {
      mockPlatform.mockImplementation(() => "darwin");
      mockExistsSync.mockImplementation(
        (p) => p === "/Library/OpenSC/lib/opensc-pkcs11.so",
      );

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe(
        "/Library/OpenSC/lib/opensc-pkcs11.so",
      );
    });

    it("should search Windows paths", () => {
      mockPlatform.mockImplementation(() => "win32");
      mockExistsSync.mockImplementation(
        (p) =>
          p ===
          "C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
      );

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe(
        "C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
      );
    });

    it("should return first path as default if none found", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation(() => false);

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe("/usr/lib/opensc-pkcs11.so");
    });

    it("should handle YubiKey library on Linux", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation((p) => p === "/usr/lib/libykcs11.so");

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe("/usr/lib/libykcs11.so");
    });

    it("should handle SoftHSM for testing", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation(
        (p) => p === "/usr/lib/softhsm/libsofthsm2.so",
      );

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe("/usr/lib/softhsm/libsofthsm2.so");
    });

    it("should handle unknown platform gracefully", () => {
      mockPlatform.mockImplementation(() => "freebsd");

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBeNull();
    });
  });

  describe("initialize", () => {
    it("should initialize with pkcs11-js when library exists", async () => {
      mockExistsSync.mockImplementation(() => true);

      await driver.initialize();

      expect(driver.isInitialized).toBe(true);
      expect(driver.pkcs11).not.toBeNull();
      expect(mockPKCS11Instance.load).toHaveBeenCalled();
      expect(mockPKCS11Instance.C_Initialize).toHaveBeenCalled();
    });

    it("should use CLI fallback when library not found", async () => {
      driver.libraryPath = null;

      await driver.initialize();

      expect(driver.useCLIFallback).toBe(true);
      expect(driver.isInitialized).toBe(true);
    });

    it("should use CLI fallback when library path does not exist", async () => {
      driver.libraryPath = "/nonexistent/path.so";
      mockExistsSync.mockImplementation(() => false);

      await driver.initialize();

      expect(driver.useCLIFallback).toBe(true);
    });

    it("should load supported mechanisms after init (after detect)", async () => {
      mockExistsSync.mockImplementation(() => true);

      await driver.initialize();
      // Mechanisms only load once a slot is known (after detect)
      await driver.detect();

      expect(driver.supportedMechanisms.length).toBeGreaterThan(0);
    });

    it("should handle pkcs11-js module not available", async () => {
      mockExistsSync.mockImplementation(() => true);
      PKCS11Driver._deps.loadPkcs11js = () => {
        throw new Error("Module not found");
      };

      await driver.initialize();

      expect(driver.useCLIFallback).toBe(true);
    });
  });

  describe("loadSupportedMechanisms", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect(); // populates slotId
    });

    it("should detect RSA_PKCS mechanism", async () => {
      await driver.loadSupportedMechanisms();

      expect(driver.supportedMechanisms).toContain(0x00000001);
    });

    it("should detect SHA256_RSA_PKCS mechanism", async () => {
      await driver.loadSupportedMechanisms();

      expect(driver.supportedMechanisms).toContain(0x00000040);
    });

    it("should detect SM2 support", async () => {
      await driver.loadSupportedMechanisms();

      expect(driver.supportsSM2).toBe(true);
    });
  });

  describe("detect", () => {
    it("should detect token with PKCS11", async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();

      const result = await driver.detect();

      expect(result.detected).toBe(true);
      expect(driver.slotId).toBe(0);
      expect(driver.tokenLabel).toContain("TestToken");
    });

    it("should detect token with CLI fallback", async () => {
      driver.libraryPath = null;
      await driver.initialize();

      const result = await driver.detect();

      expect(result.detected).toBe(true);
    });

    it("should return detected:false if no slots available", async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      mockPKCS11Instance.C_GetSlotList.mockImplementation(() => []);

      const result = await driver.detect();

      expect(result.detected).toBe(false);
      expect(result.reason).toBe("no_token");
    });
  });

  describe("verifyPIN", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
    });

    it("should verify correct PIN with PKCS11", async () => {
      const result = await driver.verifyPIN("123456");

      expect(result.success).toBe(true);
      expect(mockPKCS11Instance.C_Login).toHaveBeenCalled();
    });

    it("should handle incorrect PIN", async () => {
      mockPKCS11Instance.C_Login.mockImplementation(() => {
        const error = new Error("PIN incorrect");
        error.code = 0x000000a0; // CKR_PIN_INCORRECT
        throw error;
      });

      const result = await driver.verifyPIN("wrong");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("pin_incorrect");
    });

    it("should handle locked PIN", async () => {
      mockPKCS11Instance.C_Login.mockImplementation(() => {
        const error = new Error("PIN locked");
        error.code = 0x000000a4; // CKR_PIN_LOCKED
        throw error;
      });

      const result = await driver.verifyPIN("123456");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("pin_locked");
      expect(result.retriesRemaining).toBe(0);
    });

    it("should track PIN retry count", async () => {
      mockPKCS11Instance.C_Login.mockImplementation(() => {
        const error = new Error("PIN incorrect");
        error.code = 0x000000a0;
        throw error;
      });

      await driver.verifyPIN("wrong");

      expect(driver.pinRetryCount).toBeLessThan(10);
    });

    it("should open session before login", async () => {
      await driver.verifyPIN("123456");

      expect(mockPKCS11Instance.C_OpenSession).toHaveBeenCalled();
      expect(driver.sessionHandle).toBe(1);
    });

    it("should set isConnected after successful verification", async () => {
      await driver.verifyPIN("123456");

      expect(driver.isConnected).toBe(true);
    });
  });

  describe("findKeys", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
    });

    it("should find private and public keys", async () => {
      await driver.findKeys();

      expect(driver.privateKeyHandle).not.toBeNull();
      expect(driver.publicKeyHandle).not.toBeNull();
    });

    it("should call C_FindObjectsInit for private key", async () => {
      await driver.findKeys();

      expect(mockPKCS11Instance.C_FindObjectsInit).toHaveBeenCalled();
    });

    it("should call C_FindObjectsFinal after search", async () => {
      await driver.findKeys();

      expect(mockPKCS11Instance.C_FindObjectsFinal).toHaveBeenCalled();
    });

    it("should handle no keys found", async () => {
      mockPKCS11Instance.C_FindObjects.mockImplementation(() => []);

      // Fresh driver to avoid cached keys from beforeEach's verifyPIN call
      const freshDriver = new PKCS11Driver();
      freshDriver.libraryPath = "/usr/lib/opensc-pkcs11.so";
      await freshDriver.initialize();
      await freshDriver.detect();
      freshDriver.sessionHandle = 1; // simulate post-login

      await freshDriver.findKeys();

      expect(freshDriver.privateKeyHandle).toBeNull();
    });
  });

  describe("exportPublicKey", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();
    });

    it("should export RSA public key to PEM", async () => {
      driver.publicKeyPEM = null; // force re-export
      await driver.exportPublicKey();

      expect(driver.publicKeyPEM).toContain("-----BEGIN RSA PUBLIC KEY-----");
      expect(driver.publicKeyPEM).toContain("-----END RSA PUBLIC KEY-----");
    });

    it("should cache exported public key", async () => {
      driver.publicKeyPEM = null;
      await driver.exportPublicKey();
      const pem1 = driver.publicKeyPEM;
      await driver.exportPublicKey();
      const pem2 = driver.publicKeyPEM;

      expect(pem1).toBe(pem2);
    });

    it("should get modulus and exponent from token", async () => {
      driver.publicKeyPEM = null;
      await driver.exportPublicKey();

      expect(mockPKCS11Instance.C_GetAttributeValue).toHaveBeenCalled();
    });
  });

  describe("sign", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();
    });

    it("should sign data with RSA (returns base64 string)", async () => {
      const data = Buffer.from("test data");
      const signature = await driver.sign(data);

      expect(typeof signature).toBe("string");
      expect(signature.length).toBeGreaterThan(0);
    });

    it("should call C_Sign", async () => {
      const data = Buffer.from("test data");
      await driver.sign(data);

      expect(mockPKCS11Instance.C_Sign).toHaveBeenCalled();
    });

    it("should handle signing errors", async () => {
      mockPKCS11Instance.C_Sign.mockImplementation(() => {
        throw new Error("Signing failed");
      });

      const data = Buffer.from("test data");
      await expect(driver.sign(data)).rejects.toThrow("Signing failed");
    });

    // Original test expected sign to throw when private key is null, but the
    // current source lazily calls findKeys() which finds one via the default
    // mock. To test the "no private key" path we must also return [] from
    // C_FindObjects.
    it("should require private key", async () => {
      driver.privateKeyHandle = null;
      mockPKCS11Instance.C_FindObjects.mockImplementation(() => []);

      const data = Buffer.from("test");
      await expect(driver.sign(data)).rejects.toThrow();
    });
  });

  describe("verifySignature", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();
    });

    it("should verify valid signature", async () => {
      const data = Buffer.from("test data");
      const signature = Buffer.from("mock-signature").toString("base64");

      const result = await driver.verifySignature(data, signature);

      expect(result).toBe(true);
    });

    it("should call C_Verify", async () => {
      const data = Buffer.from("test data");
      const signature = Buffer.from("signature").toString("base64");

      await driver.verifySignature(data, signature);

      expect(mockPKCS11Instance.C_Verify).toHaveBeenCalled();
    });

    it("should return false for invalid signature", async () => {
      mockPKCS11Instance.C_Verify.mockImplementation(() => {
        throw new Error("bad signature");
      });

      const data = Buffer.from("test data");
      const signature = Buffer.from("bad-signature").toString("base64");

      const result = await driver.verifySignature(data, signature);

      expect(result).toBe(false);
    });

    // Note: the source's verifySignature falls back to Node crypto verify
    // when publicKeyHandle is null, so it resolves to false rather than
    // throwing. Adjusted expectation accordingly.
    it("should return false when no public key available", async () => {
      driver.publicKeyHandle = null;
      driver.publicKeyPEM = null;

      const data = Buffer.from("test");
      const sig = Buffer.from("sig").toString("base64");
      const result = await driver.verifySignature(data, sig);

      expect(result).toBe(false);
    });
  });

  describe("encrypt", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();
    });

    it("should encrypt data with RSA (returns base64 string)", async () => {
      const plaintext = Buffer.from("secret data");
      const encrypted = await driver.encrypt(plaintext);

      expect(typeof encrypted).toBe("string");
      // base64 of "encrypted-secret data"
      expect(Buffer.from(encrypted, "base64").toString()).toContain(
        "encrypted-",
      );
    });

    it("should call C_Encrypt", async () => {
      const data = Buffer.from("test");
      await driver.encrypt(data);

      expect(mockPKCS11Instance.C_Encrypt).toHaveBeenCalled();
    });

    // When publicKeyHandle is null, the source's encrypt() falls back to
    // encryptWithCLI (see guard `this.pkcs11 && this.publicKeyHandle`). The
    // CLI path fails if the pubkey file can't be exported — simulate that.
    it("should propagate failure when CLI cannot export public key", async () => {
      driver.publicKeyHandle = null;
      // existsSync returns false for the pubkey temp file → CLI throws
      mockExistsSync.mockImplementation(() => false);

      await expect(driver.encrypt(Buffer.from("test"))).rejects.toThrow();
    });
  });

  describe("decrypt", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();
    });

    it("should decrypt data with RSA (returns utf8 string)", async () => {
      // Source decrypts base64 input; mock C_Decrypt strips "encrypted-" prefix
      const plaintext = "test";
      const encryptedInput = Buffer.from("encrypted-" + plaintext).toString(
        "base64",
      );
      const decrypted = await driver.decrypt(encryptedInput);

      expect(typeof decrypted).toBe("string");
      expect(decrypted).toBe(plaintext);
    });

    it("should call C_Decrypt", async () => {
      const data = Buffer.from("encrypted-data").toString("base64");
      await driver.decrypt(data);

      expect(mockPKCS11Instance.C_Decrypt).toHaveBeenCalled();
    });

    // When privateKeyHandle is null, decrypt() falls back to decryptWithCLI
    // (guard `this.pkcs11 && this.privateKeyHandle`). The CLI path fails if
    // the output file cannot be read — simulate that.
    it("should propagate failure when CLI decrypt produces no output", async () => {
      driver.privateKeyHandle = null;
      mockExistsSync.mockImplementation(() => false);

      await expect(
        driver.decrypt(Buffer.from("data").toString("base64")),
      ).rejects.toThrow();
    });

    it("should handle decryption errors", async () => {
      mockPKCS11Instance.C_Decrypt.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      await expect(
        driver.decrypt(Buffer.from("data").toString("base64")),
      ).rejects.toThrow();
    });
  });

  describe("changePin", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
    });

    it("should change PIN successfully", async () => {
      const result = await driver.changePin("123456", "654321");

      expect(result.success).toBe(true);
      expect(mockPKCS11Instance.C_SetPIN).toHaveBeenCalled();
    });

    it("should return failure object when C_SetPIN throws", async () => {
      mockPKCS11Instance.C_SetPIN.mockImplementation(() => {
        throw new Error("Old PIN incorrect");
      });

      const result = await driver.changePin("wrong", "new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Old PIN incorrect");
    });

    // Note: the source's changePin does NOT automatically call
    // clearSensitiveData on success — it only updates currentPin if it
    // matches the old PIN. Test adjusted to reflect actual behavior.
    it("should update currentPin when changing (CLI-mode state)", async () => {
      driver.currentPin = "123456";
      await driver.changePin("123456", "654321");

      expect(driver.currentPin).toBe("654321");
    });
  });

  describe("getDeviceInfo", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
    });

    it("should return device information", async () => {
      const info = await driver.getDeviceInfo();

      expect(info).toHaveProperty("driverName");
      expect(info).toHaveProperty("driverVersion");
      expect(info.driverName).toBe("PKCS11");
    });

    it("should include token model/label", async () => {
      const info = await driver.getDeviceInfo();

      // After detect(), tokenInfo.model overrides model. Either should contain
      // one of the mock values.
      expect(info.model).toBeTruthy();
    });

    it("should include token serial", async () => {
      const info = await driver.getDeviceInfo();

      expect(info.serialNumber).toBeDefined();
    });

    it("should indicate SM2 support when set", async () => {
      driver.supportsSM2 = true;

      const info = await driver.getDeviceInfo();

      expect(info.supportsSM2).toBe(true);
    });
  });

  describe("disconnect", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
    });

    it("should logout from session", async () => {
      await driver.disconnect();

      expect(mockPKCS11Instance.C_Logout).toHaveBeenCalled();
    });

    it("should close session", async () => {
      await driver.disconnect();

      expect(mockPKCS11Instance.C_CloseSession).toHaveBeenCalled();
    });

    it("should clear session handle", async () => {
      await driver.disconnect();

      expect(driver.sessionHandle).toBeNull();
    });

    it("should set isConnected to false", async () => {
      await driver.disconnect();

      expect(driver.isConnected).toBe(false);
    });

    it("should clear sensitive data", async () => {
      await driver.disconnect();

      expect(driver.currentPin).toBeNull();
      expect(driver.privateKeyHandle).toBeNull();
    });
  });

  describe("clearSensitiveData", () => {
    it("should clear currentPin", () => {
      driver.currentPin = "123456";
      driver.clearSensitiveData();

      expect(driver.currentPin).toBeNull();
    });

    it("should clear private key handle", () => {
      driver.privateKeyHandle = 100;
      driver.clearSensitiveData();

      expect(driver.privateKeyHandle).toBeNull();
    });

    // Note: clearSensitiveData does NOT clear sessionHandle by design
    it("should not clear session handle (managed by connect/disconnect)", () => {
      driver.sessionHandle = 1;
      driver.clearSensitiveData();

      expect(driver.sessionHandle).toBe(1);
    });

    it("should be safe to call multiple times", () => {
      driver.clearSensitiveData();
      driver.clearSensitiveData();

      expect(driver.currentPin).toBeNull();
    });
  });

  describe("close", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
    });

    it("should finalize PKCS11 library", async () => {
      await driver.close();

      expect(mockPKCS11Instance.C_Finalize).toHaveBeenCalled();
    });

    it("should clear pkcs11 instance", async () => {
      await driver.close();

      expect(driver.pkcs11).toBeNull();
    });

    it("should set isInitialized to false", async () => {
      await driver.close();

      expect(driver.isInitialized).toBe(false);
    });

    it("should handle already closed state", async () => {
      await driver.close();
      await driver.close();

      expect(driver.isInitialized).toBe(false);
    });
  });

  describe("CLI Fallback Mode", () => {
    beforeEach(async () => {
      driver.libraryPath = null;
      await driver.initialize();
    });

    it("should use CLI for detect", async () => {
      const result = await driver.detect();

      expect(defaultExecAsync).toHaveBeenCalled();
      expect(result.detected).toBe(true);
    });

    it("should use CLI for verifyPIN", async () => {
      await driver.detect();

      const result = await driver.verifyPIN("123456");

      expect(result.success).toBe(true);
    });

    it("should use CLI for sign (returns base64 string)", async () => {
      await driver.detect();
      await driver.verifyPIN("123456");

      // Make fs.existsSync return true for the signature file so sign() can
      // read it back.
      mockExistsSync.mockImplementation(() => true);

      const data = Buffer.from("test");
      const signature = await driver.sign(data);

      expect(typeof signature).toBe("string");
    });

    it("should clean up temp files after CLI operations", async () => {
      await driver.detect();
      await driver.verifyPIN("123456");

      mockExistsSync.mockImplementation(() => true);

      const data = Buffer.from("test");
      await driver.sign(data);

      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should allow null data to propagate through sign", async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();

      // null data is not a Buffer so Buffer.from(null, "utf8") throws
      await expect(driver.sign(null)).rejects.toThrow();
    });

    it("should handle empty buffer in encrypt", async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();

      const result = await driver.encrypt(Buffer.alloc(0));

      expect(typeof result).toBe("string");
    });

    it("should handle disconnect without connection", async () => {
      await driver.initialize();

      await expect(driver.disconnect()).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
    });

    it("should handle getDeviceInfo before detect", async () => {
      await driver.initialize();

      const info = await driver.getDeviceInfo();

      expect(info.model).toBe("Unknown");
    });

    // Source's findKeys is defensive: returns early (no throw) when session
    // is missing. Adjusted test accordingly.
    it("should handle findKeys without session (returns without throwing)", async () => {
      await driver.initialize();
      await driver.detect();
      driver.sessionHandle = null;

      await expect(driver.findKeys()).resolves.toBeUndefined();
    });
  });

  describe("Platform-Specific Paths", () => {
    it("should handle macOS eToken library", () => {
      mockPlatform.mockReturnValue("darwin");
      mockExistsSync.mockImplementation(
        (p) =>
          p ===
          "/Library/Frameworks/eToken.framework/Versions/Current/libeToken.dylib",
      );

      const macDriver = new PKCS11Driver();
      expect(macDriver.libraryPath).toContain("eToken");
    });

    it("should handle Windows Aladdin eToken", () => {
      mockPlatform.mockReturnValue("win32");
      mockExistsSync.mockImplementation(
        (p) => p === "C:\\Windows\\System32\\eTPKCS11.dll",
      );

      const winDriver = new PKCS11Driver();
      expect(winDriver.libraryPath).toContain("eTPKCS11.dll");
    });

    it("should handle Linux x86_64 path", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation(
        (p) => p === "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
      );

      const linuxDriver = new PKCS11Driver();
      expect(linuxDriver.libraryPath).toContain("x86_64-linux-gnu");
    });
  });

  describe("getDriverName and getDriverVersion", () => {
    it("should return driver name", () => {
      expect(driver.getDriverName()).toBe("PKCS11");
    });

    it("should return driver version", () => {
      expect(driver.getDriverVersion()).toBe("2.0.0");
    });
  });

  describe("Lock", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
    });

    it("should logout when locked if session exists", () => {
      expect(driver.pkcs11).not.toBeNull();
      expect(driver.sessionHandle).not.toBeNull();

      driver.lock();

      expect(mockPKCS11Instance.C_Logout).toHaveBeenCalled();
    });

    it("should set isUnlocked to false", () => {
      driver.isUnlocked = true;
      driver.lock();

      expect(driver.isUnlocked).toBe(false);
    });

    it("should clear sensitive data", () => {
      driver.currentPin = "123456";
      driver.lock();

      expect(driver.currentPin).toBeNull();
    });

    it("should handle lock when session not established", () => {
      driver.pkcs11 = null;
      driver.sessionHandle = null;

      expect(() => driver.lock()).not.toThrow();
      expect(driver.isUnlocked).toBe(false);
    });
  });
});
