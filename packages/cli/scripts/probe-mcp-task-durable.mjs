import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

if (process.platform !== "win32")
  throw new Error("This native probe currently targets Windows DPAPI");
const folder = mkdtempSync(join(tmpdir(), "cc-mcp-task-native-"));
const cliRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const worker = join(cliRoot, "__tests__/fixtures/mcp-tasks/durable-child.mjs");
const children = new Set();
const tasks = new Map();
const counts = {};
const checkpoints = [];
const scope = Object.freeze({
  osSecretStore: "windows-dpapi",
  transport: "loopback-http",
  deliveryCrashRecovery: true,
  canonicalHostResume: true,
  workerConnectsForEveryAction: true,
  offlineProductCliVerified: false,
  modelContinuationVerified: false,
});
let next = 0;
const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(405).end();
    return;
  }
  if (req.method === "DELETE") {
    res.writeHead(204).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const message = JSON.parse(Buffer.concat(chunks).toString());
  if (message.id == null) {
    res.writeHead(202).end();
    return;
  }
  counts[message.method] = (counts[message.method] || 0) + 1;
  let result;
  if (message.method === "initialize") {
    res.setHeader("Mcp-Session-Id", randomUUID());
    result = {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "native-task-fixture", version: "1" },
      capabilities: {
        tools: {},
        tasks: { requests: { tools: { call: {} } }, list: {}, cancel: {} },
      },
    };
  } else if (message.method === "tools/list") {
    result = {
      tools: [
        {
          name: "export",
          inputSchema: { type: "object" },
          execution: { taskSupport: "optional" },
        },
      ],
    };
  } else if (message.method === "tools/call") {
    const id = "native-task-" + ++next;
    const task = {
      taskId: id,
      status: "working",
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      ttl: null,
      pollInterval: 5000,
    };
    tasks.set(id, task);
    result = { task };
  } else if (message.method === "tasks/get")
    result = tasks.get(message.params.taskId);
  else if (message.method === "tasks/result") {
    const task = tasks.get(message.params.taskId);
    task.status = "completed";
    task.lastUpdatedAt = new Date().toISOString();
    result = {
      content: [{ type: "text", text: "native synthetic result" }],
      _meta: {
        "io.modelcontextprotocol/related-task": { taskId: task.taskId },
      },
    };
  } else result = {};
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = "http://127.0.0.1:" + server.address().port + "/rpc";
const env = {
  ...process.env,
  CHAINLESSCHAIN_HOME: join(folder, "home"),
  CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(folder, "security"),
};
delete env.CLAUDE_CONFIG_DIR;
function launch(request) {
  const child = spawn(process.execPath, [worker], {
    cwd: cliRoot,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "",
    stderr = "";
  const exited = new Promise((done) =>
    child.once("exit", (code, signal) => {
      children.delete(child);
      done({ code, signal });
    }),
  );
  const first = new Promise((done, reject) => {
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error("Native child deadline"));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const end = stdout.indexOf("\n");
      if (end < 0) return;
      clearTimeout(deadline);
      try {
        done(JSON.parse(stdout.slice(0, end)));
      } catch {
        reject(new Error("Native child emitted invalid JSON"));
      }
    });
    child.once("exit", () => {
      clearTimeout(deadline);
      if (!stdout.includes("\n"))
        reject(
          new Error(
            "Native child exited before receipt: " + stderr.slice(0, 300),
          ),
        );
    });
  });
  child.stdin.end(
    JSON.stringify({
      url,
      vaultFile: join(folder, "task-secrets.dpapi.json"),
      ...request,
    }) + "\n",
  );
  return { child, first, exited };
}
async function run(request) {
  const handle = launch(request);
  const receipt = await handle.first;
  const exit = await handle.exited;
  checkpoints.push({ action: request.action, receipt, exit });
  return receipt;
}
let report;
try {
  const sessionId = "native-" + randomUUID();
  const held = launch({ seed: true, sessionId, action: "create", hold: true });
  const accepted = await held.first;
  assert.equal(accepted.ok, true);
  assert.equal(accepted.backend, "dpapi");
  const localId = accepted.result.localId;
  const contender = await run({ sessionId, action: "poll", localId });
  assert.equal(contender.ok, false);
  assert.equal(contender.code, "CC_SESSION_HOST_LEASE_HELD");
  held.child.kill("SIGKILL");
  const killed = await held.exited;
  checkpoints.push({
    action: "kill-after-accepted",
    receipt: accepted,
    exit: killed,
  });
  const polled = await run({ sessionId, action: "poll", localId });
  assert.equal(polled.ok, true);
  assert.equal(polled.result.remoteStatus, "working");
  const delivered = await run({ sessionId, action: "result", localId });
  assert.equal(delivered.ok, true);
  assert.equal(delivered.result.cached, false);
  const cached = await run({ sessionId, action: "result", localId });
  assert.equal(cached.ok, true);
  assert.equal(cached.result.cached, true);

  const secondSession = "native-" + randomUUID();
  const created = await run({
    seed: true,
    sessionId: secondSession,
    action: "create",
  });
  assert.equal(created.ok, true);
  const saved = launch({
    sessionId: secondSession,
    action: "save-only",
    localId: created.result.localId,
    hold: true,
  });
  const savedReceipt = await saved.first;
  assert.equal(savedReceipt.ok, true);
  assert.equal(savedReceipt.result.phase, "result_saved");
  saved.child.kill("SIGKILL");
  const savedExit = await saved.exited;
  checkpoints.push({
    action: "kill-after-result-saved",
    receipt: savedReceipt,
    exit: savedExit,
  });
  const repaired = await run({
    sessionId: secondSession,
    action: "result",
    localId: created.result.localId,
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.result.cached, true);
  assert.equal(repaired.result.callStatus, "completed");

  // Deliver the first task, then terminate the owner after its durable receipt.
  // Every worker still initializes the loopback MCP connection: this probe does
  // not claim to exercise the product CLI's separate offline delivery path.
  const deliveryOwner = launch({
    sessionId,
    action: "deliver",
    localId,
    hold: true,
  });
  const deliveryReceipt = await deliveryOwner.first;
  assert.equal(deliveryReceipt.ok, true);
  assert.equal(deliveryReceipt.backend, "dpapi");
  assert.equal(deliveryReceipt.result.delivered, true);
  assert.equal(deliveryReceipt.result.duplicate, false);
  assert.match(deliveryReceipt.result.eventHash, /^[a-f0-9]{64}$/u);
  assert.match(deliveryReceipt.result.messageDigest, /^sha256:[a-f0-9]{64}$/u);
  deliveryOwner.child.kill("SIGKILL");
  const deliveryExit = await deliveryOwner.exited;
  assert.equal(deliveryExit.signal, "SIGKILL");
  checkpoints.push({
    action: "kill-after-delivered",
    receipt: deliveryReceipt,
    exit: deliveryExit,
  });
  const duplicateDelivery = await run({
    sessionId,
    action: "deliver",
    localId,
  });
  assert.equal(duplicateDelivery.ok, true);
  assert.equal(duplicateDelivery.result.delivered, true);
  assert.equal(duplicateDelivery.result.duplicate, true);
  assert.equal(
    duplicateDelivery.result.deliveryId,
    deliveryReceipt.result.deliveryId,
  );
  assert.equal(
    duplicateDelivery.result.eventHash,
    deliveryReceipt.result.eventHash,
  );
  assert.equal(
    duplicateDelivery.result.messageDigest,
    deliveryReceipt.result.messageDigest,
  );

  const replay = await run({ sessionId, action: "verify-delivery", localId });
  assert.equal(replay.ok, true);
  assert.equal(replay.result.eventHash, deliveryReceipt.result.eventHash);
  assert.equal(
    replay.result.messageDigest,
    deliveryReceipt.result.messageDigest,
  );
  assert.equal(replay.result.canonicalMessages, 1);
  assert.equal(replay.result.assistantReferences, 1);
  assert.equal(replay.result.userMessages, 0);
  assert.equal(replay.result.toolMessages, 0);
  assert.equal(counts["tools/call"], 2);
  assert.equal(counts["tasks/result"], 2);
  report = {
    schema: "chainlesschain.mcp-task-native-probe/v1",
    passed: true,
    platform: process.platform,
    node: process.version,
    folder,
    scope,
    counts,
    checkpoints,
  };
} catch (error) {
  report = {
    schema: "chainlesschain.mcp-task-native-probe/v1",
    passed: false,
    platform: process.platform,
    node: process.version,
    folder,
    scope,
    counts,
    checkpoints,
    error: { name: error.name, message: error.message },
  };
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
writeFileSync(
  join(folder, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
