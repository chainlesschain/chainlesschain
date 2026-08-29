import { afterEach, describe, expect, it } from "vitest";

const {
  assertDesktopLegacyMutationAllowed,
  resolveDesktopContextMemoryCutover,
} = require("../authority.js");
const {
  PromptCompressor,
} = require("../../llm/prompt-compressor.js");
const {
  HierarchicalMemory,
} = require("../../ai-engine/memory/hierarchical-memory.js");

const STAGE_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE";
const originalStage = process.env[STAGE_ENV];

afterEach(() => {
  if (originalStage === undefined) delete process.env[STAGE_ENV];
  else process.env[STAGE_ENV] = originalStage;
});

describe("Desktop Context/Memory authority", () => {
  it("keeps shadow legacy-compatible and makes canonical stages single-writer", () => {
    expect(
      resolveDesktopContextMemoryCutover({
        env: { [STAGE_ENV]: "shadow" },
      }),
    ).toMatchObject({ canonical: false, legacyWritable: true });
    expect(
      resolveDesktopContextMemoryCutover({
        env: { [STAGE_ENV]: "canonical_default" },
      }),
    ).toMatchObject({ canonical: true, legacyWritable: false });
    expect(() =>
      assertDesktopLegacyMutationAllowed({
        env: { [STAGE_ENV]: "retired" },
        scopeKey: "desktop:test",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
      }),
    );
  });

  it("fences direct compressor and hierarchical-memory calls after cutover", async () => {
    process.env[STAGE_ENV] = "canonical_default";
    const compressor = new PromptCompressor();
    await expect(
      compressor.compress([{ role: "user", content: "do not diverge" }]),
    ).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
      replacement: "coding-agent:app-server-context-compact",
    });

    const hierarchy = new HierarchicalMemory();
    expect(() => hierarchy.store("legacy write")).toThrowError(
      expect.objectContaining({
        code: "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
      }),
    );
  });
});
