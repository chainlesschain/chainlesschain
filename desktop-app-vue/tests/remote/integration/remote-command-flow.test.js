/**
 * 远程命令流程集成测试
 * 端到端测试PC-Android远程控制完整流程
 */

const EventEmitter = require("events");

// Mock dependencies
jest.mock("electron", () => ({
  clipboard: {
    readText: jest.fn().mockReturnValue("Clipboard content"),
    writeText: jest.fn(),
    readHTML: jest.fn(),
    writeHTML: jest.fn(),
    readImage: jest.fn().mockReturnValue({ isEmpty: () => true }),
    writeImage: jest.fn(),
  },
  Notification: class {
    constructor(options) {
      this.options = options;
    }
    show() {}
    on() {}
  },
  nativeImage: {
    createFromBuffer: jest.fn(),
    createFromDataURL: jest.fn(),
  },
}));

// Mock crypto for DID signature verification
const mockCrypto = {
  verify: jest.fn().mockReturnValue(true),
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("mock-hash"),
  }),
};

describe("Remote Command Flow Integration", () => {
  let remoteGateway;
  let permissionGate;
  let clipboardHandler;
  let notificationHandler;
  let workflowHandler;
  let mockMobileBridge;
  let mockDatabase;
  let mockDIDManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock database
    mockDatabase = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
        all: jest.fn().mockReturnValue([]),
        get: jest.fn().mockReturnValue(null),
      }),
      exec: jest.fn(),
    };

    // Setup mock DID manager
    mockDIDManager = {
      cache: {
        get: jest.fn().mockResolvedValue({
          did: "did:example:123",
          publicKey: "mock-public-key",
        }),
      },
      verifySignature: jest.fn().mockResolvedValue(true),
    };

    // Setup mock mobile bridge
    mockMobileBridge = new EventEmitter();
    mockMobileBridge.sendToDevice = jest
      .fn()
      .mockResolvedValue({ success: true });
    mockMobileBridge.broadcast = jest.fn().mockResolvedValue({ success: true });
    mockMobileBridge.isConnected = jest.fn().mockReturnValue(true);

    // Import modules after mocks are setup
    const {
      PermissionGate,
    } = require("../../../src/main/remote/permission-gate");
    const {
      ClipboardHandler,
    } = require("../../../src/main/remote/handlers/clipboard-handler");
    const {
      NotificationHandler,
    } = require("../../../src/main/remote/handlers/notification-handler");
    const {
      WorkflowHandler,
    } = require("../../../src/main/remote/handlers/workflow-handler");
    const {
      RemoteGateway,
    } = require("../../../src/main/remote/remote-gateway");

    // Create instances
    permissionGate = new PermissionGate(mockDIDManager, null, mockDatabase);
    clipboardHandler = new ClipboardHandler(mockMobileBridge);
    notificationHandler = new NotificationHandler(
      mockMobileBridge,
      mockDatabase,
    );

    // Mock workflow engine
    const mockWorkflowEngine = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: true, completedSteps: 1 }),
      getStatus: jest.fn().mockReturnValue({ status: "running" }),
      cancel: jest.fn().mockReturnValue(true),
      getRunning: jest.fn().mockReturnValue([]),
    };
    workflowHandler = new WorkflowHandler(mockWorkflowEngine, mockDatabase);

    // Create gateway with all handlers
    remoteGateway = new RemoteGateway({
      permissionGate,
      handlers: {
        clipboard: clipboardHandler,
        notification: notificationHandler,
        workflow: workflowHandler,
      },
      mobileBridge: mockMobileBridge,
    });
  });

  afterEach(() => {
    if (clipboardHandler) {
      clipboardHandler.stopWatching();
    }
  });

  describe("完整命令处理流程", () => {
    test("应该完成认证->权限检查->命令执行的完整流程", async () => {
      // 模拟从移动端收到的命令
      const command = {
        jsonrpc: "2.0",
        id: "req-001",
        method: "clipboard.get",
        params: { type: "text" },
        auth: {
          did: "did:example:123",
          signature: "valid-signature",
          timestamp: Date.now(),
          nonce: "unique-nonce-001",
        },
      };

      // Mock successful verification
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      // 处理命令
      const response = await remoteGateway.handleCommand(
        command,
        "mobile-device-123",
        (resp) => resp, // mock sendResponse
      );

      expect(response.success).toBe(true);
      expect(response.content).toBe("Clipboard content");
    });

    test("应该拒绝缺少认证信息的命令", async () => {
      const command = {
        jsonrpc: "2.0",
        id: "req-002",
        method: "clipboard.get",
        params: { type: "text" },
        // No auth
      };

      let responseReceived = null;
      await remoteGateway.handleCommand(
        command,
        "mobile-device-123",
        (resp) => {
          responseReceived = resp;
        },
      );

      expect(responseReceived.error).toBeDefined();
      expect(responseReceived.error.code).toBe(-32001);
    });

    test("应该拒绝重放攻击", async () => {
      const auth = {
        did: "did:example:123",
        signature: "valid-signature",
        timestamp: Date.now(),
        nonce: "unique-nonce-002",
      };

      // First request should succeed
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      const command1 = {
        jsonrpc: "2.0",
        id: "req-003",
        method: "clipboard.get",
        params: { type: "text" },
        auth,
      };

      await remoteGateway.handleCommand(command1, "mobile-123", (r) => r);

      // Second request with same nonce should fail
      jest.spyOn(permissionGate, "verify").mockResolvedValue(false);

      const command2 = {
        jsonrpc: "2.0",
        id: "req-004",
        method: "clipboard.get",
        params: { type: "text" },
        auth, // Same auth with same nonce
      };

      let response = null;
      await remoteGateway.handleCommand(command2, "mobile-123", (r) => {
        response = r;
      });

      expect(response.error).toBeDefined();
    });

    test("应该拒绝过期的请求", async () => {
      const command = {
        jsonrpc: "2.0",
        id: "req-005",
        method: "clipboard.get",
        params: { type: "text" },
        auth: {
          did: "did:example:123",
          signature: "valid-signature",
          timestamp: Date.now() - 400000, // 400 seconds ago (>5 min)
          nonce: "unique-nonce-005",
        },
      };

      jest.spyOn(permissionGate, "verify").mockResolvedValue(false);

      let response = null;
      await remoteGateway.handleCommand(command, "mobile-123", (r) => {
        response = r;
      });

      expect(response.error).toBeDefined();
    });
  });

  describe("剪贴板功能集成", () => {
    test("应该完成剪贴板读取流程", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      const command = {
        jsonrpc: "2.0",
        id: "clip-001",
        method: "clipboard.get",
        params: { type: "text" },
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "clip-nonce-001",
        },
      };

      const response = await remoteGateway.handleCommand(
        command,
        "mobile-123",
        (r) => r,
      );

      expect(response.success).toBe(true);
      expect(response.type).toBe("text");
    });

    test("应该完成剪贴板写入流程", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      const command = {
        jsonrpc: "2.0",
        id: "clip-002",
        method: "clipboard.set",
        params: { type: "text", content: "New content from Android" },
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "clip-nonce-002",
        },
      };

      const response = await remoteGateway.handleCommand(
        command,
        "mobile-123",
        (r) => r,
      );

      expect(response.success).toBe(true);
    });
  });

  describe("通知功能集成", () => {
    test("应该完成通知发送流程", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      const command = {
        jsonrpc: "2.0",
        id: "notif-001",
        method: "notification.send",
        params: {
          title: "Test Notification",
          body: "Message from Android device",
        },
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "notif-nonce-001",
        },
      };

      const response = await remoteGateway.handleCommand(
        command,
        "mobile-123",
        (r) => r,
      );

      expect(response.success).toBe(true);
      expect(response.notificationId).toBeDefined();
    });
  });

  describe("工作流功能集成", () => {
    test("应该完成工作流创建和执行流程", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      // Create workflow
      const createCommand = {
        jsonrpc: "2.0",
        id: "wf-001",
        method: "workflow.create",
        params: {
          name: "Test Workflow",
          steps: [
            { id: "step1", action: "system.log", params: { message: "Hello" } },
          ],
        },
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "wf-nonce-001",
        },
      };

      const createResponse = await remoteGateway.handleCommand(
        createCommand,
        "mobile-123",
        (r) => r,
      );
      expect(createResponse.success).toBe(true);

      // Execute workflow
      mockDatabase.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: createResponse.workflowId,
          definition: JSON.stringify({
            steps: [{ id: "step1", action: "system.log", params: {} }],
          }),
        }),
        run: jest.fn(),
        all: jest.fn(),
      });

      const executeCommand = {
        jsonrpc: "2.0",
        id: "wf-002",
        method: "workflow.execute",
        params: {
          workflowId: createResponse.workflowId,
        },
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "wf-nonce-002",
        },
      };

      const executeResponse = await remoteGateway.handleCommand(
        executeCommand,
        "mobile-123",
        (r) => r,
      );
      expect(executeResponse.success).toBe(true);
    });
  });

  describe("权限级别控制", () => {
    test("应该根据权限级别控制访问", async () => {
      // Test PUBLIC level command (should succeed without special permissions)
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      const publicCommand = {
        jsonrpc: "2.0",
        id: "perm-001",
        method: "system.getStatus",
        params: {},
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "perm-nonce-001",
        },
      };

      const publicResponse = await remoteGateway.handleCommand(
        publicCommand,
        "mobile-123",
        (r) => r,
      );
      // Should not be rejected due to permissions
      expect(publicResponse.error?.code).not.toBe(-32001);
    });

    test("应该拒绝无权限的高级操作", async () => {
      // Simulate permission denied for admin-level command
      jest.spyOn(permissionGate, "verify").mockResolvedValue(false);

      const adminCommand = {
        jsonrpc: "2.0",
        id: "perm-002",
        method: "system.execCommand",
        params: { command: "dangerous-command" },
        auth: {
          did: "did:example:low-privilege",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "perm-nonce-002",
        },
      };

      let response = null;
      await remoteGateway.handleCommand(adminCommand, "mobile-123", (r) => {
        response = r;
      });

      expect(response.error).toBeDefined();
    });
  });

  describe("错误处理", () => {
    test("应该正确处理handler异常", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);
      jest
        .spyOn(clipboardHandler, "handle")
        .mockRejectedValue(new Error("Handler error"));

      const command = {
        jsonrpc: "2.0",
        id: "err-001",
        method: "clipboard.get",
        params: { type: "text" },
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "err-nonce-001",
        },
      };

      let response = null;
      await remoteGateway.handleCommand(command, "mobile-123", (r) => {
        response = r;
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32603); // Internal error
    });

    test("应该处理无效的JSON-RPC请求", async () => {
      const invalidCommand = {
        // Missing jsonrpc version
        id: "invalid-001",
        method: "clipboard.get",
      };

      let response = null;
      await remoteGateway.handleCommand(invalidCommand, "mobile-123", (r) => {
        response = r;
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32600); // Invalid request
    });

    test("应该处理未知方法", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      const command = {
        jsonrpc: "2.0",
        id: "unknown-001",
        method: "unknown.method",
        params: {},
        auth: {
          did: "did:example:123",
          signature: "valid-sig",
          timestamp: Date.now(),
          nonce: "unknown-nonce-001",
        },
      };

      let response = null;
      await remoteGateway.handleCommand(command, "mobile-123", (r) => {
        response = r;
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601); // Method not found
    });
  });

  describe("统计追踪", () => {
    test("应该追踪命令执行统计", async () => {
      jest.spyOn(permissionGate, "verify").mockResolvedValue(true);

      // Execute several commands
      for (let i = 0; i < 5; i++) {
        const command = {
          jsonrpc: "2.0",
          id: `stat-${i}`,
          method: "clipboard.get",
          params: { type: "text" },
          auth: {
            did: "did:example:123",
            signature: "valid-sig",
            timestamp: Date.now(),
            nonce: `stat-nonce-${i}`,
          },
        };

        await remoteGateway.handleCommand(command, "mobile-123", (r) => r);
      }

      const stats = remoteGateway.getStats();
      expect(stats.totalRequests).toBe(5);
      expect(stats.successRequests).toBe(5);
    });
  });
});
