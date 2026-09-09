const MAX_INPUT_BYTES = 96 * 1024;
const MAX_MESSAGES = 8;
const MAX_PROMPT_BYTES = 64 * 1024;
const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3";

function fail(message) {
  throw new Error(message);
}

function boundedString(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

let input = "";
for await (const chunk of process.stdin) {
  input += chunk.toString("utf8");
  if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("grader input exceeds its byte limit");
  }
}

let request;
try {
  request = JSON.parse(input);
} catch {
  fail("grader input is not JSON");
}
if (
  !request ||
  typeof request !== "object" ||
  Array.isArray(request) ||
  Object.keys(request).sort().join(",") !==
    "apiKey,baseUrl,maxTokens,messages,model,provider,schema,timeoutMs"
) {
  fail("grader input schema is invalid");
}
if (
  request.schema !==
    "chainlesschain.skill-synthesis-process-grader-request/v1" ||
  request.provider !== "volcengine" ||
  request.baseUrl.replace(/\/$/u, "") !== ENDPOINT
) {
  fail("grader provider boundary is invalid");
}
const model = boundedString(request.model, "grader model", 256);
const apiKey = boundedString(request.apiKey, "grader credential", 16 * 1024);
if (
  !Number.isSafeInteger(request.maxTokens) ||
  request.maxTokens < 128 ||
  request.maxTokens > 4096 ||
  !Number.isSafeInteger(request.timeoutMs) ||
  request.timeoutMs < 1000 ||
  request.timeoutMs > 120000 ||
  !Array.isArray(request.messages) ||
  request.messages.length === 0 ||
  request.messages.length > MAX_MESSAGES
) {
  fail("grader request bounds are invalid");
}
let promptBytes = 0;
const messages = request.messages.map((message) => {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.keys(message).sort().join(",") !== "content,role" ||
    !["assistant", "system", "user"].includes(message.role)
  ) {
    fail("grader message schema is invalid");
  }
  const content = boundedText(
    message.content,
    "grader message content",
    MAX_PROMPT_BYTES,
  );
  promptBytes += Buffer.byteLength(content, "utf8");
  return { role: message.role, content };
});
if (promptBytes > MAX_PROMPT_BYTES)
  fail("grader prompt exceeds its byte limit");

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), request.timeoutMs);
timer.unref?.();
try {
  const response = await fetch(`${ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: request.maxTokens,
      stream: false,
    }),
    signal: controller.signal,
  });
  if (!response.ok)
    fail(`grader provider rejected the request (${response.status})`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  boundedText(content, "grader provider response", 64 * 1024);
  process.stdout.write(`${JSON.stringify({ ok: true, content })}\n`);
} catch (error) {
  if (controller.signal.aborted) fail("grader provider deadline exceeded");
  throw error;
} finally {
  clearTimeout(timer);
}
