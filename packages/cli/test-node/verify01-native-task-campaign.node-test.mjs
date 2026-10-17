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
  protocolStream,
  inspectionStream,
  VERSIONS,
  archiveExtractor,
  extractNativeArchive,
} from "../scripts/verify01-native-task-campaign.mjs";
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
