import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import records from "../../src/lib/settings-authority-record.cjs";
import observation from "../../src/lib/settings-source-observation.cjs";

const {
  LIMITS,
  createManifest,
  createInitialLedger,
  validateLedger,
  validateGuard,
  recordDigest,
  assertContextMatches,
  prepareTransition,
  registerContext,
  settleTransition,
} = records;
const { observeSettingsSources } = observation;
let root;
let files;
let manifest;
let initial;
const allow = '{"permissions":{"allow":["Read"]}}\n';
const deny = '{"permissions":{"deny":["Read"]}}\n';
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const bindingPath = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;

function snapshot(contextId = "primary", candidates = files) {
  return createManifest({
    contextId,
    discovery: [root],
    sources: observeSettingsSources(candidates),
  });
}

function expected(bytes) {
  return {
    exists: true,
    byteLength: Buffer.byteLength(bytes),
    digest: digest(bytes),
  };
}

function prepare(
  ledger = initial,
  bytes = deny,
  transactionId = "transaction-1",
) {
  return prepareTransition({
    ledger,
    transactionId,
    intent: {
      kind: "write",
      physicalPath: ledger.contexts[0].sources[0].physicalPath,
      after: expected(bytes),
    },
  });
}

function replace(bytes, target = files[0]) {
  const temporary = path.join(root, "replacement.tmp");
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
}

