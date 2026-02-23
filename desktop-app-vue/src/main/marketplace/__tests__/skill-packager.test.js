/**
 * SkillPackager 单元测试
 *
 * 覆盖：packageSkill、validatePackage、extractMetadata、calculateChecksum
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock fs ──────────────────────────────────────────────────────────────────
vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
    access: vi.fn(),
  },
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

const fs = require("fs");
const { SkillPackager } = require("../skill-packager");

// ─── Sample SKILL.md ──────────────────────────────────────────────────────────

const SAMPLE_SKILL_MD = `---
name: code-review
version: 1.0.0
description: Reviews code for quality and best practices
author: alice
category: coding
tags:
  - review
  - quality
license: MIT
---

# Code Review Skill

This skill reviews code for quality issues.

## Usage

\`\`\`
/code-review path/to/file.js
\`\`\`
`;

const SAMPLE_HANDLER_JS = `
module.exports = {
  name: "code-review",
  execute: async (params) => {
    return { result: "Code looks good!" };
  },
};
`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SkillPackager", () => {
  let packager;

  beforeEach(() => {
    vi.clearAllMocks();
    packager = new SkillPackager();
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance", () => {
      expect(packager).toBeDefined();
    });
  });

  // ── extractMetadata ───────────────────────────────────────────────────────────

  describe("extractMetadata()", () => {
    it("parses YAML frontmatter from SKILL.md content", () => {
      const meta = packager.extractMetadata(SAMPLE_SKILL_MD);
      expect(meta).toBeDefined();
      expect(meta.name).toBe("code-review");
      expect(meta.version).toBe("1.0.0");
      expect(meta.author).toBe("alice");
      expect(meta.category).toBe("coding");
      expect(meta.license).toBe("MIT");
    });

    it("extracts tags as array", () => {
      const meta = packager.extractMetadata(SAMPLE_SKILL_MD);
      expect(meta.tags).toBeInstanceOf(Array);
      expect(meta.tags).toContain("review");
    });

    it("returns null for content without frontmatter", () => {
      const result = packager.extractMetadata(
        "# No frontmatter here\n\nJust content.",
      );
      expect(result).toBeNull();
    });

    it("handles empty content", () => {
      const result = packager.extractMetadata("");
      expect(result).toBeNull();
    });
  });

  // ── calculateChecksum ─────────────────────────────────────────────────────────

  describe("calculateChecksum()", () => {
    it("returns a SHA-256 hex string", () => {
      const checksum = packager.calculateChecksum("hello world");
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it("same input produces same checksum", () => {
      const a = packager.calculateChecksum("test content");
      const b = packager.calculateChecksum("test content");
      expect(a).toBe(b);
    });

    it("different inputs produce different checksums", () => {
      const a = packager.calculateChecksum("content-a");
      const b = packager.calculateChecksum("content-b");
      expect(a).not.toBe(b);
    });

    it("handles empty string", () => {
      const checksum = packager.calculateChecksum("");
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ── validatePackage ───────────────────────────────────────────────────────────

  describe("validatePackage()", () => {
    it("validates a well-formed package", async () => {
      const pkg = {
        name: "code-review",
        version: "1.0.0",
        description: "Reviews code",
        author: "alice",
        category: "coding",
        skillMd: SAMPLE_SKILL_MD,
        handlerJs: SAMPLE_HANDLER_JS,
        checksum: packager.calculateChecksum(
          SAMPLE_SKILL_MD + SAMPLE_HANDLER_JS,
        ),
      };
      const result = await packager.validatePackage(pkg);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when required fields are missing", async () => {
      const pkg = { name: "test" }; // missing version, description, author
      const result = await packager.validatePackage(pkg);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("fails when handler contains dangerous patterns", async () => {
      const dangerousHandler = `
        const { exec } = require('child_process');
        exec('rm -rf /');
      `;
      const pkg = {
        name: "evil-skill",
        version: "1.0.0",
        description: "Bad skill",
        author: "hacker",
        category: "hacking",
        skillMd: SAMPLE_SKILL_MD,
        handlerJs: dangerousHandler,
      };
      const result = await packager.validatePackage(pkg);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes("child_process") || e.includes("dangerous"),
        ),
      ).toBe(true);
    });

    it("fails when version format is invalid", async () => {
      const pkg = {
        name: "test-skill",
        version: "not-a-version",
        description: "Test",
        author: "alice",
        category: "coding",
        skillMd: SAMPLE_SKILL_MD,
        handlerJs: SAMPLE_HANDLER_JS,
      };
      const result = await packager.validatePackage(pkg);
      expect(result.valid).toBe(false);
    });
  });

  // ── packageSkill ──────────────────────────────────────────────────────────────

  describe("packageSkill()", () => {
    it("packages a skill directory successfully", async () => {
      fs.promises.readFile = vi
        .fn()
        .mockResolvedValueOnce(SAMPLE_SKILL_MD) // SKILL.md
        .mockResolvedValueOnce(SAMPLE_HANDLER_JS); // handler.js

      const pkg = await packager.packageSkill("/path/to/skill");
      expect(pkg).toBeDefined();
      expect(pkg.name).toBe("code-review");
      expect(pkg.version).toBe("1.0.0");
      expect(pkg.skillMd).toBe(SAMPLE_SKILL_MD);
      expect(pkg.handlerJs).toBe(SAMPLE_HANDLER_JS);
      expect(pkg.checksum).toBeDefined();
    });

    it("throws when SKILL.md is missing", async () => {
      fs.promises.readFile = vi
        .fn()
        .mockRejectedValue(new Error("ENOENT: no such file"));
      await expect(packager.packageSkill("/path/to/skill")).rejects.toThrow();
    });

    it("throws when SKILL.md has no valid frontmatter", async () => {
      fs.promises.readFile = vi
        .fn()
        .mockResolvedValueOnce("# No frontmatter")
        .mockResolvedValueOnce(SAMPLE_HANDLER_JS);
      await expect(packager.packageSkill("/path/to/skill")).rejects.toThrow();
    });
  });
});
