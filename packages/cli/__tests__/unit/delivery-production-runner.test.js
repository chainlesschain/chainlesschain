import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeliveryFlow,
  DELIVERY_ACTION,
  settleDeliveryAction,
} from "../../src/lib/delivery-coordinator.js";
import {
  runDeliveryProductionAction,
  writeDeliveryProductionState,
} from "../../src/lib/delivery-production-runner.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const NOW = "2026-08-10T00:00:00.000Z";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function config() {
  return {
    flowId: "delivery-production-test",
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
    requiredGates: [
      { id: "cli-ci", always: true, matrix: ["linux", "windows"] },
    ],
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
    policy: { autoMergeEnabled: true },
  };
}

function passedGates() {
  return {
    commitSha: HEAD,
    results: [
      {
        id: "cli-ci",
        status: "passed",
        commitSha: HEAD,
        matrix: [
          { id: "linux", status: "passed", commitSha: HEAD },
          { id: "windows", status: "passed", commitSha: HEAD },
        ],
      },
    ],
    sideEffects: [],
  };
}

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-delivery-production-runner-"),
  );
  temporaryDirectories.push(directory);
  const statePath = path.join(directory, "flow.json");
  const state = createDeliveryFlow(config(), { now: NOW });
  writeDeliveryProductionState(statePath, state);
  return { directory, statePath, state };
}

function readState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

describe("writeDeliveryProductionState durability", () => {
  it("fsyncs the file before rename and the parent directory after rename", () => {
    const state = createDeliveryFlow(config(), { now: NOW });
    const target = path.resolve(path.join(os.tmpdir(), "durable-flow.json"));
    const temporary = `${target}.${process.pid}.fixed.tmp`;
    const events = [];
    let opens = 0;

    writeDeliveryProductionState(target, state, {
      platform: "linux",
      randomUUID: () => "fixed",
      openSync: (file, flags, mode) => {
        opens += 1;
        events.push(["open", file, flags, mode]);
        return opens === 1 ? 11 : 12;
      },
      writeFileSync: (descriptor, _body, encoding) =>
        events.push(["write", descriptor, encoding]),
      fsyncSync: (descriptor) => events.push(["fsync", descriptor]),
      closeSync: (descriptor) => events.push(["close", descriptor]),
      renameSync: (from, to) => events.push(["rename", from, to]),
      rmSync: (file) => events.push(["rm", file]),
    });

    expect(events).toEqual([
      ["open", temporary, "wx", 0o600],
      ["write", 11, "utf8"],
      ["fsync", 11],
      ["close", 11],
      ["rename", temporary, target],
      ["open", path.dirname(target), "r", undefined],
      ["fsync", 12],
      ["close", 12],
    ]);
  });

  it("does not rename a temp file whose file fsync failed", () => {
    const state = createDeliveryFlow(config(), { now: NOW });
    const renameSync = vi.fn();
    const rmSync = vi.fn();

    expect(() =>
      writeDeliveryProductionState("durable-flow.json", state, {
        platform: "linux",
        randomUUID: () => "fixed",
        openSync: () => 11,
        writeFileSync: () => {},
        fsyncSync: () => {
          throw new Error("file fsync failed");
        },
        closeSync: () => {},
        renameSync,
        rmSync,
      }),
    ).toThrow("file fsync failed");
    expect(renameSync).not.toHaveBeenCalled();
    expect(rmSync).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown durability outcome when parent-directory fsync fails", () => {
    const state = createDeliveryFlow(config(), { now: NOW });
    const renameSync = vi.fn();
    const rmSync = vi.fn();
    let opens = 0;

    expect(() =>
      writeDeliveryProductionState("durable-flow.json", state, {
        platform: "linux",
        randomUUID: () => "fixed",
        openSync: () => (++opens === 1 ? 11 : 12),
        writeFileSync: () => {},
        fsyncSync: (descriptor) => {
          if (descriptor === 12) throw new Error("directory fsync failed");
        },
        closeSync: () => {},
        renameSync,
        rmSync,
      }),
    ).toThrow("directory fsync failed");
    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(rmSync).not.toHaveBeenCalled();
  });
});

