"use strict";

// Read-only verifier: no extraction, network access, or process execution.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

function zipFiles(zip) {
  assert.ok(zip.length <= 8 * 1024 * 1024, "ZIP exceeds diagnostic bound");
  let end = -1;
  for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
    if (
      zip.readUInt32LE(p) === 0x06054b50 &&
      p + 22 + zip.readUInt16LE(p + 20) === zip.length
    ) {
      end = p;
      break;
    }
  }
  assert.ok(end >= 0, "Missing ZIP end record");
  assert.equal(zip.readUInt32LE(end + 4), 0, "Split ZIP is unsupported");
  const count = zip.readUInt16LE(end + 10);
  assert.equal(zip.readUInt16LE(end + 8), count);
  assert.ok(count < 1000);
  let offset = zip.readUInt32LE(end + 16);
  const centralEnd = offset + zip.readUInt32LE(end + 12);
  assert.equal(centralEnd, end);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    assert.equal(
      zip.readUInt16LE(offset + 8) & 1,
      0,
      "Encrypted ZIP is unsupported",
    );
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    assert.ok(
      name &&
        !name.startsWith("/") &&
        !name.includes("\\") &&
        !name.includes(":") &&
        !name.split("/").includes(".."),
    );
    const local = zip.readUInt32LE(offset + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    assert.equal(zip.readUInt16LE(local + 8), method);
    const localNameLength = zip.readUInt16LE(local + 26);
    const localExtraLength = zip.readUInt16LE(local + 28);
    assert.equal(
      zip.subarray(local + 30, local + 30 + localNameLength).toString("utf8"),
      name,
    );
    const data = local + 30 + localNameLength + localExtraLength;
    assert.ok(data + compressed <= zip.readUInt32LE(end + 16));
    total += size;
    assert.ok(
      total <= 16 * 1024 * 1024,
      "Uncompressed ZIP exceeds diagnostic bound",
    );
    const packed = zip.subarray(data, data + compressed);
    assert.ok(method === 0 || method === 8, "Unsupported ZIP compression");
    const bytes =
      method === 0
        ? packed
        : zlib.inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) });
    assert.equal(bytes.length, size);
    if (!name.endsWith("/")) {
      assert.ok(!files.has(name), "Duplicate file");
      files.set(name, bytes);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, centralEnd);
  return files;
}

