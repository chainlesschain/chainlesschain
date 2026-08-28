import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_PROCESS_POLICIES,
  createBundledSkillProcessBroker,
  requireBundledSkillProcessBroker,
} = require("../bundled-skill-process-broker.js");

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-process-broker-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function createBroker(skillId, overrides = {}) {
  const root = overrides.root || temporaryDirectory();
  const executeFileSync = overrides.executeFileSync || vi.fn(() => "ok");
  const auditSink = overrides.auditSink || vi.fn();
  const broker = createBundledSkillProcessBroker(
    {
      skillId,
      authorityId: `approval:${skillId}`,
      allowedRoots: [root],
      allowedEntrypoints: overrides.allowedEntrypoints || [],
    },
    { executeFileSync, auditSink },
  );
  return { broker, root, executeFileSync, auditSink };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("bundled Skill process broker", () => {
  it("publishes an exact frozen policy set for the migrated handlers", () => {
    expect(Object.isFrozen(BUNDLED_SKILL_PROCESS_POLICIES)).toBe(true);
    expect(Object.keys(BUNDLED_SKILL_PROCESS_POLICIES).sort()).toEqual([
      "create-pr",
      "git-worktree-manager",
      "k8s-deployer",
      "pdh-im-collect",
      "pr-reviewer",
    ]);
  });

  it("requires a branded broker with exact Skill scope", () => {
    const { broker } = createBroker("create-pr");
    expect(
      requireBundledSkillProcessBroker({ processBroker: broker }, "create-pr"),
    ).toBe(broker);
    expect(() =>
      requireBundledSkillProcessBroker(
        { processBroker: broker },
        "pr-reviewer",
      ),
    ).toThrowError(/unavailable/i);
    expect(() =>
      requireBundledSkillProcessBroker(
        { processBroker: { execFileSync() {} } },
        "create-pr",
      ),
    ).toThrowError(/unavailable/i);
  });

  it("passes a frozen, bounded request to the trusted adapter", () => {
    const executeFileSync = vi.fn((request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.args)).toBe(true);
      return "main\n";
    });
    const { broker, root } = createBroker("create-pr", { executeFileSync });
    expect(
      broker.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: root,
        timeout: 60_000,
      }),
    ).toBe("main\n");
    expect(executeFileSync).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "create-pr",
        file: "git",
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  });

  it("rejects shell commands, unreviewed subcommands, and escaped cwd", () => {
    const { broker, root, executeFileSync } = createBroker(
      "git-worktree-manager",
    );
    expect(() =>
      broker.execFileSync("git status", [], { cwd: root }),
    ).toThrowError(/executable names/i);
    expect(() =>
      broker.execFileSync("git", ["reset", "--hard"], { cwd: root }),
    ).toThrowError(/not approved/i);
    expect(() =>
      broker.execFileSync("git", ["status", "--short"], {
        cwd: path.dirname(root),
      }),
    ).toThrowError(/outside approved roots/i);
    expect(executeFileSync).not.toHaveBeenCalled();
  });

  it("allows only reviewed kubectl and PR commands", () => {
    const k8s = createBroker("k8s-deployer");
    expect(() =>
      k8s.broker.execFileSync(
        "kubectl",
        ["rollout", "restart", "deployment/api"],
        { cwd: k8s.root },
      ),
    ).not.toThrow();
    expect(() =>
      k8s.broker.execFileSync("kubectl", ["delete", "deployment", "api"], {
        cwd: k8s.root,
      }),
    ).toThrowError(/not approved/i);

    const reviewer = createBroker("pr-reviewer");
    expect(() =>
      reviewer.broker.execFileSync("gh", ["pr", "diff", "42"], {
        cwd: reviewer.root,
      }),
    ).not.toThrow();
    expect(() =>
      reviewer.broker.execFileSync("git", ["push", "--force"], {
        cwd: reviewer.root,
      }),
    ).toThrowError(/not approved/i);
  });

  it("pins fallback PDH node execution to approved entrypoints", () => {
    const root = temporaryDirectory();
    const entrypoint = path.join(root, "chainlesschain.js");
    fs.writeFileSync(entrypoint, "// fixture\n");
    const { broker } = createBroker("pdh-im-collect", {
      root,
      allowedEntrypoints: [entrypoint],
    });
    expect(() =>
      broker.execFileSync("node", [entrypoint, "hub", "readiness", "--json"], {
        cwd: root,
      }),
    ).not.toThrow();
    const other = path.join(root, "other.js");
    fs.writeFileSync(other, "// other\n");
    expect(() =>
      broker.execFileSync("node", [other, "hub", "readiness", "--json"], {
        cwd: root,
      }),
    ).toThrowError(/not approved/i);
  });

  it("never writes argument values or adapter output to audit records", () => {
    const auditSink = vi.fn();
    const { broker, root } = createBroker("pdh-im-collect", {
      auditSink,
      executeFileSync: () => "adapter-output-secret",
    });
    broker.execFileSync(
      "cc",
      ["hub", "sync-adapter", "qq-pc", "--passphrase", "top-secret"],
      { cwd: root },
    );
    const serialized = JSON.stringify(auditSink.mock.calls);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("adapter-output-secret");
    expect(serialized).toContain("sync-adapter");
  });

  it("fails closed for invalid output and adapter failure", () => {
    const invalid = createBroker("create-pr", {
      executeFileSync: () => ({ output: "not data-only" }),
    });
    expect(() =>
      invalid.broker.execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: invalid.root },
      ),
    ).toThrowError(/unsupported output type/i);

    const failed = createBroker("create-pr", {
      executeFileSync: () => {
        throw new Error("denied by host");
      },
    });
    expect(() =>
      failed.broker.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: failed.root,
      }),
    ).toThrowError("denied by host");
  });

  it("contains no native child-process fallback", () => {
    const source = fs.readFileSync(
      path.resolve(
        "src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/require\(["'](?:node:)?child_process["']\)/);
    expect(source).not.toContain("process.env");
  });
});
