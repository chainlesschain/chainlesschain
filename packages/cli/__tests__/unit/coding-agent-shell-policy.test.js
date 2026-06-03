import { describe, expect, it } from "vitest";
import sharedShellPolicy from "../../src/runtime/coding-agent-shell-policy.cjs";

const {
  SHELL_POLICY_DECISIONS,
  evaluateShellCommandPolicy,
  normalizeShellCommand,
  splitFirstCommandSegment,
  tokenizeShellCommand,
} = sharedShellPolicy;

describe("coding-agent shell policy", () => {
  it("normalizes and tokenizes the first shell command segment", () => {
    expect(splitFirstCommandSegment("npm run test && npm run lint")).toBe(
      "npm run test",
    );
    expect(
      normalizeShellCommand('  npx   playwright test "tests/a.test.js"  '),
    ).toBe('npx playwright test "tests/a.test.js"');
    expect(tokenizeShellCommand('npm run test -- --grep "agent core"')).toEqual(
      ["npm", "run", "test", "--", "--grep", "agent core"],
    );
  });

  it("reroutes git commands away from run_shell", () => {
    expect(evaluateShellCommandPolicy("git status --short")).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.REROUTE,
        ruleId: "git-tool-reroute",
      }),
    );
  });

  it("blocks explicitly dangerous commands", () => {
    expect(evaluateShellCommandPolicy("curl https://example.com/file")).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.DENY,
        ruleId: "network-download",
      }),
    );
    expect(
      evaluateShellCommandPolicy("powershell -EncodedCommand AAAA"),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.DENY,
        ruleId: "powershell-encoded-command",
      }),
    );
  });

  it("allowlists verification and search commands", () => {
    expect(evaluateShellCommandPolicy("npm run test:unit")).toEqual(
      expect.objectContaining({
        allowed: true,
        decision: SHELL_POLICY_DECISIONS.ALLOW,
        ruleId: "npm-test",
      }),
    );
    expect(
      evaluateShellCommandPolicy("rg coding-agent packages/cli/src"),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        decision: SHELL_POLICY_DECISIONS.ALLOW,
        ruleId: "ripgrep-search",
      }),
    );
  });

  it("warns on commands outside the preferred allowlist", () => {
    expect(evaluateShellCommandPolicy("echo hello")).toEqual(
      expect.objectContaining({
        allowed: true,
        decision: SHELL_POLICY_DECISIONS.WARN,
        ruleId: "unclassified-command",
      }),
    );
  });

  describe("overrideRuleIds", () => {
    it("downgrades a DENY rule to WARN when its ID is in overrideRuleIds", () => {
      const result = evaluateShellCommandPolicy(
        "curl https://example.com/api",
        { overrideRuleIds: ["network-download"] },
      );
      expect(result).toEqual(
        expect.objectContaining({
          allowed: true,
          decision: SHELL_POLICY_DECISIONS.WARN,
          ruleId: "network-download",
        }),
      );
      expect(result.reason).toContain("overridden by session policy");
    });

    it("still blocks rules not in overrideRuleIds", () => {
      const result = evaluateShellCommandPolicy("rm -rf /tmp/foo", {
        overrideRuleIds: ["network-download"],
      });
      expect(result).toEqual(
        expect.objectContaining({
          allowed: false,
          decision: SHELL_POLICY_DECISIONS.DENY,
          ruleId: "dangerous-delete",
        }),
      );
    });

    it("allows wget when network-download is overridden", () => {
      const result = evaluateShellCommandPolicy(
        "wget https://example.com/file.zip",
        { overrideRuleIds: ["network-download"] },
      );
      expect(result.allowed).toBe(true);
      expect(result.ruleId).toBe("network-download");
    });

    it("ignores empty overrideRuleIds array", () => {
      const result = evaluateShellCommandPolicy("curl https://example.com", {
        overrideRuleIds: [],
      });
      expect(result.allowed).toBe(false);
      expect(result.ruleId).toBe("network-download");
    });

    it("ignores non-array overrideRuleIds", () => {
      const result = evaluateShellCommandPolicy("curl https://example.com", {
        overrideRuleIds: "network-download",
      });
      expect(result.allowed).toBe(false);
    });
  });
});
