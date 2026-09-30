/**
 * Unattended-action policy (P1-8 "默认禁止无人值守发布、合并或修改共享基础设施" —
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure fail-closed
 * decision: no fs / clock / RNG.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_CLASS,
  normalizeActionClass,
  classifyActionRisk,
  evaluateUnattendedAction,
  unattendedDisallowedTools,
  classifyShellAction,
  evaluateUnattendedShellAction,
  evaluateUnattendedGitAction,
  captureUnattendedActionPolicy,
} from "../../src/lib/unattended-action-policy.js";

describe("shell action classification", () => {
  it.each([
    "proprietary-sync --prod && git status",
    "npm publish && proprietary-sync && git status",
    "git status & npm publish",
    "echo $(npm publish) > result",
    "echo <(npm publish) > result",
    "echo local > >(npm publish)",
    "echo `npm publish` > result",
    "find . -exec npm publish ;",
    "rg --pre proprietary-sync .",
    "git status-publish",
    "git log-publish",
    "git commit-publish",
    "git fetch --upload-pack='npm publish' .",
    "git fetch '--upload-pack=npm publish' .",
    'git fetch "--upload-pack=npm publish" .',
    'git fetch --u""pload-pack=executor .',
    "git fetch 'ext::executor' feature",
    "find . '-exec' executor ';'",
    'rg "--pre" executor .',
    "git fetch --up=executor .",
    "git push --receive-pack=executor origin feature",
    "git push --exec=executor origin feature",
    "git fetch ext::executor feature",
    "git merge --strategy=executor feature",
    "npm test-publish",
    "npm run build-publish",
    "ls-publish",
  ])("does not hide unauthorized effects in %s", (command) => {
    expect(evaluateUnattendedShellAction(command).allow).toBe(false);
  });

  it("requires each compound action class, regardless of risk ordering", () => {
    expect(
      evaluateUnattendedShellAction("npm publish && terraform apply", {
        allowlist: ["infra_mutation"],
      }),
    ).toMatchObject({ allow: false, actionClass: "publish" });
    expect(
      evaluateUnattendedShellAction("npm publish && terraform apply", {
        allowlist: ["publish", "infra_mutation"],
      }),
    ).toMatchObject({ allow: true });
    expect(classifyShellAction("proprietary-sync && git status")).toBeNull();
  });

  it.each([
    ["origin", "main"],
    ["origin", "HEAD:main"],
    ["origin", "refs/heads/main"],
    ["origin", ":main"],
    ["origin", "feature", "HEAD:production"],
    ["--mirror", "origin"],
    ["--all", "origin"],
    ["origin"],
    [],
    ["origin", "HEAD"],
  ])("requires merge authorization for push argv %j", (...args) => {
    // it.each spreads each row into the test function.
    const argv = ["push", ...args];
    expect(evaluateUnattendedGitAction(argv)).toMatchObject({ allow: false });
    expect(
      evaluateUnattendedGitAction(argv, { allowlist: ["merge"] }).allow,
    ).toBe(true);
    expect(evaluateUnattendedShellAction(`git ${argv.join(" ")}`).allow).toBe(
      false,
    );
  });

  it("preserves explicit feature pushes and local git operations", () => {
    for (const argv of [
      ["push", "origin", "HEAD:feature/task"],
      ["push", "-u", "origin", "feature/task"],
      ["status", "--short"],
      ["add", "file.txt"],
      ["commit", "-m", "local change"],
    ])
      expect(evaluateUnattendedGitAction(argv).allow).toBe(true);
  });

  it.each([
    ["fetch", "--upload-pack=npm publish", "."],
    ["fetch", "--upload-pack", "npm publish", "."],
    ["fetch", "--up=executor", "."],
    ["push", "--receive-pack=executor", "origin", "feature"],
    ["push", "--exec=executor", "origin", "feature"],
    ["fetch", "ext::executor", "feature"],
    ["merge", "--strategy=executor", "feature"],
    ["rebase", "--exec=executor", "feature"],
  ])("does not authorize an explicit Git executor in %j", (...argv) => {
    expect(
      evaluateUnattendedGitAction(argv, {
        allowlist: Object.values(ACTION_CLASS),
      }),
    ).toMatchObject({ allow: false, reason: "unknown-action-unattended" });
  });
  it("classifies high-risk shell commands and compound commands", () => {
    expect(classifyShellAction("git push origin feature")).toBe(
      ACTION_CLASS.PUSH,
    );
    expect(classifyShellAction("npm test && git push origin main")).toBe(
      ACTION_CLASS.PUSH,
    );
    expect(classifyShellAction("terraform apply -auto-approve")).toBe(
      ACTION_CLASS.INFRA_MUTATION,
    );
  });

  it("fails closed for unknown unattended shell commands", () => {
    expect(
      evaluateUnattendedShellAction("proprietary-sync --prod", {
        unattended: true,
        trigger: { trusted: true },
      }),
    ).toMatchObject({ allow: false, reason: "unknown-action-unattended" });
    expect(
      evaluateUnattendedShellAction("git push origin main", {
        unattended: true,
      }),
    ).toMatchObject({ allow: false, reason: "requires-attendance" });
  });
});

describe("startup policy snapshot", () => {
  it("copies and deeply freezes allowlist and trigger", () => {
    const input = {
      unattended: true,
      allowlist: [],
      trigger: { trusted: false },
    };
    const policy = captureUnattendedActionPolicy(input);
    input.allowlist.push("publish");
    input.trigger.trusted = true;
    input.unattended = false;
    expect(policy).toEqual({
      unattended: true,
      allowlist: [],
      trigger: { trusted: false },
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowlist)).toBe(true);
    expect(Object.isFrozen(policy.trigger)).toBe(true);
  });

  it.each([
    { unattended: "true" },
    { unattended: true, allowlist: "publish" },
    { unattended: true, allowlist: [null] },
    { unattended: true, trigger: { trusted: "true" } },
    { unattended: true, trigger: null },
  ])("rejects malformed authority %j", (policy) => {
    expect(() => captureUnattendedActionPolicy(policy)).toThrow(
      "policy is invalid",
    );
  });
});

describe("normalizeActionClass / classifyActionRisk", () => {
  it("maps aliases and tiers", () => {
    expect(normalizeActionClass("release")).toBe(ACTION_CLASS.PUBLISH);
    expect(normalizeActionClass("rollout")).toBe(ACTION_CLASS.DEPLOY);
    expect(normalizeActionClass("weird")).toBeNull();
    expect(classifyActionRisk("read")).toBe("low");
    expect(classifyActionRisk("merge")).toBe("high");
    expect(classifyActionRisk("push")).toBe("conditional");
    expect(classifyActionRisk("weird")).toBe("unknown");
  });
});

describe("evaluateUnattendedAction — attended", () => {
  it("lets a watching human do anything within budget", () => {
    for (const a of Object.values(ACTION_CLASS)) {
      expect(
        evaluateUnattendedAction({ actionClass: a, attended: true }).allow,
      ).toBe(true);
    }
  });
  it("still blocks everything when the budget is exhausted", () => {
    expect(
      evaluateUnattendedAction({
        actionClass: "read",
        attended: true,
        budgetExhausted: true,
      }),
    ).toEqual({ allow: false, reason: "budget-exhausted" });
  });
});

describe("evaluateUnattendedAction — unattended low risk", () => {
  it("allows read / local write / commit", () => {
    for (const a of ["read", "local_write", "commit"]) {
      expect(
        evaluateUnattendedAction({ actionClass: a, attended: false }).allow,
      ).toBe(true);
    }
  });
  it("allows a plain push to an unprotected branch", () => {
    expect(
      evaluateUnattendedAction({ actionClass: "push", attended: false }).reason,
    ).toBe("push-unprotected");
  });
});

describe("evaluateUnattendedAction — unattended high risk is denied by default", () => {
  it("denies publish / merge / deploy / infra / external message with no allowlist", () => {
    for (const a of [
      "publish",
      "merge",
      "deploy",
      "infra_mutation",
      "external_message",
    ]) {
      const d = evaluateUnattendedAction({ actionClass: a, attended: false });
      expect(d.allow).toBe(false);
      expect(d.reason).toBe("requires-attendance");
    }
  });

  it("treats a push to a PROTECTED branch as a merge (denied)", () => {
    const d = evaluateUnattendedAction({
      actionClass: "push",
      attended: false,
      protectedBranch: true,
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("requires-attendance");
  });

  it("allows a high-risk action only when explicitly allowlisted", () => {
    const d = evaluateUnattendedAction({
      actionClass: "publish",
      attended: false,
      allowlist: ["publish"],
    });
    expect(d).toEqual({ allow: true, reason: "allowlisted" });
  });

  it("refuses an untrusted trigger even if the action is allowlisted", () => {
    const d = evaluateUnattendedAction({
      actionClass: "deploy",
      attended: false,
      allowlist: ["deploy"],
      trigger: { trusted: false },
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("untrusted-trigger");
  });
});

describe("evaluateUnattendedAction — fail closed on unknown", () => {
  it("denies an unrecognized action on an unattended run", () => {
    expect(
      evaluateUnattendedAction({ actionClass: "frobnicate", attended: false }),
    ).toEqual({ allow: false, reason: "unknown-action-unattended" });
  });
  it("lets a human vet an unrecognized action", () => {
    expect(
      evaluateUnattendedAction({ actionClass: "frobnicate", attended: true })
        .allow,
    ).toBe(true);
  });
});

describe("unattendedDisallowedTools (P1-8 tool-layer projection)", () => {
  it("denies both high-risk external tools by default (unattended)", () => {
    expect(unattendedDisallowedTools({ attended: false })).toEqual([
      "notify",
      "publish_artifact",
    ]);
  });

  it("removes an allowlisted class from the deny set", () => {
    // external_message allowlisted → notify permitted, publish still denied.
    expect(
      unattendedDisallowedTools({
        attended: false,
        allowlist: ["external_message"],
      }),
    ).toEqual(["publish_artifact"]);
    expect(
      unattendedDisallowedTools({
        attended: false,
        allowlist: ["publish", "external_message"],
      }),
    ).toEqual([]);
  });

  it("attended runs restrict nothing", () => {
    expect(unattendedDisallowedTools({ attended: true })).toEqual([]);
  });

  it("an untrusted trigger denies high-risk tools even if allowlisted", () => {
    expect(
      unattendedDisallowedTools({
        attended: false,
        allowlist: ["publish", "external_message"],
        trigger: { trusted: false },
      }),
    ).toEqual(["notify", "publish_artifact"]);
  });

  it("an exhausted budget denies everything", () => {
    expect(
      unattendedDisallowedTools({
        attended: true,
        budgetExhausted: true,
      }),
    ).toEqual(["notify", "publish_artifact"]);
  });
});
