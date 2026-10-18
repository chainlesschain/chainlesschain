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
import { EVOLUTION_WITNESS_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-file-witness.js";
import {
  createWitnessBoundaryIo,
  openWitnessBoundaryFixture,
} from "../fixtures/evolution-witness-boundary.js";

const temp = fs.realpathSync.native(os.tmpdir());
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
function fresh(kind) {
  const root = fs.mkdtempSync(path.join(temp, "cc-witness-boundary-")),
    tracking = createWitnessBoundaryIo();
  const value = openWitnessBoundaryFixture(root, {
    segmented: kind === "segment",
    fsImpl: tracking.fsImpl,
  });
  return {
    ...value,
    ...tracking,
    target: kind === "head" ? value.file : value.segmentFiles[0],
    directory:
      kind === "head" ? path.dirname(value.file) : value.segmentDirectory,
    label: kind === "head" ? "witness" : "witness segment",
  };
}
function cleanup(root) {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-witness-boundary-")
  )
    throw new Error("unsafe witness boundary cleanup");
  fs.rmSync(target, { recursive: true, force: true });
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
    JSON.stringify({ message: error?.message, cause: error?.cause?.message }),
  ).toMatchObject({ code: FAILED });
  if (message) expect(error.message).toBe(message);
  if (causeCode) expect(error.cause?.code).toBe(causeCode);
  return error;
}
function closed(value) {
  expect(value.io.live.size).toBe(0);
  expect(value.io.rawReads).toBe(0);
}

describe.each(["head", "segment"])(
  "real signed %s witness precision and descriptor windows",
  (kind) => {
    let value;
    beforeAll(() => {
      value = fresh(kind);
    }, 60_000);
    afterAll(() => cleanup(value.root));
    beforeEach(() => value.arm(value.target));
    afterEach(() => {
      closed(value);
      value.io.armed = false;
    });

    it("replays genuine signed history using partial descriptor reads and exact actual bytes", () => {
      value.io.partial = true;
      expect(value.witness.read()).toEqual(value.current);
      const size = fs.statSync(value.target).size;
      expect(value.io.opens).toHaveLength(1);
      expect(value.io.opens[0].flags & (fs.constants.O_NONBLOCK || 0)).toBe(
        fs.constants.O_NONBLOCK || 0,
      );
      expect(value.io.reads.every((entry) => entry.requested <= 65536)).toBe(
        true,
      );
      expect(value.io.reads.reduce((sum, entry) => sum + entry.count, 0)).toBe(
        size,
      );
      expect(value.io.reads.at(-1)).toEqual({
        requested: 1,
        count: 0,
        position: size,
      });
    });

    it.each(
      ["path", "fd"].flatMap((api) => fields.map((field) => [api, field])),
    )(
      "rejects a Number fallback in %s %s before content reads",
      (api, field) => {
        value.io.stat = (stat, source, target, options) => {
          if (target === value.target && source === api && options?.bigint)
            stat[field] = Number(stat[field]);
          return stat;
        };
        held(
          () => value.witness.read(),
          `${value.label} ${api === "fd" ? "descriptor" : "path"} requires full-precision stat fields`,
        );
        expect(value.io.reads).toEqual([]);
      },
    );

    it("rejects full path/fd inode differences hidden by Number rounding", () => {
      const inode = (1n << 60n) + 1n;
      expect(Number(inode)).toBe(Number(inode + 1n));
      value.io.stat = (stat, source, target, options) => {
        if (target === value.target && options?.bigint)
          stat.ino = inode + (source === "fd" ? 1n : 0n);
        return stat;
      };
      held(
        () => value.witness.read(),
        `${value.label} path and descriptor identities differ`,
      );
    });

    it.each(["mtimeNs", "ctimeNs"])(
      "rejects a one-unit %s drift hidden by Number rounding",
      (field) => {
        const fixed = (1n << 60n) + 1n;
        expect(Number(fixed)).toBe(Number(fixed + 1n));
        value.io.stat = (stat, source, target, options) => {
          if (target === value.target && options?.bigint)
            stat[field] =
              fixed + (source === "fd" && value.io.fstats === 2 ? 1n : 0n);
          return stat;
        };
        held(
          () => value.witness.read(),
          `${value.label} descriptor changed during bounded read`,
        );
      },
    );

    it.each(["uid", "gid"])(
      "checks open-time %s beyond the shared identity comparator",
      (field) => {
        value.io.stat = (stat, source, target, options) => {
          if (target === value.target && source === "fd" && options?.bigint)
            stat[field] += 1n;
          return stat;
        };
        held(
          () => value.witness.read(),
          `${value.label} path and descriptor identities differ`,
        );
      },
    );

    it.each(
      ["path", "fd"].flatMap((api) =>
        ["negative", "oversized"].map((size) => [api, size]),
      ),
    )("rejects a %s %s length before bytes are allocated/read", (api, size) => {
      value.io.stat = (stat, source, target, options) => {
        if (target === value.target && source === api && options?.bigint)
          stat.size = size === "negative" ? -1n : 1024n * 1024n + 1n;
        return stat;
      };
      held(() => value.witness.read(), `${value.label} store size is invalid`);
      expect(value.io.reads).toEqual([]);
    });

    it("rejects access failure instead of returning a newly signed absent state", () => {
      value.io.stat = (stat, source, target) => {
        if (source === "path" && target === value.target)
          throw Object.assign(new Error("injected access refusal"), {
            code: "EACCES",
          });
        return stat;
      };
      held(
        () => value.witness.read(),
        `${value.label} bounded read failed`,
        "EACCES",
      );
      expect(value.io.reads).toEqual([]);
    });

    it("checks the ending directory stat with an explicitly one-shot synthetic mode projection", () => {
      let ready = false,
        injected = 0;
      value.io.stat = (stat, source, target) => {
        if (
          source === "path" &&
          target === value.target &&
          value.io.fstats === 2
        )
          ready = true;
        if (
          ready &&
          source === "path" &&
          target === value.directory &&
          injected === 0
        ) {
          stat.mode ^= 0o010n;
          injected++;
        }
        return stat;
      };
      held(
        () => value.witness.read(),
        `${value.label} directory ${process.platform === "win32" ? "physical identity changed" : "permissions are invalid"}`,
      );
      expect(injected).toBe(1);
      expect(value.io.reads.reduce((sum, entry) => sum + entry.count, 0)).toBe(
        fs.statSync(value.target).size,
      );
    });
  },
);

