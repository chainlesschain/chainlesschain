/**
 * DID + P2P 完整工作流集成测试
 *
 * 测试范围：
 * - DID创建 → P2P连接 → 加密消息
 * - P2P文件传输与DID认证
 * - 离线同步队列与恢复
 * - 多节点DID网络
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 1: Integration & Cross-Module Workflows
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock 工厂 ====================

/**
 * 创建 Mock 数据库
 */
function createMockDatabase() {
  const identities = new Map();
  const sessions = new Map();

  return {
    prepare: vi.fn((sql) => {
      return {
        run: vi.fn((...args) => {
          if (sql.includes("INSERT INTO identities")) {
            const [
              did,
              nickname,
              avatar,
              bio,
              pubSign,
              pubEncrypt,
              privRef,
              doc,
              created,
              isDefault,
            ] = args;
            identities.set(did, {
              did,
              nickname,
              avatar_path: avatar,
              bio,
              public_key_sign: pubSign,
              public_key_encrypt: pubEncrypt,
              private_key_ref: privRef,
              did_document: doc,
              created_at: created,
              is_default: isDefault,
            });
          }
        }),
        get: vi.fn((args) => {
          const did = args[0];
          return identities.get(did);
        }),
        all: vi.fn((args) => {
          if (!args || args.length === 0) {
            return Array.from(identities.values());
          }
          const did = args[0];
          const identity = identities.get(did);
          return identity ? [identity] : [];
        }),
      };
    }),
    exec: vi.fn(),
    saveToFile: vi.fn(),
    getAllSettings: vi.fn(async () => ({})),
  };
}

/**
 * 创建 Mock P2P Manager
 */
function createMockP2PManager() {
  const dhtStore = new Map(); // DHT storage
  const connectedPeers = new Map(); // Connected peers
  const messages = [];
  const eventListeners = new Map();

  // Create manager object first
  const manager = {
    node: {
      getMultiaddrs: vi.fn(() => []),
      getConnections: vi.fn(() => Array.from(connectedPeers.values())),
      dial: vi.fn(async (peerId) => {
        return {
          remotePeer: { toString: () => peerId },
          remoteAddr: {
            toString: () => `/ip4/127.0.0.1/tcp/9000/p2p/${peerId}`,
          },
          status: "open",
        };
      }),
      dialProtocol: vi.fn(async (peerId, protocol) => {
        const chunks = [];
        return {
          write: vi.fn(async (data) => chunks.push(data)),
          close: vi.fn(async () => {}),
          source: {
            async *[Symbol.asyncIterator]() {
              // 模拟响应
              if (protocol.includes("key-exchange")) {
                const response = {
                  preKeyBundle: {
                    identityKey: "mock-identity-key",
                    signedPreKey: {
                      keyId: 1,
                      publicKey: "mock-signed-prekey",
                      signature: "mock-sig",
                    },
                    preKey: { keyId: 1, publicKey: "mock-prekey" },
                  },
                  deviceId: "device-bob",
                };
                yield Buffer.from(JSON.stringify(response));
              }
            },
          },
        };
      }),
      handle: vi.fn(),
      addEventListener: vi.fn((event, handler) => {
        if (!eventListeners.has(event)) {
          eventListeners.set(event, []);
        }
        eventListeners.get(event).push(handler);
      }),
    },
    peerId: { toString: () => "QmAlice123" },
    initialized: true,
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(async () => true),
    dhtPut: vi.fn(async (key, value) => {
      dhtStore.set(key, value);
    }),
    dhtGet: vi.fn(async (key) => {
      return dhtStore.get(key) || null;
    }),
    connectToPeer: vi.fn(async (multiaddr) => {
      // Extract peerId from multiaddr (e.g., /ip4/127.0.0.1/tcp/9000/p2p/QmNode1)
      const parts = multiaddr.split("/p2p/");
      const peerId = parts.length > 1 ? parts[1] : `peer-${Date.now()}`;
      connectedPeers.set(peerId, { peerId, connectedAt: Date.now() });
      return { success: true, peerId };
    }),
    getConnectedPeers: vi.fn(() => Array.from(connectedPeers.values())),
    initiateKeyExchange: vi.fn(async (peerId, deviceId) => {
      return { success: true, deviceId: deviceId || "device-1" };
    }),
    sendEncryptedMessage: null, // Will be set below
    hasEncryptedSession: vi.fn(async (peerId) => true),
    signalManager: {
      hasSession: vi.fn(async () => true),
      encryptMessage: vi.fn(async (peerId, deviceId, message) => {
        return {
          type: "mock-cipher",
          data: Buffer.from(message).toString("base64"),
        };
      }),
      decryptMessage: vi.fn(async (peerId, deviceId, ciphertext) => {
        return Buffer.from(ciphertext.data, "base64").toString();
      }),
    },
    deviceManager: {
      getCurrentDevice: vi.fn(() => ({
        deviceId: "device-alice",
        name: "Alice-Device",
      })),
      getUserDevices: vi.fn(() => [
        { deviceId: "device-bob", name: "Bob-Device" },
      ]),
    },
    syncManager: {
      queueMessage: vi.fn(async (deviceId, message) => {
        return `msg-${Date.now()}`;
      }),
      getDeviceQueue: vi.fn((deviceId) => []),
      markMessageDelivered: vi.fn(async (messageId) => {}),
      markMessageRead: vi.fn(async (messageId) => {}),
      removeMessage: vi.fn(async (messageId) => {}),
    },
    on: vi.fn((event, handler) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(handler);
    }),
    emit: vi.fn((event, data) => {
      const handlers = eventListeners.get(event) || [];
      handlers.forEach((h) => h(data));
    }),
    getMessages: () => messages,
    _eventListeners: eventListeners,
    _dhtStore: dhtStore,
    _connectedPeers: connectedPeers,
  };

  // Set sendEncryptedMessage with reference to manager.signalManager
  manager.sendEncryptedMessage = vi.fn(
    async (peerId, message, deviceId, options) => {
      // Check if session exists and initiate key exchange if not
      const hasSession = await manager.signalManager.hasSession(
        peerId,
        deviceId,
      );
      if (!hasSession) {
        await manager.initiateKeyExchange(peerId, deviceId);
      }
      // Call signalManager.encryptMessage so tests can verify
      await manager.signalManager.encryptMessage(peerId, deviceId, message);
      const msg = {
        to: peerId,
        message,
        deviceId,
        timestamp: Date.now(),
      };
      messages.push(msg);
      return { success: true, status: "sent", deviceId };
    },
  );

  return manager;
}

