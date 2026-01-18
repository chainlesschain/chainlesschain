/**
 * Signal Session Manager Unit Tests
 *
 * Tests for SignalSessionManager with proper mocking
 * These tests run in Vitest and verify the manager's logic
 * without requiring actual WebCrypto operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

// Mock objects - will be populated with implementations in beforeEach
const mockKeyHelper = {
  generateIdentityKeyPair: vi.fn(),
  generateRegistrationId: vi.fn(),
  generateSignedPreKey: vi.fn(),
  generatePreKey: vi.fn(),
};

const mockSessionBuilder = {
  processPreKey: vi.fn(),
};

const mockSessionCipher = {
  encrypt: vi.fn(),
  decryptPreKeyWhisperMessage: vi.fn(),
  decryptWhisperMessage: vi.fn(),
};

// Store references to constructor mocks so we can re-apply implementations
const MockSessionBuilder = vi.fn();
const MockSessionCipher = vi.fn();
const MockSignalProtocolAddress = vi.fn();

// Mock the Signal library module
vi.mock("@privacyresearch/libsignal-protocol-typescript", () => ({
  KeyHelper: mockKeyHelper,
  SessionBuilder: MockSessionBuilder,
  SessionCipher: MockSessionCipher,
  SignalProtocolAddress: MockSignalProtocolAddress,
}));

// Helper function to setup mock implementations
// Called in beforeEach to ensure mocks are properly set after mockReset
function setupMockImplementations() {
  // Setup KeyHelper mocks
  mockKeyHelper.generateIdentityKeyPair.mockResolvedValue({
    pubKey: new ArrayBuffer(33),
    privKey: new ArrayBuffer(32),
  });

  mockKeyHelper.generateRegistrationId.mockReturnValue(12345);

  mockKeyHelper.generateSignedPreKey.mockResolvedValue({
    keyId: 1,
    keyPair: {
      pubKey: new ArrayBuffer(33),
      privKey: new ArrayBuffer(32),
    },
    signature: new ArrayBuffer(64),
  });

  mockKeyHelper.generatePreKey.mockImplementation((keyId) =>
    Promise.resolve({
      keyId,
      keyPair: {
        pubKey: new ArrayBuffer(33),
        privKey: new ArrayBuffer(32),
      },
    })
  );

  // Setup SessionBuilder constructor mock
  MockSessionBuilder.mockImplementation(() => mockSessionBuilder);
  mockSessionBuilder.processPreKey.mockResolvedValue(undefined);

  // Setup SessionCipher constructor mock
  MockSessionCipher.mockImplementation(() => mockSessionCipher);
  mockSessionCipher.encrypt.mockResolvedValue({
    type: 1,
    body: new Uint8Array([1, 2, 3, 4, 5]),
    registrationId: 12345,
  });

  mockSessionCipher.decryptPreKeyWhisperMessage.mockResolvedValue(
    new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
  );

  mockSessionCipher.decryptWhisperMessage.mockResolvedValue(
    new Uint8Array([72, 105]) // "Hi"
  );

  // Setup SignalProtocolAddress constructor mock
  MockSignalProtocolAddress.mockImplementation((name, deviceId) => ({
    getName: () => name,
    getDeviceId: () => deviceId,
    toString: () => `${name}.${deviceId}`,
  }));
}

describe("SignalSessionManager", () => {
  let SignalSessionManager;
  let testDir;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), "signal-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    // Re-apply mock implementations after vitest's mockReset
    setupMockImplementations();

    // Reset modules to ensure fresh import with mocks
    vi.resetModules();

    // Import the module (needs to be done after mocking)
    SignalSessionManager = (
      await import("../../../src/main/p2p/signal-session-manager.js")
    ).default;
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Initialization", () => {
    it("should create a new instance with default config", () => {
      const manager = new SignalSessionManager();

      expect(manager).toBeDefined();
      expect(manager.config.userId).toBe("default-user");
      expect(manager.config.deviceId).toBe(1);
      expect(manager.initialized).toBe(false);
    });

    it("should create instance with custom config", () => {
      const manager = new SignalSessionManager({
        userId: "alice",
        deviceId: 2,
        dataPath: testDir,
      });

      expect(manager.config.userId).toBe("alice");
      expect(manager.config.deviceId).toBe(2);
      expect(manager.config.dataPath).toBe(testDir);
    });

    it("should initialize successfully", async () => {
      const manager = new SignalSessionManager({
        userId: "alice",
        deviceId: 1,
      });

      await manager.initialize();

      expect(manager.initialized).toBe(true);
      expect(manager.identityKeyPair).toBeDefined();
      expect(manager.registrationId).toBe(12345);
    });

    it("should emit initialized event", async () => {
      const manager = new SignalSessionManager({
        userId: "alice",
        deviceId: 1,
      });

      const initPromise = new Promise((resolve) => {
        manager.on("initialized", resolve);
      });

      await manager.initialize();

      const event = await initPromise;
      expect(event.userId).toBe("alice");
      expect(event.deviceId).toBe(1);
    });

    it("should generate 100 pre keys", async () => {
      const manager = new SignalSessionManager({
        userId: "alice",
        deviceId: 1,
      });

      await manager.initialize();

      expect(manager.preKeys.size).toBe(100);
      expect(mockKeyHelper.generatePreKey).toHaveBeenCalledTimes(100);
    });
  });

  describe("Pre Key Bundle", () => {
    let manager;

    beforeEach(async () => {
      manager = new SignalSessionManager({
        userId: "alice",
        deviceId: 1,
      });
      await manager.initialize();
    });

    it("should get pre key bundle", async () => {
      const bundle = await manager.getPreKeyBundle();

      expect(bundle).toBeDefined();
      expect(bundle.registrationId).toBe(12345);
      expect(bundle.identityKey).toBeDefined();
      expect(bundle.signedPreKey).toBeDefined();
      expect(bundle.preKey).toBeDefined();
    });

    it("should throw if not initialized", async () => {
      const uninitManager = new SignalSessionManager();

      await expect(uninitManager.getPreKeyBundle()).rejects.toThrow(
        "Signal session manager not initialized",
      );
    });
  });

  describe("Session Management", () => {
    let alice, bob;

    beforeEach(async () => {
      alice = new SignalSessionManager({
        userId: "alice",
        deviceId: 1,
        dataPath: path.join(testDir, "alice"),
      });

      bob = new SignalSessionManager({
        userId: "bob",
        deviceId: 1,
        dataPath: path.join(testDir, "bob"),
      });

      await alice.initialize();
      await bob.initialize();
    });

    it("should process pre key bundle and establish session", async () => {
      const bobBundle = await bob.getPreKeyBundle();
      const result = await alice.processPreKeyBundle("bob", 1, bobBundle);

      expect(result.success).toBe(true);
      expect(mockSessionBuilder.processPreKey).toHaveBeenCalled();
    });

    it("should validate pre key bundle", async () => {
      // Null bundle
      await expect(alice.processPreKeyBundle("bob", 1, null)).rejects.toThrow(
        "Pre key bundle is required",
      );

      // Invalid registration ID
      await expect(
        alice.processPreKeyBundle("bob", 1, { registrationId: 0 }),
      ).rejects.toThrow("Invalid registration ID");

      // Missing identity key
      await expect(
        alice.processPreKeyBundle("bob", 1, {
          registrationId: 1,
          identityKey: null,
        }),
      ).rejects.toThrow("Identity key is required");

      // Missing signed pre key
      await expect(
        alice.processPreKeyBundle("bob", 1, {
          registrationId: 1,
          identityKey: new ArrayBuffer(33),
          signedPreKey: null,
        }),
      ).rejects.toThrow("Signed pre key is required");
    });

    it("should emit session:created event", async () => {
      const bobBundle = await bob.getPreKeyBundle();

      const eventPromise = new Promise((resolve) => {
        alice.on("session:created", resolve);
      });

      await alice.processPreKeyBundle("bob", 1, bobBundle);

      const event = await eventPromise;
      expect(event.recipientId).toBe("bob");
      expect(event.deviceId).toBe(1);
    });

    it("should check session existence", async () => {
      const bobBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobBundle);

      // Mock the store to return a session
      alice.store.storeSession("bob.1", { some: "session" });

      const hasSession = await alice.hasSession("bob", 1);
      expect(hasSession).toBe(true);

      const noSession = await alice.hasSession("charlie", 1);
      expect(noSession).toBe(false);
    });

    it("should delete session", async () => {
      const bobBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobBundle);

      // Store a session
      alice.store.storeSession("bob.1", { some: "session" });

      const result = await alice.deleteSession("bob", 1);
      expect(result.success).toBe(true);

      const hasSession = await alice.hasSession("bob", 1);
      expect(hasSession).toBe(false);
    });

    it("should emit session:deleted event", async () => {
      const bobBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobBundle);
      alice.store.storeSession("bob.1", { some: "session" });

      const eventPromise = new Promise((resolve) => {
        alice.on("session:deleted", resolve);
      });

      await alice.deleteSession("bob", 1);

      const event = await eventPromise;
      expect(event.recipientId).toBe("bob");
      expect(event.deviceId).toBe(1);
    });
  });

  describe("Message Encryption/Decryption", () => {
    let alice, bob;

    beforeEach(async () => {
      alice = new SignalSessionManager({
        userId: "alice",
        deviceId: 1,
      });

      bob = new SignalSessionManager({
        userId: "bob",
        deviceId: 1,
      });

      await alice.initialize();
      await bob.initialize();

      // Establish sessions
      const aliceBundle = await alice.getPreKeyBundle();
      const bobBundle = await bob.getPreKeyBundle();

      await alice.processPreKeyBundle("bob", 1, bobBundle);
      await bob.processPreKeyBundle("alice", 1, aliceBundle);
    });

    it("should encrypt message", async () => {
      const plaintext = "Hello, Bob!";
      const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

      expect(ciphertext).toBeDefined();
      expect(ciphertext.type).toBeDefined();
      expect(ciphertext.body).toBeDefined();
      expect(mockSessionCipher.encrypt).toHaveBeenCalled();
    });

    it("should decrypt PreKeyWhisperMessage (type 1)", async () => {
      const ciphertext = {
        type: 1,
        body: new Uint8Array([1, 2, 3]),
      };

      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

      expect(decrypted).toBe("Hello");
      expect(mockSessionCipher.decryptPreKeyWhisperMessage).toHaveBeenCalled();
    });

    it("should decrypt WhisperMessage (type 3)", async () => {
      const ciphertext = {
        type: 3,
        body: new Uint8Array([1, 2, 3]),
      };

      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

      expect(decrypted).toBe("Hi");
      expect(mockSessionCipher.decryptWhisperMessage).toHaveBeenCalled();
    });

    it("should reject unknown message type", async () => {
      const ciphertext = {
        type: 999,
        body: new Uint8Array([1, 2, 3]),
      };

      await expect(bob.decryptMessage("alice", 1, ciphertext)).rejects.toThrow(
        "Unknown message type: 999",
      );
    });
  });

  describe("ArrayBuffer Conversion", () => {
    let manager;

    beforeEach(async () => {
      manager = new SignalSessionManager();
    });

    it("should handle null/undefined", () => {
      const result = manager.arrayBufferFromObject(null);
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(0);
    });

    it("should pass through ArrayBuffer", () => {
      const original = new ArrayBuffer(10);
      const result = manager.arrayBufferFromObject(original);
      expect(result).toBe(original);
    });

    it("should convert Uint8Array", () => {
      const uint8 = new Uint8Array([1, 2, 3, 4, 5]);
      const result = manager.arrayBufferFromObject(uint8);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(5);

      const view = new Uint8Array(result);
      expect(view[0]).toBe(1);
      expect(view[4]).toBe(5);
    });

    it("should convert Buffer", () => {
      const buffer = Buffer.from([1, 2, 3, 4, 5]);
      const result = manager.arrayBufferFromObject(buffer);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(5);
    });

    it("should convert plain array", () => {
      const array = [1, 2, 3, 4, 5];
      const result = manager.arrayBufferFromObject(array);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(5);
    });

    it("should convert Node.js Buffer serialized format", () => {
      const obj = { type: "Buffer", data: [1, 2, 3, 4, 5] };
      const result = manager.arrayBufferFromObject(obj);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(5);
    });

    it("should handle object with length property", () => {
      const obj = { 0: 1, 1: 2, 2: 3, length: 3 };
      const result = manager.arrayBufferFromObject(obj);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(3);
    });
  });

  describe("toUint8Array", () => {
    let manager;

    beforeEach(async () => {
      manager = new SignalSessionManager();
    });

    it("should pass through Uint8Array", () => {
      const original = new Uint8Array([1, 2, 3]);
      const result = manager.toUint8Array(original);
      expect(result).toBe(original);
    });

    it("should convert ArrayBuffer", () => {
      const buffer = new ArrayBuffer(3);
      const view = new Uint8Array(buffer);
      view[0] = 1;
      view[1] = 2;
      view[2] = 3;

      const result = manager.toUint8Array(buffer);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result[0]).toBe(1);
    });

    it("should convert Buffer", () => {
      const buffer = Buffer.from([1, 2, 3]);
      const result = manager.toUint8Array(buffer);
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe("Lifecycle", () => {
    it("should close properly", async () => {
      const manager = new SignalSessionManager();
      await manager.initialize();

      const closedPromise = new Promise((resolve) => {
        manager.on("closed", resolve);
      });

      await manager.close();

      expect(manager.initialized).toBe(false);
      expect(manager.sessions.size).toBe(0);
      expect(manager.preKeys.size).toBe(0);

      await closedPromise; // Should resolve
    });
  });
});

describe("LocalSignalProtocolStore", () => {
  let SignalSessionManager;
  let manager;

  beforeEach(async () => {
    // Re-apply mock implementations after vitest's mockReset
    setupMockImplementations();

    // Reset modules to ensure fresh import with mocks
    vi.resetModules();

    SignalSessionManager = (
      await import("../../../src/main/p2p/signal-session-manager.js")
    ).default;
    manager = new SignalSessionManager();
    await manager.initialize();
  });

  it("should store and retrieve identity key pair", async () => {
    const keyPair = await manager.store.getIdentityKeyPair();
    expect(keyPair).toBeDefined();
  });

  it("should store and retrieve registration ID", async () => {
    const regId = await manager.store.getLocalRegistrationId();
    expect(regId).toBe(12345);
  });

  it("should store and load session", async () => {
    const sessionData = { some: "data" };
    await manager.store.storeSession("test.1", sessionData);

    const loaded = await manager.store.loadSession("test.1");
    expect(loaded).toEqual(sessionData);
  });

  it("should return undefined for non-existent session", async () => {
    const loaded = await manager.store.loadSession("nonexistent.1");
    expect(loaded).toBeUndefined();
  });

  it("should remove session", async () => {
    await manager.store.storeSession("test.1", { some: "data" });
    await manager.store.removeSession("test.1");

    const loaded = await manager.store.loadSession("test.1");
    expect(loaded).toBeUndefined();
  });

  it("should get all sessions", async () => {
    await manager.store.storeSession("user1.1", { data: 1 });
    await manager.store.storeSession("user2.1", { data: 2 });

    const sessions = await manager.store.getAllSessions();
    expect(sessions.size).toBe(2);
    expect(sessions.has("user1.1")).toBe(true);
    expect(sessions.has("user2.1")).toBe(true);
  });

  it("should store and load pre key", async () => {
    const keyPair = {
      pubKey: new ArrayBuffer(33),
      privKey: new ArrayBuffer(32),
    };
    await manager.store.storePreKey(123, keyPair);

    const loaded = await manager.store.loadPreKey(123);
    expect(loaded).toEqual(keyPair);
  });

  it("should remove pre key", async () => {
    const keyPair = {
      pubKey: new ArrayBuffer(33),
      privKey: new ArrayBuffer(32),
    };
    await manager.store.storePreKey(123, keyPair);
    await manager.store.removePreKey(123);

    const loaded = await manager.store.loadPreKey(123);
    expect(loaded).toBeUndefined();
  });

  it("should store and load signed pre key", async () => {
    const keyPair = {
      pubKey: new ArrayBuffer(33),
      privKey: new ArrayBuffer(32),
    };
    await manager.store.storeSignedPreKey(456, keyPair);

    const loaded = await manager.store.loadSignedPreKey(456);
    expect(loaded).toEqual(keyPair);
  });

  it("should trust all identities by default", async () => {
    const trusted = await manager.store.isTrustedIdentity(
      "test",
      new ArrayBuffer(33),
      "sending",
    );
    expect(trusted).toBe(true);
  });

  it("should save identity and detect changes", async () => {
    const identity1 = new ArrayBuffer(33);
    const identity2 = new ArrayBuffer(33);

    const firstSave = await manager.store.saveIdentity("test", identity1);
    expect(firstSave).toBe(false); // No previous identity

    const secondSave = await manager.store.saveIdentity("test", identity2);
    expect(secondSave).toBe(true); // Identity changed
  });
});
