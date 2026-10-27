import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  selectNativeSamples,
  nativeTaskPrompt,
  nativeEnvironment,
  snapshotNativeTree,
  inspectNativeScope,
  nativeCliAdapterSource,
  nativeReviewFlags,
  inspectNativeChangeReview,
  protocolStream,
  inspectionStream,
  VERSIONS,
  archiveExtractor,
  extractNativeArchive,
  loadNativePackageSet,
  createNativeHostGuard,
} from "../scripts/verify01-native-task-campaign.mjs";

test("an unconfirmed host cleanup prevents subsequent sample work without retry", () => {
  const guard = createNativeHostGuard();
  let executions = 0;
  const sample = () => {
    guard.assertReady();
    executions++;
  };
  sample();
  guard.block("Windows identity snapshot timeout");
  for (let i = 0; i < 2; i++)
    assert.throws(sample, { code: "HOST_CLEANUP_UNCONFIRMED" });
  guard.block("secondary port failure");
  assert.equal(guard.failure, "Windows identity snapshot timeout");
  assert.equal(executions, 1);
});

test("package set selects exact complete versions and binds original manifest bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-package-set-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "versions.json");
  const versions = {
    ...VERSIONS,
    cli: "0.166.104",
    vscode: "0.37.149",
    jetbrains: "0.4.166",
  };
  const manifest = {
    schema: "chainlesschain.native-package-set/v1",
    versions,
    registryEvidence: "independent lookup",
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
  const selected = loadNativePackageSet(file);
  assert.deepEqual(selected.versions, versions);
  assert.deepEqual(selected.bytes, fs.readFileSync(file));
  assert.match(selected.packageSetDigest, /^sha256:[a-f0-9]{64}$/u);
  fs.appendFileSync(file, "\n");
  assert.notEqual(
    loadNativePackageSet(file).packageSetDigest,
    selected.packageSetDigest,
  );
  assert.deepEqual(loadNativePackageSet(), { versions: VERSIONS });
  for (const invalid of [
    { ...manifest, schema: "wrong" },
    { ...manifest, versions: { ...versions, cli: "latest" } },
    { ...manifest, versions: { ...versions, vscode: "^0.37.149" } },
    { ...manifest, versions: { ...versions, jetbrains: "0.4.x" } },
    { ...manifest, versions: { ...versions, vscodeHost: "stable" } },
    {
      ...manifest,
      versions: { ...versions, jetbrainsHost: "LATEST-EAP-SNAPSHOT" },
    },
    { ...manifest, versions: { cli: versions.cli } },
    { ...manifest, versions: { ...versions, unexpected: "1.0.0" } },
  ]) {
    fs.writeFileSync(file, JSON.stringify(invalid));
    assert.throws(() => loadNativePackageSet(file));
  }
});
import { VERIFY01_REVIEW_SPECS } from "../scripts/verify01-review-specs.mjs";
const require = createRequire(import.meta.url);
const {
  validateConfig,
} = require("../../vscode-extension/test/extension-host/verify01-run.cjs");
const plan = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
      import.meta.url,
    ),
  ),
);
const catalog = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/tasks.json",
      import.meta.url,
    ),
  ),
);
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("native archive extraction accepts absolute drive paths even under Git Bash PATH", (t) => {
  const root = temporary(t),
    source = path.join(root, "source"),
    destination = path.join(root, "destination"),
    archive = path.join(root, "frozen.tar");
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source, "fixture.txt"), "frozen bytes\n");
  const executable = archiveExtractor();
  execFileSync(executable, ["-cf", archive, "-C", source, "fixture.txt"]);
  execFileSync(executable, ["-xf", archive, "-C", destination]);
  assert.equal(
    fs.readFileSync(path.join(destination, "fixture.txt"), "utf8"),
    "frozen bytes\n",
  );
  if (process.platform === "win32") assert.ok(path.isAbsolute(executable));
});
test("native extraction preserves git archive UTF-8 paths and frozen bytes", (t) => {
  const root = temporary(t),
    source = path.join(root, "source"),
    destination = path.join(root, "destination"),
    archive = path.join(root, "frozen.tar");
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  const files = [
    "fixture.txt",
    "后端测试.txt",
    "文档/café-结果.md",
    `文档/${"长文件名".repeat(10)}.txt`,
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), `frozen bytes: ${file}\n`);
  }
  execFileSync("git", ["init", "--quiet", source]);
  execFileSync("git", ["-C", source, "-c", "core.autocrlf=false", "add", "."]);
  const tree = execFileSync("git", ["-C", source, "write-tree"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "core.autocrlf=false",
    "archive",
    "--format=tar",
    "--output",
    archive,
    tree,
  ]);
  extractNativeArchive(archive, destination);
  const actual = snapshotNativeTree(destination);
  assert.deepEqual(
    Object.keys(actual)
      .filter((file) => actual[file].type === "file")
      .sort(),
    [...files].sort(),
  );
  for (const file of files) {
    assert.deepEqual(
      fs.readFileSync(path.join(destination, file)),
      fs.readFileSync(path.join(source, file)),
    );
  }
});
test("nine native strata select exactly 36 ordinary and nine independent first samples", () => {
  const all = ["win32", "linux", "darwin"].flatMap((platform) =>
    ["cli", "vscode", "jetbrains"].flatMap((entry) =>
      selectNativeSamples(plan, platform, entry),
    ),
  );
  assert.equal(all.length, 45);
  assert.equal(new Set(all.map((s) => s.id)).size, 45);
  assert.equal(all.filter((s) => s.kind === "task").length, 36);
  for (const sample of all) {
    const task = catalog.tasks.find((t) => t.id === sample.taskId);
    const prompt = nativeTaskPrompt(
      task,
      VERIFY01_REVIEW_SPECS.find((s) => s.taskId === task.id),
      sample,
    );
    assert.ok(prompt.startsWith(task.prompt));
    assert.ok(prompt.includes(sample.id));
    assert.ok(prompt.includes(sample.stratum));
    assert.ok(!prompt.includes("nonce"));
  }
  assert.throws(() => selectNativeSamples(plan, "unknown", "cli"));
});
test("full tree diff isolates IDE metadata but rejects unrelated source and linked candidates", (t) => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, "candidate.js"), "placeholder");
  fs.writeFileSync(path.join(root, "source.js"), "unchanged");
  const before = snapshotNativeTree(root);
  fs.writeFileSync(path.join(root, "candidate.js"), "test");
  fs.mkdirSync(path.join(root, ".idea"));
  fs.writeFileSync(path.join(root, ".idea/workspace.xml"), "IDE metadata");
  const after = snapshotNativeTree(root),
    valid = inspectNativeScope(before, after, ["candidate.js"]);
  assert.equal(valid.sourceScopePassed, true);
  assert.ok(valid.metadataChanges.includes(".idea/workspace.xml"));
  fs.writeFileSync(path.join(root, "source.js"), "tampered");
  assert.equal(
    inspectNativeScope(before, snapshotNativeTree(root), ["candidate.js"])
      .sourceScopePassed,
    false,
  );
  assert.equal(
    inspectNativeScope(
      before,
      { ...after, "candidate.js": { type: "link", target: "source.js" } },
      ["candidate.js"],
    ).sourceScopePassed,
    false,
  );
  assert.equal(
    inspectNativeScope(
      before,
      { ...after, ".chainlesschain/session": { type: "file", bytes: 1 } },
      ["candidate.js"],
    ).sourceScopePassed,
    false,
  );
});
test("adapter preserves protocol identity and forces six-file tools/worklog off", (t) => {
  const root = temporary(t),
    cli = path.join(root, "cli.cjs"),
    adapter = path.join(root, "adapter.cjs");
  fs.writeFileSync(
    cli,
    "console.log(JSON.stringify({args:process.argv.slice(2),worklog:process.env.CC_TASK_WORKLOG}))",
  );
  fs.writeFileSync(adapter, nativeCliAdapterSource(cli));
  const original = [
    "agent",
    "--session-id",
    "independent-session",
    "--input-format",
    "stream-json",
  ];
  const observed = JSON.parse(
    execFileSync(process.execPath, [adapter, ...original], {
      encoding: "utf8",
      env: { ...process.env, CC_TASK_WORKLOG: "1" },
    }),
  );
  assert.deepEqual(observed.args.slice(0, original.length), original);
  assert.equal(observed.worklog, "0");
  assert.ok(observed.args.includes("--no-ide"));
  assert.ok(!observed.args.includes("--ephemeral"));
  assert.ok(!observed.args.includes("--review-changes"));
  fs.writeFileSync(
    adapter,
    nativeCliAdapterSource(cli, { reviewChanges: true }),
  );
  const reviewed = JSON.parse(
    execFileSync(process.execPath, [adapter, ...original], {
      encoding: "utf8",
    }),
  );
  assert.deepEqual(
    reviewed.args.filter((arg) => arg !== "--review-changes"),
    observed.args,
  );
  assert.equal(
    reviewed.args.filter((arg) => arg === "--review-changes").length,
    1,
  );
  const nonAgent = JSON.parse(
    execFileSync(process.execPath, [adapter, "--version"], {
      encoding: "utf8",
    }),
  );
  assert.deepEqual(nonAgent.args, ["--version"]);
});

