import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openRrsiPmBridgeFixture } from "../fixtures/rrsi-pm-bridge.js";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";

const roots = [];
const worker = fileURLToPath(
  new URL("../fixtures/rrsi-pm-bridge-process.mjs", import.meta.url),
);
function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(tmpdir()), "rrsi-pm-bridge-process-"),
  );
  roots.push(root);
  return { root, ...openRrsiPmBridgeFixture(root) };
}
function invoke(root, mode) {
  return spawnSync(process.execPath, [worker, root, mode], {
    encoding: "utf8",
    timeout: 20_000,
  });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        fs.realpathSync.native(tmpdir()) + path.sep + "rrsi-pm-bridge-process-",
      )
    )
      throw new Error("unsafe fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("RRSI PM actual process bridge recovery", () => {
  it("persists executed PM evidence and denies replay in a newly composed process", () => {
    const value = fixture();
    const run = invoke(value.root, "run");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      calls: { run: 1, grade: 1, tool: 1 },
      result: { observationPersistence: "persisted", pmReceiptsVerified: true },
    });
    const recovered = invoke(value.root, "recover");
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      replayDenied: true,
      newlyCommitted: false,
      calls: { run: 0, grade: 0, tool: 0 },
    });
    expect(openRrsiHistoryStore(value.root).adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [
        {
          status: "unknown",
          executionObservation: { result: { receiptsAuthenticated: true } },
        },
      ],
    });
  });

  it("retains full ceilings after hard exit between dispatch and host invocation", () => {
    const value = fixture();
    const crashed = invoke(value.root, "crash-dispatch");
    expect(crashed.status).toBe(71);
    const status = openRrsiHistoryStore(value.root).adapter.inspect();
    expect(status).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "100000", maxExecutions: "2" },
      executions: [
        {
          status: "dispatch-intent",
          dispatched: true,
          executionObservation: null,
        },
      ],
    });
    const recovered = invoke(value.root, "recover");
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      replayDenied: true,
      newlyCommitted: false,
      calls: { run: 0, grade: 0 },
    });
  });

  it("recovers original PM receipts after hard exit following observation commit", () => {
    const value = fixture();
    const crashed = invoke(value.root, "crash-observation");
    expect(crashed.status).toBe(72);
    expect(openRrsiHistoryStore(value.root).adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [
        {
          status: "unknown",
          executionObservation: {
            independentlyReverified: false,
            result: { receiptsAuthenticated: true },
          },
        },
      ],
    });
    const recovered = invoke(value.root, "recover");
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      replayDenied: true,
      calls: { run: 0, grade: 0 },
    });
  });
});
