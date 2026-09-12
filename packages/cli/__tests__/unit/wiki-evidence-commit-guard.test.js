import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createJourneyFixture,
  digest,
  NOW,
} from "../helpers/evolution-wiki-journey-fixture.js";
import {
  digestWikiState,
  WIKI_REVISION_SCHEMA,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  WIKI_LEDGER_CONFLICT_CODE,
  WIKI_LEDGER_EVENT_TYPE,
} from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import {
  createWikiEvidenceCommitGuard,
  WIKI_EVIDENCE_COMMIT_DENIED_CODE,
  WIKI_EVIDENCE_COMMIT_LEASE_SCHEMA,
  WIKI_EVIDENCE_COMMIT_RELEASE_FAILED_CODE,
  WIKI_EVIDENCE_COMMIT_REQUEST_SCHEMA,
} from "../../src/lib/evolution/wiki-evidence-commit-guard.js";

const roots = [];
afterAll(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function snapshotFiles(root) {
  const files = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else
        files[path.relative(root, target)] = fs.readFileSync(target, "base64");
    }
  };
  visit(root);
  return files;
}

function revisionInput(fixture, envelope, rulesDigest = digest("lease-rules")) {
  const current = fixture.wikiAdapter.loadWiki();
  const state = structuredClone(current.state);
  const evidence = { ...envelope };
  delete evidence.envelopeDigest;
  state.evidence[envelope.ref] = evidence;
  state.revision += 1;
  const payload = {
    schema: WIKI_REVISION_SCHEMA,
    tenantId: fixture.tenantId,
    evolutionRunId: fixture.runId,
    revision: state.revision,
    priorStateDigest: current.stateDigest,
    rulesDigest,
    maintainerModel: "deterministic-lease-boundary-test",
    effectiveAt: NOW,
    evidenceRefs: [envelope.ref],
    operationDigest: digestWikiState([]),
    maintenanceRequestId: null,
    maintenanceRequestDigest: null,
  };
  state.revisionId = `wiki:${digestWikiState(payload).slice(7)}`;
  return {
    expectedStateDigest: current.stateDigest,
    revision: {
      ...payload,
      revisionId: state.revisionId,
      stateDigest: digestWikiState(state),
      state,
    },
  };
}

async function createCase() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-commit-lease-"),
  );
  roots.push(root);
  const fixture = createJourneyFixture(root);
  const item = await fixture.project({
    summary: "focused-checks",
    result: "passed",
  });
  fixture.reference(item.result);
  fixture.complete();
  const envelope = await fixture.resolver.resolveEvidence(
    item.result.evidenceId,
  );
  expect(envelope.trustedProjection).toBe(true);
  return {
    fixture,
    envelope,
    input: revisionInput(fixture, envelope),
  };
}

// This is the test-owned synchronous authority seam, not a substitute Wiki
// adapter or durable receipt. All source projection and Wiki writes are real.
function leaseFor(request, overrides = {}) {
  return Object.freeze({
    schema: WIKI_EVIDENCE_COMMIT_LEASE_SCHEMA,
    tenantId: request.tenantId,
    runId: request.runId,
    requestDigest: request.requestDigest,
    evidenceBindingDigest: request.evidenceBindingDigest,
    leaseId: `lease:${crypto.randomUUID()}`,
    assertCurrent() {
      return true;
    },
    release() {},
    ...overrides,
  });
}

function guardFor(fixture, commitCoordinator) {
  return createWikiEvidenceCommitGuard({
    wikiAdapter: fixture.wikiAdapter,
    commitCoordinator,
    principalEnvelope: fixture.authorities.principalEnvelope,
    clock: fixture.authorities.now,
  });
}

function expectDenied(action, code = WIKI_EVIDENCE_COMMIT_DENIED_CODE) {
  let failure;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code });
  return failure;
}

function wikiEvents(fixture) {
  return fixture.backend.ledger
    .read({ limit: 1000 })
    .filter((event) => event.type === WIKI_LEDGER_EVENT_TYPE);
}

