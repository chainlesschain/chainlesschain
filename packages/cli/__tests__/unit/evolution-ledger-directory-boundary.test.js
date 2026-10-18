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
  EvolutionLedger,
  captureEvolutionLedgerDirectoryBoundary as capture,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  createEvolutionLedgerFileBackend,
  captureEvolutionLedgerFileBackendSourceDirectoryBoundary as captureBackend,
} from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";
import { openJournalBoundaryFixture } from "../fixtures/evolution-journal-boundary.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const temp = fs.realpathSync.native(os.tmpdir());
const hash = (descriptor) =>
  rrsiHash(
    "chainlesschain.rrsi-source-journal-directory-boundary/v1",
    descriptor,
  );
const roles = ["rootDir", "authorityRootDir", "segmentDir", "anchorDir"];
const held = (operation) =>
  expect(operation).toThrow(
    expect.objectContaining({ code: "CC_EVOLUTION_LEDGER_STORE_UNSAFE" }),
  );
describe("original source ledger directory capability", () => {
  let value, originalDigest;
  beforeAll(() => {
    value = openJournalBoundaryFixture(
      fs.mkdtempSync(path.join(temp, "cc-source-directory-")),
    );
    originalDigest = hash(capture(value.ledger).descriptor);
  }, 60_000);
  afterAll(() => {
    if (
      path.dirname(value.root) !== temp ||
      !path.basename(value.root).startsWith("cc-source-directory-")
    )
      throw new Error("unsafe source directory cleanup");
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  beforeEach(() => value.arm(value.files.head));
  afterEach(() => {
    value.io.armed = false;
    expect(value.io.live.size).toBe(0);
  });

  it("exports exact original four-directory pins as frozen serializable data", () => {
    const boundary = capture(value.ledger);
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Object.isFrozen(boundary.recheck)).toBe(true);
    expect(boundary.descriptor).toMatchObject({
      scope: "source-journal-four-directories",
      journalFileIdentityVerified: false,
      journalContentsVerified: false,
      witnessDirectoriesVerified: false,
      retentionStorageVerified: false,
      fullPhysicalStorageGraphVerified: false,
      rootAuthorityVerified: false,
      crossProcessRollbackProtectionVerified: false,
      tenantWideIndexAuthorityVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
    expect(boundary.descriptor.directories.map((entry) => entry.role)).toEqual([
      "events",
      "authority",
      "segments",
      "anchors",
    ]);
    boundary.descriptor.directories.forEach((entry, index) => {
      const stat = fs.lstatSync(value.ledger[roles[index]], { bigint: true });
      expect(entry.path).toBe(
        fs.realpathSync.native(value.ledger[roles[index]]),
      );
      for (const field of ["dev", "ino", "mode", "uid", "gid"])
        expect(entry.identity[field]).toBe(String(stat[field]));
      expect(Object.isFrozen(entry.identity)).toBe(true);
    });
    expect(() => JSON.stringify(boundary.descriptor)).not.toThrow();
    expect(() => {
      boundary.descriptor.directories[0].identity.ino = "0";
    }).toThrow(TypeError);
    expect(boundary.recheck()).toBe(boundary.descriptor);
    expect(capture(value.ledger)).toBe(boundary);
    expect(value.io.allOpens).toEqual([]);
  });
  it("keeps the descriptor across real append, snapshot publication and reopening original directories", () => {
    const boundary = capture(value.ledger);
    value.io.armed = false;
    value.append("source-boundary-second");
    value.ledger.checkpointState();
    const reopened = value.open();
    value.arm(value.files.head);
    expect(hash(boundary.recheck())).toBe(originalDigest);
    expect(hash(capture(reopened).descriptor)).toBe(originalDigest);
    expect(value.io.allOpens).toEqual([]);
  });
  it("uses only original lstat/realpath without opening, locking, reading content or calling trusted ports", () => {
    let metadataOnly = false;
    const guarded =
      (implementation) =>
      (...args) => {
        if (metadataOnly)
          throw new Error("unexpected side effect in metadata capability");
        return implementation(...args);
      };
    const port = Object.fromEntries(
      Object.entries(value.options.fsImpl).map(([name, implementation]) => [
        name,
        typeof implementation === "function" &&
        !["lstatSync", "realpathSync"].includes(name)
          ? guarded(implementation)
          : implementation,
      ]),
    );
    const witness = Object.fromEntries(
      Object.entries(value.options.witness).map(([name, implementation]) => [
        name,
        typeof implementation === "function"
          ? guarded(implementation)
          : implementation,
      ]),
    );
    const monitored = new EvolutionLedger({
      ...value.options,
      fsImpl: port,
      witness,
      sign: guarded(value.options.sign),
      verifySignature: guarded(value.options.verifySignature),
      verifyWitnessSignature: guarded(value.options.verifyWitnessSignature),
      artifactResolver: guarded(value.options.artifactResolver),
    });
    metadataOnly = true;
    const boundary = capture(monitored);
    expect(boundary.recheck()).toBe(boundary.descriptor);
    expect(hash(boundary.descriptor)).toBe(originalDigest);
  });
  it("binds an actual v1 backend directly to its original public source ledger", () => {
    const config = evolutionDurableStoreConfiguration(value.root);
    const backend = createEvolutionLedgerFileBackend({
      rootDir: value.ledger.rootDir,
      authorityRootDir: value.ledger.authorityRootDir,
      witnessFilePath: path.join(value.root, "witness", "checkpoint.json"),
      witnessId: "journal-boundary-witness",
      ledgerAuthority: config.ledgerAuthority,
      witnessAuthority: config.witnessAuthority,
      artifactResolver: value.options.artifactResolver,
      fsImpl: value.options.fsImpl,
      secure: false,
      clock: config.clock,
    });
    value.arm(value.files.head);
    const boundary = captureBackend(backend);
    expect(boundary).toBe(capture(backend.ledger));
    expect(hash(boundary.descriptor)).toBe(originalDigest);
    let traps = 0;
    const proxy = new Proxy(backend, {
      get() {
        traps++;
        throw new Error("backend getter trap");
      },
      getPrototypeOf() {
        traps++;
        throw new Error("backend prototype trap");
      },
    });
    const revoked = Proxy.revocable(backend, {});
    revoked.revoke();
    for (const fake of [{ ...backend }, proxy, revoked.proxy])
      expect(() => captureBackend(fake)).toThrow(TypeError);
    expect(traps).toBe(0);
    expect(value.io.allOpens).toEqual([]);
  });
  it.each(roles)(
    "refuses an actual %s clone before first capture and after capture",
    (key) => {
      const uncaptured = value.open(),
        boundary = capture(value.ledger);
      const directory = value.ledger[key],
        saved = path.join(value.root, "saved-directory");
      if (
        !directory.startsWith(value.root + path.sep) ||
        path.dirname(saved) !== value.root
      )
        throw new Error("unsafe clone target");
      fs.renameSync(directory, saved);
      fs.cpSync(saved, directory, { recursive: true });
      try {
        held(() => capture(uncaptured));
        held(() => capture(value.ledger));
        held(() => boundary.recheck());
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        fs.renameSync(saved, directory);
      }
      expect(hash(boundary.recheck())).toBe(originalDigest);
    },
  );
  it.each(roles)(
    "does not recreate missing %s or acquire the authority lock",
    (key) => {
      const boundary = capture(value.ledger),
        directory = value.ledger[key],
        saved = path.join(value.root, "missing-directory");
      fs.renameSync(directory, saved);
      try {
        held(() => boundary.recheck());
        held(() => capture(value.ledger));
        expect(fs.existsSync(directory)).toBe(false);
        expect(value.io.allOpens).toEqual([]);
      } finally {
        fs.renameSync(saved, directory);
      }
      expect(hash(boundary.recheck())).toBe(originalDigest);
    },
  );
  it.each(roles)("rejects an actual %s junction/symlink alias", (key) => {
    const boundary = capture(value.ledger),
      directory = value.ledger[key],
      saved = path.join(value.root, "aliased-directory");
    fs.renameSync(directory, saved);
    fs.symlinkSync(
      saved,
      directory,
      process.platform === "win32" ? "junction" : "dir",
    );
    try {
      held(() => capture(value.ledger));
      held(() => boundary.recheck());
    } finally {
      fs.unlinkSync(directory);
      fs.renameSync(saved, directory);
    }
    expect(hash(boundary.recheck())).toBe(originalDigest);
  });
  it.each(["dev", "ino", "mode", "uid", "gid"])(
    "refuses a Number fallback for directory %s",
    (field) => {
      const boundary = capture(value.ledger);
      value.io.stat = (stat, api, file, options) => {
        if (api === "path" && file === value.ledger.rootDir && options?.bigint)
          stat[field] = Number(stat[field]);
        return stat;
      };
      held(() => boundary.recheck());
      expect(value.io.allOpens).toEqual([]);
    },
  );
  it("does not claim HEAD content authentication from metadata-only success", () => {
    const boundary = capture(value.ledger),
      original = fs.readFileSync(value.files.head);
    fs.writeFileSync(value.files.head, "corrupt");
    try {
      expect(hash(boundary.recheck())).toBe(originalDigest);
      expect(boundary.descriptor.journalContentsVerified).toBe(false);
      expect(() => value.ledger.verify()).toThrow(
        expect.objectContaining({ code: "CC_EVOLUTION_LEDGER_CORRUPT" }),
      );
    } finally {
      fs.writeFileSync(value.files.head, original);
    }
  });
  it("rejects proxies and revoked proxies without invoking traps", () => {
    let traps = 0;
    const proxy = new Proxy(value.ledger, {
      get() {
        traps++;
        throw new Error("get trap");
      },
      getPrototypeOf() {
        traps++;
        throw new Error("prototype trap");
      },
    });
    expect(() => capture(proxy)).toThrow(TypeError);
    const revoked = Proxy.revocable(value.ledger, {});
    revoked.revoke();
    expect(() => capture(revoked.proxy)).toThrow(TypeError);
    expect(() => captureBackend(proxy)).toThrow(TypeError);
    expect(traps).toBe(0);
  });
  it("rejects descriptor copies, prototype impersonation, subclasses and alternate newTarget", () => {
    for (const fake of [
      { ...value.ledger },
      Object.create(EvolutionLedger.prototype),
      capture(value.ledger).descriptor,
      null,
    ])
      expect(() => capture(fake)).toThrow(TypeError);
    class Child extends EvolutionLedger {}
    expect(() => capture(new Child(value.options))).toThrow(TypeError);
    function Alternate() {}
    Alternate.prototype = EvolutionLedger.prototype;
    const alternate = Reflect.construct(
      EvolutionLedger,
      [value.options],
      Alternate,
    );
    expect(Object.getPrototypeOf(alternate)).toBe(EvolutionLedger.prototype);
    expect(() => capture(alternate)).toThrow(TypeError);
    expect(() => captureBackend({ ...value.ledger })).toThrow(TypeError);
  });
  it("rejects every replacement context before reading its accessors or callback", () => {
    let calls = 0;
    const replacement = {
      get directory() {
        calls++;
        throw new Error("getter");
      },
      recheck() {
        calls++;
      },
    };
    const boundary = capture(value.ledger);
    expect(() => capture(value.ledger, replacement)).toThrow(TypeError);
    expect(() => boundary.recheck(replacement)).toThrow(TypeError);
    expect(() => captureBackend(value.ledger, replacement)).toThrow(TypeError);
    expect(calls).toBe(0);
    expect(value.io.allOpens).toEqual([]);
  });
});