describe("runDeliveryProductionAction", () => {
  it("persists the pending effect before invoking the adapter, then settles it", async () => {
    const { statePath, state: initial } = fixture();
    const adapter = {
      runGates: vi.fn(async (payload, context) => {
        const durable = readState(statePath);
        expect(durable.pendingEffect).toMatchObject({
          id: context.effect.id,
          action: DELIVERY_ACTION.RUN_GATES,
        });
        expect(durable.revision).toBe(context.state.revision);
        expect(payload.commitSha).toBe(HEAD);
        return passedGates();
      }),
    };

    const settled = await runDeliveryProductionAction({
      statePath,
      action: DELIVERY_ACTION.RUN_GATES,
      adapter,
      expectedRevision: initial.revision,
      expectedStateDigest: initial.stateDigest,
    });

    expect(adapter.runGates).toHaveBeenCalledTimes(1);
    expect(settled).toMatchObject({ phase: "preview", pendingEffect: null });
    expect(readState(statePath)).toMatchObject({
      revision: settled.revision,
      stateDigest: settled.stateDigest,
      phase: "preview",
      pendingEffect: null,
    });
  });

  it("keeps an adapter exception pending and never blindly replays it", async () => {
    const { statePath } = fixture();
    const failure = new Error("provider connection dropped");
    const adapter = {
      runGates: vi.fn(async () => {
        expect(readState(statePath).pendingEffect).not.toBeNull();
        throw failure;
      }),
    };

    await expect(
      runDeliveryProductionAction({
        statePath,
        action: DELIVERY_ACTION.RUN_GATES,
        adapter,
      }),
    ).rejects.toMatchObject({
      message: "provider connection dropped",
      pendingEffect: { action: DELIVERY_ACTION.RUN_GATES },
      deliveryState: { pendingEffect: { action: DELIVERY_ACTION.RUN_GATES } },
    });
    const pending = readState(statePath);
    expect(pending.pendingEffect).toMatchObject({
      action: DELIVERY_ACTION.RUN_GATES,
    });

    await expect(
      runDeliveryProductionAction({
        statePath,
        action: DELIVERY_ACTION.RUN_GATES,
        adapter,
      }),
    ).rejects.toThrow(/already pending; reconcile it/);
    expect(adapter.runGates).toHaveBeenCalledTimes(1);
    expect(readState(statePath).stateDigest).toBe(pending.stateDigest);
  });

  it("does not call the adapter when pending-state persistence fails", async () => {
    const { statePath, state: initial } = fixture();
    const adapter = { runGates: vi.fn(async () => passedGates()) };

    await expect(
      runDeliveryProductionAction(
        {
          statePath,
          action: DELIVERY_ACTION.RUN_GATES,
          adapter,
        },
        {
          writeState: () => {
            throw new Error("request write failed");
          },
        },
      ),
    ).rejects.toThrow("request write failed");

    expect(adapter.runGates).not.toHaveBeenCalled();
    expect(readState(statePath)).toMatchObject({
      revision: initial.revision,
      stateDigest: initial.stateDigest,
      pendingEffect: null,
    });
  });

  it("leaves the durable request pending when settlement persistence fails", async () => {
    const { statePath } = fixture();
    const adapter = { runGates: vi.fn(async () => passedGates()) };
    let writes = 0;
    const writeState = (target, state) => {
      writes += 1;
      if (writes === 2) throw new Error("settlement write failed");
      return writeDeliveryProductionState(target, state);
    };

    await expect(
      runDeliveryProductionAction(
        {
          statePath,
          action: DELIVERY_ACTION.RUN_GATES,
          adapter,
        },
        { writeState },
      ),
    ).rejects.toMatchObject({
      message: "settlement write failed",
      pendingEffect: { action: DELIVERY_ACTION.RUN_GATES },
    });

    expect(adapter.runGates).toHaveBeenCalledTimes(1);
    expect(readState(statePath)).toMatchObject({
      phase: "gates",
      pendingEffect: { action: DELIVERY_ACTION.RUN_GATES },
    });
  });

  it("refuses to overwrite an exact effect settled concurrently", async () => {
    const { statePath } = fixture();
    const adapter = {
      runGates: vi.fn(async (_payload, { effect }) => {
        const pending = readState(statePath);
        const externallySettled = settleDeliveryAction(
          pending,
          effect.id,
          passedGates(),
          { now: "2026-08-10T00:00:01.000Z" },
        );
        writeDeliveryProductionState(statePath, externallySettled);
        return passedGates();
      }),
    };

    await expect(
      runDeliveryProductionAction({
        statePath,
        action: DELIVERY_ACTION.RUN_GATES,
        adapter,
      }),
    ).rejects.toThrow(/stale delivery revision before settlement/);

    expect(readState(statePath)).toMatchObject({
      phase: "preview",
      pendingEffect: null,
    });
  });

  it("checks caller revision/digest and adapter capability before requesting", async () => {
    const { statePath, state } = fixture();
    const adapter = { runGates: vi.fn(async () => passedGates()) };

    await expect(
      runDeliveryProductionAction({
        statePath,
        action: DELIVERY_ACTION.RUN_GATES,
        adapter,
        expectedRevision: state.revision + 1,
        expectedStateDigest: state.stateDigest,
      }),
    ).rejects.toThrow(/stale delivery revision/);
    expect(adapter.runGates).not.toHaveBeenCalled();
    expect(readState(statePath).pendingEffect).toBeNull();

    await expect(
      runDeliveryProductionAction({
        statePath,
        action: DELIVERY_ACTION.RUN_PREVIEW,
        adapter: {},
      }),
    ).rejects.toThrow(/does not implement runPreview/);
    expect(readState(statePath).pendingEffect).toBeNull();
  });
});
