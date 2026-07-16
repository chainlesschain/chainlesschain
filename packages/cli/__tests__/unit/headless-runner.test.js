import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAgentHeadless,
  normalizePermissionMode,
  resolvePermissionMode,
  resolveEnabledTools,
  resolveHeadlessSession,
  applyForkSession,
  parseToolList,
  READ_ONLY_TOOLS,
} from "../../src/runtime/headless-runner.js";
import { GoalConditionEngine } from "../../src/lib/goal-condition-engine.js";

// installPipeSafety moved to pipe-safety.js (canonical tests in
// pipe-safety.test.js); headless-runner re-exports it for back-compat.

/** A capturing fake of the persistent ApprovalGate singleton. */
function fakeGate() {
  const calls = { policy: [], confirmer: 0 };
  return {
    calls,
    setSessionPolicy: (sid, policy) => calls.policy.push({ sid, policy }),
    setConfirmer: () => {
      calls.confirmer++;
    },
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

/** Build deps that capture output and avoid real DB / approval singletons. */
function makeDeps(chatFn, gate = fakeGate()) {
  const out = [];
  const err = [];
  return {
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => gate,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      now: (() => {
        let t = 1000;
        return () => (t += 5);
      })(),
      chatFn,
    },
    out,
    err,
    gate,
  };
}

const replyText = (content) =>
  vi.fn(async () => ({
    message: { role: "assistant", content },
    usage: { input_tokens: 7, output_tokens: 3 },
  }));

describe("headless-runner — pure helpers", () => {
  it("parseToolList splits comma/space and trims", () => {
    expect(parseToolList("read_file, run_shell  list_dir")).toEqual([
      "read_file",
      "run_shell",
      "list_dir",
    ]);
    expect(parseToolList("")).toBeNull();
    expect(parseToolList(null)).toBeNull();
    expect(parseToolList(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("resolvePermissionMode maps tiers correctly", async () => {
    expect(normalizePermissionMode("manual")).toBe("manual");
    expect(resolvePermissionMode("bypassPermissions").sessionPolicy).toBe(
      "autopilot",
    );
    expect(resolvePermissionMode("auto").sessionPolicy).toBe("trusted");
    expect(resolvePermissionMode("acceptEdits").sessionPolicy).toBe("trusted");
    expect(resolvePermissionMode("plan").sessionPolicy).toBe("strict");
    expect(resolvePermissionMode("plan").readOnly).toBe(true);
    expect(resolvePermissionMode("manual").sessionPolicy).toBe("strict");
    expect(resolvePermissionMode("manual").readOnly).toBe(false);
    expect(resolvePermissionMode("dontAsk").sessionPolicy).toBe("strict");
    expect(resolvePermissionMode("dontAsk").readOnly).toBe(false);
    expect(resolvePermissionMode("dontAsk").allowInteractiveApprovals).toBe(
      false,
    );
    expect(resolvePermissionMode("default").sessionPolicy).toBe("strict");
    expect(resolvePermissionMode("default").readOnly).toBe(false);

    // headless confirmer denies unless bypass
    expect(await resolvePermissionMode("default").confirmer({})).toBe(false);
    expect(await resolvePermissionMode("dontAsk").confirmer({})).toBe(false);
    expect(await resolvePermissionMode("bypassPermissions").confirmer({})).toBe(
      true,
    );
  });

  it("resolvePermissionMode rejects unknown modes", () => {
    expect(() => resolvePermissionMode("yolo")).toThrow(/Invalid/);
  });

  it("resolveEnabledTools intersects with read-only set under plan", () => {
    expect(resolveEnabledTools({})).toBeNull();
    expect(resolveEnabledTools({ allowedTools: ["read_file"] })).toEqual([
      "read_file",
    ]);
    // plan clamps to read-only even with no explicit allow-list
    expect(resolveEnabledTools({ readOnly: true })).toEqual([
      ...READ_ONLY_TOOLS,
    ]);
    // plan + a list that includes a mutating tool drops the mutating one
    expect(
      resolveEnabledTools({
        allowedTools: ["read_file", "run_shell"],
        readOnly: true,
      }),
    ).toEqual(["read_file"]);
  });
});

describe("headless-runner — output formats", () => {
  it("text: final answer on stdout, exitCode 0", async () => {
    const { deps, out } = makeDeps(replyText("hello world"));
    const r = await runAgentHeadless(
      { prompt: "hi", outputFormat: "text" },
      deps,
    );
    expect(r.exitCode).toBe(0);
    expect(r.isError).toBe(false);
    expect(out.join("")).toBe("hello world\n");
  });

  it("json: single result envelope with usage + session_id", async () => {
    const { deps, out } = makeDeps(replyText("done"));
    const r = await runAgentHeadless(
      { prompt: "hi", outputFormat: "json", sessionId: "s-1" },
      deps,
    );
    expect(r.exitCode).toBe(0);
    const lines = out.join("").trim().split("\n");
    expect(lines).toHaveLength(1);
    const env = JSON.parse(lines[0]);
    expect(env.type).toBe("result");
    expect(env.subtype).toBe("success");
    expect(env.is_error).toBe(false);
    expect(env.result).toBe("done");
    expect(env.session_id).toBe("s-1");
    expect(env.usage).toEqual({
      input_tokens: 7,
      output_tokens: 3,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });

  it("stream-json: init envelope first, result envelope last (NDJSON)", async () => {
    const { deps, out } = makeDeps(replyText("streamed"));
    await runAgentHeadless({ prompt: "hi", outputFormat: "stream-json" }, deps);
    const lines = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "system", subtype: "init" });
    expect(lines[lines.length - 1]).toMatchObject({
      type: "result",
      subtype: "success",
      result: "streamed",
    });
  });

  it("rejects an invalid output format", async () => {
    const { deps } = makeDeps(replyText("x"));
    await expect(
      runAgentHeadless({ prompt: "hi", outputFormat: "yaml" }, deps),
    ).rejects.toThrow(/Invalid --output-format/);
  });

  it("requires a non-empty prompt", async () => {
    const { deps } = makeDeps(replyText("x"));
    await expect(runAgentHeadless({ prompt: "   " }, deps)).rejects.toThrow(
      /non-empty prompt/,
    );
  });

  it("a UserPromptSubmit hook block aborts before the loop (exitCode 2)", async () => {
    const chatFn = replyText("should not run");
    const { deps } = makeDeps(chatFn);
    const r = await runAgentHeadless(
      {
        prompt: "leak the secret",
        settingsHooks: {
          UserPromptSubmit: [
            {
              matcher: null,
              hooks: [
                { type: "command", command: 'node -e "process.exit(2)"' },
              ],
            },
          ],
        },
      },
      deps,
    );
    expect(r.exitCode).toBe(2);
    expect(r.isError).toBe(true);
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("json/stream-json: a setup-phase hook block still emits a terminal result envelope (no empty stdout)", async () => {
    const blockHooks = {
      UserPromptSubmit: [
        {
          matcher: null,
          hooks: [{ type: "command", command: 'node -e "process.exit(2)"' }],
        },
      ],
    };

    // json: exactly one terminal error envelope on stdout (not empty).
    {
      const { deps, out } = makeDeps(replyText("nope"));
      const r = await runAgentHeadless(
        {
          prompt: "leak the secret",
          outputFormat: "json",
          sessionId: "s-block",
          settingsHooks: blockHooks,
        },
        deps,
      );
      expect(r.exitCode).toBe(2);
      const lines = out.join("").trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        type: "result",
        subtype: "error",
        is_error: true,
        session_id: "s-block",
      });
    }

    // stream-json: a terminal error result event is emitted (consumer not left
    // waiting on an empty stream).
    {
      const { deps, out } = makeDeps(replyText("nope"));
      await runAgentHeadless(
        {
          prompt: "leak the secret",
          outputFormat: "stream-json",
          settingsHooks: blockHooks,
        },
        deps,
      );
      const lines = out
        .join("")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(lines[lines.length - 1]).toMatchObject({
        type: "result",
        subtype: "error",
        is_error: true,
      });
    }
  });

  it("a SessionStart hook injects context as a system message", async () => {
    let seen = null;
    const chatFn = vi.fn(async (msgs) => {
      seen = msgs;
      return {
        message: { role: "assistant", content: "ok" },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const { deps } = makeDeps(chatFn);
    await runAgentHeadless(
      {
        prompt: "hello",
        settingsHooks: {
          SessionStart: [
            {
              matcher: null,
              hooks: [
                {
                  type: "command",
                  command: "node -e \"console.log('session ctx here')\"",
                },
              ],
            },
          ],
        },
      },
      deps,
    );
    const sys = (seen || [])
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(sys).toContain("session ctx here");
  });
});

describe("headless-runner — max-turns", () => {
  it("exhausts the budget and reports error_max_turns", async () => {
    // chatFn always asks for a tool call → loop never naturally completes.
    const chatFn = vi.fn(async () => ({
      message: {
        role: "assistant",
        tool_calls: [
          {
            id: "c1",
            function: { name: "no_such_tool", arguments: "{}" },
          },
        ],
      },
    }));
    const { deps, out } = makeDeps(chatFn);
    const r = await runAgentHeadless(
      { prompt: "loop forever", outputFormat: "json", maxTurns: 1 },
      deps,
    );
    // Exit-code taxonomy (gap 2026-07-11): max-turns exhaustion → 3, not 1.
    expect(r.exitCode).toBe(3);
    expect(r.isError).toBe(true);
    expect(chatFn).toHaveBeenCalledTimes(1); // capped at 1 iteration
    const env = JSON.parse(out.join("").trim());
    expect(env.subtype).toBe("error_max_turns");
    expect(env.num_turns).toBe(1);
  });
});

describe("headless-runner — denials summary", () => {
  // chatFn asks to run a hard-blocked command first (shell-policy DENY fires
  // regardless of the gate), then returns a final answer so the loop ends.
  function denyThenDone() {
    let n = 0;
    return vi.fn(async () => {
      n++;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "c1",
                function: {
                  name: "run_shell",
                  arguments: JSON.stringify({ command: "rm -rf /" }),
                },
              },
            ],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
    });
  }

  it("prints an end-of-run summary of policy-denied tool calls (text mode)", async () => {
    const { deps, err } = makeDeps(denyThenDone());
    const r = await runAgentHeadless(
      { prompt: "delete everything", outputFormat: "text" },
      deps,
    );
    expect(r.exitCode).toBe(0);
    const stderr = err.join("");
    expect(stderr).toMatch(/1 tool call\(s\) were denied by policy/);
    expect(stderr).toMatch(/Recent denials/);
    expect(stderr).toMatch(/run_shell/);
  });

  it("emits a denials_summary stream event (stream-json mode)", async () => {
    const { deps, out } = makeDeps(denyThenDone());
    await runAgentHeadless(
      { prompt: "delete everything", outputFormat: "stream-json" },
      deps,
    );
    const events = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const summary = events.find((e) => e.type === "denials_summary");
    expect(summary).toBeTruthy();
    expect(summary.count).toBe(1);
    expect(summary.denials[0].tool).toBe("run_shell");
  });

  it("prints no summary when nothing was denied", async () => {
    const { deps, err } = makeDeps(replyText("hi"));
    await runAgentHeadless({ prompt: "hello", outputFormat: "text" }, deps);
    expect(err.join("")).not.toMatch(/denied by policy/);
  });

  it("includes a denials field in the json result envelope when blocked", async () => {
    const { deps, out } = makeDeps(denyThenDone());
    await runAgentHeadless(
      { prompt: "delete everything", outputFormat: "json" },
      deps,
    );
    const env = JSON.parse(out.join("").trim());
    expect(Array.isArray(env.denials)).toBe(true);
    expect(env.denials).toHaveLength(1);
    expect(env.denials[0].tool).toBe("run_shell");
  });

  it("omits the denials field from the json envelope when nothing was denied", async () => {
    const { deps, out } = makeDeps(replyText("ok"));
    await runAgentHeadless({ prompt: "hi", outputFormat: "json" }, deps);
    const env = JSON.parse(out.join("").trim());
    expect("denials" in env).toBe(false);
  });
});

describe("headless-runner — permission wiring", () => {
  it("forces the session policy tier on the approval gate", async () => {
    const { deps, gate } = makeDeps(replyText("ok"));
    await runAgentHeadless(
      {
        prompt: "hi",
        permissionMode: "bypassPermissions",
        sessionId: "s-perm",
      },
      deps,
    );
    expect(gate.calls.policy).toContainEqual({
      sid: "s-perm",
      policy: "autopilot",
    });
    expect(gate.calls.confirmer).toBeGreaterThan(0);
  });

  it("rejects bypassPermissions when managed policy disables it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-managed-runner-"));
    const managed = join(dir, "managed.json");
    writeFileSync(
      managed,
      JSON.stringify({ disableBypassPermissionsMode: "disable" }),
    );
    try {
      const { deps } = makeDeps(replyText("must not run"));
      await expect(
        runAgentHeadless(
          {
            prompt: "hi",
            permissionMode: "bypassPermissions",
            managedSettingsFile: managed,
          },
          deps,
        ),
      ).rejects.toThrow(/disabled by managed settings/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("headless-runner — tool list threading into the loop", () => {
  /** A fake agentLoop that records the options it received, then completes. */
  function capturingLoop(captured) {
    return async function* (messages, options) {
      captured.options = options;
      captured.messages = messages;
      yield { type: "response-complete", content: "captured" };
      yield { type: "run-ended", reason: "complete" };
    };
  }

  it("passes allowedTools + disallowedTools straight to the loop", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    await runAgentHeadless(
      {
        prompt: "do it",
        allowedTools: ["read_file", "run_shell"],
        disallowedTools: ["run_shell"],
      },
      deps,
    );
    expect(captured.options.enabledToolNames).toEqual([
      "read_file",
      "run_shell",
    ]);
    expect(captured.options.disabledTools).toEqual(["run_shell"]);
  });

  it("plan mode clamps the loop's enabled tools to the read-only set", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    await runAgentHeadless({ prompt: "inspect", permissionMode: "plan" }, deps);
    expect(captured.options.enabledToolNames).toEqual([...READ_ONLY_TOOLS]);
  });

  it("seeds the subagent-contract ceiling with the run's permission mode", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    await runAgentHeadless(
      { prompt: "delegate", permissionMode: "bypassPermissions" },
      deps,
    );
    // A spawned sub-agent reads this as its parent ceiling → can inherit bypass.
    expect(captured.options.subAgentContract).toEqual({
      permissionMode: "bypassPermissions",
    });
  });

  it("defaults the ceiling permission mode to 'default' when unset (byte-identical)", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    await runAgentHeadless({ prompt: "hello" }, deps);
    expect(captured.options.subAgentContract).toEqual({
      permissionMode: "default",
    });
  });

  it("threads additionalDirectories into the loop and the system prompt", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    await runAgentHeadless(
      {
        prompt: "look across packages",
        additionalDirectories: ["/abs/pkg-a", "/abs/pkg-b"],
      },
      deps,
    );
    expect(captured.options.additionalDirectories).toEqual([
      "/abs/pkg-a",
      "/abs/pkg-b",
    ]);
    const systemMsg = captured.messages.find((m) => m.role === "system");
    expect(systemMsg.content).toContain("## Additional working directories");
    expect(systemMsg.content).toContain("/abs/pkg-a");
  });

  it("seeds MCP roots with the full workspace-root list when --add-dir is used", async () => {
    const setRoots = vi.fn();
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop({});
    deps.resolveAgentMcp = async () => ({
      mcpClient: { setRoots },
      connected: [],
    });
    await runAgentHeadless(
      {
        prompt: "look across packages",
        additionalDirectories: ["/abs/pkg-a", "/abs/pkg-b"],
      },
      deps,
    );
    expect(setRoots).toHaveBeenCalledTimes(1);
    // workspaceRootDirs resolves each root to an absolute path (drive-prefixed
    // on Windows), so match on the trailing segment rather than the raw input.
    const roots = setRoots.mock.calls[0][0];
    expect(roots).toHaveLength(3);
    expect(roots.some((r) => r.includes("pkg-a"))).toBe(true);
    expect(roots.some((r) => r.includes("pkg-b"))).toBe(true);
    // cwd is always the first advertised root.
    expect(roots[0]).toBe(process.cwd());
  });

  it("does NOT seed MCP roots without --add-dir (byte-identical)", async () => {
    const setRoots = vi.fn();
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop({});
    deps.resolveAgentMcp = async () => ({
      mcpClient: { setRoots },
      connected: [],
    });
    await runAgentHeadless({ prompt: "hi" }, deps);
    expect(setRoots).not.toHaveBeenCalled();
  });
});

describe("headless-runner — custom slash-command macros (-p parity)", () => {
  /** A fake agentLoop that records the messages + options it received. */
  function capturingLoop(captured) {
    return async function* (messages, options) {
      captured.messages = messages;
      captured.options = options;
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
  }

  const lastUser = (captured) =>
    captured.messages.filter((m) => m.role === "user").pop().content;

  const matchedMacro = (over = {}) => ({
    matched: true,
    promptText: "command body",
    warnings: [],
    name: "c",
    scope: "project",
    model: null,
    allowedTools: null,
    ...over,
  });

  it("expands a resolved /name macro into the user turn before the loop", async () => {
    const captured = {};
    const { deps, err } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = vi.fn(async (input) => {
      expect(input).toBe("/git:review HEAD");
      return {
        matched: true,
        promptText: "EXPANDED: review the staged diff for HEAD",
        warnings: [],
        name: "git:review",
        scope: "project",
      };
    });
    await runAgentHeadless({ prompt: "/git:review HEAD" }, deps);
    expect(lastUser(captured)).toBe(
      "EXPANDED: review the staged diff for HEAD",
    );
    expect(err.join("")).toContain("command: /git:review [project]");
  });

  it("skips the @file pass when a macro matched (expandCommand ran it)", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () => ({
      matched: true,
      promptText: "macro body",
      warnings: [],
      name: "c",
      scope: "personal",
    });
    deps.expandFileRefs = vi.fn(async () => ({
      prompt: "SHOULD NOT RUN",
      warnings: [],
    }));
    await runAgentHeadless({ prompt: "/c" }, deps);
    expect(deps.expandFileRefs).not.toHaveBeenCalled();
    expect(lastUser(captured)).toBe("macro body");
  });

  it("leaves an unmatched /token untouched and still runs @file expansion", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () => ({
      matched: false,
      promptText: "/etc/hosts",
      warnings: [],
    });
    deps.expandFileRefs = vi.fn(async (p) => ({
      prompt: p + " [@expanded]",
      warnings: [],
    }));
    await runAgentHeadless({ prompt: "/etc/hosts is broken" }, deps);
    expect(deps.expandFileRefs).toHaveBeenCalled();
    expect(lastUser(captured)).toBe("/etc/hosts is broken [@expanded]");
  });

  it("does not even consult the macro resolver for a non-slash prompt", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = vi.fn();
    await runAgentHeadless({ prompt: "just a question" }, deps);
    expect(deps.resolveSlashMacro).not.toHaveBeenCalled();
  });

  it("slashMacros:false disables expansion (literal /name reaches the LLM)", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = vi.fn();
    deps.expandFileRefs = async (p) => ({ prompt: p, warnings: [] });
    await runAgentHeadless({ prompt: "/git:review", slashMacros: false }, deps);
    expect(deps.resolveSlashMacro).not.toHaveBeenCalled();
    expect(lastUser(captured)).toBe("/git:review");
  });

  it("a throwing macro resolver falls back to the literal prompt (best-effort)", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () => {
      throw new Error("commands dir unreadable");
    };
    deps.expandFileRefs = async (p) => ({ prompt: p, warnings: [] });
    await runAgentHeadless({ prompt: "/broken" }, deps);
    expect(lastUser(captured)).toBe("/broken");
  });

  it("applies a command's model: frontmatter when no --model is given", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () =>
      matchedMacro({ model: "claude-opus-4-8" });
    await runAgentHeadless({ prompt: "/deploy" }, deps);
    expect(captured.options.model).toBe("claude-opus-4-8");
  });

  it("an explicit --model overrides the command's model: frontmatter", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () =>
      matchedMacro({ model: "claude-opus-4-8" });
    await runAgentHeadless({ prompt: "/deploy", model: "qwen2.5:7b" }, deps);
    expect(captured.options.model).toBe("qwen2.5:7b");
  });

  it("applies a command's allowed-tools: frontmatter when no --allowed-tools given", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () =>
      matchedMacro({ allowedTools: "read_file, search_files" });
    await runAgentHeadless({ prompt: "/audit" }, deps);
    expect(captured.options.enabledToolNames).toEqual([
      "read_file",
      "search_files",
    ]);
  });

  it("an explicit --allowed-tools overrides the command's allowed-tools: frontmatter", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () =>
      matchedMacro({ allowedTools: "read_file" });
    await runAgentHeadless(
      { prompt: "/audit", allowedTools: ["list_dir"] },
      deps,
    );
    expect(captured.options.enabledToolNames).toEqual(["list_dir"]);
  });

  it("plan mode still clamps a command's allowed-tools to the read-only set", async () => {
    const captured = {};
    const { deps } = makeDeps(replyText("x"));
    deps.agentLoop = capturingLoop(captured);
    deps.resolveSlashMacro = async () =>
      matchedMacro({ allowedTools: "read_file, run_shell" });
    await runAgentHeadless({ prompt: "/audit", permissionMode: "plan" }, deps);
    expect(captured.options.enabledToolNames).toEqual(["read_file"]); // run_shell dropped
  });
});

