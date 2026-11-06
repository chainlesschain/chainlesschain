"use strict";
const https = require("node:https");
const http = require("node:http");
const { TextDecoder } = require("node:util");
const {
  isDesktopModelIngressClient,
  prepareDesktopModelRequest,
} = require("../evolution/desktop-model-ingress");

const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3";
const LIMITS = Object.freeze({
  wireBytes: 131072,
  outputBytes: 16384,
  maxTokens: 512,
  timeoutMs: 30000,
});
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function volcengineEndpoint(value) {
  if (value !== ENDPOINT && value !== `${ENDPOINT}/`)
    fail("GOAL_MODEL_VOLCENGINE_ENDPOINT_REQUIRED");
  return ENDPOINT;
}
function privateOpenAIEndpoint(value) {
  // Raw spelling is checked before URL normalization. Pin literal addresses:
  // no DNS rebinding, encoded paths, userinfo, alternate IP forms or redirects.
  if (
    typeof value !== "string" ||
    !/^https?:\/\/(?:[0-9.]+|\[::1\]):[1-9][0-9]{0,4}\/v1\/?$/u.test(value)
  )
    fail("GOAL_MODEL_PRIVATE_ENDPOINT_REQUIRED");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("GOAL_MODEL_PRIVATE_ENDPOINT_REQUIRED");
  }
  if (Number(url.port || (url.protocol === "https:" ? 443 : 80)) > 65535)
    fail("GOAL_MODEL_PRIVATE_ENDPOINT_REQUIRED");
  if (url.hostname !== "[::1]") {
    const parts = url.hostname.split(".").map(Number);
    const originalHost = value.slice(value.indexOf("://") + 3).split(":")[0];
    if (
      parts.length !== 4 ||
      parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
      parts.join(".") !== originalHost ||
      !(
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        originalHost === "127.0.0.1"
      )
    )
      fail("GOAL_MODEL_PRIVATE_ENDPOINT_REQUIRED");
  }
  return value.replace(/\/$/u, "");
}
function response(data) {
  const choice = data?.choices?.[0],
    message = choice?.message;
  if (
    data?.error != null ||
    !Array.isArray(data?.choices) ||
    data.choices.length !== 1 ||
    choice.index !== 0 ||
    choice.finish_reason !== "stop" ||
    message?.role !== "assistant" ||
    typeof message.content !== "string" ||
    !message.content.trim() ||
    Buffer.byteLength(message.content) > LIMITS.outputBytes ||
    Object.keys(message).some(
      (key) =>
        !["role", "content", "reasoning_content", "refusal"].includes(key),
    ) ||
    (message.reasoning_content != null && message.reasoning_content !== "") ||
    message.refusal != null ||
    typeof data.model !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(data.model)
  )
    fail("GOAL_MODEL_INVALID_RESPONSE");
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const promptTokens = count(data.usage?.prompt_tokens),
    completionTokens = count(data.usage?.completion_tokens);
  return {
    summary: message.content,
    returnedModel: data.model,
    usage:
      promptTokens === null && completionTokens === null
        ? null
        : { promptTokens, completionTokens },
  };
}

// Literal HTTPS destination, bounded UTF-8 response; no proxies, redirects,
// retries, cache, tool loop or mutable Axios transport. Credentials stay here.
function send(endpoint, body, apiKey, signal, beforeDispatch) {
  const bytes = Buffer.from(JSON.stringify(body));
  if (bytes.length > LIMITS.wireBytes) fail("GOAL_MODEL_INPUT_LIMIT");
  if (signal.aborted) fail("GOAL_MODEL_CANCELLED");
  return new Promise((resolve, reject) => {
    let request;
    const timer = setTimeout(
      () => request?.destroy(new Error("timeout")),
      LIMITS.timeoutMs,
    );
    try {
      beforeDispatch();
      const transport = endpoint.startsWith("https:") ? https : http;
      request = transport.request(
        `${endpoint}/chat/completions`,
        {
          method: "POST",
          agent: false,
          signal,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": bytes.length,
            "Accept-Encoding": "identity",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
        },
        (incoming) => {
          const chunks = [];
          let length = 0;
          if (
            incoming.statusCode !== 200 ||
            (incoming.headers["content-encoding"] &&
              incoming.headers["content-encoding"] !== "identity")
          ) {
            incoming.destroy();
            request.destroy();
            reject(new Error("response"));
            return;
          }
          incoming.on("data", (chunk) => {
            length += chunk.length;
            if (length > LIMITS.wireBytes) {
              incoming.destroy();
              request.destroy();
              reject(new Error("limit"));
            } else chunks.push(chunk);
          });
          incoming.once("error", reject);
          incoming.once("aborted", () => reject(new Error("aborted")));
          incoming.once("end", () => {
            try {
              resolve(
                JSON.parse(
                  new TextDecoder("utf-8", { fatal: true }).decode(
                    Buffer.concat(chunks),
                  ),
                ),
              );
            } catch {
              reject(new Error("response"));
            }
          });
        },
      );
      request.once("error", reject);
      request.once("close", () => clearTimeout(timer));
      request.end(bytes);
    } catch (error) {
      clearTimeout(timer);
      request?.destroy();
      reject(error);
    }
  });
}

