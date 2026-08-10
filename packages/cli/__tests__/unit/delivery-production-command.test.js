import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  registerArtifactsCommand,
  runArtifactsDeliveryRun,
} from "../../src/commands/artifacts.js";
import { createDeliveryFlow } from "../../src/lib/delivery-coordinator.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;

function state() {
  return createDeliveryFlow(
    {
      flowId: "delivery-command-test",
      commitSha: HEAD,
      diff: {
        baseCommitSha: BASE,
        headCommitSha: HEAD,
        digest: DIGEST,
        changedFiles: ["src/widget.js"],
      },
      environment: {
        os: "linux",
        arch: "x64",
        runtime: "node",
        runtimeVersion: "22.12.0",
        dependencyDigest: DIGEST,
      },
      requiredGates: [{ id: "cli-ci", always: true, matrix: ["local"] }],
      analysis: {
        confidence: 1,
        dependencyGraphComplete: true,
        languageServicesComplete: true,
        testHistoryComplete: true,
        classifications: [
          {
            path: "src/widget.js",
            language: "javascript",
            ecosystem: "npm",
            confidence: 1,
          },
        ],
      },
      unverified: [],
      sideEffects: [],
    },
    { now: "2026-08-10T00:00:00.000Z" },
  );
}

describe("artifacts delivery-run", () => {
  it("registers an explicit production-provider command", () => {
    const program = new Command();
    registerArtifactsCommand(program);
    const artifacts = program.commands.find(
      (command) => command.name() === "artifacts",
    );
    const deliveryRun = artifacts.commands.find(
      (command) => command.name() === "delivery-run",
    );

    expect(deliveryRun).toBeDefined();
    expect(deliveryRun.registeredArguments[0].name()).toBe("state");
    expect(deliveryRun.registeredArguments[0].required).toBe(true);
    expect(
      deliveryRun.options.find(
        (option) => option.attributeName() === "providerConfig",
      ),
    ).toMatchObject({ mandatory: true });
    expect(
      deliveryRun.options.find((option) => option.attributeName() === "action"),
    ).toMatchObject({ mandatory: true });
  });

  it("injects the provider config into a fake runner without public writes", async () => {
    const providerConfig = { merge: { enabled: false } };
    const actionPayload = { reason: "explicit invocation" };
    const adapter = { provider: "test" };
    const createAdapter = vi.fn(() => adapter);
    const runAction = vi.fn(async () => state());
    const readFileSync = vi.fn((file) => {
      if (file === "provider.json") return JSON.stringify(providerConfig);
      if (file === "payload.json") return JSON.stringify(actionPayload);
      throw new Error(`unexpected read: ${file}`);
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runArtifactsDeliveryRun(
      "delivery.json",
      {
        action: "run_gates",
        providerConfig: "provider.json",
        payloadFile: "payload.json",
        cwd: "C:/safe/worktree",
        expectedRevision: "7",
        expectedStateDigest: DIGEST,
        json: true,
      },
      { createAdapter, runAction, readFileSync },
    );

    expect(exitCode).toBe(0);
    expect(createAdapter).toHaveBeenCalledWith(
      { cwd: "C:/safe/worktree", config: providerConfig },
      {},
    );
    expect(runAction).toHaveBeenCalledWith(
      {
        statePath: "delivery.json",
        action: "run_gates",
        payload: actionPayload,
        expectedRevision: "7",
        expectedStateDigest: DIGEST,
        adapter,
      },
      {},
    );
    expect(readFileSync).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("surfaces an ambiguous provider failure as an unreplayed pending effect", async () => {
    const pendingEffect = {
      id: `sha256:${"e".repeat(64)}`,
      action: "create_pr",
    };
    const failure = Object.assign(new Error("provider response lost"), {
      pendingEffect,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runArtifactsDeliveryRun(
      "delivery.json",
      {
        action: "create_pr",
        providerConfig: "provider.json",
        json: true,
      },
      {
        readFileSync: () => "{}",
        createAdapter: () => ({}),
        runAction: vi.fn(async () => {
          throw failure;
        }),
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      error: "provider response lost",
      pendingEffect,
    });
    error.mockRestore();
  });
});
