import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { SKILL_WRITER_INVENTORY } from "../../src/lib/evolution/skill-writer-inventory-manifest.js";

const read = (url) => fs.readFileSync(url, "utf8");
const repositoryRoot = new URL("../../../../", import.meta.url);

describe("EVO-P0-1 production truth surface", () => {
  it("keeps every learning, proposer, and governed import writer candidate-only", () => {
    const governedWriterIds = new Set([
      "cli-learning-synthesis-candidate",
      "cli-learning-improvement-candidate",
      "cli-content-addressed-candidate-registry",
      "desktop-skill-creator-create",
      "desktop-skill-creator-optimize-description",
      "desktop-skill-sync-import",
    ]);
    const governedWriters = SKILL_WRITER_INVENTORY.writers.filter((writer) =>
      governedWriterIds.has(writer.id),
    );

    expect(governedWriters).toHaveLength(governedWriterIds.size);
    expect(
      governedWriters.every(
        (writer) => writer.targetAuthority === "candidate-only",
      ),
    ).toBe(true);
  });

  it("keeps real CLI help, generated docs, and product docs metrics-only", () => {
    const helpIndex = JSON.parse(
      read(new URL("../../src/command-help-index.json", import.meta.url)),
    );
    const help = helpIndex.commands.evolution;
    const normalizedHelp = help.replace(/\s+/g, " ");
    const learningHelp = helpIndex.commands.learning.replace(/\s+/g, " ");
    const generatedReference = read(
      new URL("docs/cli/CLI_REFERENCE.generated.md", repositoryRoot),
    );
    const productDoc = read(
      new URL("docs-site/docs/chainlesschain/cli-evolution.md", repositoryRoot),
    );

    expect(normalizedHelp).toContain(
      "Evolution metrics and governance records",
    );
    expect(normalizedHelp).toContain(
      "not model training or active Skill promotion",
    );
    expect(normalizedHelp).toContain(
      "Record a synthetic model metric estimate (no training)",
    );
    expect(normalizedHelp).toContain(
      "Record caller-supplied loss metrics (no training)",
    );
    expect(normalizedHelp).not.toContain(" learn ");
    expect(normalizedHelp).not.toContain(" train-v2 ");
    expect(help).not.toContain("Self-evolving AI system");
    expect(learningHelp).toContain(
      "Learning records — trajectories, reflection, and governed candidate attempts",
    );
    expect(learningHelp).toContain(
      "Attempt a governed Skill candidate from eligible trajectories",
    );
    expect(learningHelp).not.toContain("Synthesize new skills");
    expect(generatedReference).toContain(
      "Evolution metrics and governance records",
    );
    expect(productDoc).toContain("`cc evolution`");
    expect(productDoc).toContain("active Skill");
    expect(productDoc).toContain("`record-model-metrics`");
    expect(productDoc).toContain("`record-training-metrics-v2`");
    expect(productDoc).toContain("不更新模型权重");
    expect(productDoc).not.toContain("更新模型参数但保留已有知识");
  });

  it("registers Desktop Phase 20 as metrics and keeps the simulator retired", () => {
    const phaseSource = read(
      new URL(
        "desktop-app-vue/src/main/ipc/phases/phase-16-20-skill-evo.js",
        repositoryRoot,
      ),
    );
    const retiredSimulator = new URL(
      "desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js",
      repositoryRoot,
    );
    const retiredIpc = new URL(
      "desktop-app-vue/src/main/ai-engine/evolution/evolution-ipc.js",
      repositoryRoot,
    );

    expect(phaseSource).toContain("Evolution Metrics & Knowledge Graph IPC");
    expect(phaseSource).not.toContain("Self-Evolution & Knowledge Graph IPC");
    expect(phaseSource).not.toContain("ai-engine/evolution/evolution-ipc");
    expect(phaseSource).not.toContain("self-evolving-system");
    expect(fs.existsSync(retiredSimulator)).toBe(false);
    expect(fs.existsSync(retiredIpc)).toBe(false);
  });

  it("keeps the unwired legacy learning hook shim retired", () => {
    const retiredLearningHooks = new URL(
      "packages/cli/src/lib/learning/learning-hooks.js",
      repositoryRoot,
    );

    expect(fs.existsSync(retiredLearningHooks)).toBe(false);
  });
});