describe("resolveHeadlessSession — pure resolution", () => {
  it("resumes a specific id and turns persistence on", () => {
    const r = resolveHeadlessSession({ resume: "sess-A" }, {}, "fallback");
    expect(r).toMatchObject({
      sessionId: "sess-A",
      resumeId: "sess-A",
      persist: true,
    });
  });

  it("--continue (or bare --resume) resolves the most-recent id", () => {
    const store = { getLastSessionId: () => "latest-1" };
    expect(
      resolveHeadlessSession({ continueSession: true }, store, "fb"),
    ).toMatchObject({ sessionId: "latest-1", resumeId: "latest-1" });
    expect(resolveHeadlessSession({ resume: true }, store, "fb")).toMatchObject(
      { sessionId: "latest-1", resumeId: "latest-1" },
    );
  });

  it("continue with no prior session falls back, still persists", () => {
    const store = { getLastSessionId: () => null };
    const r = resolveHeadlessSession({ continueSession: true }, store, "fb-id");
    expect(r).toMatchObject({
      sessionId: "fb-id",
      resumeId: null,
      persist: true,
    });
  });

  it("a plain one-shot does not resume or persist", () => {
    const r = resolveHeadlessSession({ sessionId: "s-1" }, {}, "fb");
    expect(r).toMatchObject({
      sessionId: "s-1",
      resumeId: null,
      persist: false,
    });
  });
});

