/**
 * PKCS#11 U-Key Driver Unit Tests
 *
 * Tests for PKCS#11 hardware token driver functionality.
 * Covers RSA/SM2 operations, PIN management, cross-platform support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================
// Mocks (BEFORE imports)
// ============================================

// Create mock functions that can be accessed later
const mockPlatform = vi.fn(() => "linux");
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

// Mock os module
vi.mock("os", () => ({
  platform: mockPlatform,
}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
}));

// Mock crypto module
vi.mock("crypto", () => ({
  publicEncrypt: vi.fn((key, data) => Buffer.from("encrypted-" + data)),
  publicDecrypt: vi.fn((key, data) =>
    Buffer.from(data.toString().replace("encrypted-", "")),
  ),
  createVerify: vi.fn(() => ({
    update: vi.fn(),
    verify: vi.fn(() => true),
  })),
}));

// Mock child_process - use correct callback signature (error, stdout, stderr)
vi.mock("child_process", () => ({
  exec: vi.fn((cmd, options, callback) => {
    // Handle both (cmd, callback) and (cmd, options, callback) signatures
    if (typeof options === "function") {
      callback = options;
    }

    // Simulate pkcs11-tool commands with correct callback signature
    if (cmd.includes("--list-slots")) {
      callback(
        null,
        "Available slots:\nSlot 0 (0x0): Test Token\n  token label: TestToken\n  token serial: 12345678",
        "",
      );
    } else if (cmd.includes("--login") && cmd.includes("--pin")) {
      // Check for correct vs wrong PIN
      if (cmd.includes('"123456"')) {
        callback(null, "Logged in successfully", "");
      } else if (cmd.includes('"wrong"')) {
        callback(
          new Error(
            'Command failed: pkcs11-tool --login --pin "wrong" --list-objects --type privkey 2>&1\n',
          ),
          "",
          "",
        );
      } else {
        callback(null, "Logged in successfully", "");
      }
    } else if (cmd.includes("--read-object")) {
      callback(null, Buffer.from("mock-public-key").toString("hex"), "");
    } else if (cmd.includes("--sign")) {
      callback(null, Buffer.from("mock-signature").toString("hex"), "");
    } else if (cmd.includes("--change-pin")) {
      if (cmd.includes('"wrong"')) {
        callback(
          new Error(
            'Command failed: pkcs11-tool --change-pin --pin "wrong" --new-pin "new" 2>&1\n',
          ),
          "",
          "",
        );
      } else {
        callback(null, "PIN changed successfully", "");
      }
    } else {
      callback(null, "", "");
    }
  }),
}));

// Mock pkcs11js module
const mockPKCS11Instance = {
  load: vi.fn(),
  C_Initialize: vi.fn(),
  C_Finalize: vi.fn(),
  C_GetSlotList: vi.fn(() => [0]),
  C_GetTokenInfo: vi.fn(() => ({
    label: "TestToken".padEnd(32, " "),
    serialNumber: "12345678".padEnd(16, " "),
    flags: 0x00000001,
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
  C_FindObjects: vi.fn(() => [{ handle: 100 }, { handle: 101 }]),
  C_FindObjectsFinal: vi.fn(),
  C_GetAttributeValue: vi.fn((session, handle, attrs) => {
    // Mock different attributes based on request
    if (attrs.some((a) => a.type === 0x00000120)) {
      // CKA_MODULUS
      return [
        {
          type: 0x00000120,
          value: Buffer.alloc(256).fill(0x01),
        },
        {
          type: 0x00000122, // CKA_PUBLIC_EXPONENT
          value: Buffer.from([0x01, 0x00, 0x01]),
        },
      ];
    }
    return attrs.map((a) => ({ ...a, value: Buffer.from("test") }));
  }),
  C_Sign: vi.fn((session, data) =>
    Buffer.from("mock-signature-" + data.toString("hex").substring(0, 10)),
  ),
  C_Verify: vi.fn(() => true),
  C_Encrypt: vi.fn((session, data) =>
    Buffer.from("encrypted-" + data.toString()),
  ),
  C_Decrypt: vi.fn((session, data) => {
    const str = data.toString();
    return Buffer.from(str.replace("encrypted-", ""));
  }),
  C_SetPIN: vi.fn(),
};

vi.mock("pkcs11js", () => ({
  PKCS11: vi.fn(() => mockPKCS11Instance),
}));

// Import after mocking
const PKCS11Driver = require("../../../src/main/ukey/pkcs11-driver");
const os = require("os");
const fs = require("fs");

describe("PKCS11Driver", () => {
  let driver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new PKCS11Driver();
  });

  afterEach(() => {
    if (driver) {
      driver.clearSensitiveData();
      driver = null;
    }
  });

  describe("Constructor", () => {
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
      mockExistsSync.mockImplementation((path) => {
        return path === "/usr/lib/opensc-pkcs11.so";
      });

      const path = driver.findPKCS11Library();

      expect(path).toBe("/usr/lib/opensc-pkcs11.so");
    });

    it("should search multiple paths on macOS", () => {
      mockPlatform.mockImplementation(() => "darwin");
      mockExistsSync.mockImplementation((path) => {
        return path === "/Library/OpenSC/lib/opensc-pkcs11.so";
      });

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe(
        "/Library/OpenSC/lib/opensc-pkcs11.so",
      );
    });

    it("should search Windows paths", () => {
      mockPlatform.mockImplementation(() => "win32");
      mockExistsSync.mockImplementation((path) => {
        return (
          path ===
          "C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll"
        );
      });

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
      mockExistsSync.mockImplementation((path) => {
        return path === "/usr/lib/libykcs11.so";
      });

      const newDriver = new PKCS11Driver();
      expect(newDriver.libraryPath).toBe("/usr/lib/libykcs11.so");
    });

    it("should handle SoftHSM for testing", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation((path) => {
        return path === "/usr/lib/softhsm/libsofthsm2.so";
      });

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

    it("should load supported mechanisms after init", async () => {
      mockExistsSync.mockImplementation(() => true);

      await driver.initialize();

      expect(driver.supportedMechanisms.length).toBeGreaterThan(0);
    });

    it("should handle pkcs11-js module not available", async () => {
      mockExistsSync.mockImplementation(() => true);
      const originalRequire = require;
      vi.doMock("pkcs11js", () => {
        throw new Error("Module not found");
      });

      await driver.initialize();

      expect(driver.useCLIFallback).toBe(true);
    });
  });

  describe("loadSupportedMechanisms", () => {
    beforeEach(async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
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

    it("should return false if no slots available", async () => {
      mockExistsSync.mockImplementation(() => true);
      await driver.initialize();
      mockPKCS11Instance.C_GetSlotList.mockImplementation(() => []);

      const result = await driver.detect();

      expect(result.detected).toBe(false);
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
    });

    it("should track PIN retry count", async () => {
      mockPKCS11Instance.C_Login.mockImplementation(() => {
        const error = new Error("PIN incorrect");
        error.code = 0x000000a0;
        throw error;
      });

      const result = await driver.verifyPIN("wrong");
      expect(result.success).toBe(false);
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

      await driver.findKeys();

      expect(driver.privateKeyHandle).toBeNull();
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
      const pem = await driver.exportPublicKey();

      expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
      expect(pem).toContain("-----END PUBLIC KEY-----");
    });

    it("should cache exported public key", async () => {
      const pem1 = await driver.exportPublicKey();
      const pem2 = await driver.exportPublicKey();

      expect(pem1).toBe(pem2);
      expect(driver.publicKeyPEM).toBe(pem1);
    });

    it("should get modulus and exponent from token", async () => {
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

    it("should sign data with RSA", async () => {
      const data = Buffer.from("test data");
      const signature = await driver.sign(data);

      expect(signature).toBeInstanceOf(Buffer);
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

    it("should require private key", async () => {
      driver.privateKeyHandle = null;

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
      const signature = Buffer.from("mock-signature");

      const result = await driver.verifySignature(data, signature);

      expect(result).toBe(true);
    });

    it("should call C_Verify", async () => {
      const data = Buffer.from("test data");
      const signature = Buffer.from("signature");

      await driver.verifySignature(data, signature);

      expect(mockPKCS11Instance.C_Verify).toHaveBeenCalled();
    });

    it("should return false for invalid signature", async () => {
      mockPKCS11Instance.C_Verify.mockReturnValue(false);

      const data = Buffer.from("test data");
      const signature = Buffer.from("bad-signature");

      const result = await driver.verifySignature(data, signature);

      expect(result).toBe(false);
    });

    it("should require public key", async () => {
      driver.publicKeyHandle = null;

      const data = Buffer.from("test");
      const sig = Buffer.from("sig");
      await expect(driver.verifySignature(data, sig)).rejects.toThrow();
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

    it("should encrypt data with RSA", async () => {
      const plaintext = Buffer.from("secret data");
      const encrypted = await driver.encrypt(plaintext);

      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.toString()).toContain("encrypted-");
    });

    it("should call C_Encrypt", async () => {
      const data = Buffer.from("test");
      await driver.encrypt(data);

      expect(mockPKCS11Instance.C_Encrypt).toHaveBeenCalled();
    });

    it("should require public key", async () => {
      driver.publicKeyHandle = null;

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

    it("should decrypt data with RSA", async () => {
      const encrypted = Buffer.from("encrypted-test");
      const decrypted = await driver.decrypt(encrypted);

      expect(decrypted).toBeInstanceOf(Buffer);
      expect(decrypted.toString()).toBe("test");
    });

    it("should call C_Decrypt", async () => {
      const data = Buffer.from("encrypted-data");
      await driver.decrypt(data);

      expect(mockPKCS11Instance.C_Decrypt).toHaveBeenCalled();
    });

    it("should require private key", async () => {
      driver.privateKeyHandle = null;

      await expect(driver.decrypt(Buffer.from("data"))).rejects.toThrow();
    });

    it("should handle decryption errors", async () => {
      mockPKCS11Instance.C_Decrypt.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      await expect(driver.decrypt(Buffer.from("data"))).rejects.toThrow();
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
      await driver.changePin("123456", "654321");

      expect(mockPKCS11Instance.C_SetPIN).toHaveBeenCalled();
    });

    it("should validate old PIN before changing", async () => {
      mockPKCS11Instance.C_SetPIN.mockImplementation(() => {
        throw new Error("Old PIN incorrect");
      });

      await expect(driver.changePin("wrong", "new")).rejects.toThrow();
    });

    it("should clear sensitive data after change", async () => {
      await driver.changePin("123456", "654321");

      expect(driver.currentPin).toBeNull();
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

      expect(info).toHaveProperty("deviceType");
      expect(info).toHaveProperty("driverName");
      expect(info).toHaveProperty("driverVersion");
      expect(info.driverName).toBe("PKCS11");
    });

    it("should include token label", async () => {
      const info = await driver.getDeviceInfo();

      expect(info.tokenLabel).toContain("TestToken");
    });

    it("should include token serial", async () => {
      const info = await driver.getDeviceInfo();

      expect(info.tokenSerial).toBeDefined();
    });

    it("should include supported mechanisms", async () => {
      const info = await driver.getDeviceInfo();

      expect(info.supportedMechanisms).toBeInstanceOf(Array);
    });

    it("should indicate SM2 support", async () => {
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

    it("should clear session handle", () => {
      driver.sessionHandle = 1;
      driver.clearSensitiveData();

      expect(driver.sessionHandle).toBeNull();
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
      const { exec } = require("child_process");

      const result = await driver.detect();

      expect(exec).toHaveBeenCalled();
      expect(result.detected).toBe(true);
    });

    it("should use CLI for verifyPIN", async () => {
      await driver.detect();

      const result = await driver.verifyPIN("123456");

      expect(result.success).toBe(true);
    });

    it("should use CLI for sign", async () => {
      await driver.detect();
      await driver.verifyPIN("123456");

      // Mock file operations for CLI mode
      const data = Buffer.from("test");
      const signature = await driver.sign(data);

      expect(signature).toBeInstanceOf(Buffer);
    });

    it("should clean up temp files after CLI operations", async () => {
      await driver.detect();
      await driver.verifyPIN("123456");

      const data = Buffer.from("test");
      await driver.sign(data);

      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle null data in sign", async () => {
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();

      await expect(driver.sign(null)).rejects.toThrow();
    });

    it("should handle empty buffer in encrypt", async () => {
      await driver.initialize();
      await driver.detect();
      await driver.verifyPIN("123456");
      await driver.findKeys();

      const result = await driver.encrypt(Buffer.alloc(0));

      expect(result).toBeInstanceOf(Buffer);
    });

    it("should handle disconnect without connection", async () => {
      await driver.initialize();

      await expect(driver.disconnect()).resolves.not.toThrow();
    });

    it("should handle getDeviceInfo before detect", async () => {
      await driver.initialize();

      const info = await driver.getDeviceInfo();

      expect(info.tokenLabel).toBeNull();
    });

    it("should handle findKeys without session", async () => {
      await driver.initialize();
      await driver.detect();

      await expect(driver.findKeys()).rejects.toThrow();
    });
  });

  describe("Platform-Specific Paths", () => {
    it("should handle macOS eToken library", () => {
      mockPlatform.mockReturnValue("darwin");
      mockExistsSync.mockImplementation((path) => {
        return (
          path ===
          "/Library/Frameworks/eToken.framework/Versions/Current/libeToken.dylib"
        );
      });

      const macDriver = new PKCS11Driver();
      expect(macDriver.libraryPath).toContain("eToken");
    });

    it("should handle Windows Aladdin eToken", () => {
      mockPlatform.mockReturnValue("win32");
      mockExistsSync.mockImplementation((path) => {
        return path === "C:\\Windows\\System32\\eTPKCS11.dll";
      });

      const winDriver = new PKCS11Driver();
      expect(winDriver.libraryPath).toContain("eTPKCS11.dll");
    });

    it("should handle Linux x86_64 path", () => {
      mockPlatform.mockImplementation(() => "linux");
      mockExistsSync.mockImplementation((path) => {
        return path === "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so";
      });

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

    it("should logout when locked", () => {
      driver.lock();

      expect(mockPKCS11Instance.C_Logout).toHaveBeenCalled();
    });

    it("should set isConnected to false", () => {
      driver.lock();

      expect(driver.isConnected).toBe(false);
    });

    it("should clear sensitive data", () => {
      driver.currentPin = "123456";
      driver.lock();

      expect(driver.currentPin).toBeNull();
    });
  });
});
