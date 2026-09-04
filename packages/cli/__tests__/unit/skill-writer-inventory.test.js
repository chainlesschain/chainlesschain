import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  SKILL_WRITER_INVENTORY,
  SKILL_WRITER_INVENTORY_SCHEMA,
  SKILL_WRITER_SURFACES,
  SKILL_WRITER_TARGET_AUTHORITIES,
  SKILL_WRITER_TRIGGER_CLASSES,
} from "../../src/lib/evolution/skill-writer-inventory-manifest.js";
import {
  SkillWriterInventoryError,
  assertSkillWriterInventory,
  discoverSkillWriterSites,
  findUnclassifiedSkillWriters,
  skillWriterInventoryDigest,
  validateSkillWriterInventory,
} from "../../src/lib/evolution/skill-writer-inventory-validator.js";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const temporaryRoots = [];

function mutableInventory() {
  return JSON.parse(JSON.stringify(SKILL_WRITER_INVENTORY));
}

function fixtureRoot() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-skill-writer-inventory-"),
  );
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  return root;
}

function fixtureInventory(writers = []) {
  return {
    schema: SKILL_WRITER_INVENTORY_SCHEMA,
    schemaVersion: 1,
    surfaces: [...SKILL_WRITER_SURFACES],
    sourceRoots: ["src"],
    scannerScope: {
      classification: "direct-source-sink-subset",
      unit: "function-or-ipc",
      sourceExtensions: [".js"],
      skillBindings: ["nearby-skill-md-literal"],
      mutationSinks: ["writeFileSync"],
    },
    limitations: ["fixture-direct-scan-is-not-whole-program-proof"],
    scopeExclusions: [],
    writers,
  };
}

