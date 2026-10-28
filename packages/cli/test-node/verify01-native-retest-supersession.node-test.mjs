import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyNativeRetestSupersession } from "../scripts/verify01-native-retest-supersession.mjs";
import {
  NATIVE_EVIDENCE_ROOT,
  NATIVE_RETEST_CHAIN,
  loadVerifiedNativeAcceptedSamples,
  readNativeRetestChain,
} from "../scripts/verify01-native-retest-plan.mjs";
import { verifyNativeRetestRound } from "../scripts/verify01-native-retest-round.mjs";

const hash = (raw) =>
  `sha256:${createHash("sha256").update(raw).digest("hex")}`;
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const readRepository = (name) => fs.readFileSync(path.join(repository, name));
const oldPlanPath = `${NATIVE_EVIDENCE_ROOT}/next-package-128-review-20261028-plan.json`;

test("archived partial round inherits only its two verified deliveries and stays incomplete", () => {
  const original = readRepository(oldPlanPath);
  const chain = readNativeRetestChain();
  const throughOldRound =
    chain.findIndex((entry) => entry.planPath === oldPlanPath) + 1;
  assert.ok(throughOldRound > 0);
  const result = loadVerifiedNativeAcceptedSamples({
    priorRounds: chain.slice(0, throughOldRound),
  });
  assert.equal(result.acceptedIds.size, 34);
  for (const id of ["verify-06", "first-run-linux-cli"])
    assert.ok(result.acceptedIds.has(id));
  for (const id of ["verify-11", "verify-30", "verify-09"])
    assert.ok(!result.acceptedIds.has(id));
  assert.equal(result.latest.status, "IN_PROGRESS");
  assert.equal(
    verifyNativeRetestRound({ planFile: oldPlanPath }).status,
    "IN_PROGRESS",
  );
  assert.throws(() =>
    verifyNativeRetestRound({ planFile: oldPlanPath, requireComplete: true }),
  );
  assert.deepEqual(readRepository(oldPlanPath), original);
});

test("supersession still verifies acceptance flags and archived bytes through the original strict validator", () => {
  const chain = readNativeRetestChain();
  const reference = chain.find((entry) => entry.planPath === oldPlanPath);
  assert.ok(reference?.supersessionPath);
  const ledger = JSON.parse(readRepository(reference.ledgerPath));
  const changed = structuredClone(ledger);
  changed.samples.find(
    (entry) => entry.sampleId === "verify-09",
  ).candidateAcceptancePassed = true;
  const bytes = Buffer.from(JSON.stringify(changed));
  const editedChain = chain.map((entry) =>
    entry === reference ? { ...entry, ledgerDigest: hash(bytes) } : entry,
  );
  assert.throws(() =>
    loadVerifiedNativeAcceptedSamples({
      readRepository: (name) => {
        if (name === NATIVE_RETEST_CHAIN)
          return Buffer.from(JSON.stringify(editedChain));
        if (name === reference.ledgerPath) return bytes;
        return readRepository(name);
      },
    }),
  );
  const archivePath = `${NATIVE_EVIDENCE_ROOT}/${ledger.runs[0].remoteState.path}`;
  for (const missing of [true, false]) {
    assert.throws(() =>
      loadVerifiedNativeAcceptedSamples({
        readRepository: (name) => {
          if (name === archivePath) {
            if (missing)
              throw Object.assign(new Error("missing archived evidence"), {
                code: "ENOENT",
              });
            return Buffer.from("corrupt archived evidence");
          }
          return readRepository(name);
        },
      }),
    );
  }
});

