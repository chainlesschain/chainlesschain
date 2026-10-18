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
import {
  journalDigest,
  openJournalBoundaryFixture,
} from "../fixtures/evolution-journal-boundary.js";

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
function cleanup(root) {
  if (
    path.dirname(root) !== temp ||
    !path.basename(root).startsWith("cc-journal-boundary-")
  )
    throw new Error("unsafe journal cleanup");
  fs.rmSync(root, { recursive: true, force: true });
}
function corrupt(operation, message) {
  let error;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({ code: "CC_EVOLUTION_LEDGER_CORRUPT" });
  if (message) expect(error.message).toContain(message);
  return error;
}

describe.each(["cold", "cached", "snapshot"])(
  "signed journal %s physical read windows",
  (mode) => {
    let value, original, target, saved, size;
    const invoke = () =>
      mode === "cached" ? value.ledger.verify() : value.open();
    beforeAll(() => {
      value = openJournalBoundaryFixture(
        fs.mkdtempSync(path.join(temp, "cc-journal-boundary-")),
      );
      if (mode === "snapshot") value.ledger.checkpointState();
      target = value.files.segment;
      saved = path.join(value.root, "original-segment");
      original = fs.readFileSync(target);
      size = original.length;
    }, 60_000);
    afterAll(() => cleanup(value.root));
    beforeEach(() => {
      value.arm(target);
      value.policy.purposes.length = 0;
    });
    afterEach(() => {
      expect(value.io.live.size).toBe(0);
      expect(value.io.rawReads).toBe(0);
      value.io.armed = false;
      if (fs.existsSync(saved)) {
        fs.rmSync(target, { force: true });
        fs.renameSync(saved, target);
      }
      expect(journalDigest(fs.readFileSync(target))).toBe(
        journalDigest(original),
      );
    });

    it("authenticates genuine bytes, partial reads, EOF, directory batching and original Windows device bridge", () => {
      value.io.partial = true;
      invoke();
      expect(value.io.opens).toHaveLength(1);
      expect(value.io.reads.reduce((sum, read) => sum + read.count, 0)).toBe(
        size,
      );
      expect(value.io.reads.every((read) => read.requested <= 65536)).toBe(
        true,
      );
      expect(value.io.reads.at(-1)).toEqual({
        requested: 1,
        count: 0,
        position: size,
      });
      expect(value.io.opens[0].flags & (fs.constants.O_NONBLOCK || 0)).toBe(
        fs.constants.O_NONBLOCK || 0,
      );
      if (mode === "snapshot") {
        expect(value.policy.purposes).toContain("state-snapshot");
        expect(value.policy.purposes).not.toContain("domain-event");
        // One parent descriptor for both signed anchors, one for the segment.
        expect(
          value.io.allOpens.filter(
            (entry) => entry.target === value.ledger.anchorDir,
          ),
        ).toHaveLength(1);
        expect(
          value.io.allOpens.filter(
            (entry) => entry.target === value.ledger.segmentDir,
          ),
        ).toHaveLength(1);
      } else if (mode === "cached") {
        expect(value.policy.purposes).not.toContain("domain-event");
      } else {
        expect(value.policy.purposes).toContain("domain-event");
      }
    });

    it.each(
      ["path", "fd"].flatMap((api) => fields.map((field) => [api, field])),
    )(
      "rejects Number fallback for %s %s before reading content",
      (api, field) => {
        let fired = 0;
        value.io.stat = (stat, source, file, options) => {
          if (file === target && source === api && options?.bigint) {
            fired++;
            stat[field] = Number(stat[field]);
          }
          return stat;
        };
        corrupt(invoke, "requires full-precision stat fields");
        expect(fired).toBeGreaterThan(0);
        expect(value.io.reads).toEqual([]);
      },
    );

    it("accepts stable full precision inode values beyond the Number integer range", () => {
      value.io.stat = (stat, _source, file, options) => {
        if (file === target && options?.bigint) stat.ino = 2n ** 60n;
        return stat;
      };
      invoke();
      expect(value.io.opens).toHaveLength(1);
      expect(value.io.reads.reduce((sum, read) => sum + read.count, 0)).toBe(
        size,
      );
    });
    it.each([1n, 1048577n, 9007199254740993n])(
      "rejects a %s byte BigInt size before allocation or content IO",
      (length) => {
        value.io.stat = (stat, _api, file, options) => {
          if (file === target && options?.bigint) stat.size = length;
          return stat;
        };
        corrupt(invoke, "must be a bounded, single-link, non-symlink file");
        expect(value.io.opens).toEqual([]);
        expect(value.io.reads).toEqual([]);
      },
    );
    it("rejects distinct full inode values with the same Number projection", () => {
      const first = 2n ** 60n,
        second = first + 1n;
      expect(Number(first)).toBe(Number(second));
      value.io.stat = (stat, api, file, options) => {
        if (file === target && options?.bigint)
          stat.ino = api === "path" ? first : second;
        return stat;
      };
      corrupt(invoke, "changed while it was opened");
      expect(value.io.reads).toEqual([]);
    });
    it.each(["mtimeNs", "ctimeNs"])(
      "rejects a 1ns %s drift hidden by Number",
      (field) => {
        const base = 2n ** 61n;
        expect(Number(base)).toBe(Number(base + 1n));
        value.io.stat = (stat, api, file, options) => {
          if (file === target && options?.bigint)
            stat[field] =
              base + (api === "fd" && value.io.fstats % 2 === 0 ? 1n : 0n);
          return stat;
        };
        corrupt(invoke, "changed while it was read");
        expect(value.io.reads.length).toBeGreaterThan(0);
      },
    );
    it.each(["uid", "gid"])("rejects cross-API %s differences", (field) => {
      value.io.stat = (stat, api, file, options) => {
        if (file === target && api === "fd" && options?.bigint)
          stat[field] += 1n;
        return stat;
      };
      corrupt(invoke, "changed while it was opened");
      expect(value.io.reads).toEqual([]);
    });
    it.each(["uid", "gid"])(
      "rejects a %s mutation on the final descriptor stat",
      (field) => {
        value.io.stat = (stat, api, file, options) => {
          if (
            file === target &&
            api === "fd" &&
            options?.bigint &&
            value.io.fstats % 2 === 0
          )
            stat[field] += 1n;
          return stat;
        };
        corrupt(invoke, "changed while it was read");
        expect(value.io.reads.length).toBeGreaterThan(0);
      },
    );
    it("rejects a real replacement between pathname stat and open", () => {
      let fired = false;
      value.io.beforeOpen = () => {
        if (fired) return;
        fired = true;
        fs.renameSync(target, saved);
        fs.copyFileSync(saved, target);
      };
      if (mode === "cold") corrupt(invoke, "changed while it was opened");
      else {
        invoke();
        expect(value.policy.purposes).toContain("domain-event");
        expect(value.io.opens).toHaveLength(2);
      }
      expect(fired).toBe(true);
    });
    it("rechecks the actual pathname after reading, including snapshot expectedBytes", () => {
      let fired = false;
      value.io.stat = (stat, api, file, options) => {
        if (
          fired ||
          api !== "path" ||
          file !== target ||
          !options?.bigint ||
          value.io.fstats !== 2
        )
          return stat;
        fired = true;
        fs.renameSync(target, saved);
        fs.copyFileSync(saved, target);
        return fs.lstatSync(target, options);
      };
      if (mode === "cold")
        corrupt(invoke, "pathname changed during bounded read");
      else {
        invoke();
        // A one-shot cache/snapshot fault must cold-read the now stable file.
        expect(value.io.opens).toHaveLength(2);
        expect(value.policy.purposes).toContain("domain-event");
        expect(value.io.reads.reduce((sum, read) => sum + read.count, 0)).toBe(
          size * 2,
        );
      }
      expect(fired).toBe(true);
      expect(fs.lstatSync(target, { bigint: true }).ino).not.toBe(
        fs.lstatSync(saved, { bigint: true }).ino,
      );
      expect(fs.readFileSync(target)).toEqual(original);
    });
    it("rejects late pathname disappearance after the EOF probe", () => {
      let fired = false;
      value.io.afterRead = (_fd, count) => {
        if (fired || count !== 0) return;
        fired = true;
        fs.renameSync(target, saved);
      };
      corrupt(invoke);
      expect(fired).toBe(true);
    });
    it.each(["rewrite", "grow", "truncate"])(
      "rejects real %s during the read",
      (mutation) => {
        let fired = false;
        value.io.afterRead = (_fd, count) => {
          if (fired || count === 0) return;
          fired = true;
          // Retain the original inode for restoration after an in-place mutation.
          fs.copyFileSync(target, saved);
          if (mutation === "grow") fs.appendFileSync(target, " ");
          else if (mutation === "truncate") fs.truncateSync(target, 1);
          else {
            const changed = Buffer.from(original);
            const at = original.indexOf(Buffer.from("test journal boundary"));
            expect(at).toBeGreaterThanOrEqual(0);
            changed[at] ^= 1;
            fs.writeFileSync(target, changed);
          }
        };
        corrupt(invoke);
        expect(fired).toBe(true);
        expect(value.io.reads.every((read) => read.requested <= 65536)).toBe(
          true,
        );
      },
    );
  },
);