describe("applyForkSession — --fork-session", () => {
  const store = {
    sessionExists: (id) => id === "src",
    forkSession: (id) => (id === "src" ? "src-fork-1" : null),
  };

  it("forks an existing session to a new id (original preserved)", () => {
    const r = applyForkSession({ forkSession: true, sessionId: "src" }, store);
    expect(r).toEqual({
      sessionId: "src-fork-1",
      forkedFrom: "src",
      missing: false,
    });
  });

  it("reports missing when the source has no transcript", () => {
    const r = applyForkSession(
      { forkSession: true, sessionId: "ghost" },
      store,
    );
    expect(r).toEqual({ sessionId: "ghost", forkedFrom: null, missing: true });
  });

  it("is a no-op without the flag or without a session", () => {
    expect(applyForkSession({ sessionId: "src" }, store)).toEqual({
      sessionId: "src",
      forkedFrom: null,
      missing: false,
    });
    expect(applyForkSession({ forkSession: true }, store)).toEqual({
      sessionId: null,
      forkedFrom: null,
      missing: false,
    });
  });

  it("keeps the original id when the store returns no fork", () => {
    const r = applyForkSession(
      { forkSession: true, sessionId: "src" },
      { sessionExists: () => true, forkSession: () => null },
    );
    expect(r).toEqual({ sessionId: "src", forkedFrom: null, missing: false });
  });
});

