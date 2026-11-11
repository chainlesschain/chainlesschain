import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvolutionLedgerManifestAuthority } from "../../src/lib/evolution/evolution-ledger-manifest-chain.js";
import {
  createEvolutionLedgerFileManifestCatalogBackend as createCatalogBackend,
  captureEvolutionLedgerFileManifestCatalogDirectoryBoundary as captureRawCatalog,
} from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import {
  createEvolutionLedgerFileManifestHeadBackend as createHeadBackend,
  captureEvolutionLedgerFileManifestHeadDirectoryBoundary as captureRawHead,
  captureEvolutionLedgerFileManifestHeadPortsDirectoryBoundary as captureHeadPorts,
} from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import {
  createEvolutionLedgerManifestCatalog,
  captureEvolutionLedgerManifestCatalogDirectoryBoundary as captureCatalog,
} from "../../src/lib/evolution/evolution-ledger-manifest-catalog.js";
import {
  createEvolutionLedgerManifestHeadStore,
  captureEvolutionLedgerManifestHeadStoreDirectoryBoundary as captureHead,
} from "../../src/lib/evolution/evolution-ledger-manifest-head-store.js";

const temp = fs.realpathSync.native(os.tmpdir());
const roots = [];
const scope = {
  tenantId: "ownership-test",
  ledgerId: "ownership-ledger",
  epoch: "ownership-epoch",
  maximumEventsPerSegment: 8,
};
const authority = createEvolutionLedgerManifestAuthority({
  descriptor: {
    algorithm: "test-signature",
    authorityId: "ownership-test",
    revision: 1,
  },
  sign: () => "TEST ONLY",
  verify: ({ signature }) => signature === "TEST ONLY",
});
const catalog = (backend) =>
  createEvolutionLedgerManifestCatalog({
    descriptor: scope,
    manifestAuthority: authority,
    backend,
  });
const head = (load, compareAndSet) =>
  createEvolutionLedgerManifestHeadStore({
    descriptor: scope,
    authority,
    load,
    compareAndSet,
  });