describe.each(["head", "segment"])(
  "actual %s witness filesystem mutations",
  (kind) => {
    let value;
    beforeEach(() => {
      value = fresh(kind);
    }, 60_000);
    afterEach(() => {
      if (value) {
        closed(value);
        cleanup(value.root);
      }
    }, 60_000);

    it("allows stable same-byte leaf replacement across calls without asserting a lifetime inode pin", () => {
      const original = fs.lstatSync(value.target, { bigint: true }).ino,
        saved = path.join(value.root, "saved-leaf");
      fs.renameSync(value.target, saved);
      fs.copyFileSync(saved, value.target);
      expect(fs.lstatSync(value.target, { bigint: true }).ino).not.toBe(
        original,
      );
      expect(value.witness.read()).toEqual(value.current);
      expect(value.create().read()).toEqual(value.current);
    });

    it("rejects a same-byte original directory copy before reading or creating a writer lock", () => {
      const saved = path.join(value.root, "saved-directory"),
        bytes = fs.readFileSync(value.target);
      fs.renameSync(value.directory, saved);
      fs.cpSync(saved, value.directory, { recursive: true });
      const names = fs.readdirSync(value.directory);
      held(
        () => value.witness.read(),
        `${value.label} directory physical identity changed`,
      );
      held(
        () =>
          value.witness.compareAndSwap({
            expected: value.current,
            next: value.snapshot(value.current.sequence + 1),
          }),
        `${value.label} directory physical identity changed`,
      );
      expect(fs.readdirSync(value.directory)).toEqual(names);
      expect(fs.readFileSync(value.target)).toEqual(bytes);
      expect(value.create().read()).toEqual(value.current);
    });

    it.each(["missing", "junction"])(
      "rejects a %s original directory and never reconstructs it on read/write",
      (fault) => {
        const saved = path.join(value.root, "saved-directory");
        fs.renameSync(value.directory, saved);
        if (fault === "junction")
          fs.symlinkSync(
            saved,
            value.directory,
            process.platform === "win32" ? "junction" : "dir",
          );
        held(
          () => value.witness.read(),
          fault === "junction"
            ? `${value.label} directory must be physically canonical`
            : undefined,
          fault === "missing" ? "ENOENT" : undefined,
        );
        held(() =>
          value.witness.compareAndSwap({
            expected: value.current,
            next: value.snapshot(value.current.sequence + 1),
          }),
        );
        if (fault === "missing")
          expect(fs.existsSync(value.directory)).toBe(false);
        else fs.unlinkSync(value.directory);
        fs.renameSync(saved, value.directory);
        expect(value.witness.read()).toEqual(value.current);
      },
    );

    it.each(["open-swap", "final-path-swap", "open-unlink"])(
      "rejects a real %s inside the byte window",
      (fault) => {
        value.arm(value.target);
        const bytes = fs.readFileSync(value.target),
          saved = path.join(value.root, "saved-leaf");
        let fired = false;
        const swap = () => {
          fired = true;
          fs.renameSync(value.target, saved);
          fs.writeFileSync(value.target, bytes);
        };
        if (fault === "open-swap")
          value.io.beforeOpen = () => {
            if (!fired) swap();
          };
        if (fault === "open-unlink")
          value.io.beforeOpen = () => {
            fired = true;
            fs.unlinkSync(value.target);
          };
        if (fault === "final-path-swap")
          value.io.stat = (stat, source, target) => {
            if (
              !fired &&
              source === "fd" &&
              target === value.target &&
              value.io.fstats === 2
            )
              swap();
            return stat;
          };
        held(
          () => value.witness.read(),
          fault === "open-swap"
            ? `${value.label} path and descriptor identities differ`
            : fault === "final-path-swap"
              ? `${value.label} pathname changed during bounded read`
              : undefined,
          fault === "open-unlink" ? "ENOENT" : undefined,
        );
        expect(fired).toBe(true);
      },
    );

    it("rejects a real same-inode equal-length rewrite during successful descriptor IO", () => {
      value.arm(value.target);
      const bytes = fs.readFileSync(value.target),
        inode = fs.lstatSync(value.target, { bigint: true }).ino;
      let fired = false;
      value.io.afterRead = (_fd, count) => {
        if (!fired && count > 0) {
          fired = true;
          const changed = Buffer.from(
            bytes.toString().replace("anchorDigest", "anchorDigesX"),
          );
          expect(changed.length).toBe(bytes.length);
          fs.writeFileSync(value.target, changed);
          const stat = fs.statSync(value.target);
          fs.utimesSync(
            value.target,
            stat.atime,
            new Date(stat.mtimeMs + 2000),
          );
        }
      };
      held(
        () => value.witness.read(),
        `${value.label} descriptor changed during bounded read`,
      );
      expect(fired).toBe(true);
      expect(fs.lstatSync(value.target, { bigint: true }).ino).toBe(inode);
    });

    it("rejects a hard link before private-file preparation", () => {
      fs.linkSync(value.target, path.join(value.root, "state-link"));
      value.arm(value.target);
      held(
        () => value.witness.read(),
        `${value.label} file identity is invalid`,
      );
      expect(value.io.reads).toEqual([]);
    });

    it.runIf(process.platform !== "win32")(
      "normalizes private-file permissions before the stable metadata window",
      () => {
        const inode = fs.lstatSync(value.target, { bigint: true }).ino;
        fs.chmodSync(value.target, 0o640);
        expect(value.witness.read()).toEqual(value.current);
        expect(fs.statSync(value.target).mode & 0o777).toBe(0o600);
        expect(fs.lstatSync(value.target, { bigint: true }).ino).toBe(inode);
      },
    );
    it.runIf(process.platform !== "win32")(
      "rejects an actual inode replacement inside private-file preparation",
      () => {
        const bytes = fs.readFileSync(value.target),
          saved = path.join(value.root, "saved-leaf");
        fs.chmodSync(value.target, 0o640);
        let fired = false;
        value.fsImpl.chmodSync = (name, mode) => {
          fs.chmodSync(name, mode);
          if (!fired && name === value.target) {
            fired = true;
            fs.renameSync(value.target, saved);
            fs.writeFileSync(value.target, bytes, { mode: 0o600 });
          }
        };
        value.arm(value.target);
        held(
          () => value.witness.read(),
          `${value.label} file changed during private-file preparation`,
        );
        expect(fired).toBe(true);
        expect(value.io.opens).toEqual([]);
        expect(value.io.reads).toEqual([]);
        expect(fs.readFileSync(saved)).toEqual(bytes);
      },
    );
    it("rejects a real directory replacement inside the final signature verification callback", () => {
      const saved = path.join(value.root, "saved-during-verification");
      let fired = false;
      // Invalidate the warm authenticated epoch so this read actually calls
      // the verifier, rather than legitimately reusing the prior decision.
      value.policy.epoch = "physical-boundary-verifier-fault";
      value.policy.afterVerify = () => {
        if (fired) return;
        fired = true;
        fs.renameSync(value.directory, saved);
        fs.cpSync(saved, value.directory, { recursive: true });
      };
      held(
        () => value.witness.read(),
        `${value.label} directory physical identity changed`,
      );
      expect(fired).toBe(true);
      value.policy.afterVerify = null;
      const copy = path.resolve(value.directory);
      if (!copy.startsWith(path.resolve(value.root) + path.sep))
        throw new Error("unsafe verifier-copy cleanup");
      fs.rmSync(copy, { recursive: true, force: true });
      fs.renameSync(saved, value.directory);
      expect(value.witness.read()).toEqual(value.current);
    });
    it.runIf(process.platform !== "win32")(
      "rejects a dangling leaf symlink without treating it as absence",
      () => {
        fs.unlinkSync(value.target);
        fs.symlinkSync(
          path.join(value.root, "missing-link-target"),
          value.target,
        );
        value.arm(value.target);
        held(
          () => value.witness.read(),
          `${value.label} file identity is invalid`,
        );
        expect(value.io.opens).toEqual([]);
      },
    );
  },
);