describe("headless-runner — session resume + persistence", () => {
  /** A fake agentLoop that records messages, then completes with `content`. */
  function capturingLoop(captured, content = "done") {
    return async function* (messages) {
      captured.messages = messages;
      yield { type: "response-complete", content };
      yield { type: "run-ended", reason: "complete" };
    };
  }

  /** A capturing fake JSONL session store wired into deps. */
  function makeStore(seed = {}) {
    const events = { user: [], assistant: [], started: [] };
    const existing = { ...seed }; // id -> rebuilt messages array
    return {
      events,
      deps: {
        getLastSessionId: () => "latest-x",
        sessionExists: (id) =>
          Object.prototype.hasOwnProperty.call(existing, id),
        rebuildMessages: (id) => existing[id] || [],
        startSession: (id, meta) => events.started.push({ id, meta }),
        appendUserMessage: (id, c) => events.user.push({ id, content: c }),
        appendAssistantMessage: (id, c) =>
          events.assistant.push({ id, content: c }),
        appendTokenUsage: () => {},
      },
    };
  }

  it("loads prior history into the message array on resume", async () => {
    const captured = {};
    const store = makeStore({
      "sess-A": [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
      ],
    });
    const { deps } = makeDeps(replyText("second answer"));
    Object.assign(deps, store.deps);
    deps.agentLoop = capturingLoop(captured, "second answer");

    await runAgentHeadless({ prompt: "follow-up", resume: "sess-A" }, deps);

    const roles = captured.messages.map((m) => m.role);
    const contents = captured.messages.map((m) => m.content);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(contents).toContain("first question");
    expect(contents).toContain("first answer");
    expect(contents[contents.length - 1]).toBe("follow-up");
  });

  it("persists the user turn up front and the assistant turn on success", async () => {
    const store = makeStore(); // sess-NEW does not exist yet
    const { deps } = makeDeps(replyText("the answer"));
    Object.assign(deps, store.deps);

    await runAgentHeadless({ prompt: "new task", resume: "sess-NEW" }, deps);

    expect(store.events.started).toContainEqual({
      id: "sess-NEW",
      meta: expect.objectContaining({ title: "new task" }),
    });
    expect(store.events.user).toContainEqual({
      id: "sess-NEW",
      content: "new task",
    });
    expect(store.events.assistant).toContainEqual({
      id: "sess-NEW",
      content: "the answer",
    });
  });

  it("does not re-seed the header when resuming an existing session", async () => {
    const store = makeStore({ "sess-A": [] });
    const { deps } = makeDeps(replyText("ok"));
    Object.assign(deps, store.deps);

    await runAgentHeadless({ prompt: "more", resume: "sess-A" }, deps);

    expect(store.events.started).toHaveLength(0); // already exists
    expect(store.events.user).toContainEqual({
      id: "sess-A",
      content: "more",
    });
  });

  it("a plain one-shot writes nothing to the store", async () => {
    const store = makeStore();
    const { deps } = makeDeps(replyText("hi"));
    Object.assign(deps, store.deps);

    await runAgentHeadless({ prompt: "one shot" }, deps);

    expect(store.events.started).toHaveLength(0);
    expect(store.events.user).toHaveLength(0);
    expect(store.events.assistant).toHaveLength(0);
  });

  it("reports resumed_from + history_messages in the init envelope", async () => {
    const store = makeStore({
      "sess-A": [{ role: "user", content: "q" }],
    });
    const { deps, out } = makeDeps(replyText("a"));
    Object.assign(deps, store.deps);

    await runAgentHeadless(
      { prompt: "again", resume: "sess-A", outputFormat: "stream-json" },
      deps,
    );

    const init = JSON.parse(out.join("").trim().split("\n")[0]);
    expect(init).toMatchObject({
      type: "system",
      subtype: "init",
      resumed_from: "sess-A",
      history_messages: 1,
    });
  });
});

