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
} from "../../src/repl/permission-prompt.js";

describe("buildPermissionPrompt", () => {
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
    expect(h).toBe("[Permission] sensitive file: shell startup file");
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
