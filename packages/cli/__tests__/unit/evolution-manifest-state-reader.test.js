import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createEvolutionLedgerFileManifestCatalogBackend as catalog } from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import { createEvolutionLedgerFileManifestHeadBackend as head } from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import { EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-manifest-state-reader.js";

const temp = fs.realpathSync.native(os.tmpdir()),
  maximumBytes = 256 * 1024;
const fields = [
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-manifest-state-"));
});
afterEach(() => {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-manifest-state-")
  )
    throw new Error("unsafe manifest state cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});

// Backend state is intentionally unsigned here. Real signed v2 history is
// exercised by integration; these tests target the physical state windows.
function open(kind, options = {}) {
  const directory = path.join(options.root ?? root, kind),
    file = path.join(directory, `manifest-${kind}.json`);
  const io = {
    live: new Map(),
    opens: [],
    reads: [],
    whole: [],
    stat: null,
    beforeOpen: null,
    afterRead: null,
    partial: false,
    fstats: 0,
    armed: false,
    directories: [],
  };
  const fsImpl = {
    ...fs,
    realpathSync(target) {
      // Keep this fallback receiver-sensitive: the identity adapter must
      // forward to the actual fsImpl, rather than calling it with another this.
      expect(this).toBe(fsImpl);
      return fs.realpathSync.native(target);
    },
    lstatSync(target, config) {
      const result = fs.lstatSync(target, config);
      return io.stat ? io.stat(result, "path", target, config) : result;
    },
    fstatSync(fd, config) {
      const result = fs.fstatSync(fd, config),
        target = io.live.get(fd);
      if (target === file && io.armed) io.fstats++;
      return io.stat ? io.stat(result, "fd", target, config) : result;
    },
    openSync(target, flags, ...args) {
      if (target === file && io.armed && typeof flags === "number")
        io.beforeOpen?.(target, flags);
      const fd = fs.openSync(target, flags, ...args);
      io.live.set(fd, target);
      if (target === file && io.armed) io.opens.push({ fd, flags });
      if (target !== file && io.armed && typeof flags === "number")
        io.directories.push({ fd, target });
      return fd;
    },
    closeSync(fd) {
      io.live.delete(fd);
      return fs.closeSync(fd);
    },
    readSync(fd, buffer, offset, length, position) {
      const target = io.live.get(fd),
        requested = length;
      if (target === file && io.armed && io.partial)
        length = Math.min(length, 37);
      const count = fs.readSync(fd, buffer, offset, length, position);
      if (target === file && io.armed) {
        io.reads.push({ requested, position, count });
        io.afterRead?.(fd, count, position);
      }
      return count;
    },
    readFileSync(target, ...args) {
      if (io.armed && (target === file || io.live.get(target) === file)) {
        io.whole.push(target);
        throw new Error(
          "manifest leaf must use the supplied bounded descriptor reader",
        );
      }
      return fs.readFileSync(target, ...args);
    },
  };
  if (options.nativeRealpath)
    fsImpl.realpathSync.native = (target) => fs.realpathSync.native(target);
  if (options.projectDevice)
    io.stat = (stat, source, target, config) => {
      if (
        source === "path" &&
        typeof target === "string" &&
        target.startsWith(directory) &&
        config?.bigint
      )
        stat.dev = 0n;
      return stat;
    };
  const create = kind === "head" ? head : catalog;
  const backend = create({ directoryPath: directory, maximumBytes, fsImpl });
  const record = {
    headDigest: "test-head",
    manifestDigest: "test-manifest",
    text: "alpha",
  };
  const read = () => (kind === "head" ? backend.load() : backend.list());
  const stateBytes = (entry = record) =>
    Buffer.from(
      JSON.stringify(
        kind === "head"
          ? {
              head: entry,
              schema:
                "chainlesschain.evolution-ledger-file-manifest-head-state/v2",
            }
          : {
              manifests: [entry],
              schema:
                "chainlesschain.evolution-ledger-file-manifest-catalog-state/v2",
            },
      ) + "\n",
    );
  const write = (entry = record, previous = null) =>
    kind === "head"
      ? backend.compareAndSet({ expectedHeadDigest: previous, nextHead: entry })
      : backend.compareAndAppend({
          expectedManifestDigest: previous,
          manifest: entry,
        });
  const put = (entry = record) => fs.writeFileSync(file, stateBytes(entry));
  const arm = () => {
    io.armed = true;
    io.fstats = 0;
  };
  const expected = (entry = record) => (kind === "head" ? entry : [entry]);
  return {
    kind,
    directory,
    file,
    io,
    fsImpl,
    backend,
    record,
    read,
    stateBytes,
    put,
    arm,
    expected,
    write,
    create,
  };
}
function held(operation, message, causeCode) {
  let error;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  expect(
    error,
    JSON.stringify({
      message: error?.message,
      cause: error?.cause?.message,
      causeCode: error?.cause?.code,
    }),
  ).toMatchObject({
    code: FAILED,
    ...(message ? { message } : {}),
  });
  if (causeCode) expect(error.cause?.code).toBe(causeCode);
  return error;
}
function closed(value) {
  expect(value.io.live.size).toBe(0);
  expect(value.io.whole).toEqual([]);
}

describe.each(["catalog", "head"])(
  "original %s state directory and stable leaf reads",
  (kind) => {
    it("preserves absent leaves, permits actual atomic rename updates and stable reopen without pinning leaf inodes", () => {
      const value = open(kind),
        empty = kind === "head" ? null : [];
      expect(value.read()).toEqual(empty);
      value.write();
      const first = fs.lstatSync(value.file, { bigint: true }).ino;
      const next = {
        ...value.record,
        headDigest: "head-2",
        manifestDigest: "manifest-2",
      };
      value.write(
        next,
        kind === "head" ? value.record.headDigest : value.record.manifestDigest,
      );
      expect(fs.lstatSync(value.file, { bigint: true }).ino).not.toBe(first);
      expect(
        kind === "head" ? value.read() : value.backend.loadLatest(),
      ).toEqual(next);
      const reopened = value.create({
        directoryPath: value.directory,
        fsImpl: value.fsImpl,
      });
      expect(kind === "head" ? reopened.load() : reopened.loadLatest()).toEqual(
        next,
      );
      // Leaf absence still means empty for these low-level APIs, including after
      // prior reads. This is deliberately not a persistent highwater guarantee.
      fs.unlinkSync(value.file);
      expect(value.read()).toEqual(empty);
      closed(value);
    });

    it.each([false, true])(
      "uses the original fsImpl through %s native realpath and counts bounded actual bytes with partial reads",
      (nativeRealpath) => {
        const value = open(kind, { nativeRealpath }),
          record = { ...value.record, payload: "x".repeat(150_000) };
        value.put(record);
        value.arm();
        value.io.partial = true;
        const size = fs.statSync(value.file).size;
        expect(value.read()).toEqual(value.expected(record));
        expect(value.io.opens).toHaveLength(1);
        expect(typeof value.io.opens[0].flags).toBe("number");
        expect(value.io.opens[0].flags & (fs.constants.O_NONBLOCK || 0)).toBe(
          fs.constants.O_NONBLOCK || 0,
        );
        expect(value.io.reads.every((read) => read.requested <= 65536)).toBe(
          true,
        );
        expect(value.io.reads.reduce((sum, read) => sum + read.count, 0)).toBe(
          size,
        );
        expect(value.io.reads.at(-1)).toEqual({
          requested: 1,
          position: size,
          count: 0,
        });
        closed(value);
      },
    );

    it("rejects an actual same-byte directory copy before read or writer lock creation; a new independent backend may capture its own copy", () => {
      const value = open(kind);
      value.write();
      const bytes = fs.readFileSync(value.file),
        saved = path.join(root, "original-directory");
      fs.renameSync(value.directory, saved);
      fs.cpSync(saved, value.directory, { recursive: true });
      const before = fs.readdirSync(value.directory);
      held(value.read, `manifest ${kind} directory physical identity changed`);
      held(
        () => value.write(),
        `manifest ${kind} directory physical identity changed`,
      );
      expect(fs.readdirSync(value.directory)).toEqual(before);
      expect(fs.readFileSync(value.file)).toEqual(bytes);
      const reopened = value.create({ directoryPath: value.directory });
      expect(kind === "head" ? reopened.load() : reopened.list()).toEqual(
        value.expected(),
      );
      closed(value);
    });

    it.each(["missing", "junction"])(
      "rejects an actual %s original directory without rebuilding or following an alias",
      (fault) => {
        const value = open(kind);
        value.put();
        const saved = path.join(root, "saved-directory");
        fs.renameSync(value.directory, saved);
        if (fault === "junction")
          fs.symlinkSync(
            saved,
            value.directory,
            process.platform === "win32" ? "junction" : "dir",
          );
        held(
          value.read,
          fault === "junction"
            ? `manifest ${kind} directory must be physically canonical`
            : undefined,
          fault === "missing" ? "ENOENT" : undefined,
        );
        if (fault === "missing")
          expect(fs.existsSync(value.directory)).toBe(false);
        closed(value);
      },
    );

    it("accounts for native Windows/WSL1 late directory rename denial separately from a successful POSIX replacement", () => {
      const value = open(kind);
      value.put();
      value.arm();
      let fired = false,
        moved = false,
        copied = false;
      const saved = path.join(root, "saved-during-read");
      const originalBytes = fs.readFileSync(value.file),
        originalInode = fs.lstatSync(value.directory, { bigint: true }).ino;
      const renameDenial =
        process.platform === "win32"
          ? "EPERM"
          : process.platform === "linux" &&
              /^4\.4\..*-microsoft$/i.test(os.release())
            ? "EACCES"
            : null;
      value.io.stat = (stat, source, target) => {
        if (
          !fired &&
          source === "path" &&
          target === value.file &&
          value.io.fstats === 2
        ) {
          fired = true;
          fs.renameSync(value.directory, saved);
          moved = true;
          fs.cpSync(saved, value.directory, { recursive: true });
          copied = true;
        }
        return stat;
      };
      held(
        value.read,
        renameDenial
          ? `manifest ${kind} bounded state read failed`
          : `manifest ${kind} directory physical identity changed`,
        renameDenial,
      );
      expect(fired).toBe(true);
      if (renameDenial) {
        expect(moved).toBe(false);
        expect(copied).toBe(false);
        expect(fs.existsSync(saved)).toBe(false);
        expect(fs.lstatSync(value.directory, { bigint: true }).ino).toBe(
          originalInode,
        );
        expect(fs.readFileSync(value.file)).toEqual(originalBytes);
      } else {
        expect(moved).toBe(true);
        expect(copied).toBe(true);
      }
      closed(value);
    });

    it("rejects an explicitly synthetic directory stat change only at the ending directory check", () => {
      const value = open(kind);
      value.put();
      value.arm();
      const original = fs.lstatSync(value.directory, { bigint: true }),
        originalBytes = fs.readFileSync(value.file);
      let fired = false,
        endingSamples = 0;
      value.io.stat = (stat, source, target) => {
        if (source === "path" && target === value.file && value.io.fstats === 2)
          fired = true;
        if (
          fired &&
          source === "path" &&
          target === value.directory &&
          endingSamples === 0
        ) {
          endingSamples++;
          // Stat projection only, not a native inode or permission replacement.
          stat.mode ^= 0o010n;
        }
        return stat;
      };
      held(value.read, `manifest ${kind} directory physical identity changed`);
      expect(fired).toBe(true);
      expect(endingSamples).toBe(1);
      expect(value.io.fstats).toBe(2);
      expect(value.io.opens).toHaveLength(1);
      expect(value.io.reads.reduce((sum, read) => sum + read.count, 0)).toBe(
        originalBytes.length,
      );
      const current = fs.lstatSync(value.directory, { bigint: true });
      expect(current.ino).toBe(original.ino);
      expect(current.mode).toBe(original.mode);
      expect(fs.readFileSync(value.file)).toEqual(originalBytes);
      closed(value);
    });

    it.runIf(process.platform === "win32")(
      "uses real held directory/volume fds only for the affected zero-device projection and still rejects inode changes",
      () => {
        const uv = Object.getOwnPropertyDescriptor(process.versions, "uv");
        Object.defineProperty(process.versions, "uv", {
          ...uv,
          value: "1.49.1",
        });
        try {
          const value = open(kind, { projectDevice: true });
          value.put();
          value.arm();
          expect(value.read()).toEqual(value.expected());
          expect(value.io.directories.map((entry) => entry.target)).toEqual([
            path.parse(value.directory).root,
            value.directory,
          ]);
          closed(value);
          const project = value.io.stat;
          value.io.stat = (stat, source, target, config) => {
            stat = project(stat, source, target, config);
            if (source === "fd" && target === value.file && config?.bigint)
              stat.ino += 1n;
            return stat;
          };
          held(
            value.read,
            `manifest ${kind} path and descriptor identities differ`,
          );
          closed(value);
          value.io.stat = project;
          value.io.directories.length = 0;
          Object.defineProperty(process.versions, "uv", {
            ...uv,
            value: "1.51.0",
          });
          held(
            value.read,
            `manifest ${kind} path and descriptor identities differ`,
          );
          expect(value.io.directories).toEqual([]);
          closed(value);
        } finally {
          Object.defineProperty(process.versions, "uv", uv);
        }
      },
    );

    it("does not turn an access error into empty state or trust existsSync", () => {
      const value = open(kind);
      value.put();
      value.arm();
      value.fsImpl.existsSync = () => false;
      value.io.stat = (stat, api, target) => {
        if (api === "path" && target === value.file)
          throw Object.assign(new Error("test denied"), { code: "EACCES" });
        return stat;
      };
      held(value.read, `manifest ${kind} bounded state read failed`, "EACCES");
      closed(value);
    });

    it.each(["open-swap", "final-path-swap", "open-unlink"])(
      "rejects actual %s within the file read window and closes real descriptors",
      (fault) => {
        const value = open(kind);
        value.put();
        value.arm();
        const bytes = fs.readFileSync(value.file),
          original = path.join(root, "saved-state");
        let fired = false;
        const swap = () => {
          fired = true;
          fs.renameSync(value.file, original);
          fs.writeFileSync(value.file, bytes);
        };
        if (fault === "open-swap")
          value.io.beforeOpen = () => {
            if (!fired) swap();
          };
        if (fault === "open-unlink")
          value.io.beforeOpen = () => {
            fired = true;
            fs.unlinkSync(value.file);
          };
        if (fault === "final-path-swap")
          value.io.stat = (stat, api, target) => {
            if (
              target === value.file &&
              api === "fd" &&
              value.io.fstats === 2 &&
              !fired
            )
              swap();
            return stat;
          };
        held(
          value.read,
          fault === "open-swap"
            ? `manifest ${kind} path and descriptor identities differ`
            : fault === "final-path-swap"
              ? `manifest ${kind} pathname changed during bounded read`
              : undefined,
          fault === "open-unlink" ? "ENOENT" : undefined,
        );
        expect(fired).toBe(true);
        closed(value);
      },
    );

    it("rejects a real same-inode equal-length rewrite during a successful read", () => {
      const value = open(kind);
      value.put();
      value.arm();
      const inode = fs.lstatSync(value.file, { bigint: true }).ino,
        bytes = value.stateBytes();
      let fired = false;
      value.io.afterRead = (_fd, count) => {
        if (!fired && count > 0) {
          fired = true;
          const changed = Buffer.from(
            bytes.toString("utf8").replace("alpha", "bravo"),
          );
          expect(changed.length).toBe(bytes.length);
          fs.writeFileSync(value.file, changed);
          const stat = fs.statSync(value.file);
          fs.utimesSync(value.file, stat.atime, new Date(stat.mtimeMs + 2000));
        }
      };
      held(
        value.read,
        `manifest ${kind} descriptor changed during bounded read`,
      );
      expect(fired).toBe(true);
      expect(fs.lstatSync(value.file, { bigint: true }).ino).toBe(inode);
      closed(value);
    });

    it.each(["grow", "truncate", "io-error"])(
      "rejects %s during descriptor reading and closes the opened file",
      (fault) => {
        const value = open(kind),
          record = { ...value.record, payload: "x".repeat(150_000) };
        value.put(record);
        value.arm();
        const size = fs.statSync(value.file).size;
        let fired = false;
        value.io.afterRead = (_fd, count, position) => {
          if (
            !fired &&
            ((fault === "grow" && position === size) ||
              (fault !== "grow" && count > 0))
          ) {
            fired = true;
            if (fault === "grow") fs.appendFileSync(value.file, " ");
            if (fault === "truncate") fs.truncateSync(value.file, size - 1);
            if (fault === "io-error")
              throw Object.assign(
                new Error("actual read completed before test I/O failure"),
                { code: "EIO" },
              );
          }
        };
        held(value.read);
        expect(fired).toBe(true);
        closed(value);
      },
    );

    it("rejects an actual oversized leaf before allocating or reading file bytes", () => {
      const value = open(kind);
      value.put();
      fs.truncateSync(value.file, maximumBytes + 1);
      value.arm();
      held(value.read, `manifest ${kind} exceeds maximumBytes`);
      expect(value.io.opens).toEqual([]);
      expect(value.io.reads).toEqual([]);
      closed(value);
    });

    it("rejects an actual hard link", () => {
      const value = open(kind);
      value.put();
      fs.linkSync(value.file, path.join(root, "state-link"));
      value.arm();
      held(value.read, `manifest ${kind} file identity is invalid`);
      closed(value);
    });
    it.runIf(process.platform !== "win32")(
      "rejects a dangling leaf symlink instead of treating it as absent",
      () => {
        const value = open(kind);
        fs.symlinkSync(path.join(root, "missing-leaf"), value.file);
        value.arm();
        held(value.read, `manifest ${kind} file identity is invalid`);
        closed(value);
      },
    );

    describe.sequential("full precision field matrix", () => {
      let value, sharedRoot;
      beforeAll(() => {
        sharedRoot = fs.mkdtempSync(
          path.join(temp, "cc-manifest-state-precision-"),
        );
        value = open(kind, { root: sharedRoot });
        value.put();
        value.arm();
      });
      afterAll(() => {
        const target = path.resolve(sharedRoot);
        if (
          path.dirname(target) !== temp ||
          !path.basename(target).startsWith("cc-manifest-state-precision-")
        )
          throw new Error("unsafe manifest precision cleanup");
        fs.rmSync(target, { recursive: true, force: true });
      });
      it.each(
        ["path", "fd"].flatMap((api) => fields.map((field) => [api, field])),
      )(
        "rejects a Number fallback in %s %s before content reads",
        (api, field) => {
          value.io.fstats = 0;
          value.io.reads.length = 0;
          value.io.stat = (stat, source, target, config) => {
            if (target === value.file && source === api && config?.bigint)
              stat[field] = Number(stat[field]);
            return stat;
          };
          held(
            value.read,
            `manifest ${kind} ${api === "fd" ? "descriptor" : "path"} requires full-precision stat fields`,
          );
          expect(value.io.reads).toEqual([]);
          closed(value);
        },
      );
    });

    it("rejects distinct full path/fd inodes whose Number projections collide", () => {
      const value = open(kind),
        inode = (1n << 60n) + 1n;
      value.put();
      value.arm();
      expect(Number(inode)).toBe(Number(inode + 1n));
      value.io.stat = (stat, source, target, config) => {
        if (target === value.file && config?.bigint)
          stat.ino = source === "path" ? inode : inode + 1n;
        return stat;
      };
      held(
        value.read,
        `manifest ${kind} path and descriptor identities differ`,
      );
      closed(value);
    });

    it.each(["mtimeNs", "ctimeNs"])(
      "rejects a one-unit %s descriptor drift hidden by Number projection",
      (field) => {
        const value = open(kind),
          fixed = (1n << 60n) + 1n;
        value.put();
        value.arm();
        expect(Number(fixed)).toBe(Number(fixed + 1n));
        value.io.stat = (stat, api, target, config) => {
          if (target === value.file && config?.bigint)
            stat[field] =
              fixed + (api === "fd" && value.io.fstats === 2 ? 1n : 0n);
          return stat;
        };
        held(
          value.read,
          `manifest ${kind} descriptor changed during bounded read`,
        );
        closed(value);
      },
    );

    it.each(["uid", "gid"])(
      "rejects open-time %s differences outside the shared comparator",
      (field) => {
        const value = open(kind);
        value.put();
        value.arm();
        value.io.stat = (stat, api, target, config) => {
          if (target === value.file && api === "fd" && config?.bigint)
            stat[field] += 1n;
          return stat;
        };
        held(
          value.read,
          `manifest ${kind} path and descriptor identities differ`,
        );
        closed(value);
      },
    );

    it("rejects a Number fallback in the original directory capture", () => {
      const directory = path.join(root, "bad-directory"),
        fsImpl = {
          ...fs,
          lstatSync(target, config) {
            const stat = fs.lstatSync(target, config);
            if (target === directory && config?.bigint)
              stat.ino = Number(stat.ino);
            return stat;
          },
        };
      held(
        () =>
          (kind === "head" ? head : catalog)({
            directoryPath: directory,
            fsImpl,
          }),
        `manifest ${kind} directory requires full-precision stat fields`,
      );
    });
  },
);
