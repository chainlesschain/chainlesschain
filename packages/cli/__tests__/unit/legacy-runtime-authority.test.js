import { afterEach, describe, expect, it } from "vitest";
import { CLIAutonomousAgent } from "../../src/lib/autonomous-agent.js";
import {
  assertCLILegacyMutationAllowed,
  cliLegacyRuntimeAuthorityMode,
} from "../../src/lib/legacy-runtime-authority.js";
import { Orchestrator } from "../../src/lib/orchestrator.js";

const originalMode = process.env.CHAINLESSCHAIN_GRAPH_COWORK;
const originalReadOnly = process.env.CHAINLESSCHAIN_CLI_LEGACY_READ_ONLY;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.CHAINLESSCHAIN_GRAPH_COWORK;
  } else {
    process.env.CHAINLESSCHAIN_GRAPH_COWORK = originalMode;
  }
  if (originalReadOnly === undefined) {
    delete process.env.CHAINLESSCHAIN_CLI_LEGACY_READ_ONLY;
  } else {
    process.env.CHAINLESSCHAIN_CLI_LEGACY_READ_ONLY = originalReadOnly;
  }
});

describe("CLI legacy runtime authority", () => {
  it("resolves entry-scoped authority with a stable run key", () => {
    const seen = [];
    expect(
      cliLegacyRuntimeAuthorityMode(
        { CHAINLESSCHAIN_GRAPH_COWORK: "legacy" },
        {
          entryId: "cli-legacy-orchestrate",
          runKey: "orchestrate:stable",
          optIn: true,
          resolver: (input) => {
            seen.push(input);
            return { mode: "canonical" };
          },
        },
      ),
    ).toBe("canonical");
    expect(seen).toEqual([{ runKey: "orchestrate:stable", optIn: true }]);
  });

  it("fails old autonomous and orchestrate writers closed in canonical mode", async () => {
    process.env.CHAINLESSCHAIN_GRAPH_COWORK = "canonical";
    const expected = expect.objectContaining({
      code: "CC_CLI_LEGACY_RUNTIME_READ_ONLY",
      authoritySource: "graph_kernel",
      replacementEntrypoint: expect.any(String),
    });
    expect(() =>
      assertCLILegacyMutationAllowed("CLIAutonomousAgent.submitGoal"),
    ).toThrowError(
      expect.objectContaining({
        replacementEntrypoint:
          "cc cowork run through the canonical Graph Kernel adapter",
      }),
    );

    const autonomous = new CLIAutonomousAgent();
    autonomous.initialize({});
    await expect(autonomous.submitGoal("legacy goal")).rejects.toEqual(
      expected,
    );

    const orchestrator = Object.create(Orchestrator.prototype);
    await expect(orchestrator.addTask("legacy task")).rejects.toEqual(expected);
  });
});