function fixtureWriter(overrides = {}) {
  return {
    id: "fixture-skill-writer",
    surface: "cli",
    triggerClass: "automatic",
    targetAuthority: "legacy-active",
    mutationType: "skill-bytes",
    discoverySymbol: "hiddenWriter",
    entrypoint: {
      file: "src/hidden-writer.js",
      symbol: "hiddenWriter",
      evidence: ["function hiddenWriter"],
    },
    mutation: {
      file: "src/hidden-writer.js",
      symbol: "hiddenWriter",
      evidence: ["writeFileSync", '"SKILL.md"'],
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Skill writer inventory", () => {
  it("classifies every current production writer with source evidence and zero unknowns", () => {
    const report = assertSkillWriterInventory({
      repositoryRoot: REPOSITORY_ROOT,
    });

    expect(report.ok).toBe(true);
    expect(report.writerCount).toBe(SKILL_WRITER_INVENTORY.writers.length);
    expect(report.writerCount).toBe(38);
    expect(report.legacyActiveCount).toBe(32);
    expect(report.candidateOnlyCount).toBe(6);
    expect(report.scopeExclusionCount).toBe(3);
    expect(report.directDiscoveredCount).toBeGreaterThan(0);
    expect(report.unknownDirectCount).toBe(0);
    expect(report.discoveredCount).toBeUndefined();
    expect(report.unknownWriterCount).toBeUndefined();
    expect(report.scannerScope.classification).toBe(
      "direct-source-sink-subset",
    );
    expect(report.limitations).toContain(
      "direct-unknown-zero-is-not-a-whole-program-semantic-proof",
    );
    expect(report.errors).toEqual([]);

    const triggers = new Set(
      SKILL_WRITER_INVENTORY.writers.map((writer) => writer.triggerClass),
    );
    const authorities = new Set(
      SKILL_WRITER_INVENTORY.writers.map((writer) => writer.targetAuthority),
    );
    expect(triggers).toEqual(new Set(SKILL_WRITER_TRIGGER_CLASSES));
    expect(authorities).toEqual(new Set(SKILL_WRITER_TARGET_AUTHORITIES));

    const ids = new Set(
      SKILL_WRITER_INVENTORY.writers.map((writer) => writer.id),
    );
    expect(ids.has("cli-agent-file-mutation-tools")).toBe(true);
    expect(ids.has("cli-agent-shell-mutation-tool")).toBe(true);
    expect(ids.has("cli-agent-code-mutation-tool")).toBe(true);
    expect(ids.has("cli-plugin-enabled-state")).toBe(true);
    expect(ids.has("cli-record-replay-install")).toBe(true);
    expect(ids.has("cli-content-addressed-candidate-registry")).toBe(true);
    expect(ids.has("desktop-skill-creator-optimize-description")).toBe(true);
    expect(ids.has("desktop-skill-sync-import")).toBe(true);
    expect(ids.has("desktop-plugin-install")).toBe(false);
    expect(ids.has("desktop-bundled-skill-filesystem-writer")).toBe(true);
    expect(ids.has("desktop-bundled-skill-process-writer")).toBe(true);
    expect(ids.has("desktop-skills-enabled-ipc")).toBe(true);
    expect(ids.has("android-managed-skill-install")).toBe(true);
    expect(ids.has("android-managed-skill-uninstall")).toBe(true);
    expect(ids.has("android-skill-loader-activation")).toBe(true);
    expect(ids.has("android-bundled-skill-activation")).toBe(true);
    expect(ids.has("android-workspace-skill-activation")).toBe(true);
    expect(ids.has("android-skill-registry-mutation")).toBe(true);
    expect(
      SKILL_WRITER_INVENTORY.sourceRoots.some((root) =>
        root.startsWith("android-app/feature-ai/src/main/"),
      ),
    ).toBe(true);
  });

  it("produces a stable canonical digest independent of declaration ordering", () => {
    const reordered = mutableInventory();
    reordered.sourceRoots.reverse();
    reordered.surfaces.reverse();
    reordered.limitations.reverse();
    reordered.scannerScope.sourceExtensions.reverse();
    reordered.scannerScope.skillBindings.reverse();
    reordered.scannerScope.mutationSinks.reverse();
    reordered.scopeExclusions.reverse();
    reordered.writers.reverse();
    for (const writer of reordered.writers) {
      writer.entrypoint.evidence.reverse();
      writer.mutation.evidence.reverse();
    }

    const expected = skillWriterInventoryDigest(SKILL_WRITER_INVENTORY);
    expect(expected).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(skillWriterInventoryDigest(reordered)).toBe(expected);

    reordered.limitations.push("new-scanner-limitation");
    expect(skillWriterInventoryDigest(reordered)).not.toBe(expected);
  });

  it("discovers and rejects an unclassified production SKILL.md writer", () => {
    const root = fixtureRoot();
    fs.writeFileSync(
      path.join(root, "src", "hidden-writer.js"),
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        "export function hiddenWriter(root, content) {",
        '  fs.writeFileSync(path.join(root, "SKILL.md"), content);',
        "}",
        "",
      ].join("\n"),
    );

    const discovered = discoverSkillWriterSites({
      repositoryRoot: root,
      sourceRoots: ["src"],
    });
    expect(discovered).toEqual([
      expect.objectContaining({
        key: "src/hidden-writer.js::hiddenWriter",
        symbol: "hiddenWriter",
        operations: ["writeFileSync"],
      }),
    ]);
    expect(
      findUnclassifiedSkillWriters(discovered, fixtureInventory()),
    ).toHaveLength(1);

    const report = validateSkillWriterInventory({
      repositoryRoot: root,
      inventory: fixtureInventory(),
      requireClassificationCoverage: false,
    });
    expect(report.ok).toBe(false);
    expect(report.unknownDirectCount).toBe(1);
    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "UNCLASSIFIED_DIRECT_SKILL_WRITER",
        key: "src/hidden-writer.js::hiddenWriter",
      }),
    );
    expect(() =>
      assertSkillWriterInventory({
        repositoryRoot: root,
        inventory: fixtureInventory(),
        requireClassificationCoverage: false,
      }),
    ).toThrow(SkillWriterInventoryError);
  });

  it("requires the inventoried entrypoint and mutation function evidence to exist", () => {
    const root = fixtureRoot();
    fs.writeFileSync(
      path.join(root, "src", "hidden-writer.js"),
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        "export function hiddenWriter(root, content) {",
        '  fs.writeFileSync(path.join(root, "SKILL.md"), content);',
        "}",
        "",
      ].join("\n"),
    );

    const valid = validateSkillWriterInventory({
      repositoryRoot: root,
      inventory: fixtureInventory([fixtureWriter()]),
      requireClassificationCoverage: false,
    });
    expect(valid.ok).toBe(true);

    const missingMutationEvidence = fixtureWriter({
      mutation: {
        file: "src/hidden-writer.js",
        symbol: "hiddenWriter",
        evidence: ["nonexistentMutationFunction()"],
      },
    });
    const invalidEvidence = validateSkillWriterInventory({
      repositoryRoot: root,
      inventory: fixtureInventory([missingMutationEvidence]),
      requireClassificationCoverage: false,
    });
    expect(invalidEvidence.ok).toBe(false);
    expect(invalidEvidence.errors).toContainEqual(
      expect.objectContaining({
        code: "WRITER_EVIDENCE_MISSING",
        writerId: "fixture-skill-writer",
        kind: "mutation",
      }),
    );

    const missingFile = fixtureWriter({
      entrypoint: {
        file: "src/missing.js",
        symbol: "missingWriter",
        evidence: ["missingWriter"],
      },
    });
    const invalidFile = validateSkillWriterInventory({
      repositoryRoot: root,
      inventory: fixtureInventory([missingFile]),
      requireClassificationCoverage: false,
    });
    expect(invalidFile.errors).toContainEqual(
      expect.objectContaining({
        code: "WRITER_FILE_MISSING",
        writerId: "fixture-skill-writer",
        kind: "entrypoint",
      }),
    );
  });
});
