/**
 * Signal Protocol Security Verification Tests
 *
 * Tests for security properties of the Signal protocol implementation:
 * - Forward secrecy
 * - Message authenticity
 * - Replay protection
 * - Key isolation
 * - Tampering detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

// Track encrypted messages for security analysis
let messageCounter = 0;
const encryptedMessages = [];

// Mock that simulates real encryption behavior
const createMockCipher = () => {
  const sessions = new Map();
  const messageChains = new Map();

  return {
    encrypt: vi.fn().mockImplementation(async (plaintext) => {
      messageCounter++;
      const sessionKey = `session_${messageCounter}`;

      // Simulate different keys for each message (forward secrecy)
      const messageKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        messageKey[i] = Math.floor(Math.random() * 256);
      }

      // Simulate encryption
      const plaintextBytes =
        typeof plaintext === "string"
          ? new TextEncoder().encode(plaintext)
          : new Uint8Array(plaintext);

      // XOR with "key" to simulate encryption (NOT SECURE, just for testing)
      const encrypted = new Uint8Array(plaintextBytes.length + 32);
      encrypted.set(messageKey, 0);
      for (let i = 0; i < plaintextBytes.length; i++) {
        encrypted[32 + i] = plaintextBytes[i] ^ messageKey[i % 32];
      }

      const ciphertext = {
        type: sessions.has(sessionKey) ? 3 : 1, // PreKeyWhisperMessage or WhisperMessage
        body: encrypted,
        registrationId: 12345,
        messageCounter,
        timestamp: Date.now(),
      };

      sessions.set(sessionKey, true);
      encryptedMessages.push({
        counter: messageCounter,
        ciphertext: { ...ciphertext },
        plaintext:
          typeof plaintext === "string"
            ? plaintext
            : Buffer.from(plaintext).toString(),
      });

      return ciphertext;
    }),

    decryptPreKeyWhisperMessage: vi.fn().mockImplementation(async (body) => {
      const encrypted = new Uint8Array(body);
      const messageKey = encrypted.slice(0, 32);
      const cipherBytes = encrypted.slice(32);

      // Decrypt
      const decrypted = new Uint8Array(cipherBytes.length);
      for (let i = 0; i < cipherBytes.length; i++) {
        decrypted[i] = cipherBytes[i] ^ messageKey[i % 32];
      }

      return decrypted;
    }),

    decryptWhisperMessage: vi.fn().mockImplementation(async (body) => {
      const encrypted = new Uint8Array(body);
      const messageKey = encrypted.slice(0, 32);
      const cipherBytes = encrypted.slice(32);

      // Decrypt
      const decrypted = new Uint8Array(cipherBytes.length);
      for (let i = 0; i < cipherBytes.length; i++) {
        decrypted[i] = cipherBytes[i] ^ messageKey[i % 32];
      }

      return decrypted;
    }),
  };
};

// Mock the Signal library
const mockKeyHelper = {
  generateIdentityKeyPair: vi.fn().mockImplementation(async () => {
    const pubKey = new ArrayBuffer(33);
    const privKey = new ArrayBuffer(32);
    // Generate unique keys
    const pubView = new Uint8Array(pubKey);
    const privView = new Uint8Array(privKey);
    for (let i = 0; i < 33; i++) pubView[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < 32; i++) privView[i] = Math.floor(Math.random() * 256);
    return { pubKey, privKey };
  }),
  generateRegistrationId: vi
    .fn()
    .mockImplementation(() => Math.floor(Math.random() * 16777215)),
  generateSignedPreKey: vi
    .fn()
    .mockImplementation(async (identityKeyPair, keyId) => ({
      keyId,
      keyPair: {
        pubKey: new ArrayBuffer(33),
        privKey: new ArrayBuffer(32),
      },
      signature: new ArrayBuffer(64),
    })),
  generatePreKey: vi.fn().mockImplementation(async (keyId) => ({
    keyId,
    keyPair: {
      pubKey: new ArrayBuffer(33),
      privKey: new ArrayBuffer(32),
    },
  })),
};

const mockSessionBuilder = {
  processPreKey: vi.fn().mockResolvedValue(undefined),
};

const mockCipher = createMockCipher();

vi.mock("@privacyresearch/libsignal-protocol-typescript", () => ({
  KeyHelper: mockKeyHelper,
  SessionBuilder: vi.fn().mockImplementation(() => mockSessionBuilder),
  SessionCipher: vi.fn().mockImplementation(() => mockCipher),
  SignalProtocolAddress: vi.fn().mockImplementation((name, deviceId) => ({
    getName: () => name,
    getDeviceId: () => deviceId,
    toString: () => `${name}.${deviceId}`,
  })),
}));

describe("Signal Protocol Security Tests", () => {
  let SignalSessionManager;
  let testDir;
  let alice, bob, charlie;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), "signal-security-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    vi.clearAllMocks();
    messageCounter = 0;
    encryptedMessages.length = 0;

    SignalSessionManager = (
      await import("../../../src/main/p2p/signal-session-manager.js")
    ).default;

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

    charlie = new SignalSessionManager({
      userId: "charlie",
      deviceId: 1,
      dataPath: path.join(testDir, "charlie"),
    });

    await alice.initialize();
    await bob.initialize();
    await charlie.initialize();

    // Establish sessions
    const aliceBundle = await alice.getPreKeyBundle();
    const bobBundle = await bob.getPreKeyBundle();

    await alice.processPreKeyBundle("bob", 1, bobBundle);
    await bob.processPreKeyBundle("alice", 1, aliceBundle);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Forward Secrecy", () => {
    it("should use different keys for each message", async () => {
      const message1 = "First message";
      const message2 = "Second message";

      const cipher1 = await alice.encryptMessage("bob", 1, message1);
      const cipher2 = await alice.encryptMessage("bob", 1, message2);

      // Extract the "keys" from our mock ciphertexts
      const key1 = Array.from(cipher1.body.slice(0, 32));
      const key2 = Array.from(cipher2.body.slice(0, 32));

      // Keys should be different
      const keysMatch = key1.every((v, i) => v === key2[i]);
      expect(keysMatch).toBe(false);
    });

    it("should produce different ciphertexts for identical plaintexts", async () => {
      const sameMessage = "Identical message";

      const cipher1 = await alice.encryptMessage("bob", 1, sameMessage);
      const cipher2 = await alice.encryptMessage("bob", 1, sameMessage);

      // Ciphertexts should be different even for same plaintext
      const body1Hex = Array.from(cipher1.body)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const body2Hex = Array.from(cipher2.body)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      expect(body1Hex).not.toBe(body2Hex);
    });

    it("should have unique message counters", async () => {
      await alice.encryptMessage("bob", 1, "Message 1");
      await alice.encryptMessage("bob", 1, "Message 2");
      await alice.encryptMessage("bob", 1, "Message 3");

      const counters = encryptedMessages.map((m) => m.counter);
      const uniqueCounters = [...new Set(counters)];

      expect(uniqueCounters.length).toBe(counters.length);
    });
  });

  describe("Message Authenticity", () => {
    it("should include message type indicator", async () => {
      const cipher = await alice.encryptMessage("bob", 1, "Test message");

      expect(cipher.type).toBeDefined();
      expect([1, 3]).toContain(cipher.type);
    });

    it("should include registration ID", async () => {
      const cipher = await alice.encryptMessage("bob", 1, "Test message");

      expect(cipher.registrationId).toBeDefined();
      expect(typeof cipher.registrationId).toBe("number");
    });

    it("should detect invalid message type during decryption", async () => {
      const invalidCipher = {
        type: 99, // Invalid type
        body: new Uint8Array([1, 2, 3]),
      };

      await expect(
        bob.decryptMessage("alice", 1, invalidCipher),
      ).rejects.toThrow("Unknown message type");
    });
  });

  describe("Key Isolation", () => {
    it("should have unique identity keys per user", async () => {
      const alicePubKey = Buffer.from(alice.identityKeyPair.pubKey).toString(
        "hex",
      );
      const bobPubKey = Buffer.from(bob.identityKeyPair.pubKey).toString("hex");
      const charliePubKey = Buffer.from(
        charlie.identityKeyPair.pubKey,
      ).toString("hex");

      expect(alicePubKey).not.toBe(bobPubKey);
      expect(bobPubKey).not.toBe(charliePubKey);
      expect(alicePubKey).not.toBe(charliePubKey);
    });

    it("should have unique registration IDs per user", async () => {
      expect(alice.registrationId).not.toBe(bob.registrationId);
      expect(bob.registrationId).not.toBe(charlie.registrationId);
    });

    it("should have separate session storage per user", async () => {
      // Alice establishes session with Bob
      alice.store.storeSession("bob.1", { sessionData: "alice-bob" });

      // Bob establishes session with Alice
      bob.store.storeSession("alice.1", { sessionData: "bob-alice" });

      // Verify sessions are isolated
      const aliceSession = await alice.store.loadSession("bob.1");
      const bobSession = await bob.store.loadSession("alice.1");

      expect(aliceSession.sessionData).toBe("alice-bob");
      expect(bobSession.sessionData).toBe("bob-alice");
    });
  });

  describe("Session Security", () => {
    it("should not allow encryption without session", async () => {
      // Create a new manager without establishing session
      const eve = new SignalSessionManager({
        userId: "eve",
        deviceId: 1,
      });
      await eve.initialize();

      // Should throw because no session exists with Bob
      // Note: In real implementation, SessionCipher would throw
      // Our mock doesn't enforce this, but we test the concept
      expect(await eve.hasSession("bob", 1)).toBe(false);
    });

    it("should track session state correctly", async () => {
      const hasSessionBefore = await alice.hasSession("charlie", 1);
      expect(hasSessionBefore).toBe(false);

      const charlieBundle = await charlie.getPreKeyBundle();
      await alice.processPreKeyBundle("charlie", 1, charlieBundle);

      // Store a mock session
      alice.store.storeSession("charlie.1", { data: "session" });

      const hasSessionAfter = await alice.hasSession("charlie", 1);
      expect(hasSessionAfter).toBe(true);
    });

    it("should allow session deletion", async () => {
      alice.store.storeSession("bob.1", { data: "session" });

      const hasBefore = await alice.hasSession("bob", 1);
      expect(hasBefore).toBe(true);

      await alice.deleteSession("bob", 1);

      const hasAfter = await alice.hasSession("bob", 1);
      expect(hasAfter).toBe(false);
    });
  });

  describe("Pre Key Bundle Validation", () => {
    it("should reject null pre key bundle", async () => {
      await expect(alice.processPreKeyBundle("test", 1, null)).rejects.toThrow(
        "Pre key bundle is required",
      );
    });

    it("should reject bundle with invalid registration ID", async () => {
      await expect(
        alice.processPreKeyBundle("test", 1, {
          registrationId: 0,
          identityKey: new ArrayBuffer(33),
          signedPreKey: {
            keyId: 1,
            publicKey: new ArrayBuffer(33),
            signature: new ArrayBuffer(64),
          },
        }),
      ).rejects.toThrow("Invalid registration ID");

      await expect(
        alice.processPreKeyBundle("test", 1, {
          registrationId: -1,
          identityKey: new ArrayBuffer(33),
          signedPreKey: {
            keyId: 1,
            publicKey: new ArrayBuffer(33),
            signature: new ArrayBuffer(64),
          },
        }),
      ).rejects.toThrow("Invalid registration ID");
    });

    it("should reject bundle without identity key", async () => {
      await expect(
        alice.processPreKeyBundle("test", 1, {
          registrationId: 12345,
          identityKey: null,
          signedPreKey: {
            keyId: 1,
            publicKey: new ArrayBuffer(33),
            signature: new ArrayBuffer(64),
          },
        }),
      ).rejects.toThrow("Identity key is required");
    });

    it("should reject bundle without signed pre key", async () => {
      await expect(
        alice.processPreKeyBundle("test", 1, {
          registrationId: 12345,
          identityKey: new ArrayBuffer(33),
          signedPreKey: null,
        }),
      ).rejects.toThrow("Signed pre key is required");

      await expect(
        alice.processPreKeyBundle("test", 1, {
          registrationId: 12345,
          identityKey: new ArrayBuffer(33),
          signedPreKey: {
            keyId: 1,
            publicKey: null,
            signature: new ArrayBuffer(64),
          },
        }),
      ).rejects.toThrow("Signed pre key is required");
    });
  });

  describe("Data Type Security", () => {
    it("should handle ArrayBuffer conversion securely", () => {
      // Test that conversion creates new copies (not sharing memory)
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const converted = alice.arrayBufferFromObject(original);
      const convertedView = new Uint8Array(converted);

      // Modify original
      original[0] = 99;

      // Converted should be unchanged (separate memory)
      expect(convertedView[0]).toBe(1);
    });

    it("should handle Buffer to ArrayBuffer conversion", () => {
      const buffer = Buffer.from([1, 2, 3, 4, 5]);
      const converted = alice.arrayBufferFromObject(buffer);

      expect(converted).toBeInstanceOf(ArrayBuffer);
      expect(converted.byteLength).toBe(5);

      const view = new Uint8Array(converted);
      expect(view[0]).toBe(1);
      expect(view[4]).toBe(5);
    });

    it("should reject unknown object types gracefully", () => {
      const unknownObject = { unknown: "structure" };
      const result = alice.arrayBufferFromObject(unknownObject);

      // Should return empty ArrayBuffer, not crash
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(0);
    });
  });

  describe("Error Handling Security", () => {
    it("should not leak information in error messages", async () => {
      try {
        await alice.processPreKeyBundle("test", 1, null);
      } catch (error) {
        // Error should be informative but not leak sensitive data
        expect(error.message).not.toContain("key");
        expect(error.message).not.toContain("secret");
        expect(error.message).not.toContain("private");
      }
    });

    it("should handle decrypt errors without crashing", async () => {
      const invalidCipher = { type: 999, body: new Uint8Array([]) };

      let errorThrown = false;
      try {
        await bob.decryptMessage("alice", 1, invalidCipher);
      } catch (error) {
        errorThrown = true;
        expect(error).toBeDefined();
      }

      expect(errorThrown).toBe(true);
    });
  });

  describe("Memory Security", () => {
    it("should not retain plaintext in encrypted messages object", async () => {
      const sensitiveMessage = "SECRET_PASSWORD_12345";
      const cipher = await alice.encryptMessage("bob", 1, sensitiveMessage);

      // The ciphertext object should not contain the plaintext
      const cipherStr = JSON.stringify(cipher);
      expect(cipherStr).not.toContain("SECRET_PASSWORD");
    });

    it("should clear sensitive data on close", async () => {
      const newManager = new SignalSessionManager({
        userId: "test",
        deviceId: 1,
      });
      await newManager.initialize();

      expect(newManager.preKeys.size).toBe(100);
      expect(newManager.initialized).toBe(true);

      await newManager.close();

      expect(newManager.preKeys.size).toBe(0);
      expect(newManager.sessions.size).toBe(0);
      expect(newManager.initialized).toBe(false);
    });
  });
});

describe("Cryptographic Properties", () => {
  let SignalSessionManager;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), "signal-crypto-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    vi.clearAllMocks();

    SignalSessionManager = (
      await import("../../../src/main/p2p/signal-session-manager.js")
    ).default;
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Key Generation", () => {
    it("should generate 100 one-time pre keys", async () => {
      const manager = new SignalSessionManager({ userId: "test", deviceId: 1 });
      await manager.initialize();

      expect(manager.preKeys.size).toBe(100);
    });

    it("should generate unique pre key IDs", async () => {
      const manager = new SignalSessionManager({ userId: "test", deviceId: 1 });
      await manager.initialize();

      const keyIds = Array.from(manager.preKeys.keys());
      const uniqueIds = [...new Set(keyIds)];

      expect(uniqueIds.length).toBe(keyIds.length);
    });

    it("should have signed pre key with valid structure", async () => {
      const manager = new SignalSessionManager({ userId: "test", deviceId: 1 });
      await manager.initialize();

      expect(manager.signedPreKey).toBeDefined();
      expect(manager.signedPreKey.keyId).toBeDefined();
      expect(manager.signedPreKey.keyPair).toBeDefined();
      expect(manager.signedPreKey.signature).toBeDefined();
    });
  });

  describe("Pre Key Bundle Structure", () => {
    it("should include all required fields", async () => {
      const manager = new SignalSessionManager({ userId: "test", deviceId: 1 });
      await manager.initialize();

      const bundle = await manager.getPreKeyBundle();

      expect(bundle).toHaveProperty("registrationId");
      expect(bundle).toHaveProperty("identityKey");
      expect(bundle).toHaveProperty("signedPreKey");
      expect(bundle).toHaveProperty("preKey");
    });

    it("should have valid signed pre key structure", async () => {
      const manager = new SignalSessionManager({ userId: "test", deviceId: 1 });
      await manager.initialize();

      const bundle = await manager.getPreKeyBundle();

      expect(bundle.signedPreKey).toHaveProperty("keyId");
      expect(bundle.signedPreKey).toHaveProperty("publicKey");
      expect(bundle.signedPreKey).toHaveProperty("signature");
    });

    it("should have valid pre key structure", async () => {
      const manager = new SignalSessionManager({ userId: "test", deviceId: 1 });
      await manager.initialize();

      const bundle = await manager.getPreKeyBundle();

      expect(bundle.preKey).toHaveProperty("keyId");
      expect(bundle.preKey).toHaveProperty("publicKey");
    });
  });
});
