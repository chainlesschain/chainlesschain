import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [mode, endpoint, sessionId, resume] = process.argv.slice(2);
if (mode === "repl") {
  const diagnostic = (stage) =>
    writeSync(
      2,
      JSON.stringify({
        fixture: "repl-inflight-bootstrap",
        stage,
        pid: process.pid,
        at: new Date().toISOString(),
        uptimeMs: Math.round(process.uptime() * 1000),
      }) + "\n",
    );
  diagnostic("fixture-entered");
  // Real CLI, readline, durable JSONL and transport, but not an OS PTY.
  Object.defineProperty(process.stdin, "isTTY", { value: true });
  process.stdin.setRawMode = () => {};
  const bin = new URL("../../bin/chainlesschain.js", import.meta.url);
  process.argv = [
    process.execPath,
    fileURLToPath(bin),
    "agent",
    "--provider",
    "ollama",
    "--model",
    "qwen2.5:7b",
    "--base-url",
    endpoint,
    "--no-stream",
    "--no-mcp",
    "--no-ide",
    "--no-pdh",
    "--no-jetbrains",
    "--no-checkpoint",
    "--no-recall-memory",
    "--sandbox-mode",
    "off",
    resume === "resume" ? "--resume" : "--session",
    sessionId,
  ];
  diagnostic("argv-ready-before-cli-import");
  await import(bin.href);
  diagnostic("cli-module-imported");
} else if (mode === "inspect") {
  const { readVerifiedEvents, readVerifiedMessages, readVerifiedProjection } =
    await import("../../src/harness/jsonl-session-store.js");
  const { aggregateUsage } = await import("../../src/lib/session-usage.js");
  const { createVerifiedSessionObservabilityProjection } =
    await import("../../src/lib/causal-observability.js");
  let scopedObservabilityProjection;
  try {
    const projected = await readVerifiedProjection(sessionId, () =>
      createVerifiedSessionObservabilityProjection(sessionId),
    );
    scopedObservabilityProjection = {
      available: true,
      source:
        "readVerifiedProjection/createVerifiedSessionObservabilityProjection",
      usage: projected.usage,
    };
  } catch (error) {
    scopedObservabilityProjection = {
      available: false,
      error: { code: error.code || null, message: error.message },
    };
  }
  const { readSessionHostResumeState } =
    await import("../../src/lib/session-host-snapshot.js");
  const localState = readSessionHostResumeState(sessionId);
  const productUsageProjection = {
    available:
      localState?.snapshot?.verified === true &&
      localState.modelUsageRecovery != null,
    source: "readSessionHostResumeState/modelUsageRecovery",
    usage: localState?.modelUsageRecovery ?? null,
    head: localState?.snapshot?.head ?? null,
  };
  const events = await readVerifiedEvents(sessionId);
  const messages = await readVerifiedMessages(sessionId);
  const usage = events
    .filter((event) =>
      ["model_usage_started", "model_usage_unknown", "token_usage"].includes(
        event.type,
      ),
    )
    .map((event) => ({
      type: event.type,
      callId: event.data?.callId ?? null,
      data: event.data,
    }));
  const settledIds = new Set(
    usage
      .filter((event) => event.type === "token_usage")
      .map((event) => event.callId),
  );
  // A durable started call with no known settlement is unknown, not zero cost.
  const rawUnsettledCallIds = usage
    .filter(
      (event) =>
        event.type === "model_usage_started" && !settledIds.has(event.callId),
    )
    .map((event) => event.callId);
  console.log(
    JSON.stringify({
      fixture: "repl-inflight-recovery",
      sessionId,
      verified: true,
      eventCount: events.length,
      usage,
      rawUnsettledCallIds,
      knownUsage: aggregateUsage(events),
      productUsageProjection,
      scopedObservabilityProjection,
      messages: messages.map(({ role, content }) => ({ role, content })),
    }),
  );
} else {
  throw new Error("Unknown REPL inflight recovery fixture mode");
}