describe("headless-runner — auto mode configurable classifier", () => {
  it("wraps the approval gate only when autoMode.decisions customizes the map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-auto-mode-"));
    const settingsFile = join(dir, "settings.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({ autoMode: { decisions: { medium: "deny" } } }),
    );
    try {
      const captured = [];
      const loopSpy = async function* (_messages, loopOptions) {
        captured.push(loopOptions.approvalGate);
        yield { type: "response-complete", content: "done" };
      };

      const { deps } = makeDeps(replyText("done"));
      deps.agentLoop = loopSpy;
      await runAgentHeadless(
        { prompt: "hi", permissionMode: "auto", settingsFile },
        deps,
      );
      expect(captured[0]?.isAutoModeGate).toBe(true);

      // Configured medium → deny is enforced without any confirmer round-trip.
      const medium = await captured[0].decide({ riskLevel: "medium" });
      expect(medium).toMatchObject({
        decision: "deny",
        via: "auto-mode-config",
      });
      // high stays on the default ask tier; the headless deny-confirmer that
      // runAgentHeadless installed on the wrapper fails it closed.
      const high = await captured[0].decide({ riskLevel: "high" });
      expect(high.decision).toBe("deny");

      // Same settings file but manual mode → the raw gate is passed through.
      const second = makeDeps(replyText("done"));
      second.deps.agentLoop = loopSpy;
      await runAgentHeadless(
        { prompt: "hi", permissionMode: "manual", settingsFile },
        second.deps,
      );
      expect(captured[1]?.isAutoModeGate).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auto mode without customized decisions keeps the raw trusted gate", async () => {
    const captured = [];
    const { deps, gate } = makeDeps(replyText("done"));
    deps.agentLoop = async function* (_messages, loopOptions) {
      captured.push(loopOptions.approvalGate);
      yield { type: "response-complete", content: "done" };
    };
    const dir = mkdtempSync(join(tmpdir(), "cc-auto-mode-plain-"));
    const settingsFile = join(dir, "settings.json");
    writeFileSync(settingsFile, JSON.stringify({ autoMode: {} }));
    try {
      await runAgentHeadless(
        { prompt: "hi", permissionMode: "auto", settingsFile },
        deps,
      );
      expect(captured[0]).toBe(gate);
      expect(gate.calls.policy).toEqual([
        expect.objectContaining({ policy: "trusted" }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("headless-runner — goal-condition outer-turn re-drive", () => {
  // A fake agentLoop whose per-turn final text is scripted; records how many
  // outer turns ran and the messages it saw on the latest turn.
  function scriptedLoop(texts, seen) {
    let i = 0;
    return async function* (messages) {
      const content = texts[Math.min(i, texts.length - 1)];
      i++;
      seen.turns = i;
      seen.lastMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      yield { type: "response-complete", content };
      yield { type: "run-ended", reason: "complete" };
    };
  }

  const parseLines = (out) =>
    out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("re-drives until a deterministic `contains:` condition is met", async () => {
    const seen = {};
    const { deps, out } = makeDeps(replyText("x"));
    deps.agentLoop = scriptedLoop(["still working", "ALL GREEN — done"], seen);
    await runAgentHeadless(
      {
        prompt: "make it pass",
        outputFormat: "stream-json",
        goalCondition: "contains:ALL GREEN",
      },
      deps,
    );
    const events = parseLines(out);
    const types = events.map((e) => e.type);
    expect(seen.turns).toBe(2); // exactly one re-drive
    expect(types).toContain("goal_started");
    expect(types.filter((t) => t === "goal_evaluated")).toHaveLength(2);
    expect(types).toContain("goal_completed");
    expect(events.find((e) => e.type === "goal_completed").reason).toMatch(
      /ALL GREEN/,
    );
    // The second turn saw the injected follow-up user turn.
    const userTurns = seen.lastMessages.filter((m) => m.role === "user");
    expect(userTurns.length).toBeGreaterThanOrEqual(2);
    expect(userTurns.pop().content).toMatch(/not yet met/i);
  });

  it("stops with goal_exhausted at --max-outer-turns when never met", async () => {
    const seen = {};
    const { deps, out } = makeDeps(replyText("x"));
    deps.agentLoop = scriptedLoop(["nope"], seen);
    await runAgentHeadless(
      {
        prompt: "try",
        outputFormat: "stream-json",
        goalCondition: "contains:DONE",
        maxOuterTurns: 3,
      },
      deps,
    );
    const events = parseLines(out);
    expect(seen.turns).toBe(3);
    const ex = events.find((e) => e.type === "goal_exhausted");
    expect(ex).toBeTruthy();
    expect(ex.limit).toBe("max_outer_turns");
  });

  it("evaluates exit-zero via injected spawnSync (met → complete, one turn)", async () => {
    const seen = {};
    const { deps, out } = makeDeps(replyText("x"));
    deps.agentLoop = scriptedLoop(["built"], seen);
    deps.goalCheck = { spawnSync: () => ({ status: 0 }) };
    await runAgentHeadless(
      {
        prompt: "build it",
        outputFormat: "stream-json",
        goalCondition: "exit-zero:npm run build",
      },
      deps,
    );
    const types = parseLines(out).map((e) => e.type);
    expect(seen.turns).toBe(1); // met on the first turn, no re-drive
    expect(types).toContain("goal_completed");
  });

  it("uses an injected judge for a model-judged condition", async () => {
    const seen = {};
    const { deps, out } = makeDeps(replyText("x"));
    deps.agentLoop = scriptedLoop(["progress...", "finished"], seen);
    let calls = 0;
    deps.goalConditionJudge = async (_cond, t) => {
      calls++;
      return { met: /finished/.test(t.finalText), reason: `judge#${calls}` };
    };
    await runAgentHeadless(
      {
        prompt: "do",
        outputFormat: "stream-json",
        goalCondition: "model:the work is finished",
      },
      deps,
    );
    const types = parseLines(out).map((e) => e.type);
    expect(seen.turns).toBe(2);
    expect(calls).toBe(2);
    expect(types).toContain("goal_completed");
  });

  it("is inert when --goal-condition is unset (single turn, no goal_* events)", async () => {
    const seen = {};
    const { deps, out } = makeDeps(replyText("x"));
    deps.agentLoop = scriptedLoop(["done"], seen);
    await runAgentHeadless({ prompt: "hi", outputFormat: "stream-json" }, deps);
    const types = parseLines(out).map((e) => e.type);
    expect(seen.turns).toBe(1);
    expect(types.some((t) => t.startsWith("goal_"))).toBe(false);
  });
});

describe("headless-runner — goal-condition cross-process resume", () => {
  function scriptedLoop(texts) {
    let i = 0;
    return async function* () {
      const content = texts[Math.min(i, texts.length - 1)];
      i++;
      yield { type: "response-complete", content };
      yield { type: "run-ended", reason: "complete" };
    };
  }

  // A fake JSONL store with a chain-free event log: appendEvent pushes, and
  // readEvents replays. Captures goal_snapshot payloads per session id.
  function makeGoalStore(seed = {}) {
    const log = {}; // id -> raw event array (shape readEvents returns)
    for (const [id, evs] of Object.entries(seed)) log[id] = [...evs];
    const snapshots = {}; // id -> list of goal_snapshot `data`
    return {
      log,
      snapshots,
      deps: {
        getLastSessionId: () => null,
        sessionExists: (id) => Object.prototype.hasOwnProperty.call(log, id),
        rebuildMessages: () => [],
        startSession: (id) => {
          if (!log[id]) log[id] = [];
        },
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendTokenUsage: () => {},
        appendEvent: (id, type, data) => {
          (log[id] = log[id] || []).push({ type, timestamp: 0, data });
          if (type === "goal_snapshot")
            (snapshots[id] = snapshots[id] || []).push(data);
        },
        readEvents: (id) => log[id] || [],
      },
    };
  }

  // Build a prior-process goal_snapshot event exactly as readEvents returns it.
  function seedSnapshot({ outerTurns, done }) {
    const e = new GoalConditionEngine({
      condition: "contains:DONE",
      budget: { maxOuterTurns: 5 },
      now: () => 500,
    });
    e.state = {
      ...e.state,
      outerTurns,
      tokens: 100,
      done,
      outcome: done ? "completed" : null,
    };
    return { type: "goal_snapshot", timestamp: 0, data: e.snapshot() };
  }

  const parseLines = (out) =>
    out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("persists goal_snapshot events, the last one marking done", async () => {
    const store = makeGoalStore();
    const { deps, out } = makeDeps(replyText("x"));
    Object.assign(deps, store.deps);
    deps.agentLoop = scriptedLoop(["still working", "DONE"]);

    await runAgentHeadless(
      {
        prompt: "make it pass",
        outputFormat: "stream-json",
        goalCondition: "contains:DONE",
        sessionId: "sess-G",
        persistSession: true,
      },
      deps,
    );

    const snaps = store.snapshots["sess-G"] || [];
    expect(snaps.length).toBeGreaterThanOrEqual(2); // opening + per-evaluate
    expect(snaps[0].state.done).toBe(false); // starting checkpoint
    expect(snaps[snaps.length - 1].state.done).toBe(true);
    expect(snaps[snaps.length - 1].state.outcome).toBe("completed");
    const started = parseLines(out).find((e) => e.type === "goal_started");
    expect(started.resumed).toBe(false); // a fresh (non-resumed) run
  });

  it("resumes an UNFINISHED goal — continues outerTurns across the process", async () => {
    const store = makeGoalStore({
      "sess-R": [seedSnapshot({ outerTurns: 2, done: false })],
    });
    const { deps, out } = makeDeps(replyText("x"));
    Object.assign(deps, store.deps);
    deps.agentLoop = scriptedLoop(["DONE"]); // met on the first turn this process

    await runAgentHeadless(
      {
        prompt: "keep going",
        outputFormat: "stream-json",
        goalCondition: "contains:DONE",
        resume: "sess-R",
      },
      deps,
    );

    const started = parseLines(out).find((e) => e.type === "goal_started");
    expect(started.resumed).toBe(true); // restored from the prior process
    const snaps = store.snapshots["sess-R"] || [];
    const last = snaps[snaps.length - 1];
    // 2 restored outer turns + 1 evaluate this process → 3, and done.
    expect(last.state.outerTurns).toBe(3);
    expect(last.state.done).toBe(true);
    // startedAtMs is carried over so elapsed time keeps counting.
    expect(last.state.startedAtMs).toBe(500);
  });

  it("ignores a FINISHED snapshot — starts a fresh goal cycle", async () => {
    const store = makeGoalStore({
      "sess-D": [seedSnapshot({ outerTurns: 4, done: true })],
    });
    const { deps, out } = makeDeps(replyText("x"));
    Object.assign(deps, store.deps);
    deps.agentLoop = scriptedLoop(["DONE"]);

    await runAgentHeadless(
      {
        prompt: "new cycle",
        outputFormat: "stream-json",
        goalCondition: "contains:DONE",
        resume: "sess-D",
      },
      deps,
    );

    const started = parseLines(out).find((e) => e.type === "goal_started");
    expect(started.resumed).toBe(false); // done snapshot ignored
    const last = (store.snapshots["sess-D"] || []).slice(-1)[0];
    expect(last.state.outerTurns).toBe(1); // fresh count, not continued from 4
  });
});

describe("headless-runner — background phase reporter wiring", () => {
  // The P0 state-machine producer: when this run is a background agent's turn
  // child, the human-blocking confirmers must surface their pending window as
  // phase waiting_permission + pendingApprovals in the background state.
  it("wraps the remote-control confirmer so its pending window hits the state file", async () => {
    const { createBackgroundPhaseReporter } =
      await import("../../src/lib/background-phase-reporter.js");
    const confirmers = [];
    const gate = {
      setSessionPolicy: () => {},
      setConfirmer: (fn) => confirmers.push(fn),
      decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
    };
    const { deps } = makeDeps(replyText("done"), gate);

    const states = new Map([["bg-9", { id: "bg-9", status: "running" }]]);
    deps.backgroundPhaseReporter = createBackgroundPhaseReporter({
      agentId: "bg-9",
      readState: (id) => states.get(id) || null,
      writeState: (s) => states.set(s.id, s),
    });

    let settle;
    const humanDecision = new Promise((resolve) => {
      settle = resolve;
    });
    deps.startHeadlessRemoteApproval = async () => ({
      confirmer: async () => {
        await humanDecision;
        return true;
      },
      close: async () => {},
    });

    const r = await runAgentHeadless(
      { prompt: "hi", remoteControl: true },
      deps,
    );
    expect(r.exitCode).toBe(0);

    // The LAST installed confirmer is the wrapped remote one (permission-mode
    // confirmer is installed first, remote-control overrides it).
    const wrapped = confirmers[confirmers.length - 1];
    expect(typeof wrapped).toBe("function");

    const pendingVerdict = wrapped({ tool: "run_shell" });
    // begin ran synchronously before the confirmer's first await…
    expect(states.get("bg-9")).toMatchObject({
      phase: "waiting_permission",
      pendingApprovals: 1,
    });

    settle(true);
    await expect(pendingVerdict).resolves.toBe(true);
    // …and settling restored the live-turn phase.
    expect(states.get("bg-9")).toMatchObject({
      phase: "turn",
      pendingApprovals: 0,
    });
  });

  it("foreground runs (no CC_BACKGROUND_AGENT_ID) keep the confirmer object identity", async () => {
    const { createBackgroundPhaseReporter } =
      await import("../../src/lib/background-phase-reporter.js");
    const confirmers = [];
    const gate = {
      setSessionPolicy: () => {},
      setConfirmer: (fn) => confirmers.push(fn),
      decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
    };
    const { deps } = makeDeps(replyText("done"), gate);
    deps.backgroundPhaseReporter = createBackgroundPhaseReporter({
      agentId: null,
      readState: () => null,
      writeState: () => {},
    });

    const remoteConfirmer = async () => true;
    deps.startHeadlessRemoteApproval = async () => ({
      confirmer: remoteConfirmer,
      close: async () => {},
    });

    await runAgentHeadless({ prompt: "hi", remoteControl: true }, deps);
    // Disabled reporter → wrapConfirmer returned the SAME function object.
    expect(confirmers[confirmers.length - 1]).toBe(remoteConfirmer);
  });
});
