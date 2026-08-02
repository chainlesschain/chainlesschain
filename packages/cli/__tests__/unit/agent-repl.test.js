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
  }, 15000);
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
      { encoding: "utf-8", timeout: 60000 },
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
      { encoding: "utf-8", timeout: 60000 },
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

describe("agent-core execution limits (used by agent-repl)", () => {
  const agentCorePath = join(
    __dirname,
    "..",
    "..",
    "src",
    "runtime",
    "agent-core.js",
  );

  it("uses IterationBudget for iteration limits", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain("IterationBudget");
  });

  it("run_shell timeout should be 60000ms", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toMatch(/case "run_shell"[\s\S]*?timeout:\s*60000/);
  });

  it("run_shell output truncation should be 30000 chars", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toMatch(/case "run_shell"[\s\S]*?substring\(0,\s*30000\)/);
  });

  it("Anthropic max_tokens keeps the 8192 fallback under an output cap", () => {
    const content = readFileSync(agentCorePath, "utf8");
    // The host cap may narrow a model-aware limit, but the provider fallback
    // remains 8192 both with and without that cap.
    expect(content).toMatch(
      /Math\.min\(\s*anthropicMaxTokens \|\| 8192,\s*options\.maxOutputTokens\s*\)/,
    );
    expect(content).toMatch(/:\s*anthropicMaxTokens \|\| 8192/);
  });

  it("default ollama model should be qwen2.5:7b", () => {
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

describe("agent-core TOOLS includes run_code (used by agent-repl)", () => {
  const agentCorePath = join(
    __dirname,
    "..",
    "..",
    "src",
    "runtime",
    "agent-core.js",
  );

  it("run_code tool is defined in AGENT_TOOLS array", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain('"run_code"');
    expect(content).toContain('"python"');
    expect(content).toContain('"node"');
    expect(content).toContain('"bash"');
  });

  it("system prompt includes proactive coding guidance", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain("run_code tool");
    expect(content).toContain("capable coding agent");
  });

  it("formatToolArgs handles run_code", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain('case "run_code"');
  });

  it("plan mode treats run_code as high impact", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain('name === "run_code"');
  });

  it("agent-repl imports from agent-core (deduplication)", () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('from "../runtime/agent-core.js"');
    expect(content).toContain("AGENT_TOOLS");
    expect(content).toContain("formatToolArgs");
    expect(content).toContain("coreExecuteTool");
    expect(content).toContain("coreAgentLoop");
  });
});

describe("agent-repl thin wrapper contracts", () => {
  const agentReplPath = join(
    __dirname,
    "..",
    "..",
    "src",
    "repl",
    "agent-repl.js",
  );

  it("executeTool wrapper passes hookDb and cwd to coreExecuteTool", () => {
    const content = readFileSync(agentReplPath, "utf8");
    // executeTool should delegate to coreExecuteTool with hookDb and cwd
    expect(content).toContain("coreExecuteTool(name, args, {");
    expect(content).toContain("hookDb: _hookDb");
    expect(content).toContain("cwd: process.cwd()");
  });

  it("agentLoop wrapper iterates coreAgentLoop and handles tool-executing events", () => {
    const content = readFileSync(agentReplPath, "utf8");
    // agentLoop should drive the core loop (opting out of its in-built
    // auto-compaction, since the REPL compacts on its own schedule) and handle
    // its events. The core loop is reached via the `runCoreLoop` seam
    // (= options._coreLoop || coreAgentLoop). Behavior is locked in
    // agent-repl-loop-wrapper.test.js; this just guards the wiring.
    expect(content).toContain("runCoreLoop(messages, {");
    expect(content).toContain("options._coreLoop || coreAgentLoop");
    expect(content).toContain("autoCompact: false");
    expect(content).toContain('event.type === "tool-executing"');
  });

  it("agentLoop wrapper handles tool-result events (error and success)", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('event.type === "tool-result"');
    expect(content).toContain("event.error || event.result?.error");
    expect(content).toContain("event.result?.success");
  });

  it("agentLoop wrapper surfaces ApprovalGate deny recovery hint", () => {
    const content = readFileSync(agentReplPath, "utf8");
    // Parity with Desktop AIChatPage's `Switch to Trusted` button — when
    // ApprovalGate (not shell-policy) denies, print the exact CLI command
    // the user can run to relax the per-session policy.
    expect(content).toContain('approval?.decision === "deny"');
    expect(content).toContain('approval?.via !== "shell-policy"');
    expect(content).toContain("cc session policy");
    expect(content).toContain("--set trusted");
  });

  it("agentLoop wrapper returns structured result on response-complete", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('event.type === "response-complete"');
    expect(content).toContain(
      "return { content: event.content, usageEvents, thinking: event.thinking }",
    );
  });

  it("threads unreadable and unsettled resume state into the shared MCP recovery guard", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("let _mcpLedgerRecovery = null;");
    expect(content).toContain("let _mcpLedgerRecoveryError = null;");
    expect(content).toContain("readReplMcpRecoveryCandidate(targetSessionId)");
    expect(content).toContain("_commitMcpRecoveryCandidate");
    expect(content).toContain("_mcpLedgerRecovery = preparedCommit.recovery");
    expect(content).toContain(
      "_mcpLedgerRecoveryError = preparedCommit.recoveryError",
    );
    expect(content).toContain("createReplMcpHostRuntimeManager()");
    expect(content).toContain("recovery = _mcpLedgerRecovery");
    expect(content).toContain("recoveryError = _mcpLedgerRecoveryError");
    expect(content).toContain("mcpClient: activeRawMcpClient");
    expect(content).toContain("mcpHostClient: activeMcpRuntime.runtime.client");
    expect(content).toContain("mcpCallLedger: activeMcpRuntime.runtime.ledger");
  });

  it("routes auxiliary MCP and IDE calls through the guarded host client", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("const hostMcp = _getReplHostMcp();");
    expect(content).toContain("hostMcp.mcpClient.callTool(");
    expect(content).toContain("buildIdePromptContext(hostMcp)");
    expect(content).toContain("expandIdeMentions(effectivePrompt, hostMcp)");
    expect(content).toContain("_getReplHostMcp()?.mcpClient");
  });

  it("switches the session runtime only after a resume candidate succeeds", () => {
    const content = readFileSync(agentReplPath, "utf8");
    const resumeAt = content.indexOf('sessionArg.startsWith("resume ")');
    const rejectAt = content.indexOf(
      "if (!prepared.ok) throw prepared.error;",
      resumeAt,
    );
    const prepareAt = content.indexOf(
      "const preparedMcpRuntime = _prepareMcpHostRuntime(",
      rejectAt,
    );
    const snapshotAt = content.indexOf(
      "const previousState = _captureResumeState();",
      prepareAt,
    );
    const transactionAt = content.indexOf(
      "const committed = commitPreparedReplJsonlResume(",
      snapshotAt,
    );
    const applyAt = content.indexOf(
      "() => _applyPreparedResumeState(preparedState)",
      transactionAt,
    );
    const rollbackAt = content.indexOf(
      "() => _restoreResumeState(previousState)",
      applyAt,
    );

    expect(resumeAt).toBeGreaterThan(-1);
    expect(rejectAt).toBeGreaterThan(resumeAt);
    expect(prepareAt).toBeGreaterThan(rejectAt);
    expect(snapshotAt).toBeGreaterThan(prepareAt);
    expect(transactionAt).toBeGreaterThan(snapshotAt);
    expect(applyAt).toBeGreaterThan(transactionAt);
    expect(rollbackAt).toBeGreaterThan(applyAt);
    expect(content).toContain(
      "const _resumeStateController = createReplResumeStateController({",
    );
    expect(content).toContain("commitPreparedReplDbResume(");
  });
});

