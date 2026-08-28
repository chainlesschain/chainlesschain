import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_ENVIRONMENT_POLICIES,
  createBundledSkillEnvironmentBroker,
  requireBundledSkillEnvironmentBroker,
} = require("../bundled-skill-environment-broker.js");

const SKILLS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIGRATED_SKILLS = [
  "api-gateway",
  "audio-transcriber",
  "code-runner",
  "github-manager",
  "google-workspace",
  "image-generator",
  "notion",
  "obsidian",
  "self-improving-agent",
  "skill-creator",
  "subtitle-generator",
  "tavily-search",
  "team",
  "workflow-automation",
];

function createBroker(skillId, values = {}, auditSink = vi.fn()) {
  return createBundledSkillEnvironmentBroker(
    { skillId, authorityId: `decision:${skillId}` },
    {
      resolveValue: ({ key }) => values[key] ?? null,
      auditSink,
    },
  );
}

describe("bundled Skill environment broker", () => {
  it("ships only frozen reviewed policies", () => {
    expect(Object.keys(BUNDLED_SKILL_ENVIRONMENT_POLICIES).sort()).toEqual(
      [...MIGRATED_SKILLS].sort(),
    );
    for (const policy of Object.values(BUNDLED_SKILL_ENVIRONMENT_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
    }
  });

  it("removes all 15 raw handler environment reads", () => {
    for (const skillId of [...MIGRATED_SKILLS, "free-model-manager"]) {
      const source = readFileSync(
        path.join(SKILLS_DIRECTORY, "builtin", skillId, "handler.js"),
        "utf8",
      );
      expect(source, skillId).not.toContain("process.env");
      expect(source, skillId).not.toContain(
        "createBundledSkillEnvironmentBroker",
      );
      if (skillId !== "free-model-manager") {
        expect(source, skillId).toContain(
          "requireBundledSkillEnvironmentBroker",
        );
      }
    }
  });

  it.each([
    [undefined, {}, "CC_BUNDLED_SKILL_ENVIRONMENT_POLICY_INVALID"],
    [
      { skillId: "unreviewed", authorityId: "decision:1" },
      { resolveValue: vi.fn() },
      "CC_BUNDLED_SKILL_ENVIRONMENT_SKILL_DENIED",
    ],
    [
      { skillId: "notion" },
      { resolveValue: vi.fn() },
      "CC_BUNDLED_SKILL_ENVIRONMENT_AUTHORITY_REQUIRED",
    ],
    [
      { skillId: "notion", authorityId: "decision:1" },
      {},
      "CC_BUNDLED_SKILL_ENVIRONMENT_RESOLVER_REQUIRED",
    ],
  ])("rejects invalid creator inputs", (policy, deps, code) => {
    expect(() => createBundledSkillEnvironmentBroker(policy, deps)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("requires an authentic broker with matching Skill scope", () => {
    const broker = createBroker("notion");
    expect(
      requireBundledSkillEnvironmentBroker(
        { environmentBroker: broker },
        "notion",
      ),
    ).toBe(broker);
    expect(() =>
      requireBundledSkillEnvironmentBroker(
        { environmentBroker: { get: vi.fn(), has: vi.fn() } },
        "notion",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_BROKER_UNAVAILABLE",
      }),
    );
    expect(() =>
      requireBundledSkillEnvironmentBroker(
        { environmentBroker: broker },
        "github-manager",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_BROKER_UNAVAILABLE",
      }),
    );
  });

  it("returns only reviewed values and never audits the secret", () => {
    const auditSink = vi.fn();
    const broker = createBroker(
      "notion",
      { "notion-api-key": "secret-value" },
      auditSink,
    );
    expect(broker.get("notion-api-key")).toBe("secret-value");
    expect(broker.has("notion-api-key")).toBe(true);
    expect(broker.snapshot()).toEqual({ "notion-api-key": "secret-value" });
    expect(JSON.stringify(auditSink.mock.calls)).not.toContain("secret-value");
    expect(() => broker.get("other-key")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_KEY_DENIED",
      }),
    );
  });

  it("rejects non-string and oversized resolver values", () => {
    const nonString = createBundledSkillEnvironmentBroker(
      { skillId: "notion", authorityId: "decision:type" },
      { resolveValue: () => 42, auditSink: vi.fn() },
    );
    expect(() => nonString.get("notion-api-key")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_VALUE_INVALID",
      }),
    );
    const oversized = createBroker("notion", {
      "notion-api-key": "x".repeat(16 * 1024 + 1),
    });
    expect(() => oversized.get("notion-api-key")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_VALUE_TOO_LARGE",
      }),
    );
  });

  it("caps aggregate runtime snapshots", () => {
    const broker = createBundledSkillEnvironmentBroker(
      { skillId: "code-runner", authorityId: "decision:aggregate" },
      {
        resolveValue: () => "x".repeat(20 * 1024),
        auditSink: vi.fn(),
      },
    );
    expect(() => broker.snapshot()).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_SNAPSHOT_TOO_LARGE",
      }),
    );
  });
});
