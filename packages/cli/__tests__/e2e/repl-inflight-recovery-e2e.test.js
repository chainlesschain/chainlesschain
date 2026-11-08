import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const fixture = fileURLToPath(
  new URL("../fixtures/repl-inflight-recovery-state.mjs", import.meta.url),
);
const SESSION = "repl-inflight-recovery";
const WARM = "REPL_CRASH_WARM_47192";
const OLD = "REPL_CRASH_HELD_23861";
const NEXT = "REPL_CRASH_NEW_98264";
const RESPONSE = "REPL_CRASH_SETTLED_RESPONSE";
function recoveryDiagnostics(text, callId) {
  return text
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.includes(callId) || line.includes(SESSION)) &&
        /(?:model|provider).{0,20}(?:request|call)|(?:original|previous|pending|interrupted).{0,20}(?:request|turn)|usage/i.test(
          line,
        ) &&
        /interrupted|unsettled|unknown|incomplete|not saved|not persisted|lost/i.test(
          line,
        ) &&
        /inspect|review|reconcil|resubmit|re-enter|verify|check|confirm|do not replay|not retried/i.test(
          line,
        ),
    );
}

function environment(root) {
  const env = {};
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "ComSpec",
    "COMSPEC",
    "PATH",
    "Path",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    CHAINLESSCHAIN_HOME: path.join(root, "config"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "anchors"),
    CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    HOME: path.join(root, "user-home"),
    USERPROFILE: path.join(root, "user-home"),
    CI: "1",
    NO_COLOR: "1",
  };
}

