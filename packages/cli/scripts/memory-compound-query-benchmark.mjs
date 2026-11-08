#!/usr/bin/env node
// Isolated synthetic authority only. No provider, model, or network calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  builtinModules,
  createRequire,
  syncBuiltinESMExports,
} from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const script = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(script);
const repositoryRoot = path.resolve(scriptsDirectory, "../../..");
const fixtureFile = path.join(
  scriptsDirectory,
  "memory-compound-query-fixture.mjs",
);
const portFile = path.resolve(
  scriptsDirectory,
  "../src/lib/context-memory-kernel/segmented-memory-port.js",
);
const serviceFile = path.resolve(
  scriptsDirectory,
  "../src/lib/context-memory-kernel/memory-service.js",
);
const sha = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const portOptions = (filePath) => ({
  filePath,
  queryIndexCacheMode: "validate-disk",
  queryIndexLayout: "bundle",
});
const failureSummary = (error) => ({
  name: error?.name || "Error",
  code: error?.code ?? null,
  message: String(error?.message || error).slice(0, 4000),
  ...(error?.errors ? { causes: error.errors.map(failureSummary) } : {}),
});

function packageRoot(entry) {
  let directory = path.dirname(entry);
  for (;;) {
    const manifest = path.join(directory, "package.json");
    if (
      fs.existsSync(manifest) &&
      readJson(manifest).name === "@chainlesschain/context-memory-kernel"
    )
      return directory;
    const parent = path.dirname(directory);
    assert.notEqual(
      parent,
      directory,
      "resolved kernel package root was not found",
    );
    directory = parent;
  }
}

function sourceFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(file)
        : entry.isFile() && /\.(?:js|mjs|json)$/u.test(entry.name)
          ? [file]
          : [];
    })
    .sort();
}

function kernelFiles(root) {
  return [
    path.join(root, "package.json"),
    path.join(root, "index.mjs"),
    ...sourceFiles(path.join(root, "lib")),
  ];
}

let executableCache;
function executableIdentity() {
  const executable = fs.realpathSync.native(process.execPath);
  const statKey = () => {
    const stat = fs.statSync(executable, { bigint: true });
    return [
      executable,
      stat.dev,
      stat.ino,
      stat.size,
      stat.mtimeNs,
      stat.ctimeNs,
    ]
      .map(String)
      .join("|");
  };
  const key = statKey();
  if (executableCache?.key !== key) {
    const hash = createHash("sha256");
    const descriptor = fs.openSync(executable, "r");
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (!count) break;
        hash.update(buffer.subarray(0, count));
      }
    } finally {
      fs.closeSync(descriptor);
    }
    assert.equal(statKey(), key, "Node executable changed while hashing");
    executableCache = { key, sha256: "sha256:" + hash.digest("hex") };
  }
  return {
    executable,
    executableSha256: executableCache.sha256,
    executableHashPolicy:
      "streamed once per process and rehashed when physical file stat identity changes",
  };
}

