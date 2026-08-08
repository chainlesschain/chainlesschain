"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HOST_DOM_COMMAND = "chainlesschain.internal.hostDomCommand";
const WORKBENCH_NEEDS_INPUT_SLA_MS = 2_000;
const WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT = 100;
const WORKBENCH_NEEDS_INPUT_WARMUP_COUNT = 1;
const JOURNEY_PHASES = Object.freeze({
  initial: Object.freeze([
    "stream",
    "retry",
    "plan-approval",
    "permission",
    "interrupt",
    "workbench-dispatch-needs-input",
    "workbench-reply-artifact",
  ]),
  restart: Object.freeze(["ide-restart-resume", "workbench-restart-recovery"]),
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendTrace(traceFile, record) {
  fs.mkdirSync(path.dirname(traceFile), { recursive: true, mode: 0o700 });
  fs.appendFileSync(
    traceFile,
    `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function summarizeVisibilityMetrics(latencies) {
  const sorted = [...latencies].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    minLatencyMs: sorted[0],
    maxLatencyMs: sorted[sorted.length - 1],
    p95LatencyMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

function appendVisibilitySummary(traceFile, phase, latencies, startedAt) {
  const summary = summarizeVisibilityMetrics(latencies);
  appendTrace(traceFile, {
    phase,
    metric: "needs-input-visible-summary",
    ...summary,
    thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    warmupSamples: WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
    measurementStartedAt: startedAt,
    measurementCompletedAt: new Date().toISOString(),
    networkCondition: "loopback fixture; no external network",
    transport: "installed-vsix-webview-production-route",
    runnerEnvironment:
      process.env.GITHUB_ACTIONS === "true" ? "github-hosted" : "local",
    runnerName: process.env.RUNNER_NAME || null,
    runnerOS: process.env.RUNNER_OS || process.platform,
    runnerArch: process.env.RUNNER_ARCH || process.arch,
    runnerImageOS: process.env.ImageOS || null,
    runnerImageVersion: process.env.ImageVersion || null,
  });
  assert.ok(
    summary.p95LatencyMs < WORKBENCH_NEEDS_INPUT_SLA_MS,
    `Workbench needs_input P95 visibility took ${summary.p95LatencyMs}ms; required <${WORKBENCH_NEEDS_INPUT_SLA_MS}ms`,
  );
}

function writeSignal(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  assert.equal(
    fs.existsSync(filePath),
    false,
    `refusing to reuse stale journey signal ${filePath}`,
  );
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, filePath);
}

async function executeRelay(commands, token, request) {
  return commands.executeCommand(HOST_DOM_COMMAND, token, request);
}

function assertSnapshot(snapshot) {
  assert.ok(
    snapshot && typeof snapshot === "object",
    "DOM snapshot is missing",
  );
  assert.equal(typeof snapshot.text, "string", "DOM snapshot text is missing");
  assert.equal(
    snapshot.inputPresent,
    true,
    "chat composer is missing from the DOM",
  );
  assert.equal(snapshot.sendEnabled, true, "chat send control is unavailable");
  return snapshot;
}

async function waitForSnapshot({
  commands,
  token,
  predicate = () => true,
  label,
  timeoutMs = 45_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const snapshot = assertSnapshot(
        await executeRelay(commands, token, { action: "snapshot" }),
      );
      if (predicate(snapshot)) return snapshot;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label} did not become true within ${timeoutMs}ms`, {
    cause: lastError,
  });
}

async function sendComposer(commands, token, text) {
  const result = await executeRelay(commands, token, { action: "send", text });
  assert.equal(result?.sent, true, `could not send composer text: ${text}`);
}

async function clickWhenReady({ commands, token, target, snapshotKey, label }) {
  await waitForSnapshot({
    commands,
    token,
    predicate: (snapshot) => snapshot[snapshotKey] === true,
    label: `${label} control`,
  });
  const result = await executeRelay(commands, token, {
    action: "click",
    target,
  });
  assert.equal(result?.clicked, target, `could not click ${label}`);
}

async function executeWorkbench(commands, token, request) {
  return executeRelay(commands, token, {
    surface: "sessions-workbench",
    ...request,
  });
}

async function waitForWorkbench({
  commands,
  token,
  predicate = () => true,
  label,
  timeoutMs = 45_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let lastError;
  while (Date.now() < deadline) {
    try {
      last = await executeWorkbench(commands, token, { action: "snapshot" });
      if (
        last &&
        typeof last.text === "string" &&
        Number(last.rowCount) >= 5 &&
        predicate(last)
      ) {
        return last;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `${label} did not become true within ${timeoutMs}ms; last=${JSON.stringify(last)}`,
    { cause: lastError },
  );
}

async function drivePhase(commands, token, phase, traceFile) {
  const step = async (name, action) => {
    appendTrace(traceFile, { phase, step: name, status: "started" });
    await action();
    appendTrace(traceFile, { phase, step: name, status: "passed" });
  };
  const waitForText = (text, label) =>
    waitForSnapshot({
      commands,
      token,
      predicate: (snapshot) => snapshot.text.includes(text),
      label,
    });

  if (phase === "initial") {
    await step("stream", async () => {
      await sendComposer(commands, token, "journey:stream");
      await waitForText("fixture stream complete #1", "first streamed turn");
    });
    await step("retry", async () => {
      await sendComposer(commands, token, "/retry");
      await waitForText("fixture stream complete #2", "retried turn");
    });
    await step("plan-approval", async () => {
      await sendComposer(commands, token, "journey:plan");
      await waitForSnapshot({
        commands,
        token,
        predicate: (snapshot) => snapshot.planVisible === true,
        label: "plan card",
      });
      await clickWhenReady({
        commands,
        token,
        target: "planApprove",
        snapshotKey: "planApproveEnabled",
        label: "plan approve",
      });
      await waitForText("fixture plan approve #3", "plan continuation");
    });
    await step("permission", async () => {
      await sendComposer(commands, token, "journey:permission");
      await clickWhenReady({
        commands,
        token,
        target: "latestApprovalApprove",
        snapshotKey: "approvalApproveEnabled",
        label: "permission approve",
      });
      await waitForText(
        "fixture permission approved #4",
        "permission continuation",
      );
    });
    await step("interrupt", async () => {
      await sendComposer(commands, token, "journey:stop");
      await clickWhenReady({
        commands,
        token,
        target: "stop",
        snapshotKey: "stopEnabled",
        label: "interrupt",
      });
      await waitForText("interrupted", "interrupt result");
    });
    await step("workbench-dispatch-needs-input", async () => {
      const initial = await waitForWorkbench({
        commands,
        token,
        predicate: (snapshot) =>
          snapshot.backgroundState === "done" &&
          snapshot.dispatchEnabled === true &&
          ["local", "background", "remote", "team", "workflow"].every((kind) =>
            snapshot.kinds.includes(kind),
          ),
        label: "initial canonical workbench projection",
      });
      assert.equal(initial.artifactVisible, false);
      const latencies = [];
      let measurementStartedAt;
      const totalCycles =
        WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT;
      for (let cycle = 0; cycle < totalCycles; cycle += 1) {
        const sample = cycle - WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + 1;
        const measured = sample > 0;
        if (measured && !measurementStartedAt) {
          measurementStartedAt = new Date().toISOString();
        }
        const dispatchedAt = Date.now();
        const clicked = await executeWorkbench(commands, token, {
          action: "click",
          target: "dispatch",
          text: measured
            ? `dispatch from VS Code Workbench sample ${sample}`
            : "dispatch from VS Code Workbench warmup",
        });
        assert.equal(clicked?.clicked, "dispatch");
        await waitForWorkbench({
          commands,
          token,
          predicate: (snapshot) =>
            snapshot.backgroundState === "needs_input" &&
            snapshot.replyEnabled === true,
          label: measured
            ? `Workbench needs_input transition sample ${sample}`
            : "Workbench needs_input transition warmup",
        });
        if (measured) {
          const latencyMs = Date.now() - dispatchedAt;
          latencies.push(latencyMs);
          appendTrace(traceFile, {
            phase,
            metric: "needs-input-visible",
            sample,
            sampleCount: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
            latencyMs,
            thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
          });
        }
        const replied = await executeWorkbench(commands, token, {
          action: "click",
          target: "reply",
          text: measured ? `beta-${sample}` : "beta-warmup",
        });
        assert.equal(replied?.clicked, "reply");
        await waitForWorkbench({
          commands,
          token,
          predicate: (snapshot) =>
            snapshot.backgroundState === "done" &&
            snapshot.artifactVisible === true &&
            snapshot.prVisible === true,
          label: measured
            ? `Workbench reply projection sample ${sample}`
            : "Workbench reply projection warmup",
        });
      }
      appendVisibilitySummary(
        traceFile,
        phase,
        latencies,
        measurementStartedAt,
      );
    });
    await step("workbench-reply-artifact", async () => {
      await waitForWorkbench({
        commands,
        token,
        predicate: (snapshot) =>
          snapshot.backgroundState === "done" &&
          snapshot.artifactVisible === true &&
          snapshot.prVisible === true,
        label: "Workbench artifact and PR projection",
      });
    });
    return;
  }

  if (phase === "restart") {
    await step("ide-restart-resume", async () => {
      await sendComposer(commands, token, "journey:resume");
      await waitForText(
        "resumed previous conversation",
        "resume acknowledgement",
      );
      await waitForText(
        "fixture stream complete #6",
        "post-restart streamed turn",
      );
    });
    await step("workbench-restart-recovery", async () => {
      await waitForWorkbench({
        commands,
        token,
        predicate: (snapshot) =>
          snapshot.backgroundState === "done" &&
          snapshot.artifactVisible === true &&
          snapshot.prVisible === true,
        label: "Workbench restart recovery",
      });
    });
    return;
  }
  throw new Error(`unknown DOM relay journey phase: ${phase}`);
}

async function runDomRelayJourney({
  commands,
  token,
  phase,
  readyFile,
  resultFile,
  traceFile,
  artifactDir,
  extensionPath,
  workspaceDir,
  workspaceFolders,
}) {
  assert.match(
    token || "",
    /^[a-f0-9]{64}$/u,
    "host DOM relay token is malformed",
  );
  assert.ok(
    Object.hasOwn(JOURNEY_PHASES, phase),
    `unknown journey phase: ${phase}`,
  );
  let failure;
  try {
    const initialSnapshot = await waitForSnapshot({
      commands,
      token,
      label: "chat webview relay",
    });
    appendTrace(traceFile, {
      phase,
      status: "target-found",
      targetType: "vscode-webview-message-relay",
      targetUrl:
        initialSnapshot.url || "vscode-webview://chainlesschainIdeChat",
    });
    await waitForWorkbench({
      commands,
      token,
      label: "Sessions Workbench webview relay",
    });
    appendTrace(traceFile, {
      phase,
      status: "sessions-workbench-found",
      targetType: "vscode-webview-message-relay",
      targetUrl: "vscode-webview://chainlesschainSessionsWorkbench",
    });
    writeSignal(readyFile, {
      phase,
      mode: "dom-relay",
      hostArchitecture: process.arch,
      extensionPath: fs.realpathSync(extensionPath),
      workspaceDir: fs.realpathSync(workspaceDir),
      workspaceFolders: workspaceFolders.map((workspaceFolder) =>
        fs.realpathSync(workspaceFolder),
      ),
      readyAt: new Date().toISOString(),
    });
    await drivePhase(commands, token, phase, traceFile);
    const finalSnapshot = await waitForSnapshot({
      commands,
      token,
      label: "final chat webview snapshot",
    });
    const finalWorkbenchSnapshot = await waitForWorkbench({
      commands,
      token,
      label: "final Sessions Workbench snapshot",
    });
    fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(artifactDir, `${phase}-dom.txt`),
      finalSnapshot.text.slice(-128 * 1024),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    fs.writeFileSync(
      path.join(artifactDir, `${phase}-workbench-dom.txt`),
      finalWorkbenchSnapshot.text.slice(-128 * 1024),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    writeSignal(resultFile, {
      ok: true,
      phase,
      mode: "dom-relay",
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    failure = error;
    appendTrace(traceFile, {
      phase,
      status: "failed",
      error: String(error?.stack || error),
    });
    if (!fs.existsSync(resultFile)) {
      writeSignal(resultFile, {
        ok: false,
        phase,
        mode: "dom-relay",
        error: String(error?.message || error),
        completedAt: new Date().toISOString(),
      });
    }
  }
  if (failure) throw failure;
}

module.exports = {
  HOST_DOM_COMMAND,
  WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
  assertSnapshot,
  drivePhase,
  runDomRelayJourney,
  waitForSnapshot,
};
