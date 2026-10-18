import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withFileLock } from "../../src/lib/with-file-lock.js";
import {
  createEvolutionLedgerFileManifestCatalogBackend as catalog,
  captureEvolutionLedgerFileManifestCatalogDirectoryBoundary as captureCatalog,
} from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import {
  createEvolutionLedgerFileManifestHeadBackend as head,
  captureEvolutionLedgerFileManifestHeadDirectoryBoundary as captureHead,
} from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import {
  createEvolutionPhysicalStateReader,
  captureEvolutionPhysicalStateReaderDirectoryBoundary as capturePhysical,
} from "../../src/lib/evolution/evolution-physical-state-reader.js";
import {
  createEvolutionManifestStateReader,
  captureEvolutionManifestStateReaderDirectoryBoundary as captureManifest,
  EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE as FAILED,
} from "../../src/lib/evolution/evolution-manifest-state-reader.js";

const temp = fs.realpathSync.native(os.tmpdir());
const fields = ["dev", "ino", "mode", "uid", "gid"];
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function safe(root, ...targets) {
  for (const target of targets)
    if (!path.resolve(target).startsWith(path.resolve(root) + path.sep))
      throw new Error("unsafe manifest directory control");
}
function clean(root) {
  if (
    path.dirname(root) !== temp ||
    !path.basename(root).startsWith("cc-manifest-cap-")
  )
    throw new Error("unsafe manifest capability cleanup");
  fs.rmSync(root, { recursive: true, force: true });
}
function badBrands(capture, value) {
  let traps = 0;
  const handler = Object.fromEntries(
    ["get", "getPrototypeOf", "ownKeys"].map((key) => [
      key,
      () => {
        traps++;
        throw new Error("untrusted trap");
      },
    ]),
  );
  const revoked = Proxy.revocable(value, handler);
  revoked.revoke();
  for (const fake of [
    null,
    {},
    { ...value },
    Object.create(Object.getPrototypeOf(value)),
    new Proxy(value, handler),
    revoked.proxy,
  ])
    expect(() => capture(fake)).toThrow(TypeError);
  expect(traps).toBe(0);
  let getters = 0;
  const context = {
    get fsImpl() {
      getters++;
      throw new Error("replacement");
    },
  };
  expect(() => capture(value, context)).toThrow(TypeError);
  expect(() => capture(value).recheck(context)).toThrow(TypeError);
  expect(getters).toBe(0);
}

