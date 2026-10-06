const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { gunzipSync } = require("node:zlib");

const packageRoot = path.resolve(__dirname, "..");
const cliKernel = path.resolve(packageRoot, "../cli/src/lib/scheduler-kernel");

test("public CJS and ESM scheduler entry points share constructors", async () => {
  const contract = require("@chainlesschain/session-core/scheduler-contract");
  const service = require("@chainlesschain/session-core/scheduler-service");
  const esmContract =
    await import("@chainlesschain/session-core/scheduler-contract");
  const esmService =
    await import("@chainlesschain/session-core/scheduler-service");
  assert.equal(esmContract.default, contract);
  assert.equal(esmService.default, service);
  assert.throws(
    () => service.createSchedulerService({ drivers: [] }),
    (error) =>
      error instanceof contract.SchedulerKernelError &&
      error.code === "SCHEDULER_SERVICE_INVALID_DRIVERS",
  );
  assert.throws(
    () => contract.normalizeAuthorityEnvelope({ principal: { id: "actor" } }),
    (error) =>
      error instanceof contract.SchedulerKernelError &&
      error.code === "SCHEDULER_INVALID_ARGUMENT",
  );
});

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    ),
    path.join(
      path.dirname(path.dirname(process.execPath)),
      "lib/node_modules/npm/bin/npm-cli.js",
    ),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(found, "npm CLI must be available for the packed boundary test");
  return found;
}