export function captureSourceIdentity() {
  const esmEntry = fs.realpathSync.native(
    fileURLToPath(import.meta.resolve("@chainlesschain/context-memory-kernel")),
  );
  const cjsEntry = fs.realpathSync.native(
    createRequire(serviceFile).resolve("@chainlesschain/context-memory-kernel"),
  );
  const actualKernel = fs.realpathSync.native(packageRoot(esmEntry));
  assert.equal(
    fs.realpathSync.native(packageRoot(cjsEntry)),
    actualKernel,
    "fixture and CLI service resolve different kernel packages",
  );
  const expectedKernel = path.join(
    repositoryRoot,
    "packages/context-memory-kernel",
  );
  const kernelHashes = (root) =>
    Object.fromEntries(
      kernelFiles(root).map((file) => [
        path.relative(root, file).replaceAll("\\", "/"),
        sha(fs.readFileSync(file)),
      ]),
    );
  const actualKernelHashes = kernelHashes(actualKernel);
  assert.deepEqual(
    actualKernelHashes,
    kernelHashes(expectedKernel),
    "resolved kernel bytes differ from the repository kernel source",
  );

  // Follow literal relative imports with explicit source extensions only.
  // Computed imports, extensionless resolution, and third-party packages are
  // not a verified dependency closure. Bind the kernel separately above.
  const pending = [script, fixtureFile, portFile, serviceFile];
  const files = new Map();
  const unboundBareSpecifiers = new Set();
  const builtins = new Set(builtinModules);
  while (pending.length) {
    const file = fs.realpathSync.native(pending.pop());
    if (files.has(file)) continue;
    const bytes = fs.readFileSync(file);
    files.set(file, sha(bytes));
    const source = bytes.toString("utf8");
    const imports =
      /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)["']([^"']+)["']/gu;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (/\.(?:js|mjs|cjs|json)$/u.test(target)) pending.push(target);
      } else if (
        !specifier.startsWith("node:") &&
        !builtins.has(specifier) &&
        specifier !== "@chainlesschain/context-memory-kernel"
      )
        unboundBareSpecifiers.add(specifier);
    }
  }
  return {
    node: {
      version: process.version,
      ...executableIdentity(),
      versions: { ...process.versions },
      platform: process.platform,
      arch: process.arch,
    },
    kernel: {
      version: readJson(path.join(actualKernel, "package.json")).version,
      esmEntry,
      cjsEntry,
      physicalRoot: actualKernel,
      repositoryBytesVerified: true,
      sha256: actualKernelHashes,
    },
    dependencyCoverage: {
      method: "literal-relative-imports-with-explicit-source-extensions",
      fullDependencyClosureVerified: false,
      thirdPartyDependenciesFrozen: false,
      unboundBareSpecifiers: [...unboundBareSpecifiers].sort(),
      limitations: [
        "Static text matching does not prove executed dependency closure.",
        "Computed and extensionless imports are not followed.",
        "Third-party package bytes are not frozen by this benchmark.",
      ],
    },
    localSha256: Object.fromEntries(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([file, hash]) => [
          path.relative(repositoryRoot, file).replaceAll("\\", "/"),
          hash,
        ]),
    ),
  };
}

export function captureGitIdentity() {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  return {
    sourceHead: git(["rev-parse", "HEAD"]),
    sourceBranch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    workingTree: status ? "includes-uncommitted-files" : "clean",
    workingTreeStatusSha256: sha(status),
  };
}

export function assertGitIdentity(expected, actual = captureGitIdentity()) {
  assert.deepEqual(
    actual,
    expected,
    "Git HEAD, branch, or working-tree identity changed during measurement",
  );
}

function assertSource(identityHash) {
  const current = captureSourceIdentity();
  assert.equal(
    sha(JSON.stringify(current)),
    identityHash,
    "implementation or runtime identity changed during measurement",
  );
}

export function atomicCheckpoint(output, value) {
  const temporary = output + "." + randomUUID() + ".tmp";
  let descriptor;
  const errors = [];
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, output);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    } catch (error) {
      errors.push(error);
    }
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      "Atomic checkpoint and temporary cleanup failed",
    );
}

function writeNewJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

function assertPage(actual, expected, revision) {
  assert.deepEqual(
    actual.entries,
    expected.entries,
    "public page differs from full authority oracle",
  );
  assert.equal(
    actual.storeRevision,
    revision,
    "page returned a different authority revision",
  );
  if (expected.hasNext) {
    assert.equal(
      typeof actual.nextCursor,
      "string",
      "continuation cursor is missing",
    );
    assert.ok(actual.nextCursor.length > 0);
  } else
    assert.equal(
      actual.nextCursor,
      null,
      "terminal page must not have a cursor",
    );
  assert.equal(
    new Set(actual.entries.map((entry) => entry.id)).size,
    actual.entries.length,
  );
}

async function loadRuntime() {
  const [fixture, { SegmentedMemoryPort }, { CliCanonicalMemoryService }] =
    await Promise.all([
      import(pathToFileURL(fixtureFile).href),
      import(pathToFileURL(portFile).href),
      import(pathToFileURL(serviceFile).href),
    ]);
  return { fixture, SegmentedMemoryPort, CliCanonicalMemoryService };
}

