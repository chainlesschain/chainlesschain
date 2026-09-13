#!/usr/bin/env node
// Exercise the source or installed CLI runtime without contacting GitHub.
// Usage: node scripts/pr-recovery-smoke.mjs [absolute-cli-package-directory]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.argv[2] || fileURLToPath(new URL("..", import.meta.url));
const cwd = mkdtempSync(
  join(realpathSync.native(tmpdir()), "cc-pr-recovery-smoke-"),
);
// Match the test suite's isolated transaction store, keeping real user state
// and concurrent IDE sessions out of this deterministic fixture.
const environment = {
  CC_PLUGIN_TRANSACTION_HOME: join(cwd, "plugin-transactions"),
  CHAINLESSCHAIN_HOME: join(cwd, "cli-home"),
  CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(cwd, "anchors"),
};
const previousEnvironment = new Map(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, environment);
let broker;
let originalExec;
let originalSpawn;
let originalExecFile;
let providerServer;
try {
  const { createTestAgentEvolutionComposition } = await import(
    new URL(
      "../__tests__/fixtures/agent-evolution-test-deployment.js",
      import.meta.url,
    )
  );
  broker = (
    await import(
      pathToFileURL(resolve(root, "src/lib/process-execution-broker/index.js"))
    )
  ).default;
  originalExec = broker.execSync;
  originalSpawn = broker.spawnSync;
  originalExecFile = broker.execFile;
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
  // Import every branded runtime constructor from the target installation. The
  // repository fixture supplies only explicit test authorities, never a source-
  // tree composition that could bypass or mismatch the installed WeakSet owner.
  const { createAgentEvolutionRuntimeComposition } = await import(
    pathToFileURL(
      resolve(root, "src/lib/evolution/agent-evolution-runtime-composition.js"),
    )
  );
  const { PromptCompressor } = await import(
    pathToFileURL(resolve(root, "src/harness/prompt-compressor.js"))
  );
  let respond;
  let providerFailure;
  let providerRequests = 0;
  let summaryRequests = 0;
  providerServer = createServer(async (request, response) => {
    // Do not let Undici reuse a loopback socket after the server retires an
    // idle connection while durable ingress work is being persisted.
    response.setHeader("Connection", "close");
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/chat");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        assert(bytes <= 1_048_576, "fixture provider request must be bounded");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(body.model, "llama3:8b");
      assert.equal(body.stream, false);
      assert(JSON.stringify(body).includes("projectionDigest"));
      providerRequests += 1;
      let result;
      if (body.tools.length === 0) {
        summaryRequests += 1;
        result = {
          message: {
            role: "assistant",
            content: JSON.stringify({
              objective:
                "Continue the current user task using verified tool results",
              constraints: [],
              keyDecisions: [],
              changedFiles: [],
              tests: [],
              unresolvedSideEffects: [],
              checkpoints: [],
              blockers: [],
              nextSteps: [],
            }),
          },
        };
      } else result = await respond(body.messages);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ ...result, prompt_eval_count: 12, eval_count: 4 }),
      );
    } catch (error) {
      providerFailure = error;
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("local smoke provider assertion failed");
    }
  });
  providerServer.requestTimeout = 15_000;
  providerServer.headersTimeout = 15_000;
  await new Promise((resolveReady, reject) => {
    providerServer.once("error", reject);
    providerServer.listen(0, "127.0.0.1", resolveReady);
  });
  const base = {
    cwd,
    provider: "ollama",
    model: "llama3:8b",
    baseUrl: `http://127.0.0.1:${providerServer.address().port}`,
    runnableProviderFallback: false,
    nonBlockingShell: true,
    contextMemorySkipPlanning: true,
    contextMemoryEnv: {
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    },
    persistCompaction: false,
    autoMicroCompact: false,
    approvalGate: {
      decide: async () => ({
        decision: "allow",
        via: "smoke-fixture",
        policy: "autopilot",
      }),
    },
  };
  const thresholds = new PromptCompressor({
    model: base.model,
    provider: base.provider,
  });
  const historyCount = thresholds.maxMessages + 8;
  // Exceed both genuine count and token budgets without patching the compressor.
  // These are inert historical user/assistant messages, not tool evidence.
  const history = Array.from({ length: historyCount }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: Array.from(
      { length: Math.ceil((thresholds.maxTokens * 8) / historyCount / 64) },
      (_, part) =>
        createHash("sha256").update(`history-${index}-${part}`).digest("hex"),
    ).join(" "),
  }));
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
  let runSequence = 0;
  async function run(nextResponse, task, priorMessages = []) {
    const events = [];
    const runId = `pr-recovery-smoke-${++runSequence}`;
    const composition = createTestAgentEvolutionComposition(
      createAgentEvolutionRuntimeComposition,
      { runId },
      join(cwd, "evolution-state", runId),
    );
    respond = nextResponse;
    providerFailure = null;
    try {
      for await (const event of agentLoop(
        [...priorMessages, { role: "user", content: task }],
        {
          ...base,
          runId,
          evolutionIngress: composition.evolutionIngress,
          signal: AbortSignal.timeout(180_000),
        },
      ))
        events.push(event);
      assert.ifError(providerFailure);
      assert(
        composition
          .loadRun()
          .events.some((event) => event.data.evidenceKind === "model-input"),
      );
      if (events.some((event) => event.type === "response-complete")) {
        await composition.evolutionIngress.complete();
        assert.equal(composition.loadRun().projection.status, "completed");
      }
      return { events };
    } catch (error) {
      return { events, error: providerFailure || error };
    }
  }

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
    "gh pr close 340 --repo fixture/repo",
    "gh pr view 340 --repo fixture/repo --json number,title,state",
  ];
  let calls = 0;
  const completed = await run(
    async (context) => {
      calls++;
      assert(calls <= 6);
      if (calls === 2)
        assert(
          context.some(
            (message) =>
              message.role === "system" &&
              message.content?.includes("User-authorized PR closure"),
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
    },
    "Close PR #340, then verify its state.",
    history,
  );
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
  assert(
    completed.events.some(
      (event) =>
        event.type === "compaction" &&
        event.stats.saved > 0 &&
        event.stats.canonicalReceipt?.status === "committed" &&
        event.stats.originalMessages > thresholds.maxMessages &&
        event.stats.compressedMessages < event.stats.originalMessages,
    ),
    "real canonical compaction must occur while PR closure intent survives",
  );

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
  assert.equal(
    repeated.error?.code,
    "CC_AGENT_REPEATED_REMOTE_READ",
    repeated.error?.stack,
  );
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
  assert.equal(
    denied.error?.code,
    "CC_AGENT_REPEATED_REMOTE_READ",
    denied.error?.stack,
  );
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
          "explicitly authorized PR close and state verification",
          "unchanged PR loop exits after recovery",
          "changing git arguments cannot repeat the same policy rejection",
          "real canonical compaction retains the authorized PR closure task",
        ],
        providerRequests,
        summaryRequests,
        githubRequests: 0,
      },
      null,
      2,
    ),
  );
} finally {
  if (broker) {
    broker.execSync = originalExec;
    broker.spawnSync = originalSpawn;
    broker.execFile = originalExecFile;
  }
  if (providerServer?.listening) {
    providerServer.closeAllConnections();
    await new Promise((resolveClosed, reject) =>
      providerServer.close((error) =>
        error ? reject(error) : resolveClosed(),
      ),
    );
  }
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(cwd, { recursive: true, force: true });
}
