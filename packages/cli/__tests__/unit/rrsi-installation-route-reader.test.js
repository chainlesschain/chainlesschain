import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openRrsiInstallationRouteSnapshot,
  RRSI_INSTALLATION_ROUTE_FILE_LIMITS,
} from "../../src/lib/evolution/rrsi-installation-route-reader.js";
import { RRSI_INSTALLATION_ROUTE_HOLD_CODE as HOLD } from "../../src/lib/evolution/rrsi-installation-route-contracts.js";
import {
  makeRouteFixture,
  writeRouteFixture,
  routeSelection,
  routeNames,
  routeDigest,
} from "../fixtures/rrsi-installation-route.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, directory, fixture, selection;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-rrsi-route-reader-"));
  directory = path.join(root, "snapshot");
  fs.mkdirSync(directory);
  fixture = makeRouteFixture();
  writeRouteFixture(directory, fixture);
  selection = routeSelection(directory, fixture);
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-rrsi-route-reader-")
  )
    throw new Error("unsafe route reader fixture cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});
function tree(target = root) {
  const result = [];
  function visit(value) {
    const stat = fs.lstatSync(value, { bigint: true });
    result.push({
      name: path.relative(target, value),
      identity: `${stat.dev}:${stat.ino}`,
      bytes: stat.isFile() ? routeDigest(fs.readFileSync(value)) : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(value).sort())
        visit(path.join(value, name));
  }
  visit(target);
  return result;
}
function noWrites(operation) {
  const names = [
    "mkdirSync",
    "writeFileSync",
    "writeSync",
    "chmodSync",
    "renameSync",
    "linkSync",
    "unlinkSync",
    "rmSync",
    "rmdirSync",
  ];
  const spies = names.map((name) => vi.spyOn(fs, name));
  const opened = vi.spyOn(fs, "openSync");
  try {
    return operation();
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    for (const [, flags] of opened.mock.calls) {
      if (typeof flags === "string") expect(flags).toBe("r");
      else
        expect(
          flags &
            (fs.constants.O_WRONLY |
              fs.constants.O_RDWR |
              fs.constants.O_CREAT |
              fs.constants.O_TRUNC |
              fs.constants.O_APPEND),
        ).toBe(0);
    }
    opened.mockRestore();
  }
}
const held = (operation, message) =>
  expect(operation).toThrow(
    expect.objectContaining({ code: HOLD, ...(message ? { message } : {}) }),
  );

describe("open-only immutable route declaration reader", () => {
  it("reads real signed files with unchanged identities and no mutation APIs or permission claims", () => {
    const before = tree();
    const reader = noWrites(() => openRrsiInstallationRouteSnapshot(selection));
    const result = noWrites(() => reader.read());
    expect(result).toMatchObject({
      readOnlyOpen: true,
      capturedSnapshotRechecked: true,
      selectedContextOnly: true,
      ownerOnlyPermissionsVerified: false,
      rootAuthorityVerified: false,
      routingPinVerified: false,
      crossProcessRollbackProtectionVerified: false,
      tenantWideIndexAuthorityVerified: false,
      generationProvenanceVerified: false,
      grantsMutationOrPromotionAuthority: false,
      authenticated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
      decision: "HOLD",
      snapshotCheck: {
        declaredRouteConsistent: true,
        signaturesVerifiedRelativeToDeclaredKey: true,
        anchorRevision: 2,
      },
    });
    expect(Object.isFrozen(result.snapshotCheck)).toBe(true);
    expect(reader.read()).toEqual(result);
    expect(tree()).toEqual(before);
  });
  it("holds an absent directory with the original ENOENT cause and creates nothing", () => {
    const before = tree();
    let error;
    try {
      noWrites(() =>
        openRrsiInstallationRouteSnapshot({
          ...selection,
          directory: path.join(root, "missing"),
        }),
      );
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ code: HOLD, cause: { code: "ENOENT" } });
    expect(tree()).toEqual(before);
  });
  it.each(routeNames)(
    "refuses missing %s without recreating any path",
    (name) => {
      fs.renameSync(
        path.join(directory, name),
        path.join(root, `saved-${name}`),
      );
      const before = tree();
      held(() => noWrites(() => openRrsiInstallationRouteSnapshot(selection)));
      expect(tree()).toEqual(before);
    },
  );
  it.each(routeNames)(
    "detects real same-byte inode replacement of %s after open",
    (name) => {
      const reader = openRrsiInstallationRouteSnapshot(selection),
        file = path.join(directory, name);
      const bytes = fs.readFileSync(file),
        stat = fs.lstatSync(file, { bigint: true });
      fs.renameSync(file, path.join(root, `saved-${name}`));
      fs.writeFileSync(file, bytes);
      expect(fs.lstatSync(file, { bigint: true }).ino).not.toBe(stat.ino);
      const before = tree();
      held(
        () => noWrites(() => reader.read()),
        "captured route file identity or bytes changed",
      );
      expect(tree()).toEqual(before);
    },
  );
  it("detects a real same-byte directory replacement after open", () => {
    const reader = openRrsiInstallationRouteSnapshot(selection),
      stat = fs.lstatSync(directory, { bigint: true });
    fs.renameSync(directory, path.join(root, "saved-snapshot"));
    fs.mkdirSync(directory);
    writeRouteFixture(directory, fixture);
    expect(fs.lstatSync(directory, { bigint: true }).ino).not.toBe(stat.ino);
    const before = tree();
    held(
      () => noWrites(() => reader.read()),
      "captured route directory identity changed",
    );
    expect(tree()).toEqual(before);
  });
  it("rejects changed bytes on the same inode even when byte length is preserved", () => {
    const reader = openRrsiInstallationRouteSnapshot(selection),
      file = path.join(directory, "root.json");
    const stat = fs.lstatSync(file, { bigint: true }),
      bytes = fs.readFileSync(file, "utf8");
    const changed = bytes.replace("installation-a", "installation-b");
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(bytes));
    fs.writeFileSync(file, changed);
    expect(fs.lstatSync(file, { bigint: true }).ino).toBe(stat.ino);
    held(
      () => noWrites(() => reader.read()),
      "captured route file identity or bytes changed",
    );
  });
  it.each(routeNames)(
    "rejects %s mixed from another genuinely signed snapshot",
    (name) => {
      const other = makeRouteFixture({
        keys: fixture.keys,
        graph: "other-graph",
        installationId: "installation-b",
      });
      const second = path.join(root, "other");
      fs.mkdirSync(second);
      writeRouteFixture(second, other);
      fs.writeFileSync(
        path.join(directory, name),
        fs.readFileSync(path.join(second, name)),
      );
      const before = tree();
      held(() => noWrites(() => openRrsiInstallationRouteSnapshot(selection)));
      expect(tree()).toEqual(before);
    },
  );
  it.each([
    "empty",
    "over-limit",
    "pretty-json",
    "duplicate-key",
    "invalid-utf8",
    "unknown-field",
    "extra-newline",
  ])("rejects malformed root file %s", (mode) => {
    const file = path.join(directory, "root.json");
    let bytes = fs.readFileSync(file);
    if (mode === "empty") bytes = Buffer.alloc(0);
    else if (mode === "over-limit")
      bytes = Buffer.alloc(
        RRSI_INSTALLATION_ROUTE_FILE_LIMITS["root.json"] + 1,
      );
    else if (mode === "pretty-json")
      bytes = Buffer.from(JSON.stringify(fixture.root, null, 2));
    else if (mode === "duplicate-key")
      bytes = Buffer.from(
        bytes.toString().replace("{", '{"tenantId":"tenant-a",'),
      );
    else if (mode === "invalid-utf8") bytes = Buffer.from([0xc3, 0x28]);
    else if (mode === "unknown-field")
      bytes = Buffer.from(bytes.toString().replace("{", '{"extra":1,'));
    else bytes = Buffer.concat([bytes, Buffer.from("\n")]);
    fs.writeFileSync(file, bytes);
    const before = tree();
    held(() => noWrites(() => openRrsiInstallationRouteSnapshot(selection)));
    expect(tree()).toEqual(before);
  });
  it("stops unbounded growth after the checked size with a one-byte EOF probe", () => {
    const originalRead = fs.readSync,
      originalOpen = fs.openSync;
    const descriptors = new Map(),
      sizes = [],
      file = path.join(directory, "root.json");
    const originalBytes = fs.readFileSync(file);
    let fired = false;
    vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
      const fd = originalOpen(target, ...args);
      descriptors.set(fd, target);
      return fd;
    });
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        if (descriptors.get(fd) === file) {
          sizes.push(length);
          if (!fired) {
            fired = true;
            fs.appendFileSync(file, "x".repeat(100_000));
          }
        }
        return originalRead(fd, buffer, offset, length, position);
      },
    );
    let error;
    try {
      openRrsiInstallationRouteSnapshot(selection);
    } catch (cause) {
      error = cause;
    }
    expect(fired).toBe(true);
    expect(error).toMatchObject({
      code: HOLD,
      cause: { message: "file grew during bounded read" },
    });
    expect(sizes).toEqual([originalBytes.length, 1]);
  });
  it("detects a real file replacement between initial read and final readback", () => {
    const reader = openRrsiInstallationRouteSnapshot(selection);
    const originalRead = fs.readSync,
      originalOpen = fs.openSync;
    const descriptors = new Map(),
      target = path.join(directory, "highwater.json"),
      bytes = fs.readFileSync(target);
    let fired = false;
    vi.spyOn(fs, "openSync").mockImplementation((value, ...args) => {
      const fd = originalOpen(value, ...args);
      descriptors.set(fd, value);
      return fd;
    });
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        const count = originalRead(fd, buffer, offset, length, position);
        if (
          !fired &&
          descriptors.get(fd) === path.join(directory, "root.json") &&
          position === 0
        ) {
          fired = true;
          fs.renameSync(target, path.join(root, "saved-highwater"));
          fs.writeFileSync(target, bytes);
        }
        return count;
      },
    );
    held(() => reader.read(), "route snapshot changed during final readback");
    expect(fired).toBe(true);
    expect(fs.lstatSync(target, { bigint: true }).ino).not.toBe(
      fs.lstatSync(path.join(root, "saved-highwater"), { bigint: true }).ino,
    );
  });
  it.each([
    "extra-file",
    "extra-directory",
    "hardlink",
    "directory-instead-of-file",
  ])("refuses unsafe inventory %s", (mode) => {
    if (mode === "extra-file")
      fs.writeFileSync(path.join(directory, "unexpected"), "x");
    else if (mode === "extra-directory")
      fs.mkdirSync(path.join(directory, "unexpected"));
    else if (mode === "hardlink")
      fs.linkSync(
        path.join(directory, "root.json"),
        path.join(root, "root-link"),
      );
    else {
      fs.renameSync(
        path.join(directory, "root.json"),
        path.join(root, "saved-root"),
      );
      fs.mkdirSync(path.join(directory, "root.json"));
    }
    const before = tree();
    held(() => noWrites(() => openRrsiInstallationRouteSnapshot(selection)));
    expect(tree()).toEqual(before);
  });
  it("rejects Number stat fields instead of accepting a rounded identity", () => {
    const original = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((value, options) => {
      const stat = original(value, options);
      if (value === directory) stat.ino = Number(stat.ino);
      return stat;
    });
    held(
      () => noWrites(() => openRrsiInstallationRouteSnapshot(selection)),
      "route snapshot requires full-precision stat fields",
    );
  });
  it.each([
    "installationId",
    "tenantId",
    "rootRecordDigest",
    "relative-directory",
  ])("refuses mismatched selected %s", (field) => {
    const input = { ...selection };
    if (field === "relative-directory") input.directory = "snapshot";
    else
      input[field] = field.endsWith("Digest")
        ? routeDigest("wrong")
        : "different-id";
    held(() => noWrites(() => openRrsiInstallationRouteSnapshot(input)));
  });
  it("refuses getters, proxies, extra capabilities and read-time context replacement", () => {
    const touched = vi.fn(),
      input = { ...selection },
      reader = openRrsiInstallationRouteSnapshot(selection);
    Object.defineProperty(input, "directory", {
      enumerable: true,
      get: touched,
    });
    held(() => noWrites(() => openRrsiInstallationRouteSnapshot(input)));
    held(() =>
      noWrites(() =>
        openRrsiInstallationRouteSnapshot(
          new Proxy(selection, { get: touched }),
        ),
      ),
    );
    held(() =>
      noWrites(() =>
        openRrsiInstallationRouteSnapshot({ ...selection, authority: touched }),
      ),
    );
    held(() => noWrites(() => reader.read({ directory: "replacement" })));
    expect(touched).not.toHaveBeenCalled();
  });
  it("requests nonblocking opens for files and directory-constrained opens for the helper", () => {
    const opened = vi.spyOn(fs, "openSync");
    const reader = openRrsiInstallationRouteSnapshot(selection);
    reader.read();
    expect(opened).toHaveBeenCalled();
    for (const [target, flags] of opened.mock.calls) {
      expect(typeof flags).toBe("number");
      expect(flags & (fs.constants.O_NONBLOCK || 0)).toBe(
        fs.constants.O_NONBLOCK || 0,
      );
      if (!routeNames.includes(path.basename(target)))
        expect(flags & (fs.constants.O_DIRECTORY || 0)).toBe(
          fs.constants.O_DIRECTORY || 0,
        );
    }
  });
  it("detects a real ancestor replacement after opening the snapshot", () => {
    const parent = path.join(root, "parent"),
      nested = path.join(parent, "snapshot"),
      saved = path.join(root, "saved-parent");
    fs.mkdirSync(parent);
    fs.renameSync(directory, nested);
    const reader = openRrsiInstallationRouteSnapshot({
      ...selection,
      directory: nested,
    });
    const identity = fs.lstatSync(nested, { bigint: true }).ino;
    fs.renameSync(parent, saved);
    fs.mkdirSync(parent);
    fs.renameSync(path.join(saved, "snapshot"), nested);
    expect(fs.lstatSync(nested, { bigint: true }).ino).toBe(identity);
    const before = tree();
    held(
      () => noWrites(() => reader.read()),
      "captured route directory identity changed",
    );
    expect(tree()).toEqual(before);
  });
  it("refuses a real directory junction or symlink instead of following its alias", () => {
    const alias = path.join(root, "alias");
    fs.symlinkSync(
      directory,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true);
    const before = tree();
    held(
      () =>
        noWrites(() =>
          openRrsiInstallationRouteSnapshot({ ...selection, directory: alias }),
        ),
      "route directory ancestry is not canonical and nonlinked",
    );
    expect(tree()).toEqual(before);
  });
});