function serviceFor(runtime, file) {
  const port = new runtime.SegmentedMemoryPort(portOptions(file));
  return {
    port,
    service: new runtime.CliCanonicalMemoryService({
      runtime: { memoryPort: port },
    }),
  };
}

async function setupWorker(request, runtime) {
  const { state, metadata } = runtime.fixture.createCompoundFixture(
    request.count,
  );
  const { port, service } = serviceFor(runtime, request.file);
  assert.equal((await port.importSnapshot(state)).ok, true);
  // Preparation is in its own process and excluded from cold query timings.
  // It builds the physical bundle and produces a real first-page cursor.
  const firstScenario = runtime.fixture.compoundScenarios()[0];
  const firstPage = await service.listPage(firstScenario.query);
  assertPage(
    firstPage,
    runtime.fixture.oraclePage(
      Object.values(state.records),
      firstScenario.query,
    ),
    state.storeRevision,
  );
  const manifest = readJson(request.file);
  const plan = port._queryBundlePlan(manifest);
  assert.ok(
    plan && fs.existsSync(plan.file),
    "setup must prepare the real disk bundle",
  );
  const firstPageBuckets = new Set(
    firstPage.entries.map((entry) =>
      createHash("sha256").update(entry.id).digest("hex").slice(0, 2),
    ),
  );
  assert.ok(firstPageBuckets.size > 1, "tie fixture must span multiple shards");
  const setup = {
    fixture: metadata,
    firstPage,
    manifestDigest: sha(fs.readFileSync(request.file)),
    bundleFile: plan.file,
    shardCount: Object.keys(manifest.shards).length,
    authorityBytes: manifest.totalBytes,
    bundleBytes: fs.statSync(plan.file).size,
    firstPageShardCount: firstPageBuckets.size,
  };
  writeNewJson(request.setupFile, setup);
  return {
    fixture: metadata,
    manifestDigest: setup.manifestDigest,
    shardCount: setup.shardCount,
    authorityBytes: setup.authorityBytes,
    bundleBytes: setup.bundleBytes,
    firstPageShardCount: setup.firstPageShardCount,
    setupComplete: true,
  };
}

async function oracleWorker(request, runtime) {
  const setup = readJson(request.setupFile);
  const { port } = serviceFor(runtime, request.file);
  // No request argument: this path captures and verifies every authority shard.
  // Passing scopeAdmissions/sink to query() would incorrectly use the index.
  const records = await port.query();
  assert.equal(records.length, setup.fixture.count);
  assert.equal(
    runtime.fixture.recordSetDigest(records),
    setup.fixture.recordsDigest,
  );
  assert.equal(await port.getRevision(), setup.fixture.storeRevision);
  const scenarios = runtime.fixture.compoundScenarios().map((scenario) => ({
    ...scenario,
    ...(scenario.offset
      ? { query: { ...scenario.query, cursor: setup.firstPage.nextCursor } }
      : {}),
    expected: runtime.fixture.oraclePage(
      records,
      scenario.query,
      scenario.offset,
    ),
  }));
  assertPage(
    setup.firstPage,
    scenarios[0].expected,
    setup.fixture.storeRevision,
  );
  for (const scenario of scenarios) {
    assert.ok(scenario.expected.matchingCount >= 64);
    assert.equal(scenario.expected.entries.length, 20);
    const rejected =
      setup.fixture.rejected[
        scenario.offset ? "category-narrow" : scenario.name
      ];
    assert.ok(
      scenario.expected.entries.every((entry) => !rejected.includes(entry.id)),
    );
  }
  assert.equal(sha(fs.readFileSync(request.file)), setup.manifestDigest);
  writeNewJson(request.oracleFile, {
    storeRevision: setup.fixture.storeRevision,
    recordsDigest: setup.fixture.recordsDigest,
    scenarios,
  });
  return {
    fullAuthorityVerified: true,
    recordCount: records.length,
    recordsDigest: setup.fixture.recordsDigest,
    storeRevision: setup.fixture.storeRevision,
    scenarios: scenarios.map(({ name, query, offset, expected }) => ({
      name,
      query,
      offset,
      expectedCount: expected.entries.length,
      expectedDigest: sha(JSON.stringify(expected.entries)),
      matchingCount: expected.matchingCount,
      expectedHasNext: expected.hasNext,
    })),
  };
}