function fixture() {
  const prefix = `${NATIVE_EVIDENCE_ROOT}/next-package-supersession-test`;
  const source = "1".repeat(40);
  const reference = {
    planPath: `${prefix}-plan.json`,
    planDigest: `sha256:${"a".repeat(64)}`,
    ledgerPath: `${prefix}.json`,
    ledgerDigest: `sha256:${"b".repeat(64)}`,
    supersessionPath: `${prefix}-supersession.json`,
    supersessionDigest: "",
  };
  const context = { planDigest: reference.planDigest };
  const ledger = {
    status: "IN_PROGRESS",
    partialDispatch: true,
    versions: { cli: "0.166.128", vscode: "0.37.166", jetbrains: "0.4.183" },
    runs: [{ runId: "123", sourceCommit: source, status: "COMPLETED" }],
    samples: [
      { sampleId: "verify-04", status: "ATTEMPT_FAILED" },
      { sampleId: "verify-11", status: "PENDING_DISPATCH" },
    ],
  };
  const manifest = {
    versions: { cli: "0.166.129", vscode: "0.37.167", jetbrains: "0.4.184" },
    origin: {
      cli: {
        integrity: "sha512-example",
        tarball:
          "https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.166.129.tgz",
      },
      vscode: { download: "https://open-vsx.org/example.vsix" },
      jetbrains: { updateId: 1205524, file: "32208/1205524/plugin.zip" },
    },
  };
  const successor = { bytes: Buffer.from(JSON.stringify(manifest)) };
  successor.packageSetDigest = hash(successor.bytes);
  const memory = new Map();
  const save = (name, url, value) => {
    const raw = Buffer.from(JSON.stringify(value));
    const path = `${prefix}/supersession/${name}.json`;
    memory.set(path, raw);
    return {
      path,
      bytes: raw.length,
      digest: hash(raw),
      url,
      observedAt: "2026-10-29T01:00:00Z",
    };
  };
  const run = {
    id: 123,
    head_sha: source,
    event: "workflow_dispatch",
    path: ".github/workflows/verify01-native-task-campaign.yml",
    run_attempt: 1,
    status: "completed",
    updated_at: "2026-10-28T01:00:00Z",
  };
  const inventory = {
    sourceCommit: source,
    ...save(
      "runs",
      `https://api.github.com/repos/chainlesschain/chainlesschain/actions/workflows/verify01-native-task-campaign.yml/runs?head_sha=${source}&per_page=100`,
      { total_count: 1, workflow_runs: [run] },
    ),
  };
  const closure = {
    schema: "chainlesschain.native-retest-supersession/v1",
    reason: "PUBLIC_PACKAGE_SET_SUPERSEDED",
    billingReconciled: false,
    liabilitiesPreserved: true,
    ...Object.fromEntries(
      ["planPath", "planDigest", "ledgerPath", "ledgerDigest"].map((key) => [
        key,
        reference[key],
      ]),
    ),
    nextPackageSetPath:
      "docs/research/cli/verify01-package-sets/successor.json",
    nextPackageSetDigest: successor.packageSetDigest,
    unrequestedSampleIds: ["verify-11"],
    localDispatchState: [
      { sampleId: "verify-11", intent: false, request: false, resolved: false },
    ],
    closedAt: "2026-10-29T01:01:00Z",
    runInventories: [inventory],
    publicReadbacks: {
      cli: save("npm", "https://registry.npmjs.org/chainlesschain/latest", {
        version: manifest.versions.cli,
        dist: manifest.origin.cli,
      }),
      vscode: save(
        "open-vsx",
        "https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest",
        {
          version: manifest.versions.vscode,
          files: { download: manifest.origin.vscode.download },
        },
      ),
      jetbrains: save(
        "jetbrains",
        "https://plugins.jetbrains.com/api/plugins/32208/updates?size=100",
        [
          {
            id: 1205524,
            version: manifest.versions.jetbrains,
            file: manifest.origin.jetbrains.file,
            approve: true,
            listed: true,
            hidden: false,
          },
        ],
      ),
    },
  };
  const refresh = () => {
    const raw = Buffer.from(JSON.stringify(closure));
    reference.supersessionDigest = hash(raw);
    memory.set(reference.supersessionPath, raw);
  };
  const changeEvidence = (entry, change) => {
    const value = JSON.parse(memory.get(entry.path));
    change(value);
    const raw = Buffer.from(JSON.stringify(value));
    memory.set(entry.path, raw);
    entry.bytes = raw.length;
    entry.digest = hash(raw);
    refresh();
  };
  refresh();
  return {
    reference,
    context,
    ledger,
    closure,
    successor,
    memory,
    refresh,
    changeEvidence,
    verify: () =>
      verifyNativeRetestSupersession({
        reference,
        context,
        ledger,
        successor,
        read: (name) => memory.get(name),
      }),
  };
}

