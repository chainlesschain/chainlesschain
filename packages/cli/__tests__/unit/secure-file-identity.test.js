import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fileStatIdentity,
  isAffectedWindowsZeroDeviceStatRuntime,
  sameDirectoryStatIdentity,
  sameFileStatIdentity,
  samePathHandleDirectoryIdentity,
  samePathHandleFileIdentity,
  SECURE_FILE_IDENTITY_ERROR,
  withTrustedFileParentSync,
} from "../../src/lib/secure-file-identity.js";

const NODE_22_12_WINDOWS = Object.freeze({
  platform: "win32",
  uvVersion: "1.49.1",
});
const temporaryDirectories = [];

function identity(overrides = {}) {
  return {
    dev: "77",
    ino: "1234",
    mode: String(0o100600),
    nlink: "1",
    size: "19",
    mtimeNs: "1000000001",
    ctimeNs: "1000000002",
    ...overrides,
  };
}

function projectedStat(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function directoryStat(overrides = {}) {
  return {
    ...identity({
      mode: String(0o40700),
      nlink: "2",
      size: "4096",
      ...overrides,
    }),
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("secure file identity", () => {
  it("limits the zero-device bridge to affected Windows libuv releases", () => {
    expect(isAffectedWindowsZeroDeviceStatRuntime(NODE_22_12_WINDOWS)).toBe(
      true,
    );
    expect(
      isAffectedWindowsZeroDeviceStatRuntime({
        platform: "win32",
        uvVersion: "1.50.0",
      }),
    ).toBe(true);
    expect(
      isAffectedWindowsZeroDeviceStatRuntime({
        platform: "win32",
        uvVersion: "1.51.0",
      }),
    ).toBe(false);
    expect(
      isAffectedWindowsZeroDeviceStatRuntime({
        platform: "linux",
        uvVersion: "1.49.1",
      }),
    ).toBe(false);
  });

  it("bridges any affected Windows path-device projection only to the anchored handle device", () => {
    const opened = identity();
    const zeroProjected = identity({ dev: "0" });
    const nonzeroProjected = identity({ dev: "987654321" });

    expect(
      samePathHandleFileIdentity(
        zeroProjected,
        opened,
        opened.dev,
        NODE_22_12_WINDOWS,
      ),
    ).toBe(true);
    expect(
      samePathHandleFileIdentity(
        nonzeroProjected,
        opened,
        opened.dev,
        NODE_22_12_WINDOWS,
      ),
    ).toBe(true);
    expect(
      samePathHandleFileIdentity(nonzeroProjected, opened, opened.dev, {
        platform: "win32",
        uvVersion: "1.51.0",
      }),
    ).toBe(false);
    expect(
      samePathHandleFileIdentity(nonzeroProjected, opened, opened.dev, {
        platform: "linux",
        uvVersion: "1.49.1",
      }),
    ).toBe(false);
    expect(
      samePathHandleFileIdentity(
        nonzeroProjected,
        opened,
        "88",
        NODE_22_12_WINDOWS,
      ),
    ).toBe(false);
    expect(
      samePathHandleFileIdentity(
        nonzeroProjected,
        identity({ dev: "0" }),
        "0",
        NODE_22_12_WINDOWS,
      ),
    ).toBe(false);
  });

  it.each(["ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"])(
    "rejects a zero-device projection when %s differs",
    (field) => {
      const opened = identity();
      const projected = identity({
        dev: "0",
        [field]: String(BigInt(opened[field]) + 1n),
      });
      expect(
        samePathHandleFileIdentity(
          projected,
          opened,
          opened.dev,
          NODE_22_12_WINDOWS,
        ),
      ).toBe(false);
    },
  );

  it("keeps exact handle snapshots fail-closed", () => {
    const before = identity();
    expect(sameFileStatIdentity(before, { ...before })).toBe(true);
    expect(
      sameFileStatIdentity(before, { ...before, ctimeNs: "1000000003" }),
    ).toBe(false);
    expect(fileStatIdentity(before)).toEqual(before);
  });

  it("normalizes ordinary Stats millisecond timestamps to nanoseconds", () => {
    expect(
      fileStatIdentity({
        ...identity(),
        mtimeNs: undefined,
        ctimeNs: undefined,
        mtimeMs: 1.25,
        ctimeMs: 2.5,
      }),
    ).toMatchObject({
      mtimeNs: "1250000",
      ctimeNs: "2500000",
    });
  });

  it("rechecks stable parent identity after child writes", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-secure-parent-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "state.json");

    const result = withTrustedFileParentSync(
      fs,
      filePath,
      ({ canonicalPath, parentDescriptor, parentDevice }) => {
        const openedParent = fs.fstatSync(parentDescriptor, { bigint: true });
        expect(openedParent.isDirectory()).toBe(true);
        expect(String(openedParent.dev)).toBe(parentDevice);
        fs.writeFileSync(canonicalPath, "{}\n");
        return canonicalPath;
      },
    );

    expect(result).toBe(filePath);
    expect(fs.readFileSync(filePath, "utf8")).toBe("{}\n");
  });

  it.each([
    [
      "a sibling file",
      (directory) =>
        fs.writeFileSync(path.join(directory, "unrelated.tmp"), "x"),
    ],
    [
      "a child directory",
      (directory) => fs.mkdirSync(path.join(directory, "unrelated-dir")),
    ],
  ])(
    "does not treat parent metadata or link-count changes from %s as identity changes",
    (_label, mutateParent) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-secure-parent-content-"),
      );
      temporaryDirectories.push(directory);
      const filePath = path.join(directory, "state.json");
      const nativeOpenSync = fs.openSync.bind(fs);
      let mutated = false;
      const runtimeFs = {
        ...fs,
        constants: fs.constants,
        realpathSync: fs.realpathSync,
        openSync(target, ...args) {
          if (
            !mutated &&
            path.resolve(String(target)) === path.resolve(directory)
          ) {
            mutated = true;
            mutateParent(directory);
          }
          return nativeOpenSync(target, ...args);
        },
      };

      expect(
        withTrustedFileParentSync(runtimeFs, filePath, () => "parent-stable"),
      ).toBe("parent-stable");
      expect(mutated).toBe(true);
    },
  );

  it.skipIf(process.platform !== "win32")(
    "anchors a Windows volume-root parent with a separate descriptor and closes both",
    () => {
      const canonicalRoot = path.parse(path.resolve(process.cwd())).root;
      const filePath = path.join(canonicalRoot, "state.json");
      const before = directoryStat({ dev: "987654321", ino: "4000" });
      const volumeRoot = directoryStat({ dev: "77", ino: "3000" });
      const openedParent = directoryStat({ dev: "77", ino: "4000" });
      const descriptors = [101, 102];
      const closed = [];
      const realpathSync = () => canonicalRoot;
      realpathSync.native = realpathSync;
      const runtimeFs = {
        constants: fs.constants,
        realpathSync,
        lstatSync: () => before,
        openSync: () => descriptors.shift(),
        fstatSync: (descriptor) =>
          descriptor === 101 ? volumeRoot : openedParent,
        closeSync: (descriptor) => closed.push(descriptor),
      };

      expect(
        withTrustedFileParentSync(
          runtimeFs,
          filePath,
          ({ parentDescriptor, parentDevice }) => {
            expect(parentDescriptor).toBe(102);
            expect(parentDevice).toBe("77");
            return "anchored";
          },
          { runtime: NODE_22_12_WINDOWS },
        ),
      ).toBe("anchored");
      expect(descriptors).toEqual([]);
      expect(closed).toEqual([102, 101]);
    },
  );

  it.skipIf(process.platform !== "win32")(
    "anchors an extended Windows UNC parent to its canonical share root",
    () => {
      const canonicalParent = "\\\\?\\UNC\\server\\share\\team";
      const canonicalShareRoot = "\\\\?\\UNC\\server\\share\\";
      const filePath = `${canonicalParent}\\state.json`;
      const before = directoryStat({ dev: "987654321", ino: "4000" });
      const shareRoot = directoryStat({ dev: "77", ino: "3000" });
      const openedParent = directoryStat({ dev: "77", ino: "4000" });
      const descriptors = [101, 102];
      const openedPaths = [];
      const closed = [];
      const realpathSync = () => canonicalParent;
      realpathSync.native = realpathSync;
      const runtimeFs = {
        constants: fs.constants,
        realpathSync,
        lstatSync: () => before,
        openSync(target) {
          openedPaths.push(target);
          return descriptors.shift();
        },
        fstatSync: (descriptor) =>
          descriptor === 101 ? shareRoot : openedParent,
        closeSync: (descriptor) => closed.push(descriptor),
      };

      expect(
        withTrustedFileParentSync(runtimeFs, filePath, () => "share-anchored", {
          runtime: NODE_22_12_WINDOWS,
        }),
      ).toBe("share-anchored");
      expect(openedPaths).toEqual([canonicalShareRoot, canonicalParent]);
      expect(closed).toEqual([102, 101]);
    },
  );

  it("fails when the canonical parent identity changes before return", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-secure-parent-race-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "state.json");
    let parentInspections = 0;
    const runtimeFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      lstatSync(target, options) {
        const stat = fs.lstatSync(target, options);
        if (path.resolve(target) !== path.resolve(directory)) return stat;
        parentInspections += 1;
        return parentInspections === 2
          ? projectedStat(stat, { ino: stat.ino + 1n })
          : stat;
      },
    };

    expect(() =>
      withTrustedFileParentSync(runtimeFs, filePath, () => "untrusted"),
    ).toThrow(
      expect.objectContaining({
        code: SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
      }),
    );
  });

  it("rejects asynchronous parent callbacks", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-secure-parent-sync-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "state.json");

    expect(() =>
      withTrustedFileParentSync(fs, filePath, async () => "untrusted"),
    ).toThrow(/must be synchronous/u);
    expect(() =>
      withTrustedFileParentSync(fs, filePath, () =>
        Promise.resolve("untrusted"),
      ),
    ).toThrow(/must not return a promise/u);
  });

  it("allows directory content metadata/link-count changes but not directory identity changes", () => {
    const opened = identity({ mode: String(0o40700), nlink: "2" });
    const changedContents = identity({
      mode: opened.mode,
      nlink: "99",
      size: "4096",
      mtimeNs: "2000000001",
      ctimeNs: "2000000002",
    });
    expect(
      samePathHandleDirectoryIdentity(changedContents, opened, opened.dev),
    ).toBe(true);
    expect(
      samePathHandleDirectoryIdentity(
        { ...changedContents, ino: "1235" },
        opened,
        opened.dev,
      ),
    ).toBe(false);
    expect(
      sameDirectoryStatIdentity(
        { ...changedContents, dev: "987654321" },
        opened,
      ),
    ).toBe(false);
  });

  it("strictly rechecks two directory-handle snapshots on affected Windows runtimes", () => {
    const canonicalParent = "C:\\trusted";
    const filePath = `${canonicalParent}\\state.json`;
    const before = directoryStat({ dev: "987654321", ino: "4000" });
    const authority = directoryStat({ dev: "77", ino: "3000" });
    const openedParent = directoryStat({ dev: "77", ino: "4000" });
    const changedHandle = directoryStat({ dev: "987654321", ino: "4000" });
    const descriptors = [101, 102];
    let parentFstats = 0;
    const realpathSync = () => canonicalParent;
    realpathSync.native = realpathSync;
    const runtimeFs = {
      constants: fs.constants,
      realpathSync,
      lstatSync: () => before,
      openSync: () => descriptors.shift(),
      fstatSync(descriptor) {
        if (descriptor === 101) return authority;
        parentFstats += 1;
        return parentFstats === 1 ? openedParent : changedHandle;
      },
      closeSync: () => {},
    };

    expect(() =>
      withTrustedFileParentSync(runtimeFs, filePath, () => "untrusted", {
        runtime: NODE_22_12_WINDOWS,
      }),
    ).toThrow(
      expect.objectContaining({
        code: SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
      }),
    );
  });

  it("documents that complete parent ABA replacement is outside the helper contract", () => {
    const outer = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-secure-parent-aba-"),
    );
    temporaryDirectories.push(outer);
    const trustedParent = path.join(outer, "trusted");
    const parkedParent = path.join(outer, "parked");
    const replacementParent = path.join(outer, "replacement");
    fs.mkdirSync(trustedParent);
    fs.mkdirSync(replacementParent);
    const filePath = path.join(trustedParent, "state.json");

    // A held directory descriptor cannot make Node's path-based writes
    // handle-relative. Callers must prevent untrusted parent renames.
    expect(
      withTrustedFileParentSync(fs, filePath, ({ canonicalPath }) => {
        fs.renameSync(trustedParent, parkedParent);
        fs.renameSync(replacementParent, trustedParent);
        fs.writeFileSync(canonicalPath, "replacement-write\n");
        fs.renameSync(trustedParent, replacementParent);
        fs.renameSync(parkedParent, trustedParent);
        return "caller-precondition-required";
      }),
    ).toBe("caller-precondition-required");
    expect(fs.existsSync(filePath)).toBe(false);
    expect(
      fs.readFileSync(path.join(replacementParent, "state.json"), "utf8"),
    ).toBe("replacement-write\n");
  });
});
