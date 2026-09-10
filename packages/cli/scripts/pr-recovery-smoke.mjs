#!/usr/bin/env node
// Exercise the source or installed CLI runtime without contacting GitHub.
// Usage: node scripts/pr-recovery-smoke.mjs [absolute-cli-package-directory]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.argv[2] || fileURLToPath(new URL("..", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "cc-pr-recovery-smoke-"));
// Match the test suite's isolated transaction store, keeping real user state
// and concurrent IDE sessions out of this deterministic fixture.
const previousTransactionHome = process.env.CC_PLUGIN_TRANSACTION_HOME;
process.env.CC_PLUGIN_TRANSACTION_HOME = join(cwd, "plugin-transactions");
const broker = (
  await import(
    pathToFileURL(resolve(root, "src/lib/process-execution-broker/index.js"))
  )
).default;
const originalExec = broker.execSync;
const originalSpawn = broker.spawnSync;
const originalExecFile = broker.execFile;
let execute;
const observed = [];
function mockCommand(command) {
  if (!/^gh pr |^gh api |^git branch /.test(command)) return null;
  observed.push(command);
  return execute(command);
}
broker.execSync = function (command, ...args) {
  const result = mockCommand(command);
  if (!result) return originalExec.call(this, command, ...args);
  if (result.status !== 0)
    throw Object.assign(new Error("fixture command failed"), result);
  return result.stdout;
};
broker.spawnSync = function (file, args, options) {
  const command = args?.find((arg) =>
    /^gh pr |^gh api |^git branch /.test(arg),
  );
  if (command) return mockCommand(command);
  return originalSpawn.call(this, file, args, options);
};
broker.execFile = function (file, args, options, callback) {
  const command = /^gh pr |^gh api |^git branch /.test(file)
    ? file
    : args?.find((arg) => /^gh pr |^gh api |^git branch /.test(arg));
  if (!command)
    return originalExecFile.call(this, file, args, options, callback);
  const result = mockCommand(command);
  queueMicrotask(() =>
    callback(
      result.status === 0
        ? null
        : Object.assign(new Error("fixture command failed"), result),
      result.stdout,
      result.stderr,
    ),
  );
  return {};
};
const { agentLoop } = await import(
  pathToFileURL(resolve(root, "src/runtime/agent-core.js"))
);
const base = {
  cwd,
  nonBlockingShell: true,
  contextMemorySkipPlanning: true,
  autoMicroCompact: false,
  approvalGate: {
    decide: async () => ({
      decision: "allow",
      via: "smoke-fixture",
      policy: "autopilot",
    }),
  },
  _autoCompactor: {
    shouldAutoCompact: (messages) => messages.length > 4,
    compress: async (messages) => ({
      messages: [messages[0]],
      stats: {
        originalMessages: messages.length,
        compressedMessages: 1,
        saved: 1,
      },
    }),
  },
};
function tool(command, turn) {
  return {
    message: {
      role: "assistant",
      tool_calls: [
        {
          id: `call-${turn}`,
          type: "function",
          function: {
            name: "run_shell",
            arguments: JSON.stringify({ command }),
          },
        },
      ],
    },
  };
}
async function run(chatFn, task) {
  const events = [];
  try {
    for await (const event of agentLoop([{ role: "user", content: task }], {
      ...base,
      chatFn,
    }))
      events.push(event);
    return { events };
  } catch (error) {
    return { events, error };
  }
}

try {
  let state = "OPEN";
  execute = (command) => {
    let output;
    if (command.startsWith("gh pr list"))
      output = [{ number: 340, title: "Handled change", state }];
    else if (command.startsWith("gh api"))
      output = { status: "behind", ahead_by: 0 };
    else if (command.startsWith("gh pr close 340")) {
      state = "CLOSED";
      output = { number: 340, state };
    } else if (command.startsWith("gh pr view 340"))
      output = {
        number: 340,
        title: "Handled change",
        state,
        headRefOid: "head",
        baseRefOid: "base",
      };
    else throw new Error(`Unexpected fixture command: ${command}`);
    return { status: 0, stdout: JSON.stringify(output), stderr: "" };
  };
  const commands = [
    "gh pr list --repo fixture/repo --json number,title,state",
    "gh pr view 340 --repo fixture/repo --json number,title,state,headRefOid,baseRefOid",
    "gh api repos/fixture/repo/compare/base...head",
    "gh pr close 340 --repo fixture/repo",
    "gh pr view 340 --repo fixture/repo --json number,title,state",
  ];
  let calls = 0;
  const completed = await run(async (context) => {
    calls++;
    assert(calls <= 6);
    if (calls === 2)
      assert(
        context.some(
          (message) =>
            message.role === "system" &&
            message.content?.includes("already authorized closing handled PRs"),
        ),
      );
    if (calls <= commands.length) return tool(commands[calls - 1], calls);
    assert(JSON.stringify(context).includes("CLOSED"));
    return {
      message: {
        role: "assistant",
        content: "PR 340 handled; closed state verified.",
      },
    };
  }, "Review the PRs and close already-handled changes, then verify their state.");
  if (completed.error) {
    console.error(
      JSON.stringify(
        {
          state,
          observed,
          tools: completed.events.filter(
            (event) => event.type === "tool-result",
          ),
        },
        null,
        2,
      ),
    );
  }
  assert.ifError(completed.error);
  assert.equal(state, "CLOSED");
  assert.deepEqual(observed, commands);
  assert(completed.events.some((event) => event.type === "response-complete"));

  calls = 0;
  execute = () => ({
    status: 0,
    stdout: '{"number":340,"title":"unchanged"}',
    stderr: "",
  });
  const repeated = await run(async (context) => {
    assert(++calls < 10);
    if (calls === 5)
      assert(JSON.stringify(context).includes("Remote-read loop recovery"));
    return tool(commands[1], calls);
  }, "Resolve PR 340");
  assert.equal(repeated.error?.code, "CC_AGENT_REPEATED_REMOTE_READ");
  assert.equal(calls, 7);
  assert(!repeated.events.some((event) => event.type === "response-complete"));

  calls = 0;
  const beforePolicy = observed.length;
  const denied = await run(async (context) => {
    assert(++calls < 10);
    if (calls === 4)
      assert(JSON.stringify(context).includes("Tool-policy loop recovery"));
    return tool(`git branch -r --contains commit-${calls} 2>&1`, calls);
  }, "Inspect PR commits");
  assert.equal(denied.error?.code, "CC_AGENT_REPEATED_REMOTE_READ");
  assert.equal(calls, 6);
  assert.equal(
    observed.length,
    beforePolicy,
    "policy-rejected commands must not execute",
  );
  console.log(
    JSON.stringify(
      {
        runtime: root,
        passed: [
          "authorized PR close and state verification",
          "unchanged PR loop exits after recovery",
          "changing git arguments cannot repeat the same policy rejection",
        ],
        githubRequests: 0,
      },
      null,
      2,
    ),
  );
} finally {
  broker.execSync = originalExec;
  broker.spawnSync = originalSpawn;
  broker.execFile = originalExecFile;
  if (previousTransactionHome === undefined)
    delete process.env.CC_PLUGIN_TRANSACTION_HOME;
  else process.env.CC_PLUGIN_TRANSACTION_HOME = previousTransactionHome;
  rmSync(cwd, { recursive: true, force: true });
}