function fixture() {
  const root = fs.mkdtempSync(path.join(temp, "cc-manifest-owner-"));
  roots.push(root);
  const io = { metadataOnly: false, calls: [] };
  const fsImpl = { ...fs };
  for (const name of Object.keys(fsImpl))
    if (typeof fsImpl[name] === "function")
      fsImpl[name] = (...args) => {
        if (io.metadataOnly)
          throw new Error(`forbidden filesystem operation: ${name}`);
        return fs[name](...args);
      };
  const directories = [path.join(root, "catalog"), path.join(root, "head")];
  fsImpl.realpathSync = (target) => {
    if (io.metadataOnly) {
      expect(directories).toContain(target);
      io.calls.push("realpath");
    }
    return fs.realpathSync.native(target);
  };
  fsImpl.lstatSync = (target, options) => {
    if (io.metadataOnly) {
      expect(directories).toContain(target);
      io.calls.push("lstat");
    }
    return fs.lstatSync(target, options);
  };
  const options = {
    fsImpl,
    lock() {
      throw new Error("ownership capture must never lock");
    },
    random() {
      throw new Error("ownership capture must never generate a token");
    },
  };
  const rawCatalog = createCatalogBackend({
    ...options,
    directoryPath: directories[0],
  });
  const rawHead = createHeadBackend({
    ...options,
    directoryPath: directories[1],
  });
  return {
    root,
    io,
    rawCatalog,
    rawHead,
    catalog: catalog(rawCatalog),
    head: head(rawHead.load, rawHead.compareAndSet),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-manifest-owner-")
    )
      throw new Error("unsafe manifest ownership cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("manifest factory ownership", () => {
  it("propagates the same raw capabilities without reading leaves or acquiring locks", () => {
    const value = fixture();
    value.io.metadataOnly = true;
    expect(captureCatalog(value.catalog)).toBe(
      captureRawCatalog(value.rawCatalog),
    );
    expect(captureHead(value.head)).toBe(captureRawHead(value.rawHead));
    expect(
      captureHeadPorts(value.rawHead.load, value.rawHead.compareAndSet),
    ).toBe(captureHead(value.head));
    expect(new Set(value.io.calls)).toEqual(new Set(["lstat", "realpath"]));
    expect(Object.keys(value.catalog).sort()).toEqual([
      "append",
      "descriptor",
      "list",
      "readLatest",
    ]);
    expect(Object.keys(value.head).sort()).toEqual([
      "commit",
      "descriptor",
      "read",
    ]);
  });
  it("rejects wrapped or mixed head ports before metadata or callback invocation", () => {
    const first = fixture(),
      second = fixture();
    let invoked = 0;
    const wrapped = () => {
      invoked++;
      throw new Error("untrusted callback");
    };
    first.io.calls.length = 0;
    first.io.metadataOnly = true;
    for (const [load, cas] of [
      [first.rawHead.load, second.rawHead.compareAndSet],
      [wrapped, first.rawHead.compareAndSet],
      [first.rawHead.load, wrapped],
      [first.rawHead.load.bind(first.rawHead), first.rawHead.compareAndSet],
      [first.rawHead.compareAndSet, first.rawHead.load],
    ]) {
      expect(() => captureHeadPorts(load, cas)).toThrow(TypeError);
      expect(() => captureHead(head(load, cas))).toThrow(TypeError);
    }
    expect(invoked).toBe(0);
    expect(first.io.calls).toEqual([]);
  });
  it.each(["catalog", "head"])(
    "rejects forged %s owners without invoking getters or proxy traps",
    (role) => {
      const value = fixture(),
        original = value[role];
      const capture = role === "catalog" ? captureCatalog : captureHead;
      let invoked = 0;
      const trap = () => {
        invoked++;
        throw new Error("untrusted trap");
      };
      const proxy = new Proxy(original, {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
      });
      const revoked = Proxy.revocable(original, {});
      revoked.revoke();
      const accessor = {
        get descriptor() {
          return trap();
        },
      };
      for (const fake of [
        null,
        {},
        { ...original },
        accessor,
        proxy,
        revoked.proxy,
        value.rawHead,
        value.rawCatalog,
      ])
        expect(() => capture(fake)).toThrow(TypeError);
      expect(() => capture(original, accessor)).toThrow(TypeError);
      expect(() => capture()).toThrow(TypeError);
      expect(invoked).toBe(0);
    },
  );
  it("leaves custom in-memory ports usable while refusing their directory ownership", () => {
    const inMemoryCatalog = catalog({
      list: () => [],
      loadLatest: () => null,
      compareAndAppend: () => {
        throw new Error("unused");
      },
    });
    const inMemoryHead = head(
      () => null,
      () => {
        throw new Error("unused");
      },
    );
    expect(inMemoryCatalog.list()).toEqual([]);
    expect(inMemoryHead.read()).toBeNull();
    expect(() => captureCatalog(inMemoryCatalog)).toThrow(TypeError);
    expect(() => captureHead(inMemoryHead)).toThrow(TypeError);
    const value = fixture();
    const clone = catalog({ ...value.rawCatalog });
    expect(clone.readLatest()).toBeNull();
    expect(() => captureCatalog(clone)).toThrow(TypeError);
  });
  it.each(["catalog", "head"])(
    "rejects a replaced %s directory at first capture and recovers only the original",
    (role) => {
      const value = fixture();
      const capture = role === "catalog" ? captureCatalog : captureHead;
      const directory = path.join(value.root, role),
        saved = path.join(value.root, `${role}-saved`);
      for (const target of [directory, saved])
        if (path.dirname(target) !== value.root)
          throw new Error("unsafe manifest directory swap");
      fs.renameSync(directory, saved);
      fs.cpSync(saved, directory, { recursive: true });
      expect(() => capture(value[role])).toThrowError(
        expect.objectContaining({
          code: "CC_EVOLUTION_MANIFEST_STATE_READ_FAILED",
        }),
      );
      fs.rmSync(directory, { recursive: true });
      fs.renameSync(saved, directory);
      expect(
        capture(value[role]).descriptor.fullPhysicalStorageGraphVerified,
      ).toBe(false);
    },
  );
});