function tarEntry(archive, expectedName) {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) =>
      header.subarray(start, end).toString("utf8").replace(/\0.*$/s, "").trim();
    const name = field(0, 100);
    const prefix = field(345, 500);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(field(124, 136) || "0", 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const dataStart = offset + 512;
    assert.ok(dataStart + size <= archive.length);
    if (fullName === expectedName) {
      return archive.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Missing packed file: ${expectedName}`);
}

test("packed goal and scheduler entries run without CLI dependencies", () => {
  const temporaryBase = path.resolve(os.tmpdir());
  const fixtureRoot = fs.mkdtempSync(
    path.join(temporaryBase, "cc-scheduler-host-"),
  );
  assert.equal(path.dirname(path.resolve(fixtureRoot)), temporaryBase);
  try {
    const packed = spawnSync(
      process.execPath,
      [
        npmCliPath(),
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        fixtureRoot,
      ],
      { cwd: packageRoot, encoding: "utf8", windowsHide: true },
    );
    assert.equal(packed.status, 0, packed.error?.message || packed.stderr);
    const metadata = JSON.parse(packed.stdout);
    assert.equal(metadata.length, 1);
    const archive = gunzipSync(
      fs.readFileSync(
        path.join(fixtureRoot, path.basename(metadata[0].filename)),
      ),
    );
    const isolatedPackage = path.join(
      fixtureRoot,
      "node_modules/@chainlesschain/session-core",
    );
    // Only the public entry points' declared dependency closure is installed.
    // Loading index.js, a CLI module, or any optional native driver must fail.
    for (const file of [
      "package.json",
      "lib/scheduler-contract.js",
      "lib/scheduler-service.js",
      "lib/scheduler-runtime.js",
      "lib/scheduler-authority-resolver.js",
      "lib/scheduler-store.js",
      "lib/scheduler-source-path.js",
      "lib/private-storage.js",
      "lib/host-storage-environment.js",
      "lib/goal-contract.js",
      "lib/goal-repository.js",
      "lib/project-goal-service.js",
      "lib/project-goal-monitoring.js",
      "lib/goal-usage-ledger.js",
      "lib/project-goal-workflow.js",
      "lib/task-description-action-service.js",
      "lib/approval-gate.js",
      "lib/project-risk-review-service.js",
      "lib/project-risk-evaluation.js",
      "lib/business-object-contract.js",
    ]) {
      const destination = path.join(isolatedPackage, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, tarEntry(archive, `package/${file}`));
    }
    for (const name of ["contract", "service", "authority-resolver"]) {
      fs.copyFileSync(
        path.join(cliKernel, `${name}.js`),
        path.join(fixtureRoot, `${name}.mjs`),
      );
    }
    const probe = `
const assert = require("node:assert/strict");
const contract = require("@chainlesschain/session-core/scheduler-contract");
const service = require("@chainlesschain/session-core/scheduler-service");
const goalContract = require("@chainlesschain/session-core/goal-contract");
const { GoalRepository } = require("@chainlesschain/session-core/goal-repository");
const { PersonalProjectGoalService } = require("@chainlesschain/session-core/project-goal-service");
const { openSchedulerStore } = require("@chainlesschain/session-core/scheduler-store");
const { SchedulerRuntime } = require("@chainlesschain/session-core/scheduler-runtime");
const authority = require("@chainlesschain/session-core/scheduler-authority-resolver");
const monitoring = require("@chainlesschain/session-core/project-goal-monitoring");
const workflow = require("@chainlesschain/session-core/project-goal-workflow");
const privateStorage = require("@chainlesschain/session-core/private-storage");
(async () => {
  assert.equal((await import("@chainlesschain/session-core/goal-repository")).GoalRepository, GoalRepository);
  const goal = goalContract.createGoalRecord({ id: "g1", storeId: "store-one", objective: "Review risk", createdAt: "2026-10-07T00:00:00.000Z" });
  assert.equal(goal.controlGeneration, 0);
  assert.equal(goal.completion, null);
  assert.throws(() => new PersonalProjectGoalService({ db: {}, getActor: () => "did:owner" }),
    (error) => error.code === "GOAL_NATIVE_DATABASE_REQUIRED");
  let opens = 0;
  assert.throws(() => openSchedulerStore({file: "kernel.sqlite", Database: class {constructor(){opens++;}}, protectStorage:()=>false}),
    (error) => error instanceof contract.SchedulerKernelError && error.code === "SCHEDULER_INVALID_ARGUMENT");
  assert.equal(opens, 0);
  assert.throws(() => new SchedulerRuntime({store:Object.fromEntries(["claimNext","claimOccurrence","getJob","getOccurrence","renew","settle"].map(name=>[name,()=>null])),authorize:()=>({allowed:true})}),
    (error) => error.code === "SCHEDULER_RUNTIME_GRAPH_AUTHORITY_REQUIRED");
  assert.equal(typeof privateStorage.ensurePrivateDirectory,"function");
  const cliContract = await import("./contract.mjs");
  const cliService = await import("./service.mjs");
  const cliAuthority = await import("./authority-resolver.mjs");
  assert.equal(cliAuthority.createSchedulerAuthorityResolver, authority.createSchedulerAuthorityResolver);
  assert.equal((await import("@chainlesschain/session-core/project-goal-monitoring")).ProjectGoalMonitoringEngine, monitoring.ProjectGoalMonitoringEngine);
  assert.equal((await import("@chainlesschain/session-core/project-goal-workflow")).ProjectGoalWorkflow, workflow.ProjectGoalWorkflow);
  assert.throws(() => new monitoring.ProjectGoalMonitoringState({db:{},getActor:()=>"did:owner"}), (error) => error.code==="GOAL_NATIVE_DATABASE_REQUIRED");
  assert.equal(cliContract.SchedulerKernelError, contract.SchedulerKernelError);
  assert.equal(cliService.SchedulerService, service.SchedulerService);
  for (const [key, value] of Object.entries(contract)) assert.equal(cliContract[key], value);
  for (const [key, value] of Object.entries(service)) assert.equal(cliService[key], value);
  let runs = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const instance = service.createSchedulerService({
    drivers: [
      { name: "risk", run: async () => { runs++; await pending; return { checked: true }; }, close: () => calls.push("driver") },
      { name: "denied", run: () => { throw contract.invalidArgument("denied"); } },
    ],
    dispose: () => calls.push("store"),
  });
  const first = instance.runOnce();
  assert.equal(first, instance.runOnce());
  const closed = instance.close();
  assert.deepEqual(calls, []);
  release();
  const result = await first;
  await closed;
  assert.equal(runs, 1);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.results[0].value, { checked: true });
  assert.equal(result.results[1].error.code, "SCHEDULER_INVALID_ARGUMENT");
  assert.deepEqual(calls, ["driver", "store"]);
  await assert.rejects(instance.runOnce(), (error) =>
    error instanceof cliContract.SchedulerKernelError && error.code === "SCHEDULER_SERVICE_CLOSED");
  assert.equal(Object.keys(require.cache).some((file) => /[\\\\/]cli[\\\\/]/.test(file)), false);
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;
    const executed = spawnSync(
      process.execPath,
      ["--input-type=commonjs", "-e", probe],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      },
    );
    assert.equal(
      executed.status,
      0,
      executed.error?.message || executed.stderr,
    );
  } finally {
    if (path.dirname(path.resolve(fixtureRoot)) === temporaryBase) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});
