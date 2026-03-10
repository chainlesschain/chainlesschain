/**
 * Security Audit Handler Unit Tests (v2.0 + Clawsec)
 *
 * Tests: secrets, owasp, drift baseline/check, integrity generate/verify, cve, full audit
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/security-audit/handler.js");

describe("SecurityAudit Handler", () => {
  beforeEach(() => {
    handler._baselineStore.clear();
    handler._integrityStore.clear();
    // Reset _deps to default
    handler._deps.fs = require("fs");
    handler._deps.path = require("path");
    handler._deps.crypto = require("crypto");
  });

  describe("init", () => {
    it("should initialize without error", async () => {
      await expect(
        handler.init({ name: "security-audit" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("execute - secrets", () => {
    it("should scan for secrets and return findings", async () => {
      const mockContent = 'const key = "AKIA_FAKE_TEST_KEY_0001";';

      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readdirSync: vi
          .fn()
          .mockReturnValue([
            { name: "app.js", isDirectory: () => false, isFile: () => true },
          ]),
        readFileSync: vi.fn().mockReturnValue(mockContent),
      };
      handler._deps.path = {
        ...require("path"),
        join: vi.fn((...args) => args.join("/")),
        extname: vi.fn((f) => "." + f.split(".").pop()),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
      };

      const result = await handler.execute(
        { input: "--secrets" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.findings.length).toBeGreaterThan(0);
      expect(result.result.findings[0].rule).toBe("AWS Access Key");
      expect(result.result.findings[0].severity).toBe("critical");
    });

    it("should detect GitHub PAT", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readdirSync: vi
          .fn()
          .mockReturnValue([
            { name: "config.js", isDirectory: () => false, isFile: () => true },
          ]),
        readFileSync: vi
          .fn()
          .mockReturnValue(
            'const token = "ghp_FAKE_TEST_TOKEN_000000000000000000";',
          ),
      };
      handler._deps.path = {
        ...require("path"),
        join: vi.fn((...args) => args.join("/")),
        extname: vi.fn((f) => "." + f.split(".").pop()),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
      };

      const result = await handler.execute(
        { input: "--secrets" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      const ghpFinding = result.result.findings.find(
        (f) => f.rule === "GitHub Personal Access Token",
      );
      expect(ghpFinding).toBeDefined();
      expect(ghpFinding.severity).toBe("critical");
    });

    it("should detect Stripe keys", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readdirSync: vi
          .fn()
          .mockReturnValue([
            { name: "pay.js", isDirectory: () => false, isFile: () => true },
          ]),
        readFileSync: vi
          .fn()
          .mockReturnValue(
            'const stripe = "sk_live_FAKE_TEST_KEY_00000000000000";',
          ),
      };
      handler._deps.path = {
        ...require("path"),
        join: vi.fn((...args) => args.join("/")),
        extname: vi.fn((f) => "." + f.split(".").pop()),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
      };

      const result = await handler.execute(
        { input: "--secrets" },
        { workspacePath: "/project" },
      );

      const stripeFinding = result.result.findings.find(
        (f) => f.rule === "Stripe Key",
      );
      expect(stripeFinding).toBeDefined();
    });
  });

  describe("execute - owasp", () => {
    it("should detect SQL injection patterns", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readdirSync: vi
          .fn()
          .mockReturnValue([
            { name: "db.js", isDirectory: () => false, isFile: () => true },
          ]),
        readFileSync: vi
          .fn()
          .mockReturnValue(
            "db.query(`SELECT * FROM users WHERE id = ${userId}`);",
          ),
      };
      handler._deps.path = {
        ...require("path"),
        join: vi.fn((...args) => args.join("/")),
        extname: vi.fn((f) => "." + f.split(".").pop()),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
      };

      const result = await handler.execute(
        { input: "--owasp" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(
        result.result.findings.some((f) => f.rule === "SQL Injection"),
      ).toBe(true);
    });
  });

  describe("execute - drift", () => {
    it("should create baseline from critical files", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn().mockReturnValue([
          {
            name: "package.json",
            isFile: () => true,
            isDirectory: () => false,
          },
          { name: "CLAUDE.md", isFile: () => true, isDirectory: () => false },
        ]),
        statSync: vi.fn().mockReturnValue({ size: 100, mtime: new Date() }),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("test content")),
      };

      const result = await handler.execute(
        { input: "--drift baseline" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.trackedFiles).toBe(2);
      expect(handler._baselineStore.size).toBe(2);
    });

    it("should detect drift when files change", async () => {
      // Setup baseline
      handler._baselineStore.set("package.json", {
        hash: "abc123",
        size: 100,
        mtime: "2024-01-01T00:00:00.000Z",
      });

      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn().mockReturnValue([
          {
            name: "package.json",
            isFile: () => true,
            isDirectory: () => false,
          },
        ]),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("modified content")),
      };
      handler._deps.path = {
        ...require("path"),
        resolve: vi.fn((...args) => args.join("/")),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
        join: vi.fn((...args) => args.join("/")),
      };

      const result = await handler.execute(
        { input: "--drift check" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.status).toBe("DRIFT_DETECTED");
      expect(result.result.changes.modified.length).toBe(1);
    });

    it("should report clean when no drift", async () => {
      const crypto = require("crypto");
      const content = Buffer.from("same content");
      const hash = crypto.createHash("sha256").update(content).digest("hex");

      handler._baselineStore.set("package.json", { hash, size: 12, mtime: "" });

      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn().mockReturnValue([
          {
            name: "package.json",
            isFile: () => true,
            isDirectory: () => false,
          },
        ]),
        readFileSync: vi.fn().mockReturnValue(content),
      };
      handler._deps.path = {
        ...require("path"),
        resolve: vi.fn((...args) => args.join("/")),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
        join: vi.fn((...args) => args.join("/")),
      };

      const result = await handler.execute(
        { input: "--drift check" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.status).toBe("CLEAN");
    });

    it("should fail drift check without baseline", async () => {
      const result = await handler.execute(
        { input: "--drift check" },
        { workspacePath: "/project" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute - integrity", () => {
    it("should generate checksums", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi
          .fn()
          .mockReturnValue([
            { name: "file.js", isFile: () => true, isDirectory: () => false },
          ]),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("content")),
      };
      handler._deps.path = {
        ...require("path"),
        relative: vi.fn(() => "file.js"),
        join: vi.fn((...args) => args.join("/")),
        extname: vi.fn(() => ".js"),
      };

      const result = await handler.execute(
        { input: "--integrity generate" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.fileCount).toBe(1);
      expect(handler._integrityStore.size).toBe(1);
    });

    it("should fail integrity verify without checksums", async () => {
      const result = await handler.execute(
        { input: "--integrity verify" },
        { workspacePath: "/project" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute - cve", () => {
    it("should analyze package.json for CVEs", async () => {
      const pkg = JSON.stringify({
        name: "test-project",
        dependencies: { lodash: "^4.17.20" },
        devDependencies: { moment: "^2.29.0" },
      });

      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readFileSync: vi.fn().mockReturnValue(pkg),
      };
      handler._deps.path = {
        ...require("path"),
        join: vi.fn((...args) => args.join("/")),
        resolve: vi.fn((...args) => args.join("/")),
      };

      const result = await handler.execute(
        { input: "--cve" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.totalDeps).toBe(2);
      // moment is deprecated
      expect(result.result.deprecatedFound.length).toBeGreaterThan(0);
    });

    it("should fail when no package.json", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(false),
      };
      handler._deps.path = {
        join: vi.fn((...args) => args.join("/")),
      };

      const result = await handler.execute(
        { input: "--cve" },
        { workspacePath: "/project" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute - full audit", () => {
    it("should run both secrets and owasp scan", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readdirSync: vi.fn().mockReturnValue([]),
      };
      handler._deps.path = {
        ...require("path"),
        join: vi.fn((...args) => args.join("/")),
        extname: vi.fn((f) => "." + f.split(".").pop()),
        relative: vi.fn((base, full) => full.replace(base + "/", "")),
      };

      const result = await handler.execute(
        { input: "" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.fileCount).toBe(0);
    });
  });
});