test("obsolete partial-round disposition preserves failures, missing work and financial uncertainty", () => {
  const item = fixture();
  const original = JSON.stringify(item.ledger);
  assert.equal(item.verify().reason, "PUBLIC_PACKAGE_SET_SUPERSEDED");
  assert.equal(JSON.stringify(item.ledger), original);
  assert.equal(item.ledger.status, "IN_PROGRESS");
  assert.equal(item.ledger.samples[1].status, "PENDING_DISPATCH");
  assert.deepEqual(
    readNativeRetestChain(() => Buffer.from(JSON.stringify([item.reference]))),
    [item.reference],
  );
});

for (const [name, mutate] of [
  [
    "live remote work",
    (i) =>
      i.changeEvidence(i.closure.runInventories[0], (v) => {
        v.workflow_runs[0].status = "in_progress";
      }),
  ],
  [
    "unreconciled rerun",
    (i) =>
      i.changeEvidence(i.closure.runInventories[0], (v) => {
        v.workflow_runs[0].run_attempt = 2;
      }),
  ],
  [
    "truncated inventory",
    (i) =>
      i.changeEvidence(i.closure.runInventories[0], (v) => {
        v.total_count = 2;
      }),
  ],
  [
    "uncollected remote run",
    (i) =>
      i.changeEvidence(i.closure.runInventories[0], (v) => {
        v.workflow_runs.push({ ...v.workflow_runs[0], id: 124 });
        v.total_count = 2;
      }),
  ],
  [
    "missing source inventory",
    (i) => {
      i.closure.runInventories = [];
      i.refresh();
    },
  ],
  [
    "unknown local request",
    (i) => {
      i.closure.localDispatchState[0].request = true;
      i.refresh();
    },
  ],
  [
    "omitted pending sample",
    (i) => {
      i.closure.unrequestedSampleIds = [];
      i.refresh();
    },
  ],
  [
    "uncollected acceptance",
    (i) => {
      i.ledger.runs[0].status = "IN_PROGRESS";
    },
  ],
  [
    "claimed completion",
    (i) => {
      i.ledger.status = "COMPLETED";
    },
  ],
  [
    "reset financial liability",
    (i) => {
      i.closure.liabilitiesPreserved = false;
      i.refresh();
    },
  ],
  [
    "fabricated billing reconciliation",
    (i) => {
      i.closure.billingReconciled = true;
      i.refresh();
    },
  ],
  [
    "unpublished successor",
    (i) =>
      i.changeEvidence(i.closure.publicReadbacks.cli, (v) => {
        v.version = "0.166.128";
      }),
  ],
  [
    "unapproved JetBrains release",
    (i) =>
      i.changeEvidence(i.closure.publicReadbacks.jetbrains, (v) => {
        v[0].approve = false;
      }),
  ],
  [
    "changed release archive",
    (i) =>
      i.changeEvidence(i.closure.publicReadbacks.vscode, (v) => {
        v.files.download = "https://example.com/other.vsix";
      }),
  ],
  [
    "changed receipt bytes",
    (i) => {
      i.memory.set(i.closure.publicReadbacks.cli.path, Buffer.from("{}"));
    },
  ],
  [
    "path traversal",
    (i) => {
      i.closure.publicReadbacks.cli.path = "../npm.json";
      i.refresh();
    },
  ],
  [
    "post-closure observation",
    (i) => {
      i.closure.publicReadbacks.cli.observedAt = "2026-11-01T00:00:00Z";
      i.refresh();
    },
  ],
])
  test(`supersession rejects ${name}`, () => {
    const item = fixture();
    mutate(item);
    assert.throws(item.verify);
  });

test("chain disposition requires both exact path and digest", () => {
  for (const mutate of [
    (r) => {
      delete r.supersessionDigest;
    },
    (r) => {
      r.supersessionPath = "../arbitrary.json";
    },
    (r) => {
      r.supersessionDigest = "unverified";
    },
  ]) {
    const item = fixture();
    mutate(item.reference);
    assert.throws(() =>
      readNativeRetestChain(() =>
        Buffer.from(JSON.stringify([item.reference])),
      ),
    );
  }
});
