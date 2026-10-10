import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  PRIVATE_V4_SETTINGS_ENV,
  PRIVATE_V4_SETTINGS_PROFILE,
  inspectPrivateV4FixtureSettings,
} from "../scripts/windows-node-private-v4-fixture-settings.mjs";

const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const sourceBytes = fs.readFileSync(
  new URL(
    "../scripts/windows-node-private-v4-fixture-settings.mjs",
    import.meta.url,
  ),
);
const clone = structuredClone;
const uuid = (number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const identities = [
  { dev: "42", ino: "90071992547409931234" },
  { dev: "42", ino: "90071992547409931235" },
];
function sources(base) {
  return [
    ["home", ".claude\\settings.json"],
    ["program-data", "ChainlessChain\\managed-settings.json"],
  ].map(([directory, remainingPath], index) => {
    const nearestExistingParent = path.win32.join(base, directory);
    const file = path.win32.join(nearestExistingParent, remainingPath);
    return {
      logicalPath: file,
      physicalPath: file,
      nearestExistingParent,
      remainingPath,
      parentIdentity: clone(identities[index]),
      exists: false,
      byteLength: 0,
      digest: null,
      fileIdentity: null,
      settings: null,
    };
  });
}
function fixture() {
  const root = "C:\\private-v4\\capsule";
  const sourcePath =
    "C:\\evidence\\inputs\\windows-node-private-v4-fixture-settings.mjs";
  const host = {
    status: "NOT_ADMITTED",
    fixtureSettings: true,
    creationLedger: [
      "root",
      "vitest-worker",
      "report-helper",
      "esbuild-service",
    ].map((kind, index) => ({
      kind,
      pid: 100 + index,
      registrationId: uuid(index + 1),
      parentRegistrationId: index ? uuid(1) : null,
      registered: kind !== "esbuild-service",
    })),
  };
  const report = {
    root,
    mode: "review-baseline",
    status: "NOT_ADMITTED",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    fullFrozenReviewCompleted: false,
    review: { fixtureSettings: PRIVATE_V4_SETTINGS_PROFILE },
    fixtureSettings: {
      profile: PRIVATE_V4_SETTINGS_PROFILE,
      environment: clone(PRIVATE_V4_SETTINGS_ENV),
      source: {
        path: sourcePath,
        bytes: sourceBytes.length,
        digest: hash(sourceBytes),
      },
      before: sources(path.win32.join(root, "workspace", "review-fixture")),
      after: sources(path.win32.join(root, "workspace", "review-fixture")),
    },
    receipts: host.creationLedger
      .filter((actor) => actor.kind !== "esbuild-service")
      .flatMap((actor) =>
        ["installed", "exit"].map((phase) => {
          const role = {
            root: "root",
            "vitest-worker": "worker",
            "report-helper": "report-helper",
          }[actor.kind];
          return {
            pid: actor.pid,
            role,
            phase,
            actor: {
              pid: actor.pid,
              role,
              registrationId: actor.registrationId,
              parentRegistrationId: actor.parentRegistrationId,
            },
            status: "NOT_ADMITTED",
            trusted: false,
            admissionEligible: false,
            fixtureSettings: {
              profile: PRIVATE_V4_SETTINGS_PROFILE,
              environment: clone(PRIVATE_V4_SETTINGS_ENV),
              home: PRIVATE_V4_SETTINGS_ENV.USERPROFILE,
              managedSettingsFile: PRIVATE_V4_SETTINGS_ENV.CC_MANAGED_SETTINGS,
              sources: sources("X:\\workspace\\review-fixture"),
              writeDenied: {
                path: PRIVATE_V4_SETTINGS_ENV.USERPROFILE + "\\probe",
                code: "EACCES",
              },
            },
          };
        }),
      ),
  };
  const artifacts = new Map([[sourcePath, Buffer.from(sourceBytes)]]);
  const readArtifact = (name) => {
    if (!artifacts.has(name)) throw new Error("missing artifact");
    return artifacts.get(name);
  };
  return { report, host, artifacts, readArtifact };
}
function inspect(value) {
  return inspectPrivateV4FixtureSettings(value.report, value);
}
function terminateWorker(value) {
  const worker = value.host.creationLedger[1];
  Object.assign(worker, {
    exit: 1,
    terminationRequested: true,
    terminationExitCode: 1,
    preTerminationWait: 258,
    preTerminationExit: 259,
    terminationCallSucceeded: true,
    terminationCallError: 0,
    terminationWait: 0,
    actualExit: 1,
    terminationRequesterRegistrationId: worker.parentRegistrationId,
    creationSequence: 2,
    terminationChildSequence: 2,
    callerHandleObjectCompared: true,
  });
  value.report.receipts = value.report.receipts.filter(
    (row) => row.pid !== worker.pid || row.phase !== "exit",
  );
}
test("fixed readonly profile accepts absent sources and large decimal identities", () => {
  assert.ok(Object.isFrozen(PRIVATE_V4_SETTINGS_ENV));
  assert.deepEqual(inspect(fixture()), { verified: true, errors: [] });
});
test("mutant review uses the same readonly evidence contract", () => {
  const value = fixture();
  value.report.mode = "review-mutant";
  assert.equal(inspect(value).verified, true);
});
test("environment keys allow Windows case variants without duplicates", () => {
  const value = fixture();
  for (const row of [
    value.report.fixtureSettings,
    ...value.report.receipts.map((r) => r.fixtureSettings),
  ]) {
    row.environment.PROGRAMDATA = row.environment.ProgramData;
    delete row.environment.ProgramData;
  }
  assert.equal(inspect(value).verified, true);
});
test("EPERM is a valid actual readonly denial", () => {
  const value = fixture();
  value.report.receipts.forEach((row) => {
    row.fixtureSettings.writeDenied.code = "EPERM";
  });
  assert.equal(inspect(value).verified, true);
});
test("legacy reports accept absent fixture fields and absent or false host flag", () => {
  for (const host of [{}, { fixtureSettings: false }])
    assert.deepEqual(
      inspectPrivateV4FixtureSettings({ receipts: [] }, { host }),
      { verified: true, errors: [] },
    );
});
test("fully attested host termination permits only the worker exit observation to be absent", () => {
  const value = fixture();
  terminateWorker(value);
  assert.deepEqual(inspect(value), { verified: true, errors: [] });
});

const negatives = [
  [
    "original mode",
    (v) => {
      v.report.mode = "original";
    },
  ],
  [
    "missing review mode",
    (v) => {
      delete v.report.mode;
    },
  ],
  [
    "unknown profile",
    (v) => {
      v.report.fixtureSettings.profile = "writable-v1";
    },
  ],
  [
    "missing review profile",
    (v) => {
      delete v.report.review.fixtureSettings;
    },
  ],
  [
    "missing host flag",
    (v) => {
      delete v.host.fixtureSettings;
    },
  ],
  [
    "false host flag",
    (v) => {
      v.host.fixtureSettings = false;
    },
  ],
  [
    "missing host fixture",
    (v) => {
      delete v.report.fixtureSettings;
    },
  ],
  [
    "admitted report",
    (v) => {
      v.report.status = "ADMITTED";
    },
  ],
  [
    "admitted host",
    (v) => {
      v.host.status = "ADMITTED";
    },
  ],
  ...["admissionEligible", "formalSample", "fullFrozenReviewCompleted"].map(
    (key) => [
      key,
      (v) => {
        v.report[key] = true;
      },
    ],
  ),
  [
    "nonexperimental report",
    (v) => {
      v.report.experimental = false;
    },
  ],
  [
    "missing capture",
    (v) => {
      v.artifacts.clear();
    },
  ],
  [
    "capture wrong name",
    (v) => {
      v.report.fixtureSettings.source.path = "C:\\fake.mjs";
    },
  ],
  [
    "capture wrong size",
    (v) => {
      v.report.fixtureSettings.source.bytes++;
    },
  ],
  [
    "capture wrong digest",
    (v) => {
      v.report.fixtureSettings.source.digest = "sha256:" + "0".repeat(64);
    },
  ],
  [
    "capture exceeds limit",
    (v) => {
      v.report.fixtureSettings.source.bytes = 128 * 1024 + 1;
    },
  ],
  [
    "self-consistent changed source",
    (v) => {
      const bytes = Buffer.from("// forged verifier");
      v.artifacts.set(v.report.fixtureSettings.source.path, bytes);
      v.report.fixtureSettings.source.bytes = bytes.length;
      v.report.fixtureSettings.source.digest = hash(bytes);
    },
  ],
  [
    "nonbuffer capture",
    (v) => {
      v.artifacts.set(
        v.report.fixtureSettings.source.path,
        sourceBytes.toString(),
      );
    },
  ],
  [
    "missing host environment",
    (v) => {
      delete v.report.fixtureSettings.environment;
    },
  ],
  [
    "extra environment",
    (v) => {
      v.report.fixtureSettings.environment.HOME = "C:\\Users\\outside";
    },
  ],
  [
    "duplicate environment alias",
    (v) => {
      v.report.fixtureSettings.environment.PROGRAMDATA =
        PRIVATE_V4_SETTINGS_ENV.ProgramData;
    },
  ],
  [
    "outside host home",
    (v) => {
      v.report.fixtureSettings.environment.USERPROFILE = "C:\\Users\\outside";
    },
  ],
  [
    "relative root",
    (v) => {
      v.report.root = "capsule";
    },
  ],
  [
    "noncanonical root",
    (v) => {
      v.report.root = "C:\\a\\..\\capsule";
    },
  ],
  [
    "missing root",
    (v) => {
      delete v.report.root;
    },
  ],
  [
    "missing before",
    (v) => {
      delete v.report.fixtureSettings.before;
    },
  ],
  [
    "missing after",
    (v) => {
      delete v.report.fixtureSettings.after;
    },
  ],
  [
    "extra source",
    (v) => {
      v.report.fixtureSettings.after.push(
        clone(v.report.fixtureSettings.after[0]),
      );
    },
  ],
  [
    "reordered sources",
    (v) => {
      v.report.fixtureSettings.after.reverse();
    },
  ],
  [
    "unexpected source field",
    (v) => {
      v.report.fixtureSettings.before[0].forged = true;
    },
  ],
  [
    "wrong physical path",
    (v) => {
      v.report.fixtureSettings.before[0].physicalPath =
        "C:\\Users\\outside\\.claude\\settings.json";
    },
  ],
  [
    "wrong nearest parent",
    (v) => {
      v.report.fixtureSettings.before[0].nearestExistingParent += "\\.claude";
    },
  ],
  [
    "wrong remaining path",
    (v) => {
      v.report.fixtureSettings.before[0].remainingPath = "settings.json";
    },
  ],
  [
    "source exists",
    (v) => {
      v.report.fixtureSettings.before[0].exists = true;
    },
  ],
  [
    "source byte content",
    (v) => {
      v.report.fixtureSettings.before[0].byteLength = 1;
    },
  ],
  [
    "source digest content",
    (v) => {
      v.report.fixtureSettings.before[0].digest = hash(Buffer.from("x"));
    },
  ],
  [
    "source file identity",
    (v) => {
      v.report.fixtureSettings.before[0].fileIdentity = clone(identities[0]);
    },
  ],
  [
    "source settings content",
    (v) => {
      v.report.fixtureSettings.before[0].settings = {};
    },
  ],
  [
    "changed host identity",
    (v) => {
      v.report.fixtureSettings.after[0].parentIdentity.ino = "7";
    },
  ],
  [
    "aliased fixture parent",
    (v) => {
      v.report.fixtureSettings.before[1].parentIdentity = clone(identities[0]);
    },
  ],
  ...["0", "01", "-1", "1.1", "1e9", 42, null].map((bad) => [
    `noncanonical identity ${JSON.stringify(bad)}`,
    (v) => {
      v.report.fixtureSettings.before[0].parentIdentity.ino = bad;
    },
  ]),
  [
    "missing ledger",
    (v) => {
      delete v.host.creationLedger;
    },
  ],
  [
    "null actor",
    (v) => {
      v.host.creationLedger.unshift(null);
    },
  ],
  [
    "duplicate actor",
    (v) => {
      v.host.creationLedger.push(clone(v.host.creationLedger[0]));
    },
  ],
  [
    "unregistered worker",
    (v) => {
      v.host.creationLedger[1].registered = false;
    },
  ],
  [
    "missing root actor",
    (v) => {
      v.host.creationLedger.shift();
      v.report.receipts = v.report.receipts.filter((r) => r.role !== "root");
    },
  ],
  [
    "missing receipts",
    (v) => {
      delete v.report.receipts;
    },
  ],
  [
    "missing installed receipt",
    (v) => {
      v.report.receipts.shift();
    },
  ],
  [
    "missing root exit",
    (v) => {
      v.report.receipts.splice(1, 1);
    },
  ],
  [
    "missing worker exit",
    (v) => {
      v.report.receipts.splice(3, 1);
    },
  ],
  [
    "missing helper exit",
    (v) => {
      v.report.receipts.pop();
    },
  ],
  [
    "duplicate receipt",
    (v) => {
      v.report.receipts.push(clone(v.report.receipts[0]));
    },
  ],
  [
    "duplicate receipt phase",
    (v) => {
      v.report.receipts[1].phase = "installed";
    },
  ],
  [
    "unowned receipt",
    (v) => {
      const row = clone(v.report.receipts[0]);
      row.pid = 999;
      v.report.receipts.push(row);
    },
  ],
  [
    "wrong receipt role",
    (v) => {
      v.report.receipts[0].role = "worker";
    },
  ],
  [
    "wrong receipt actor PID",
    (v) => {
      v.report.receipts[0].actor.pid++;
    },
  ],
  [
    "wrong receipt registration",
    (v) => {
      v.report.receipts[0].actor.registrationId = uuid(9);
    },
  ],
  [
    "wrong receipt parent",
    (v) => {
      v.report.receipts[2].actor.parentRegistrationId = uuid(9);
    },
  ],
  [
    "admitted receipt",
    (v) => {
      v.report.receipts[0].status = "ADMITTED";
    },
  ],
  [
    "trusted receipt",
    (v) => {
      v.report.receipts[0].trusted = true;
    },
  ],
  [
    "eligible receipt",
    (v) => {
      v.report.receipts[0].admissionEligible = true;
    },
  ],
  [
    "missing child fixture",
    (v) => {
      delete v.report.receipts[0].fixtureSettings;
    },
  ],
  [
    "wrong child profile",
    (v) => {
      v.report.receipts[0].fixtureSettings.profile = "other";
    },
  ],
  [
    "outside child home",
    (v) => {
      v.report.receipts[0].fixtureSettings.home = "C:\\Users\\outside";
    },
  ],
  [
    "outside managed settings",
    (v) => {
      v.report.receipts[0].fixtureSettings.managedSettingsFile =
        "C:\\ProgramData\\ChainlessChain\\managed-settings.json";
    },
  ],
  [
    "outside child environment",
    (v) => {
      v.report.receipts[0].fixtureSettings.environment.ProgramData =
        "C:\\ProgramData";
    },
  ],
  [
    "duplicate child environment alias",
    (v) => {
      v.report.receipts[0].fixtureSettings.environment.userprofile =
        PRIVATE_V4_SETTINGS_ENV.USERPROFILE;
    },
  ],
  [
    "child sources absent",
    (v) => {
      delete v.report.receipts[0].fixtureSettings.sources;
    },
  ],
  [
    "child physical path alias",
    (v) => {
      v.report.receipts[0].fixtureSettings.sources = clone(
        v.report.fixtureSettings.before,
      );
    },
  ],
  [
    "child parent changed",
    (v) => {
      v.report.receipts[0].fixtureSettings.sources[0].parentIdentity.ino = "7";
    },
  ],
  [
    "child source exists",
    (v) => {
      v.report.receipts[0].fixtureSettings.sources[0].exists = true;
    },
  ],
  [
    "write denial absent",
    (v) => {
      delete v.report.receipts[0].fixtureSettings.writeDenied;
    },
  ],
  [
    "wrong denial target",
    (v) => {
      v.report.receipts[0].fixtureSettings.writeDenied.path =
        "X:\\scratch\\probe";
    },
  ],
  [
    "ENOENT is not write denial",
    (v) => {
      v.report.receipts[0].fixtureSettings.writeDenied.code = "ENOENT";
    },
  ],
  [
    "fake denial extra fields",
    (v) => {
      v.report.receipts[0].fixtureSettings.writeDenied.success = true;
    },
  ],
];
for (const [name, mutate] of negatives)
  test(`rejects ${name}`, () => {
    const value = fixture();
    mutate(value);
    const result = inspect(value);
    assert.equal(result.verified, false, JSON.stringify(result));
    assert.ok(result.errors.length);
  });
for (const [field, bad] of Object.entries({
  kind: "report-helper",
  exit: 0,
  terminationRequested: false,
  terminationExitCode: 0,
  preTerminationWait: 0,
  preTerminationExit: 0,
  terminationCallSucceeded: false,
  terminationCallError: 5,
  terminationWait: 258,
  actualExit: 0,
  terminationRequesterRegistrationId: uuid(99),
  creationSequence: 0,
  terminationChildSequence: 9,
  callerHandleObjectCompared: false,
})) {
  test(`missing worker exit requires exact termination ${field}`, () => {
    const value = fixture();
    terminateWorker(value);
    value.host.creationLedger[1][field] = bad;
    assert.equal(inspect(value).verified, false);
  });
}
test("attested terminated worker still needs unchanged final host source observation", () => {
  const value = fixture();
  terminateWorker(value);
  value.report.fixtureSettings.after[1].parentIdentity.ino = "77";
  assert.equal(inspect(value).verified, false);
});
test("attested terminated worker still needs an installed receipt", () => {
  const value = fixture();
  terminateWorker(value);
  value.report.receipts.find((row) => row.role === "worker").phase = "exit";
  assert.equal(inspect(value).verified, false);
});
test("removing top-level fixture markers cannot hide child evidence", () => {
  const value = fixture();
  delete value.report.fixtureSettings;
  delete value.report.review.fixtureSettings;
  delete value.host.fixtureSettings;
  assert.equal(inspect(value).verified, false);
});
test("legacy invalid host flag fails closed", () => {
  assert.equal(
    inspectPrivateV4FixtureSettings({}, { host: { fixtureSettings: "true" } })
      .verified,
    false,
  );
});
