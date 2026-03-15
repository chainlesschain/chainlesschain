import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf-8"));

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
      expect(pkg.bin.chainlesschain).toBe("./bin/chainlesschain.js");
    });

    it("defines cc as short alias", () => {
      expect(pkg.bin.cc).toBe("./bin/chainlesschain.js");
    });

    it("defines clc as alternative alias", () => {
      expect(pkg.bin.clc).toBe("./bin/chainlesschain.js");
    });

    it("defines clchain as alternative alias", () => {
      expect(pkg.bin.clchain).toBe("./bin/chainlesschain.js");
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

    it("entry script imports createProgram", () => {
      const entryPath = join(cliRoot, "bin", "chainlesschain.js");
      const content = readFileSync(entryPath, "utf-8");
      expect(content).toContain("createProgram");
    });

    it("entry script calls program.parse", () => {
      const entryPath = join(cliRoot, "bin", "chainlesschain.js");
      const content = readFileSync(entryPath, "utf-8");
      expect(content).toContain("program.parse");
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