function derive(zip) {
  const files = zipFiles(zip);
  const byName = (name) => {
    const matches = [...files].filter(
      ([file]) => path.posix.basename(file) === name,
    );
    assert.equal(matches.length, 1, `Expected one ${name}`);
    return matches[0][1];
  };
  const sourceCommit = byName("source.sha").toString().trim();
  const driverCommit = byName("driver.sha").toString().trim();
  const driverSha256 = byName("driver.sha256")
    .toString()
    .match(/[0-9a-f]{64}/)[0];
  const inventory = [...files]
    .map(([name, bytes]) => ({
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  const eventFiles = [...files].filter(([name]) => name.endsWith(".ndjson"));
  const events = eventFiles.flatMap(([, bytes]) =>
    bytes.toString("utf8").trim().split("\n").map(JSON.parse),
  );
  const parents = events.filter(
    (event) =>
      event.event === "loaded" && event.entry.endsWith("/vitest/vitest.mjs"),
  );
  assert.equal(
    parents.length,
    1,
    "Expected one Vitest execution, without retry",
  );
  const parentEvents = events
    .filter((event) => event.pid === parents[0].pid)
    .sort((a, b) => a.sequence - b.sequence);
  const active = new Map();
  const completed = [];
  for (const event of parentEvents) {
    if (event.event === "child.created") {
      assert.ok(!active.has(event.childPid));
      active.set(event.childPid, { pid: event.childPid, events: [] });
    }
    const life = active.get(event.childPid);
    if (!life) continue;
    life.events.push(event);
    if (event.event === "child.message.send" && event.type === "run")
      life.files = event.files;
    if (event.event === "child.close") {
      completed.push(life);
      active.delete(event.childPid);
    }
  }
  assert.equal(completed.length, 103);
  assert.equal(active.size, 0);
  const expectedOrder = [
    "child.message.send:run",
    "child.message.receive:testfileFinished",
    "child.message.send:stop",
    "child.message.receive:stopped",
    "child.kill.call:",
    "child.exit:",
    "child.close:",
  ];
  for (const life of completed) {
    const labels = life.events.map(
      (event) => `${event.event}:${event.type || ""}`,
    );
    for (let index = 0; index < expectedOrder.length; index++) {
      assert.equal(
        labels.filter((label) => label === expectedOrder[index]).length,
        1,
      );
      if (index)
        assert.ok(
          labels.indexOf(expectedOrder[index]) >
            labels.indexOf(expectedOrder[index - 1]),
        );
    }
    assert.ok(!life.events.some((event) => event.hasError));
    const exit = life.events.find((event) => event.event === "child.exit");
    assert.equal(exit.code, null);
    assert.equal(exit.signal, "SIGTERM");
  }
  const selectedFiles = completed
    .flatMap((life) => life.files)
    .map((file) => {
      const index = file.indexOf("__tests__/unit/");
      assert.ok(index >= 0);
      return file.slice(index);
    })
    .sort();
  assert.equal(new Set(selectedFiles).size, 103);
  const junitText = byName("worker-diagnostic.xml").toString("utf8");
  const junitRoot = junitText.match(/<testsuites\b[^>]*>/)[0];
  const attribute = (name) =>
    Number(junitRoot.match(new RegExp(`\\b${name}="([0-9.]+)"`))[1]);
  const junit = {
    tests: attribute("tests"),
    failures: attribute("failures"),
    errors: attribute("errors"),
    durationSeconds: attribute("time"),
  };
  assert.deepEqual([junit.tests, junit.failures, junit.errors], [2510, 0, 0]);
  const headless = completed.find((life) =>
    life.files.some((file) => file.endsWith("/headless-runner.test.js")),
  );
  // Project only lifecycle data: never serialize raw IPC payloads, env, stacks,
  // runner workspace paths, or test output from the downloaded diagnostic.
  const project = (event) =>
    Object.fromEntries(
      [
        "time",
        "elapsedNs",
        "sequence",
        "pid",
        "ppid",
        "event",
        "type",
        "childPid",
        "code",
        "signal",
        "exitCode",
        "signalCode",
        "connected",
        "hasError",
        "rss",
        "heapUsed",
        "maxRss",
      ]
        .filter((key) => Object.hasOwn(event, key))
        .map((key) => [key, event[key]]),
    );
  return {
    sourceCommit,
    driverCommit,
    driverSha256,
    inventory,
    selectedFiles,
    junit,
    lifecycle: {
      vitestExecutions: parents.length,
      fileExecutions: completed.length,
      completeHandshakeBeforeKill: completed.length,
      expectedOrder,
      eventFiles: eventFiles.length,
      processStarts: events.filter((event) => event.event === "loaded").length,
      pidReuseHandledByCreatedToCloseEpisodes: true,
      childErrors: events.filter((event) => event.event === "child.error")
        .length,
      explicitExitCalls: events.filter(
        (event) => event.event === "process.exit.call",
      ).length,
      uncaughtExceptionMonitorEvents: events.filter(
        (event) => event.event === "process.uncaughtExceptionMonitor",
      ).length,
      childExitSignals: { SIGTERM: completed.length },
    },
    headless: {
      pid: headless.pid,
      parentPid: parents[0].pid,
      workerTimeline: events
        .filter((event) => event.pid === headless.pid)
        .map(project),
      parentTimeline: headless.events.map(project),
    },
  };
}

function verify(evidence, zip) {
  assert.equal(evidence.releaseGateEligible, false);
  assert.equal(evidence.rootCause.status, "unknown");
  assert.equal(
    evidence.source.commit,
    "96cbf6ba5631d5ef855e3cdc41801d837142e62b",
  );
  assert.equal(
    evidence.driver.commit,
    "81dba2aff9e3e27b5a43a90c0b0fba1e15e5d1f6",
  );
  assert.equal(evidence.run.id, 37063229369);
  assert.equal(evidence.job.id, 111024638611);
  assert.equal(evidence.artifact.id, 11252413243);
  assert.equal(evidence.run.head_sha, evidence.driver.commit);
  assert.equal(evidence.job.head_sha, evidence.driver.commit);
  assert.equal(evidence.job.run_id, evidence.run.id);
  assert.equal(evidence.artifact.runId, evidence.run.id);
  assert.equal(evidence.source.commit, evidence.observations.sourceCommit);
  assert.equal(evidence.driver.commit, evidence.observations.driverCommit);
  assert.equal(evidence.driver.sha256, evidence.observations.driverSha256);
  assert.equal(zip.length, evidence.artifact.zip.bytes);
  assert.equal(sha256(zip), evidence.artifact.zip.sha256);
  assert.equal(`sha256:${sha256(zip)}`, evidence.artifact.apiDigest);
  assert.deepEqual(derive(zip), evidence.observations);
  return {
    verified: true,
    testFiles: 103,
    tests: 2510,
    releaseGateEligible: false,
    rootCause: "unknown",
  };
}

module.exports = { derive, verify, sha256 };
if (require.main === module) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: node verify-windows-worker-diagnostic-hosted-96cbf6ba56.cjs --zip <artifact.zip>",
  );
  assert.equal(process.argv[2], "--zip");
  const evidence = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "windows-worker-diagnostic-hosted-96cbf6ba56.json"),
      "utf8",
    ),
  );
  console.log(
    JSON.stringify(verify(evidence, fs.readFileSync(process.argv[3]))),
  );
}
