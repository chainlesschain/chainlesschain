// Run against an explicitly installed, unmodified official reference package.
// No model, account credential, remote network, or package installation here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const cliRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverMode = process.argv[2] === "--server";
const installation = resolve(process.argv[serverMode ? 3 : 2] || ".");
const packageRoot = join(
  installation,
  "node_modules/@modelcontextprotocol/server-everything",
);
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.equal(pkg.name, "@modelcontextprotocol/server-everything");
assert.equal(pkg.version, "2.2.1");

if (serverMode) {
  const { createApp } = await import(
    pathToFileURL(join(packageRoot, "dist/transports/streamableHttp.js"))
  );
  const { app } = createApp();
  const server = app.listen(0, "127.0.0.1");
  const methods = {},
    httpMethods = {};
  let sessionHeaders = 0;
  server.prependListener("request", (req) => {
    httpMethods[req.method] = (httpMethods[req.method] || 0) + 1;
    if (req.headers["mcp-session-id"]) sessionHeaders++;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const { method } = JSON.parse(Buffer.concat(chunks).toString());
        methods[method] = (methods[method] || 0) + 1;
      } catch {
        /* Receipt excludes payloads. SDK still validates the request. */
      }
    });
  });
  await new Promise((done) => server.once("listening", done));
  process.send({ url: `http://127.0.0.1:${server.address().port}/mcp` });
  process.on("message", () =>
    process.send({ methods, httpMethods, sessionHeaders }),
  );
} else {
  assert.equal(
    process.platform,
    "win32",
    "This acceptance uses real Windows DPAPI",
  );
  const folder = mkdtempSync(join(tmpdir(), "cc-mcp-reference-"));
  const output = resolve(process.argv[3] || folder);
  mkdirSync(output, { recursive: true });
  const env = {
    ...process.env,
    CHAINLESSCHAIN_HOME: join(folder, "home"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(folder, "security"),
  };
  delete env.CLAUDE_CONFIG_DIR;
  const children = new Set();
  const checkpoints = [];
  function child(args, ipc = false) {
    const p = spawn(process.execPath, args, {
      cwd: cliRoot,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe", ...(ipc ? ["ipc"] : [])],
    });
    children.add(p);
    // Always observe streams; server chatter never enters the public receipt.
    p.stderr.on("data", () => {});
    p.once("exit", () => children.delete(p));
    return p;
  }
  function exitOf(p) {
    return new Promise((done, reject) => {
      p.once("error", reject);
      p.once("exit", (code, signal) => done({ code, signal }));
    });
  }
  function messageOf(p) {
    return new Promise((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Reference process deadline")),
        15_000,
      );
      p.once("message", (value) => {
        clearTimeout(timer);
        done(value);
      });
      p.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  const server = child([self, "--server", installation], true);
  server.stdout.on("data", () => {});
  const serverExit = exitOf(server);
  let stats;
  try {
    const { url } = await messageOf(server);
    async function run(request) {
      const p = child([
        join(cliRoot, "__tests__/fixtures/mcp-tasks/durable-child.mjs"),
      ]);
      const exited = exitOf(p);
      const receipt = new Promise((done, reject) => {
        const timer = setTimeout(() => {
          p.kill();
          reject(new Error("Client process deadline"));
        }, 30_000);
        let stdout = "";
        p.stdout.on("data", (data) => {
          stdout += data;
          const end = stdout.indexOf("\n");
          if (end < 0) return;
          clearTimeout(timer);
          try {
            done(JSON.parse(stdout.slice(0, end)));
          } catch (error) {
            reject(error);
          }
        });
        p.once("exit", () => {
          clearTimeout(timer);
          if (!stdout.includes("\n"))
            reject(new Error("Client exited without receipt"));
        });
        p.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      p.stdin.end(
        JSON.stringify({
          url,
          serverName: "official-everything",
          protocolVersion: "2026-07-28",
          vaultFile: join(folder, "task-secrets.dpapi.json"),
          ...request,
        }) + "\n",
      );
      const result = await receipt;
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.backend, "dpapi");
      if (request.hold) p.kill("SIGKILL");
      const exit = await exited;
      if (!request.hold) assert.equal(exit.code, 0);
      checkpoints.push({
        action: request.action,
        receipt: result,
        forcedTermination: !!request.hold,
        exit,
      });
      return result.result;
    }
    const sessionId = "reference-" + randomUUID();
    const marker = "bounded synthetic independent reference " + randomUUID();
    const accepted = await run({
      sessionId,
      seed: true,
      action: "create",
      hold: true,
      toolName: "simulate-research-query",
      arguments: { topic: marker, ambiguous: false },
    });
    assert.equal(accepted.remoteStatus, "working");
    const delivered = await run({
      sessionId,
      localId: accepted.localId,
      action: "watch",
      options: { intervalMs: 200, timeoutMs: 10_000 },
    });
    assert.equal(delivered.delivered, true);
    assert.equal(delivered.duplicate, false);
    const duplicate = await run({
      sessionId,
      localId: accepted.localId,
      action: "deliver",
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.deliveryId, delivered.deliveryId);
    await run({
      sessionId,
      localId: accepted.localId,
      action: "verify-delivery",
      expectedMarker: marker,
    });
    const cancelSession = "reference-cancel-" + randomUUID();
    const pending = await run({
      sessionId: cancelSession,
      seed: true,
      action: "create",
      toolName: "simulate-research-query",
      arguments: { topic: "bounded cancellation", ambiguous: false },
    });
    const cancelled = await run({
      sessionId: cancelSession,
      localId: pending.localId,
      action: "cancel",
    });
    assert.equal(cancelled.remoteStatus, "cancelled");
    assert.equal(cancelled.delivered, false);
    const incoming = messageOf(server);
    server.send("stats");
    stats = await incoming;
    assert.equal(stats.methods["tools/call"], 2);
    assert.equal(stats.methods["tasks/cancel"], 1);
    for (const method of ["initialize", "tasks/result", "tasks/list"])
      assert.equal(stats.methods[method] || 0, 0);
    assert.equal(stats.httpMethods.GET || 0, 0);
    assert.equal(stats.httpMethods.DELETE || 0, 0);
    assert.equal(stats.sessionHeaders, 0);
    const sourceFiles = [
      "src/harness/mcp-client.js",
      "src/lib/mcp-stateless-protocol.js",
      "src/lib/mcp-tasks.js",
      "src/lib/mcp-task-runtime.js",
      "__tests__/fixtures/mcp-tasks/durable-child.mjs",
      "scripts/probe-mcp-task-reference.mjs",
    ];
    const sha = (path) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    const evidence = {
      schema: "chainlesschain.mcp-reference-task-acceptance/v1",
      at: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      server: {
        name: pkg.name,
        version: pkg.version,
        transportSha256: sha(
          join(packageRoot, "dist/transports/streamableHttp.js"),
        ),
        taskSha256: sha(join(packageRoot, "dist/server/tasks.js")),
      },
      sourceFiles: Object.fromEntries(
        sourceFiles.map((path) => [
          "packages/cli/" + path,
          sha(join(cliRoot, path)),
        ]),
      ),
      scope: {
        independentUnmodifiedReference: true,
        separateServerProcess: true,
        forcedClientTermination: true,
        osSecretStore: "windows-dpapi",
        canonicalDeliveryVerified: true,
        duplicateDeliveryIdempotent: true,
        cancellationObserved: true,
        remoteProductionService: false,
        modelContinuationVerified: false,
        expiryVerified: false,
        revocationVerified: false,
        multiplatformVerified: false,
        inputRequestsVerified: false,
        paidReady: false,
      },
      stats,
      checkpoints,
    };
    writeFileSync(
      join(output, "receipt.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    process.stdout.write(
      JSON.stringify({
        ok: true,
        output,
        stats,
        checkpoints: checkpoints.length,
      }) + "\n",
    );
  } finally {
    for (const p of children) p.kill("SIGKILL");
    await serverExit;
  }
}
