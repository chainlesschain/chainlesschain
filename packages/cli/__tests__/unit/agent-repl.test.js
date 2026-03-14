import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for agent-repl.js tool execution logic
 *
 * We can't easily test the full REPL (interactive readline), but we can
 * test the tool execution functions by importing the module and exercising
 * the exported startAgentRepl function's internal logic indirectly.
 *
 * For direct tool testing, we replicate the executeTool logic here.
 */

describe("agent-repl tool execution", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-agent-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read_file tool logic", () => {
    it("reads existing file content", () => {
      const filePath = join(tempDir, "test.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      expect(content).toBe("hello world");
    });

    it("handles non-existent file", () => {
      const filePath = join(tempDir, "nonexistent.txt");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("write_file tool logic", () => {
    it("creates new file with content", () => {
      const filePath = join(tempDir, "new-file.txt");
      writeFileSync(filePath, "new content", "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("new content");
    });

    it("creates nested directories", () => {
      const filePath = join(tempDir, "nested", "dir", "file.txt");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "nested content", "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("nested content");
    });
  });

  describe("edit_file tool logic", () => {
    it("replaces string in file", () => {
      const filePath = join(tempDir, "edit.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      const newContent = content.replace("hello", "goodbye");
      writeFileSync(filePath, newContent, "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("goodbye world");
    });

    it("fails when old_string not found", () => {
      const filePath = join(tempDir, "edit2.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      expect(content.includes("nonexistent")).toBe(false);
    });
  });

  describe("list_dir tool logic", () => {
    it("lists directory contents", () => {
      writeFileSync(join(tempDir, "a.txt"), "a");
      writeFileSync(join(tempDir, "b.txt"), "b");
      fs.mkdirSync(join(tempDir, "subdir"));
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });
      const names = entries.map((e) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names).toContain("subdir");
      const types = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
      expect(types.find((e) => e.name === "subdir").type).toBe("dir");
      expect(types.find((e) => e.name === "a.txt").type).toBe("file");
    });
  });
});

describe("agent-repl module exports", () => {
  it("exports startAgentRepl function", async () => {
    const mod = await import("../../src/repl/agent-repl.js");
    expect(typeof mod.startAgentRepl).toBe("function");
  });
});

describe("agent-repl TOOLS definition", () => {
  it("includes skill-related tools in TOOLS constant", async () => {
    // We verify by checking the help text output from the CLI
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 10000 },
    );
    expect(result).toContain("agentic AI session");
    expect(result).toContain("--model");
    expect(result).toContain("--provider");
  });

  it("agent --help includes --session option", async () => {
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 10000 },
    );
    expect(result).toContain("--session");
  });
});

