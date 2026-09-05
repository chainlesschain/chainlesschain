import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { expect, it, vi } from "vitest";
import { openWorkbenchRollbackStore } from "../fixtures/evolution-workbench-rollback.js";
import { registerEvolutionWorkbenchCommands } from "../../src/commands/evolution-workbench.js";
import { createEvolutionWorkbenchCliHost } from "../../src/lib/evolution/evolution-workbench-cli-host.js";
import { createEvolutionWorkbenchRollbackRuntime } from "../../src/lib/evolution/evolution-workbench-rollback-ledger-adapter.js";
import { CcAppServer } from "../../src/lib/app-server/server.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { APP_SERVER_PROTOCOL_VERSION } from "../../src/lib/app-server/protocol.js";

it("delivers actual post-rollback Registry state through Commander and fixed App Server methods", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-registry-transport-"),
  );
  let server;
  try {
    const h = await openWorkbenchRollbackStore(root, { seed: true });
    const rollback = createEvolutionWorkbenchRollbackRuntime(h.adapterOptions);
    // Read-only transport acceptance: no human identity is fabricated here.
    // The real mutation below uses the fixture's explicitly test-only signer.
    const identity = vi.fn(() => {
      throw new Error("identity must not be requested by list/compare");
    });
    const host = createEvolutionWorkbenchCliHost({
      tenantId: h.descriptor.tenantId,
      projectionLoader: {
        load: h.reviewBridge.loadCurrentProjection.bind(h.reviewBridge),
      },
      projectionAuthority: {
        retain: h.reviewBridge.retainProjection.bind(h.reviewBridge),
      },
      identityProvider: { current: identity },
      batchExecutor: h.reviewBridge.createExecutor(),
      activeStateReader: rollback.activeStateReader,
      rollbackExecutor: rollback.rollbackExecutor,
    });
    const historical = h.run.load();
    await rollback.rollbackExecutor.execute(h.plan);
    const command = new Command().exitOverride();
    registerEvolutionWorkbenchCommands(command.command("evolution"), {
      workbenchHost: host,
    });
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    let cli;
    try {
      await command.parseAsync([
        "node",
        "cc",
        "evolution",
        "workbench",
        "list",
      ]);
      cli = JSON.parse(printed.mock.calls[0][0]);
    } finally {
      printed.mockRestore();
    }
    expect(cli.governance).toMatchObject({
      activeReleaseId: h.release.baseline.releaseDigest,
      lastKnownGoodReleaseId: h.release.baseline.releaseDigest,
    });
    expect(
      cli.candidates
        .filter((candidate) => candidate.actualUsage.active)
        .map((candidate) => candidate.candidateId),
    ).toEqual([h.release.baseline.candidateId]);
    server = new CcAppServer({
      send: async () => {},
      store: new MemoryRolloutStore(),
      evolutionWorkbenchHost: host,
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: APP_SERVER_PROTOCOL_VERSION,
        minimumProtocolVersion: 1,
        client: { name: "test-workbench-real-registry", version: "1" },
        features: [],
      },
    });
    const listed = await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "evolution/workbench/list",
      params: {},
    });
    expect(listed.error).toBeUndefined();
    expect(listed.result).toEqual(cli);
    const compared = await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "evolution/workbench/compare",
      params: {
        leftPacketDigest: h.packets[1].packetDigest,
        rightPacketDigest: h.packets[0].packetDigest,
      },
    });
    expect(compared.error).toBeUndefined();
    expect(compared.result).toEqual(
      await host.compare(h.packets[1].packetDigest, h.packets[0].packetDigest),
    );
    expect(h.run.load()).toEqual(historical);
    expect(identity).not.toHaveBeenCalled();
    expect(h.mutationRequests).toHaveLength(1);
  } finally {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
