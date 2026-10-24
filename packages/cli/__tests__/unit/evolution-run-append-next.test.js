import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EvolutionArtifactPorts,
  captureEvolutionLedgerWholeHistoryReader,
  hasEvolutionLedgerDefaultPublication,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { hasEvolutionLedgerDefaultAppendPorts } from "../../src/lib/evolution/evolution-ledger.js";
import { withFileLock } from "../../src/lib/with-file-lock.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  EvolutionRunLedgerAdapter,
  captureEvolutionRunAppendNext,
} from "../../src/lib/evolution/evolution-run-ledger-adapter.js";
import { createAgentEvolutionIngress } from "../../src/lib/evolution/agent-evolution-ingress.js";
import { EvolutionEvidenceArtifactAdapter } from "../../src/lib/evolution/evolution-evidence-artifact-adapter.js";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";

const { EVOLUTION_RUN_EVENT_SCHEMA, EVENT_TYPES } = evolutionRun;
const temp = fs.realpathSync.native(os.tmpdir()),
  roots = [];
const hash = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-run-next-")
    )
      throw new Error("unsafe append-next cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture({ customPort = null } = {}) {
  const root = fs.mkdtempSync(path.join(temp, "cc-run-next-"));
  roots.push(root);
  const config = evolutionDurableStoreConfiguration(root);
  const hooks = {
    onAuthority: null,
    onTimestamp: null,
    onSign: null,
    customCalls: 0,
  };
  const ledgerSigner = config.ledgerAuthority.signer;
  config.ledgerAuthority = {
    ...config.ledgerAuthority,
    signer: {
      sign(request) {
        hooks.onSign?.(request);
        return ledgerSigner.sign(request);
      },
    },
  };
  const store = new ArtifactStore({
    dir: path.join(root, "artifacts"),
    now: config.clock,
    ...(customPort === "index-lock"
      ? {
          indexLock: (...args) => {
            hooks.customCalls += 1;
            return withFileLock(...args);
          },
        }
      : {}),
  });
  if (customPort === "publish") {
    const original = store.publishDataOnce;
    store.publishDataOnce = function (...args) {
      hooks.customCalls += 1;
      return original.apply(this, args);
    };
  }
  const ports = new EvolutionArtifactPorts({
    artifactStore: store,
    tenantId: config.descriptor.artifactTenantId,
    audience: config.descriptor.audience,
    now: config.clock,
    ...config.artifactAuthority,
    currentAuthorityResolver: {
      resolve(request) {
        hooks.onAuthority?.(request);
        return config.artifactAuthority.currentAuthorityResolver.resolve(
          request,
        );
      },
    },
  });
  const resolver = ports.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  fs.mkdirSync(path.join(root, "witness"), { recursive: true, mode: 0o700 });
  const backendOptions = {
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "append-next-witness",
    ledgerAuthority: config.ledgerAuthority,
    witnessAuthority: config.witnessAuthority,
    artifactResolver: resolver,
    fsImpl: config.fsImpl,
    secure: false,
    clock: config.clock,
    ...(customPort === "crash"
      ? {
          crashHook: () => {
            hooks.customCalls += 1;
          },
        }
      : {}),
    ...(customPort === "lock"
      ? {
          lock: (...args) => {
            hooks.customCalls += 1;
            return withFileLock(...args);
          },
        }
      : {}),
  };
  let backend = createEvolutionLedgerFileBackend(backendOptions);
  const descriptor = { ...config.descriptor, runId: "append-next-run" };
  const makeAdapter = (overrides = {}) =>
    new EvolutionRunLedgerAdapter({
      descriptor,
      artifactPorts: ports,
      ledger: backend.ledger,
      ledgerArtifactResolver: resolver,
      now: () => {
        hooks.onTimestamp?.();
        return config.clock();
      },
      ...overrides,
    });
  const event = (
    id,
    type = EVENT_TYPES.RAW_EVENT_REFERENCED,
    runId = descriptor.runId,
  ) => ({
    schema: EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: descriptor.tenantId,
    runId,
    eventId: id,
    type,
    subjectId: id,
    payloadDigest: hash(id),
    artifactRef: null,
    keyRef: null,
    data: { marker: id },
  });
  let adapter = makeAdapter();
  adapter.appendEvent({
    ...event("started", EVENT_TYPES.RUN_STARTED),
    sequence: 1,
  });
  if (customPort === "filesystem") {
    // Seed through the production filesystem, then genuinely reopen using the
    // custom dependency. The measured append still exercises every legacy
    // custom-fs phase without paying its slow Windows setup twice.
    if (config.fsImpl === fs) config.fsImpl = Object.create(fs);
    Object.defineProperty(config.fsImpl, "openSync", {
      enumerable: true,
      value: (...args) => {
        hooks.customCalls += 1;
        return fs.openSync(...args);
      },
    });
    backend = createEvolutionLedgerFileBackend({
      ...backendOptions,
      fsImpl: config.fsImpl,
    });
    adapter = makeAdapter();
  }
  const indexPath = path.join(root, "artifacts", "index.jsonl");
  const firstEntry = JSON.parse(
    fs.readFileSync(indexPath, "utf8").trim().split("\n")[0],
  );
  const genesisPath = path.join(
    backend.ledger.anchorDir,
    fs.readdirSync(backend.ledger.anchorDir).sort()[0],
  );
  return {
    root,
    config,
    hooks,
    store,
    ports,
    resolver,
    backend,
    descriptor,
    makeAdapter,
    event,
    adapter,
    indexPath,
    genesisPath,
    firstPayload: store.storedPath(firstEntry),
  };
}