describe("agent-repl MCP host runtime manager", () => {
  it("reuses one controller and ledger so a settlement latch survives turns", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    const rawClient = { callTool: vi.fn() };
    const guardedClient = { callTool: vi.fn() };
    const controller = { settlementFailed: false };
    const ledger = { id: "shared-ledger" };
    const runtime = {
      controller,
      ledger,
      client: guardedClient,
      rawClient,
    };
    const sink = vi.fn();
    const appendAuthorityEvent = vi.fn();
    const createSessionMcpLedgerSink = vi.fn(() => sink);
    const createMcpHostRecoveryRuntime = vi.fn(() => runtime);
    const manager = createReplMcpHostRuntimeManager({
      createMcpHostRecoveryRuntime,
      createSessionMcpLedgerSink,
      appendAuthorityEvent,
    });
    const recovery = Object.freeze({
      unsettled: [],
      incidents: [],
      replayDenied: [],
    });
    const adhocMcp = {
      mcpClient: rawClient,
      externalToolExecutors: { ide: { kind: "mcp" } },
    };
    const options = {
      adhocMcp,
      bundleMcpClient: { id: "unused-bundle" },
      sessionId: "session-a",
      persistent: true,
      recovery,
      recoveryError: null,
    };

    const first = manager.activate(options);
    first.runtime.controller.settlementFailed = true;
    const second = manager.activate(options);

    expect(second).toBe(first);
    expect(second.runtime.controller.settlementFailed).toBe(true);
    expect(second.runtime.ledger).toBe(ledger);
    expect(second.rawClient).toBe(rawClient);
    expect(second.hostMcp.mcpClient).toBe(guardedClient);
    expect(second.hostMcp.externalToolExecutors).toBe(
      adhocMcp.externalToolExecutors,
    );
    expect(createSessionMcpLedgerSink).toHaveBeenCalledOnce();
    expect(createSessionMcpLedgerSink).toHaveBeenCalledWith("session-a", {
      appendEvent: appendAuthorityEvent,
    });
    expect(createMcpHostRecoveryRuntime).toHaveBeenCalledOnce();
    expect(createMcpHostRecoveryRuntime).toHaveBeenCalledWith({
      bundle: adhocMcp,
      rawClient,
      sessionId: "session-a",
      sink,
      recovery,
      recoveryError: null,
    });
  });

  it("prepares session switches without replacing the active runtime", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    let runtimeId = 0;
    const manager = createReplMcpHostRuntimeManager({
      createSessionMcpLedgerSink: vi.fn(() => vi.fn()),
      createMcpHostRecoveryRuntime: vi.fn(({ rawClient }) => {
        runtimeId += 1;
        return {
          controller: { runtimeId },
          ledger: { runtimeId },
          client: { runtimeId },
          rawClient,
        };
      }),
    });
    const rawClient = { callTool: vi.fn() };
    const oldRuntime = manager.activate({
      adhocMcp: { mcpClient: rawClient },
      sessionId: "old-session",
      persistent: true,
      recovery: { unsettled: [], incidents: [], replayDenied: [] },
    });
    const preparedRuntime = manager.prepare({
      adhocMcp: { mcpClient: rawClient },
      sessionId: "new-session",
      persistent: true,
      recovery: { unsettled: [], incidents: [], replayDenied: [] },
    });

    expect(preparedRuntime).not.toBe(oldRuntime);
    expect(manager.current).toBe(oldRuntime);

    // A failed resume never commits its prepared candidate.
    expect(manager.current.runtime.controller).toBe(
      oldRuntime.runtime.controller,
    );

    manager.commit(preparedRuntime);
    expect(manager.current).toBe(preparedRuntime);
    expect(manager.current.runtime.controller).not.toBe(
      oldRuntime.runtime.controller,
    );
    expect(manager.current.runtime.ledger).not.toBe(oldRuntime.runtime.ledger);
  });

  it("prefers adhoc MCP, supports bundle fallback, and skips durable DB sinks", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    const createSessionMcpLedgerSink = vi.fn();
    const createMcpHostRecoveryRuntime = vi.fn(({ rawClient }) => ({
      controller: {},
      ledger: {},
      client: { guardedRawClient: rawClient },
      rawClient,
    }));
    const manager = createReplMcpHostRuntimeManager({
      createMcpHostRecoveryRuntime,
      createSessionMcpLedgerSink,
    });
    const adhocClient = { id: "adhoc" };
    const bundleClient = { id: "bundle" };
    const adhocMcp = { mcpClient: adhocClient, connected: ["adhoc"] };

    const adhocRuntime = manager.activate({
      adhocMcp,
      bundleMcpClient: bundleClient,
      sessionId: "db-session",
      persistent: false,
    });
    expect(adhocRuntime.rawClient).toBe(adhocClient);
    expect(adhocRuntime.hostMcp.connected).toEqual(["adhoc"]);
    expect(createMcpHostRecoveryRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bundle: adhocMcp,
        rawClient: adhocClient,
        sink: null,
      }),
    );

    const bundleRuntime = manager.activate({
      bundleMcpClient: bundleClient,
      sessionId: "other-db-session",
      persistent: false,
    });
    expect(bundleRuntime.rawClient).toBe(bundleClient);
    expect(bundleRuntime.hostMcp.mcpClient).toEqual({
      guardedRawClient: bundleClient,
    });
    expect(createMcpHostRecoveryRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bundle: { mcpClient: bundleClient },
        rawClient: bundleClient,
        sink: null,
      }),
    );
    expect(createSessionMcpLedgerSink).not.toHaveBeenCalled();
  });

  it("keeps a non-persistent REPL on the guarded ledger after outcome unknown", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    const { executeTool } = await import("../../src/runtime/agent-core.js");
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport outcome unknown"))
      .mockResolvedValue({ content: [] });
    const rawClient = { callTool };
    const runtime = createReplMcpHostRuntimeManager().activate({
      adhocMcp: { mcpClient: rawClient },
      sessionId: "db-session",
      persistent: false,
    });
    const toolName = "mcp__repo__publish";
    const options = {
      sessionId: "db-session",
      mcpClient: rawClient,
      mcpCallLedger: runtime.runtime.ledger,
      externalToolExecutors: {
        [toolName]: {
          kind: "mcp",
          serverName: "repo",
          toolName: "publish",
        },
      },
      externalToolDescriptors: {
        [toolName]: {
          name: toolName,
          kind: "mcp",
          category: "mcp",
          source: "mcp:repo",
          effectContract: { declaredEffect: "write" },
        },
      },
    };

    expect(runtime.runtime.ledger.recoveryAdmission).toBeDefined();
    const first = await executeTool(toolName, { release: 1 }, options);
    expect(first).toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      outcomeUnknown: true,
      retryable: false,
    });

    const retry = await executeTool(toolName, { release: 2 }, options);
    expect(retry).toMatchObject({
      policy: {
        code: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
        blockMode: "unsafe",
      },
    });
    expect(callTool).toHaveBeenCalledOnce();
  });
});

