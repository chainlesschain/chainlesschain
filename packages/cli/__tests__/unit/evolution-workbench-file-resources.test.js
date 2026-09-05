import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { workbenchFileResourceOptions } from "../fixtures/evolution-workbench-file-resources.js";
import { openWorkbenchRollbackStore } from "../fixtures/evolution-workbench-rollback.js";
import { openEvolutionWorkbenchFileResources } from "../../src/lib/evolution/evolution-workbench-file-resources.js";
import { createEvolutionWorkbenchRegistrySource } from "../../src/lib/evolution/evolution-workbench-registry-source.js";

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-files-"),
  );
  roots.push(root);
  const options = workbenchFileResourceOptions(root, {
    tenantId: "tenant:workbench-rollback",
    streamId: "workbench-rollback",
    runId: "run:workbench-rollback",
    skillName: "safe-refactor",
    authorityId: "authority:workbench-rollback-test",
    revision: 1,
    handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
  });
  return { root, options };
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function inventory(root) {
  return fs.readdirSync(root, { recursive: true }).sort();
}

it("rejects a regular file used as a directory before creating other stores", () => {
  const { root, options } = fixture();
  fs.writeFileSync(options.storage.artifactDir, "not a directory", {
    flag: "wx",
  });
  const before = inventory(root);
  expect(() => openEvolutionWorkbenchFileResources(options)).toThrow(
    /file type/,
  );
  expect(inventory(root)).toEqual(before);
});

it("opens actual independent readers on empty persistence without seeding a run, identity or release", () => {
  const { options } = fixture();
  const first = openEvolutionWorkbenchFileResources(options);
  const r = first.runtimeResources;
  expect(r.ledger).not.toBe(r.verifierLedger);
  expect(r.releaseRegistry).not.toBe(r.verifierReleaseRegistry);
  expect(r.transactionLedger).not.toBe(r.verifierTransactionLedger);
  const source = createEvolutionWorkbenchRegistrySource(r);
  expect(source.load().registry.active).toBeNull();
  expect(source.load().registry.operations).toEqual([]);
  const before = r.ledger.verify();
  const reopened = openEvolutionWorkbenchFileResources(options);
  expect(reopened.runtimeResources.ledger.verify()).toEqual(before);
  expect(Object.keys(first).sort()).toEqual([
    "mutationPorts",
    "runtimeResources",
  ]);
  expect(first).not.toHaveProperty("workbenchHost");
  expect(r).not.toHaveProperty("identityProvider");
  expect(r).not.toHaveProperty("rollbackProvider");
  expect(Object.isFrozen(r)).toBe(true);
});

it("reopens real promoted releases and their complete authenticated history from existing storage", async () => {
  const { root, options } = fixture();
  const seeded = await openWorkbenchRollbackStore(root, { seed: true });
  const head = seeded.backend.ledger.verify();
  const { runtimeResources: r } = openEvolutionWorkbenchFileResources(options);
  const actual = createEvolutionWorkbenchRegistrySource(r).load();
  expect(actual.registry.active.releaseDigest).toBe(
    seeded.release.readActive().release.releaseDigest,
  );
  expect(actual.registry.active.lastKnownGoodReleaseDigest).toBe(
    seeded.release.baseline.releaseDigest,
  );
  expect(actual.registry.operations).toHaveLength(2);
  expect(
    actual.registry.operations.every(
      (operation) => operation.status === "committed",
    ),
  ).toBe(true);
  expect(r.ledger.verify()).toEqual(head);

  // A freshly reopened store must honor current key revocation, not just old
  // constructor success or previously authenticated on-disk signatures.
  options.authorities.ledger.verifier = { verify: () => false };
  expect(() => openEvolutionWorkbenchFileResources(options)).toThrow();
  expect(seeded.backend.ledger.verify()).toEqual(head);
});

it.each([
  [
    "missing authority",
    (o) => {
      delete o.authorities.releaseDurability;
    },
    /missing/,
  ],
  [
    "replaced storage",
    (o) => {
      o.ledger = {};
    },
    /unsupported/,
  ],
  [
    "relative path",
    (o) => {
      o.storage.artifactDir = "relative";
    },
    /absolute/,
  ],
  [
    "nested witness",
    (o) => {
      o.storage.witnessFilePath = path.join(
        o.storage.ledgerRootDir,
        "witness.json",
      );
    },
    /non-overlapping/,
  ],
  [
    "same authority",
    (o) => {
      o.authorities.witness = o.authorities.ledger;
    },
    /independent/,
  ],
  [
    "same signer",
    (o) => {
      o.authorities.witness.signer = o.authorities.ledger.signer;
    },
    /independent/,
  ],
  [
    "invalid security option",
    (o) => {
      o.secure = "false";
    },
    /boolean/,
  ],
  [
    "invalid clock",
    (o) => {
      o.now = () => NaN;
    },
    /clock/,
  ],
  [
    "invalid trust key",
    (o) => {
      o.authorities.ledger.trust = {
        ...o.authorities.ledger.trust,
        keyId: "not-a-key-uri",
      };
    },
    /trust/,
  ],
  [
    "invalid artifact scope",
    (o) => {
      o.descriptor.artifactTenantId = "artifact@other";
    },
    /artifactTenantId/,
  ],
])("rejects %s before opening any storage", (_label, change, expected) => {
  const { root, options } = fixture();
  const before = inventory(root);
  const sign = vi.spyOn(options.authorities.ledger.signer, "sign");
  change(options);
  expect(() => openEvolutionWorkbenchFileResources(options)).toThrow(expected);
  expect(inventory(root)).toEqual(before);
  expect(sign).not.toHaveBeenCalled();
});

it("rejects accessors and proxies without evaluating attacker-controlled properties", () => {
  const { root, options } = fixture();
  const before = inventory(root);
  const getter = vi.fn(() => options.storage);
  const input = { ...options };
  Object.defineProperty(input, "storage", { get: getter, enumerable: true });
  expect(() => openEvolutionWorkbenchFileResources(input)).toThrow(/own data/);
  expect(getter).not.toHaveBeenCalled();
  const trap = vi.fn(() => {
    throw new Error("proxy evaluated");
  });
  expect(() =>
    openEvolutionWorkbenchFileResources(new Proxy(options, { ownKeys: trap })),
  ).toThrow(/data record/);
  expect(trap).not.toHaveBeenCalled();
  expect(inventory(root)).toEqual(before);
});

it("rejects a junction/symlink ancestor before following it to a different storage root", () => {
  const { root, options } = fixture();
  const target = path.join(root, "actual");
  const alias = path.join(root, "alias");
  fs.mkdirSync(target);
  fs.symlinkSync(
    target,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  options.storage.artifactDir = path.join(alias, "artifacts");
  const before = inventory(root);
  expect(() => openEvolutionWorkbenchFileResources(options)).toThrow(/aliases/);
  expect(inventory(root)).toEqual(before);
  expect(fs.readdirSync(target)).toEqual([]);
});
