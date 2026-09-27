#!/usr/bin/env node
// Probe-only: real pinned Codex process, synthetic loopback Responses provider.
// This never changes the production version allowlist or uses account secrets.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { CodexAppServerAdapter } from "../src/lib/codex-app-server-adapter.js";

export const PROBE_VERSION = "0.157.1";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCENARIOS = [
  "completed",
  "failed",
  "interrupted",
  "approval-cancel",
  "transport-loss",
];
const APPROVAL_COMMAND = "echo approval-probe > approval-probe-marker.txt";
const APPROVAL_ITEM_ID = "call_approval_probe";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
};

export async function bounded(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isolatedEnvironment(root, source = process.env) {
  const home = join(root, "home"),
    temp = join(root, "tmp");
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH"])
    if (source[key]) env[key] = source[key];
  return Object.assign(env, {
    CODEX_HOME: home,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
  });
}

function resolveBinary(codexJs) {
  const launcher = resolve(codexJs);
  const meta = JSON.parse(
    readFileSync(join(dirname(launcher), "../package.json"), "utf8"),
  );
  assert.equal(meta.name, "@openai/codex");
  assert.equal(meta.version, PROBE_VERSION);
  const architecture = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  const suffix = {
    linux: "unknown-linux-musl",
    darwin: "apple-darwin",
    win32: "pc-windows-msvc",
  }[process.platform];
  assert.ok(architecture && suffix, "unsupported native probe platform");
  const packageName = `@openai/codex-${process.platform}-${process.arch}`;
  const packagePath = createRequire(launcher).resolve(
    `${packageName}/package.json`,
  );
  const binary = join(
    dirname(packagePath),
    "vendor",
    `${architecture}-${suffix}`,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
  return { binary, packageName, binarySha256: sha256(readFileSync(binary)) };
}

export function officialValidators() {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: false,
  });
  const compiled = new Map(),
    counts = {},
    schemas = {},
    hashes = {};
  for (const kind of [
    "request",
    "notification",
    "server-request",
    "approval-response",
  ]) {
    const bytes = readFileSync(
      new URL(
        `../__tests__/fixtures/external-agent/codex-app-server-${PROBE_VERSION}-${kind}.schema.json`,
        import.meta.url,
      ),
    );
    schemas[kind] = JSON.parse(bytes);
    hashes[kind] = sha256(bytes);
  }
  return {
    counts,
    hashes,
    check(kind, message) {
      assert.equal(
        Object.hasOwn(message, "jsonrpc"),
        false,
        "unexpected stdio JSON-RPC header",
      );
      const key = `${kind}:${message.method || "command"}`,
        schema = schemas[kind];
      if (!compiled.has(key)) {
        const branch =
          kind === "approval-response"
            ? schema
            : schema?.oneOf.find((entry) =>
                entry.properties?.method?.enum?.includes(message.method),
              );
        assert.ok(branch, `unknown official ${key}`);
        compiled.set(
          key,
          ajv.compile({
            $schema: schema.$schema,
            definitions: schema.definitions,
            ...branch,
          }),
        );
      }
      const validate = compiled.get(key);
      assert.ok(
        validate(message),
        `invalid official ${key}: ${JSON.stringify(validate.errors)}`,
      );
      counts[key] = (counts[key] || 0) + 1;
    },
  };
}

