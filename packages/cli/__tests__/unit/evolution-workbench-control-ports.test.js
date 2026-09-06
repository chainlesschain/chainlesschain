import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  openWorkbenchRollbackStore,
  authorizationFor,
  NOW,
} from "../fixtures/evolution-workbench-rollback.js";
import { workbenchFileResourceOptions } from "../fixtures/evolution-workbench-file-resources.js";
import { workbenchControlOptions } from "../fixtures/evolution-workbench-control-ports.js";
import {
  workbenchRuntimeOptions,
  workbenchTestIdentity,
} from "../fixtures/evolution-workbench-runtime.js";
import { openEvolutionWorkbenchFileResources } from "../../src/lib/evolution/evolution-workbench-file-resources.js";
import { createEvolutionWorkbenchControlPorts } from "../../src/lib/evolution/evolution-workbench-control-ports.js";
import { createEvolutionWorkbenchRuntime } from "../../src/lib/evolution/evolution-workbench-runtime.js";
import { consumeWorkbenchRollbackMutationContext } from "../../src/lib/evolution/evolution-workbench-rollback-ledger-adapter.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function fixture(storeOptions = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-workbench-control-"),
  );
  roots.push(root);
  const h = await openWorkbenchRollbackStore(root, {
    seed: true,
    ...storeOptions,
  });
  let now = NOW;
  const options = workbenchFileResourceOptions(root, h.descriptor);
  options.now = () => now;
  const files = openEvolutionWorkbenchFileResources(options);
  const controls = workbenchControlOptions(h, files);
  const identityProvider = workbenchTestIdentity(h, root, true);
  return {
    fileOptions: options,
    h,
    files,
    controls,
    advance: (ms) => {
      now += ms;
    },
    async runtime(ports = createEvolutionWorkbenchControlPorts(controls)) {
      return createEvolutionWorkbenchRuntime(
        workbenchRuntimeOptions(h, {
          ...files.runtimeResources,
          ...ports,
          identityProvider,
        }),
      );
    },
    rollback: (runtime) =>
      runtime.workbenchHost.rollback({
        fromPacketDigest: h.packets[1].packetDigest,
        toPacketDigest: h.packets[0].packetDigest,
        reason: "Test human requests the exact approved LKG.",
      }),
  };
}

it("uses genuine same-Ledger authorization and consumes a live context once before actual rollback", async () => {
  const f = await fixture();
  const source = vi.spyOn(f.controls.rollbackReceiptSource, "resolve");
  const ports = createEvolutionWorkbenchControlPorts(f.controls);
  const otherFiles = openEvolutionWorkbenchFileResources(f.fileOptions);
  const otherPorts = createEvolutionWorkbenchControlPorts(
    workbenchControlOptions(f.h, otherFiles),
  );
  const authorize = ports.authorizationProvider.authorizeRollback;
  await expect(
    authorize({ tenantId: f.h.descriptor.tenantId }),
  ).rejects.toThrow(/live same-store/);
  expect(source).not.toHaveBeenCalled();
  let request;
  let saved;
  const runtime = await f.runtime({
    ...ports,
    authorizationProvider: {
      async authorizeRollback(expected) {
        saved = expected;
        for (const replacement of [
          { runId: "run:other" },
          { streamId: "other-stream" },
        ])
          expect(() =>
            consumeWorkbenchRollbackMutationContext(
              expected,
              f.files.runtimeResources.releaseRegistry,
              f.files.runtimeResources.ledger,
              { ...f.controls.descriptor, ...replacement },
            ),
          ).toThrow(/same-scope/);
        await expect(
          otherPorts.authorizationProvider.authorizeRollback(expected),
        ).rejects.toThrow(/live same-store/);
        await expect(authorize({ ...expected })).rejects.toThrow(
          /live same-store/,
        );
        const result = await authorize(expected);
        request = result.request;
        await expect(authorize(expected)).rejects.toThrow(/live same-store/);
        return result;
      },
    },
  });
  expect(Object.keys(ports).sort()).toEqual([
    "authorizationProvider",
    "rollbackProvider",
  ]);
  await f.rollback(runtime);
  expect(source).toHaveBeenCalledOnce();
  expect(request.nonce).toMatch(/^[a-f0-9]{64}$/);
  expect(Date.parse(request.expiresAt)).toBe(NOW + 120_000);
  expect(request.receipts.policyReceipt).toBe(saved.policyReceipt);
  expect(request.operation).toBe("rollback");
  expect(f.h.release.readActive().release.releaseDigest).toBe(
    f.h.release.baseline.releaseDigest,
  );
  expect(f.h.release.readActive().state.revision).toBe(3);
  expect(
    f.files.runtimeResources.ledger
      .read()
      .filter(
        (event) =>
          event.type === "skill.mutation.nonce" &&
          event.correlationId === request.operationId,
      ),
  ).toHaveLength(1);
  await expect(authorize(saved)).rejects.toThrow(/live same-store/);
  const head = f.files.runtimeResources.ledger.verify();
  const restarted = await f.runtime(ports);
  expect(restarted.recovery.rollbacksSettled).toBe(0);
  expect(
    (await restarted.workbenchHost.list()).governance.activeReleaseId,
  ).toBe(f.h.release.baseline.releaseDigest);
  expect(f.files.runtimeResources.ledger.verify()).toEqual(head);
  expect(source).toHaveBeenCalledOnce();
});