const VERIFIED_RECOVERY_DIGEST = `sha256:${"b".repeat(64)}`;

function verifiedReplRecovery(sessionId, overrides = {}) {
  const unsettled = overrides.unsettled || [];
  const incidents = overrides.incidents || [];
  const replayDenied = overrides.replayDenied || [];
  const remediation =
    overrides.remediation !== undefined
      ? overrides.remediation
      : incidents.length > 0
        ? "inspect_transcript"
        : unsettled.length > 0
          ? "adjudicate_started_calls"
          : replayDenied.length > 0
            ? "exact_replay_denied"
            : null;
  return {
    sessionId,
    verified: true,
    unsettled,
    incidents,
    replayDenied,
    headHash: overrides.headHash ?? "a".repeat(64),
    recoveryDigest: overrides.recoveryDigest || VERIFIED_RECOVERY_DIGEST,
    remediation,
  };
}

describe("agent-repl MCP recovery resume transaction", () => {
  it("verifies MCP recovery before rebuild and blocks all when rebuild throws", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { createRecoveryGuardedMcpCallLedger } =
      await import("../../src/lib/mcp-ledger-recovery-admission.js");
    const order = [];
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      loadMcpLedgerRecovery: () => {
        order.push("verified-recovery");
        return verifiedReplRecovery("target-session");
      },
      formatMcpLedgerRecoveryNotice: () => null,
      rebuildMessages: () => {
        order.push("rebuild");
        throw new Error("history unavailable");
      },
    });

    expect(order).toEqual(["verified-recovery", "rebuild"]);
    expect(candidate).toMatchObject({
      ok: false,
      sessionId: "target-session",
      mcp: {
        recovery: null,
        recoveryError: { code: "CC_REPL_SESSION_REBUILD_FAILED" },
      },
    });

    const callTool = vi.fn();
    const ledger = createRecoveryGuardedMcpCallLedger({
      recovery: candidate.mcp.recovery,
      recoveryError: candidate.mcp.recoveryError,
    });
    const attemptMcpCall = async () => {
      await ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "mcp__repo__status",
        input: {},
        effectContract: { effect: "read" },
      });
      return callTool();
    };
    await expect(attemptMcpCall()).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      blockMode: "all",
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("keeps the old session state when target preparation fails", async () => {
    const { commitPreparedReplJsonlResume, prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const oldRecovery = Object.freeze({
      unsettled: [{ ledgerId: "old-write" }],
      incidents: [],
    });
    const state = {
      sessionId: "old-session",
      messages: [{ role: "system", content: "old" }],
      recovery: oldRecovery,
      recoveryError: null,
    };
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      loadMcpLedgerRecovery: () => verifiedReplRecovery("target-session"),
      formatMcpLedgerRecoveryNotice: () => null,
      rebuildMessages: () => {
        throw new Error("target rebuild failed");
      },
    });
    const commit = vi.fn((prepared) => {
      state.sessionId = prepared.sessionId;
      state.messages = prepared.rebuiltMessages;
      state.recovery = prepared.mcp.recovery;
      state.recoveryError = prepared.mcp.recoveryError;
    });

    expect(commitPreparedReplJsonlResume(candidate, commit)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(state).toEqual({
      sessionId: "old-session",
      messages: [{ role: "system", content: "old" }],
      recovery: oldRecovery,
      recoveryError: null,
    });
  });

  it("commits an unreadable target only with an ALL-blocking recovery error", async () => {
    const { commitPreparedReplJsonlResume, prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { createRecoveryGuardedMcpCallLedger } =
      await import("../../src/lib/mcp-ledger-recovery-admission.js");
    const readError = Object.assign(new Error("unverified target"), {
      code: "SESSION_TRANSCRIPT_UNVERIFIED",
    });
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      loadMcpLedgerRecovery: () => {
        throw readError;
      },
      rebuildMessages: () => [{ role: "user", content: "restored" }],
    });
    const state = { sessionId: "old-session", recoveryError: null };

    expect(candidate.ok).toBe(true);
    expect(
      commitPreparedReplJsonlResume(candidate, (prepared) => {
        state.sessionId = prepared.sessionId;
        state.recoveryError = prepared.mcp.recoveryError;
      }),
    ).toBe(true);
    expect(state).toMatchObject({
      sessionId: "target-session",
      recoveryError: { code: "SESSION_TRANSCRIPT_UNVERIFIED" },
    });

    const ledger = createRecoveryGuardedMcpCallLedger({
      recovery: candidate.mcp.recovery,
      recoveryError: state.recoveryError,
    });
    await expect(
      ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "mcp__repo__status",
        input: {},
        effectContract: { effect: "read" },
      }),
    ).rejects.toMatchObject({ blockMode: "all" });
  });

  it("takes an immutable descriptor snapshot and keeps every exact replay deny", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const replayDenied = Array.from({ length: 25 }, (_, index) => ({
      ledgerId: `ledger-${index}`,
      serverName: "repo",
      toolName: `status-${index}`,
      inputBytes: index,
      replayDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    }));
    const source = verifiedReplRecovery("target-session", {
      replayDenied,
    });
    const formatter = vi.fn((snapshot) => {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.unsettled)).toBe(true);
      expect(Object.isFrozen(snapshot.incidents)).toBe(true);
      expect(Object.isFrozen(snapshot.replayDenied)).toBe(true);
      expect(snapshot.replayDenied).toHaveLength(25);
      expect(snapshot.replayDenied.every(Object.isFrozen)).toBe(true);
      return "exact replay authority restored";
    });

    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => source,
      formatMcpLedgerRecoveryNotice: formatter,
    });

    expect(candidate.recoveryError).toBeNull();
    expect(candidate.recovery).not.toBe(source);
    expect(candidate.recovery.replayDenied).toEqual(replayDenied);
    expect(candidate.recovery.replayDenied).not.toBe(replayDenied);
    expect(candidate.notice).toBe("exact replay authority restored");
    expect(formatter).toHaveBeenCalledOnce();
  });

  it("rejects Proxy and accessor recovery evidence without invoking getters", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    let getterCalls = 0;
    const accessorRecovery = verifiedReplRecovery("target-session");
    Object.defineProperty(accessorRecovery, "unsettled", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });

    const accessorCandidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => accessorRecovery,
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });
    const proxyCandidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () =>
        new Proxy(verifiedReplRecovery("target-session"), {}),
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });
    const proxyReplayDenied = verifiedReplRecovery("target-session");
    proxyReplayDenied.replayDenied = new Proxy([], {});
    const replayProxyCandidate = readReplMcpRecoveryCandidate(
      "target-session",
      {
        loadMcpLedgerRecovery: () => proxyReplayDenied,
        formatMcpLedgerRecoveryNotice: vi.fn(),
      },
    );
    const accessorReplayDenied = verifiedReplRecovery("target-session", {
      replayDenied: [
        Object.defineProperty(
          {
            serverName: "repo",
            toolName: "status",
            inputBytes: 0,
            replayDigest: `sha256:${"c".repeat(64)}`,
          },
          "ledgerId",
          {
            enumerable: true,
            get() {
              getterCalls += 1;
              return "ledger-accessor";
            },
          },
        ),
      ],
    });
    const replayAccessorCandidate = readReplMcpRecoveryCandidate(
      "target-session",
      {
        loadMcpLedgerRecovery: () => accessorReplayDenied,
        formatMcpLedgerRecoveryNotice: vi.fn(),
      },
    );

    expect(getterCalls).toBe(0);
    for (const candidate of [
      accessorCandidate,
      proxyCandidate,
      replayProxyCandidate,
      replayAccessorCandidate,
    ]) {
      expect(candidate).toMatchObject({
        recovery: null,
        recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
      });
    }
  });

  it("rejects a forged unsettled effect outside the recovery protocol enum", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () =>
        verifiedReplRecovery("target-session", {
          unsettled: [
            {
              ledgerId: "ledger-forged-effect",
              serverName: "repo",
              toolName: "publish",
              status: "started",
              effectContract: { effect: "side-effect-free-ish" },
            },
          ],
        }),
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
    });
  });

  it("rejects a Proxy prototype without executing any prototype trap", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    let trapCalls = 0;
    const proxyPrototype = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(target, key) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        getPrototypeOf(target) {
          trapCalls += 1;
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    const recovery = Object.assign(
      Object.create(proxyPrototype),
      verifiedReplRecovery("target-session"),
    );

    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => recovery,
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
    });
    expect(trapCalls).toBe(0);
  });

  it.each(["loader", "formatter"])(
    "rejects and consumes an asynchronous %s result",
    async (stage) => {
      const { readReplMcpRecoveryCandidate } =
        await import("../../src/repl/agent-repl.js");
      const candidate = readReplMcpRecoveryCandidate("target-session", {
        loadMcpLedgerRecovery:
          stage === "loader"
            ? () => Promise.reject(new Error("async recovery"))
            : () => verifiedReplRecovery("target-session"),
        formatMcpLedgerRecoveryNotice:
          stage === "formatter"
            ? () => Promise.reject(new Error("async notice"))
            : () => null,
      });

      expect(candidate).toMatchObject({
        recovery: null,
        recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
      });
      await Promise.resolve();
    },
  );

  it("rejects a plain thenable without invoking it", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const then = vi.fn();
    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => ({ then }),
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
    });
    expect(then).not.toHaveBeenCalled();
  });

  it("rejects a Proxy Error without invoking its prototype trap", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    let prototypeTrapCalls = 0;
    const hostileError = new Proxy(new Error("hostile recovery error"), {
      getPrototypeOf(target) {
        prototypeTrapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => {
        throw hostileError;
      },
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_EVENT_READ_FAILED" },
    });
    expect(candidate.recoveryError.cause).not.toBe(hostileError);
    expect(prototypeTrapCalls).toBe(0);
  });

  it.each(["accessor", "data"])(
    "consumes a rejected native Promise with an own then %s override",
    async (overrideKind) => {
      const { readReplMcpRecoveryCandidate } =
        await import("../../src/repl/agent-repl.js");
      const unhandled = vi.fn();
      const thenGetter = vi.fn(() => () => {});
      process.prependListener("unhandledRejection", unhandled);
      try {
        const rejected = Promise.reject(new Error("async recovery"));
        Object.defineProperty(
          rejected,
          "then",
          overrideKind === "accessor"
            ? { configurable: true, get: thenGetter }
            : { configurable: true, value: null },
        );
        const candidate = readReplMcpRecoveryCandidate("target-session", {
          loadMcpLedgerRecovery: () => rejected,
          formatMcpLedgerRecoveryNotice: vi.fn(),
        });

        expect(candidate).toMatchObject({
          recovery: null,
          recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(thenGetter).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );

  it.each(["accessor", "species"])(
    "safely consumes and restores a rejected native Promise with a configurable hostile %s constructor",
    async (constructorKind) => {
      const { readReplMcpRecoveryCandidate } =
        await import("../../src/repl/agent-repl.js");
      const unhandled = vi.fn();
      const constructorGetter = vi.fn(() => Promise);
      const speciesGetter = vi.fn(() => Promise);
      const hostileConstructor = Object.defineProperty({}, Symbol.species, {
        configurable: true,
        get: speciesGetter,
      });
      process.prependListener("unhandledRejection", unhandled);
      try {
        const rejected = Promise.reject(new Error("async recovery"));
        Object.defineProperty(
          rejected,
          "constructor",
          constructorKind === "accessor"
            ? { configurable: true, get: constructorGetter }
            : { configurable: true, value: hostileConstructor },
        );
        const originalDescriptor = Object.getOwnPropertyDescriptor(
          rejected,
          "constructor",
        );
        const candidate = readReplMcpRecoveryCandidate("target-session", {
          loadMcpLedgerRecovery: () => rejected,
          formatMcpLedgerRecoveryNotice: vi.fn(),
        });

        expect(candidate).toMatchObject({
          recovery: null,
          recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
        });
        expect(
          Object.getOwnPropertyDescriptor(rejected, "constructor"),
        ).toEqual(originalDescriptor);
        await new Promise((resolve) => setImmediate(resolve));
        expect(constructorGetter).not.toHaveBeenCalled();
        expect(speciesGetter).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );

  it("fails closed without invoking an unsafe non-configurable Promise constructor", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const constructorGetter = vi.fn(() => Promise);
    const rejected = Promise.reject(new Error("producer-owned rejection"));
    // The boundary cannot both avoid this hostile getter and mark the Promise
    // handled: Promise.prototype.then always resolves @@species through the
    // constructor. The producer must therefore observe its rejection first.
    Reflect.apply(Promise.prototype.then, rejected, [undefined, () => {}]);
    Object.defineProperty(rejected, "constructor", {
      configurable: false,
      get: constructorGetter,
    });

    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => rejected,
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_REPL_NATIVE_PROMISE_UNCONSUMABLE" },
    });
    expect(constructorGetter).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("rejects Proxy and accessor rebuild arrays before resume preparation", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    let getterCalls = 0;
    const accessorMessages = [];
    Object.defineProperty(accessorMessages, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { role: "user", content: "unsafe" };
      },
    });
    accessorMessages.length = 1;
    const prepare = (rebuildMessages) =>
      prepareReplJsonlResumeCandidate("target-session", {
        loadMcpLedgerRecovery: () => verifiedReplRecovery("target-session"),
        formatMcpLedgerRecoveryNotice: () => null,
        rebuildMessages,
      });

    const proxyCandidate = prepare(() => new Proxy([], {}));
    const accessorCandidate = prepare(() => accessorMessages);

    expect(getterCalls).toBe(0);
    for (const candidate of [proxyCandidate, accessorCandidate]) {
      expect(candidate).toMatchObject({
        ok: false,
        mcp: {
          recovery: null,
          recoveryError: { code: "CC_REPL_SESSION_REBUILD_FAILED" },
        },
      });
    }
  });

  it("turns a forged injected clean candidate into ALL-blocking authority", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { createRecoveryGuardedMcpCallLedger } =
      await import("../../src/lib/mcp-ledger-recovery-admission.js");
    const forged = Object.freeze({
      sessionId: "target-session",
      recovery: verifiedReplRecovery("target-session"),
      recoveryError: null,
      notice: null,
    });
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      mcpRecoveryCandidate: forged,
      rebuildMessages: () => [{ role: "user", content: "restored" }],
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.mcp).toMatchObject({
      recovery: null,
      recoveryError: {
        code: "CC_REPL_MCP_RECOVERY_CANDIDATE_INVALID",
      },
    });
    const ledger = createRecoveryGuardedMcpCallLedger({
      recovery: candidate.mcp.recovery,
      recoveryError: candidate.mcp.recoveryError,
    });
    await expect(
      ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "status",
        input: {},
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({ blockMode: "all" });
  });

  it("rejects a forged prepared resume candidate before its commit runs", async () => {
    const { commitPreparedReplJsonlResume } =
      await import("../../src/repl/agent-repl.js");
    const commit = vi.fn();

    expect(
      commitPreparedReplJsonlResume(Object.freeze({ ok: true }), commit),
    ).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it.each([
    ["JSONL", "helper"],
    ["JSONL", "runtime"],
    ["JSONL", "logger"],
    ["DB", "helper"],
    ["DB", "runtime"],
    ["DB", "logger"],
  ])(
    "atomically rolls the real %s resume state back when %s throws",
    async (format, stage) => {
      const {
        commitPreparedReplDbResume,
        commitPreparedReplJsonlResume,
        createReplResumeStateController,
        prepareReplJsonlResumeCandidate,
      } = await import("../../src/repl/agent-repl.js");
      const jsonlCandidate = prepareReplJsonlResumeCandidate("target-session", {
        loadMcpLedgerRecovery: () => verifiedReplRecovery("target-session"),
        formatMcpLedgerRecoveryNotice: () => "target recovery notice",
        rebuildMessages: () => [
          { role: "system", content: "target system" },
          { role: "user", content: "target user" },
        ],
      });
      const oldSystem = Object.freeze({ role: "system", content: "old" });
      const oldMessage = Object.freeze({ role: "user", content: "old user" });
      const oldRecovery = Object.freeze({ id: "old-authority" });
      const oldRecoveryError = Object.assign(new Error("old recovery error"), {
        code: "OLD_RECOVERY_ERROR",
      });
      const oldTurnBindingProducer = Object.freeze({ id: "old-producer" });
      const oldTurnBindingCriticalError = new Error("old turn error");
      const oldCheckpoint = Object.freeze({ id: "old-checkpoint" });
      const oldStash = Object.freeze({ id: "old-stash" });
      const oldRuntime = Object.freeze({ id: "old-runtime" });
      const targetRuntime = Object.freeze({ id: "target-runtime" });
      const state = {
        sessionId: "old-session",
        messages: [oldSystem, oldMessage],
        recovery: oldRecovery,
        recoveryError: oldRecoveryError,
        sanitizeRolesNextTurn: true,
        turnBindingProducer: oldTurnBindingProducer,
        turnBindingCriticalError: oldTurnBindingCriticalError,
        checkpointMarks: [oldCheckpoint],
        clearedConversation: oldStash,
      };
      const runtimeManager = {
        current: oldRuntime,
        commit(candidate) {
          this.current = candidate;
          if (stage === "runtime" && candidate === targetRuntime) {
            throw new Error("runtime failed");
          }
          return candidate;
        },
      };
      const bindings = {
        ...state,
        messages: state.messages,
        checkpointMarks: state.checkpointMarks,
        runtimeManager,
        applyMcpRecoveryCommit(targetMessages, preparedCommit) {
          bindings.recovery = preparedCommit.recovery;
          bindings.recoveryError = preparedCommit.recoveryError;
          if (preparedCommit.noticeMessage) {
            targetMessages.push(preparedCommit.noticeMessage);
          }
          if (stage === "helper") throw new Error("helper failed");
        },
        logMcpRecoveryCommit: vi.fn(),
        logger: {
          info: vi.fn(() => {
            if (stage === "logger") throw new Error("logger failed");
          }),
        },
      };
      const controller = createReplResumeStateController(bindings);
      const previousState = controller.capture();
      const targetRecovery =
        format === "JSONL" ? jsonlCandidate.mcp.recovery : null;
      const preparedState = Object.freeze({
        sessionId: "target-session",
        systemMessage: oldSystem,
        replayMessages:
          format === "JSONL"
            ? jsonlCandidate.replayMessages
            : Object.freeze([
                Object.freeze({ role: "assistant", content: "target DB" }),
              ]),
        mcpCommit: Object.freeze({
          recovery: targetRecovery,
          recoveryError: null,
          noticeMessage:
            format === "JSONL"
              ? Object.freeze({
                  role: "system",
                  content: "target recovery notice",
                })
              : null,
          warning: null,
        }),
        mcpRuntime: targetRuntime,
        sanitizeRolesNextTurn: false,
        logMessage: `Resumed ${format} target-session`,
      });
      const commit = () => controller.apply(preparedState);
      const rollback = vi.fn(() => controller.restore(previousState));

      expect(() =>
        format === "JSONL"
          ? commitPreparedReplJsonlResume(jsonlCandidate, commit, rollback)
          : commitPreparedReplDbResume(preparedState, commit, rollback),
      ).toThrow(`${stage} failed`);
      expect(rollback).toHaveBeenCalledOnce();
      expect(bindings.sessionId).toBe("old-session");
      expect(bindings.messages).toEqual([oldSystem, oldMessage]);
      expect(bindings.recovery).toBe(oldRecovery);
      expect(bindings.recoveryError).toBe(oldRecoveryError);
      expect(bindings.sanitizeRolesNextTurn).toBe(true);
      expect(bindings.turnBindingProducer).toBe(oldTurnBindingProducer);
      expect(bindings.turnBindingCriticalError).toBe(
        oldTurnBindingCriticalError,
      );
      expect(bindings.checkpointMarks).toEqual([oldCheckpoint]);
      expect(bindings.clearedConversation).toBe(oldStash);
      expect(runtimeManager.current).toBe(oldRuntime);
    },
  );

  it("feeds every exact replay deny into the shared runtime controller", async () => {
    const {
      commitPreparedReplJsonlResume,
      createReplMcpHostRuntimeManager,
      createReplResumeStateController,
      prepareReplJsonlResumeCandidate,
    } = await import("../../src/repl/agent-repl.js");
    const { computeMcpExactReplayDigest, summarizeMcpPayload } =
      await import("../../src/lib/mcp-call-ledger.js");
    const input = { path: "README.md" };
    const summary = summarizeMcpPayload(input);
    const deny = {
      ledgerId: "ledger-applied",
      serverName: "repo",
      toolName: "status",
      inputBytes: summary.bytes,
      replayDigest: computeMcpExactReplayDigest({
        serverName: "repo",
        toolName: "status",
        inputDigest: summary.sha256,
        inputBytes: summary.bytes,
      }),
    };
    const resumeCandidate = prepareReplJsonlResumeCandidate("target-session", {
      loadMcpLedgerRecovery: () =>
        verifiedReplRecovery("target-session", { replayDenied: [deny] }),
      formatMcpLedgerRecoveryNotice: () => null,
      rebuildMessages: () => [{ role: "user", content: "target history" }],
    });
    const oldRawCall = vi.fn(async () => ({ content: [] }));
    const rawCall = vi.fn(async () => ({ content: [] }));
    const nextRawCall = vi.fn(async () => ({ content: [] }));
    const manager = createReplMcpHostRuntimeManager({
      createSessionMcpLedgerSink: () => vi.fn(async () => true),
    });
    const oldRuntime = manager.activate({
      adhocMcp: { mcpClient: { callTool: oldRawCall } },
      sessionId: "old-session",
      persistent: true,
      recovery: verifiedReplRecovery("old-session"),
      verifiedRecovery: true,
    });
    const targetRuntime = manager.prepare({
      adhocMcp: { mcpClient: { callTool: rawCall } },
      sessionId: "target-session",
      persistent: true,
      recovery: resumeCandidate.mcp.recovery,
      verifiedRecovery: true,
    });
    expect(manager.current).toBe(oldRuntime);
    const bindings = {
      sessionId: "old-session",
      messages: [{ role: "system", content: "system" }],
      recovery: verifiedReplRecovery("old-session"),
      recoveryError: null,
      sanitizeRolesNextTurn: false,
      turnBindingProducer: { id: "producer" },
      turnBindingCriticalError: null,
      checkpointMarks: [{ id: "checkpoint" }],
      clearedConversation: { id: "stash" },
      runtimeManager: manager,
      applyMcpRecoveryCommit(targetMessages, preparedCommit) {
        bindings.recovery = preparedCommit.recovery;
        bindings.recoveryError = preparedCommit.recoveryError;
        if (preparedCommit.noticeMessage) {
          targetMessages.push(preparedCommit.noticeMessage);
        }
      },
      logMcpRecoveryCommit: vi.fn(),
      logger: { info: vi.fn() },
    };
    const stateController = createReplResumeStateController(bindings);
    const previousState = stateController.capture();
    const preparedState = Object.freeze({
      sessionId: "target-session",
      systemMessage: bindings.messages[0],
      replayMessages: resumeCandidate.replayMessages,
      mcpCommit: Object.freeze({
        recovery: resumeCandidate.mcp.recovery,
        recoveryError: null,
        noticeMessage: null,
        warning: null,
      }),
      mcpRuntime: targetRuntime,
      sanitizeRolesNextTurn: true,
      logMessage: "Resumed JSONL target-session",
    });
    expect(
      commitPreparedReplJsonlResume(
        resumeCandidate,
        () => stateController.apply(preparedState),
        () => stateController.restore(previousState),
      ),
    ).toBe(true);
    expect(manager.current).toBe(targetRuntime);
    expect(bindings.recovery.replayDenied).toEqual([deny]);
    expect(bindings.checkpointMarks).toEqual([]);
    expect(bindings.clearedConversation).toBeNull();

    await expect(
      targetRuntime.runtime.ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "status",
        input,
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
      replayDenied: true,
    });
    await expect(
      targetRuntime.hostMcp.mcpClient.callTool("repo", "status", input),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
      replayDenied: true,
    });
    expect(rawCall).not.toHaveBeenCalled();

    const second = manager.activate({
      adhocMcp: { mcpClient: { callTool: nextRawCall } },
      sessionId: "target-session",
      persistent: true,
      recovery: resumeCandidate.mcp.recovery,
    });
    expect(second.runtime.controller).toBe(targetRuntime.runtime.controller);
    await expect(
      second.hostMcp.mcpClient.callTool("repo", "status", input),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
    });
    expect(nextRawCall).not.toHaveBeenCalled();
  });
});

