import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGraphCommand } from "../../src/commands/graph.js";
import { loadGraphRuntimeSurfaceManifest } from "../../src/lib/graph-kernel/runtime-surface-manifest.js";

const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cutover-command-"));
  roots.push(root);
  const writes = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  const program = new Command().name("cc").exitOverride();
  registerGraphCommand(program);
  return {
    root,
    program,
    output: () => JSON.parse(writes.at(-1)),
  };
}

async function run(program, args) {
  await program.parseAsync(["node", "cc", "graph", "cutover", ...args]);
}

describe("graph cutover command", () => {
  it("initializes every durable entry and reports non-durable entries truthfully", async () => {
    const { root, program, output } = fixture();
    await run(program, ["init", "--state-dir", root]);
    const initialized = output();
    const manifest = loadGraphRuntimeSurfaceManifest();
    const durableCount = manifest.surfaces
      .filter((surface) => surface.durability === "durable")
      .reduce((count, surface) => count + surface.entries.length, 0);
    expect(initialized.entries).toHaveLength(durableCount);
    expect(initialized.entries.every((entry) => entry.stage === "legacy")).toBe(
      true,
    );

    await run(program, ["status", "--state-dir", root]);
    const status = output();
    expect(status.entries).toHaveLength(
      manifest.surfaces.reduce(
        (count, surface) => count + surface.entries.length,
        0,
      ),
    );
    expect(
      status.entries
        .filter((entry) => entry.surface === "browser")
        .every(
          (entry) =>
            entry.initialized === false && entry.fallbackMode === "legacy",
        ),
    ).toBe(true);
  });

  it("transitions with a manifest-bound evidence file and resolves ledger authority", async () => {
    const { root, program, output } = fixture();
    await run(program, [
      "init",
      "--state-dir",
      root,
      "--surface",
      "cowork",
      "--entry",
      "cli-cowork",
    ]);
    const [initialized] = output().entries;
    const evidencePath = path.join(root, "shadow-evidence.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        inventoryDigest: initialized.manifestDigest,
        unknownWriterCount: 0,
        shadowEffectInvocationCount: 0,
      }),
      "utf8",
    );
    await run(program, [
      "transition",
      "cowork",
      "cli-cowork",
      "shadow",
      "--state-dir",
      root,
      "--evidence",
      evidencePath,
      "--expected-head",
      initialized.eventHead,
    ]);
    expect(output()).toMatchObject({ stage: "shadow", transitionCount: 1 });

    await run(program, [
      "authority",
      "cowork",
      "cli-cowork",
      "--state-dir",
      root,
      "--run-key",
      "workflow-1",
      "--fallback",
      "canonical",
    ]);
    expect(output()).toMatchObject({
      mode: "shadow",
      stage: "shadow",
      source: "cutover_ledger",
    });
  });
});
