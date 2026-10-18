"use strict";

const http = require("node:http");
const { TextDecoder } = require("node:util");
const {
  isDesktopModelIngressClient,
  prepareDesktopModelRequest,
} = require("./desktop-model-ingress");

const LIMITS = Object.freeze({
  wireBytes: 131072,
  summaryBytes: 16384,
  timeoutMs: 30000,
});
function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function localEndpoint(value) {
  // Check the original spelling too: URL normalization must not admit DNS,
  // alternate numeric IP forms, credentials or encoded paths.
  if (
    typeof value !== "string" ||
    !/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/?$/u.test(value)
  )
    fail("BOARD_SUMMARY_LOCAL_MODEL_REQUIRED");
  const url = new URL(value);
  if (Number(url.port || 80) > 65535)
    fail("BOARD_SUMMARY_LOCAL_MODEL_REQUIRED");
  return url.origin;
}

function response(data, model) {
  const message = data?.message;
  const returnedModel = data?.model;
  const compatible =
    returnedModel === model ||
    (!model.slice(model.lastIndexOf("/") + 1).includes(":") &&
      returnedModel === `${model}:latest`);
  if (
    !compatible ||
    data?.done !== true ||
    data.error != null ||
    (data.done_reason != null && data.done_reason !== "stop") ||
    message?.role !== "assistant" ||
    typeof message.content !== "string" ||
    !message.content.trim() ||
    Buffer.byteLength(message.content, "utf8") > LIMITS.summaryBytes ||
    Object.keys(message).some(
      (key) => !["role", "content", "thinking"].includes(key),
    ) ||
    (message.thinking != null && message.thinking !== "")
  )
    fail("BOARD_SUMMARY_INVALID_RESPONSE");
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const promptTokens = count(data.prompt_eval_count);
  const completionTokens = count(data.eval_count);
  return {
    summary: message.content,
    usage:
      promptTokens === null && completionTokens === null
        ? null
        : { promptTokens, completionTokens },
  };
}

// One socket request, no mutable Axios adapters, proxy environment, retries,
// redirects, tools, streaming, provider routing, caches or compression.
function send(endpoint, body, signal, beforeDispatch) {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  if (bytes.length > LIMITS.wireBytes) fail("BOARD_SUMMARY_INPUT_LIMIT");
  if (signal.aborted) fail("BOARD_SUMMARY_CANCELLED");
  return new Promise((resolve, reject) => {
    let request;
    const timer = setTimeout(
      () => request?.destroy(new Error("timeout")),
      LIMITS.timeoutMs,
    );
    try {
      // This callback synchronously commits the dispatch marker and repeats
      // source/session/provider authorization immediately before socket creation.
      beforeDispatch();
      request = http.request(
        new URL("/api/chat", endpoint),
        {
          method: "POST",
          agent: false,
          signal,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": bytes.length,
            "Accept-Encoding": "identity",
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

function captureDesktopReportSummaryModel(manager) {
  // prepareDesktopModelRequest enforces CC_AGENT_EVOLUTION_INGRESS_FAILED;
  // the report IPC strips its cause and publishes only fixed business codes.
  const client = manager?.client;
  const provider = manager?.provider;
  const configEndpoint = manager?.config?.ollamaURL;
  const configModel = manager?.config?.model;
  const baseURL = client?.baseURL;
  const model = client?.model;
  const endpoint = localEndpoint(baseURL);
  const { isGovernedLLMManager } = require("../llm/llm-manager");
  const check = () => {
    if (
      !isGovernedLLMManager(manager) ||
      !manager.isInitialized ||
      manager.paused ||
      provider !== "ollama" ||
      manager.provider !== provider ||
      manager.client !== client ||
      !isDesktopModelIngressClient(client) ||
      client.baseURL !== baseURL ||
      client.model !== model ||
      manager.config?.ollamaURL !== configEndpoint ||
      manager.config?.model !== configModel ||
      typeof model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(model)
    )
      fail("BOARD_SUMMARY_MODEL_CHANGED_OR_UNAVAILABLE");
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
        if (signal.aborted) fail("BOARD_SUMMARY_CANCELLED");
      };
      checkAll();
      const prepared = await prepareDesktopModelRequest(client, {
        model,
        messages,
        stream: false,
        think: false,
        options: { temperature: 0.2, num_predict: 2048 },
      });
      checkAll();
      const data = await send(endpoint, prepared.body, signal, () => {
        checkAll();
        beforeDispatch(prepared.evidence);
      });
      checkAll();
      const result = response(data, model);
      await prepared.complete(
        { role: "assistant", content: result.summary },
        {
          model: data.model,
          done: true,
          usage: result.usage,
        },
      );
      checkAll();
      return result;
    },
  });
}

module.exports = { captureDesktopReportSummaryModel, localEndpoint, LIMITS };
