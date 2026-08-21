/**
 * permission-prompt — REPL interactive permission prompt header builder.
 * Regression: a rule-less guard (destructive-git / sensitive-file, which pass
 * `reason` not `rule`) used to render a literal "null" in the prompt.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildPermissionPrompt,
  resolveAskIdleTimeoutMs,
  questionWithIdleTimeout,
  visualizePermissionText,
} from "../../src/repl/permission-prompt.js";
import { normalizePermissionRequest } from "../../src/lib/permission-request.js";
import { classifyAutoModeSafety } from "../../src/lib/auto-mode-safety-classifier.js";

describe("buildPermissionPrompt", () => {
  it("makes tabs and invisible Unicode explicit without changing the executed arguments", () => {
    const command = "git<TAB>push\u202E origin".replace("<TAB>", "\t");
    expect(
      buildPermissionPrompt({ tool: "run_shell", args: { command } }),
    ).toBe("[Permission] confirm run_shell: git<TAB>push<U+202E> origin");
    expect(command).toContain("\t");
    expect(visualizePermissionText("a\u200Bb\nnext")).toBe(
      "a<U+200B>b<LF>next",
    );
  });

  it("keeps the complete source and destination visible in the grant", () => {
    expect(
      buildPermissionPrompt({
        tool: "move_file",
        args: { path: "src/a.txt", destination: "release/a.txt" },
        reason: "workspace mutation",
      }),
    ).toBe("[Permission] workspace mutation: src/a.txt -> release/a.txt");
  });

  it("redacts JWT and AWS credentials while preserving the complete approval target", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const aws = "AKIAIOSFODNN7EXAMPLE";
    const prompt = buildPermissionPrompt({
      tool: "move_file",
      args: {
        path: `src/宽字符📦-${jwt}.txt`,
        destination: `release/完整目标-${aws}.txt`,
      },
      reason: "workspace mutation",
    });

    expect(prompt).toContain("src/宽字符📦-");
    expect(prompt).toContain("release/完整目标-");
    expect(prompt).not.toContain(jwt);
    expect(prompt).not.toContain(aws);
    expect(prompt.match(/\[REDACTED\]/gu)).toHaveLength(2);
  });

  it("uses the same normalized command for safety classification and approval preview", () => {
    const request = {
      tool: "run_shell",
      args: { argv: ["zsh", "-c", "[[ -n x ]] && rm -rf /tmp/outside"] },
    };
    const normalized = normalizePermissionRequest(request);
    const preview = buildPermissionPrompt(request);
    const fromArgv = classifyAutoModeSafety(request);
    const fromCommand = classifyAutoModeSafety({
      tool: request.tool,
      args: { command: normalized.command },
    });

    expect(preview).toContain(normalized.command);
    expect(fromArgv.reasonCodes).toEqual(fromCommand.reasonCodes);
  });

  it("uses the rule name for settings/hook ask rules", () => {
    const h = buildPermissionPrompt({
      tool: "run_shell",
      args: { command: "npm run deploy" },
      rule: "Bash",
    });
    expect(h).toBe(
      '[Permission] rule "Bash" asks before run_shell: npm run deploy',
    );
  });

  it("uses the reason for the destructive-git guard (no rule)", () => {
    const h = buildPermissionPrompt({
      tool: "git",
      args: { command: "reset --hard" },
      rule: null,
      reason: "destructive git command: git reset --hard",
    });
    expect(h).toBe("[Permission] destructive git command: git reset --hard");
    expect(h).not.toContain("null");
  });

  it("uses the reason for the sensitive-file guard (no rule)", () => {
    const h = buildPermissionPrompt({
      tool: "write_file",
      args: { path: "~/.bashrc" },
      reason: "sensitive file: shell startup file",
    });
    expect(h).toBe(
      "[Permission] sensitive file: shell startup file: ~/.bashrc",
    );
    expect(h).not.toContain("null");
  });

  it("falls back to a generic header when neither rule nor reason is given", () => {
    expect(
      buildPermissionPrompt({ tool: "git", args: { command: "clean -fd" } }),
    ).toBe("[Permission] confirm git: clean -fd");
    expect(buildPermissionPrompt({ tool: "edit_file" })).toBe(
      "[Permission] confirm edit_file:",
    );
  });

  it("never renders the literal 'null' regardless of inputs", () => {
    for (const opts of [
      { tool: "git", args: { command: "rebase main" }, rule: null },
      { tool: "git", reason: "x" },
      { tool: "git" },
      {},
    ]) {
      expect(buildPermissionPrompt(opts)).not.toContain("null");
    }
  });
});

describe("resolveAskIdleTimeoutMs", () => {
  it("defaults to 0 (disabled) with no env and no config", () => {
    expect(resolveAskIdleTimeoutMs({ env: "" })).toBe(0);
    expect(resolveAskIdleTimeoutMs({ env: "", config: undefined })).toBe(0);
  });

  it("reads the config value when env is unset", () => {
    expect(resolveAskIdleTimeoutMs({ env: "", config: 30000 })).toBe(30000);
    expect(resolveAskIdleTimeoutMs({ env: "", config: "45000" })).toBe(45000);
  });

  it("env takes precedence over config", () => {
    expect(resolveAskIdleTimeoutMs({ env: "60000", config: 30000 })).toBe(
      60000,
    );
    // env "0" explicitly disables even with a config value set
    expect(resolveAskIdleTimeoutMs({ env: "0", config: 30000 })).toBe(0);
  });

  it("rejects non-finite / non-positive values (disabled)", () => {
    for (const bad of [NaN, -5, 0, "abc", Infinity, null, true]) {
      expect(resolveAskIdleTimeoutMs({ env: "", config: bad })).toBe(0);
    }
  });
});

describe("questionWithIdleTimeout", () => {
  it("returns the answer with no timeout configured (0 = plain await)", async () => {
    const ask = vi.fn(async () => "y");
    const res = await questionWithIdleTimeout(ask, "Proceed?", 0);
    expect(res).toEqual({ answer: "y", timedOut: false });
    expect(ask).toHaveBeenCalledWith("Proceed?");
  });

  it("returns the answer when it arrives before the timeout", async () => {
    const ask = async () => "yes";
    const res = await questionWithIdleTimeout(ask, "Proceed?", 5000);
    expect(res).toEqual({ answer: "yes", timedOut: false });
  });

  it("times out and reports timedOut when the answer never arrives", async () => {
    const ask = () => new Promise(() => {}); // never resolves (user walked away)
    const res = await questionWithIdleTimeout(ask, "Proceed?", 20);
    expect(res).toEqual({ answer: null, timedOut: true });
  });

  it("clears the timer once answered (no stray timeout keeps the loop alive)", async () => {
    vi.useFakeTimers();
    try {
      const res = await questionWithIdleTimeout(async () => "n", "P?", 60000);
      expect(res.timedOut).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
