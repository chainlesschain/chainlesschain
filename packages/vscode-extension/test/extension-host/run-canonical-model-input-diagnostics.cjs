"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const {
  resolveConfiguredRuntime,
  runConfiguredVsCodeCommand,
} = require("./configured-runtime.cjs");
const {
  validateSessionConfig,
  createCanonicalReadCli,
} = require("./canonical-model-input-contract.cjs");
const { runCliResult } = require("../../src/chat/introspect-commands.js");

async function main() {
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        "vscode-executable",
        "vscode-version",
        "vsix",
        "session-config",
        "artifact-dir",
      ].map((key) => [key, { type: "string" }]),
    ),
  });
  for (const key of [
    "vscode-executable",
    "vscode-version",
    "vsix",
    "session-config",
    "artifact-dir",
  ])
    assert.ok(values[key], `--${key} is required`);
  const runtime = resolveConfiguredRuntime(
    values["vscode-executable"],
    values["vscode-version"],
  );
  const config = validateSessionConfig(
    JSON.parse(fs.readFileSync(values["session-config"], "utf8")),
  );
  const root = path.resolve(values["artifact-dir"]);
  assert.equal(
    fs.existsSync(root),
    false,
    "Native diagnostic output must be new",
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const sha256 = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  assert.equal(
    sha256(fs.readFileSync(config.journalPath)),
    config.expectedJournalDigest,
  );
  const profile = path.join(root, "profile"),
    extensions = path.join(root, "extensions");
  fs.mkdirSync(path.join(profile, "User"), { recursive: true });
  fs.mkdirSync(extensions);
  const tracePath = path.join(root, "private-cli-reads.jsonl");
  const cli = path.resolve(__dirname, "../../../cli/bin/chainlesschain.js");
  assert.ok(fs.statSync(cli).isFile());
  const readCli = createCanonicalReadCli({
    directory: path.join(root, "read-only-cli"),
    node: process.execPath,
    cli,
    sessionId: config.sessionId,
    tracePath,
  });
  fs.writeFileSync(
    path.join(profile, "User/settings.json"),
    JSON.stringify(
      {
        "chainlesschain.cli.path": readCli.command,
        "chainlesschain.ide.enabled": false,
        "chainlesschain.cli.managed.enabled": false,
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "workbench.startupEditor": "none",
      },
      null,
      2,
    ) + "\n",
  );
  const env = {
    ...process.env,
    CHAINLESSCHAIN_HOME: config.sessionHome,
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: config.securityAnchorHome,
    CC_MCP_TASK_AUTOWAKE: "0",
  };
  for (const key of Object.keys(env))
    if (
      /API_KEY|TOKEN|SECRET|AUTH|NODE_OPTIONS|ELECTRON_RUN_AS_NODE|VSCODE_IPC_HOOK_CLI/i.test(
        key,
      )
    )
      env[key] = undefined;
  const read = await runCliResult({
    command: readCli.command,
    cwd: config.workspaceDir,
    env,
    args: [
      "session",
      "show",
      config.sessionId,
      "--json",
      "--model-inputs",
      "--limit",
      "50",
    ],
    strictUtf8: true,
    maxBufferBytes: 8 * 1024 * 1024,
  });
  assert.equal(read.ok, true, "Real canonical CLI preflight failed");
  const report = JSON.parse(read.stdout);
  assert.ok(
    report.records?.length >= 2,
    "Canonical session needs real request diagnostics",
  );
  const reportPath = path.join(root, "private-model-input-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const sessionConfig = path.join(root, "private-session-config.json");
  fs.writeFileSync(sessionConfig, JSON.stringify(config, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const vsix = path.resolve(values.vsix);
  const installed = await runConfiguredVsCodeCommand(runtime, [
    "--user-data-dir",
    profile,
    "--extensions-dir",
    extensions,
    "--install-extension",
    vsix,
    "--force",
  ]);
  assert.match(installed.stdout, /successfully installed/);
  const resultPath = path.join(root, "host-result.json");
  const { runTests } = require("@vscode/test-electron");
  await runTests({
    vscodeExecutablePath: runtime.executablePath,
    extensionDevelopmentPath: path.join(__dirname, "driver"),
    extensionTestsPath: path.join(
      __dirname,
      "driver/canonical-model-input-diagnostics.cjs",
    ),
    launchArgs: [
      config.workspaceDir,
      "--user-data-dir",
      profile,
      "--extensions-dir",
      extensions,
      "--disable-workspace-trust",
      "--disable-updates",
      "--disable-telemetry",
      "--skip-welcome",
      "--skip-release-notes",
    ],
    extensionTestsEnv: {
      ...env,
      CC_CANONICAL_MODEL_INPUT_CONFIG: sessionConfig,
      CC_CANONICAL_MODEL_INPUT_REPORT: reportPath,
      CC_CANONICAL_MODEL_INPUT_RESULT: resultPath,
      CC_CANONICAL_MODEL_INPUT_EXTENSIONS: extensions,
      CC_CANONICAL_MODEL_INPUT_HOST_VERSION: runtime.receipt.version,
    },
  });
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(result.status, "passed");
  assert.equal(
    sha256(fs.readFileSync(config.journalPath)),
    config.expectedJournalDigest,
  );
  const reads = fs
    .readFileSync(tracePath, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(
    reads.every((row) => row.allowed === true),
    "Unexpected CLI command was blocked",
  );
  assert.ok(
    reads.filter((row) => row.args.includes("--model-inputs")).length >= 2,
    "Registered command did not perform a second real CLI read",
  );
  fs.writeFileSync(
    path.join(root, "runtime.json"),
    JSON.stringify(
      {
        ...runtime.receipt,
        vsixSha256: sha256(fs.readFileSync(vsix)),
        actualCanonicalCli: true,
        readOnlyCliProcesses: reads.length,
        blockedCommands: 0,
        modelRequestsPermitted: false,
        journalUnchanged: true,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: result.status,
      output: root,
      records: result.recordCount,
      sourceMappingCovered: result.sourceMappingCovered,
    }),
  );
}

module.exports = { main };
if (require.main === module)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
