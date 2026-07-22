const { spawnSync } = require("child_process");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const cliRoot = path.join(repoRoot, "packages", "cli");
const sdkRoot = path.join(repoRoot, "packages", "agent-sdk");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  {
    name: "Desktop Coding Agent core units",
    cwd: desktopRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-session-service.test.js",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-ipc-v3.test.js",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-tool-adapter.test.js",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-permission-gate.test.js",
    ],
  },
  {
    name: "Desktop lifecycle integration",
    cwd: desktopRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "tests/integration/coding-agent-lifecycle.integration.test.js",
    ],
  },
  {
    name: "Desktop hosted tools integration",
    cwd: desktopRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "tests/integration/coding-agent-hosted-tools.integration.test.js",
    ],
  },
  {
    name: "Desktop bridge against real CLI",
    cwd: desktopRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "tests/integration/coding-agent-bridge-real-cli.test.js",
    ],
  },
  {
    name: "Renderer Coding Agent store",
    cwd: desktopRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "src/renderer/stores/__tests__/coding-agent.test.ts",
    ],
  },
  {
    name: "CLI Coding Agent runtime units",
    cwd: cliRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "__tests__/unit/agent-core.test.js",
      "__tests__/unit/message-dispatcher.test.js",
      "__tests__/unit/ws-runtime-events.test.js",
      "__tests__/unit/ws-session-manager.test.js",
      "__tests__/unit/coding-agent-contract.test.js",
      "__tests__/unit/coding-agent-policy.test.js",
      "__tests__/unit/coding-agent-managed-tool-policy.test.js",
      "__tests__/unit/coding-agent-shell-policy.test.js",
      "__tests__/unit/permission-rules.test.js",
      "__tests__/unit/permissions-command.test.js",
      "__tests__/unit/ws-server.test.js",
      "__tests__/unit/lib/runtime-convergence-compat.test.js",
      "__tests__/unit/mcp-client-elicitation.test.js",
      "__tests__/unit/agent-schedule-store.test.js",
      "__tests__/unit/agenda-command.test.js",
      "__tests__/unit/with-file-lock.test.js",
      "__tests__/unit/interaction-adapter.test.js",
      "__tests__/unit/event-runtime-store.test.js",
      "__tests__/unit/event-runtime-worker.test.js",
      "__tests__/unit/event-runtime-producer.test.js",
      "__tests__/unit/secret-store.test.js",
      "__tests__/unit/plugin-runtime-plugin-options.test.js",
      "__tests__/unit/plugin-options-command.test.js",
      "__tests__/unit/plugin-runtime-process-boundary.test.js",
      "__tests__/unit/plugin-runtime-signature.test.js",
      "__tests__/unit/plugin-runtime-policy.test.js",
      "__tests__/unit/json-schema-validate.test.js",
      "__tests__/unit/channels.test.js",
    ],
  },
  {
    name: "CLI Coding Agent envelope E2E",
    cwd: cliRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "--config",
      "vitest.e2e.config.js",
      "__tests__/e2e/coding-agent-envelope-roundtrip.test.js",
    ],
  },
  {
    name: "Agent SDK protocol fixtures",
    cwd: sdkRoot,
    command: npmCmd,
    args: [
      "run",
      "test",
      "--",
      "__tests__/protocol.test.ts",
      "__tests__/protocol-fixtures.test.ts",
      "__tests__/agent-session.test.ts",
    ],
  },
  {
    name: "CLI reference documentation drift check",
    cwd: cliRoot,
    command: npmCmd,
    args: ["run", "docs:cli-reference:check"],
  },
  {
    name: "CLI protocol documentation drift check",
    cwd: cliRoot,
    command: npmCmd,
    args: ["run", "docs:protocol:check"],
  },
];

function formatArg(arg) {
  const value = String(arg);
  return /^[A-Za-z0-9_./:@\\=-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function formatCommand(step) {
  return [step.command, ...step.args].map(formatArg).join(" ");
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function relativeCwd(cwd) {
  return path.relative(repoRoot, cwd) || ".";
}

function printPlan() {
  console.log(`Coding Agent parity plan (${steps.length} serial steps):`);
  steps.forEach((step, index) => {
    console.log(`\n[${index + 1}/${steps.length}] ${step.name}`);
    console.log(`  cwd: ${relativeCwd(step.cwd)}`);
    console.log(`  $ ${formatCommand(step)}`);
  });
}

function printUsage() {
  console.log(
    "Usage: node scripts/verify-coding-agent-parity.js [--list|--dry-run]",
  );
  console.log("  --list, --dry-run  Print the serial command plan without running it.");
}

function printSummary(results, totalDurationMs) {
  console.log("\nCoding Agent parity summary:");
  steps.forEach((step, index) => {
    const result = results[index];
    if (!result) {
      console.log(`  SKIP  ${step.name}`);
      return;
    }
    console.log(
      `  ${result.ok ? "PASS" : "FAIL"}  ${step.name} (${formatDuration(result.durationMs)})`,
    );
  });

  const passed = results.filter((result) => result.ok).length;
  const failed = results.find((result) => !result.ok);
  console.log(
    `\nResult: ${failed ? "FAILED" : "PASSED"} — ${passed}/${steps.length} steps passed in ${formatDuration(totalDurationMs)}.`,
  );
}

function parseArgs(argv) {
  const supported = new Set(["--list", "--dry-run", "--help", "-h"]);
  const unknown = argv.filter((arg) => !supported.has(arg));
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    listOnly: argv.includes("--list") || argv.includes("--dry-run"),
    unknown,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.unknown.length > 0) {
    console.error(`Unknown option(s): ${options.unknown.join(", ")}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  if (options.listOnly) {
    printPlan();
    console.log(`\nListed ${steps.length} steps; no commands were executed.`);
    return;
  }

  printPlan();
  const suiteStartedAt = Date.now();
  const results = [];

  for (const [index, step] of steps.entries()) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`[${index + 1}/${steps.length}] RUN ${step.name}`);
    console.log(`cwd: ${relativeCwd(step.cwd)}`);
    console.log(`$ ${formatCommand(step)}`);

    const startedAt = Date.now();
    const result = spawnSync(step.command, step.args, {
      cwd: step.cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true,
    });
    const durationMs = Date.now() - startedAt;
    const ok = !result.error && result.status === 0;
    results.push({ ok, durationMs });

    if (ok) {
      console.log(`[${index + 1}/${steps.length}] PASS ${step.name}`);
      continue;
    }

    console.error(`[${index + 1}/${steps.length}] FAIL ${step.name}`);
    if (result.error) {
      console.error(`Failed to start command: ${result.error.message}`);
    } else if (result.signal) {
      console.error(`Command terminated by signal ${result.signal}.`);
    } else {
      console.error(`Command exited with status ${result.status}.`);
    }

    printSummary(results, Date.now() - suiteStartedAt);
    process.exitCode =
      Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    return;
  }

  printSummary(results, Date.now() - suiteStartedAt);
}

main();
