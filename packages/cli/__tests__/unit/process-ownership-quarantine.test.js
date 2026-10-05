import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

function child(pid = 456) {
  return Object.assign(new EventEmitter(), {
    pid,
    ownedProcessTreeClosed: new Promise(() => {}),
  });
}

describe("Broker process ownership quarantine", () => {
  it("does not confuse spawn or ordinary signal errors with lost tree ownership", async () => {
    const ledger = await import(
      "../../src/lib/process-execution-broker/process-ownership-quarantine.js"
    );
    const proc = child();
    ledger.observeProcessOwnership(proc, "owned");
    proc.emit("error", new Error("signal failed"));
    proc.emit("cleanup:unconfirmed", { cleanup: { confirmed: true } });
    const noSpawn = child(undefined);
    noSpawn.pid = undefined;
    noSpawn.on("error", () => {});
    ledger.observeProcessOwnership(noSpawn, "not-started");
    noSpawn.emit("cleanup:unconfirmed", { cleanup: { confirmed: false } });
    expect(ledger.getProcessOwnershipStatus().blocked).toBe(false);
    expect(() => ledger.assertProcessOwnershipAvailable()).not.toThrow();
  });

  it("fences every process API before native launch, including new Brokers and reentry", async () => {
    const ledger = await import(
      "../../src/lib/process-execution-broker/process-ownership-quarantine.js"
    );
    const { default: broker } = await import(
      "../../src/lib/process-execution-broker/index.js"
    );
    const proc = child();
    const native = vi.fn(() => {
      throw new Error("native launch must not run");
    });
    broker._native = { spawn: native, spawnSync: native };
    ledger.observeProcessOwnership(proc, "owned");
    const launches = [
      () => broker.spawn("node", [], { policy: "allow" }),
      () => broker.spawnSync("node", [], { policy: "allow" }),
      () => broker.spawnPty({ spawn: native }, "node"),
      () => broker.exec("node", {}),
      () => broker.execSync("node"),
      () => broker.execFile("node", []),
      () => broker.execFileSync("node", []),
      () => broker.fork("fixture.cjs"),
      () => broker.beginWorkspaceTransaction({}),
      () => broker.recoverWorkspaceTransactions({}),
      () => broker.restoreWorkspaceTransaction("fixture"),
      () => broker.undoWorkspaceTransactionRestore("fixture"),
      () =>
        new broker.constructor().spawn("node", [], {
          cwd: "/different",
          policy: "allow",
        }),
    ];
    let reentryObserved = false;
    proc.on("error", () => {
      reentryObserved = true;
      for (const launch of launches)
        expect(launch).toThrow(
          expect.objectContaining({
            code: ledger.PROCESS_OWNERSHIP_UNCONFIRMED,
            recoveryRequired: true,
            executionStarted: false,
          }),
        );
    });
    proc.ownedProcessTreeEvidence = { cleanup: { confirmed: false } };
    proc.emit(
      "error",
      Object.assign(new Error("owner lost"), {
        code: "EXTERNAL_AGENT_CLEANUP_UNCONFIRMED",
      }),
    );
    proc.emit("cleanup:unconfirmed", proc.ownedProcessTreeEvidence);
    expect(reentryObserved).toBe(true);
    expect(native).not.toHaveBeenCalled();
    broker.flushAuditLog();
    const snapshot = broker.getProcessOwnershipStatus();
    expect(snapshot).toEqual({
      blocked: true,
      unresolvedExecutionIds: ["owned"],
      recoveryRequired: true,
      durable: false,
      restartSafe: false,
      recoverableExecutionIds: [],
    });
    snapshot.unresolvedExecutionIds.length = 0;
    proc.emit("close", 0);
    expect(broker.getProcessOwnershipStatus().unresolvedExecutionIds).toEqual([
      "owned",
    ]);
    expect(launches[0]).toThrow();
  });
});