describe("Wiki evidence commit lease rejection boundaries", () => {
  let fixture;
  let input;
  let baseline;

  beforeAll(async () => {
    ({ fixture, input } = await createCase());
    baseline = snapshotFiles(fixture.root);
  });

  afterEach(() => {
    // Every rejected authority shape must leave both artifacts and the actual
    // authenticated ledger byte-for-byte unchanged, not merely return an error.
    expect(snapshotFiles(fixture.root)).toEqual(baseline);
    expect(wikiEvents(fixture)).toHaveLength(0);
  });

  it("rejects an async acquire function without calling it", () => {
    let calls = 0;
    expectDenied(() =>
      guardFor(fixture, {
        async acquireCurrentEvidence(request) {
          calls += 1;
          return leaseFor(request);
        },
      }).commitRevision(input),
    );
    expect(calls).toBe(0);
  });

  it("rejects a Proxy coordinator without evaluating its traps", () => {
    let reads = 0;
    const coordinator = new Proxy(
      { acquireCurrentEvidence: leaseFor },
      {
        get() {
          reads += 1;
          throw new Error("coordinator Proxy evaluated");
        },
      },
    );
    expectDenied(() => guardFor(fixture, coordinator).commitRevision(input));
    expect(reads).toBe(0);
  });

  it("rejects a Proxy acquire function without invoking it", () => {
    let calls = 0;
    const acquireCurrentEvidence = new Proxy(leaseFor, {
      apply() {
        calls += 1;
        throw new Error("acquire Proxy evaluated");
      },
    });
    expectDenied(() =>
      guardFor(fixture, { acquireCurrentEvidence }).commitRevision(input),
    );
    expect(calls).toBe(0);
  });

  it("rejects an accessor acquire without evaluating the getter", () => {
    let reads = 0;
    const coordinator = Object.defineProperty({}, "acquireCurrentEvidence", {
      get() {
        reads += 1;
        return leaseFor;
      },
    });
    expectDenied(() => guardFor(fixture, coordinator).commitRevision(input));
    expect(reads).toBe(0);
  });

  it("rejects an ordinary acquire returning a Promise", () => {
    let calls = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          calls += 1;
          return Promise.resolve(leaseFor(request));
        },
      }).commitRevision(input),
    );
    expect(calls).toBe(1);
  });

  it("rejects a thenable lease without reading or invoking then", () => {
    let reads = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          return Object.freeze(
            Object.defineProperty({ ...leaseFor(request) }, "then", {
              get() {
                reads += 1;
                throw new Error("thenable getter evaluated");
              },
            }),
          );
        },
      }).commitRevision(input),
    );
    expect(reads).toBe(0);
  });

  it("rejects a Proxy lease without evaluating its traps", () => {
    let reads = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          return new Proxy(leaseFor(request), {
            get() {
              reads += 1;
              throw new Error("lease Proxy evaluated");
            },
          });
        },
      }).commitRevision(input),
    );
    expect(reads).toBe(0);
  });

  it("rejects a mutable lease before asserting it", () => {
    let assertions = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          return {
            ...leaseFor(request),
            assertCurrent() {
              assertions += 1;
              return true;
            },
          };
        },
      }).commitRevision(input),
    );
    expect(assertions).toBe(0);
  });

  it.each([
    ["schema", "other-lease-schema"],
    ["tenantId", "other-tenant"],
    ["runId", "other-run"],
    ["requestDigest", digest("unbound-revision")],
    ["evidenceBindingDigest", digest("unbound-evidence")],
  ])("rejects a lease with a substituted %s", (field, value) => {
    let assertions = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          return leaseFor(request, {
            [field]: value,
            assertCurrent() {
              assertions += 1;
              return true;
            },
          });
        },
      }).commitRevision(input),
    );
    expect(assertions).toBe(0);
  });

  it("rejects a lease that omits the revision-bound request digest", () => {
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          const lease = { ...leaseFor(request) };
          delete lease.requestDigest;
          return Object.freeze(lease);
        },
      }).commitRevision(input),
    );
  });

  it.each([
    ["false", () => false],
    ["undefined", () => undefined],
    ["a Promise", () => Promise.resolve(true)],
    [
      "an exception",
      () => {
        throw new Error("evidence was revoked");
      },
    ],
  ])(
    "rejects assertCurrent returning %s and releases the lease",
    (_label, assertCurrent) => {
      let releases = 0;
      expectDenied(() =>
        guardFor(fixture, {
          acquireCurrentEvidence(request) {
            return leaseFor(request, {
              assertCurrent,
              release() {
                releases += 1;
              },
            });
          },
        }).commitRevision(input),
      );
      expect(releases).toBe(1);
    },
  );

  it("rejects an async assertion without executing its body", () => {
    let calls = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          return leaseFor(request, {
            async assertCurrent() {
              calls += 1;
              return true;
            },
          });
        },
      }).commitRevision(input),
    );
    expect(calls).toBe(0);
  });

  it("rejects a Proxy assertion without executing its trap", () => {
    let calls = 0;
    expectDenied(() =>
      guardFor(fixture, {
        acquireCurrentEvidence(request) {
          return leaseFor(request, {
            assertCurrent: new Proxy(() => true, {
              apply() {
                calls += 1;
                return true;
              },
            }),
          });
        },
      }).commitRevision(input),
    );
    expect(calls).toBe(0);
  });
});