async function journey() {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-repl-inflight-"));
  for (const name of ["workspace", "config", "anchors", "user-home"])
    fs.mkdirSync(path.join(root, name));
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(path.join(cwd, ".chainlesschain"));
  fs.writeFileSync(path.join(cwd, ".chainlesschain", "config.json"), "{}");
  const runs = [];
  const requests = [];
  const receipt = {
    schema: "chainlesschain.repl-inflight-crash-journey/v1",
    node: process.version,
    platform: process.platform,
    terminal: "emulated stdin isTTY, not an OS PTY",
    transport:
      "real CLI/readline/Evolution/JSONL and loopback HTTP; no paid provider",
    sessionId: SESSION,
    requests,
    transportRequests: [],
    stages: [],
    encryptedDatabaseInstallationVerified: false,
    completed: false,
  };
  let phase = "warmup";
  const server = http.createServer((request, response) => {
    receipt.transportRequests.push({
      method: request.method,
      path: request.url,
      at: new Date().toISOString(),
    });
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("error", () => {});
    request.on("end", () => {
      try {
        const body = JSON.parse(text);
        const users = (body.messages || []).filter(
          (message) => message.role === "user",
        );
        const last = JSON.stringify(users.at(-1)?.content || "");
        const wire = JSON.stringify(body.messages);
        const row = {
          phase,
          index: requests.length + 1,
          path: request.url,
          lastIsWarm: last.includes(WARM),
          lastIsOld: last.includes(OLD),
          lastIsNew: last.includes(NEXT),
          containsOld: wire.includes(OLD),
          containsNew: wire.includes(NEXT),
        };
        requests.push(row);
        // Real transport stays pending after it received the exact original
        // request. Parent observes durable started evidence before hard kill.
        if (row.lastIsOld && phase === "held") return;
        response.writeHead(200, {
          "content-type": "application/json",
          connection: "close",
        });
        response.end(
          JSON.stringify({
            message: { role: "assistant", content: RESPONSE },
            prompt_eval_count: 10,
            eval_count: 5,
            done: true,
          }),
        );
      } catch {
        receipt.serverError = "invalid_loopback_request";
        response.writeHead(400);
        response.end();
      }
    });
  });
  function launch(args, label) {
    const child = spawn(process.execPath, [fixture, ...args], {
      cwd,
      env: environment(root),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const run = {
      child,
      label,
      stdout: "",
      stderr: "",
      closed: false,
      spawnRequestedAt: new Date().toISOString(),
    };
    child.once("spawn", () => {
      run.spawnObservedAt = new Date().toISOString();
    });
    runs.push(run);
    const timer = setTimeout(() => child.kill("SIGKILL"), 150_000);
    run.done = new Promise((resolve) => {
      child.once("error", (error) => {
        run.spawnError = error.code || error.name;
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        Object.assign(run, {
          closed: true,
          code,
          signal,
          closedAt: new Date().toISOString(),
        });
        resolve(run);
      });
    });
    child.stdin.on("error", () => {});
    for (const [stream, field] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ]) {
      stream.setEncoding("utf8").on("data", (chunk) => {
        run[field] += chunk;
        if (run[field].length > 4 * 1024 * 1024) child.kill("SIGKILL");
      });
    }
    return run;
  }
  async function waitFor(run, condition, stage) {
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      if (condition()) {
        receipt.stages.push(stage);
        return;
      }
      if (run.closed) throw new Error(stage + ": child exited " + run.code);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(stage + ": timed out");
  }
  const output = (run) =>
    stripVTControlCharacters(run.stdout + "\n" + run.stderr);
  const atPrompt = (run) => stripVTControlCharacters(run.stdout).endsWith("> ");
  async function inspect(stage) {
    const run = await launch(["inspect", "unused", SESSION], "inspect-" + stage)
      .done;
    if (run.code !== 0)
      throw new Error("inspect " + stage + " failed: " + run.code);
    const result = run.stdout
      .split(/\r?\n/)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line);
          return value.fixture === "repl-inflight-recovery" ? [value] : [];
        } catch {
          return [];
        }
      })
      .at(-1);
    if (!result)
      throw new Error("inspect " + stage + " returned no verified receipt");
    return result;
  }
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const endpoint = "http://127.0.0.1:" + server.address().port;
    const first = launch(["repl", endpoint, SESSION], "original");
    await waitFor(first, () => atPrompt(first), "original-prompt");
    first.child.stdin.write(WARM + "\n");
    await waitFor(
      first,
      () => first.stdout.includes(RESPONSE) && atPrompt(first),
      "warmup-settled",
    );
    receipt.beforeHeld = await inspect("before-held");
    phase = "held";
    first.child.stdin.write(OLD + "\n");
    await waitFor(
      first,
      () => requests.some((row) => row.phase === "held" && row.lastIsOld),
      "original-request-received-and-held",
    );
    // This is an independent process, not a fabricated started event or a mock
    // of the production writer. The transport cannot settle while we inspect.
    receipt.beforeKill = await inspect("before-kill");
    const priorIds = new Set(
      receipt.beforeHeld.usage
        .filter((event) => event.type === "model_usage_started")
        .map((event) => event.callId),
    );
    const started = receipt.beforeKill.usage.filter(
      (event) =>
        event.type === "model_usage_started" && !priorIds.has(event.callId),
    );
    if (started.length !== 1 || !started[0].callId)
      throw new Error(
        "held request lacks exactly one distinct durable started callId",
      );
    receipt.originalCallId = started[0].callId;
    if (
      !receipt.beforeKill.rawUnsettledCallIds.includes(receipt.originalCallId)
    )
      throw new Error("held request was unexpectedly settled");
    receipt.killRequested = first.child.kill("SIGKILL");
    if (!receipt.killRequested)
      throw new Error("could not hard-kill owned original REPL process");
    await first.done;
    receipt.originalExit = { code: first.code, signal: first.signal };
    receipt.afterKill = await inspect("after-kill");
    phase = "resume";
    const resumed = launch(["repl", endpoint, SESSION, "resume"], "resumed");
    // Buffer the new input immediately: startup/recovery and new user input
    // overlap; no old request is reissued by the harness.
    resumed.child.stdin.write(NEXT + "\n");
    await waitFor(
      resumed,
      () =>
        resumed.closed ||
        (atPrompt(resumed) &&
          (resumed.stdout.includes(RESPONSE) ||
            recoveryDiagnostics(output(resumed), receipt.originalCallId)
              .length > 0)),
      "resumed-new-input-settled-or-explicitly-fenced",
    );
    // Allow any already-dispatched transport callback to be observed before
    // counting requests, without initiating a second turn or automatic retry.
    await new Promise((resolve) => setTimeout(resolve, 150));
    receipt.resumeOutput = output(resumed);
    receipt.recoveryDiagnostics = recoveryDiagnostics(
      receipt.resumeOutput,
      receipt.originalCallId,
    );
    receipt.visibleRecoveryNotice = receipt.recoveryDiagnostics.length > 0;
    receipt.oldPromptPreservedBeforeKill = receipt.beforeKill.messages.some(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes(OLD),
    );
    receipt.afterResume = await inspect("after-resume");
    receipt.oldPromptPreservedAfterResume = receipt.afterResume.messages.some(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes(OLD),
    );
    receipt.newProviderRequests = requests.filter(
      (row) => row.phase === "resume" && row.lastIsNew,
    ).length;
    receipt.oldProviderReplays = requests.filter(
      (row) => row.phase === "resume" && row.lastIsOld,
    ).length;
    receipt.resumeDisposition = receipt.newProviderRequests
      ? "new-request-admitted"
      : "new-request-fenced";
    if (!resumed.closed) {
      resumed.child.stdin.write("/exit\n");
      await waitFor(resumed, () => resumed.closed, "resumed-clean-exit");
    }
    receipt.resumedExit = { code: resumed.code, signal: resumed.signal };
    receipt.completed = true;
  } catch (error) {
    receipt.error = { message: error.message, stack: error.stack };
  } finally {
    for (const run of runs) if (!run.closed) run.child.kill("SIGKILL");
    await Promise.all(runs.map((run) => run.done));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    receipt.processes = runs.map(
      ({
        label,
        child,
        code,
        signal,
        spawnError,
        spawnRequestedAt,
        spawnObservedAt,
        closedAt,
      }) => ({
        label,
        pid: child.pid,
        code,
        signal,
        spawnError,
        spawnRequestedAt,
        spawnObservedAt,
        closedAt,
      }),
    );
    if (process.env.CC_REPL_INFLIGHT_ARTIFACT_DIR) {
      const destination = path.resolve(
        process.env.CC_REPL_INFLIGHT_ARTIFACT_DIR,
      );
      fs.mkdirSync(destination, { recursive: true });
      const runDir = fs.mkdtempSync(path.join(destination, "run-"));
      fs.writeFileSync(
        path.join(runDir, "receipt.json"),
        JSON.stringify(receipt, null, 2) + "\n",
      );
      for (const run of runs) {
        fs.writeFileSync(
          path.join(runDir, run.label + ".stdout.log"),
          run.stdout,
        );
        fs.writeFileSync(
          path.join(runDir, run.label + ".stderr.log"),
          run.stderr,
        );
      }
      receipt.artifactDirectory = runDir;
    }
  }
  if (
    path.dirname(root) !== parent ||
    !path.basename(root).startsWith("cc-repl-inflight-")
  )
    throw new Error("unsafe test cleanup");
  fs.rmSync(root, { recursive: true, force: true });
  return receipt;
}

