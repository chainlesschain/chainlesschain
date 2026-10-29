import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import inspector from "node:inspector";
import { canonicalDigest, normalizeMemoryRecord } from "@chainlesschain/context-memory-kernel";
import { SegmentedMemoryPort } from "../../packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js";
import { CliCanonicalMemoryService, publicEntry } from "../../packages/cli/src/lib/context-memory-kernel/memory-service.js";
import { compareMemoryRows } from "../../packages/cli/src/lib/context-memory-kernel/memory-query-index.js";
import { stateDigest } from "../../packages/cli/src/lib/context-memory-kernel/durable-memory-port.js";
import { createDurableMemoryFixture } from "../../packages/cli/scripts/persistent-capacity-benchmark.mjs";

const helperPath = fileURLToPath(import.meta.url);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const prefix = "cc-memory-bundle-cpu-";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rowsDigest = (rows) => canonicalDigest(rows, "cc.memory-query-benchmark-rows/v1");
const sourcePaths = [
  ...["segmented-memory-port.js", "durable-memory-port.js", "memory-query-index.js", "memory-service.js", "memory-query-control.js", "memory-shard-snapshots.js", "memory-query-bundle.js"].map((name) => `packages/cli/src/lib/context-memory-kernel/${name}`),
  "packages/cli/src/lib/with-file-lock.js",
  "packages/context-memory-kernel/lib/canonical.js",
  "packages/context-memory-kernel/lib/contracts.js",
  "packages/cli/scripts/persistent-capacity-benchmark.mjs",
  "packages/cli/scripts/memory-query-index-benchmark.mjs",
];
const sources = () => Object.fromEntries(sourcePaths.map((name) => [name, sha256(fs.readFileSync(path.join(repo, name)))]));
function assertFixture(root) {
  assert.equal(path.dirname(path.resolve(root)), temporaryParent);
  assert.ok(path.basename(root).startsWith(prefix));
  assert.equal(fs.realpathSync.native(root), path.resolve(root));
}
function save(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

if (process.argv[2] === "--worker") {
  const root = path.resolve(process.argv[3]);
  assertFixture(root);
  assert.equal(process.cwd(), root);
  const config = JSON.parse(fs.readFileSync(path.join(root, "worker-input.json"), "utf8"));
  const sourceBefore = sources();
  assert.deepEqual(sourceBefore, config.sources);
  const filePath = path.join(root, "authority.json");
  const port = new SegmentedMemoryPort({ filePath });
  const methods = {};
  for (const name of ["_readQueryBundleIndexes", "_readQueryIndex", "_readShardBytes", "_queryShardSnapshot", "_checkDirectories"]) {
    const original = port[name];
    const metric = methods[name] = { calls: 0, totalMs: 0, maxMs: 0, bytes: 0 };
    const finish = (start, result, args) => {
      const elapsed = performance.now() - start;
      metric.totalMs += elapsed;
      metric.maxMs = Math.max(metric.maxMs, elapsed);
      if (name === "_readShardBytes" && Buffer.isBuffer(result)) metric.bytes += result.length;
      if (name === "_readQueryIndex" && Buffer.isBuffer(args[2])) metric.bytes += args[2].length;
    };
    if (name === "_readQueryBundleIndexes") {
      port[name] = async function (...args) {
        metric.calls++;
        const started = performance.now();
        try { return await original.apply(this, args); }
        finally { finish(started, undefined, args); }
      };
    } else {
      port[name] = function (...args) {
        metric.calls++;
        const started = performance.now();
        let result;
        try { result = original.apply(this, args); return result; }
        finally { finish(started, result, args); }
      };
    }
  }
  const session = new inspector.Session();
  session.connect();
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 1000 });
  await post("Profiler.start");
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  let rows, failure;
  try {
    rows = await new CliCanonicalMemoryService({ runtime: { memoryPort: port } }).list({ category: "category-7", limit: 20 });
  } catch (error) { failure = error; }
  const durationMs = performance.now() - started;
  const cpuUsage = process.cpuUsage(cpuBefore);
  const { profile } = await post("Profiler.stop");
  session.disconnect();
  save(path.join(root, "cold-query.cpuprofile"), profile);
  const sourceAfter = sources();
  assert.deepEqual(sourceAfter, sourceBefore);
  if (!failure) {
    assert.equal(rows.length, 20);
    assert.equal(rowsDigest(rows), config.expectedDigest);
  }
  save(path.join(root, "worker-result.json"), {
    schema: "chainlesschain.memory-bundle-cold-cpu-diagnostic/v1",
    scope: "one fresh-node cold query; diagnostic with profiler overhead, not an SLO sample",
    sourceBefore, sourceAfter, methods, durationMs, cpuUsage,
    pid: process.pid, node: process.version, platform: process.platform, arch: process.arch,
    cacheMode: port.queryIndexCacheMode, indexLayout: port.queryIndexLayout,
    count: rows?.length ?? 0, rowsDigest: rows ? rowsDigest(rows) : null,
    expectedDigest: config.expectedDigest, resultVerified: !failure,
    methodTimingBoundary: "Inclusive elapsed timings overlap; do not sum them. Profiler excludes imports, fixture generation and warmup.",
    memory: process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024,
    failure: failure ? { name: failure.name, message: failure.message, code: failure.code } : null,
  });
  if (failure) throw failure;
  process.stdout.write(JSON.stringify({ status: "passed", durationMs, methods }) + "\n");
} else {
  const artifacts = fs.mkdtempSync(path.join(path.dirname(helperPath), "cold-cpu-"));
  const sourceBefore = sources();
  const root = fs.mkdtempSync(path.join(temporaryParent, prefix));
  assertFixture(root);
  const startedAt = new Date().toISOString();
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  const filePath = path.join(root, "authority.json");
  let result;
  process.stdout.write(`artifacts=${artifacts}\nphase=fixture-start\n`);
  try {
    const state = createDurableMemoryFixture(100000);
    Object.entries(state.records).forEach(([id, record], index) => {
      state.records[id] = normalizeMemoryRecord({ ...record, digest: undefined, category: `category-${index % 32}` });
      const event = { ...state.events[index], recordDigest: state.records[id].digest };
      delete event.digest;
      event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
      state.events[index] = event;
    });
    state.digest = stateDigest(state);
    const expected = Object.values(state.records).sort(compareMemoryRows).filter((row) => row.category === "category-7").slice(0, 20).map((row) => publicEntry(row));
    const expectedDigest = rowsDigest(expected);
    const port = new SegmentedMemoryPort({ filePath });
    await port.importSnapshot(state);
    process.stdout.write("phase=warm-bundle\n");
    const warm = await new CliCanonicalMemoryService({ runtime: { memoryPort: port } }).list({ category: "category-7", limit: 20 });
    assert.equal(rowsDigest(warm), expectedDigest);
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const plan = port._queryBundlePlan(manifest);
    assert.ok(plan && fs.existsSync(plan.file));
    assert.deepEqual(sources(), sourceBefore);
    save(path.join(root, "worker-input.json"), { sources: sourceBefore, expectedDigest });
    process.stdout.write("phase=fresh-worker-profile\n");
    result = spawnSync(process.execPath, [helperPath, "--worker", root], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(artifacts, "worker.log"), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
    for (const name of ["cold-query.cpuprofile", "worker-result.json"])
      if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(artifacts, name), fs.constants.COPYFILE_EXCL);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.deepEqual(sources(), sourceBefore);
    process.stdout.write(result.stdout || "");
    save(path.join(artifacts, "receipt.json"), {
      startedAt, endedAt: new Date().toISOString(), sourceHead, sourceBefore, sourceAfter: sources(), helperSha256: sha256(fs.readFileSync(helperPath)),
      childExitCode: result.status, childSignal: result.signal, fixtureCount: 100000,
      categoryCount: 32, query: { category: "category-7", limit: 20 },
      expectedDigest, bundleBytes: plan.byteLength, frameCount: plan.frames.length,
      artifactSha256: Object.fromEntries(["cold-query.cpuprofile", "worker-result.json", "worker.log"].map((name) => [name, sha256(fs.readFileSync(path.join(artifacts, name)))])),
      cpu: os.cpus()[0]?.model, fixtureRoot: root, fixtureCleanup: "verified root removed in finally", scope: "diagnostic, not SLO or release evidence",
    });
  } catch (error) {
    save(path.join(artifacts, "failure.json"), { startedAt, sourceBefore, sourceAfter: sources(), error: { name: error.name, message: error.message }, childExitCode: result?.status ?? null });
    throw error;
  } finally {
    assertFixture(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(`phase=complete\nartifacts=${artifacts}\n`);
}
