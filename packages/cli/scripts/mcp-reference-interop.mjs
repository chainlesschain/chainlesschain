#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, fork, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MCPClient } from "../src/harness/mcp-client.js";
import { terminateOwnedProcessTree } from "../src/lib/process-tree-termination.js";

export const REFERENCE_VERSION = "2026.8.31";
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function bounded(promise, ms = 30_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("MCP interoperability probe timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runStdioReferenceInterop(root, minimalEnv) {
  // A fresh home keeps trust/lifecycle state out of the user's real profile.
  // Retain it on failure for diagnosis; no tokens or provider config are copied.
  const isolatedHome = mkdtempSync(join(tmpdir(), "cc-mcp-reference-"));
  const child = fork(
    fileURLToPath(new URL("./mcp-reference-stdio-worker.mjs", import.meta.url)),
    [root],
    {
      env: {
        ...minimalEnv,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        APPDATA: isolatedHome,
        LOCALAPPDATA: isolatedHome,
        XDG_CONFIG_HOME: isolatedHome,
        XDG_STATE_HOME: isolatedHome,
        CC_MCP_EXECUTABLE_TRUST: "1",
        CC_MCP_EXECUTABLE_TRUST_STORE: join(isolatedHome, "trust.json"),
        CC_MCP_EXECUTABLE_TRUST_WITNESS: join(isolatedHome, "witness.json"),
      },
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const closed = new Promise((yes) =>
    child.once("exit", (code, signal) => yes({ code, signal })),
  );
  try {
    const result = await bounded(
      new Promise((yes, no) => {
        child.once("message", yes);
        child.once("error", no);
        child.once("exit", () =>
          no(new Error(`stdio probe exited before report: ${stderr}`)),
        );
      }),
      75000,
    );
    const exit = await bounded(closed, 10000);
    assert.equal(result.status, "passed", `${result.stage}: ${result.error}`);
    assert.equal(exit.code, 0, stderr);
    assert.equal(exit.signal, null);
    return { ...result, workerExit: exit };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const cleanup = await terminateOwnedProcessTree(child, {
        spawnSync,
        graceMs: 100,
        cleanupTimeoutMs: 5000,
      });
      assert.ok(
        cleanup.confirmed,
        "stdio probe process tree cleanup not confirmed",
      );
      await bounded(closed, 10000);
    }
  }
}

export async function runReferenceInterop({ serverRoot }) {
  const root = resolve(serverRoot);
  const bytes = readFileSync(join(root, "package.json"));
  const metadata = JSON.parse(bytes);
  assert.equal(metadata.name, "@modelcontextprotocol/server-everything");
  assert.equal(metadata.version, REFERENCE_VERSION);
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"])
    if (process.env[key]) env[key] = process.env[key];
  const child = fork(
    fileURLToPath(
      new URL("./mcp-reference-server-worker.mjs", import.meta.url),
    ),
    [root],
    {
      env,
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  let serverError = "";
  child.stderr.on("data", (chunk) => {
    serverError = (serverError + chunk.toString()).slice(-2000);
  });
  // This worker creates no descendants. Its exit is the shutdown fence;
  // Windows IPC disconnect can leave the aggregate stdio close event pending.
  const closed = new Promise((yes) =>
    child.once("exit", (code, signal) => yes({ code, signal })),
  );
  const client = new MCPClient();
  let proxy;
  let report;
  let stage = "reference-process-start",
    failed = null;
  let inject = false,
    forwardedTools = 0,
    initializations = 0,
    injectedFailures = 0;
  const getStreams = [];
  let resolveGetReady;
  const getReady = new Promise((yes) => {
    resolveGetReady = yes;
  });
  try {
    const { port, sdkVersion } = await bounded(
      new Promise((yes, no) => {
        child.once("message", yes);
        child.once("error", no);
        child.once("exit", () =>
          no(new Error("Reference server exited before readiness")),
        );
      }),
    );
    assert.equal(sdkVersion, "1.32.0");
    proxy = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const upstreamAbort = new AbortController();
      res.once("close", () => upstreamAbort.abort());
      try {
        const message = body.length ? JSON.parse(body) : {};
        if (message.method === "tools/call") forwardedTools++;
        if (message.method === "initialize") initializations++;
        const headers = { ...req.headers };
        delete headers.host;
        delete headers.connection;
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: req.method,
          headers,
          ...(body.length ? { body } : {}),
          signal:
            req.method === "GET"
              ? upstreamAbort.signal
              : AbortSignal.any([
                  upstreamAbort.signal,
                  AbortSignal.timeout(15_000),
                ]),
        });
        if (inject && message.method === "tools/call") {
          // Wait for a genuine tool terminal before hiding it. SSE transports
          // may retain the stream for resumability after that terminal.
          const reader = response.body.getReader();
          let pending = "",
            terminal = false;
          try {
            while (!terminal) {
              const { done, value } = await reader.read();
              if (done) break;
              pending += Buffer.from(value).toString("utf8");
              assert.ok(pending.length < 1024 * 1024);
              for (const line of pending.split(/\r?\n/)) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const event = JSON.parse(line.slice(6));
                  terminal ||=
                    event.id === message.id && Object.hasOwn(event, "result");
                } catch {}
              }
            }
          } finally {
            await reader.cancel();
          }
          assert.ok(terminal, "injected failure requires a real tool result");
          inject = false;
          injectedFailures++;
          res.writeHead(404).end();
          return;
        }
        res.writeHead(
          response.status,
          Object.fromEntries(
            [...response.headers].filter(
              ([name]) =>
                ![
                  "transfer-encoding",
                  "connection",
                  "content-encoding",
                ].includes(name),
            ),
          ),
        );
        let getStream;
        if (req.method === "GET") {
          getStream = {
            status: response.status,
            contentType: response.headers.get("content-type"),
            sessionIdSha256: sha(String(req.headers["mcp-session-id"] || "")),
            chunks: [],
            bytes: 0,
          };
          getStreams.push(getStream);
          res.flushHeaders();
          resolveGetReady(getStream);
        }
        if (!response.body) {
          res.end();
          return;
        }
        const stream = Readable.fromWeb(response.body);
        if (getStream)
          stream.on("data", (chunk) => {
            getStream.bytes += chunk.length;
            if (getStream.bytes > 64 * 1024) {
              stream.destroy(
                new Error(
                  "Reference GET/SSE evidence exceeded its byte budget",
                ),
              );
              return;
            }
            getStream.chunks.push(Buffer.from(chunk));
          });
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      } catch {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    });
    await new Promise((yes) => proxy.listen(0, "127.0.0.1", yes));
    stage = "initialize-and-discover";
    await bounded(
      client.connect("reference", {
        transport: "http",
        url: `http://127.0.0.1:${proxy.address().port}/mcp`,
      }),
    );
    stage = "tool";
    const first = await bounded(
      client.callTool("reference", "echo", {
        message: "real-reference-round-trip",
      }),
    );
    assert.equal(first.content[0].text, "Echo: real-reference-round-trip");
    stage = "prompt";
    const prompt = await bounded(
      client.getPrompt("reference", "simple-prompt"),
    );
    assert.ok(prompt.messages.length > 0);
    stage = "resource";
    const resource = await bounded(
      client.readResource("reference", "demo://resource/dynamic/text/1"),
    );
    assert.ok(resource.contents.length > 0);
    stage = "lost-tool-response-recovery";
    inject = true;
    await assert.rejects(
      bounded(
        client.callTool("reference", "echo", {
          message: "completed-but-response-lost",
        }),
      ),
      {
        code: "CC_MCP_HTTP_TOOL_OUTCOME_UNKNOWN",
        outcomeUnknown: true,
        connectionRecovered: true,
      },
    );
    assert.equal(forwardedTools, 2, "unknown tool outcome was replayed");
    assert.equal(initializations, 2);
    const next = await bounded(
      client.callTool("reference", "echo", { message: "explicit-next-call" }),
    );
    assert.equal(next.content[0].text, "Echo: explicit-next-call");
    assert.equal(forwardedTools, 3);
    stage = "get-sse-resource-push";
    // The public interactive-host route enables the production GET/SSE reader.
    // No elicitation/sampling tool is invoked and no model/account is involved.
    client.setElicitationHandler(async () => ({ action: "decline" }));
    const getStream = await bounded(getReady, 10000);
    assert.equal(getStream.status, 200);
    assert.match(getStream.contentType, /^text\/event-stream\b/iu);
    const uri = "demo://resource/dynamic/text/1";
    const updates = [];
    let toolResponseReturned = false;
    let triggerStartedAt;
    let resolvePeriodicUpdate;
    const periodicUpdate = new Promise((yes) => {
      resolvePeriodicUpdate = yes;
    });
    const observeUpdate = (event) => {
      if (event.server !== "reference" || event.uri !== uri) return;
      const elapsedMs = performance.now() - triggerStartedAt;
      updates.push({
        server: event.server,
        uri: event.uri,
        elapsedMs,
        afterToolResponse: toolResponseReturned,
      });
      // The reference tool sends immediately, then every five seconds. Require
      // the later event after its POST terminal, not merely the immediate one.
      if (updates.length >= 2 && toolResponseReturned && elapsedMs >= 4500)
        resolvePeriodicUpdate(updates.at(-1));
    };
    client.on("resource-updated", observeUpdate);
    let serverPush;
    try {
      await bounded(client.subscribeResource("reference", uri));
      triggerStartedAt = performance.now();
      const started = await bounded(
        client.callTool("reference", "toggle-subscriber-updates", {}),
      );
      assert.ok(
        started.content.some(
          (part) =>
            part.type === "text" &&
            part.text.startsWith(
              "Started simulated resource updated notifications",
            ),
        ),
      );
      toolResponseReturned = true;
      const periodic = await bounded(periodicUpdate, 12000);
      // These are the unmodified official SDK frames observed on GET, separate
      // from the client's emitted event and from every POST response body.
      const frames = Buffer.concat(getStream.chunks)
        .toString("utf8")
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)))
        .filter(
          (event) =>
            event.method === "notifications/resources/updated" &&
            event.params?.uri === uri,
        );
      assert.ok(
        frames.length >= 2,
        "periodic update did not traverse the real GET/SSE stream",
      );
      assert.ok(
        frames.every(
          (frame) => frame.jsonrpc === "2.0" && !Object.hasOwn(frame, "id"),
        ),
      );
      await bounded(client.unsubscribeResource("reference", uri));
      const stopped = await bounded(
        client.callTool("reference", "toggle-subscriber-updates", {}),
      );
      assert.ok(
        stopped.content.some(
          (part) =>
            part.type === "text" &&
            part.text.startsWith("Stopped simulated resource updates"),
        ),
      );
      serverPush = {
        transport: "GET text/event-stream",
        trigger: "official resources/subscribe + toggle-subscriber-updates",
        upstreamBehavior:
          "official server's simulated resource update timer; no copied server implementation",
        uri,
        getStatus: getStream.status,
        sessionIdSha256: getStream.sessionIdSha256,
        wireNotifications: frames,
        clientNotifications: updates.length,
        periodicAfterToolResponse: periodic.afterToolResponse,
        periodicElapsedMs: periodic.elapsedMs,
        unsubscribeCompleted: true,
        updateTimerStopped: true,
      };
    } finally {
      client.off("resource-updated", observeUpdate);
    }
    assert.equal(
      forwardedTools,
      5,
      "push trigger/stop tools must each run exactly once",
    );
    assert.equal(getStreams.length, 1, "GET/SSE push unexpectedly reconnected");
    report = {
      schema: "chainlesschain.mcp-reference-interop/v1",
      status: "passed",
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      upstream: {
        name: metadata.name,
        version: metadata.version,
        sdkVersion,
        packageJsonSha256: sha(bytes),
        serverEntrySha256: sha(
          readFileSync(join(root, "dist/server/index.js")),
        ),
        subscriptionImplementationSha256: sha(
          readFileSync(join(root, "dist/resources/subscriptions.js")),
        ),
        pushTriggerToolSha256: sha(
          readFileSync(join(root, "dist/tools/toggle-subscriber-updates.js")),
        ),
      },
      realServerProcess: true,
      transport: "official-sdk-streamable-http-with-loopback-test-host",
      fault: "proxy-injected HTTP 404 after a real server tool response",
      serverPushAssessed: true,
      serverPush,
      stdioAssessed: false,
      externalAccountAssessed: false,
      checks: {
        tool: true,
        prompt: true,
        resource: true,
        connectionRecovered: true,
        unknownOutcomePreserved: true,
        automaticToolReplays: 0,
        forwardedTools,
        initializations,
        injectedFailures,
      },
    };
  } catch (error) {
    error.probeStage = stage;
    error.serverError = serverError;
    failed = error;
    error.message = `${stage}: ${error.message}`;
  } finally {
    try {
      await bounded(client.disconnectAll(), 5000);
    } catch (error) {
      if (!failed) {
        error.probeStage = "disconnect";
        failed = error;
      }
    } finally {
      if (proxy) {
        proxy.closeAllConnections();
        await new Promise((yes) => proxy.close(yes));
      }
      if (child.connected) child.disconnect();
      try {
        await bounded(closed, 5000);
      } catch {
        child.kill();
        await bounded(closed, 5000);
      }
    }
  }
  if (failed) throw failed;
  try {
    report.stdio = await runStdioReferenceInterop(root, env);
    report.stdioAssessed = true;
  } catch (error) {
    error.probeStage ||= "stdio-reference-process";
    throw error;
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    assert.ok(
      ["--server-root", "--output"].includes(process.argv[i]) &&
        process.argv[i + 1],
    );
    options[process.argv[i]] = process.argv[i + 1];
  }
  let report;
  try {
    report = await runReferenceInterop({
      serverRoot: options["--server-root"],
    });
  } catch (error) {
    report = {
      schema: "chainlesschain.mcp-reference-interop/v1",
      status: "failed",
      stage: error.probeStage || "preflight",
      error: String(error.message).slice(0, 500),
    };
    process.exitCode = 1;
  }
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  report.source = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    clean: !execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: repo, encoding: "utf8", windowsHide: true },
    ).trim(),
    files: Object.fromEntries(
      [
        "../src/harness/mcp-client.js",
        "./mcp-reference-interop.mjs",
        "./mcp-reference-server-worker.mjs",
        "./mcp-reference-stdio-worker.mjs",
      ].map((name) => [
        name,
        sha(readFileSync(new URL(name, import.meta.url))),
      ]),
    ),
  };
  if (options["--output"])
    writeFileSync(options["--output"], `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
