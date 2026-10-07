import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureEvolutionArtifactStoreDirectoryBoundary as capture,
  EvolutionArtifactPorts,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE as INTEGRITY,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import { openArtifactDirectoryPorts } from "../fixtures/rrsi-artifact-directory.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, directory;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-artifact-directory-"));
  directory = path.join(root, "artifacts");
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-artifact-directory-")
  )
    throw new Error("unsafe artifact directory cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});
function safeTargets(...targets) {
  for (const target of targets) {
    const relative = path.relative(root, path.resolve(target));
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("unsafe directory mutation target");
  }
}
const digest = (value) =>
  rrsiHash(
    "chainlesschain.rrsi-file-artifact-store-directory-boundary/v1",
    value,
  );
const held = (operation, message) =>
  expect(operation).toThrow(
    expect.objectContaining({
      code: INTEGRITY,
      ...(message ? { message } : {}),
    }),
  );
function observeNoWrites(operation) {
  const spies = [
    "mkdirSync",
    "writeFileSync",
    "writeSync",
    "chmodSync",
    "renameSync",
    "linkSync",
    "unlinkSync",
    "rmSync",
    "rmdirSync",
  ].map((name) => vi.spyOn(fs, name));
  try {
    return operation();
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
}
describe("original ArtifactPorts root/files directory boundary", () => {
  it("exports constructor-captured exact BigInt IDs and only the declared directory scope", () => {
    const { ports } = openArtifactDirectoryPorts(directory);
    const boundary = observeNoWrites(() => capture(ports));
    for (const [name, target] of [
      ["root", directory],
      ["files", path.join(directory, "files")],
    ]) {
      const stat = fs.lstatSync(target, { bigint: true });
      expect(boundary.descriptor[name].identity).toMatchObject({
        dev: String(stat.dev),
        ino: String(stat.ino),
      });
      expect(boundary.descriptor[name].path).toBe(
        fs.realpathSync.native(target),
      );
    }
    expect(boundary.descriptor).toMatchObject({
      scope: "root-and-files-directories",
      indexFileIdentityVerified: false,
      indexContentsVerified: false,
      artifactInventoryVerified: false,
      independentVolumeIdentityVerified: false,
      fullPhysicalStorageGraphVerified: false,
      rootAuthorityVerified: false,
      tenantWideIndexAuthorityVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
    expect(Object.isFrozen(boundary.descriptor.root.identity)).toBe(true);
    expect(observeNoWrites(() => boundary.recheck())).toBe(boundary.descriptor);
  });
  it("keeps the same boundary after normal artifact publication and new ports reopening the original directories", () => {
    const { ports } = openArtifactDirectoryPorts(directory),
      boundary = capture(ports),
      before = digest(boundary.descriptor);
    ports.putCanonical(
      "evolution-ledger-v2-journal",
      { value: "actual publication" },
      {
        audience: "directory-runtime",
        purpose: "evolution-ledger",
        retention: "ledger",
      },
    );
    expect(digest(boundary.recheck())).toBe(before);
    const reopened = openArtifactDirectoryPorts(directory);
    expect(digest(capture(reopened.ports).descriptor)).toBe(before);
  });
  it.each(["root", "files"])(
    "rejects a real same-byte replacement of %s without adopting new IDs",
    (name) => {
      const { ports } = openArtifactDirectoryPorts(directory),
        boundary = capture(ports);
      ports.putCanonical(
        "evolution-ledger-v2-journal",
        { value: "retained copy" },
        {
          audience: "directory-runtime",
          purpose: "evolution-ledger",
          retention: "ledger",
        },
      );
      const target =
          name === "root" ? directory : path.join(directory, "files"),
        saved = path.join(root, `saved-${name}`);
      const identity = fs.lstatSync(target, { bigint: true }).ino;
      safeTargets(target, saved);
      fs.renameSync(target, saved);
      fs.cpSync(saved, target, { recursive: true });
      expect(fs.lstatSync(target, { bigint: true }).ino).not.toBe(identity);
      const message = `ArtifactStore ${name === "root" ? "root" : "files root"} physical identity changed`;
      held(() => observeNoWrites(() => boundary.recheck()), message);
      held(() => observeNoWrites(() => capture(ports)), message);
      const fresh = openArtifactDirectoryPorts(directory);
      expect(digest(capture(fresh.ports).descriptor)).not.toBe(
        digest(boundary.descriptor),
      );
    },
  );
  it.each(["root", "files"])(
    "holds missing %s and never calls the layout initializer",
    (name) => {
      const { ports } = openArtifactDirectoryPorts(directory),
        boundary = capture(ports);
      const target =
          name === "root" ? directory : path.join(directory, "files"),
        saved = path.join(root, `saved-${name}`);
      safeTargets(target, saved);
      fs.renameSync(target, saved);
      let error;
      try {
        observeNoWrites(() => boundary.recheck());
      } catch (cause) {
        error = cause;
      }
      expect(error).toMatchObject({
        code: INTEGRITY,
        cause: { code: "ENOENT" },
      });
      expect(fs.existsSync(target)).toBe(false);
    },
  );
  it("explicitly leaves index file identity and bytes outside directory-only verification", () => {
    const { ports } = openArtifactDirectoryPorts(directory),
      boundary = capture(ports);
    const index = path.join(directory, "index.jsonl"),
      saved = path.join(root, "saved-index");
    const bytes = fs.readFileSync(index),
      identity = fs.lstatSync(index, { bigint: true }).ino;
    safeTargets(index, saved);
    fs.renameSync(index, saved);
    fs.writeFileSync(index, bytes);
    expect(fs.lstatSync(index, { bigint: true }).ino).not.toBe(identity);
    expect(boundary.recheck()).toMatchObject({
      indexFileIdentityVerified: false,
      indexContentsVerified: false,
    });
  });
  it("rejects copied, prototype-forged, subclass and proxy handles without reading caller getters", () => {
    const { ports } = openArtifactDirectoryPorts(directory),
      touched = vi.fn();
    const fake = Object.create(EvolutionArtifactPorts.prototype);
    Object.defineProperty(fake, "descriptor", { get: touched });
    expect(() => capture({ ...ports })).toThrow();
    expect(() => capture(fake)).toThrow();
    expect(() => capture(new Proxy(ports, { get: touched }))).toThrow();
    class Derived extends EvolutionArtifactPorts {}
    const derived = openArtifactDirectoryPorts(path.join(root, "derived"), {
      Ports: Derived,
    });
    expect(() => capture(derived.ports)).toThrow();
    expect(touched).not.toHaveBeenCalled();
  });
  it("refuses caller paths/callbacks and retains the immutable original ArtifactStore path", () => {
    const { ports, store } = openArtifactDirectoryPorts(directory),
      boundary = capture(ports),
      touched = vi.fn();
    expect(() =>
      capture(ports, { path: "replacement", verifier: touched }),
    ).toThrow();
    expect(() =>
      boundary.recheck({ path: "replacement", verifier: touched }),
    ).toThrow();
    expect(() => {
      store.dir = path.join(root, "replacement");
    }).toThrow();
    expect(boundary.recheck().root.path).toBe(
      fs.realpathSync.native(directory),
    );
    expect(touched).not.toHaveBeenCalled();
  });
  it("does not silently recapture a changed root before the first exported boundary query", () => {
    const { ports } = openArtifactDirectoryPorts(directory),
      saved = path.join(root, "saved-root");
    safeTargets(directory, saved);
    fs.renameSync(directory, saved);
    fs.cpSync(saved, directory, { recursive: true });
    held(() => capture(ports), "ArtifactStore root physical identity changed");
  });
  it("refuses a real directory junction/symlink replacing the files root", () => {
    const { ports } = openArtifactDirectoryPorts(directory),
      boundary = capture(ports);
    const files = path.join(directory, "files"),
      saved = path.join(root, "saved-files");
    safeTargets(files, saved);
    fs.renameSync(files, saved);
    fs.symlinkSync(
      saved,
      files,
      process.platform === "win32" ? "junction" : "dir",
    );
    held(() => boundary.recheck());
  });
  it("detects a real files directory replacement during the root recheck", () => {
    const { ports } = openArtifactDirectoryPorts(directory),
      boundary = capture(ports);
    const files = path.join(directory, "files"),
      saved = path.join(root, "saved-files");
    const original = fs.lstatSync;
    let fired = false;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      const stat = original(target, options);
      if (!fired && target === directory && options?.bigint) {
        fired = true;
        safeTargets(files, saved);
        fs.renameSync(files, saved);
        fs.cpSync(saved, files, { recursive: true });
      }
      return stat;
    });
    held(
      () => boundary.recheck(),
      "ArtifactStore files root physical identity changed",
    );
    expect(fired).toBe(true);
  });
});

describe("synthetic full-precision directory IDs on real local files", () => {
  function synthetic() {
    const roots = new Map([
      [directory, (1n << 60n) + 1n],
      [path.join(directory, "files"), (1n << 60n) + 2n],
    ]);
    const originalStat = fs.lstatSync,
      originalOpen = fs.openSync,
      originalFstat = fs.fstatSync;
    const descriptors = new Map();
    let replace = false,
      losePrecision = false;
    const project = (stat, target, options) => {
      if (!roots.has(target) || !stat.isDirectory()) return stat;
      const inode =
        roots.get(target) + (replace && target.endsWith("files") ? 1n : 0n);
      stat.ino = options?.bigint && !losePrecision ? inode : Number(inode);
      return stat;
    };
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) =>
      project(originalStat(target, options), target, options),
    );
    vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
      const fd = originalOpen(target, ...args);
      descriptors.set(fd, target);
      return fd;
    });
    vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) =>
      project(originalFstat(fd, options), descriptors.get(fd), options),
    );
    const { ports } = openArtifactDirectoryPorts(directory),
      boundary = capture(ports);
    return {
      roots,
      boundary,
      replace: () => {
        replace = true;
      },
      lose: () => {
        losePrecision = true;
      },
    };
  }
  it("keeps different full IDs whose Number projections collide", () => {
    const value = synthetic();
    expect(new Set([...value.roots.values()].map(Number)).size).toBe(1);
    expect(value.boundary.descriptor.root.identity.ino).not.toBe(
      value.boundary.descriptor.files.identity.ino,
    );
    expect(value.boundary.recheck()).toBe(value.boundary.descriptor);
  });
  it("holds a different full ID even when its Number projection remains the same", () => {
    const value = synthetic(),
      original = value.roots.get(path.join(directory, "files"));
    expect(Number(original)).toBe(Number(original + 1n));
    value.replace();
    held(
      () => value.boundary.recheck(),
      "ArtifactStore files root physical identity changed",
    );
  });
  it("rejects a provider returning Number for the requested BigInt directory stat", () => {
    const value = synthetic();
    value.lose();
    held(
      () => value.boundary.recheck(),
      "ArtifactStore root requires full-precision directory stat fields",
    );
  });
});