describe.each([
  ["catalog", catalog, captureCatalog, captureHead],
  ["head", head, captureHead, captureCatalog],
])(
  "original %s directory capability",
  (kind, create, capture, wrongCapture) => {
    let root,
      directory,
      file,
      backend,
      boundary,
      original,
      publicDescriptor,
      io,
      fsImpl;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-manifest-cap-"));
      directory = path.join(root, kind);
      file = path.join(directory, `manifest-${kind}.json`);
      io = { metadataOnly: false, calls: [], stat: null };
      fsImpl = { ...fs };
      for (const name of Object.keys(fsImpl))
        if (typeof fsImpl[name] === "function")
          fsImpl[name] = (...args) => {
            if (io.metadataOnly)
              throw new Error(
                `forbidden metadata capability operation: ${name}`,
              );
            return fs[name](...args);
          };
      fsImpl.realpathSync = function (target) {
        expect(this).toBe(fsImpl);
        if (io.metadataOnly) {
          expect(target).toBe(directory);
          io.calls.push("realpath");
        }
        return fs.realpathSync.native(target);
      };
      fsImpl.lstatSync = (target, options) => {
        if (io.metadataOnly) {
          expect(target).toBe(directory);
          io.calls.push("lstat");
        }
        const stat = fs.lstatSync(target, options);
        return io.stat ? io.stat(stat, target, options) : stat;
      };
      backend = create({
        directoryPath: directory,
        fsImpl,
        lock(...args) {
          if (io.metadataOnly) throw new Error("forbidden lock");
          return withFileLock(...args);
        },
        random() {
          if (io.metadataOnly) throw new Error("forbidden random");
          return "manifestcapabilitytoken";
        },
      });
      boundary = capture(backend);
      original = digest(boundary.descriptor);
      publicDescriptor = JSON.stringify(backend.descriptor);
    });
    afterAll(() => clean(root));
    const read = () => (kind === "head" ? backend.load() : backend.list());
    const write = (n, previous) => {
      const value = {
        headDigest: `head-${n}`,
        manifestDigest: `manifest-${n}`,
        value: n,
      };
      return kind === "head"
        ? backend.compareAndSet({
            expectedHeadDigest: previous,
            nextHead: value,
          })
        : backend.compareAndAppend({
            expectedManifestDigest: previous,
            manifest: value,
          });
    };
    it("projects full-precision original pins without changing public backend keys or descriptor", () => {
      expect(Object.keys(backend).sort()).toEqual(
        (kind === "head"
          ? ["descriptor", "load", "compareAndSet"]
          : ["descriptor", "list", "loadLatest", "compareAndAppend"]
        ).sort(),
      );
      const descriptor = boundary.descriptor,
        stat = fs.lstatSync(directory, { bigint: true });
      expect(descriptor.scope).toBe("single-original-state-directory");
      expect(descriptor.directory.path).toBe(directory);
      for (const field of fields)
        expect(descriptor.directory.identity[field]).toBe(String(stat[field]));
      for (const value of [
        boundary,
        boundary.recheck,
        descriptor,
        descriptor.directory,
        descriptor.directory.identity,
      ])
        expect(Object.isFrozen(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
      expect(descriptor).toMatchObject({
        fileIdentityVerified: false,
        fileContentsVerified: false,
        storageInventoryVerified: false,
        retentionStorageVerified: false,
        fullPhysicalStorageGraphVerified: false,
        rootAuthorityVerified: false,
        routingPinVerified: false,
        crossProcessRollbackProtectionVerified: false,
        grantsMutationOrPromotionAuthority: false,
      });
      expect(() => wrongCapture(backend)).toThrow(TypeError);
    });
    it("keeps original directory digest through actual append/CAS rename writes and reopen", () => {
      write(1, null);
      const first = fs.lstatSync(file, { bigint: true }).ino;
      write(2, kind === "head" ? "head-1" : "manifest-1");
      expect(fs.lstatSync(file, { bigint: true }).ino).not.toBe(first);
      expect(read()).not.toBeNull();
      expect(digest(boundary.recheck())).toBe(original);
      expect(
        digest(capture(create({ directoryPath: directory })).descriptor),
      ).toBe(original);
      expect(JSON.stringify(backend.descriptor)).toBe(publicDescriptor);
    });
    it("uses only original lstat/realpath with zero file, lock, repair or random operations", () => {
      io.calls = [];
      io.metadataOnly = true;
      try {
        expect(capture(backend)).toBe(boundary);
        expect(boundary.recheck()).toBe(boundary.descriptor);
      } finally {
        io.metadataOnly = false;
      }
      expect(io.calls).toEqual(["lstat", "realpath", "lstat", "realpath"]);
    });
    it("rejects copies, structural wrappers, proxies, revoked proxies and replacement contexts without invoking traps", () =>
      badBrands(capture, backend));
    it.each(["clone", "missing", "link"])(
      "refuses a real %s without opening or recreating paths and restores only the original directory",
      (fault) => {
        const saved = path.join(root, "saved");
        safe(root, directory, saved);
        fs.renameSync(directory, saved);
        if (fault === "clone") fs.cpSync(saved, directory, { recursive: true });
        if (fault === "link")
          fs.symlinkSync(
            saved,
            directory,
            process.platform === "win32" ? "junction" : "dir",
          );
        io.metadataOnly = true;
        try {
          expect(() => capture(backend)).toThrowError(
            expect.objectContaining({ code: FAILED }),
          );
          expect(() => boundary.recheck()).toThrowError(
            expect.objectContaining({ code: FAILED }),
          );
          if (fault === "missing") expect(fs.existsSync(directory)).toBe(false);
        } finally {
          io.metadataOnly = false;
          if (fault !== "missing")
            fs.rmSync(directory, { recursive: true, force: true });
          fs.renameSync(saved, directory);
        }
        expect(digest(boundary.recheck())).toBe(original);
        // Restoring a directory is not a proof of complete signed journal history.
      },
    );
    it("does not first claim a clone when capture was never called by its owner", () => {
      const target = path.join(root, "not-captured"),
        saved = path.join(root, "not-captured-saved");
      safe(root, target, saved);
      const fresh = create({ directoryPath: target });
      fs.renameSync(target, saved);
      fs.cpSync(saved, target, { recursive: true });
      try {
        expect(() => capture(fresh)).toThrowError(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(saved, target);
      }
      expect(capture(fresh).descriptor.directory.path).toBe(target);
    });
    it.each(fields)("rejects Number fallback for %s", (field) => {
      io.stat = (stat, target, options) => {
        if (target === directory && options?.bigint)
          stat[field] = Number(stat[field]);
        return stat;
      };
      try {
        expect(() => boundary.recheck()).toThrowError(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        io.stat = null;
      }
    });
    it.each(fields)("compares the full original %s scalar", (field) => {
      io.stat = (stat, target, options) => {
        if (target === directory && options?.bigint) stat[field] += 1n;
        return stat;
      };
      try {
        expect(() => boundary.recheck()).toThrowError(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        io.stat = null;
      }
    });
    it("keeps metadata scope separate from corrupt or missing state leaves", () => {
      const bytes = fs.readFileSync(file);
      try {
        fs.writeFileSync(file, "invalid state");
        expect(digest(boundary.recheck())).toBe(original);
        expect(() => read()).toThrow();
        fs.unlinkSync(file);
        expect(digest(boundary.recheck())).toBe(original);
        expect(read()).toEqual(kind === "head" ? null : []);
      } finally {
        fs.writeFileSync(file, bytes, { mode: 0o600 });
      }
    });
  },
);

describe("physical and manifest reader provenance", () => {
  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-manifest-cap-"));
  });
  afterAll(() => clean(root));
  it("keeps the existing read/recheck shape and return values while branding each original reader", () => {
    const physical = createEvolutionPhysicalStateReader({
      directoryPath: root,
      fsImpl: fs,
      maximumBytes: 4096,
      label: "test",
      errorCode: FAILED,
    });
    const manifest = createEvolutionManifestStateReader({
      file: path.join(root, "missing.json"),
      fsImpl: fs,
      maximumBytes: 4096,
      label: "test",
    });
    for (const [reader, capture] of [
      [physical, capturePhysical],
      [manifest, captureManifest],
    ]) {
      expect(Object.keys(reader)).toEqual(["read", "recheck"]);
      expect(reader.recheck()).toBeUndefined();
      expect(capture(reader).recheck()).toBe(capture(reader).descriptor);
      badBrands(capture, reader);
    }
    expect(manifest.read()).toBeNull();
    expect(() => captureManifest(physical)).toThrow(TypeError);
    expect(() => capturePhysical(manifest)).toThrow(TypeError);
  });
  it("does not let final construction recheck adopt a directory exchanged after its initial pin", () => {
    const directory = path.join(root, "construction"),
      saved = path.join(root, "construction-saved");
    safe(root, directory, saved);
    fs.mkdirSync(directory);
    let calls = 0;
    const fsImpl = {
      ...fs,
      lstatSync(target, options) {
        if (target === directory && ++calls === 2) {
          fs.renameSync(directory, saved);
          fs.cpSync(saved, directory, { recursive: true });
        }
        return fs.lstatSync(target, options);
      },
    };
    try {
      expect(() =>
        createEvolutionPhysicalStateReader({
          directoryPath: directory,
          fsImpl,
          maximumBytes: 4096,
          label: "test",
          errorCode: FAILED,
        }),
      ).toThrowError(expect.objectContaining({ code: FAILED }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.renameSync(saved, directory);
    }
  });
});
