import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGovernedSkillSynthesisCliHost,
  isGovernedSkillSynthesisCliHost,
} from "../../src/lib/evolution/governed-skill-synthesis-cli-host.js";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function deployment(root, overrides = {}) {
  const activeRoot = path.join(root, "active");
  fs.mkdirSync(activeRoot);
  return {
    descriptor: {
      tenantId: "tenant-learning",
      handlerArtifactDigest: `sha256:${"b".repeat(64)}`,
    },
    llmChat: async () =>
      JSON.stringify({
        name: "review-security-config",
        description: "Review a security configuration",
        trigger: "A security configuration requires review",
        steps: ["Inspect the configuration", "Report risky settings"],
      }),
    candidateOutputDir: path.join(root, "candidates"),
    activeSkillsDirs: [activeRoot],
    evaluateCandidate: async () => ({ accepted: true }),
    synthesis: { minToolCount: 1, minScore: 0, minSimilar: 1 },
    ...overrides,
  };
}

describe("governed learning synthesis CLI host", () => {
  it("creates only an evaluated candidate through captured deployment ports", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-learning-host-"));
    roots.push(root);
    const markSynthesized = vi.fn();
    const trajectory = {
      id: "trajectory-1",
      userIntent: "Review this security configuration",
      toolChain: [{ tool: "read" }, { tool: "audit" }],
      outcomeScore: 0.9,
    };
    const trajectoryStore = {
      findComplexUnprocessed: () => [trajectory],
      findSimilar: () => [{ id: "trajectory-2" }],
      markSynthesized,
    };
    const db = { prepare: () => ({ all: () => [] }) };
    const host = createGovernedSkillSynthesisCliHost(deployment(root));

    expect(isGovernedSkillSynthesisCliHost(host)).toBe(true);
    await expect(host.synthesize({ db, trajectoryStore })).resolves.toEqual({
      status: "completed",
      created: ["review-security-config"],
      skipped: [],
      errors: [],
    });
    expect(markSynthesized).toHaveBeenCalledWith(
      "trajectory-1",
      "review-security-config",
    );
    expect(
      fs.readFileSync(
        path.join(
          root,
          "candidates",
          "review-security-config",
          "1.0.0",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toContain("Review a security configuration");
  });

  it("rejects incomplete deployment ports and structural host lookalikes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-learning-host-"));
    roots.push(root);
    expect(() =>
      createGovernedSkillSynthesisCliHost(
        deployment(root, { evaluateCandidate: null }),
      ),
    ).toThrow("evaluator");
    expect(
      isGovernedSkillSynthesisCliHost({ synthesize: async () => ({}) }),
    ).toBe(false);
  });
});
