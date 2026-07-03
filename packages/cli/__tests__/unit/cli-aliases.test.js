import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf-8"));

// npm normalizes bin paths on install (it strips a leading "./"), so the
// on-disk package.json reads as "./bin/…" as committed but "bin/…" after CI's
// `npm install` rewrites it. Compare against the normalized form either way so
// the assertion doesn't depend on whether install has run.
const stripDot = (p) => (typeof p === "string" ? p.replace(/^\.\//, "") : p);

/**
 * Unit tests for CLI binary aliases (chainlesschain, cc, clc).
 *
 * Verifies package.json bin configuration is correct and all aliases
 * point to the same entry script.
 */
describe("CLI aliases (cc / clc)", () => {
  describe("package.json bin configuration", () => {
    it("defines chainlesschain as primary bin entry", () => {
      expect(pkg.bin).toBeDefined();
      expect(stripDot(pkg.bin.chainlesschain)).toBe("bin/chainlesschain.js");
    });

    it("defines cc as short alias", () => {
      expect(stripDot(pkg.bin.cc)).toBe("bin/chainlesschain.js");
    });

    it("defines clc as alternative alias", () => {
      expect(stripDot(pkg.bin.clc)).toBe("bin/chainlesschain.js");
    });

    it("defines clchain as alternative alias", () => {
      expect(stripDot(pkg.bin.clchain)).toBe("bin/chainlesschain.js");
    });

    it("all aliases point to the same entry file", () => {
      const entryFile = pkg.bin.chainlesschain;
      expect(pkg.bin.cc).toBe(entryFile);
      expect(pkg.bin.clc).toBe(entryFile);
      expect(pkg.bin.clchain).toBe(entryFile);
    });

    it("has exactly 4 bin entries", () => {
      expect(Object.keys(pkg.bin)).toHaveLength(4);
      expect(Object.keys(pkg.bin).sort()).toEqual(
        ["cc", "chainlesschain", "clc", "clchain"].sort(),
      );
    });
  });

  describe("entry script exists and is valid", () => {
    it("bin/chainlesschain.js file exists", () => {
      const entryPath = join(cliRoot, "bin", "chainlesschain.js");
      const content = readFileSync(entryPath, "utf-8");
      expect(content).toContain("#!/usr/bin/env node");
    });

    it("entry script imports the lazy CLI dispatcher", () => {
      const entryPath = join(cliRoot, "bin", "chainlesschain.js");
      const content = readFileSync(entryPath, "utf-8");
      // The bin uses runCli (lazy-dispatch) instead of importing index.js
      // directly, so a `cc <cmd>` invocation only loads that one command's
      // module rather than eagerly loading all ~154 command modules.
      expect(content).toContain("runCli");
      expect(content).toContain("lazy-dispatch");
    });

    it("entry script invokes the CLI runner", () => {
      const entryPath = join(cliRoot, "bin", "chainlesschain.js");
      const content = readFileSync(entryPath, "utf-8");
      expect(content).toContain("runCli(process.argv)");
    });

    it("entry script ensures UTF-8 encoding", () => {
      const entryPath = join(cliRoot, "bin", "chainlesschain.js");
      const content = readFileSync(entryPath, "utf-8");
      expect(content).toContain("ensureUtf8");
    });
  });

  describe("program name compatibility", () => {
    it("createProgram works regardless of process.argv[1] name", async () => {
      const { createProgram } = await import("../../src/index.js");
      const program = createProgram();
      expect(program).toBeDefined();
      expect(typeof program.parse).toBe("function");
      // Commander resolves the program name from argv[1], so cc/clc/chainlesschain all work
      expect(program.commands.length).toBeGreaterThan(0);
    });
  });
});