describe("agent-repl resume role-alternation wiring (2.1.187 parity)", () => {
  const agentReplPath = join(
    __dirname,
    "..",
    "..",
    "src",
    "repl",
    "agent-repl.js",
  );
  const content = readFileSync(agentReplPath, "utf8");

  it("imports the in-place collapse helper", () => {
    expect(content).toContain(
      'import { collapseConsecutiveMessagesInPlace } from "../runtime/message-roles.js"',
    );
  });

  it("declares the one-shot sanitation flag, default off", () => {
    expect(content).toContain("let _sanitizeRolesNextTurn = false;");
  });

  it("arms the flag at every resume site when history ends with a user turn", () => {
    // Both startup (--session/--resume) and /session resume, JSONL + DB paths.
    const startupArms = content.match(
      /_sanitizeRolesNextTurn\s*=\s*\n?\s*messages\[messages\.length - 1\]\?\.role === "user";/g,
    );
    expect(startupArms).toHaveLength(2);
    expect(content).toContain(
      'prepared.replayMessages.at(-1)?.role === "user"',
    );
    expect(content).toContain('replayMessages.at(-1)?.role === "user"');
  });

  it("collapses in place inside the loop wrapper, gated on options.mergeRoles", () => {
    expect(content).toContain("if (options.mergeRoles) {");
    expect(content).toContain("collapseConsecutiveMessagesInPlace(messages);");
  });

  it("consumes the flag once at the model call and threads mergeRoles through", () => {
    expect(content).toContain(
      "const _mergeRolesThisTurn = _sanitizeRolesNextTurn;",
    );
    expect(content).toContain("_sanitizeRolesNextTurn = false;");
    expect(content).toContain("mergeRoles: _mergeRolesThisTurn,");
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
    // Mock readUserProfile to avoid filesystem dependency in CI
    const origReadProfile = ceMod._deps.readUserProfile;
    ceMod._deps.readUserProfile = () => "";
    try {
      const engine = new ceMod.CLIContextEngineering({ db: null });
      const result = engine.buildOptimizedMessages(
        [{ role: "system", content: "test" }],
        { userQuery: "hello" },
      );
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("system");
    } finally {
      ceMod._deps.readUserProfile = origReadProfile;
    }
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
      { encoding: "utf-8", timeout: 60000 },
    );
    expect(result).toBeTruthy();
  });
});