it("rejects cloned resources, fake candidates, descriptor replacement and accessors before issuing authority", async () => {
  const f = await fixture();
  const before = f.files.runtimeResources.ledger.verify();
  const source = vi.spyOn(f.controls.rollbackReceiptSource, "resolve");
  const input = f.controls;
  const combinedAuthority = {
    ...input.rollbackReceiptSource,
    ...input.receiptVerifier,
  };
  const getter = vi.fn();
  for (const changed of [
    { ...input, fileResources: { ...f.files } },
    { ...input, candidateRegistry: { ...input.candidateRegistry } },
    { ...input, descriptor: { ...input.descriptor, tenantId: "tenant:other" } },
    { ...input, rollbackProvider: {} },
    {
      ...input,
      receiptVerifier: combinedAuthority,
      rollbackReceiptSource: combinedAuthority,
    },
    Object.defineProperty({ ...input }, "principalResolver", {
      enumerable: true,
      get: getter,
    }),
  ])
    expect(() => createEvolutionWorkbenchControlPorts(changed)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
  expect(f.files.runtimeResources.ledger.verify()).toEqual(before);
});

it("invalidates an unconsumed context when an authority callback fails", async () => {
  const f = await fixture();
  const ports = createEvolutionWorkbenchControlPorts(f.controls);
  let saved;
  const runtime = await f.runtime({
    ...ports,
    authorizationProvider: {
      async authorizeRollback(expected) {
        saved = expected;
        throw new Error("test authority stopped");
      },
    },
  });
  await expect(f.rollback(runtime)).rejects.toThrow("test authority stopped");
  await expect(
    ports.authorizationProvider.authorizeRollback(saved),
  ).rejects.toThrow(/live same-store/);
  expect(f.h.release.readActive().state.revision).toBe(2);
});

it.each([
  "policy replacement",
  "receipt timeout",
  "principal denial",
  "receipt denial",
  "active drift",
  "active drift during verification",
])("rejects %s without performing the prepared rollback", async (mode) => {
  const f = await fixture(
    mode === "receipt timeout"
      ? {
          authorizeHuman: (plan) =>
            authorizationFor(plan, {
              expiresAt: new Date(NOW + 30_000).toISOString(),
            }),
        }
      : {},
  );
  const resolve = f.controls.rollbackReceiptSource.resolve;
  let laterReleaseDigest = null;
  async function promoteLater() {
    const candidate = f.h.release.createDerivedCandidate();
    await f.h.release.promoteCandidate(
      "control-port-later-promotion",
      candidate.candidateId,
    );
    laterReleaseDigest = f.h.release.readActive().release.releaseDigest;
  }
  f.controls.rollbackReceiptSource = {
    resolve: async (request) => {
      const result = resolve(request);
      if (mode === "policy replacement")
        return { ...result, policyReceipt: "unbound-policy" };
      if (mode === "receipt timeout") {
        expect(Date.parse(request.mutation.expiresAt)).toBe(NOW + 30_000);
        f.advance(30_001);
      }
      if (mode === "active drift") await promoteLater();
      return result;
    },
  };
  if (mode === "principal denial")
    f.controls.principalResolver = { resolve: () => null };
  if (mode === "receipt denial")
    f.controls.receiptVerifier = { verify: () => false };
  if (mode === "active drift during verification") {
    const verify = f.controls.receiptVerifier.verify;
    f.controls.receiptVerifier = {
      async verify(input) {
        const result = await verify(input);
        await promoteLater();
        return result;
      },
    };
  }
  const runtime = await f.runtime();
  const messages = {
    "policy replacement": /missing or replaced fields/,
    "receipt timeout": /authorization expired/,
    "principal denial": /principal/i,
    "receipt denial": /receipt/i,
    "active drift": /current release no longer matches/,
    "active drift during verification": /current release no longer matches/,
  };
  await expect(f.rollback(runtime)).rejects.toThrow(messages[mode]);
  const active = f.h.release.readActive();
  expect(active.state.revision).toBe(mode.startsWith("active drift") ? 3 : 2);
  expect(active.release.releaseDigest).toBe(
    laterReleaseDigest ?? f.h.release.candidateRelease.releaseDigest,
  );
  expect(
    f.h.backend.ledger
      .read()
      .filter(
        (event) => event.type === "evolution.workbench.rollback.committed",
      ),
  ).toHaveLength(0);
});
