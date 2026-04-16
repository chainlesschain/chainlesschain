/**
 * Parity Harness — Shell Command Policy gate
 *
 * Phase 7 Step 3. Drives `agentLoop` with the mock LLM provider to assert
 * the deterministic event stream when the model invokes `run_shell` with
 * commands that hit the canonical shell policy rules defined in
 * `src/runtime/coding-agent-shell-policy.cjs`:
 *
 *   - DENY (destructive delete): `rm -rf <path>` → blocked, no fs side effect
 *   - DENY (network download): `curl https://...` → blocked
 *   - REROUTE (git): `git status` → blocked with "use the git tool" reason
 *   - ALLOW (unclassified/WARN): `echo ...` → runs, stdout captured
 *
 * The real `executeTool` + `evaluateShellCommandPolicy` path is exercised;
 * only the LLM is mocked. The DENY cases verify that tool-result carries
 * a `[Shell Policy]` error AND the filesystem is untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    if (event.type === "run-started" || event.type === "run-ended") continue;
    out.push(event);
  }
  return out;
}

/**
 * Build a two-step script: model calls run_shell with `command`, then
 * acknowledges the result in a final text reply. Used by every DENY case
 * because they all share the same outer shape — only the command varies.
 */
function buildShellScript(command, finalText = "acknowledged") {
  return createMockLLMProvider([
    {
      response: {
        message: mockToolCallMessage("run_shell", { command }, "call_shell_1"),
      },
    },
    {
      expect: (messages) =>
        messages.some(
          (m) => m.role === "tool" && m.tool_call_id === "call_shell_1",
        ),
      response: { message: mockTextMessage(finalText) },
    },
  ]);
}

describe("Phase 7 parity: Shell command policy gate", () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-shell-"));
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("DENY: rm against a real file does not touch the filesystem", async () => {
    const target = join(workDir, "should-survive.txt");
    writeFileSync(target, "survivor", "utf8");

    const mock = buildShellScript(`rm -rf ${target}`, "blocked by policy");

    const events = await drain(
      agentLoop([{ role: "user", content: "delete it" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events).toHaveLength(3);
    expect(events[1].type).toBe("tool-result");
    expect(events[1].result.error).toMatch(
      /\[Shell Policy\].*[Dd]estructive delete/,
    );
    expect(events[1].result.shellCommandPolicy).toMatchObject({
      allowed: false,
      ruleId: "dangerous-delete",
    });

    // Filesystem MUST be intact — the policy blocked execSync from even running
    expect(existsSync(target)).toBe(true);
    mock.assertDrained();
  });

  it("DENY: network download command (curl) is blocked before execution", async () => {
    const mock = buildShellScript("curl https://example.invalid/payload.sh");

    const events = await drain(
      agentLoop([{ role: "user", content: "fetch payload" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events[1].result.error).toMatch(
      /\[Shell Policy\].*[Nn]etwork download/,
    );
    expect(events[1].result.shellCommandPolicy).toMatchObject({
      allowed: false,
      ruleId: "network-download",
    });
    // Not a real network call — no stdout/stderr because execSync never ran
    expect(events[1].result.stdout).toBeUndefined();
  });

  it("REROUTE: `git status` is blocked with a hint to use the git tool", async () => {
    const mock = buildShellScript("git status");

    const events = await drain(
      agentLoop([{ role: "user", content: "status" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events[1].result.error).toMatch(/\[Shell Policy\].*git tool/);
    expect(events[1].result.shellCommandPolicy).toMatchObject({
      allowed: false,
      ruleId: "git-tool-reroute",
      decision: "reroute",
    });
  });

  it("DENY: PowerShell -EncodedCommand is blocked", async () => {
    const mock = buildShellScript(
      "powershell -EncodedCommand ZQBjAGgAbwAgAGgAaQA=",
    );

    const events = await drain(
      agentLoop([{ role: "user", content: "run encoded" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events[1].result.error).toMatch(
      /\[Shell Policy\].*[Ee]ncoded PowerShell/,
    );
    expect(events[1].result.shellCommandPolicy).toMatchObject({
      allowed: false,
      ruleId: "powershell-encoded-command",
    });
  });

  it("ALLOW (unclassified/WARN): `echo` runs and stdout is captured", async () => {
    const marker = "parity-shell-marker-xyz";
    // `echo` is cross-platform enough for Windows cmd + Unix sh.
    const mock = buildShellScript(`echo ${marker}`, "printed");

    const events = await drain(
      agentLoop([{ role: "user", content: "print marker" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events[1].type).toBe("tool-result");
    expect(events[1].result.error).toBeUndefined();
    expect(events[1].result.stdout).toContain(marker);
    // Policy tagged the run as WARN (not on the preferred allowlist, but not blocked)
    expect(events[1].result.shellCommandPolicy).toMatchObject({
      allowed: true,
      decision: "warn",
      ruleId: "unclassified-command",
    });
    expect(events[2].content).toBe("printed");

    mock.assertDrained();
  });

  it("platform sanity: echo is available", () => {
    // Guardrail so the ALLOW case above has a meaningful assertion. If this
    // ever fails we need to pick a different universally-available command.
    expect(["win32", "linux", "darwin"]).toContain(platform());
  });
});