async function measureWorker(request, runtime) {
  const setup = readJson(request.setupFile);
  const oracle = readJson(request.oracleFile);
  const scenario = oracle.scenarios.find(
    (item) => item.name === request.scenario,
  );
  assert.ok(scenario);
  const { port, service } = serviceFor(runtime, request.file);
  assert.equal(
    port._queryIndexes.size,
    0,
    "cold worker must start without compiled indexes",
  );
  const originalRead = port._readShardBytes;
  const originalOpen = fs.openSync;
  const originalDirectories = port._checkDirectories;
  let authorityReads = 0,
    authorityBytes = 0,
    bundleReadOpens = 0;
  let indexReadOpens = 0,
    directoryChecks = 0;
  port._readShardBytes = function (...args) {
    const bytes = originalRead.apply(this, args);
    authorityReads++;
    authorityBytes += bytes.length;
    return bytes;
  };
  port._checkDirectories = function (...args) {
    directoryChecks++;
    return originalDirectories.apply(this, args);
  };
  fs.openSync = function (file, flags, ...args) {
    const descriptor = originalOpen(file, flags, ...args);
    const reading =
      typeof flags === "number"
        ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0
        : flags === "r" || flags === "rs";
    if (reading && typeof file === "string") {
      if (file === setup.bundleFile) bundleReadOpens++;
      if (/^query-[a-f0-9]{2}-[a-f0-9]{64}\.json$/u.test(path.basename(file)))
        indexReadOpens++;
    }
    return descriptor;
  };
  syncBuiltinESMExports();
  const eventLoop = monitorEventLoopDelay({ resolution: 1 });
  eventLoop.enable();
  let page, durationMs;
  try {
    await new Promise(setImmediate);
    const started = performance.now();
    // The first and only list call in this process, including continuation.
    page = await service.listPage(scenario.query);
    durationMs = performance.now() - started;
    await new Promise(setImmediate);
  } finally {
    port._readShardBytes = originalRead;
    port._checkDirectories = originalDirectories;
    fs.openSync = originalOpen;
    syncBuiltinESMExports();
    eventLoop.disable();
  }
  const memory = process.memoryUsage();
  assertPage(page, scenario.expected, oracle.storeRevision);
  assert.ok(authorityReads > 0 && authorityReads <= page.entries.length);
  assert.equal(
    bundleReadOpens,
    1,
    "cold query must verify the real on-disk bundle",
  );
  assert.equal(
    sha(fs.readFileSync(request.file)),
    setup.manifestDigest,
    "read-only sample changed the authority generation",
  );
  return {
    scenario: scenario.name,
    query: scenario.query,
    offset: scenario.offset,
    serviceCalls: 1,
    initialCompiledIndexCount: 0,
    durationMs,
    eventLoopDelayMaxMs: eventLoop.max / 1e6,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    authorityReads,
    authorityBytes,
    bundleReadOpens,
    indexReadOpens,
    directoryChecks,
    entries: page.entries,
    rowsDigest: sha(JSON.stringify(page.entries)),
    nextCursor: page.nextCursor,
    storeRevision: page.storeRevision,
    oracleVerified: true,
    manifestUnchanged: true,
  };
}