function expectCode(callback, code) {
  try {
    callback();
  } catch (error) {
    expect(error.name).toBe("SettingsAuthorityRecordError");
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-record-"));
  files = [path.join(root, "settings.json"), path.join(root, "local.json")];
  fs.writeFileSync(files[0], allow);
  manifest = snapshot();
  initial = createInitialLedger({ epoch: "epoch-1", contexts: [manifest] });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("pure settings authority records", () => {
  it("retains ordered absent and duplicate candidates with immutable full identities", () => {
    const full = snapshot("ordered", [files[1], files[0], files[1]]);
    const ledger = createInitialLedger({ epoch: "epoch-1", contexts: [full] });
    expect(ledger.contexts[0].sources.map((source) => source.exists)).toEqual([
      false,
      true,
      false,
    ]);
    expect(ledger.physicalHeads).toHaveLength(2);
    expect(ledger.contexts[0].sources[1].fileIdentity).toEqual(
      manifest.sources[0].fileIdentity,
    );
    expect(ledger.contexts[0].sources[1]).not.toHaveProperty("settings");
    expect(Object.isFrozen(ledger.contexts[0].sources[1].fileIdentity)).toBe(
      true,
    );
    expect(() => {
      ledger.contexts[0].sources.pop();
    }).toThrow();
    expect(assertContextMatches({ ledger, manifest: full })).toBe(true);
  });

  it("constructs an empty initial record without touching any file or enrolling a context", () => {
    const before = fs.readdirSync(root);
    const ledger = createInitialLedger({ epoch: "explicit-bootstrap" });
    expect(ledger).toMatchObject({
      generation: 0,
      phase: "ready",
      contexts: [],
      physicalHeads: [],
    });
    expect(fs.readdirSync(root)).toEqual(before);
    expectCode(
      () => assertContextMatches({ ledger, manifest }),
      "CC_SETTINGS_AUTHORITY_CONTEXT_UNREGISTERED",
    );
  });

  it("returns defensive copies and canonical digests independent of object key order", () => {
    const mutable = clone(initial);
    const reversed = Object.fromEntries(Object.entries(mutable).reverse());
    expect(recordDigest({ record: reversed })).toBe(
      recordDigest({ record: initial }),
    );
    const checked = validateLedger({ record: mutable });
    mutable.contexts[0].discovery.pop();
    expect(checked.contexts[0].discovery).toEqual(
      initial.contexts[0].discovery,
    );
  });

  it("rejects missing, extra, malformed and inconsistent records", () => {
    const changes = [
      (value) => {
        delete value.epoch;
      },
      (value) => {
        value.extra = true;
      },
      (value) => {
        value.phase = "unknown";
      },
      (value) => {
        value.generation = -1;
      },
      (value) => {
        value.generation = 1.5;
      },
      (value) => {
        value.generation = Number.MAX_SAFE_INTEGER + 1;
      },
      (value) => {
        value.transition = {};
      },
      (value) => {
        value.transactionId = "leftover";
      },
      (value) => {
        value.physicalHeads.pop();
      },
      (value) => {
        value.physicalHeads.reverse();
      },
      (value) => {
        value.contexts[0].sources[0].digest = "not-a-hash";
      },
      (value) => {
        value.contexts[0].sources[0].fileIdentity = null;
      },
      (value) => {
        value.contexts[0].sources[1].fileIdentity = {};
      },
      (value) => {
        value.contexts[0].sources[0].fileIdentity.nlink = "2";
      },
      (value) => {
        value.contexts[0].sources[0].fileIdentity.mode = "40960";
      },
      (value) => {
        value.contexts[0].sources[0].fileIdentity.size = "0001";
      },
      (value) => {
        value.contexts[0].sources[1].exists = "unknown";
      },
      (value) => {
        value.contexts[0].sources[1].digest = digest("");
      },
      (value) => {
        value.contexts[0].sources = [];
      },
      (value) => {
        value.contexts[0].sources[0].remainingPath = "../settings.json";
      },
    ];
    for (const change of changes) {
      const value = clone(initial);
      change(value);
      expect(() => validateLedger({ record: value })).toThrow();
    }
    for (const value of [null, undefined, [], false]) {
      expect(() => validateLedger({ record: value })).toThrow();
    }
  });

  it("never invokes getters, Proxy traps or toJSON while checking records", () => {
    let calls = 0;
    const getter = clone(initial);
    Object.defineProperty(getter, "contexts", {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    const proxy = new Proxy(initial, {
      ownKeys() {
        calls++;
        return [];
      },
    });
    const toJSON = {
      ...initial,
      toJSON() {
        calls++;
        return initial;
      },
    };
    for (const record of [getter, proxy, toJSON]) {
      expectCode(
        () => validateLedger({ record }),
        "CC_SETTINGS_AUTHORITY_RECORD_INVALID",
      );
    }
    const observed = { ...observeSettingsSources(files)[0] };
    Object.defineProperty(observed, "settings", {
      get() {
        calls++;
        throw new Error("not a binding");
      },
    });
    createManifest({
      contextId: "selected",
      discovery: [root],
      sources: [observed],
    });
    expect(calls).toBe(0);
  });

  it("bounds records, paths, context totals and sparse or cyclic structures", () => {
    const tooMany = Array.from({ length: LIMITS.contexts + 1 }, (_, index) => ({
      ...manifest,
      contextId: `context-${index}`,
    }));
    expect(() =>
      createInitialLedger({ epoch: "epoch-1", contexts: tooMany }),
    ).toThrow();
    const full = {
      ...manifest,
      sources: Array.from(
        { length: LIMITS.sourcesPerContext },
        () => manifest.sources[0],
      ),
    };
    const total = Array.from({ length: 17 }, (_, index) => ({
      ...full,
      contextId: `context-${index}`,
    }));
    expect(() =>
      createInitialLedger({ epoch: "epoch-1", contexts: total }),
    ).toThrow();
    expect(() =>
      createManifest({
        contextId: "overlong",
        discovery: ["/" + "a".repeat(LIMITS.pathBytes)],
        sources: [],
      }),
    ).toThrow();
    const cyclic = clone(initial);
    cyclic.contexts = [cyclic];
    expect(() => validateLedger({ record: cyclic })).toThrow();
    const sparse = clone(initial);
    sparse.contexts = new Array(1);
    expect(() => validateLedger({ record: sparse })).toThrow();
    const enormous = { ...initial, extra: "a".repeat(LIMITS.recordBytes + 1) };
    expect(() => validateLedger({ record: enormous })).toThrow();
    const sourceArray = [manifest.sources[0]];
    Object.defineProperty(sourceArray, "0", {
      get() {
        throw new Error("accessor executed");
      },
    });
    expectCode(
      () =>
        createManifest({
          contextId: "sparse",
          discovery: [root],
          sources: sourceArray,
        }),
      "CC_SETTINGS_AUTHORITY_RECORD_INVALID",
    );
  });

  it("detects reordered discovery, omitted candidates and metadata-only edits", () => {
    for (const change of [
      (value) => value.sources.reverse(),
      (value) => value.sources.pop(),
      (value) => {
        value.discovery = [bindingPath(path.dirname(root))];
      },
      (value) => {
        value.sources[0].fileIdentity.ctimeNs = "123";
      },
    ]) {
      const observed = clone(manifest);
      change(observed);
      expectCode(
        () => assertContextMatches({ ledger: initial, manifest: observed }),
        "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
      );
    }
  });

  it("normalizes Windows case and rejects drive-relative, device and ambiguous aliases", () => {
    const source = {
      ...clone(manifest.sources[0]),
      logicalPath: "C:\\Project\\Settings.JSON",
      physicalPath: "C:\\Real\\Settings.JSON",
      nearestExistingParent: "C:\\Real",
      remainingPath: "Settings.JSON",
    };
    const result = createManifest({
      contextId: "windows",
      platform: "win32",
      discovery: ["C:\\Project"],
      sources: [source],
    });
    expect(result.sources[0].physicalPath).toBe("c:\\real\\settings.json");
    const ledger = createInitialLedger({
      epoch: "epoch-windows",
      platform: "win32",
      contexts: [result],
    });
    const alias = createManifest({
      contextId: "alias",
      platform: "win32",
      discovery: ["c:\\PROJECT"],
      sources: [{ ...source, logicalPath: "c:\\PROJECT\\settings.json" }],
    });
    expect(
      registerContext({ ledger, manifest: alias, transactionId: "register" })
        .prepared.generation,
    ).toBe(1);
    for (const logicalPath of [
      "C:relative.json",
      "\\relative.json",
      "\\\\?\\C:\\settings.json",
      "C:\\settings.json.",
      "C:\\settings.json ",
      "C:\\settings.json:stream",
    ]) {
      expect(() =>
        createManifest({
          contextId: "unsafe",
          platform: "win32",
          discovery: ["C:\\Project"],
          sources: [{ ...source, logicalPath }],
        }),
      ).toThrow();
    }
  });
});

describe("explicit registration and inverse physical heads", () => {
  it("requires a consumed-generation registration transaction, preserving all prior contexts", () => {
    const added = snapshot("additional");
    const transaction = registerContext({
      ledger: initial,
      manifest: added,
      transactionId: "enroll",
    });
    expect(transaction.prepared).toMatchObject({
      phase: "prepared",
      generation: 1,
      contexts: [manifest],
    });
    const ready = settleTransition({
      ...transaction,
      contexts: [manifest, added],
      outcome: "after",
    });
    expect(ready).toMatchObject({
      phase: "ready",
      generation: 1,
      transactionId: null,
      transition: null,
    });
    expect(ready.physicalHeads).toHaveLength(2);
    expect(assertContextMatches({ ledger: ready, manifest: added })).toBe(true);
    const aborted = settleTransition({
      ...transaction,
      contexts: [manifest],
      outcome: "before",
    });
    expect(aborted.generation).toBe(1);
    expect(aborted.contexts).toHaveLength(1);
    expectCode(
      () =>
        registerContext({
          ledger: initial,
          manifest,
          transactionId: "duplicate",
        }),
      "CC_SETTINGS_AUTHORITY_CONTEXT_EXISTS",
    );
  });

  it("rejects stale bytes at an existing physical head even under a new logical alias", () => {
    const stale = clone(manifest);
    stale.contextId = "new-alias";
    stale.sources[0].logicalPath = bindingPath(path.join(root, "alias.json"));
    stale.sources[0].digest = digest(deny);
    expectCode(
      () =>
        registerContext({
          ledger: initial,
          manifest: stale,
          transactionId: "enroll",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });

  it("rejects rebinding an existing logical path to another physical target", () => {
    const rebound = clone(manifest);
    rebound.contextId = "rebound";
    rebound.sources[0].physicalPath = path.join(
      rebound.sources[0].nearestExistingParent,
      "different.json",
    );
    rebound.sources[0].remainingPath = "different.json";
    expectCode(
      () =>
        registerContext({
          ledger: initial,
          manifest: rebound,
          transactionId: "enroll",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });

  it("rejects a new final-component physical alias for an already bound file identity", () => {
    const alias = clone(manifest);
    alias.contextId = "short-name";
    alias.sources[0].logicalPath = bindingPath(path.join(root, "short.json"));
    alias.sources[0].physicalPath = path.join(
      alias.sources[0].nearestExistingParent,
      "short.json",
    );
    alias.sources[0].remainingPath = "short.json";
    expectCode(
      () =>
        registerContext({
          ledger: initial,
          manifest: alias,
          transactionId: "enroll",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });

  it("does not let registration silently reconcile edits in already registered contexts", () => {
    const transaction = registerContext({
      ledger: initial,
      manifest: snapshot("new"),
      transactionId: "enroll",
    });
    replace(deny);
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [snapshot(), snapshot("new")],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });
});

describe("prepared, guard and settlement invariants", () => {
  it("binds guard to the exact epoch, generation, transaction, before record and intent", () => {
    const transaction = prepare();
    const { prepared, guard } = transaction;
    expect(guard.beforeDigest).toBe(recordDigest({ record: initial }));
    expect(validateGuard({ guard, prepared })).toEqual(guard);
    for (const change of [
      (value) => {
        value.epoch = "other-epoch";
      },
      (value) => {
        value.generation++;
      },
      (value) => {
        value.transactionId = "other-transaction";
      },
      (value) => {
        value.beforeDigest = "0".repeat(64);
      },
      (value) => {
        value.intent.after.digest = "0".repeat(64);
      },
    ]) {
      const changed = clone(guard);
      change(changed);
      expectCode(
        () => validateGuard({ guard: changed, prepared }),
        "CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH",
      );
    }
    const changed = clone(prepared);
    changed.transition.beforeDigest = "0".repeat(64);
    expectCode(
      () => validateLedger({ record: changed }),
      "CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH",
    );
    expectCode(
      () => assertContextMatches({ ledger: prepared, manifest }),
      "CC_SETTINGS_AUTHORITY_NOT_READY",
    );
    expectCode(() => prepare(prepared), "CC_SETTINGS_AUTHORITY_NOT_READY");
  });

  it("requires guard and exact old/new outcomes, retaining consumed generation on recovery", () => {
    const transaction = prepare();
    expect(() =>
      settleTransition({
        prepared: transaction.prepared,
        guard: null,
        contexts: [manifest],
        outcome: "before",
      }),
    ).toThrow();
    const recovered = settleTransition({
      ...transaction,
      contexts: [snapshot()],
      outcome: "before",
    });
    expect(recovered.generation).toBe(1);
    expect(recovered.contexts).toEqual(initial.contexts);
    expect(recordDigest({ record: recovered })).not.toBe(
      recordDigest({ record: initial }),
    );
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [snapshot()],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_CONTENT_MISMATCH",
    );
    replace('{"unexpected":true}\n');
    for (const outcome of ["before", "after"]) {
      expectCode(
        () =>
          settleTransition({ ...transaction, contexts: [snapshot()], outcome }),
        "CC_SETTINGS_AUTHORITY_CONTENT_MISMATCH",
      );
    }
  });

  it("allows exact-old recovery with a changed target inode without discarding the revision", () => {
    const transaction = prepare();
    replace(allow);
    const observed = snapshot();
    const result = settleTransition({
      ...transaction,
      contexts: [observed],
      outcome: "before",
    });
    expect(result.generation).toBe(1);
    expect(result.contexts[0].sources[0].fileIdentity).toEqual(
      observed.sources[0].fileIdentity,
    );
    expect(result.contexts[0].sources[0].digest).toBe(
      manifest.sources[0].digest,
    );
  });

  it("records official allow-deny-allow ABA with two consumed generations", () => {
    const first = prepare();
    replace(deny);
    const denied = settleTransition({
      ...first,
      contexts: [snapshot()],
      outcome: "after",
    });
    expect(denied.generation).toBe(1);
    const second = prepare(denied, allow, "transaction-2");
    replace(allow);
    const restored = settleTransition({
      ...second,
      contexts: [snapshot()],
      outcome: "after",
    });
    expect(restored.generation).toBe(2);
    expect(restored.contexts[0].sources[0].digest).toBe(
      initial.contexts[0].sources[0].digest,
    );
    expect(recordDigest({ record: restored })).not.toBe(
      recordDigest({ record: initial }),
    );
  });

  it("updates every real directory alias and rejects an incomplete context inventory", () => {
    const real = path.join(root, "real");
    const alias = path.join(root, "alias");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "settings.json"), allow);
    fs.symlinkSync(
      real,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const realFiles = [path.join(real, "settings.json")];
    const aliasFiles = [path.join(alias, "settings.json")];
    const both = [snapshot("real", realFiles), snapshot("alias", aliasFiles)];
    const ledger = createInitialLedger({ epoch: "epoch-1", contexts: both });
    expect(ledger.physicalHeads).toHaveLength(1);
    const transaction = prepare(ledger);
    replace(deny, realFiles[0]);
    const updated = [
      snapshot("real", realFiles),
      snapshot("alias", aliasFiles),
    ];
    const ready = settleTransition({
      ...transaction,
      contexts: updated,
      outcome: "after",
    });
    expect(ready.contexts[0].sources[0].fileIdentity).toEqual(
      ready.contexts[1].sources[0].fileIdentity,
    );
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [updated[0]],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [updated[0], both[1]],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });

  it("allows creation or removal under an unchanged existing parent", () => {
    const missing = createInitialLedger({
      epoch: "epoch-1",
      contexts: [snapshot("primary", [files[1]])],
    });
    const create = prepare(missing, allow);
    fs.writeFileSync(files[1], allow);
    const created = settleTransition({
      ...create,
      contexts: [snapshot("primary", [files[1]])],
      outcome: "after",
    });
    expect(created.physicalHeads[0].exists).toBe(true);
    const remove = prepareTransition({
      ledger: created,
      transactionId: "delete",
      intent: {
        kind: "write",
        physicalPath: created.physicalHeads[0].physicalPath,
        after: { exists: false, byteLength: 0, digest: null },
      },
    });
    fs.unlinkSync(files[1]);
    const removed = settleTransition({
      ...remove,
      contexts: [snapshot("primary", [files[1]])],
      outcome: "after",
    });
    expect(removed.generation).toBe(2);
    expect(removed.physicalHeads[0].fileIdentity).toBeNull();
  });

  it("rejects unplanned parent materialization and binding movement", () => {
    const candidate = path.join(root, "missing-directory", "settings.json");
    const ledger = createInitialLedger({
      epoch: "epoch-1",
      contexts: [snapshot("primary", [candidate])],
    });
    expectCode(
      () => prepare(ledger),
      "CC_SETTINGS_AUTHORITY_PARENT_MATERIALIZATION_UNSUPPORTED",
    );
    const transaction = prepare();
    replace(deny);
    const changed = clone(snapshot());
    changed.sources[0].parentIdentity.ino = "9999999999";
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [changed],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });

  it("refuses changes to non-target sources or to the discovery route", () => {
    const transaction = prepare();
    replace(deny);
    fs.writeFileSync(files[1], "{}");
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [snapshot()],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
    fs.unlinkSync(files[1]);
    const changed = clone(snapshot());
    changed.discovery = [bindingPath(path.dirname(root))];
    expectCode(
      () =>
        settleTransition({
          ...transaction,
          contexts: [changed],
          outcome: "after",
        }),
      "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
    );
  });

  it("rejects unregistered writes and exhausted generations rather than wrapping", () => {
    expectCode(
      () =>
        prepareTransition({
          ledger: initial,
          transactionId: "unknown",
          intent: {
            kind: "write",
            physicalPath: bindingPath(path.join(root, "unregistered.json")),
            after: expected(allow),
          },
        }),
      "CC_SETTINGS_AUTHORITY_SOURCE_UNREGISTERED",
    );
    const exhausted = { ...initial, generation: Number.MAX_SAFE_INTEGER };
    expectCode(
      () => prepare(exhausted),
      "CC_SETTINGS_AUTHORITY_GENERATION_EXHAUSTED",
    );
  });
});