describe("real interactive REPL inflight request hard-kill recovery", () => {
  it("keeps the old request unknown and explains interrupted state when restarting with new input", async () => {
    const receipt = await journey();
    console.info("REPL_INFLIGHT_RECEIPT", JSON.stringify(receipt));
    expect(receipt.error, JSON.stringify(receipt)).toBeUndefined();
    expect(receipt.completed).toBe(true);
    expect(receipt.killRequested).toBe(true);
    expect(
      receipt.originalExit.code === 0 && receipt.originalExit.signal === null,
    ).toBe(false);
    for (const snapshot of [
      receipt.beforeKill,
      receipt.afterKill,
      receipt.afterResume,
    ]) {
      expect(snapshot.verified).toBe(true);
      expect(
        snapshot.productUsageProjection.available,
        JSON.stringify(snapshot.productUsageProjection),
      ).toBe(true);
      expect(snapshot.productUsageProjection.usage.telemetryComplete).toBe(
        false,
      );
      expect(
        snapshot.productUsageProjection.usage.unknownEvidence.byCode,
      ).toContainEqual({ code: "model-usage-unsettled", count: 1 });
      expect(snapshot.sessionId).toBe(SESSION);
      expect(snapshot.rawUnsettledCallIds).toContain(receipt.originalCallId);
      expect(
        snapshot.usage.filter(
          (event) =>
            event.type === "model_usage_started" &&
            event.callId === receipt.originalCallId,
        ),
      ).toHaveLength(1);
      expect(
        snapshot.usage.filter(
          (event) =>
            event.type === "token_usage" &&
            event.callId === receipt.originalCallId,
        ),
      ).toEqual([]);
      expect(snapshot.knownUsage.total.totalTokens).toBeGreaterThanOrEqual(
        receipt.beforeHeld.knownUsage.total.totalTokens,
      );
    }
    expect(receipt.beforeHeld.knownUsage.total.totalTokens).toBeGreaterThan(0);
    expect(receipt.oldProviderReplays).toBe(0);
    expect(receipt.newProviderRequests).toBeLessThanOrEqual(1);
    expect(
      receipt.requests.filter((row) => row.phase === "resume"),
    ).toHaveLength(receipt.newProviderRequests);
    if (receipt.newProviderRequests === 0)
      expect(receipt.visibleRecoveryNotice).toBe(true);
    // A request may remain fenced. It may never silently lose the accepted
    // original user task while allowing a fresh conversation to appear healthy.
    if (!receipt.oldPromptPreservedAfterResume)
      expect(receipt.visibleRecoveryNotice).toBe(true);
    const newStarted = receipt.afterResume.usage.filter(
      (event) =>
        event.type === "model_usage_started" &&
        !receipt.beforeKill.usage.some(
          (old) =>
            old.type === "model_usage_started" && old.callId === event.callId,
        ),
    );
    expect(newStarted).toHaveLength(receipt.newProviderRequests);
    expect(
      newStarted.every((event) => event.callId !== receipt.originalCallId),
    ).toBe(true);
  }, 240_000);
});

describe("REPL recovery diagnostic matcher contract", () => {
  it("rejects generic banners and unrelated reconciliation warnings", () => {
    expect(
      recoveryDiagnostics(
        "Welcome: interrupted tasks can be reconciled",
        "call-old",
      ),
    ).toEqual([]);
    expect(
      recoveryDiagnostics(
        "[recovery] Inspect interrupted MCP calls",
        "call-old",
      ),
    ).toEqual([]);
    expect(
      recoveryDiagnostics(
        "Session " + SESSION + " ready; inspect usage",
        "call-old",
      ),
    ).toEqual([]);
    expect(
      recoveryDiagnostics("Unknown model request call-old", "call-old"),
    ).toEqual([]);
    expect(
      recoveryDiagnostics(
        "[recovery] Session " +
          SESSION +
          " has interrupted model request call-old; usage unknown; inspect the session before resubmitting.",
        "call-old",
      ),
    ).toHaveLength(1);
  });
});
