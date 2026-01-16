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
const MCPSecurityPolicy = require("../../../src/main/mcp/mcp-security-policy");

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

    it("should detect execute operations for SQL", () => {
      const operation = securityPolicy._detectOperation("query", {
        sql: "SELECT * FROM users",
      });
      expect(operation.type).toBe("execute");
    });
  });

  describe("Risk Assessment", () => {
    it("should assess low risk for read operations", () => {
      const risk = securityPolicy._assessRisk("filesystem", "read_file", {
        path: "/data/notes/test.md",
      });
      expect(risk).toBe("low");
    });

    it("should assess medium risk for write operations", () => {
      const risk = securityPolicy._assessRisk("filesystem", "write_file", {
        path: "/data/notes/test.md",
        content: "data",
      });
      expect(risk).toBe("medium");
    });

    it("should assess high risk for delete operations", () => {
      const risk = securityPolicy._assessRisk("filesystem", "delete_file", {
        path: "/data/notes/test.md",
      });
      expect(risk).toBe("high");
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
      securityPolicy._logAudit(
        "filesystem",
        "read_file",
        { path: "/test.txt" },
        true,
        "Success",
      );

      const log = securityPolicy.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].serverName).toBe("filesystem");
      expect(log[0].toolName).toBe("read_file");
      expect(log[0].allowed).toBe(true);
    });

    it("should filter audit log by server", () => {
      securityPolicy._logAudit("filesystem", "read_file", {}, true, "OK");
      securityPolicy._logAudit("postgres", "query", {}, true, "OK");

      const filteredLog = securityPolicy.getAuditLog({
        serverName: "filesystem",
      });

      expect(
        filteredLog.every((entry) => entry.serverName === "filesystem"),
      ).toBe(true);
    });

    it("should filter audit log by allowed status", () => {
      securityPolicy._logAudit("filesystem", "read_file", {}, true, "OK");
      securityPolicy._logAudit(
        "filesystem",
        "delete_file",
        {},
        false,
        "Denied",
      );

      const deniedLog = securityPolicy.getAuditLog({ allowed: false });

      expect(deniedLog.every((entry) => entry.allowed === false)).toBe(true);
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
      expect(retrieved).toEqual(permissions);
    });

    it("should return null for unknown server permissions", () => {
      const permissions = securityPolicy.getServerPermissions("unknown-server");
      expect(permissions).toBeNull();
    });
  });

  describe("Statistics", () => {
    it("should track validation statistics", () => {
      // Create some audit log entries
      securityPolicy._logAudit("filesystem", "read_file", {}, true, "OK");
      securityPolicy._logAudit("filesystem", "write_file", {}, true, "OK");
      securityPolicy._logAudit(
        "filesystem",
        "delete_file",
        {},
        false,
        "Denied",
      );

      const stats = securityPolicy.getStatistics();

      expect(stats.totalValidations).toBe(3);
      expect(stats.allowedCount).toBe(2);
      expect(stats.deniedCount).toBe(1);
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