describe("witness low-level absence and segment lifecycle", () => {
  let value;
  afterEach(() => {
    if (value) {
      closed(value);
      cleanup(value.root);
      value = null;
    }
  });
  it("permits legal atomic head updates and preserves initial ENOENT absence even after previous presence", () => {
    value = fresh("head");
    const first = fs.lstatSync(value.file, { bigint: true }).ino;
    const next = value.witness.compareAndSwap({
      expected: value.current,
      next: value.snapshot(1),
    });
    expect(fs.lstatSync(value.file, { bigint: true }).ino).not.toBe(first);
    expect(value.witness.read()).toEqual(next);
    fs.unlinkSync(value.file);
    expect(value.witness.read().status).toBe("absent");
  });
  it("never recreates a missing segment directory on first read by an independently reopened witness", () => {
    value = fresh("segment");
    const saved = path.join(value.root, "saved-directory");
    fs.renameSync(value.segmentDirectory, saved);
    const reopened = value.create();
    expect(fs.existsSync(value.segmentDirectory)).toBe(false);
    held(() => reopened.read(), undefined, "ENOENT");
    expect(fs.existsSync(value.segmentDirectory)).toBe(false);
  });
  it.runIf(process.platform !== "win32")(
    "rejects broad segment directory permissions on read without repairing them",
    () => {
      value = fresh("segment");
      fs.chmodSync(value.segmentDirectory, 0o710);
      held(
        () => value.witness.read(),
        "witness segment directory permissions are invalid",
      );
      expect(fs.statSync(value.segmentDirectory).mode & 0o777).toBe(0o710);
      fs.chmodSync(value.segmentDirectory, 0o700);
      expect(value.witness.read()).toEqual(value.current);
    },
  );
  it.each([0, 1])(
    "rejects remaining segment budget %s with zero segment content reads",
    (remaining) => {
      value = fresh("segment");
      const bounded = value.create({
        maximumHistoryBytes: fs.statSync(value.file).size + remaining,
      });
      value.arm(value.target);
      held(() => bounded.read(), "witness segment store size is invalid");
      expect(value.io.opens).toEqual([]);
      expect(value.io.reads).toEqual([]);
    },
  );
  it("captures a segment directory published by another genuine instance without mkdir/chmod and then keeps that binding", () => {
    value = fresh("head");
    const other = openWitnessBoundaryFixture(value.root, {
      segmented: true,
      fsImpl: value.fsImpl,
    });
    value.fsImpl.mkdirSync = () => {
      throw new Error("read must not create a segment directory");
    };
    value.fsImpl.chmodSync = () => {
      throw new Error("already-private reads must not repair permissions");
    };
    expect(value.witness.read()).toEqual(other.current);
    fs.renameSync(
      other.segmentDirectory,
      path.join(value.root, "saved-after-first-bind"),
    );
    held(() => value.witness.read(), undefined, "ENOENT");
    expect(fs.existsSync(other.segmentDirectory)).toBe(false);
  });
});
