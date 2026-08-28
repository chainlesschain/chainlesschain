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
      replacementEntryIds: expect.arrayContaining([expect.any(String)]),
      historicalReadFunctions: expect.arrayContaining([expect.any(String)]),
      replacementTargets: expect.arrayContaining([
        expect.objectContaining({
          entryId: expect.any(String),
          rolloutKey: expect.any(String),
          entrypoints: expect.arrayContaining([expect.any(String)]),
          recoveryEntrypoints: expect.arrayContaining([expect.any(String)]),
        }),
      ]),
    });
    expect(() =>
      assertCLILegacyMutationAllowed("CLIAutonomousAgent.submitGoal"),
    ).toThrowError(
      expect.objectContaining({
        replacementEntrypoint:
          "cc cowork run through the canonical Graph Kernel adapter",
        replacementEntryIds: ["cli-cowork"],
        historicalReadFunctions: expect.arrayContaining([
          "CLIAutonomousAgent.getGoalStatus",
        ]),
        replacementTargets: [
          expect.objectContaining({
            entryId: "cli-cowork",
            originSurface: "cowork",
            rolloutKey: "cowork/cli-cowork",
            entrypoints: expect.arrayContaining([
              "packages/cli/src/commands/cowork.js",
            ]),
            recoveryEntrypoints: ["DynamicWorkflowRuntime.resume"],
          }),
        ],
      }),
    );

    const autonomous = new CLIAutonomousAgent();
    expect(() => autonomous.initialize({})).toThrowError(expected);
    await expect(autonomous.submitGoal("legacy goal")).rejects.toEqual(
      expected,
    );

    const orchestrator = Object.create(Orchestrator.prototype);
    await expect(orchestrator.addTask("legacy task")).rejects.toEqual(expected);
    expect(() => orchestrator.startCronWatch()).toThrowError(expected);
  });
});