function captureOpenAIModel(manager, expectedProvider, endpointCheck) {
  const client = manager?.client,
    provider = manager?.provider;
  const baseURL = client?.baseURL,
    model = client?.model,
    apiKey = client?.apiKey;
  const configEndpoint = manager?.config?.baseURL,
    configModel = manager?.config?.model,
    configKey = manager?.config?.apiKey;
  const endpoint = endpointCheck(baseURL);
  const { isGovernedLLMManager } = require("../llm/llm-manager");
  const check = () => {
    if (
      !isGovernedLLMManager(manager) ||
      !manager.isInitialized ||
      manager.paused ||
      provider !== expectedProvider ||
      manager.provider !== provider ||
      manager.client !== client ||
      !isDesktopModelIngressClient(client) ||
      client.baseURL !== baseURL ||
      client.model !== model ||
      client.apiKey !== apiKey ||
      manager.config?.baseURL !== configEndpoint ||
      manager.config?.model !== configModel ||
      manager.config?.apiKey !== configKey ||
      typeof model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(model) ||
      (expectedProvider === "volcengine" && !apiKey) ||
      (apiKey != null &&
        (typeof apiKey !== "string" ||
          apiKey.length > 4096 ||
          /[\r\n]/u.test(apiKey)))
    )
      fail("GOAL_MODEL_CHANGED_OR_UNAVAILABLE");
  };
  check();
  return Object.freeze({
    provider,
    model,
    endpoint,
    check,
    async run(messages, { signal, checkAuthority, beforeDispatch }) {
      const checkAll = () => {
        check();
        checkAuthority();
        if (signal.aborted) fail("GOAL_MODEL_CANCELLED");
      };
      checkAll();
      const prepared = await prepareDesktopModelRequest(client, {
        model,
        messages,
        stream: false,
        temperature: 0.2,
        max_tokens: LIMITS.maxTokens,
        ...(provider === "volcengine"
          ? { thinking: { type: "disabled" } }
          : {}),
        response_format: { type: "json_object" },
      });
      checkAll();
      const data = await send(endpoint, prepared.body, apiKey, signal, () => {
        checkAll();
        beforeDispatch(prepared.evidence);
      });
      checkAll();
      const result = response(data);
      await prepared.complete(
        { role: "assistant", content: result.summary },
        {
          model: result.returnedModel,
          requestedModel: model,
          usage: result.usage,
        },
      );
      checkAll();
      return result;
    },
  });
}
function captureProjectGoalVolcengineModel(manager) {
  return captureOpenAIModel(manager, "volcengine", volcengineEndpoint);
}
function captureProjectGoalPrivateOpenAIModel(manager) {
  return captureOpenAIModel(manager, "custom", privateOpenAIEndpoint);
}
function captureProjectGoalModel(manager) {
  if (manager?.provider === "volcengine")
    return captureProjectGoalVolcengineModel(manager);
  if (manager?.provider === "custom")
    return captureProjectGoalPrivateOpenAIModel(manager);
  return require("../evolution/desktop-report-summary-model").captureDesktopReportSummaryModel(
    manager,
  );
}
module.exports = {
  captureProjectGoalModel,
  captureProjectGoalVolcengineModel,
  captureProjectGoalPrivateOpenAIModel,
  privateOpenAIEndpoint,
  volcengineEndpoint,
  ENDPOINT,
  LIMITS,
};