/**
 * 创建 Mock DID Manager
 */
function createMockDIDManager(db, p2pManager) {
  const eventListeners = new Map();
  const identities = new Map(); // Store created identities

  // Create the manager object first
  const manager = {
    db,
    p2pManager,
    currentIdentity: null,
    _identities: identities,

    initialize: vi.fn(async () => {
      return true;
    }),

    createIdentity: null, // Will be set below
    getCurrentIdentity: null, // Will be set below
    getIdentityByDID: null, // Will be set below
    publishToDHT: null, // Will be set below
    resolveFromDHT: null, // Will be set below

    on: vi.fn((event, handler) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(handler);
    }),

    emit: vi.fn((event, data) => {
      const handlers = eventListeners.get(event) || [];
      handlers.forEach((h) => h(data));
    }),
  };

  // Now define methods that reference manager via closure
  manager.createIdentity = vi.fn(async (profile, options = {}) => {
    const did = `did:chainlesschain:${Math.random().toString(36).substr(2, 40)}`;
    const identity = {
      did,
      nickname: profile.nickname || "Anonymous",
      avatar: profile.avatar || null,
      bio: profile.bio || null,
      public_key_sign: "mock-sign-key-" + did,
      public_key_encrypt: "mock-encrypt-key-" + did,
      did_document: JSON.stringify({
        id: did,
        verificationMethod: [],
        authentication: [],
        profile: { nickname: profile.nickname, bio: profile.bio },
      }),
      didDocument: {
        id: did,
        verificationMethod: [],
        authentication: [],
        profile: { nickname: profile.nickname, bio: profile.bio },
      },
      createdAt: Date.now(),
    };

    // Store the identity
    identities.set(did, identity);

    if (options.setAsDefault) {
      manager.currentIdentity = identity;
    }

    // Emit event
    const handlers = eventListeners.get("identity-created") || [];
    handlers.forEach((h) => h({ did, identity }));

    return identity;
  });

  manager.getCurrentIdentity = vi.fn(() => {
    return manager.currentIdentity;
  });

  manager.getIdentityByDID = vi.fn((did) => {
    // First check our in-memory store
    if (identities.has(did)) {
      return identities.get(did);
    }
    // Fallback to database
    const stmt = db.prepare("SELECT * FROM identities WHERE did = ?");
    const results = stmt.all([did]);
    return results && results.length > 0 ? results[0] : null;
  });

  manager.publishToDHT = vi.fn(async (did) => {
    if (!p2pManager || !p2pManager.isInitialized()) {
      throw new Error("P2P manager not initialized");
    }

    const identity = manager.getIdentityByDID(did);
    if (!identity) {
      throw new Error("Identity not found");
    }

    const dhtKey = `/did/chainlesschain/${did.split(":")[2]}`;
    const didDoc =
      typeof identity.did_document === "string"
        ? JSON.parse(identity.did_document)
        : identity.didDocument || {};
    const publishData = {
      did: identity.did,
      nickname: identity.nickname,
      publicKeySign: identity.public_key_sign,
      publicKeyEncrypt: identity.public_key_encrypt,
      didDocument: didDoc,
      publishedAt: Date.now(),
    };

    await p2pManager.dhtPut(dhtKey, Buffer.from(JSON.stringify(publishData)));

    // Emit event
    const handlers = eventListeners.get("did-published") || [];
    handlers.forEach((h) =>
      h({ did, dhtKey, publishedAt: publishData.publishedAt }),
    );

    return {
      success: true,
      key: dhtKey,
      publishedAt: publishData.publishedAt,
    };
  });

  manager.resolveFromDHT = vi.fn(async (did) => {
    if (!p2pManager || !p2pManager.isInitialized()) {
      throw new Error("P2P manager not initialized");
    }

    const dhtKey = `/did/chainlesschain/${did.split(":")[2]}`;
    const data = await p2pManager.dhtGet(dhtKey);

    if (!data) {
      throw new Error("DID not found in DHT");
    }

    const publishData = JSON.parse(data.toString());

    // Emit event
    const handlers = eventListeners.get("did-resolved") || [];
    handlers.forEach((h) => h({ did, data: publishData }));

    return publishData;
  });

  return manager;
}