export class ProbeClient extends EventEmitter {
  constructor(child, validators, { onApprovalRequest } = {}) {
    super();
    this.child = child;
    this.validators = validators;
    this.running = true;
    this.pending = new Map();
    this.notifications = [];
    this.approvals = [];
    this.onApprovalRequest = onApprovalRequest;
    this.sequence = 0;
    this.bytes = 0;
    this.stderrBytes = 0;
    this.buffer = "";
    this.failure = deferred();
    this.closed = deferred();
    const decoder = new StringDecoder("utf8");
    child.stdout.on("data", (chunk) => {
      try {
        this.bytes += chunk.length;
        assert.ok(this.bytes <= 4 * 1024 * 1024, "probe stdout limit exceeded");
        this.buffer += decoder.write(chunk);
        let newline;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          if (line.trim()) this.receive(JSON.parse(line));
        }
      } catch (error) {
        this.fail(error);
      }
    });
    child.stderr.on("data", (chunk) => {
      this.stderrBytes += chunk.length;
    });
    child.stdin.on("error", (error) => this.fail(error));
    child.on("error", (error) => this.fail(error));
    child.once("close", (code, signal) => {
      this.running = false;
      this.fail(new Error("Codex process closed"));
      this.closed.resolve({ code, signal });
    });
  }
  fail(error) {
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
    this.failure.reject(error);
  }
  receive(message) {
    assert.equal(Object.hasOwn(message, "jsonrpc"), false);
    if (Object.hasOwn(message, "id") && Object.hasOwn(message, "method")) {
      assert.equal(
        typeof this.onApprovalRequest,
        "function",
        "unexpected server request",
      );
      assert.equal(message.method, "item/commandExecution/requestApproval");
      this.validators.check("server-request", message);
      assert.ok(
        this.approvals.length < 16 &&
          !this.approvals.some((entry) => entry.request.id === message.id),
        "duplicate or excessive approval request",
      );
      const result = this.onApprovalRequest(message);
      this.validators.check("approval-response", result);
      assert.equal(
        result.decision,
        "cancel",
        "probe may only cancel approval requests",
      );
      const response = { id: message.id, result };
      this.approvals.push({ request: message, response });
      this.child.stdin.write(`${JSON.stringify(response)}\n`);
      return;
    }
    if (Object.hasOwn(message, "id")) {
      assert.equal(
        Object.hasOwn(message, "method"),
        false,
        "unexpected server request",
      );
      assert.notEqual(
        Object.hasOwn(message, "result"),
        Object.hasOwn(message, "error"),
        "RPC response must contain exactly one result or error",
      );
      const call = this.pending.get(message.id);
      assert.ok(call, "unexpected server request or unmatched RPC response");
      this.pending.delete(message.id);
      if (message.error)
        call.reject(new Error(`Codex RPC failed: ${message.error.code}`));
      else call.resolve(message.result);
    } else {
      this.validators.check("notification", message);
      assert.ok(
        this.notifications.length < 4096,
        "probe notification limit exceeded",
      );
      this.notifications.push(message);
      this.emit("notification", message);
    }
  }
  async request(method, params) {
    assert.ok(this.running, "Codex is not running");
    const message = { id: ++this.sequence, method, params };
    this.validators.check("request", message);
    const call = deferred();
    this.pending.set(message.id, call);
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
      return await bounded(call.promise, 15_000, `RPC ${method}`);
    } finally {
      this.pending.delete(message.id);
    }
  }
  guard(promise, label) {
    return bounded(
      Promise.race([promise, this.failure.promise]),
      30_000,
      label,
    );
  }
  async stop() {
    if (!this.running) return this.closed.promise;
    this.child.stdin.end();
    try {
      return await bounded(this.closed.promise, 3000, "Codex stdin shutdown");
    } catch {
      this.child.kill("SIGTERM");
    }
    try {
      return await bounded(this.closed.promise, 3000, "Codex SIGTERM shutdown");
    } catch {
      this.child.kill("SIGKILL");
    }
    return bounded(this.closed.promise, 3000, "Codex SIGKILL shutdown");
  }
}

export function cancelBoundApproval(request, binding, notifications) {
  assert.ok(binding, "approval arrived outside its fixture scenario");
  assert.equal(request.params.threadId, binding.threadId);
  assert.equal(resolve(request.params.cwd), resolve(binding.workspace));
  assert.equal(request.params.itemId, APPROVAL_ITEM_ID);
  assert.ok(request.params.command.includes(APPROVAL_COMMAND));
  assert.ok(request.params.availableDecisions.includes("cancel"));
  assert.ok(
    notifications.some(
      (event) =>
        event.method === "item/started" &&
        event.params.threadId === binding.threadId &&
        event.params.turnId === request.params.turnId &&
        event.params.item.id === APPROVAL_ITEM_ID &&
        event.params.item.type === "commandExecution",
    ),
    "approval lacks its observed tool identity",
  );
  return { decision: "cancel" };
}

