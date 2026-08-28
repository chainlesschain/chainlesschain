import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { withTestFilesystemHandler } from "./helpers/bundled-skill-filesystem.js";
import { createTestProcessContext } from "./helpers/bundled-skill-process.js";

const require = createRequire(import.meta.url);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-git-process-handlers-"),
);
fs.writeFileSync(path.join(temporaryRoot, "sample.js"), "const value = 1;\n");

const CASES = [
  ["auto-context", { input: "--files sample" }],
  ["bugbot", { action: "--diff staged" }],
  ["changelog-generator", { input: "--unreleased" }],
  ["commit-splitter", { action: "--analyze" }],
  ["diff-previewer", { action: "--summary" }],
  ["doc-generator", { input: "--changelog" }],
  [
    "fault-localizer",
    { input: "--trace Error: boom\n    at sample (sample.js:1:1)" },
  ],
  ["git-commit", { action: "--dry-run" }],
  ["git-history-analyzer", { input: "--hotspots --limit 5" }],
  ["impact-analyzer", { input: "--diff" }],
];

function loadHandler(skillId) {
  return withTestFilesystemHandler(
    require(`../builtin/${skillId}/handler.js`),
    skillId,
  );
}

const localContext = Object.freeze({
  projectRoot: temporaryRoot,
  workspaceRoot: temporaryRoot,
  workspacePath: temporaryRoot,
});

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("brokered bundled Git process handlers", () => {
  it.each(CASES)(
    "%s fails closed when trusted process authority is absent",
    async (skillId, task) => {
      const result = await loadHandler(skillId).execute(task, localContext, {});
      expect(result.success).toBe(false);
      expect(result.error || result.message).toMatch(
        /process authority.*unavailable/i,
      );
    },
  );

  it("keeps non-process modes usable without process authority", async () => {
    const budget = await loadHandler("auto-context").execute(
      { input: "--budget 4096" },
      localContext,
      {},
    );
    expect(budget.success).toBe(true);

    const scan = await loadHandler("bugbot").execute(
      { action: "--scan sample.js" },
      localContext,
      {},
    );
    expect(scan.success).toBe(true);

    const diagnosis = await loadHandler("fault-localizer").execute(
      { input: "--error TypeError: value is undefined" },
      localContext,
      {},
    );
    expect(diagnosis.success).toBe(true);

    const impact = await loadHandler("impact-analyzer").execute(
      { input: "--function value" },
      localContext,
      {},
    );
    expect(impact.success).toBe(true);
  });

  it.each(
    CASES.filter(([skillId]) =>
      [
        "bugbot",
        "changelog-generator",
        "commit-splitter",
        "git-commit",
        "git-history-analyzer",
        "impact-analyzer",
      ].includes(skillId),
    ),
  )(
    "%s does not convert adapter failure into success",
    async (skillId, task) => {
      const context = {
        ...localContext,
        ...createTestProcessContext(
          skillId,
          () => {
            throw new Error("host adapter denied");
          },
          { allowedRoots: [temporaryRoot] },
        ),
      };
      const result = await loadHandler(skillId).execute(task, context, {});
      expect(result.success).toBe(false);
      expect(result.error || result.message).toMatch(/host adapter denied/i);
    },
  );
});