async function semanticsWorker(request, runtime) {
  const setup = readJson(request.setupFile);
  const { port, service } = serviceFor(runtime, request.file);
  const records = await port.query();
  assert.equal(
    runtime.fixture.recordSetDigest(records),
    setup.fixture.recordsDigest,
  );
  const cases = [
    ["empty-scopes", { scopeAdmissions: [] }],
    ["empty-states", { states: [] }],
    ["empty-tags", { category: "rare", tags: [] }],
    ["unknown-category", { category: "does-not-exist" }],
    ["unknown-tags", { tags: ["does-not-exist"] }],
    ["wildcard-sink", { category: "common", sink: "provider.unknown" }],
    [
      "exact-scope",
      { scopeAdmissions: [{ scope: "project", scopeId: "shared" }] },
    ],
    ["global-null", { scopeAdmissions: [{ scope: "global", scopeId: null }] }],
    ["global-omitted", { scopeAdmissions: [{ scope: "global" }] }],
    [
      "default-includes-candidate",
      { states: ["candidate", "archived", "expired", "superseded"] },
    ],
    [
      "tombstones-hidden",
      {
        category: "deleted",
        tags: [],
        sink: "kernel.tombstone",
        states: ["deleted", "purged"],
      },
    ],
    [
      "tombstones-visible",
      {
        category: "deleted",
        tags: [],
        sink: "kernel.tombstone",
        states: ["deleted", "purged"],
        includeTombstones: true,
      },
    ],
  ];
  const verified = [];
  for (const [name, options] of cases) {
    const query = { ...options, limit: 20 };
    const expected = runtime.fixture.oraclePage(records, query);
    let authorityReads = 0;
    const { port: casePort, service: caseService } = serviceFor(
      runtime,
      request.file,
    );
    const read = casePort._readShardBytes;
    casePort._readShardBytes = function (...args) {
      authorityReads++;
      return read.apply(this, args);
    };
    const page = await caseService.listPage(query);
    assertPage(page, expected, setup.fixture.storeRevision);
    if (!expected.entries.length) assert.equal(authorityReads, 0);
    if (name === "tombstones-visible")
      assert.ok(
        page.entries.length > 0 &&
          page.entries.every((entry) => entry.content === ""),
      );
    if (name === "default-includes-candidate")
      assert.ok(page.entries.length > 0);
    verified.push({ name, entries: page.entries.length, authorityReads });
  }
  const base = runtime.fixture.compoundScenarios()[0].query;
  const cursor = setup.firstPage.nextCursor;
  const equivalent = {
    ...base,
    cursor,
    tags: ["focus", "common", "focus"],
    states: ["reinforced", "active", "reinforced"],
  };
  assertPage(
    await service.listPage(equivalent),
    runtime.fixture.oraclePage(records, base, 20),
    setup.fixture.storeRevision,
  );
  assertPage(
    await service.listPage({ ...base, cursor, limit: 7 }),
    runtime.fixture.oraclePage(records, { ...base, limit: 7 }, 20),
    setup.fixture.storeRevision,
  );
  for (const query of [
    { ...base, cursor: "garbage" },
    { ...base, cursor, sink: "private" },
    { ...base, cursor, scopeAdmissions: [...base.scopeAdmissions].reverse() },
    { ...base, cursor, states: ["active"] },
  ])
    await assert.rejects(service.listPage(query), {
      code: "CONTEXT_MEMORY_CURSOR_INVALID",
    });

  // Walk the complete selective result with reopened real services. The oracle
  // uses an integer offset, never the opaque production cursor. This correctness
  // phase is deliberately outside every first-cold latency sample.
  const allIds = [];
  let nextCursor = null;
  let offset = 0;
  let pages = 0;
  do {
    const pageQuery = { ...base, limit: 31, cursor: nextCursor };
    const { service: reopened } = serviceFor(runtime, request.file);
    const page = await reopened.listPage(pageQuery);
    assertPage(
      page,
      runtime.fixture.oraclePage(records, pageQuery, offset),
      setup.fixture.storeRevision,
    );
    allIds.push(...page.entries.map((entry) => entry.id));
    offset += page.entries.length;
    nextCursor = page.nextCursor;
    pages++;
    assert.ok(pages <= Math.ceil(records.length / 31) + 1);
  } while (nextCursor);
  assert.ok(
    pages >= 3,
    "planted ties must exercise repeated continuation and a terminal page",
  );
  const allExpected = runtime.fixture.oraclePage(records, {
    ...base,
    limit: records.length,
  });
  assert.deepEqual(
    allIds,
    allExpected.entries.map((entry) => entry.id),
  );
  assert.equal(new Set(allIds).size, allIds.length);

  const snapshot = await port.exportSnapshot();
  assert.equal(
    snapshot.digest,
    setup.fixture.stateDigest,
    "full audit changed",
  );
  assert.equal(snapshot.events.length, setup.fixture.eventCount);
  assert.equal(snapshot.storeRevision, setup.fixture.storeRevision);
  assert.equal(sha(fs.readFileSync(request.file)), setup.manifestDigest);
  return {
    cases: verified,
    equivalentCursorVerified: true,
    changedPageSizeVerified: true,
    invalidCursorCases: 4,
    allPages: {
      pages,
      records: allIds.length,
      noDuplicates: true,
      fullOracleVerified: true,
    },
    finalAuditVerified: true,
    manifestUnchanged: true,
  };
}

