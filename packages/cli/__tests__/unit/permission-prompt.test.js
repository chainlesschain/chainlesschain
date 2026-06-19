/**
 * permission-prompt — REPL interactive permission prompt header builder.
 * Regression: a rule-less guard (destructive-git / sensitive-file, which pass
 * `reason` not `rule`) used to render a literal "null" in the prompt.
 */
import { describe, it, expect } from "vitest";
import { buildPermissionPrompt } from "../../src/repl/permission-prompt.js";

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
