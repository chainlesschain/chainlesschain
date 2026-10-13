/** Diagnostic transport only. Deliberately changes thinking and output policy;
 * never supplies formal-budget activation or frozen sample admission. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createHash, randomBytes } from "node:crypto";

export const BROKER = Object.freeze({
  endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  model: "deepseek-v4-flash-ga-260731",
  maximumRequestsPerTask: 14,
  maximumRequestBytes: 80 * 1024,
  maximumResponseBytes: 1024 * 1024,
  maximumAnswerTokens: 4096,
  timeoutMs: 45000,
  thinking: "disabled",
  formalSample: false,
});
const fileTools = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);
const check = (ok, code) => {
  if (!ok) throw new Error(code);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Accounting evidence must reject decoded duplicate members and nonfinite
// numeric literals instead of accepting JSON.parse's last-member-wins result.
export function parseDiagnosticJson(text) {
  let at = 0;
  const whitespace = () => {
    while (at < text.length && /[\x20\t\r\n]/u.test(text[at])) at++;
  };
  function string() {
    check(text[at] === '"', "DIAGNOSTIC_JSON_STRING_EXPECTED");
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') return JSON.parse(text.slice(start, at));
      if (char === "\\") at++;
    }
    throw new Error("DIAGNOSTIC_JSON_UNTERMINATED_STRING");
  }
  function value(depth) {
    check(depth <= 64, "DIAGNOSTIC_JSON_NESTING_LIMIT");
    whitespace();
    if (text[at] === '"') {
      string();
      return;
    }
    if (text[at] === "{") {
      at++;
      whitespace();
      const keys = new Set();
      if (text[at] === "}") {
        at++;
        return;
      }
      for (;;) {
        whitespace();
        const key = string();
        check(!keys.has(key), "DIAGNOSTIC_JSON_DUPLICATE_MEMBER");
        keys.add(key);
        whitespace();
        check(text[at++] === ":", "DIAGNOSTIC_JSON_MEMBER_SEPARATOR");
        value(depth + 1);
        whitespace();
        const separator = text[at++];
        if (separator === "}") return;
        check(separator === ",", "DIAGNOSTIC_JSON_OBJECT_SEPARATOR");
      }
    }
    if (text[at] === "[") {
      at++;
      whitespace();
      if (text[at] === "]") {
        at++;
        return;
      }
      for (;;) {
        value(depth + 1);
        whitespace();
        const separator = text[at++];
        if (separator === "]") return;
        check(separator === ",", "DIAGNOSTIC_JSON_ARRAY_SEPARATOR");
      }
    }
    for (const literal of ["true", "false", "null"])
      if (text.startsWith(literal, at)) {
        at += literal.length;
        return;
      }
    const number = text
      .slice(at)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    check(
      number && Number.isFinite(Number(number)),
      "DIAGNOSTIC_JSON_INVALID_NUMBER",
    );
    at += number.length;
  }
  value(0);
  whitespace();
  check(at === text.length, "DIAGNOSTIC_JSON_TRAILING_INPUT");
  return JSON.parse(text);
}

export function diagnosticBody(input) {
  check(input?.model === BROKER.model, "DIAGNOSTIC_MODEL_MISMATCH");
  check(input.stream === true, "DIAGNOSTIC_STREAM_REQUIRED");
  check(
    Array.isArray(input.messages) && input.messages.length > 0,
    "DIAGNOSTIC_MESSAGES_REQUIRED",
  );
  check(
    Array.isArray(input.tools) &&
      input.tools.length > 0 &&
      input.tools.every(
        (t) => t?.type === "function" && fileTools.has(t.function?.name),
      ),
    "DIAGNOSTIC_FILE_TOOLS_REQUIRED",
  );
  check(
    Object.keys(input).every((k) =>
      [
        "model",
        "messages",
        "tools",
        "stream",
        "stream_options",
        "max_tokens",
      ].includes(k),
    ),
    "DIAGNOSTIC_UNEXPECTED_FIELD",
  );
  const body = {
    model: BROKER.model,
    messages: input.messages,
    tools: input.tools,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: BROKER.maximumAnswerTokens,
    thinking: { type: "disabled" },
    service_tier: "default",
    parallel_tool_calls: false,
  };
  check(
    Buffer.byteLength(JSON.stringify(body)) <= BROKER.maximumRequestBytes,
    "DIAGNOSTIC_REQUEST_BYTES_LIMIT",
  );
  return body;
}

export function diagnosticUsage(raw) {
  let done = false,
    usage = null,
    finish = null;
  const models = new Set(),
    tiers = new Set();
  for (const block of raw.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    check(!done, "DIAGNOSTIC_EVENT_AFTER_DONE");
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    const event = parseDiagnosticJson(data);
    check(!Object.hasOwn(event, "error"), "DIAGNOSTIC_PROVIDER_ERROR");
    if (event.model) models.add(event.model);
    if (event.service_tier) tiers.add(event.service_tier);
    if (event.usage) {
      check(
        usage === null || JSON.stringify(usage) === JSON.stringify(event.usage),
        "DIAGNOSTIC_CONFLICTING_USAGE",
      );
      usage = event.usage;
    }
    for (const choice of event.choices || []) {
      check(choice.index === 0, "DIAGNOSTIC_EXTRA_CHOICE");
      if (choice.finish_reason) {
        check(
          finish === null || finish === choice.finish_reason,
          "DIAGNOSTIC_CONFLICTING_FINISH",
        );
        finish = choice.finish_reason;
      }
      check(
        !choice.delta?.reasoning_content,
        "DIAGNOSTIC_UNEXPECTED_REASONING",
      );
    }
  }
  check(
    done && ["stop", "tool_calls"].includes(finish),
    "DIAGNOSTIC_INCOMPLETE_STREAM",
  );
  check(
    models.size === 1 && models.has(BROKER.model),
    "DIAGNOSTIC_RESPONSE_MODEL_UNKNOWN",
  );
  check(
    tiers.size === 1 && tiers.has("default"),
    "DIAGNOSTIC_RESPONSE_TIER_UNKNOWN",
  );
  check(
    usage &&
      [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      ),
    "DIAGNOSTIC_USAGE_UNKNOWN",
  );
  check(
    usage.total_tokens === usage.prompt_tokens + usage.completion_tokens,
    "DIAGNOSTIC_USAGE_INCONSISTENT",
  );
  check(
    usage.completion_tokens <= BROKER.maximumAnswerTokens,
    "DIAGNOSTIC_OUTPUT_LIMIT_EXCEEDED",
  );
  const cached = usage.prompt_tokens_details?.cached_tokens;
  check(
    Number.isSafeInteger(cached) &&
      cached >= 0 &&
      cached <= usage.prompt_tokens,
    "DIAGNOSTIC_CACHE_USAGE_UNKNOWN",
  );
  check(
    usage.completion_tokens_details?.reasoning_tokens === 0,
    "DIAGNOSTIC_REASONING_USAGE_UNKNOWN",
  );
  return {
    usage,
    finish,
    tokenOnlyEstimateCny:
      ((usage.prompt_tokens - cached) * 3 +
        cached * 0.1 +
        usage.completion_tokens * 9) /
      1e6,
  };
}

function requestArk(body, key) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body),
      chunks = [];
    let bytes = 0,
      status = null,
      finished = false;
    const req = https.request(BROKER.endpoint, {
      method: "POST",
      agent: false,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish("DIAGNOSTIC_TIMEOUT_USAGE_UNKNOWN");
    }, BROKER.timeoutMs);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const result = {
        status,
        raw: Buffer.concat(chunks),
        errorCode: error || null,
      };
      if (error) reject(Object.assign(new Error(error), { captured: result }));
      else resolve(result);
    }
    req.on("response", (res) => {
      status = res.statusCode;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > BROKER.maximumResponseBytes) {
          res.destroy();
          req.destroy();
          finish("DIAGNOSTIC_RESPONSE_LIMIT_USAGE_UNKNOWN");
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish());
      res.on("error", () => finish("DIAGNOSTIC_RESPONSE_ERROR_USAGE_UNKNOWN"));
      res.on("aborted", () =>
        finish("DIAGNOSTIC_RESPONSE_ABORTED_USAGE_UNKNOWN"),
      );
    });
    req.on("error", () => finish("DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN"));
    req.end(payload);
  });
}

export async function createVolcengineDiagnosticBroker({
  outputDir,
  key,
  requestImpl = requestArk,
}) {
  check(typeof key === "string" && key.length > 0, "DIAGNOSTIC_KEY_REQUIRED");
  // A restarted broker cannot reuse this request allowance.
  fs.mkdirSync(outputDir, { mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const redact = (value) => {
    let text = String(value);
    for (const [secret, replacement] of [
      [key, "[REDACTED]"],
      [token, "[BROKER_CAPABILITY]"],
    ])
      for (const encoded of new Set([
        secret,
        JSON.stringify(secret).slice(1, -1),
      ]))
        text = text.replaceAll(encoded, replacement);
    return text;
  };
  function save(file, value) {
    const bytes =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    const fd = fs.openSync(path.join(outputDir, file), "wx", 0o600);
    try {
      fs.writeFileSync(fd, redact(bytes));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return {
      storedSha256: hash(Buffer.from(redact(bytes))),
      storedBytes: Buffer.byteLength(redact(bytes)),
    };
  }
  const tasks = [],
    receipts = [];
  let active = null,
    pending = false,
    poisoned = null;
  const server = http.createServer(async (req, res) => {
    const rejectLocal = (code) => {
      if (!res.destroyed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: code } }));
      }
    };
    if (
      req.method !== "POST" ||
      req.url !== "/api/v3/chat/completions" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      rejectLocal("DIAGNOSTIC_BROKER_ACCESS_DENIED");
      return;
    }
    if (
      pending ||
      poisoned ||
      !active ||
      active.requests >= BROKER.maximumRequestsPerTask
    ) {
      rejectLocal(poisoned || "DIAGNOSTIC_REQUEST_ALLOWANCE_EXHAUSTED");
      return;
    }
    pending = true;
    let row = null,
      captured = null;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        check(
          bytes <= BROKER.maximumRequestBytes,
          "DIAGNOSTIC_REQUEST_BYTES_LIMIT",
        );
        chunks.push(chunk);
      }
      const original = parseDiagnosticJson(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      const effective = diagnosticBody(original);
      const id = receipts.length + 1;
      save(`request-${id}.original.json`, original);
      save(`request-${id}.effective.json`, effective);
      active.requests += 1;
      row = {
        id,
        taskId: active.taskId,
        startedAt: new Date().toISOString(),
        usage: null,
        tokenOnlyEstimateCny: null,
        actualBilledCostCny: null,
        errorCode: null,
      };
      // Persist the physical dispatch slot before network egress.
      save(`request-${id}.dispatch.json`, row);
      receipts.push(row);
      captured = await requestImpl(effective, key);
      check(captured.status === 200, "DIAGNOSTIC_NON_200_NO_RETRY");
      Object.assign(
        row,
        diagnosticUsage(
          new TextDecoder("utf-8", { fatal: true }).decode(captured.raw),
        ),
      );
    } catch (error) {
      poisoned = error.message.startsWith("DIAGNOSTIC_")
        ? error.message
        : "DIAGNOSTIC_INVALID_RESPONSE_USAGE_UNKNOWN";
      captured ||= error.captured || null;
      if (row) row.errorCode = poisoned;
    } finally {
      try {
        if (row) {
          row.finishedAt = new Date().toISOString();
          if (captured) {
            const stored = save(
              `response-${row.id}.sse`,
              captured.raw.toString("utf8"),
            );
            row.response = {
              ...stored,
              status: captured.status,
              originalSha256: hash(captured.raw),
              originalBytes: captured.raw.length,
              sensitiveValueRedacted:
                captured.raw.includes(Buffer.from(key)) ||
                captured.raw.includes(Buffer.from(token)),
            };
          }
          save(`request-${row.id}.receipt.json`, row);
        }
      } catch {
        poisoned = "DIAGNOSTIC_EVIDENCE_FAILURE";
      }
      pending = false;
      // Never expose a successful terminal to the product until both raw
      // response and complete receipt have been durably written.
      if (poisoned) rejectLocal(poisoned);
      else if (!res.destroyed) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(redact(captured.raw.toString("utf8")));
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  save("policy.json", {
    ...BROKER,
    retries: 0,
    redirects: false,
    fallback: false,
    credentialsInModelChild: false,
    actualBilledCostCny: null,
    fxRate: null,
    defaultThinkingPreserved: false,
    providerHardQuotaVerified: false,
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v3`,
    childKey: token,
    beginTask(taskId) {
      check(
        !pending &&
          !poisoned &&
          ["verify-04", "verify-22"].includes(taskId) &&
          !tasks.some((t) => t.taskId === taskId),
        "DIAGNOSTIC_TASK_ALLOWANCE_INVALID",
      );
      active = { taskId, requests: 0 };
      tasks.push(active);
    },
    taskStatus(taskId) {
      const rows = receipts.filter((r) => r.taskId === taskId);
      return {
        physicalRequestsStarted: rows.length,
        usageCompleteRequests: rows.filter((r) => r.usage !== null).length,
        passed:
          !pending &&
          !poisoned &&
          rows.length > 0 &&
          rows.every((r) => r.usage !== null && r.errorCode === null),
        poisoned,
      };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      const known = receipts.filter((r) => r.usage !== null);
      const result = {
        formalSample: false,
        physicalRequestsStarted: receipts.length,
        usageCompleteRequests: known.length,
        tasks,
        poisoned,
        actualBilledCostCny: null,
        tokenOnlyEstimateCny:
          known.length === receipts.length && receipts.length > 0
            ? known.reduce((s, r) => s + r.tokenOnlyEstimateCny, 0)
            : null,
        knownTokenOnlyEstimateCny: known.reduce(
          (s, r) => s + r.tokenOnlyEstimateCny,
          0,
        ),
        fxRate: null,
      };
      save("summary.json", result);
      return result;
    },
  };
}