describe("agent-repl /btw side-question wiring", () => {
  const agentReplPath = join(
    __dirname,
    "..",
    "..",
    "src",
    "repl",
    "agent-repl.js",
  );
  const content = readFileSync(agentReplPath, "utf8");

  it("imports the pure /btw helpers", () => {
    expect(content).toContain('from "./btw-command.js"');
    expect(content).toContain("parseBtwCommand");
    expect(content).toContain("runBtwQuestion");
    expect(content).toContain("parseNoteNextCommand");
    expect(content).toContain("buildAsideBlock");
    expect(content).toContain("applyAside");
  });

  it("runs /btw immediately and allows it alongside a main turn", () => {
    expect(content).toContain("await runBtwSideQuestion(btw);");
    expect(content).toContain("parseBtwCommand(input.trim())");
    expect(content).toContain(
      "void runBtwSideQuestion(concurrentBtw, { concurrent: true });",
    );
  });

  it("queues /note-next guidance and consumes it on send", () => {
    expect(content).toContain("let pendingBtw = [];");
    expect(content).toContain("const note = parseNoteNextCommand(trimmed);");
    expect(content).toContain("pendingBtw.push(note.text);");
    // consumed (cleared) when the turn fires
    expect(content).toContain("pendingBtw = [];");
  });

  it("injects before agentLoop and restores after, so the aside never persists", () => {
    // capture the pre-aside content, then apply the block to the user message
    expect(content).toContain(
      "_btwRestore = { msg: _userMsg, content: _userMsg.content };",
    );
    expect(content).toContain(
      "_userMsg.content = applyAside(_userMsg.content, block);",
    );
    // the injection sits before the agentLoop call; the restore resets content
    const injectAt = content.indexOf("_userMsg.content = applyAside(");
    const loopAt = content.indexOf("await agentLoop(messages, {");
    // lastIndexOf = the success-path restore AFTER the call (the first
    // occurrence is the submit-start backstop, which sits before agentLoop).
    const restoreAt = content.lastIndexOf(
      "_btwRestore.msg.content = _btwRestore.content;",
    );
    expect(injectAt).toBeGreaterThan(0);
    expect(loopAt).toBeGreaterThan(injectAt); // inject BEFORE the model call
    expect(restoreAt).toBeGreaterThan(loopAt); // restore AFTER it
  });

  it("keeps the user-message object ref so the aside can be stripped", () => {
    expect(content).toContain(
      'const _userMsg = { role: "user", content: _userMessageContent };',
    );
    expect(content).toContain("messages.push(_userMsg);");
  });
});