function appendNext(f, event = f.event("next")) {
  const append = captureEvolutionRunAppendNext(f.adapter);
  expect(append).toBeTypeOf("function");
  return append(event);
}

function ingressFor(f) {
  const evidenceAdapter = Object.create(
    EvolutionEvidenceArtifactAdapter.prototype,
  );
  Object.defineProperty(evidenceAdapter, "projectAndPersist", {
    value: async () => ({
      tenantId: f.descriptor.tenantId,
      evidenceId: "evidence",
      manifest: {
        type: "evidence",
        digest: hash("manifest"),
        ref: { ref: "cc-evolution-artifact:evidence" },
      },
    }),
  });
  return createAgentEvolutionIngress({
    evidenceAdapter,
    runAdapter: f.adapter,
    sourceEnvelopeAuthority: { issue: async () => "signed-source" },
    now: () => new Date(f.config.clock()),
    idGenerator: () => "ingress-event",
  });
}

describe("original Run append-next composition", () => {
  it("removes two complete ledger reads and the standalone head read from load-then-append", () => {
    // Install before construction: the real ledger captures filesystem methods.
    const opened = vi.spyOn(fs, "openSync");
    const slow = fixture(),
      fast = fixture();
    opened.mockClear();
    const current = slow.adapter.load();
    slow.adapter.appendEvent({
      ...slow.event("next"),
      sequence: current.events.length + 1,
    });
    const slowGenesis = opened.mock.calls.filter(
      ([target]) => target === slow.genesisPath,
    ).length;
    const slowIndex = opened.mock.calls.filter(
      ([target]) => target === slow.indexPath,
    ).length;
    opened.mockClear();
    expect(appendNext(fast)).toMatchObject({
      committed: true,
      recovered: false,
      eventId: "next",
    });
    const fastGenesis = opened.mock.calls.filter(
      ([target]) => target === fast.genesisPath,
    ).length;
    const fastIndex = opened.mock.calls.filter(
      ([target]) => target === fast.indexPath,
    ).length;
    expect(slowGenesis - fastGenesis).toBe(3);
    expect(slowIndex - fastIndex).toBe(2);
    expect(fast.adapter.load()).toEqual(slow.adapter.load());
  });

  it("preserves explicit-sequence public replay and rejects append-next duplicate IDs", () => {
    const f = fixture();
    const value = f.event("next");
    appendNext(f, value);
    expect(f.adapter.appendEvent({ ...value, sequence: 2 })).toMatchObject({
      recovered: true,
    });
    for (const input of [value, { ...value, data: { marker: "changed" } }])
      expect(() => appendNext(f, input)).toThrowError(
        expect.objectContaining({ code: "CC_EVOLUTION_RUN_LEDGER_CONFLICT" }),
      );
    expect(f.adapter.load().events).toHaveLength(2);
  });

  it("rejects completed runs before publishing another artifact", () => {
    const f = fixture();
    f.adapter.appendEvent({
      ...f.event("done", EVENT_TYPES.RUN_COMPLETED),
      sequence: 2,
    });
    const before = fs.readFileSync(f.indexPath);
    expect(() => appendNext(f)).toThrowError(
      expect.objectContaining({ code: "CC_EVOLUTION_RUN_LEDGER_CONFLICT" }),
    );
    expect(fs.readFileSync(f.indexPath)).toEqual(before);
  });

  it("captures all input data before current-authority callbacks", () => {
    const f = fixture(),
      value = f.event("next");
    f.hooks.onAuthority = () => {
      value.data.marker = "changed after capture";
    };
    appendNext(f, value);
    expect(f.adapter.load().events.at(-1).data.marker).toBe("next");
  });

  it("rejects caller sequences, accessors and proxies without invoking them", () => {
    const f = fixture(),
      touched = vi.fn();
    const getter = f.event("next");
    Object.defineProperty(getter.data, "marker", {
      enumerable: true,
      get: touched,
    });
    const before = fs.readFileSync(f.indexPath);
    for (const input of [
      { ...f.event("next"), sequence: 2 },
      getter,
      new Proxy(f.event("next"), { get: touched }),
    ])
      expect(() => appendNext(f, input)).toThrow(TypeError);
    expect(touched).not.toHaveBeenCalled();
    expect(fs.readFileSync(f.indexPath)).toEqual(before);
    expect(captureEvolutionRunAppendNext({ ...f.adapter })).toBeNull();
    expect(captureEvolutionRunAppendNext(new Proxy(f.adapter, {}))).toBeNull();
  });

  it("rejects changed earlier artifact bytes during post-publication authentication", () => {
    const f = fixture();
    let newDigest = null;
    f.hooks.onAuthority = (request) => {
      if (request.action === "publish") newDigest = request.digest;
      if (request.action === "resolve" && request.digest === newDigest) {
        f.hooks.onAuthority = null;
        fs.chmodSync(f.firstPayload, 0o600);
        fs.appendFileSync(f.firstPayload, "tampered");
      }
    };
    expect(() => appendNext(f)).toThrowError(
      expect.objectContaining({
        code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      }),
    );
    expect(f.backend.ledger.read()).toHaveLength(1);
  });

  it("rejects a same-Run writer that commits during publication", () => {
    const f = fixture();
    let newDigest = null;
    f.hooks.onAuthority = (request) => {
      if (request.action === "publish") newDigest = request.digest;
      if (request.action === "resolve" && request.digest === newDigest) {
        f.hooks.onAuthority = null;
        f.makeAdapter().appendEvent({ ...f.event("winner"), sequence: 2 });
      }
    };
    expect(() => appendNext(f, f.event("loser"))).toThrowError(
      expect.objectContaining({ code: "CC_EVOLUTION_RUN_LEDGER_CONFLICT" }),
    );
    expect(f.adapter.load().events.map((value) => value.eventId)).toEqual([
      "started",
      "winner",
    ]);
  });

  it("uses fresh full-ledger authority when another Run commits before the post-put proof", () => {
    const f = fixture();
    let newDigest = null;
    f.hooks.onAuthority = (request) => {
      if (request.action === "publish") newDigest = request.digest;
      if (request.action === "resolve" && request.digest === newDigest) {
        f.hooks.onAuthority = null;
        const other = f.makeAdapter({
          descriptor: { ...f.descriptor, runId: "other-run" },
        });
        other.appendEvent({
          ...f.event("other-start", EVENT_TYPES.RUN_STARTED, "other-run"),
          sequence: 1,
        });
      }
    };
    expect(appendNext(f)).toMatchObject({ committed: true });
    expect(f.backend.ledger.verify().sequence).toBe(3);
    expect(f.adapter.load().events.map((value) => value.eventId)).toEqual([
      "started",
      "next",
    ]);
  });

  it("still loses CAS when a writer commits after the private head proof", () => {
    const f = fixture();
    f.hooks.onTimestamp = () => {
      f.hooks.onTimestamp = null;
      f.makeAdapter().appendEvent({ ...f.event("winner"), sequence: 2 });
    };
    expect(() => appendNext(f, f.event("loser"))).toThrowError(
      expect.objectContaining({ code: "CC_EVOLUTION_LEDGER_HEAD_CONFLICT" }),
    );
    expect(f.adapter.load().events.map((value) => value.eventId)).toEqual([
      "started",
      "winner",
    ]);
  });

  it("recovers an actual journal commit whose acknowledgment is lost", () => {
    const f = fixture();
    f.hooks.onSign = (request) => {
      if (request.purpose === "receipt") {
        f.hooks.onSign = null;
        throw new Error("lost acknowledgment after durable witness and HEAD");
      }
    };
    expect(appendNext(f)).toMatchObject({
      committed: true,
      recovered: true,
      eventId: "next",
    });
    expect(f.adapter.load().events).toHaveLength(2);
  });

  it.each(["load", "appendEvent", "_entries", "_domainEvents"])(
    "retains legacy phases for a captured capability after %s is overridden",
    (method) => {
      const f = fixture(),
        append = captureEvolutionRunAppendNext(f.adapter);
      const observed = vi.spyOn(EvolutionRunLedgerAdapter.prototype, method);
      expect(captureEvolutionRunAppendNext(f.adapter)).toBeNull();
      expect(append(f.event("next"))).toMatchObject({ committed: true });
      expect(observed).toHaveBeenCalled();
      expect(f.adapter.load().events).toHaveLength(2);
    },
  );

  it("keeps subclass, wrapper-ledger and substituted publication ports on the legacy path", () => {
    const f = fixture();
    class CustomRun extends EvolutionRunLedgerAdapter {}
    const options = {
      descriptor: f.descriptor,
      artifactPorts: f.ports,
      ledger: f.backend.ledger,
      ledgerArtifactResolver: f.resolver,
      now: f.config.clock,
    };
    expect(captureEvolutionRunAppendNext(new CustomRun(options))).toBeNull();
    expect(
      captureEvolutionRunAppendNext(
        f.makeAdapter({
          ledger: {
            read: (...args) => f.backend.ledger.read(...args),
            verify: (...args) => f.backend.ledger.verify(...args),
            appendDomainEvent: (...args) =>
              f.backend.ledger.appendDomainEvent(...args),
          },
        }),
      ),
    ).toBeNull();
    expect(
      captureEvolutionRunAppendNext(
        f.makeAdapter({
          artifactPorts: {
            putCanonical: (...args) => f.ports.putCanonical(...args),
          },
        }),
      ),
    ).toBeNull();
  });

  it.each(["filesystem", "lock", "crash"])(
    "retains every legacy ledger phase with a custom %s port",
    (customPort) => {
      const opened = vi.spyOn(fs, "openSync"),
        f = fixture({ customPort });
      expect(hasEvolutionLedgerDefaultAppendPorts(f.backend.ledger)).toBe(
        false,
      );
      expect(captureEvolutionRunAppendNext(f.adapter)).toBeNull();
      opened.mockClear();
      const calls = f.hooks.customCalls;
      const current = f.adapter.load();
      f.adapter.appendEvent({
        ...f.event("next"),
        sequence: current.events.length + 1,
      });
      expect(
        opened.mock.calls.filter(([target]) => target === f.genesisPath),
      ).toHaveLength(11);
      expect(f.hooks.customCalls).toBeGreaterThan(calls);
    },
  );

  it.each(["publish", "index-lock"])(
    "keeps real ingress publication wrappers on the legacy path (%s)",
    async (customPort) => {
      const opened = vi.spyOn(fs, "openSync"),
        f = fixture({ customPort });
      expect(hasEvolutionLedgerDefaultAppendPorts(f.backend.ledger)).toBe(true);
      expect(hasEvolutionLedgerDefaultPublication(f.resolver)).toBe(false);
      expect(captureEvolutionLedgerWholeHistoryReader(f.resolver)).toBeTypeOf(
        "function",
      );
      expect(captureEvolutionRunAppendNext(f.adapter)).toBeNull();
      const ingress = ingressFor(f),
        calls = f.hooks.customCalls;
      opened.mockClear();
      await ingress.ingestUserPrompt("hello");
      expect(
        opened.mock.calls.filter(([target]) => target === f.genesisPath),
      ).toHaveLength(13);
      expect(f.hooks.customCalls).toBeGreaterThan(calls);
    },
  );

  it("uses append-next in real ingress while retaining its initial Run authentication", async () => {
    const opened = vi.spyOn(fs, "openSync"),
      f = fixture();
    const ingress = ingressFor(f);
    opened.mockClear();
    await ingress.ingestUserPrompt("hello");
    const genesisReads = opened.mock.calls.filter(
      ([target]) => target === f.genesisPath,
    ).length;
    expect(genesisReads).toBe(10);
    expect(f.adapter.load().events.at(-1)).toMatchObject({
      sequence: 2,
      data: { evidenceKind: "user-prompt" },
    });
  });
});