describe("journal authority and directory bindings", () => {
  let value;
  beforeAll(() => {
    value = openJournalBoundaryFixture(
      fs.mkdtempSync(path.join(temp, "cc-journal-boundary-")),
    );
  }, 60_000);
  afterAll(() => cleanup(value.root));
  afterEach(() => {
    expect(value.io.live.size).toBe(0);
    value.io.armed = false;
    value.policy.afterVerify = null;
  });

  it.each(["identity", "marker", "head", "anchor"])(
    "uses full precision for the actual %s file",
    (kind) => {
      value.arm(value.files[kind]);
      value.io.stat = (stat, api, file, options) => {
        if (file === value.io.target && api === "fd" && options?.bigint)
          stat.uid += 1n;
        return stat;
      };
      corrupt(() => value.ledger.verify(), "changed while it was opened");
      expect(value.io.reads).toEqual([]);
    },
  );
  it.each(["rootDir", "authorityRootDir", "segmentDir", "anchorDir"])(
    "rejects an actual same-byte %s clone until original restoration",
    (key) => {
      const directory = value.ledger[key],
        saved = path.join(value.root, "saved-directory");
      fs.renameSync(directory, saved);
      fs.cpSync(saved, directory, { recursive: true });
      try {
        expect(() => value.ledger.verify()).toThrow(
          /boundary changed or became unsafe/,
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        fs.renameSync(saved, directory);
      }
      expect(value.ledger.verify()).toMatchObject({ sequence: 1 });
    },
  );
  it.each(["dev", "ino", "mode", "uid", "gid"])(
    "rejects a Number directory %s projection",
    (field) => {
      value.arm(value.files.head);
      value.io.stat = (stat, api, file, options) => {
        if (api === "path" && file === value.ledger.rootDir && options?.bigint)
          stat[field] = Number(stat[field]);
        return stat;
      };
      expect(() => value.ledger.verify()).toThrow(
        /full-precision directory identity/,
      );
    },
  );
  it("rejects a synthetic directory inode change before reading", () => {
    value.arm(value.files.head);
    value.io.stat = (stat, api, file, options) => {
      if (api === "path" && file === value.ledger.rootDir && options?.bigint)
        stat.ino += 1n;
      return stat;
    };
    expect(() => value.ledger.verify()).toThrow(
      /boundary changed or became unsafe/,
    );
  });
  it.each(["cold", "snapshot"])(
    "rechecks directories after the %s signature callback before remembering state",
    (mode) => {
      if (mode === "snapshot") value.ledger.checkpointState();
      value.arm(value.files.segment);
      let fired = false;
      value.policy.afterVerify = ({ purpose }) => {
        if (
          purpose === (mode === "snapshot" ? "state-snapshot" : "domain-event")
        )
          fired = true;
      };
      value.io.stat = (stat, api, file, options) => {
        // Explicitly synthetic owner projection, activated only by the verifier.
        if (
          fired &&
          api === "path" &&
          file === value.ledger.rootDir &&
          options?.bigint
        )
          stat.uid += 1n;
        return stat;
      };
      expect(() => value.open()).toThrow(/boundary changed or became unsafe/);
      expect(fired).toBe(true);
      expect(value.io.opens).toHaveLength(1);
      expect(value.io.reads.reduce((sum, read) => sum + read.count, 0)).toBe(
        fs.statSync(value.files.segment).size,
      );
    },
  );
  it.each(["ENOENT", "EIO"])(
    "wraps a final leaf lstat %s and closes the descriptor",
    (code) => {
      value.arm(value.files.head);
      let fired = false;
      value.io.stat = (stat, api, file, options) => {
        if (
          api === "path" &&
          file === value.files.head &&
          !options?.bigint &&
          value.io.fstats === 2
        ) {
          fired = true;
          throw Object.assign(new Error("test-only late stat fault"), { code });
        }
        return stat;
      };
      const error = corrupt(
        () => value.ledger.verify(),
        "changed during bounded read",
      );
      expect(error.cause).toMatchObject({ code });
      expect(fired).toBe(true);
    },
  );
  it("rechecks the directory when an initial optional leaf stat returns ENOENT", () => {
    value.arm(value.files.head);
    let fired = false;
    value.io.stat = (stat, api, file, options) => {
      if (api === "path" && file === value.files.head && options?.bigint) {
        fired = true;
        throw Object.assign(new Error("test-only initial missing head"), {
          code: "ENOENT",
        });
      }
      if (
        fired &&
        api === "path" &&
        file === value.ledger.rootDir &&
        options?.bigint
      )
        stat.uid += 1n;
      return stat;
    };
    expect(() => value.ledger.verify()).toThrow(
      /boundary changed or became unsafe/,
    );
    expect(fired).toBe(true);
    expect(value.io.opens).toEqual([]);
  });
  it.each(["rootDir", "authorityRootDir", "segmentDir", "anchorDir"])(
    "does not recreate a missing bound %s during a read",
    (key) => {
      const directory = value.ledger[key],
        saved = path.join(value.root, "missing-directory");
      fs.renameSync(directory, saved);
      try {
        expect(() => value.ledger.verify()).toThrow(
          key === "authorityRootDir"
            ? /lock fence is unavailable/
            : /boundary is unavailable/,
        );
        expect(fs.existsSync(directory)).toBe(false);
      } finally {
        fs.renameSync(saved, directory);
      }
      expect(value.ledger.verify()).toMatchObject({ sequence: 1 });
    },
  );
  it.runIf(process.platform !== "win32")(
    "rejects actual directory mode changes without recreating the directory",
    () => {
      const directory = value.ledger.segmentDir;
      fs.chmodSync(directory, 0o710);
      try {
        expect(() => value.ledger.verify()).toThrow(
          /boundary changed or became unsafe/,
        );
      } finally {
        fs.chmodSync(directory, 0o700);
      }
      expect(value.ledger.verify()).toMatchObject({ sequence: 1 });
    },
  );
});
