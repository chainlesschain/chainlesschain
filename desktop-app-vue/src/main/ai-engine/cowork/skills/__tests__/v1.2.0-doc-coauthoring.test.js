/**
 * Unit tests for doc-coauthoring skill handler (v1.2.0)
 * Tests all 5 modes: draft, expand, review, structure, glossary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/doc-coauthoring/handler.js");

describe("doc-coauthoring handler", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  describe("init()", () => {
    it("should initialize without errors", async () => {
      await expect(
        handler.init({ name: "doc-coauthoring" }),
      ).resolves.not.toThrow();
    });
  });

  describe("execute() - draft mode", () => {
    it("should generate documentation draft", async () => {
      const result = await handler.execute(
        { input: "draft API authentication guide" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("API authentication guide");
      expect(result.output).toContain("Overview");
      expect(result.output).toContain("Getting Started");
      expect(result.output).toContain("Examples");
      expect(result.result.method).toBe("draft");
      expect(result.result.sections).toContain("Overview");
    });

    it("should default to draft mode", async () => {
      const result = await handler.execute(
        { input: "Installation guide" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("draft");
    });

    it("should include troubleshooting and FAQ sections", async () => {
      const result = await handler.execute(
        { input: "draft Setup guide" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Troubleshooting");
      expect(result.output).toContain("FAQ");
    });
  });

  describe("execute() - expand mode", () => {
    it("should generate expansion suggestions", async () => {
      const result = await handler.execute(
        { input: "expand some-doc.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Expand");
      expect(result.output).toContain("Expansion Suggestions");
      expect(result.result.method).toBe("expand");
    });

    it("should detect section reference with #", async () => {
      const docFile = path.join(tempDir, "guide.md");
      fs.writeFileSync(
        docFile,
        "# Guide\n\n## Installation\n\nSome content.\n",
      );

      const result = await handler.execute(
        { input: "expand guide.md#Installation" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.section).toBe("Installation");
      expect(result.result.fileFound).toBe(true);
    });
  });

  describe("execute() - review mode", () => {
    it("should review a markdown file", async () => {
      const docFile = path.join(tempDir, "doc.md");
      fs.writeFileSync(
        docFile,
        "# My Document\n\n## Section One\n\nSome content here.\n\n## Section Two\n\nMore content. TODO: finish this.\n",
      );

      const result = await handler.execute(
        { input: "review doc.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Documentation Review");
      expect(result.result.method).toBe("review");
      expect(result.result.wordCount).toBeGreaterThan(0);
      expect(result.result.headingCount).toBe(3);
    });

    it("should detect TODO markers", async () => {
      const docFile = path.join(tempDir, "wip.md");
      fs.writeFileSync(
        docFile,
        "# WIP\n\nTODO: write this section\nFIXME: broken link\n",
      );

      const result = await handler.execute(
        { input: "review wip.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.issueCount).toBeGreaterThan(0);
      const todoIssues = result.result.issues.filter((i) =>
        i.message.includes("placeholder"),
      );
      expect(todoIssues.length).toBeGreaterThan(0);
    });

    it("should suggest missing examples section", async () => {
      const docFile = path.join(tempDir, "noexamples.md");
      fs.writeFileSync(
        docFile,
        "# Doc\n\n## Overview\n\nBasic content only.\n",
      );

      const result = await handler.execute(
        { input: "review noexamples.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      const exampleIssues = result.result.issues.filter((i) =>
        i.message.includes("examples"),
      );
      expect(exampleIssues.length).toBeGreaterThan(0);
    });

    it("should handle non-existent file", async () => {
      const result = await handler.execute(
        { input: "review nonexistent.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.issueCount).toBeGreaterThan(0);
    });
  });

  describe("execute() - structure mode", () => {
    it("should analyze document structure", async () => {
      const docFile = path.join(tempDir, "structured.md");
      fs.writeFileSync(
        docFile,
        "# Title\n\n## First\n\n### Sub\n\n## Second\n",
      );

      const result = await handler.execute(
        { input: "structure structured.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Document Structure");
      expect(result.output).toContain("Current Structure");
      expect(result.output).toContain("Recommended Structure");
      expect(result.result.method).toBe("structure");
      expect(result.result.headingCount).toBe(4);
    });

    it("should detect heading level skips", async () => {
      const docFile = path.join(tempDir, "bad-headings.md");
      fs.writeFileSync(docFile, "# Title\n\n#### Skipped levels\n");

      const result = await handler.execute(
        { input: "structure bad-headings.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Structure Issues");
    });
  });

  describe("execute() - glossary mode", () => {
    it("should extract terms from document", async () => {
      const docFile = path.join(tempDir, "terms.md");
      fs.writeFileSync(
        docFile,
        "# API Guide\n\nThe **authentication** token is used with **authorization** headers.\nUse `Bearer` token format and `OAuth2` protocol.\n",
      );

      const result = await handler.execute(
        { input: "glossary terms.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Glossary");
      expect(result.result.method).toBe("glossary");
      expect(result.result.termCount).toBeGreaterThan(0);
    });

    it("should generate template for non-existent file", async () => {
      const result = await handler.execute(
        { input: "glossary nonexistent.md" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Template");
      expect(result.result.termCount).toBe(0);
    });
  });

  describe("execute() - error handling", () => {
    it("should fail when no description provided", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fail on empty input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("should include message on success", async () => {
      const result = await handler.execute(
        { input: "draft Quick start" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("draft");
    });
  });
});