test("native review opt-in is strict and observation requires a runtime event", () => {
  assert.deepEqual(nativeReviewFlags(), []);
  assert.deepEqual(nativeReviewFlags(false), []);
  assert.deepEqual(nativeReviewFlags(true), ["--review-changes"]);
  assert.throws(() => nativeReviewFlags("true"));
  const message = "Reviewing changed files against the task before finishing.";
  assert.deepEqual(inspectNativeChangeReview("", true), {
    requested: true,
    observed: false,
    reminderCount: 0,
    evidence: "model-stream.ndjson:iteration_warning",
    completed: null,
  });
  assert.equal(
    inspectNativeChangeReview(JSON.stringify({ type: "result", message }), true)
      .observed,
    false,
  );
  const evidence = inspectNativeChangeReview(
    JSON.stringify({ type: "iteration_warning", message }),
    true,
  );
  assert.equal(evidence.observed, true);
  assert.equal(evidence.completed, null);
  assert.throws(() => inspectNativeChangeReview("not json", true));
});

test("dispatcher review opt-in preserves legacy argv and is journal-bound", () => {
  const dispatcher = new URL(
    "../scripts/verify01-dispatch-native-retest.py",
    import.meta.url,
  );
  const script = String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location('review_dispatch', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
context = {'branch': 'review-test', 'packageSetPath': 'exact.json'}
shard = {'group': 'linux-cli', 'sampleIds': ['verify-09']}
base = m.dispatch_args(context, shard)
assert not any('review_changes' in arg for arg in base)
assert m.dispatch_args({**context, 'reviewChanges': False}, shard) == base
assert m.dispatch_args({**context, 'reviewChanges': True}, shard) == base + ['-f', 'review_changes=true']
try:
    m.dispatch_args({**context, 'reviewChanges': 'true'}, shard)
except RuntimeError:
    pass
else:
    raise AssertionError('string flag accepted')
print('review dispatcher argv passed')
`;
  const { fileURLToPath } = createRequire(import.meta.url)("node:url");
  const output = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-B", "-c", script, fileURLToPath(dispatcher)],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.match(output, /review dispatcher argv passed/);
  const source = fs.readFileSync(dispatcher, "utf8");
  assert.ok(
    source.indexOf("context['reviewChanges'] = True") <
      source.indexOf("directory = WORK / 'next-package-dispatch'"),
  );
});
test("VSCode prompt preserves full UTF8 content up to 1 MiB and first-run deadline up to 30 minutes", () => {
  const root = path.resolve(os.tmpdir(), "cc-native-config");
  const config = {
    sampleId: "first-run-linux-vscode",
    prompt: "x".repeat(1024 * 1024),
    hostVersion: VERSIONS.vscodeHost,
    extensionVersion: VERSIONS.vscode,
    provider: "volcengine",
    model: "deepseek-v4-flash-ga-260731",
    permissionMode: "acceptEdits",
    deadline: Date.now() + 1799000,
    ...Object.fromEntries(
      [
        "workspace",
        "captureDir",
        "profileHome",
        "userDataDir",
        "extensionsDir",
      ].map((name) => [name, path.join(root, name)]),
    ),
  };
  assert.equal(validateConfig(config).prompt.length, 1024 * 1024);
  assert.throws(() =>
    validateConfig({ ...config, prompt: config.prompt + "x" }),
  );
  assert.throws(() =>
    validateConfig({ ...config, prompt: "中".repeat(350000) }),
  );
  assert.throws(() =>
    validateConfig({ ...config, deadline: Date.now() + 1801000 }),
  );
});
test("failed JetBrains capture reads one raw JSONL stream and rejects ambiguous generations", (t) => {
  const root = temporary(t);
  const raw = path.join(root, "protocol-generation-one.jsonl");
  const event = { type: "result", subtype: "interrupted", is_error: false };
  const bytes =
    [
      { direction: "input", event: { type: "user", message: "task" } },
      { direction: "output", event },
      { direction: "exit", event: { code: 1, stdoutDrained: true } },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n";
  fs.writeFileSync(path.join(root, "unrelated.jsonl"), "not a protocol");
  assert.throws(
    () => protocolStream(root),
    /exactly one raw protocol generation/,
  );
  fs.writeFileSync(raw, bytes);
  assert.deepEqual(JSON.parse(protocolStream(root)), event);
  assert.equal(fs.readFileSync(raw, "utf8"), bytes);
  const other = path.join(root, "protocol-generation-two.jsonl");
  fs.writeFileSync(other, bytes);
  assert.throws(
    () => protocolStream(root),
    /exactly one raw protocol generation/,
  );
  fs.unlinkSync(other);
  const vscode = path.join(root, "generation.ndjson");
  fs.writeFileSync(vscode, bytes);
  assert.throws(
    () => protocolStream(root),
    /exactly one raw protocol generation/,
  );
  // The established consolidated capture remains authoritative when present.
  const consolidated = { type: "result", subtype: "error", is_error: true };
  fs.writeFileSync(
    path.join(root, "protocol.json"),
    JSON.stringify([{ direction: "output", event: consolidated }]),
  );
  assert.deepEqual(JSON.parse(protocolStream(root)), consolidated);
  fs.unlinkSync(path.join(root, "protocol.json"));
  fs.unlinkSync(vscode);
  fs.writeFileSync(
    raw,
    JSON.stringify({ direction: "exit", event: { code: 1 } }) + "\n",
  );
  assert.equal(protocolStream(root).trim(), "");
});

test("protocol conversion uses output only and Windows comparison leaves raw evidence unchanged", (t) => {
  const root = temporary(t);
  const event = { type: "tool_use", args: { path: "C:\\Work\\Candidate.js" } };
  fs.writeFileSync(
    path.join(root, "protocol.json"),
    JSON.stringify([
      { direction: "input", event: { type: "user" } },
      { direction: "output", event },
    ]),
  );
  const stream = protocolStream(root);
  assert.deepEqual(JSON.parse(stream), event);
  const inspected = inspectionStream(stream, "C:\\Work", "win32");
  assert.equal(inspected.workspace, "c:\\work");
  assert.equal(
    JSON.parse(inspected.stream).args.path,
    "c:\\work\\candidate.js",
  );
  assert.deepEqual(JSON.parse(stream), event);
});

test("native child storage recognizes its isolated profile and keeps ACL verification enabled", (t) => {
  const root = temporary(t);
  const profileHome = path.join(root, "home");
  const profile = path.join(profileHome, ".chainlesschain");
  fs.mkdirSync(profile, { recursive: true });
  const env = nativeEnvironment(root, profileHome, profile, []);
  const require = createRequire(import.meta.url);
  const storage = require.resolve("../../session-core/lib/private-storage.js");
  const host = require.resolve(
    "../../session-core/lib/host-storage-environment.js",
  );
  const script = `
    const storage = require(${JSON.stringify(storage)});
    const host = require(${JSON.stringify(host)});
    console.log(JSON.stringify({
      hermetic: host.isFormalQualityHermeticRuntime(),
      workingDirectory: storage._windowsAclWorkingDirectory(),
      temporaryRoot: require('node:os').tmpdir(),
      timeoutMs: storage._resolveWindowsAclTimeout(15000)
    }));`;
  const observe = (childEnv) =>
    JSON.parse(
      execFileSync(process.execPath, ["-e", script], {
        env: childEnv,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      }),
    );
  const corrected = observe(env);
  assert.equal(corrected.hermetic, true);
  assert.equal(corrected.workingDirectory, profile);
  assert.equal(path.resolve(corrected.temporaryRoot), root);
  assert.equal(
    corrected.timeoutMs,
    process.platform === "win32" ? 60000 : 15000,
  );
  // The original layout remains rejected by the unchanged product guard.
  const childTemp = path.join(root, "tmp");
  fs.mkdirSync(childTemp);
  const old = observe({
    ...env,
    TEMP: childTemp,
    TMP: childTemp,
    TMPDIR: childTemp,
  });
  assert.equal(old.hermetic, false);
  assert.equal(old.workingDirectory, null);
  const outside = observe({ ...env, CHAINLESSCHAIN_HOME: path.dirname(root) });
  assert.equal(outside.hermetic, false);
  assert.equal(outside.workingDirectory, null);
});

test(
  "Windows PowerShell KnownFolders and module cache remain outside the task workspace",
  {
    skip: process.platform !== "win32",
    timeout: 30000,
  },
  (t) => {
    const root = temporary(t);
    const workspace = path.join(root, "workspace");
    const profileHome = path.join(root, "home");
    fs.mkdirSync(workspace);
    const env = nativeEnvironment(
      root,
      profileHome,
      path.join(profileHome, ".chainlesschain"),
      [],
    );
    assert.ok(path.isAbsolute(env.PSModuleAnalysisCachePath));
    assert.ok(env.PSModuleAnalysisCachePath.startsWith(root + path.sep));
    assert.ok(!env.PSModuleAnalysisCachePath.startsWith(workspace + path.sep));
    // Exercise the real Windows PowerShell engine. Its chosen cache location
    // is authoritative even when no module happens to need a cache write.
    const script = `
    $ErrorActionPreference = 'Stop'
    $type = [System.Management.Automation.PSObject].Assembly.GetType('System.Management.Automation.AnalysisCacheData')
    $field = $type.GetField('cacheStoreLocation', [Reflection.BindingFlags]'Static,NonPublic')
    Get-Command Get-Acl | Out-Null
    [Console]::WriteLine((@{
      local = [Environment]::GetFolderPath('LocalApplicationData')
      roaming = [Environment]::GetFolderPath('ApplicationData')
      cache = [string]$field.GetValue($null)
    } | ConvertTo-Json -Compress))
  `;
    const executable = path.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const observed = JSON.parse(
      execFileSync(
        executable,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        {
          cwd: workspace,
          env,
          windowsHide: true,
          encoding: "utf8",
          timeout: 20000,
        },
      ).trim(),
    );
    const normalize = (value) => path.resolve(value).toLowerCase();
    assert.equal(
      normalize(observed.local),
      normalize(path.join(profileHome, "AppData", "Local")),
    );
    assert.equal(
      normalize(observed.roaming),
      normalize(path.join(profileHome, "AppData", "Roaming")),
    );
    assert.equal(
      normalize(observed.cache),
      normalize(env.PSModuleAnalysisCachePath),
    );
    assert.equal(fs.existsSync(path.join(workspace, "Microsoft")), false);
    assert.deepEqual(fs.readdirSync(workspace), []);
  },
);
