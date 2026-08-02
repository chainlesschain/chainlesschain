#!/usr/bin/env node

import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { WSAgentHandler } from "../../src/gateways/ws/ws-agent-handler.js";

const [
  workerId,
  sessionId,
  requestId,
  userMessage,
  readyPath,
  barrierPath,
  effectsPath,
  mode = "race",
] = process.argv.slice(2);

if (
  !workerId ||
  !sessionId ||
  !requestId ||
  !userMessage ||
  !readyPath ||
  !barrierPath ||
  !effectsPath
) {
  throw new Error("WS claim race worker arguments are incomplete");
}

writeFileSync(readyPath, `${process.pid}\n`, "utf8");
const barrierDeadline = Date.now() + 15_000;
while (!existsSync(barrierPath)) {
  if (Date.now() >= barrierDeadline) {
    throw new Error("WS claim race barrier timed out");
  }
  await delay(5);
}

let modelCalls = 0;
let toolCalls = 0;
const emitted = [];
const interaction = {
  emit(type, payload = {}) {
    emitted.push({
      type,
      code: typeof payload?.code === "string" ? payload.code : null,
      status: typeof payload?.status === "string" ? payload.status : null,
      replayed: payload?.replayed === true,
    });
  },
  async askInput() {
    throw new Error("claim race worker did not expect interactive input");
  },
  rejectAllPending() {},
};

const session = {
  id: sessionId,
  type: "agent",
  status: "active",
  canonicalJsonlSession: true,
  messages: [{ role: "system", content: "claim-race-system" }],
  provider: "ollama",
  model: "fixture",
  apiKey: null,
  baseUrl: "http://localhost:11434",
  projectRoot: process.cwd(),
  enabledToolNames: ["read_file"],
  contextEngine: {
    setTask() {},
    clearTask() {},
    recordError() {},
  },
  planManager: null,
  lastActivity: new Date().toISOString(),
};

async function* runClaimedModel() {
  modelCalls += 1;
  appendFileSync(effectsPath, `model:${workerId}\n`, "utf8");
  if (mode === "crash-after-claim") process.exit(73);
  // Keep the owner in-flight long enough for the competing OS process to
  // observe the durable pending claim rather than a completed settlement.
  await delay(750);
  toolCalls += 1;
  appendFileSync(effectsPath, `tool:${workerId}\n`, "utf8");
  yield {
    type: "tool-executing",
    tool: "read_file",
    args: { path: "claim-race-fixture.txt" },
  };
  yield {
    type: "tool-result",
    tool: "read_file",
    result: { success: true },
  };
  yield {
    type: "response-complete",
    content: "claim-race-durable-answer",
  };
}

const handler = new WSAgentHandler({
  session,
  interaction,
  db: null,
  agentLoop: runClaimedModel,
});

await handler.handleMessage(userMessage, requestId);
process.stdout.write(
  `${JSON.stringify({ workerId, modelCalls, toolCalls, emitted })}\n`,
);