function fixtureProvider(workspace) {
  const received = new Map(SCENARIOS.map((name) => [name, deferred()]));
  const requests = [],
    failure = deferred();
  let completeResponse;
  const send = (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const item = {
    type: "message",
    id: "msg_probe",
    role: "assistant",
    status: "completed",
    phase: "final_answer",
    content: [{ type: "output_text", text: "probe-ok", annotations: [] }],
  };
  const response = {
    id: "resp_probe",
    object: "response",
    status: "completed",
    output: [item],
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  const server = http.createServer((req, res) => {
    (async () => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      assert.equal(
        req.headers.authorization,
        undefined,
        "credential reached loopback fixture",
      );
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        assert.ok(bytes <= 1024 * 1024, "provider request limit exceeded");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(body.model, "fixture-codex");
      const matches = SCENARIOS.filter((name) =>
        JSON.stringify(body.input).includes(`fixture-${name}`),
      );
      assert.equal(matches.length, 1, "request must name exactly one scenario");
      const scenario = matches[0];
      assert.ok(
        !requests.some((entry) => entry.scenario === scenario),
        "unexpected provider retry",
      );
      requests.push({
        scenario,
        authorization: false,
        method: req.method,
        path: req.url,
      });
      if (scenario === "failed") {
        res.writeHead(400, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: {
              message: "fixture rejection",
              type: "invalid_request_error",
              code: "fixture-rejection",
            },
          }),
        );
      } else {
        res.writeHead(200, { "content-type": "text/event-stream" });
        send(res, {
          type: "response.created",
          response: { ...response, status: "in_progress", output: [] },
        });
        if (scenario === "approval-cancel") {
          const tools = (body.tools || []).flatMap((tool) =>
            tool.type === "namespace" ? tool.tools || [] : [tool],
          );
          assert.ok(
            tools.some(
              (tool) =>
                tool.type === "function" && tool.name === "exec_command",
            ),
            "pinned Codex did not advertise exec_command",
          );
          const call = {
            type: "function_call",
            id: "fc_approval_probe",
            call_id: APPROVAL_ITEM_ID,
            name: "exec_command",
            status: "completed",
            arguments: JSON.stringify({
              cmd: APPROVAL_COMMAND,
              workdir: workspace,
              login: false,
              sandbox_permissions: "require_escalated",
              justification: "Deterministic cancellation probe.",
            }),
          };
          send(res, {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...call, arguments: "", status: "in_progress" },
          });
          send(res, {
            type: "response.function_call_arguments.delta",
            item_id: call.id,
            output_index: 0,
            delta: call.arguments,
          });
          send(res, {
            type: "response.output_item.done",
            output_index: 0,
            item: call,
          });
          send(res, {
            type: "response.completed",
            response: { ...response, output: [call] },
          });
          res.end();
        } else if (scenario === "completed") {
          send(res, {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", content: [] },
          });
          send(res, {
            type: "response.content_part.added",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
          send(res, {
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: "probe-ok",
          });
          completeResponse = () => {
            send(res, {
              type: "response.output_item.done",
              output_index: 0,
              item,
            });
            send(res, { type: "response.completed", response });
            res.end();
          };
        }
      }
      received.get(scenario).resolve();
    })().catch((error) => {
      failure.reject(error);
      res.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.on("error", (error) => failure.reject(error));
  return {
    server,
    requests,
    failure,
    wait: (name) =>
      bounded(
        Promise.race([received.get(name).promise, failure.promise]),
        20_000,
        `provider ${name}`,
      ),
    complete: () => {
      assert.ok(completeResponse);
      completeResponse();
    },
  };
}

function exactSource(commitSha) {
  assert.match(commitSha, /^[a-f0-9]{40}$/u);
  const git = (args) =>
    execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  assert.equal(git(["rev-parse", "HEAD"]), commitSha, "source SHA changed");
  assert.equal(
    git(["status", "--porcelain", "--untracked-files=all"]),
    "",
    "source tree is dirty",
  );
}

export async function runTurnProbe({ codexJs, commitSha, output }) {
  exactSource(commitSha);
  const root = mkdtempSync(join(tmpdir(), "cc-codex-turn-probe-"));
  const fromRepository = relative(REPO_ROOT, root);
  assert.ok(
    fromRepository.startsWith(`..${sep}`) || isAbsolute(fromRepository),
    "probe state must be outside the source checkout",
  );
  const workspace = join(root, "workspace"),
    env = isolatedEnvironment(root);
  for (const directory of new Set([
    workspace,
    ...Object.values(env).filter((value) => value.startsWith(root)),
  ]))
    mkdirSync(directory, { recursive: true });
  const upstream = resolveBinary(codexJs);
  const reported = execFileSync(upstream.binary, ["--version"], {
    cwd: workspace,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  }).trim();
  assert.equal(reported, `codex-cli ${PROBE_VERSION}`);
  const provider = fixtureProvider(workspace),
    validators = officialValidators();
  let client, shutdown, report, failure;
  try {
    await bounded(
      new Promise((yes, no) => {
        provider.server.once("error", no);
        provider.server.listen(0, "127.0.0.1", yes);
      }),
      5000,
      "provider listen",
    );
    writeFileSync(
      join(env.CODEX_HOME, "config.toml"),
      [
        'model = "fixture-codex"',
        'model_provider = "fixture"',
        'approval_policy = "never"',
        'sandbox_mode = "read-only"',
        "[model_providers.fixture]",
        'name = "Isolated fixture"',
        `base_url = "http://127.0.0.1:${provider.server.address().port}/v1"`,
        'wire_api = "responses"',
        "requires_openai_auth = false",
        "request_max_retries = 0",
        "stream_max_retries = 0",
        "",
      ].join("\n"),
    );
    const child = spawn(
      upstream.binary,
      ["app-server", "--listen", "stdio://"],
      {
        cwd: workspace,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let approvalBinding;
    client = new ProbeClient(child, validators, {
      onApprovalRequest: (request) =>
        cancelBoundApproval(request, approvalBinding, client.notifications),
    });
    const guard = (promise, label) =>
      client.guard(Promise.race([promise, provider.failure.promise]), label);
    await guard(
      client.request("initialize", {
        clientInfo: { name: "chainlesschain_turn_probe", version: "1.0.0" },
      }),
      "initialize",
    );
    child.stdin.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    const fallbackCalls = [];
    async function start(scenario) {
      const started = await guard(
        client.request("thread/start", {
          ephemeral: true,
          cwd: workspace,
          model: "fixture-codex",
          modelProvider: "fixture",
          sandbox: "read-only",
          approvalPolicy:
            scenario === "approval-cancel" ? "on-request" : "never",
        }),
        "thread start",
      );
      if (scenario === "approval-cancel")
        approvalBinding = { threadId: started.thread.id, workspace };
      const adapter = new CodexAppServerAdapter({
        client,
        enabled: true,
        upstreamVersion: PROBE_VERSION,
        compatibilityMatrix: [{ version: PROBE_VERSION }],
        timeoutMs: scenario === "transport-loss" ? 5000 : 30_000,
        fallback: () => {
          fallbackCalls.push(scenario);
          throw new Error("unexpected fallback");
        },
      });
      const result = adapter.execute({
        threadId: started.thread.id,
        prompt:
          scenario === "approval-cancel"
            ? "fixture-approval-cancel: Request the deterministic test command; cancel its approval."
            : `fixture-${scenario}: Say probe-ok. Do not call any tools.`,
      });
      result.catch(() => {});
      return { threadId: started.thread.id, result };
    }
    const completed = await start("completed");
    let settledEarly = false;
    completed.result.then(
      () => {
        settledEarly = true;
      },
      () => {
        settledEarly = true;
      },
    );
    await guard(provider.wait("completed"), "first provider request");
    const failed = await start("failed");
    const failedResult = await guard(failed.result, "failed turn");
    assert.equal(failedResult.terminal, "failed");
    assert.ok(failedResult.error);
    assert.equal(
      settledEarly,
      false,
      "another thread's terminal ended the pending turn",
    );
    provider.complete();
    const completedResult = await guard(completed.result, "completed turn");
    assert.equal(completedResult.terminal, "completed");
    assert.equal(completedResult.output, "probe-ok");
    assert.deepEqual(completedResult.usage, {
      cacheWriteInputTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 10,
      outputTokens: 2,
      reasoningOutputTokens: 0,
      totalTokens: 12,
    });
    const interrupted = await start("interrupted");
    await guard(provider.wait("interrupted"), "interrupt provider request");
    const startedTurn = client.notifications.findLast(
      (event) =>
        event.method === "turn/started" &&
        event.params.threadId === interrupted.threadId,
    );
    assert.ok(startedTurn?.params.turn.id);
    await guard(
      client.request("turn/interrupt", {
        threadId: interrupted.threadId,
        turnId: startedTurn.params.turn.id,
      }),
      "interrupt RPC",
    );
    const interruptedResult = await guard(
      interrupted.result,
      "interrupted turn",
    );
    assert.equal(interruptedResult.terminal, "interrupted");

    const approval = await start("approval-cancel");
    const approvalResult = await guard(
      approval.result,
      "cancelled command approval",
    );
    assert.equal(approvalResult.terminal, "interrupted");
    assert.equal(client.approvals.length, 1);
    const declined = approvalResult.notifications.find(
      (event) =>
        event.method === "item/completed" &&
        event.params.item.id === APPROVAL_ITEM_ID,
    );
    assert.equal(declined?.params.item.kind, "tool");
    assert.equal(declined.params.item.status, "declined");
    assert.equal(declined.params.item.content.status, "declined");
    assert.equal(declined.params.item.content.processId, null);
    assert.equal(declined.params.item.content.exitCode, null);
    const marker = join(workspace, "approval-probe-marker.txt");
    assert.equal(existsSync(marker), false, "cancelled command ran");
    approvalBinding = null;

    const lost = await start("transport-loss");
    await guard(provider.wait("transport-loss"), "loss provider request");
    child.kill("SIGKILL");
    shutdown = await bounded(
      client.closed.promise,
      5000,
      "forced transport loss",
    );
    await assert.rejects(
      bounded(lost.result, 10_000, "admitted transport loss"),
      {
        code: "CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION",
      },
    );
    assert.equal(client.listenerCount("notification"), 0);
    assert.equal(client.pending.size, 0);
    assert.deepEqual(fallbackCalls, []);
    assert.deepEqual(
      provider.requests.map((entry) => entry.scenario),
      SCENARIOS,
    );
    const results = [
      completedResult,
      failedResult,
      interruptedResult,
      approvalResult,
    ];
    assert.equal(new Set(results.map((result) => result.threadId)).size, 4);
    assert.equal(
      existsSync(marker),
      false,
      "cancelled command ran after turn completion",
    );
    for (const result of results) {
      assert.equal(result.fallback, false);
      for (const event of result.notifications) {
        assert.equal(event.params.threadId, result.threadId);
        assert.equal(event.params.turnId, result.turnId);
      }
    }
    exactSource(commitSha);
    report = {
      schema: "chainlesschain.codex-real-turn-probe/v1",
      status: "passed",
      commitSha,
      upstream: {
        version: PROBE_VERSION,
        reported,
        nativePackage: upstream.packageName,
        binarySha256: upstream.binarySha256,
      },
      platform: process.platform,
      arch: process.arch,
      provider: "synthetic-loopback-responses",
      realProviderAcceptance: false,
      productionAdmission: false,
      officialSchema: {
        hashes: validators.hashes,
        validatedMessages: validators.counts,
      },
      results: results.map(
        ({ terminal, output, usage, fallback, threadId, turnId }) => ({
          terminal,
          output,
          usage,
          fallback,
          threadId,
          turnId,
        }),
      ),
      transportLoss: {
        errorCode: "CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION",
        fallbackCalls: fallbackCalls.length,
      },
      approvalCancellation: {
        requests: 1,
        decision: "cancel",
        toolStatus: "declined",
        terminal: approvalResult.terminal,
        markerPresent: false,
        processId: null,
        exitCode: null,
      },
      interleavedThreads: true,
      providerRequests: provider.requests,
      stdoutBytes: client.bytes,
      stderrBytes: client.stderrBytes,
      notificationCount: client.notifications.length,
      processClosed: shutdown,
    };
  } catch (error) {
    failure = error;
  } finally {
    const stopped = client ? client.stop() : Promise.resolve();
    provider.server.closeAllConnections();
    try {
      await Promise.all([
        stopped,
        bounded(
          new Promise((yes) => provider.server.close(yes)),
          5000,
          "provider shutdown",
        ),
      ]);
    } catch (error) {
      failure ||= error;
    }
  }
  const destination = resolve(output);
  mkdirSync(dirname(destination), { recursive: true });
  const notifications = `${JSON.stringify(client?.notifications || [])}\n`;
  const approvals = `${JSON.stringify(client?.approvals || [])}\n`;
  report = {
    ...(report || {
      schema: "chainlesschain.codex-real-turn-probe/v1",
      commitSha,
      platform: process.platform,
      arch: process.arch,
      realProviderAcceptance: false,
      productionAdmission: false,
    }),
    status: failure ? "failed" : "passed",
    notificationsSha256: sha256(notifications),
    approvalsSha256: sha256(approvals),
    ...(failure
      ? {
          error: {
            name: failure.name,
            message: String(failure.message).slice(0, 2000),
          },
        }
      : {}),
  };
  writeFileSync(`${destination}.notifications.json`, notifications);
  writeFileSync(`${destination}.approvals.json`, approvals);
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  if (failure) throw failure;
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const names = {
      "--codex-js": "codexJs",
      "--commit-sha": "commitSha",
      "--output": "output",
    };
    assert.ok(
      names[process.argv[i]] && process.argv[i + 1],
      "expected --codex-js, --commit-sha and --output",
    );
    options[names[process.argv[i]]] = process.argv[i + 1];
  }
  runTurnProbe(options)
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    });
}
