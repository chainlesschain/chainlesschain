/**
 * PermissionGate 单元测试
 *
 * 测试权限验证器的核心功能：
 * - 权限级别验证
 * - 时间戳验证（防重放攻击）
 * - Nonce 验证
 * - 频率限制
 * - 设备权限管理
 *
 * 注意：开关机相关测试已跳过
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PermissionGate, PERMISSION_LEVELS } from "../permission-gate";

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock nacl (CJS module, no default wrapper needed)
vi.mock("tweetnacl", () => ({
  sign: {
    detached: {
      verify: vi.fn().mockReturnValue(true),
    },
  },
}));

vi.mock("tweetnacl-util", () => ({
  decodeBase64: vi.fn().mockReturnValue(new Uint8Array(32)),
  decodeUTF8: vi.fn().mockReturnValue(new Uint8Array(10)),
}));

// Mock database
const createMockDatabase = () => {
  const data = {
    device_permissions: new Map(),
    permission_audit_log: [],
    used_nonces: new Map(),
  };

  return {
    exec: vi.fn(),
    prepare: vi.fn().mockImplementation((sql) => {
      if (sql.includes("SELECT") && sql.includes("device_permissions")) {
        return {
          get: vi.fn().mockImplementation((did) => {
            const entry = data.device_permissions.get(did);
            return entry || null;
          }),
          all: vi.fn().mockReturnValue([]),
        };
      }
      if (sql.includes("SELECT") && sql.includes("used_nonces")) {
        return {
          get: vi.fn().mockImplementation((nonceKey) => {
            return data.used_nonces.has(nonceKey)
              ? { nonce_key: nonceKey }
              : null;
          }),
        };
      }
      if (sql.includes("INSERT") && sql.includes("used_nonces")) {
        return {
          run: vi.fn().mockImplementation((nonceKey, did, timestamp) => {
            data.used_nonces.set(nonceKey, { did, timestamp });
          }),
        };
      }
      if (sql.includes("INSERT") && sql.includes("permission_audit_log")) {
        return {
          run: vi.fn().mockImplementation((...args) => {
            data.permission_audit_log.push(args);
          }),
        };
      }
      if (sql.includes("INSERT") && sql.includes("device_permissions")) {
        return {
          run: vi
            .fn()
            .mockImplementation(
              (did, level, name, grantedAt, grantedBy, expiresAt, notes) => {
                data.device_permissions.set(did, {
                  did,
                  permission_level: level,
                  device_name: name,
                  granted_at: grantedAt,
                  expires_at: expiresAt,
                });
              },
            ),
        };
      }
      if (sql.includes("UPDATE") && sql.includes("device_permissions")) {
        return { run: vi.fn() };
      }
      if (sql.includes("DELETE")) {
        return {
          run: vi.fn().mockImplementation((param) => {
            if (sql.includes("used_nonces")) {
              return { changes: 0 };
            }
            if (sql.includes("device_permissions")) {
              data.device_permissions.delete(param);
            }
          }),
        };
      }
      if (sql.includes("SELECT") && sql.includes("permission_audit_log")) {
        return {
          all: vi.fn().mockReturnValue(data.permission_audit_log),
        };
      }
      if (sql.includes("COUNT")) {
        return {
          get: vi.fn().mockReturnValue({ count: data.used_nonces.size }),
        };
      }
      return {
        run: vi.fn(),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      };
    }),
    _data: data,
  };
};

// Mock DID Manager
const createMockDidManager = () => ({
  cache: {
    get: vi.fn().mockResolvedValue({
      did: "did:test:123",
      public_key_sign: "base64PublicKey",
    }),
  },
});

// Mock U-Key Manager
const createMockUKeyManager = () => ({
  verifyPIN: vi.fn().mockResolvedValue({ success: true }),
});

describe("PermissionGate", () => {
  let permissionGate;
  let mockDatabase;
  let mockDidManager;
  let mockUKeyManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));

    mockDatabase = createMockDatabase();
    mockDidManager = createMockDidManager();
    mockUKeyManager = createMockUKeyManager();

    permissionGate = new PermissionGate(
      mockDidManager,
      mockUKeyManager,
      mockDatabase,
      {
        timestampWindow: 300000, // 5分钟
        enableRateLimit: true,
        defaultRateLimit: 100,
        highRiskRateLimit: 10,
        enableNonceCheck: true,
        nonceExpiry: 600000, // 10分钟
        requireUKeyForLevel4: true,
        enableAutoRevoke: false, // 测试中禁用自动撤销
      },
    );
  });

  afterEach(() => {
    if (permissionGate) {
      permissionGate.stopCleanup();
      permissionGate.stopAutoRevokeCheck();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("构造函数", () => {
    it("应该使用默认选项初始化", () => {
      const gate = new PermissionGate(
        mockDidManager,
        mockUKeyManager,
        mockDatabase,
      );
      expect(gate.options.timestampWindow).toBe(300000);
      expect(gate.options.enableRateLimit).toBe(true);
      expect(gate.options.defaultRateLimit).toBe(100);
    });

    it("应该初始化空的缓存", () => {
      expect(permissionGate.devicePermissions.size).toBe(0);
      expect(permissionGate.nonceCache.size).toBe(0);
      expect(permissionGate.rateLimitCache.size).toBe(0);
    });
  });

  describe("initialize", () => {
    it("应该成功初始化", async () => {
      await permissionGate.initialize();

      expect(mockDatabase.exec).toHaveBeenCalled();
      expect(mockDatabase.prepare).toHaveBeenCalled();
    });
  });

  describe("PERMISSION_LEVELS", () => {
    it("应该定义正确的权限级别", () => {
      expect(PERMISSION_LEVELS.PUBLIC).toBe(1);
      expect(PERMISSION_LEVELS.NORMAL).toBe(2);
      expect(PERMISSION_LEVELS.ADMIN).toBe(3);
      expect(PERMISSION_LEVELS.ROOT).toBe(4);
    });
  });

  describe("getCommandPermissionLevel", () => {
    it("应该返回已配置命令的权限级别", () => {
      expect(permissionGate.getCommandPermissionLevel("ai.chat")).toBe(
        PERMISSION_LEVELS.NORMAL,
      );
      expect(permissionGate.getCommandPermissionLevel("system.getStatus")).toBe(
        PERMISSION_LEVELS.PUBLIC,
      );
      expect(permissionGate.getCommandPermissionLevel("file.delete")).toBe(
        PERMISSION_LEVELS.ADMIN,
      );
    });

    it("应该对未配置命令返回默认级别", () => {
      expect(permissionGate.getCommandPermissionLevel("unknown.command")).toBe(
        PERMISSION_LEVELS.NORMAL,
      );
    });

    it("应该支持通配符匹配", () => {
      // channel.*.send 配置为 NORMAL
      expect(
        permissionGate.getCommandPermissionLevel("channel.telegram.send"),
      ).toBe(PERMISSION_LEVELS.NORMAL);
    });
  });

  describe("registerCommandPermission", () => {
    it("应该注册自定义命令权限", () => {
      permissionGate.registerCommandPermission(
        "custom.action",
        PERMISSION_LEVELS.ADMIN,
      );

      expect(permissionGate.getCommandPermissionLevel("custom.action")).toBe(
        PERMISSION_LEVELS.ADMIN,
      );
    });
  });

  describe("verify - 基础验证", () => {
    const validAuth = {
      did: "did:test:123",
      signature: "validSignature",
      timestamp: Date.now(),
      nonce: "uniqueNonce123",
    };

    it("应该拒绝缺少认证信息的请求", async () => {
      const result = await permissionGate.verify(null, "ai.chat");
      expect(result).toBe(false);
    });

    it("应该拒绝缺少 DID 的请求", async () => {
      const result = await permissionGate.verify(
        { signature: "sig", timestamp: Date.now(), nonce: "nonce" },
        "ai.chat",
      );
      expect(result).toBe(false);
    });

    it("应该拒绝缺少签名的请求", async () => {
      const result = await permissionGate.verify(
        { did: "did:test:123", timestamp: Date.now(), nonce: "nonce" },
        "ai.chat",
      );
      expect(result).toBe(false);
    });

    it("应该拒绝缺少时间戳的请求", async () => {
      const result = await permissionGate.verify(
        { did: "did:test:123", signature: "sig", nonce: "nonce" },
        "ai.chat",
      );
      expect(result).toBe(false);
    });

    it("应该拒绝缺少 nonce 的请求", async () => {
      const result = await permissionGate.verify(
        { did: "did:test:123", signature: "sig", timestamp: Date.now() },
        "ai.chat",
      );
      expect(result).toBe(false);
    });
  });

  describe("verify - 时间戳验证", () => {
    it("应该拒绝过期的时间戳", async () => {
      const oldTimestamp = Date.now() - 600000; // 10分钟前

      const result = await permissionGate.verify(
        {
          did: "did:test:123",
          signature: "sig",
          timestamp: oldTimestamp,
          nonce: "nonce1",
        },
        "ai.chat",
      );

      expect(result).toBe(false);
    });

    it("应该接受有效时间戳", async () => {
      // 设置设备权限为 NORMAL
      await permissionGate.setDevicePermissionLevel(
        "did:test:123",
        PERMISSION_LEVELS.NORMAL,
      );

      const result = await permissionGate.verify(
        {
          did: "did:test:123",
          signature: "sig",
          timestamp: Date.now(),
          nonce: "validNonce",
        },
        "ai.chat",
      );

      expect(result).toBe(true);
    });
  });

  describe("verify - Nonce 验证", () => {
    it("应该拒绝重复使用的 nonce", async () => {
      await permissionGate.setDevicePermissionLevel(
        "did:test:123",
        PERMISSION_LEVELS.NORMAL,
      );

      const auth = {
        did: "did:test:123",
        signature: "sig",
        timestamp: Date.now(),
        nonce: "repeatedNonce",
      };

      // 第一次应该成功
      const result1 = await permissionGate.verify(auth, "ai.chat");
      expect(result1).toBe(true);

      // 第二次应该失败（nonce 已使用）
      const result2 = await permissionGate.verify(auth, "ai.chat");
      expect(result2).toBe(false);
    });
  });

  describe("verify - 权限级别检查", () => {
    it("应该允许足够权限的设备", async () => {
      await permissionGate.setDevicePermissionLevel(
        "did:test:admin",
        PERMISSION_LEVELS.ADMIN,
      );

      const result = await permissionGate.verify(
        {
          did: "did:test:admin",
          signature: "sig",
          timestamp: Date.now(),
          nonce: "adminNonce",
        },
        "file.delete", // 需要 ADMIN 权限
      );

      expect(result).toBe(true);
    });

    it("应该拒绝权限不足的设备", async () => {
      // 设备默认为 PUBLIC 权限
      const result = await permissionGate.verify(
        {
          did: "did:test:public",
          signature: "sig",
          timestamp: Date.now(),
          nonce: "publicNonce",
        },
        "file.delete", // 需要 ADMIN 权限
      );

      expect(result).toBe(false);
    });
  });

  describe("setDevicePermissionLevel", () => {
    it("应该成功设置设备权限", async () => {
      const result = await permissionGate.setDevicePermissionLevel(
        "did:test:device1",
        PERMISSION_LEVELS.ADMIN,
        { deviceName: "Test Device", grantedBy: "admin" },
      );

      expect(result.success).toBe(true);
      expect(permissionGate.devicePermissions.get("did:test:device1")).toBe(
        PERMISSION_LEVELS.ADMIN,
      );
    });

    it("应该支持权限过期时间", async () => {
      await permissionGate.setDevicePermissionLevel(
        "did:test:temp",
        PERMISSION_LEVELS.ADMIN,
        { expiresIn: 3600000 }, // 1小时
      );

      expect(permissionGate.devicePermissions.has("did:test:temp")).toBe(true);
    });
  });

  describe("getDevicePermissionLevel", () => {
    it("应该返回缓存的权限级别", async () => {
      permissionGate.devicePermissions.set(
        "did:test:cached",
        PERMISSION_LEVELS.ADMIN,
      );

      const level =
        await permissionGate.getDevicePermissionLevel("did:test:cached");

      expect(level).toBe(PERMISSION_LEVELS.ADMIN);
    });

    it("应该对未知设备返回 PUBLIC 权限", async () => {
      const level =
        await permissionGate.getDevicePermissionLevel("did:test:unknown");

      expect(level).toBe(PERMISSION_LEVELS.PUBLIC);
    });
  });

  describe("checkRateLimit", () => {
    it("应该允许在限制内的请求", async () => {
      const result = await permissionGate.checkRateLimit(
        "did:test:rate",
        "ai.chat",
        PERMISSION_LEVELS.NORMAL,
      );

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.limit).toBe(100);
    });

    it("应该对高风险命令使用更低的限制", async () => {
      const result = await permissionGate.checkRateLimit(
        "did:test:rate",
        "file.delete",
        PERMISSION_LEVELS.ADMIN,
      );

      expect(result.limit).toBe(10);
    });

    it("应该在超限时拒绝请求", async () => {
      // 发送 100 个请求
      for (let i = 0; i < 100; i++) {
        await permissionGate.checkRateLimit(
          "did:test:flood",
          "ai.chat",
          PERMISSION_LEVELS.NORMAL,
        );
      }

      // 第 101 个请求应该被拒绝
      const result = await permissionGate.checkRateLimit(
        "did:test:flood",
        "ai.chat",
        PERMISSION_LEVELS.NORMAL,
      );

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(100);
    });
  });

  describe("revokeDevice", () => {
    it("应该成功撤销设备权限", async () => {
      await permissionGate.setDevicePermissionLevel(
        "did:test:revoke",
        PERMISSION_LEVELS.ADMIN,
      );

      const result = await permissionGate.revokeDevice(
        "did:test:revoke",
        "Test revocation",
      );

      expect(result.success).toBe(true);
      expect(permissionGate.devicePermissions.has("did:test:revoke")).toBe(
        false,
      );
    });
  });

  describe("getAuditLogs", () => {
    it("应该返回审计日志", () => {
      const logs = permissionGate.getAuditLogs({ limit: 10 });

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe("getStats", () => {
    it("应该返回统计信息", () => {
      permissionGate.devicePermissions.set("did:1", 2);
      permissionGate.devicePermissions.set("did:2", 3);
      permissionGate.nonceCache.set("nonce1", Date.now());

      const stats = permissionGate.getStats();

      expect(stats.devicePermissions).toBe(2);
      expect(stats.nonceCache).toBe(1);
      expect(stats.registeredCommands).toBeGreaterThan(0);
    });
  });

  describe("cleanup", () => {
    it("应该清理过期的 nonce", () => {
      // 添加过期的 nonce
      const expiredTime = Date.now() - 700000; // 超过 10 分钟
      permissionGate.nonceCache.set("expired", expiredTime);
      permissionGate.nonceCache.set("valid", Date.now());

      permissionGate.cleanup();

      expect(permissionGate.nonceCache.has("expired")).toBe(false);
      expect(permissionGate.nonceCache.has("valid")).toBe(true);
    });

    it("应该清理不活跃的频率限制缓存", () => {
      // 添加过期的频率限制
      permissionGate.rateLimitCache.set("did:old", {
        requests: [],
        lastCleanup: Date.now() - 400000, // 超过 5 分钟
      });
      permissionGate.rateLimitCache.set("did:active", {
        requests: [],
        lastCleanup: Date.now(),
      });

      permissionGate.cleanup();

      expect(permissionGate.rateLimitCache.has("did:old")).toBe(false);
      expect(permissionGate.rateLimitCache.has("did:active")).toBe(true);
    });
  });

  describe("电源相关命令权限（跳过开关机测试）", () => {
    it.skip("power.shutdown 需要 ROOT 权限", () => {
      // 跳过 - 开关机相关测试
    });

    it.skip("power.restart 需要 ROOT 权限", () => {
      // 跳过 - 开关机相关测试
    });

    it("power.lock 需要 NORMAL 权限", () => {
      expect(permissionGate.getCommandPermissionLevel("power.lock")).toBe(
        PERMISSION_LEVELS.NORMAL,
      );
    });

    it("power.getSchedule 需要 PUBLIC 权限", () => {
      expect(
        permissionGate.getCommandPermissionLevel("power.getSchedule"),
      ).toBe(PERMISSION_LEVELS.PUBLIC);
    });
  });

  describe("stopCleanup", () => {
    it("应该停止清理定时器", () => {
      permissionGate.startCleanup();
      permissionGate.stopCleanup();

      expect(permissionGate.cleanupTimer).toBeNull();
    });
  });

  describe("shutdown", () => {
    it("应该停止所有定时器", () => {
      permissionGate.startCleanup();
      permissionGate.shutdown();

      expect(permissionGate.cleanupTimer).toBeNull();
      expect(permissionGate.autoRevokeTimer).toBeNull();
    });
  });
});
