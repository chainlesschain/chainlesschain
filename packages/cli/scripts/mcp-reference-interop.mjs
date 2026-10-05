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
      if (req.method === "GET") {
        res.writeHead(405).end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
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
          signal: AbortSignal.timeout(15_000),
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
        if (!response.body) {
          res.end();
          return;
        }
        const stream = Readable.fromWeb(response.body);
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
      },
      realServerProcess: true,
      transport: "official-sdk-streamable-http-with-loopback-test-host",
      fault: "proxy-injected HTTP 404 after a real server tool response",
      serverPushAssessed: false,
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