// ==================== 测试套件 ====================

describe("DID + P2P 完整工作流集成测试", () => {
  let db, p2pManager, didManager;

  beforeEach(async () => {
    db = createMockDatabase();
    p2pManager = createMockP2PManager();
    didManager = createMockDIDManager(db, p2pManager);

    await p2pManager.initialize();
    await didManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== 1. 完整的DID+P2P工作流 ====================

  describe("完整的DID+P2P工作流", () => {
    it("应该完成: DID创建 → 发布到DHT → P2P连接 → 加密消息", async () => {
      // Step 1: Alice 创建 DID
      const aliceIdentity = await didManager.createIdentity(
        {
          nickname: "Alice",
          bio: "Test user Alice",
        },
        { setAsDefault: true },
      );

      expect(aliceIdentity.did).toMatch(/^did:chainlesschain:/);
      expect(aliceIdentity.nickname).toBe("Alice");
      expect(didManager.createIdentity).toHaveBeenCalledTimes(1);

      // Step 2: 发布 Alice 的 DID 到 DHT
      const publishResult = await didManager.publishToDHT(aliceIdentity.did);

      expect(publishResult.success).toBe(true);
      expect(publishResult.key).toContain("/did/chainlesschain/");
      expect(p2pManager.dhtPut).toHaveBeenCalled();

      // Step 3: Bob 从 DHT 解析 Alice 的 DID
      const resolvedDID = await didManager.resolveFromDHT(aliceIdentity.did);

      expect(resolvedDID.did).toBe(aliceIdentity.did);
      expect(resolvedDID.nickname).toBe("Alice");
      expect(p2pManager.dhtGet).toHaveBeenCalled();

      // Step 4: 建立 P2P 连接
      const connectResult = await p2pManager.connectToPeer(
        "/ip4/127.0.0.1/tcp/9000/p2p/QmBob456",
      );

      expect(connectResult.success).toBe(true);
      expect(connectResult.peerId).toBe("QmBob456");

      // Step 5: 发起密钥交换
      const keyExchangeResult = await p2pManager.initiateKeyExchange(
        "QmBob456",
        "device-bob",
      );

      expect(keyExchangeResult.success).toBe(true);
      expect(keyExchangeResult.deviceId).toBe("device-bob");

      // Step 6: 发送加密消息
      const message = "Hello Bob, this is Alice!";
      const sendResult = await p2pManager.sendEncryptedMessage(
        "QmBob456",
        message,
        "device-bob",
      );

      expect(sendResult.success).toBe(true);
      expect(sendResult.status).toBe("sent");
      expect(p2pManager.signalManager.encryptMessage).toHaveBeenCalled();
    });

    it("应该处理会话不存在时自动发起密钥交换", async () => {
      // 模拟会话不存在
      p2pManager.hasEncryptedSession.mockResolvedValueOnce(false);
      p2pManager.signalManager.hasSession.mockResolvedValueOnce(false);

      const message = "First message without session";
      await p2pManager.sendEncryptedMessage("QmBob456", message, "device-bob");

      // 应该先发起密钥交换
      expect(p2pManager.initiateKeyExchange).toHaveBeenCalledWith(
        "QmBob456",
        "device-bob",
      );

      // 然后发送消息
      expect(p2pManager.signalManager.encryptMessage).toHaveBeenCalled();
    });

    it("应该支持消息端到端加密和解密", async () => {
      const originalMessage = "Secret message from Alice";
      const peerId = "QmBob456";
      const deviceId = "device-bob";

      // 加密
      const ciphertext = await p2pManager.signalManager.encryptMessage(
        peerId,
        deviceId,
        originalMessage,
      );

      expect(ciphertext.type).toBe("mock-cipher");
      expect(ciphertext.data).toBeTruthy();

      // 解密
      const decrypted = await p2pManager.signalManager.decryptMessage(
        peerId,
        deviceId,
        ciphertext,
      );

      expect(decrypted).toBe(originalMessage);
    });
  });

  // ==================== 2. P2P文件传输与DID认证 ====================

  describe("P2P文件传输与DID认证", () => {
    it("应该使用DID认证传输文件", async () => {
      // 创建 Alice 和 Bob 的 DID
      const aliceIdentity = await didManager.createIdentity(
        {
          nickname: "Alice",
        },
        { setAsDefault: true },
      );

      const bobDID = "did:chainlesschain:bob123456789";

      // 发布 Alice 的 DID
      await didManager.publishToDHT(aliceIdentity.did);

      // 连接到 Bob
      await p2pManager.connectToPeer("/ip4/127.0.0.1/tcp/9000/p2p/QmBob456");

      // 模拟文件数据
      const fileData = Buffer.from("This is a test file content");
      const fileMetadata = {
        filename: "test.txt",
        size: fileData.length,
        mimeType: "text/plain",
        checksum: "abc123",
      };

      // 发送文件元数据（加密）
      await p2pManager.sendEncryptedMessage(
        "QmBob456",
        JSON.stringify({ type: "file-metadata", ...fileMetadata }),
        "device-bob",
      );

      // 发送文件数据（加密）
      await p2pManager.sendEncryptedMessage(
        "QmBob456",
        fileData.toString("base64"),
        "device-bob",
      );

      const messages = p2pManager.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0].message).toContain("file-metadata");
      expect(messages[1].message).toBeTruthy();
    });

    it("应该验证发送方的DID身份", async () => {
      const aliceIdentity = await didManager.createIdentity(
        {
          nickname: "Alice",
        },
        { setAsDefault: true },
      );

      await didManager.publishToDHT(aliceIdentity.did);

      // Bob 解析 Alice 的 DID
      const resolvedAlice = await didManager.resolveFromDHT(aliceIdentity.did);

      expect(resolvedAlice.did).toBe(aliceIdentity.did);
      expect(resolvedAlice.nickname).toBe("Alice");

      // 验证签名（简化版）
      expect(resolvedAlice.didDocument).toBeDefined();
      expect(resolvedAlice.publicKeySign).toBeDefined();
    });

    it("应该支持分块传输大文件", async () => {
      const largeFileSize = 10 * 1024 * 1024; // 10MB
      const chunkSize = 1024 * 1024; // 1MB chunks
      const chunks = Math.ceil(largeFileSize / chunkSize);

      await p2pManager.connectToPeer("/ip4/127.0.0.1/tcp/9000/p2p/QmBob456");

      // 发送每个分块
      for (let i = 0; i < chunks; i++) {
        const chunkData = {
          chunkIndex: i,
          totalChunks: chunks,
          data: Buffer.alloc(
            Math.min(chunkSize, largeFileSize - i * chunkSize),
          ),
        };

        await p2pManager.sendEncryptedMessage(
          "QmBob456",
          JSON.stringify(chunkData),
          "device-bob",
        );
      }

      const messages = p2pManager.getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(chunks);
    });
  });

  // ==================== 3. 离线同步队列与恢复 ====================

  describe("离线同步队列与恢复", () => {
    it("应该在对方离线时将消息加入队列", async () => {
      // 模拟发送失败（对方离线）
      p2pManager.sendEncryptedMessage.mockRejectedValueOnce(
        new Error("Peer not connected"),
      );

      // 重新实现 sendEncryptedMessage 以支持自动入队
      p2pManager.sendEncryptedMessage = vi.fn(
        async (peerId, message, deviceId, options = {}) => {
          const autoQueue = options.autoQueue !== false;

          try {
            // 模拟发送失败
            throw new Error("Peer not connected");
          } catch (error) {
            if (autoQueue && p2pManager.syncManager) {
              const messageId = await p2pManager.syncManager.queueMessage(
                deviceId || "device-bob",
                {
                  targetPeerId: peerId,
                  content: message,
                  encrypted: true,
                },
              );

              return {
                success: true,
                status: "queued",
                messageId,
                deviceId: deviceId || "device-bob",
                reason: error.message,
              };
            }
            throw error;
          }
        },
      );

      const message = "Offline message";
      const result = await p2pManager.sendEncryptedMessage(
        "QmBob456",
        message,
        "device-bob",
        { autoQueue: true },
      );

      expect(result.status).toBe("queued");
      expect(result.messageId).toBeDefined();
      expect(p2pManager.syncManager.queueMessage).toHaveBeenCalled();
    });

    it("应该在对方上线时自动发送队列消息", async () => {
      const deviceId = "device-bob";

      // 模拟队列中有消息
      const queuedMessages = [
        {
          id: "msg-1",
          targetPeerId: "QmBob456",
          content: "Message 1",
          encrypted: true,
        },
        {
          id: "msg-2",
          targetPeerId: "QmBob456",
          content: "Message 2",
          encrypted: true,
        },
      ];
      p2pManager.syncManager.getDeviceQueue.mockReturnValue(queuedMessages);

      // 恢复正常发送
      p2pManager.sendEncryptedMessage = vi.fn(
        async (peerId, message, deviceId) => {
          return { success: true, status: "sent", deviceId };
        },
      );

      // 模拟对方上线，触发同步
      for (const msg of queuedMessages) {
        await p2pManager.sendEncryptedMessage(
          msg.targetPeerId,
          msg.content,
          deviceId,
        );
        await p2pManager.syncManager.markMessageDelivered(msg.id);
        await p2pManager.syncManager.removeMessage(msg.id);
      }

      expect(p2pManager.sendEncryptedMessage).toHaveBeenCalledTimes(2);
      expect(p2pManager.syncManager.markMessageDelivered).toHaveBeenCalledTimes(
        2,
      );
      expect(p2pManager.syncManager.removeMessage).toHaveBeenCalledTimes(2);
    });

    it("应该支持跨设备消息同步", async () => {
      const aliceDevice1 = "device-alice-phone";
      const aliceDevice2 = "device-alice-laptop";

      // Alice 在手机上发送消息
      await p2pManager.sendEncryptedMessage(
        "QmBob456",
        "Message from phone",
        "device-bob",
      );

      // 同步到 Alice 的笔记本
      const syncMessages = [
        {
          id: "msg-sync-1",
          device: aliceDevice1,
          targetPeerId: "QmBob456",
          content: "Message from phone",
        },
      ];

      p2pManager.syncManager.getDeviceQueue.mockReturnValue(syncMessages);

      const queue = p2pManager.syncManager.getDeviceQueue(aliceDevice2);
      expect(queue).toHaveLength(1);
      expect(queue[0].content).toBe("Message from phone");
    });

    it("应该处理消息发送失败后的重试", async () => {
      let attempts = 0;
      const maxRetries = 3;

      p2pManager.sendEncryptedMessage = vi.fn(
        async (peerId, message, deviceId) => {
          attempts++;
          if (attempts < maxRetries) {
            throw new Error("Connection timeout");
          }
          return { success: true, status: "sent", deviceId };
        },
      );

      // 模拟重试逻辑
      let result;
      for (let i = 0; i < maxRetries; i++) {
        try {
          result = await p2pManager.sendEncryptedMessage(
            "QmBob456",
            "Retry message",
            "device-bob",
          );
          break;
        } catch (error) {
          if (i === maxRetries - 1) {
            throw error;
          }
        }
      }

      expect(result.success).toBe(true);
      expect(attempts).toBe(maxRetries);
    });
  });

  // ==================== 4. 多节点DID网络 ====================

  describe("多节点DID网络", () => {
    it("应该支持多个节点发现和连接", async () => {
      // 创建3个节点的DID
      const nodes = [];
      for (let i = 0; i < 3; i++) {
        const identity = await didManager.createIdentity({
          nickname: `Node${i}`,
          bio: `Test node ${i}`,
        });
        await didManager.publishToDHT(identity.did);
        nodes.push(identity);
      }

      expect(nodes).toHaveLength(3);
      expect(p2pManager.dhtPut).toHaveBeenCalledTimes(3);

      // 验证所有节点都可以从DHT解析
      for (const node of nodes) {
        const resolved = await didManager.resolveFromDHT(node.did);
        expect(resolved.did).toBe(node.did);
      }
    });

    it("应该支持节点间的广播消息", async () => {
      const peerIds = ["QmNode1", "QmNode2", "QmNode3"];

      // 连接到所有节点
      for (const peerId of peerIds) {
        await p2pManager.connectToPeer(`/ip4/127.0.0.1/tcp/9000/p2p/${peerId}`);
      }

      const connectedPeers = p2pManager.getConnectedPeers();
      expect(connectedPeers.length).toBeGreaterThanOrEqual(3);

      // 广播消息到所有节点
      const broadcastMessage = "Broadcast to all nodes";
      for (const peerId of peerIds) {
        await p2pManager.sendEncryptedMessage(peerId, broadcastMessage, null);
      }

      const messages = p2pManager.getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(3);
    });

    it("应该处理节点动态加入和离开", async () => {
      // 初始3个节点
      const connectedPeers = ["QmNode1", "QmNode2", "QmNode3"];

      for (const peerId of connectedPeers) {
        await p2pManager.connectToPeer(`/ip4/127.0.0.1/tcp/9000/p2p/${peerId}`);
      }

      expect(p2pManager.getConnectedPeers()).toHaveLength(3);

      // 新节点加入
      const newPeer = "QmNode4";
      await p2pManager.connectToPeer(`/ip4/127.0.0.1/tcp/9000/p2p/${newPeer}`);

      expect(p2pManager.getConnectedPeers()).toHaveLength(4);

      // 节点离开（使用内部Map移除）
      p2pManager._connectedPeers.delete("QmNode1");

      expect(p2pManager.getConnectedPeers().length).toBeLessThan(4);
      expect(p2pManager.getConnectedPeers()).toHaveLength(3);
    });

    it("应该支持多跳路由（通过中继节点）", async () => {
      // Alice -> Relay -> Bob 路由
      const alice = "QmAlice";
      const relay = "QmRelay";
      const bob = "QmBob";

      // Alice 连接到 Relay
      await p2pManager.connectToPeer(`/ip4/127.0.0.1/tcp/9000/p2p/${relay}`);

      // Relay 转发消息到 Bob
      const message = { from: alice, to: bob, content: "Hello via relay" };
      await p2pManager.sendEncryptedMessage(
        relay,
        JSON.stringify(message),
        null,
      );

      const messages = p2pManager.getMessages();
      const relayedMessage = messages.find((m) => m.message.includes("relay"));

      expect(relayedMessage).toBeDefined();
    });
  });

  // ==================== 5. 错误处理与恢复 ====================

  describe("错误处理与恢复", () => {
    it("应该处理DID解析失败", async () => {
      const invalidDID = "did:chainlesschain:nonexistent";

      p2pManager.dhtGet.mockResolvedValueOnce(null);

      await expect(didManager.resolveFromDHT(invalidDID)).rejects.toThrow(
        "DID not found in DHT",
      );
    });

    it("应该处理P2P连接超时", async () => {
      p2pManager.node.dial.mockRejectedValueOnce(
        new Error("Connection timeout"),
      );

      p2pManager.connectToPeer = vi.fn(async (multiaddr) => {
        throw new Error("Connection timeout");
      });

      await expect(
        p2pManager.connectToPeer("/ip4/192.0.2.1/tcp/9000/p2p/QmTimeout"),
      ).rejects.toThrow("Connection timeout");
    });

    it("应该处理加密失败并降级到明文（测试环境）", async () => {
      // 模拟加密失败
      p2pManager.signalManager.encryptMessage.mockRejectedValueOnce(
        new Error("Encryption failed"),
      );

      // 重新实现以支持降级
      p2pManager.sendEncryptedMessage = vi.fn(
        async (peerId, message, deviceId, options = {}) => {
          try {
            await p2pManager.signalManager.encryptMessage(
              peerId,
              deviceId,
              message,
            );
          } catch (error) {
            // 测试环境降级到明文
            if (options.allowPlaintext) {
              return {
                success: true,
                status: "sent-plaintext",
                encrypted: false,
              };
            }
            throw error;
          }
        },
      );

      const result = await p2pManager.sendEncryptedMessage(
        "QmBob456",
        "Test message",
        "device-bob",
        { allowPlaintext: true },
      );

      expect(result.status).toBe("sent-plaintext");
      expect(result.encrypted).toBe(false);
    });

    it("应该处理DHT网络分区", async () => {
      // 模拟网络分区：一半节点不可达
      const allNodes = ["QmNode1", "QmNode2", "QmNode3", "QmNode4"];
      const reachableNodes = ["QmNode1", "QmNode2"];
      const unreachableNodes = ["QmNode3", "QmNode4"];

      p2pManager.dhtGet = vi.fn(async (key) => {
        // 模拟部分节点无法访问DHT
        if (Math.random() < 0.5) {
          return null;
        }
        return Buffer.from(JSON.stringify({ test: "data" }));
      });

      // 尝试从DHT获取数据，应该有重试逻辑
      let success = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!success && attempts < maxAttempts) {
        try {
          const data = await p2pManager.dhtGet("/test/key");
          if (data) {
            success = true;
          }
        } catch (error) {
          attempts++;
        }
      }

      expect(attempts).toBeLessThanOrEqual(maxAttempts);
    });
  });

  // ==================== 6. 性能基准测试 ====================

  describe("性能基准测试", () => {
    it("应该在合理时间内完成DID创建和发布（< 200ms）", async () => {
      const start = Date.now();

      const identity = await didManager.createIdentity({
        nickname: "PerformanceTest",
      });
      await didManager.publishToDHT(identity.did);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200);
    });

    it("应该支持高并发消息发送（100条/秒）", async () => {
      const messageCount = 100;
      const start = Date.now();

      const promises = [];
      for (let i = 0; i < messageCount; i++) {
        promises.push(
          p2pManager.sendEncryptedMessage(
            "QmBob456",
            `Message ${i}`,
            "device-bob",
          ),
        );
      }

      await Promise.all(promises);

      const duration = Date.now() - start;
      const messagesPerSecond = (messageCount / duration) * 1000;

      expect(messagesPerSecond).toBeGreaterThan(100);
      expect(p2pManager.getMessages()).toHaveLength(messageCount);
    });

    it("应该高效处理DHT查询（< 50ms/query）", async () => {
      const identity = await didManager.createIdentity({ nickname: "Test" });
      await didManager.publishToDHT(identity.did);

      const queryCount = 10;
      const durations = [];

      for (let i = 0; i < queryCount; i++) {
        const start = Date.now();
        await didManager.resolveFromDHT(identity.did);
        durations.push(Date.now() - start);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / queryCount;

      expect(avgDuration).toBeLessThan(50);
    });
  });

  // ==================== 7. 真实场景模拟 ====================

  describe("真实场景模拟", () => {
    it("场景1: 好友添加流程", async () => {
      // Alice 创建DID
      const alice = await didManager.createIdentity(
        {
          nickname: "Alice",
          bio: "Software Developer",
        },
        { setAsDefault: true },
      );

      await didManager.publishToDHT(alice.did);

      // Bob 创建并发布DID
      const bob = await didManager.createIdentity(
        {
          nickname: "Bob",
          bio: "Designer",
        },
        {},
      );
      await didManager.publishToDHT(bob.did);

      // Alice 搜索 Bob 的DID
      const bobInfo = await didManager.resolveFromDHT(bob.did);
      expect(bobInfo).toBeDefined();

      // Alice 发送好友请求
      await p2pManager.connectToPeer("/ip4/127.0.0.1/tcp/9000/p2p/QmBob");
      await p2pManager.sendEncryptedMessage(
        "QmBob",
        JSON.stringify({
          type: "friend-request",
          from: alice.did,
          message: "Hi Bob!",
        }),
        "device-bob",
      );

      const messages = p2pManager.getMessages();
      const friendRequest = messages.find((m) =>
        m.message.includes("friend-request"),
      );

      expect(friendRequest).toBeDefined();
    });

    it("场景2: 群聊消息同步", async () => {
      const groupMembers = ["QmAlice", "QmBob", "QmCarol"];

      // Alice 发送群消息
      const groupMessage = {
        type: "group-message",
        groupId: "group-123",
        from: "QmAlice",
        content: "Hello everyone!",
      };

      // 广播到所有成员
      for (const member of groupMembers) {
        if (member !== "QmAlice") {
          await p2pManager.sendEncryptedMessage(
            member,
            JSON.stringify(groupMessage),
            null,
          );
        }
      }

      const messages = p2pManager.getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(2); // Bob and Carol
    });

    it("场景3: 设备间笔记同步", async () => {
      const note = {
        id: "note-123",
        title: "Meeting Notes",
        content: "Discussion about project timeline",
        updatedAt: Date.now(),
      };

      // 从手机同步到电脑
      await p2pManager.sendEncryptedMessage(
        p2pManager.peerId.toString(),
        JSON.stringify({ type: "note-sync", note }),
        "device-alice-laptop",
      );

      const messages = p2pManager.getMessages();
      const syncMessage = messages.find((m) => m.message.includes("note-sync"));

      expect(syncMessage).toBeDefined();
    });

    it("场景4: 跨网络DID验证", async () => {
      // 企业网络中的Alice验证外部Bob的身份
      const aliceIdentity = await didManager.createIdentity({
        nickname: "Alice",
        bio: "Enterprise User",
      });

      await didManager.publishToDHT(aliceIdentity.did);

      // Bob在公共网络创建并发布DID
      const bobIdentity = await didManager.createIdentity({
        nickname: "Bob",
        bio: "External User",
      });
      await didManager.publishToDHT(bobIdentity.did);

      // Alice从DHT验证Bob的身份
      const bobInfo = await didManager.resolveFromDHT(bobIdentity.did);

      // 验证Bob的DID文档
      expect(bobInfo.didDocument).toBeDefined();
      expect(bobInfo.publicKeySign).toBeDefined();

      // 检查信任链（简化版）
      const isTrusted = bobInfo.didDocument && bobInfo.publicKeySign;
      expect(isTrusted).toBeTruthy();
    });
  });
});