it("gives the authority only frozen bindings and commits once inside the synchronous lease", async () => {
  const { fixture, input } = await createCase();
  const order = [];
  let received;
  let argumentCount;
  let issued;
  let calls = 0;
  const guard = guardFor(fixture, {
    acquireCurrentEvidence(...args) {
      calls += 1;
      argumentCount = args.length;
      [received] = args;
      order.push("acquire");
      // No commit/publish callback or adapter is handed to the authority.
      expect(wikiEvents(fixture)).toHaveLength(0);
      issued = leaseFor(received, {
        assertCurrent() {
          order.push("assert");
          expect(wikiEvents(fixture)).toHaveLength(0);
          queueMicrotask(() => order.push("microtask"));
          return true;
        },
        release() {
          order.push("release");
          expect(wikiEvents(fixture)).toHaveLength(1);
          expect(fixture.wikiAdapter.loadWiki().stateDigest).toBe(
            input.revision.stateDigest,
          );
        },
      });
      return issued;
    },
  });
  expect(Object.isFrozen(guard)).toBe(true);
  const receipt = guard.commitRevision(input);
  expect(receipt).not.toBeInstanceOf(Promise);
  expect(receipt).toMatchObject({
    committed: true,
    recovered: false,
    revisionId: input.revision.revisionId,
    stateDigest: input.revision.stateDigest,
  });
  expect(argumentCount).toBe(1);
  expect(calls).toBe(1);
  expect(Object.keys(received).sort()).toEqual(
    [
      "schema",
      "tenantId",
      "runId",
      "principalEnvelope",
      "expectedStateDigest",
      "revisionId",
      "stateDigest",
      "evidenceRefs",
      "evidenceBindings",
      "evidenceBindingDigest",
      "requestNonce",
      "requestedAt",
      "requestDigest",
    ].sort(),
  );
  expect(received).toMatchObject({
    schema: WIKI_EVIDENCE_COMMIT_REQUEST_SCHEMA,
    tenantId: fixture.tenantId,
    runId: fixture.runId,
    principalEnvelope: fixture.authorities.principalEnvelope,
    expectedStateDigest: input.expectedStateDigest,
    revisionId: input.revision.revisionId,
    stateDigest: input.revision.stateDigest,
    evidenceRefs: input.revision.evidenceRefs,
    requestedAt: NOW,
  });
  expect(received.evidenceBindings).toHaveLength(1);
  expect(received.evidenceBindings).toEqual(
    Object.values(input.revision.state.evidence),
  );
  expect(received.evidenceBindingDigest).toBe(
    digestWikiState({
      domain: "chainlesschain.wiki-evidence-bindings/v1",
      tenantId: fixture.tenantId,
      runId: fixture.runId,
      evidenceBindings: received.evidenceBindings,
    }),
  );
  const { requestDigest, ...requestCore } = received;
  expect(requestDigest).toBe(digestWikiState(requestCore));
  const assertDataOnly = (value) => {
    expect(typeof value).not.toBe("function");
    if (value && typeof value === "object") {
      expect(Object.isFrozen(value)).toBe(true);
      for (const item of Object.values(value)) assertDataOnly(item);
    }
  };
  assertDataOnly(received);
  expect(order).toEqual(["acquire", "assert", "release"]);
  await Promise.resolve();
  expect(order).toEqual(["acquire", "assert", "release", "microtask"]);

  const afterCommit = snapshotFiles(fixture.root);
  const replay = guardFor(fixture, { acquireCurrentEvidence: () => issued });
  expectDenied(() => replay.commitRevision(input));
  expect(snapshotFiles(fixture.root)).toEqual(afterCommit);
  expect(wikiEvents(fixture)).toHaveLength(1);
  expect(order).toEqual(["acquire", "assert", "release", "microtask"]);
});

it("releases in finally when the real Wiki compare-and-swap rejects a stale revision", async () => {
  const { fixture, input, envelope } = await createCase();
  const stale = revisionInput(fixture, envelope, digest("different-rules"));
  fixture.wikiAdapter.commitRevision(input);
  const baseline = snapshotFiles(fixture.root);
  let assertions = 0;
  let releases = 0;
  const guard = guardFor(fixture, {
    acquireCurrentEvidence(request) {
      return leaseFor(request, {
        assertCurrent() {
          assertions += 1;
          return true;
        },
        release() {
          releases += 1;
        },
      });
    },
  });
  expectDenied(() => guard.commitRevision(stale), WIKI_LEDGER_CONFLICT_CODE);
  expect(assertions).toBe(1);
  expect(releases).toBe(1);
  expect(snapshotFiles(fixture.root)).toEqual(baseline);
  expect(wikiEvents(fixture)).toHaveLength(1);
});

it.each([
  [
    "throws",
    () => {
      throw new Error("release unavailable");
    },
  ],
  ["returns a Promise", () => Promise.resolve()],
])(
  "reports committed state when release %s after the real write",
  async (_label, release) => {
    const { fixture, input } = await createCase();
    let releases = 0;
    const guard = guardFor(fixture, {
      acquireCurrentEvidence(request) {
        return leaseFor(request, {
          release() {
            releases += 1;
            return release();
          },
        });
      },
    });
    const failure = expectDenied(
      () => guard.commitRevision(input),
      WIKI_EVIDENCE_COMMIT_RELEASE_FAILED_CODE,
    );
    expect(failure.committed).toBe(true);
    expect(releases).toBe(1);
    expect(wikiEvents(fixture)).toHaveLength(1);
    expect(fixture.wikiAdapter.loadWiki().stateDigest).toBe(
      input.revision.stateDigest,
    );
  },
);
