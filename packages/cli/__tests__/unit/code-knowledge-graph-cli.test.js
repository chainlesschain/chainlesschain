import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildKnowledgeGraph } from "../../src/lib/cowork/code-knowledge-graph-cli.js";

describe("code-knowledge-graph-cli", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-ckg-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── buildKnowledgeGraph ──────────────────────────────

  describe("buildKnowledgeGraph", () => {
    it("analyzes a single JS file", async () => {
      const filePath = join(tempDir, "index.js");
      writeFileSync(
        filePath,
        `import fs from "fs";
import path from "path";

export class MyClass {
  constructor() {}
}

export function myFunction() {
  return 42;
}
`,
        "utf-8",
      );

      const result = await buildKnowledgeGraph({ targetPath: filePath });

      expect(result.stats.fileCount).toBe(1);
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.relationships.length).toBeGreaterThan(0);

      // Should find imports
      const imports = result.relationships.filter((r) => r.type === "imports");
      expect(imports.some((r) => r.to === "fs")).toBe(true);
      expect(imports.some((r) => r.to === "path")).toBe(true);

      // Should find class and function
      const classDefs = result.entities.filter((e) => e.type === "class");
      expect(classDefs.some((e) => e.name === "MyClass")).toBe(true);

      const funcDefs = result.entities.filter((e) => e.type === "function");
      expect(funcDefs.some((e) => e.name === "myFunction")).toBe(true);
    });

    it("analyzes a directory of files", async () => {
      writeFileSync(
        join(tempDir, "a.js"),
        `import { helper } from "./b.js";\nexport function main() {}`,
        "utf-8",
      );
      writeFileSync(
        join(tempDir, "b.js"),
        `export function helper() { return 1; }`,
        "utf-8",
      );

      const result = await buildKnowledgeGraph({ targetPath: tempDir });

      expect(result.stats.fileCount).toBe(2);
      expect(result.stats.defCount).toBeGreaterThanOrEqual(2);
    });

    it("skips non-code files", async () => {
      writeFileSync(join(tempDir, "readme.md"), "# Readme", "utf-8");
      writeFileSync(join(tempDir, "data.json"), "{}", "utf-8");
      writeFileSync(
        join(tempDir, "code.js"),
        "export function foo() {}",
        "utf-8",
      );

      const result = await buildKnowledgeGraph({ targetPath: tempDir });
      expect(result.stats.fileCount).toBe(1);
    });

    it("skips node_modules and hidden directories", async () => {
      mkdirSync(join(tempDir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(
        join(tempDir, "node_modules", "pkg", "index.js"),
        "export default {};",
        "utf-8",
      );
      mkdirSync(join(tempDir, ".hidden"), { recursive: true });
      writeFileSync(
        join(tempDir, ".hidden", "secret.js"),
        "export default {};",
        "utf-8",
      );
      writeFileSync(
        join(tempDir, "main.js"),
        "export function main() {}",
        "utf-8",
      );

      const result = await buildKnowledgeGraph({ targetPath: tempDir });
      expect(result.stats.fileCount).toBe(1);
    });

    it("detects CommonJS require imports", async () => {
      writeFileSync(
        join(tempDir, "cjs.js"),
        `const fs = require("fs");\nconst path = require("path");\nmodule.exports = {};`,
        "utf-8",
      );

      const result = await buildKnowledgeGraph({
        targetPath: filePath(tempDir, "cjs.js"),
      });
      const imports = result.relationships.filter((r) => r.type === "imports");
      expect(imports.some((r) => r.to === "fs")).toBe(true);
      expect(imports.some((r) => r.to === "path")).toBe(true);

      // module.exports should be detected
      const exports = result.entities.filter((e) => e.type === "export");
      expect(exports.some((e) => e.kind === "cjs")).toBe(true);
    });

    it("respects maxFiles limit", async () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(
          join(tempDir, `file${i}.js`),
          `export const x${i} = ${i};`,
          "utf-8",
        );
      }

      const result = await buildKnowledgeGraph({
        targetPath: tempDir,
        maxFiles: 3,
      });
      expect(result.stats.fileCount).toBeLessThanOrEqual(3);
    });

    it("returns a summary string", async () => {
      writeFileSync(
        join(tempDir, "index.js"),
        `import fs from "fs";\nexport function main() {}`,
        "utf-8",
      );

      const result = await buildKnowledgeGraph({ targetPath: tempDir });
      expect(result.summary).toContain("Code Knowledge Graph");
      expect(result.summary).toContain("Files analyzed:");
      expect(result.summary).toContain("Entities:");
    });

    it("handles empty directory", async () => {
      const result = await buildKnowledgeGraph({ targetPath: tempDir });
      expect(result.stats.fileCount).toBe(0);
      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);
    });

    it("detects TypeScript files", async () => {
      writeFileSync(
        join(tempDir, "app.ts"),
        `import { Router } from "express";\nexport class AppController {}`,
        "utf-8",
      );

      const result = await buildKnowledgeGraph({ targetPath: tempDir });
      expect(result.stats.fileCount).toBe(1);
      expect(result.entities.some((e) => e.language === "ts")).toBe(true);
    });
  });
});

function filePath(dir, name) {
  return join(dir, name);
}
