"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { REQUIRED_PHASES } = require("./run.cjs");

const SHA_RE = /^[a-f0-9]{40}$/u;
const REQUIRED_FILES = Object.freeze([
  "exact-commit.json",
  "host-environment.json",
  "bridge-restart.json",
  "network-fault.json",
  "candidate-digests.json",
  "redacted-diagnostics.json",
  "outcome-observations.json",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(
      argv[index]?.startsWith("--") && argv[index + 1],
      `invalid argument: ${argv[index]}`,
    );
    options[
      argv[index].slice(2).replace(/-([a-z])/gu, (_, c) => c.toUpperCase())
    ] = argv[index + 1];
  }
  return options;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function verifyCell(directory, expected) {
  assert.equal(
    fs.existsSync(path.join(directory, "failure.json")),
    false,
    `${expected.transport} contains failure evidence`,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.schema, "chainlesschain.ide-host-recovery-manifest.v1");
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    [...REQUIRED_FILES].sort(),
  );
  const documents = {};
  for (const file of REQUIRED_FILES) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(
      manifest.files[file].sha256,
      digest(bytes),
      `${expected.transport}/${file} digest drift`,
    );
    assert.equal(
      manifest.files[file].bytes,
      bytes.length,
      `${expected.transport}/${file} size drift`,
    );
    documents[file] = JSON.parse(bytes.toString("utf8"));
  }
  assert.deepEqual(documents["exact-commit.json"], {
    schema: "chainlesschain.ide-host-recovery-exact-commit.v1",
    releaseCommit: expected.releaseCommit,
    gitHead: expected.releaseCommit,
  });
  const host = documents["host-environment.json"];
  assert.equal(host.transport, expected.transport);
  assert.equal(host.platform, "linux");
  assert.equal(host.exactCommitBound, true);
  if (expected.transport === "wsl") assert.equal(host.isWsl, true);
  if (expected.transport === "devcontainer")
    assert.equal(host.isContainer, true);
  const restart = documents["bridge-restart.json"];
  assert.deepEqual(restart.phases, REQUIRED_PHASES);
  assert.equal(restart.initialGeneration, 1);
  assert.equal(restart.recoveredGeneration, 2);
  assert.equal(restart.durableSequence, 2);
  assert.deepEqual(documents["network-fault.json"], {
    schema: "chainlesschain.ide-network-fault-evidence.v1",
    injectedDisconnectCount: 1,
    reconnectCount: 1,
    staleListenerAcceptanceCount: 0,
  });
  const outcome = documents["outcome-observations.json"];
  assert.equal(outcome.success, true);
  for (const field of [
    "unauthorizedAcceptanceCount",
    "lostCheckpointCount",
    "duplicateCheckpointCount",
    "staleListenerAcceptanceCount",
    "credentialLeakCount",
    "orphanProcessCount",
  ]) {
    assert.equal(
      outcome[field],
      0,
      `${expected.transport}/${field} must be zero`,
    );
  }
  assert.deepEqual(outcome.provenance, expected.provenance);
  return {
    transport: expected.transport,
    manifestDigest: digest(
      fs.readFileSync(path.join(directory, "manifest.json")),
    ),
    outcomeDigest: digest(
      fs.readFileSync(path.join(directory, "outcome-observations.json")),
    ),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.match(options.releaseCommit || "", SHA_RE);
  const evidenceRoot = path.resolve(options.evidenceRoot || "");
  const shared = {
    repository: options.repository,
    workflowRef: options.workflowRef,
    workflowSha: options.workflowSha,
    runId: options.runId,
    runAttempt: options.runAttempt,
    eventName: options.eventName,
  };
  const cells = [
    {
      transport: "wsl",
      job: "wsl-host-recovery",
      artifactName: `ide-host-recovery-wsl-${options.runAttempt}`,
    },
    {
      transport: "devcontainer",
      job: "devcontainer-host-recovery",
      artifactName: `ide-host-recovery-devcontainer-${options.runAttempt}`,
    },
  ].map((cell) =>
    verifyCell(path.join(evidenceRoot, cell.transport), {
      transport: cell.transport,
      releaseCommit: options.releaseCommit,
      provenance: { ...shared, job: cell.job, artifactName: cell.artifactName },
    }),
  );
  const aggregate = {
    schema: "chainlesschain.ide-host-recovery-aggregate.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
    requiredCells: ["wsl", "devcontainer"],
    cells,
  };
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(
    path.resolve(options.output),
    `${JSON.stringify(aggregate, null, 2)}\n`,
    "utf8",
  );
}

if (require.main === module) main();

module.exports = { REQUIRED_FILES, verifyCell };
