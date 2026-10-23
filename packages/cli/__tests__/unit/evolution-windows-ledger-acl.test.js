import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { createLocalUiEvolutionFileSystem } from "../../src/lib/evolution/evolution-windows-directory-durability.js";

const roots = [];
const originalUv = Object.getOwnPropertyDescriptor(process.versions, "uv");
afterEach(() => {
  Object.defineProperty(process.versions, "uv", originalUv);
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== fs.realpathSync.native(os.tmpdir()) ||
      !path.basename(resolved).startsWith("cc-ledger-acl-")
    ) {
      throw new Error("unsafe ledger ACL test cleanup");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

function ledger({
  uvVersion = "1.49.1",
  mutateOpened = null,
  highInode = null,
  observed = {},
} = {}) {
  Object.defineProperty(process.versions, "uv", {
    ...originalUv,
    value: uvVersion,
  });
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-ledger-acl-"),
  );
  roots.push(root);
  const config = evolutionDurableStoreConfiguration(root);
  const fsImpl = createLocalUiEvolutionFileSystem();
  const descriptors = new Map();
  observed.descriptors = descriptors;
  fsImpl.openSync = (target, flags, ...args) => {
    const fd = fs.openSync(target, flags, ...args);
    descriptors.set(fd, flags);
    return fd;
  };
  fsImpl.closeSync = (fd) => {
    descriptors.delete(fd);
    return fs.closeSync(fd);
  };
  fsImpl.fstatSync = (fd, options) => {
    const stat = fs.fstatSync(fd, options);
    if (
      mutateOpened &&
      options?.bigint &&
      stat.isFile() &&
      (descriptors.get(fd) & fs.constants.O_RDWR) !== 0
    ) {
      observed.mutated = true;
      mutateOpened(stat);
    }
    return stat;
  };
  fsImpl.lstatSync = (...args) => {
    const stat = fs.lstatSync(...args);
    // Project the affected libuv regular-file path device without requiring
    // host ByName support; all descriptors and native ACLs remain real.
    if (stat.isFile()) stat.dev = typeof stat.dev === "bigint" ? 0n : 0;
    if (stat.isFile() && highInode !== null) {
      stat.ino = typeof stat.ino === "bigint" ? highInode : Number(highInode);
    }
    return stat;
  };
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "windows-acl-test-witness",
    ledgerAuthority: config.ledgerAuthority,
    witnessAuthority: config.witnessAuthority,
    artifactResolver: () => {
      throw new Error("empty ledger must not resolve artifacts");
    },
    secure: true,
    fsImpl,
    clock: config.clock,
  });
  return backend.ledger;
}

describe.skipIf(process.platform !== "win32")(
  "Windows ledger ACL identity",
  () => {
    it("bootstraps through genuine ACL verification with affected path-device projection", () => {
      const observed = {};
      expect(ledger({ observed }).verify()).toMatchObject({
        status: "verified",
        sequence: 0,
      });
      expect(observed.descriptors.size).toBe(0);
    }, 60_000);
    it("rejects a path-device discrepancy on fixed libuv", () => {
      const observed = {};
      expect(() => ledger({ uvVersion: "1.51.0", observed })).toThrow(
        "ledger file identity changed during Windows ACL verification",
      );
      expect(observed.descriptors.size).toBe(0);
    }, 60_000);
    it.each(["dev", "ino", "ctimeNs", "uid", "birthtimeMs", "birthtimeNs"])(
      "rejects a changed handle %s and closes its descriptors",
      (field) => {
        const observed = {};
        const highInode = field === "ino" ? (1n << 60n) + 1n : null;
        if (highInode !== null)
          expect(Number(highInode)).toBe(Number(highInode + 1n));
        expect(() =>
          ledger({
            observed,
            highInode,
            mutateOpened: (stat) => {
              stat[field] =
                (highInode ?? stat[field]) +
                (field === "birthtimeNs" ? 100n : 1n);
            },
          }),
        ).toThrow(
          "ledger file identity changed during Windows ACL verification",
        );
        expect(observed.mutated).toBe(true);
        expect(observed.descriptors.size).toBe(0);
      },
      60_000,
    );
    it("rejects timestamp drift after the ACL descriptor is flushed", () => {
      const observed = {};
      let reads = 0;
      expect(() =>
        ledger({
          observed,
          mutateOpened: (stat) => {
            if (++reads === 2) stat.ctimeNs += 1n;
          },
        }),
      ).toThrow("ledger file identity changed during Windows ACL verification");
      expect(reads).toBe(2);
      expect(observed.descriptors.size).toBe(0);
    }, 60_000);
    it("rejects a Number fallback in the opened descriptor", () => {
      const observed = {};
      expect(() =>
        ledger({
          observed,
          mutateOpened: (stat) => {
            stat.ino = Number(stat.ino);
          },
        }),
      ).toThrow(
        "published ledger descriptor requires full-precision stat fields",
      );
      expect(observed.descriptors.size).toBe(0);
    }, 60_000);
  },
);