async function workerMain(role, requestFile) {
  const request = readJson(requestFile);
  assertSource(request.identityHash);
  const runtime = await loadRuntime();
  const operation = {
    setup: setupWorker,
    oracle: oracleWorker,
    measure: measureWorker,
    semantics: semanticsWorker,
  }[role];
  assert.ok(operation, "unknown worker role");
  const result = await operation(request, runtime);
  assertSource(request.identityHash);
  return {
    result,
    sourceIdentityVerified: true,
    identityHash: request.identityHash,
  };
}

function runWorker(role, request, scratch) {
  const requestFile = path.join(scratch, "request-" + randomUUID() + ".json");
  writeNewJson(requestFile, request);
  const started = performance.now();
  let child;
  try {
    child = spawnSync(
      process.execPath,
      [script, "--worker", role, "--request", requestFile],
      {
        cwd: repositoryRoot,
        windowsHide: true,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } finally {
    fs.unlinkSync(requestFile);
  }
  if (child.error || child.status !== 0) {
    const error = new Error("Compound Memory " + role + " worker failed", {
      cause: child.error,
    });
    error.code = child.error?.code || "COMPOUND_WORKER_FAILED";
    error.worker = {
      role,
      status: child.status,
      signal: child.signal,
      stderr: String(child.stderr || "").slice(0, 4000),
    };
    throw error;
  }
  const value = JSON.parse(child.stdout);
  assert.equal(value.sourceIdentityVerified, true);
  assert.equal(value.identityHash, request.identityHash);
  return { ...value.result, workerWallMs: performance.now() - started };
}

function summarize(samples) {
  const values = samples
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  const at = (fraction) =>
    values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
  return values.length
    ? {
        samples: values.length,
        minMs: values[0],
        p50Ms: at(0.5),
        p95Ms: at(0.95),
        p99Ms: at(0.99),
        maxMs: values.at(-1),
      }
    : null;
}

function removeScratch(root, parent) {
  const resolved = path.resolve(root);
  assert.equal(
    path.dirname(resolved),
    parent,
    "cleanup target escaped its temporary parent",
  );
  assert.ok(path.basename(resolved).startsWith("cc-memory-compound-"));
  if (!fs.existsSync(resolved)) return;
  assert.equal(
    fs.realpathSync.native(resolved),
    resolved,
    "cleanup target physical path changed",
  );
  assert.ok(!fs.lstatSync(resolved).isSymbolicLink());
  fs.rmSync(resolved, { recursive: true, force: true });
}

export async function runMemoryCompoundBenchmark({
  counts = [1000, 10000, 100000],
  samples = 100,
  output,
  loadContext = "unspecified",
} = {}) {
  assert.ok(
    Array.isArray(counts) &&
      counts.length > 0 &&
      new Set(counts).size === counts.length &&
      counts.every((count) => [1000, 10000, 100000].includes(count)),
  );
  assert.ok(Number.isSafeInteger(samples) && samples >= 1 && samples <= 200);
  assert.ok(
    ["unspecified", "parallel-preflight", "isolated-measurement"].includes(
      loadContext,
    ),
  );
  assert.ok(
    typeof output === "string" && output.length > 0,
    "--output is required",
  );
  const destination = path.resolve(output);
  const report = {
    schema: "chainlesschain.memory-compound-query-measurement/v1",
    startedAt: new Date().toISOString(),
    complete: false,
    stage: "initializing",
    counts,
    samples,
    loadContext,
    cacheMode: "validate-disk",
    indexLayout: "bundle",
    workerTimeoutMs: 120_000,
    sourceIdentity: null,
    sourceIdentityHash: null,
    gitIdentity: null,
    gitStable: false,
    performanceAccepted: false,
    performanceThresholds: null,
    boundary:
      "Real CLI service.listPage plus disk authority and bundle. Cold is the first list call in a fresh Node process; OS filesystem caches are not flushed. Setup, imports, oracle, and process startup are excluded from durationMs. No model/network requests. Parallel preflight and partial sample matrices are correctness checks only, never performance acceptance. No release/SLO approval is implied.",
    sampleMatrixComplete: false,
    cleanupComplete: false,
    tiers: [],
  };
  // Claim a new evidence file. Never overwrite a prior failed or successful run.
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const save = () => atomicCheckpoint(destination, report);
  let root, temporaryParent, failure, activeTier;
  try {
    report.sourceIdentity = captureSourceIdentity();
    report.sourceIdentityHash = sha(JSON.stringify(report.sourceIdentity));
    report.gitIdentity = captureGitIdentity();
    Object.assign(report, report.gitIdentity);
    temporaryParent = fs.realpathSync.native(os.tmpdir());
    root = fs.mkdtempSync(path.join(temporaryParent, "cc-memory-compound-"));
    const identityHash = report.sourceIdentityHash;
    save();
    for (const count of counts) {
      assertGitIdentity(report.gitIdentity);
      activeTier = {
        count,
        complete: false,
        finalAuditVerified: false,
        setup: null,
        oracle: null,
        semantics: null,
        groups: {},
      };
      report.tiers.push(activeTier);
      const request = {
        count,
        identityHash,
        file: path.join(root, "authority-" + count + ".json"),
        setupFile: path.join(root, "setup-" + count + ".json"),
        oracleFile: path.join(root, "oracle-" + count + ".json"),
      };
      report.stage = "setup";
      report.progress = { count, phase: "setup" };
      save();
      activeTier.setup = runWorker("setup", request, root);
      assertSource(identityHash);
      save();
      report.stage = "oracle";
      report.progress = { count, phase: "oracle" };
      save();
      activeTier.oracle = runWorker("oracle", request, root);
      assertSource(identityHash);
      save();
      for (const scenario of activeTier.oracle.scenarios) {
        const group = {
          query: scenario.query,
          offset: scenario.offset,
          matchingCount: scenario.matchingCount,
          expectedDigest: scenario.expectedDigest,
          complete: false,
          samplesComplete: false,
          latency: null,
          samples: [],
        };
        activeTier.groups[scenario.name] = group;
        for (let round = 1; round <= samples; round++) {
          report.stage = "cold-query";
          report.progress = { count, scenario: scenario.name, round };
          save();
          assertSource(identityHash);
          const result = runWorker(
            "measure",
            { ...request, scenario: scenario.name },
            root,
          );
          assertSource(identityHash);
          assert.equal(result.rowsDigest, scenario.expectedDigest);
          assert.equal(result.entries.length, scenario.expectedCount);
          assert.equal(
            result.storeRevision,
            activeTier.setup.fixture.storeRevision,
          );
          assert.deepEqual(result.query, scenario.query);
          assert.equal(result.oracleVerified, true);
          group.samples.push({ round, ...result });
          group.latency = summarize(group.samples);
          group.samplesComplete = group.samples.length === samples;
          save();
          if (round % 10 === 0 || round === samples)
            process.stderr.write(
              count + " " + scenario.name + ": " + round + "/" + samples + "\n",
            );
        }
      }
      report.stage = "semantics-and-final-audit";
      report.progress = { count, phase: report.stage };
      save();
      activeTier.semantics = runWorker("semantics", request, root);
      assert.equal(activeTier.semantics.finalAuditVerified, true);
      assertSource(identityHash);
      assertGitIdentity(report.gitIdentity);
      activeTier.finalAuditVerified = true;
      // Tier complete is deferred until the run's scratch cleanup succeeds.
      save();
    }
    assertSource(report.sourceIdentityHash);
    assertGitIdentity(report.gitIdentity);
    report.sourceStable = true;
    report.gitStable = true;
  } catch (error) {
    failure = error;
    report.failure = {
      ...failureSummary(error),
      stage: report.stage,
      progress: report.progress,
      ...(error.worker ? { worker: error.worker } : {}),
    };
  } finally {
    report.stage = "cleanup";
    try {
      if (root) removeScratch(root, temporaryParent);
      report.cleanupComplete = true;
    } catch (error) {
      report.cleanupFailure = failureSummary(error);
      failure = failure
        ? new AggregateError(
            [failure, error],
            "Benchmark and scratch cleanup failed",
          )
        : error;
      report.failure ||= {
        ...failureSummary(error),
        stage: "cleanup",
        progress: report.progress,
      };
    }
    if (failure) {
      report.complete = false;
      report.stage = "failed";
      report.finishedAt = new Date().toISOString();
      try {
        save();
      } catch (error) {
        failure = new AggregateError(
          [failure, error],
          "Benchmark failure checkpoint could not be saved",
        );
      }
    }
  }
  if (failure) throw failure;
  try {
    assertSource(report.sourceIdentityHash);
    assertGitIdentity(report.gitIdentity);
    for (const tier of report.tiers) {
      assert.equal(tier.finalAuditVerified, true);
      assert.equal(Object.keys(tier.groups).length, 3);
      assert.ok(
        Object.values(tier.groups).every((group) => group.samplesComplete),
      );
      for (const group of Object.values(tier.groups)) group.complete = true;
      tier.complete = true;
    }
    report.sampleMatrixComplete =
      samples >= 100 &&
      counts.length === 3 &&
      [1000, 10000, 100000].every((count) => counts.includes(count));
    report.stage = "complete";
    report.finishedAt = new Date().toISOString();
    report.complete = true;
    save();
  } catch (error) {
    report.complete = false;
    for (const tier of report.tiers) {
      tier.complete = false;
      for (const group of Object.values(tier.groups)) group.complete = false;
    }
    report.stage = "failed";
    report.failure = { ...failureSummary(error), stage: "finalize" };
    try {
      save();
    } catch (saveError) {
      throw new AggregateError(
        [error, saveError],
        "Final verification and checkpoint failed",
      );
    }
    throw error;
  }
  return report;
}

async function main() {
  const { values } = parseArgs({
    options: {
      counts: { type: "string", default: "1000,10000,100000" },
      samples: { type: "string", default: "100" },
      output: { type: "string" },
      "load-context": { type: "string", default: "unspecified" },
      worker: { type: "string" },
      request: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: node memory-compound-query-benchmark.mjs --output new-report.json [--counts 1000,10000,100000] [--samples 100] [--load-context unspecified|parallel-preflight|isolated-measurement]\nThree first-cold service+disk scenarios; 120s worker timeout. --counts 1000 --samples 1 --load-context parallel-preflight is correctness-only preflight.\n",
    );
    return;
  }
  if (values.worker) {
    process.stdout.write(
      JSON.stringify(await workerMain(values.worker, values.request)),
    );
    return;
  }
  const report = await runMemoryCompoundBenchmark({
    counts: values.counts.split(",").map(Number),
    samples: Number(values.samples),
    output: values.output,
    loadContext: values["load-context"],
  });
  process.stdout.write(
    JSON.stringify({
      complete: report.complete,
      sampleMatrixComplete: report.sampleMatrixComplete,
      performanceAccepted: false,
      loadContext: report.loadContext,
      output: path.resolve(values.output),
    }) + "\n",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify(failureSummary(error)) + "\n");
    process.exitCode = 1;
  });
}
