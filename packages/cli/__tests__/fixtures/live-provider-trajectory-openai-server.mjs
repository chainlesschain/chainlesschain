import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MAX_REQUEST_BYTES = 1024 * 1024;
const LOOPBACK_TOKEN = "cc-loopback-non-secret";
const fixturePath = path.resolve(process.argv[2] || "");

function cumulativeHandoff(fixture, cycleIndex) {
  const handoff = {
    objective: "",
    constraints: [],
    keyDecisions: [],
    changedFiles: [],
    tests: [],
    unresolvedSideEffects: [],
    checkpoints: [],
    blockers: [],
    nextSteps: [],
  };
  for (const cycle of fixture.cycles.slice(0, cycleIndex + 1)) {
    const delta = cycle.factDelta;
    if (typeof delta.objective === "string")
      handoff.objective = delta.objective;
    for (const field of Object.keys(handoff).slice(1)) {
      if (Array.isArray(delta[field])) handoff[field].push(...delta[field]);
    }
  }
  return handoff;
}

function cumulativeFacts(fixture, cycleIndex) {
  const handoff = cumulativeHandoff(fixture, cycleIndex);
  return [handoff.objective, ...Object.values(handoff).slice(1).flat()];
}

function completion(
  message,
  usage = { prompt_tokens: 211, completion_tokens: 37 },
) {
  return {
    id: "chatcmpl-cc-live-trajectory-loopback",
    object: "chat.completion",
    created: 0,
    model: "cc-live-trajectory-loopback-v1",
    choices: [{ index: 0, finish_reason: "stop", message }],
    usage,
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function safeFailure(response, status, code) {
  sendJson(response, status, {
    error: { code, message: "loopback request rejected" },
  });
}

let fixture;
try {
  fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch {
  process.send?.({ type: "startup-error", code: "fixture_unavailable" });
  process.exit(1);
}

let summaryCount = 0;
let requestCount = 0;
let authorizationObserved = true;
const stageCounts = { summary: 0, toolCall: 0, final: 0 };

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    safeFailure(response, 404, "route_not_found");
    return;
  }
  authorizationObserved &&=
    request.headers.authorization === `Bearer ${LOOPBACK_TOKEN}`;
  if (!authorizationObserved) {
    safeFailure(response, 401, "authorization_missing");
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      safeFailure(response, 400, "invalid_json");
      return;
    }
    requestCount += 1;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const last = messages.at(-1);

    if (tools.length === 0) {
      const prompt = messages.length === 1 ? messages[0]?.content : null;
      if (
        typeof prompt !== "string" ||
        !prompt.startsWith("Create a durable conversation handoff")
      ) {
        safeFailure(response, 400, "unexpected_summary_request");
        return;
      }
      const cycleIndex = summaryCount % fixture.cycles.length;
      if (
        cumulativeFacts(fixture, cycleIndex).some(
          (fact) => !prompt.includes(fact),
        )
      ) {
        safeFailure(response, 400, "summary_prompt_lost_tagged_fact");
        return;
      }
      summaryCount += 1;
      stageCounts.summary += 1;
      sendJson(
        response,
        200,
        completion({
          role: "assistant",
          content: JSON.stringify(cumulativeHandoff(fixture, cycleIndex)),
        }),
      );
      return;
    }

    if (
      tools.length !== 1 ||
      tools[0]?.function?.name !== "read_file" ||
      tools[0]?.type !== "function"
    ) {
      safeFailure(response, 400, "unexpected_tool_surface");
      return;
    }
    const cycleIndex = Math.max(0, (summaryCount - 1) % fixture.cycles.length);
    const cycle = fixture.cycles[cycleIndex];
    if (last?.role === "tool") {
      if (
        typeof last.content !== "string" ||
        !last.content.includes(cycle.tool.content.trim())
      ) {
        safeFailure(response, 400, "tool_result_missing_sentinel");
        return;
      }
      stageCounts.final += 1;
      sendJson(
        response,
        200,
        completion({ role: "assistant", content: cycle.tool.completionMarker }),
      );
      return;
    }

    stageCounts.toolCall += 1;
    sendJson(
      response,
      200,
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call-cc-live-trajectory-${summaryCount}`,
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: cycle.tool.path }),
            },
          },
        ],
      }),
    );
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ type: "listening", port: address.port });
});

process.on("message", (message) => {
  if (message?.type !== "close") return;
  const audit = {
    type: "audit",
    authorizationObserved,
    requestCount,
    stageCounts,
  };
  server.close(() => {
    process.send?.(audit, () => process.exit(0));
  });
});

process.on("disconnect", () => server.close(() => process.exit(0)));