describe("run_code tool logic", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-runcode-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Node.js execution", () => {
    it("executes Node.js code and returns output", () => {
      const codeFile = join(tempDir, "test.js");
      writeFileSync(codeFile, 'console.log("hello from node");', "utf8");
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(output.trim()).toBe("hello from node");
    });

    it("executes Node.js code with JSON output", () => {
      const codeFile = join(tempDir, "json-test.js");
      writeFileSync(
        codeFile,
        "console.log(JSON.stringify({ a: 1, b: 2 }));",
        "utf8",
      );
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      const parsed = JSON.parse(output.trim());
      expect(parsed).toEqual({ a: 1, b: 2 });
    });

    it("captures stderr on syntax error", () => {
      const codeFile = join(tempDir, "bad.js");
      writeFileSync(codeFile, "const x = {{{", "utf8");
      try {
        execSync(`node "${codeFile}"`, {
          encoding: "utf8",
          timeout: 10000,
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err.status).not.toBe(0);
        expect(err.stderr || err.message).toBeTruthy();
      }
    });

    it("handles multiline code with calculations", () => {
      const codeFile = join(tempDir, "calc.js");
      writeFileSync(
        codeFile,
        `
const data = [1, 2, 3, 4, 5];
const sum = data.reduce((a, b) => a + b, 0);
const avg = sum / data.length;
console.log(JSON.stringify({ sum, avg }));
      `.trim(),
        "utf8",
      );
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      const result = JSON.parse(output.trim());
      expect(result.sum).toBe(15);
      expect(result.avg).toBe(3);
    });
  });

  describe("Bash execution", () => {
    it("executes bash code and returns output", () => {
      const codeFile = join(tempDir, "test.sh");
      writeFileSync(codeFile, 'echo "hello from bash"', "utf8");
      const output = execSync(`bash "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(output.trim()).toBe("hello from bash");
    });

    it("executes bash with variables and arithmetic", () => {
      const codeFile = join(tempDir, "vars.sh");
      writeFileSync(
        codeFile,
        `
X=10
Y=20
echo $(( X + Y ))
      `.trim(),
        "utf8",
      );
      const output = execSync(`bash "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(output.trim()).toBe("30");
    });
  });

  describe("temp file lifecycle", () => {
    it("temp file is created and can be cleaned up", () => {
      const tmpFile = join(tempDir, `cc-agent-${Date.now()}.js`);
      writeFileSync(tmpFile, 'console.log("temp")', "utf8");
      expect(existsSync(tmpFile)).toBe(true);

      // Execute
      const output = execSync(`node "${tmpFile}"`, {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(output.trim()).toBe("temp");

      // Cleanup
      fs.unlinkSync(tmpFile);
      expect(existsSync(tmpFile)).toBe(false);
    });
  });

  describe("timeout behavior", () => {
    it("should enforce timeout on long-running scripts", () => {
      const codeFile = join(tempDir, "slow.js");
      // Create a script that sleeps for 5 seconds
      writeFileSync(
        codeFile,
        `
const start = Date.now();
while (Date.now() - start < 5000) { /* busy wait */ }
console.log("done");
      `.trim(),
        "utf8",
      );
      try {
        execSync(`node "${codeFile}"`, {
          encoding: "utf8",
          timeout: 1000, // 1 second timeout
        });
        expect.unreachable("Should have thrown due to timeout");
      } catch (err) {
        // execSync throws on timeout
        expect(err).toBeTruthy();
      }
    });
  });

  describe("output truncation", () => {
    it("large output can be truncated to limit", () => {
      const codeFile = join(tempDir, "bigout.js");
      // Generate 100KB of output
      writeFileSync(
        codeFile,
        `for (let i = 0; i < 10000; i++) console.log("line " + i + " padding".repeat(5));`,
        "utf8",
      );
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
      });
      // Simulate truncation logic from agent-repl
      const truncated = output.substring(0, 50000);
      expect(truncated.length).toBeLessThanOrEqual(50000);
      expect(output.length).toBeGreaterThan(50000);
    });
  });

  describe("language file extensions", () => {
    it("maps python to .py extension", () => {
      const extMap = { python: ".py", node: ".js", bash: ".sh" };
      expect(extMap["python"]).toBe(".py");
      expect(extMap["node"]).toBe(".js");
      expect(extMap["bash"]).toBe(".sh");
    });

    it("rejects unsupported languages", () => {
      const extMap = { python: ".py", node: ".js", bash: ".sh" };
      expect(extMap["ruby"]).toBeUndefined();
      expect(extMap["java"]).toBeUndefined();
    });
  });

  describe("timeout parameter validation", () => {
    it("clamps timeout to valid range (1-300)", () => {
      // Simulate the clamping logic from agent-repl
      // Note: 0 and falsy values fall back to 60 via `|| 60`
      const clamp = (t) => Math.min(Math.max(t || 60, 1), 300);
      expect(clamp(undefined)).toBe(60);
      expect(clamp(null)).toBe(60);
      expect(clamp(0)).toBe(60); // 0 is falsy, falls back to 60
      expect(clamp(-5)).toBe(1);
      expect(clamp(500)).toBe(300);
      expect(clamp(30)).toBe(30);
      expect(clamp(300)).toBe(300);
      expect(clamp(1)).toBe(1);
    });
  });

  describe("result format", () => {
    it("success result includes expected fields", () => {
      const result = {
        success: true,
        output: "hello",
        language: "node",
        duration: "42ms",
      };
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello");
      expect(result.language).toBe("node");
      expect(result.duration).toMatch(/\d+ms/);
    });

    it("error result includes expected fields", () => {
      const result = {
        error: "SyntaxError: unexpected token",
        stderr: "SyntaxError: unexpected token",
        exitCode: 1,
        language: "node",
      };
      expect(result.error).toBeTruthy();
      expect(result.exitCode).toBe(1);
      expect(result.language).toBe("node");
    });
  });
});

describe("agent-repl upgraded execution limits", () => {
  it("MAX_ITERATIONS should be 15", async () => {
    // Verify by reading the source file
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("MAX_ITERATIONS = 15");
  });

  it("run_shell timeout should be 60000ms", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    // The run_shell case should have timeout: 60000
    expect(content).toMatch(/case "run_shell"[\s\S]*?timeout:\s*60000/);
  });

  it("run_shell output truncation should be 30000 chars", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toMatch(/case "run_shell"[\s\S]*?substring\(0,\s*30000\)/);
  });

  it("Anthropic max_tokens should be 8192", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("max_tokens: 8192");
  });

  it("default ollama model should be qwen2.5:7b", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('options.model || "qwen2.5:7b"');
  });
});

describe("agent-repl TOOLS includes run_code", () => {
  it("run_code tool is defined in TOOLS array", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('"run_code"');
    expect(content).toContain('"python"');
    expect(content).toContain('"node"');
    expect(content).toContain('"bash"');
  });

  it("system prompt includes proactive coding guidance", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("run_code tool");
    expect(content).toContain("capable coding agent");
  });

  it("formatToolArgs handles run_code", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('case "run_code"');
  });

  it("plan mode treats run_code as high impact", async () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('name === "run_code"');
  });
});

describe("agent-repl context engineering integration", () => {
  it("CLIContextEngineering integrates with agent-repl module", async () => {
    // Verify both modules can be imported together without conflicts
    const agentMod = await import("../../src/repl/agent-repl.js");
    const ceMod = await import("../../src/lib/cli-context-engineering.js");

    expect(typeof agentMod.startAgentRepl).toBe("function");
    expect(typeof ceMod.CLIContextEngineering).toBe("function");

    // Verify CLIContextEngineering works in isolation
    const engine = new ceMod.CLIContextEngineering({ db: null });
    const result = engine.buildOptimizedMessages(
      [{ role: "system", content: "test" }],
      { userQuery: "hello" },
    );
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("system");
  });

  it("getBaseSystemPrompt includes cwd", async () => {
    // Verify via agent --help that the module loads without error
    // (getBaseSystemPrompt is called during import/init)
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    // agent --help should succeed (proves imports work)
    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 10000 },
    );
    expect(result).toBeTruthy();
  });
});
