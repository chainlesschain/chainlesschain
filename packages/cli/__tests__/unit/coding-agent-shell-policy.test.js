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

  it("reroutes benign git commands away from run_shell", () => {
    expect(evaluateShellCommandPolicy("git status --short")).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.REROUTE,
        ruleId: "git-tool-reroute",
      }),
    );
  });

  // Regression: the dangerous-git-* DENY rules must outrank `git-tool-reroute`.
  // When reroute was ordered first they were dead code (find() returned reroute
  // for every git command), so `git reset --hard` only rerouted.
  it("DENIES destructive git commands on the run_shell path (not just reroute)", () => {
    expect(evaluateShellCommandPolicy("git reset --hard HEAD~1")).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.DENY,
        ruleId: "dangerous-git-reset",
      }),
    );
    expect(evaluateShellCommandPolicy("git clean -fd")).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.DENY,
        ruleId: "dangerous-git-clean",
      }),
    );
    expect(evaluateShellCommandPolicy("git checkout -- src/index.js")).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: SHELL_POLICY_DECISIONS.DENY,
        ruleId: "dangerous-git-checkout-discard",
      }),
    );
    // …and a destructive git segment smuggled after a benign one is still caught.
    expect(
      evaluateShellCommandPolicy("git status && git reset --hard"),
    ).toEqual(
      expect.objectContaining({
        decision: SHELL_POLICY_DECISIONS.DENY,
        ruleId: "dangerous-git-reset",
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

  describe("IaC destroy (terraform/pulumi/cdk/terragrunt)", () => {
    it("blocks destroy subcommands", () => {
      for (const cmd of [
        "terraform destroy",
        "terraform destroy -auto-approve",
        "pulumi destroy --yes",
        "cdk destroy --all",
        "terragrunt destroy",
        "cdklocal destroy MyStack",
      ]) {
        expect(evaluateShellCommandPolicy(cmd), cmd).toEqual(
          expect.objectContaining({
            allowed: false,
            decision: SHELL_POLICY_DECISIONS.DENY,
            ruleId: "iac-destroy",
          }),
        );
      }
    });

    it("blocks the `terraform apply -destroy` flag variant", () => {
      expect(
        evaluateShellCommandPolicy("terraform apply -destroy -auto-approve"),
      ).toEqual(
        expect.objectContaining({
          allowed: false,
          decision: SHELL_POLICY_DECISIONS.DENY,
          ruleId: "iac-destroy",
        }),
      );
    });

    it("does NOT block non-destroy IaC commands (plan/apply/preview)", () => {
      for (const cmd of [
        "terraform plan",
        "terraform apply -auto-approve",
        "pulumi preview",
        "cdk synth",
      ]) {
        const r = evaluateShellCommandPolicy(cmd);
        expect(r.allowed, cmd).toBe(true);
        expect(r.ruleId, cmd).toBe("unclassified-command");
      }
    });

    it("is overridable when explicitly requested", () => {
      const r = evaluateShellCommandPolicy("terraform destroy -auto-approve", {
        overrideRuleIds: ["iac-destroy"],
      });
      expect(r.allowed).toBe(true);
      expect(r.decision).toBe(SHELL_POLICY_DECISIONS.WARN);
      expect(r.reason).toContain("overridden by session policy");
    });

    it("catches an IaC destroy smuggled into a compound command", () => {
      const r = evaluateShellCommandPolicy(
        "echo deploying && terraform destroy -auto-approve",
      );
      expect(r.allowed).toBe(false);
      expect(r.ruleId).toBe("iac-destroy");
    });
  });

  describe("compound commands (every segment is inspected)", () => {
    it("blocks a dangerous command smuggled after && / ; / | behind a benign segment", () => {
      for (const cmd of [
        "echo hi && git reset --hard HEAD~3",
        "true && git clean -fd",
        "ls | rm -rf node_modules",
        "cd src; rm -rf build",
        "npm run build && git checkout -- .",
      ]) {
        const r = evaluateShellCommandPolicy(cmd);
        expect(r.allowed, cmd).toBe(false);
      }
    });

    it("does NOT auto-allow a compound just because the first segment is allowlisted", () => {
      const r = evaluateShellCommandPolicy(
        "npm run build && git checkout -- .",
      );
      expect(r.allowed).toBe(false);
      // The trailing `git checkout -- .` is a discard → DENY (severity 3) now
      // outranks the leading allowlisted build. Previously this was REROUTE only
      // because the dangerous-git-checkout-discard DENY rule was unreachable.
      expect(r.decision).toBe(SHELL_POLICY_DECISIONS.DENY);
      expect(r.ruleId).toBe("dangerous-git-checkout-discard");
    });

    it("still ALLOWs a compound where every segment is independently allowlisted", () => {
      const r = evaluateShellCommandPolicy(
        "npm run build && npm run test:unit",
      );
      expect(r.allowed).toBe(true);
      expect(r.decision).toBe(SHELL_POLICY_DECISIONS.ALLOW);
    });

    it("the most restrictive segment decides (DENY beats a trailing WARN)", () => {
      const r = evaluateShellCommandPolicy("rm -rf foo && echo done");
      expect(r.decision).toBe(SHELL_POLICY_DECISIONS.DENY);
      expect(r.ruleId).toBe("dangerous-delete");
    });

    it("splitCommandSegments returns every non-empty segment", () => {
      expect(
        sharedShellPolicy.splitCommandSegments("a && b || c | d ; e"),
      ).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("blocks a dangerous command hidden by newline / & / subshell / substitution / env-prefix", () => {
      for (const cmd of [
        "echo hi\nrm -rf foo", // newline
        "echo a && echo b\ngit reset --hard", // newline after &&
        "echo done & rm -rf node_modules", // single & (background)
        "( rm -rf foo )", // subshell
        "foo=$(rm -rf bar)", // command substitution
        "echo `rm -rf baz`", // backticks
        "x=1 rm -rf foo", // env-var assignment prefix
      ]) {
        const r = evaluateShellCommandPolicy(cmd);
        expect(r.allowed, cmd).toBe(false);
      }
    });

    it("an env-var prefix does not hide an allowlisted command", () => {
      const r = evaluateShellCommandPolicy("CI=true npm run test:unit");
      expect(r.allowed).toBe(true);
      expect(r.ruleId).toBe("npm-test");
    });
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
