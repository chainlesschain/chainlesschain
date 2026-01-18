/**
 * MCP Security Policy Unit Tests
 *
 * Tests for path validation, consent management, and security enforcement.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";

// Mock crypto module
vi.mock("crypto", () => ({
  createHash: () => ({
    update: () => ({
      digest: () => "mock-hash",
    }),
  }),
  randomUUID: () => "mock-uuid-" + Date.now(),
}));

// Import after mocking
const {
  MCPSecurityPolicy,
} = require("../../../src/main/mcp/mcp-security-policy");

describe("MCPSecurityPolicy", () => {
  let securityPolicy;

  beforeEach(() => {
    securityPolicy = new MCPSecurityPolicy({});
  });

  afterEach(() => {
    securityPolicy = null;
  });

  describe("Path Validation", () => {
    it("should block access to chainlesschain.db", async () => {
      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/data/chainlesschain.db" },
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("forbidden");
    });

    it("should block access to ukey directory", async () => {
      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/data/ukey/keys.json" },
      );

      expect(result.allowed).toBe(false);
    });

    it("should block access to DID private keys", async () => {
      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/data/did/private-keys/key.pem" },
      );

      expect(result.allowed).toBe(false);
    });

    it("should block access to P2P keys", async () => {
      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/data/p2p/keys/session.key" },
      );

      expect(result.allowed).toBe(false);
    });

    it("should block access to .env file", async () => {
      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/.env" },
      );

      expect(result.allowed).toBe(false);
    });

    it("should block access to secrets directory", async () => {
      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/config/secrets/api-keys.json" },
      );

      expect(result.allowed).toBe(false);
    });

    it("should allow access to notes directory when configured", async () => {
      securityPolicy.setServerPermissions("filesystem", {
        allowedPaths: ["notes/", "imports/"],
        forbiddenPaths: [],
        readOnly: false,
      });

      const result = await securityPolicy.validateOperation(
        "filesystem",
        "read_file",
        { path: "/data/notes/my-note.md" },
      );

      // Should be allowed for read operations in allowed paths
      expect(result.reason).not.toContain("forbidden path");
    });
  });

  describe("Operation Detection", () => {
    it("should detect read operations", () => {
      const operation = securityPolicy._detectOperation("read_file", {
        path: "/test.txt",
      });
      expect(operation.type).toBe("read");
    });

    it("should detect write operations", () => {
      const operation = securityPolicy._detectOperation("write_file", {
        path: "/test.txt",
        content: "data",
      });
      expect(operation.type).toBe("write");
    });

    it("should detect delete operations", () => {
      const operation = securityPolicy._detectOperation("delete_file", {
        path: "/test.txt",
      });
      expect(operation.type).toBe("delete");
    });

    it("should detect execute operations", () => {
      // Tool names containing "exec", "run", or "execute" are classified as execute
      const operation = securityPolicy._detectOperation("execute_query", {
        sql: "SELECT * FROM users",
      });
      expect(operation.type).toBe("execute");
    });
  });

  describe("Risk Assessment", () => {
    it("should assess low risk for read operations", () => {
      const operation = { type: "read", isDestructive: false };
      const risk = securityPolicy._assessRiskLevel(
        "read_file",
        {
          path: "/data/notes/test.md",
        },
        operation,
      );
      expect(risk).toBe(securityPolicy.RISK_LEVELS.LOW);
    });

    it("should assess high risk for write operations", () => {
      const operation = { type: "write", isDestructive: false };
      const risk = securityPolicy._assessRiskLevel(
        "write_file",
        {
          path: "/data/notes/test.md",
          content: "data",
        },
        operation,
      );
      expect(risk).toBe(securityPolicy.RISK_LEVELS.HIGH);
    });

    it("should assess critical risk for destructive operations", () => {
      const operation = { type: "delete", isDestructive: true };
      const risk = securityPolicy._assessRiskLevel(
        "delete_file",
        {
          path: "/data/notes/test.md",
        },
        operation,
      );
      expect(risk).toBe(securityPolicy.RISK_LEVELS.CRITICAL);
    });
  });

  describe("Consent Management", () => {
    it("should handle consent responses", () => {
      // Create a mock pending request
      const requestId = "test-request-id";
      let resolvedValue = null;

      securityPolicy.pendingConsentRequests.set(requestId, {
        resolve: (val) => {
          resolvedValue = val;
        },
        reject: () => {},
        timeout: setTimeout(() => {}, 30000),
        cacheKey: "test-cache-key",
        timestamp: Date.now(),
      });

      const result = securityPolicy.handleConsentResponse(requestId, "allow");

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(securityPolicy.pendingConsentRequests.has(requestId)).toBe(false);
    });

    it("should cache always_allow decisions", () => {
      const requestId = "test-request-id-2";
      const cacheKey = "test-cache-key-2";

      securityPolicy.pendingConsentRequests.set(requestId, {
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 30000),
        cacheKey,
        timestamp: Date.now(),
      });

      securityPolicy.handleConsentResponse(requestId, "always_allow");

      expect(securityPolicy.consentCache.has(cacheKey)).toBe(true);
      expect(securityPolicy.consentCache.get(cacheKey).decision).toBe(
        "always_allow",
      );
    });

    it("should cache always_deny decisions", () => {
      const requestId = "test-request-id-3";
      const cacheKey = "test-cache-key-3";
      let rejectedError = null;

      securityPolicy.pendingConsentRequests.set(requestId, {
        resolve: () => {},
        reject: (err) => {
          rejectedError = err;
        },
        timeout: setTimeout(() => {}, 30000),
        cacheKey,
        timestamp: Date.now(),
      });

      const result = securityPolicy.handleConsentResponse(
        requestId,
        "always_deny",
      );

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(false);
      expect(securityPolicy.consentCache.has(cacheKey)).toBe(true);
      expect(securityPolicy.consentCache.get(cacheKey).decision).toBe(
        "always_deny",
      );
    });

    it("should return error for unknown request", () => {
      const result = securityPolicy.handleConsentResponse(
        "unknown-id",
        "allow",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown request");
    });

    it("should cancel pending consent requests", () => {
      const requestId = "test-cancel-id";
      let rejected = false;

      securityPolicy.pendingConsentRequests.set(requestId, {
        resolve: () => {},
        reject: () => {
          rejected = true;
        },
        timeout: setTimeout(() => {}, 30000),
        cacheKey: "test",
        timestamp: Date.now(),
      });

      const cancelled = securityPolicy.cancelConsentRequest(requestId);

      expect(cancelled).toBe(true);
      expect(rejected).toBe(true);
      expect(securityPolicy.pendingConsentRequests.has(requestId)).toBe(false);
    });

    it("should return false for cancelling unknown request", () => {
      const cancelled = securityPolicy.cancelConsentRequest("unknown-id");
      expect(cancelled).toBe(false);
    });
  });

  describe("Audit Logging", () => {
    it("should log operations", () => {
      // Implementation uses: _logAudit(decision, serverName, toolName, params, details)
      securityPolicy._logAudit(
        "ALLOWED",
        "filesystem",
        "read_file",
        { path: "/test.txt" },
        "Success",
      );

      const log = securityPolicy.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].serverName).toBe("filesystem");
      expect(log[0].toolName).toBe("read_file");
      expect(log[0].decision).toBe("ALLOWED");
    });

    it("should filter audit log by server", () => {
      securityPolicy._logAudit("ALLOWED", "filesystem", "read_file", {}, "OK");
      securityPolicy._logAudit("ALLOWED", "postgres", "query", {}, "OK");

      const filteredLog = securityPolicy.getAuditLog({
        serverName: "filesystem",
      });

      expect(
        filteredLog.every((entry) => entry.serverName === "filesystem"),
      ).toBe(true);
    });

    it("should filter audit log by decision", () => {
      securityPolicy._logAudit("ALLOWED", "filesystem", "read_file", {}, "OK");
      securityPolicy._logAudit(
        "DENIED",
        "filesystem",
        "delete_file",
        {},
        "Forbidden path",
      );

      const deniedLog = securityPolicy.getAuditLog({ decision: "DENIED" });

      expect(deniedLog.every((entry) => entry.decision === "DENIED")).toBe(
        true,
      );
    });
  });

  describe("Server Permissions", () => {
    it("should set and get server permissions", () => {
      const permissions = {
        allowedPaths: ["notes/", "imports/"],
        forbiddenPaths: ["secrets/"],
        readOnly: true,
      };

      securityPolicy.setServerPermissions("filesystem", permissions);

      const retrieved = securityPolicy.getServerPermissions("filesystem");
      // setServerPermissions normalizes and adds default requireConsent
      expect(retrieved).toEqual({
        ...permissions,
        requireConsent: true,
      });
    });

    it("should return null for unknown server permissions", () => {
      const permissions = securityPolicy.getServerPermissions("unknown-server");
      expect(permissions).toBeNull();
    });
  });

  describe("Statistics", () => {
    it("should track validation statistics", () => {
      // Create some audit log entries using implementation API
      securityPolicy._logAudit("ALLOWED", "filesystem", "read_file", {}, "OK");
      securityPolicy._logAudit("ALLOWED", "filesystem", "write_file", {}, "OK");
      securityPolicy._logAudit(
        "DENIED",
        "filesystem",
        "delete_file",
        {},
        "Forbidden",
      );

      const stats = securityPolicy.getStatistics();

      expect(stats.totalOperations).toBe(3);
      expect(stats.allowed).toBe(2);
      expect(stats.denied).toBe(1);
    });
  });

  describe("Consent Cache", () => {
    it("should clear consent cache", () => {
      securityPolicy.consentCache.set("key1", {
        decision: "always_allow",
        timestamp: Date.now(),
      });
      securityPolicy.consentCache.set("key2", {
        decision: "always_deny",
        timestamp: Date.now(),
      });

      expect(securityPolicy.consentCache.size).toBe(2);

      securityPolicy.clearConsentCache();

      expect(securityPolicy.consentCache.size).toBe(0);
    });
  });
});
