"use strict";

const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { StringDecoder } = require("node:string_decoder");
const { AsyncLocalStorage } = require("node:async_hooks");

const hosts = new WeakMap();
const clients = new WeakMap();
const workflows = new AsyncLocalStorage();

function desktopChatResult(result) {
  return {
    text: result.message?.content ?? result.text,
    message: result.message,
    model: result.model,
    tokens: result.tokens || result.usage?.total_tokens || 0,
    usage: result.usage,
  };
}

async function runDesktopCachedModelWorkflow(client, request, cache, work) {
  const host = clients.get(client);
  if (!host) return work(false, request);
  try {
    const {
      calculateCacheKey,
      snapshotCacheData,
    } = require("../llm/response-cache");
    let cacheable = true;
    try {
      request = snapshotCacheData(request);
    } catch {
      cacheable = false;
    }
    // A nested manager request (for example prompt summarization while a
    // stream is being prepared) is an intermediate model step of the active
    // Run. It must not create a second Run or independently replay/store a
    // response-cache receipt.
    const parentScope = workflows.getStore();
    if (parentScope?.client === client) {
      if (request.options.signal?.aborted)
        throw new Error("Desktop request aborted");
      return await work(true, request);
    }
    const ingress = await openDesktopModelRun(host, JSON.stringify(request));
    const scope = { client, ingress, result: null };
    return await workflows.run(scope, async () => {
      if (request.options.signal?.aborted)
        throw new Error("Desktop request aborted");
      let requestKey = null;
      if (
        cache?.getEvidenceReceipt &&
        cache?.setEvidenceReceipt &&
        cacheable &&
        !request.options.skipCache
      ) {
        try {
          requestKey = calculateCacheKey(
            request.provider,
            request.model,
            request.messages,
            {
              tenantId: ingress.tenantId,
              connection: request.connection,
              options: request.options,
            },
          );
        } catch {
          /* Opaque options are non-cacheable; model admission still applies. */
        }
      }
      const receipt = requestKey
        ? await cache.getEvidenceReceipt(requestKey)
        : null;
      if (receipt) {
        const event = await ingress.replayResponseCache({
          receipt,
          requestKey,
        });
        const result = event.desktopResult;
        if (
          !result ||
          (typeof result.text !== "string" &&
            result.message?.role !== "assistant")
        )
          throw new Error(
            "Cached response lacks its authenticated Desktop result",
          );
        if (request.options.signal?.aborted)
          throw new Error("Desktop request aborted");
        await ingress.complete();
        cache.recordEvidenceHit?.(requestKey, desktopChatResult(result).tokens);
        return {
          ...desktopChatResult(result),
          timestamp: Date.now(),
          wasCached: true,
          tokensSaved: result.tokens || result.usage?.total_tokens || 0,
        };
      }
      const result = await work(true, request);
      if (
        !scope.result ||
        JSON.stringify(desktopChatResult(result)) !==
          JSON.stringify(desktopChatResult(scope.result))
      )
        throw new Error(
          "Desktop result is not bound to its recorded provider response",
        );
      const proof = requestKey
        ? await ingress.createResponseCacheReceipt({ requestKey })
        : null;
      if (request.options.signal?.aborted)
        throw new Error("Desktop request aborted");
      await ingress.complete();
      if (proof) await cache.setEvidenceReceipt(requestKey, proof);
      return result;
    });
  } catch (cause) {
    if (cause.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
    const error = new Error("Desktop cached model workflow failed", { cause });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

function assertDesktopToolLoopComplete(client) {
  if (!clients.has(client)) return;
  const error = new Error("Governed tool loop exhausted its iteration limit");
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  throw error;
}

async function consumeDesktopToolStream(prepared, response, onChunk) {
  try {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let text = "";
    let terminal = false;
    let finishReason = null;
    let model;
    let usage;
    const calls = new Map();
    const accept = (line) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        terminal = true;
        return;
      }
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error("Tool stream returned an error");
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;
      if (terminal && (delta?.content || delta?.tool_calls?.length))
        throw new Error("Tool stream produced data after completion");
      if (delta?.content) {
        text += delta.content;
        if (onChunk) onChunk(delta.content);
      }
      for (const part of delta?.tool_calls || []) {
        if (
          !Number.isSafeInteger(part.index) ||
          part.index < 0 ||
          part.index >= 128
        )
          throw new Error("Invalid streamed tool index");
        const call = calls.get(part.index) || {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments)
          call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
      if (choice?.finish_reason) {
        terminal = true;
        finishReason = choice.finish_reason;
      }
      if (parsed.model) model = parsed.model;
      if (parsed.usage) usage = parsed.usage;
    };
    for await (const chunk of response.body) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        accept(buffer.slice(0, newline).trim());
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.end();
    if (buffer.trim()) accept(buffer.trim());
    if (!terminal)
      throw new Error("Tool stream ended without a terminal frame");
    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call);
    if (toolCalls.some((call) => !call.id || !call.function.name))
      throw new Error("Incomplete streamed tool call");
    const message = {
      role: "assistant",
      content: text,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    await prepared.complete(message);
    return {
      text,
      model,
      usage,
      choices: [{ message, finish_reason: finishReason || "stop" }],
    };
  } catch (cause) {
    if (cause.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
    const error = new Error("Governed Desktop tool stream did not complete", {
      cause,
    });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

async function runDesktopModelWorkflow(client, input, work) {
  const host = clients.get(client);
  if (!host) return work();
  const ingress = await openDesktopModelRun(host, JSON.stringify(input));
  return workflows.run({ client, ingress }, async () => {
    const result = await work();
    await ingress.complete();
    return result;
  });
}

async function runDesktopToolExecution(client, toolCall, execute) {
  if (!clients.has(client)) return execute();
  const scope = workflows.getStore();
  if (!scope || scope.client !== client) {
    const error = new Error(
      "Desktop tool execution requires its model workflow",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  const event = {
    tool: toolCall.function.name,
    toolCallId: toolCall.id,
    arguments: toolCall.function.arguments,
  };
  await scope.ingress.ingestAgentEvent({ type: "tool-executing", ...event });
  let result;
  try {
    result = await execute();
  } catch (error) {
    await scope.ingress.ingestAgentEvent({
      type: "tool-error",
      ...event,
      error: String(error.message || error),
    });
    throw error;
  }
  await scope.ingress.ingestAgentEvent({
    type: "tool-result",
    ...event,
    result: result ?? null,
  });
  return result;
}

async function runDesktopFunctionWorkflow(
  client,
  messages,
  functions,
  executor,
  options = {},
  hooks = {},
) {
  try {
    if (!clients.has(client) || typeof executor?.execute !== "function")
      throw new Error(
        "Governed function workflow requires a bound client and executor",
      );
    const captured = JSON.parse(JSON.stringify({ messages, functions }));
    const names = new Set(captured.functions.map((fn) => fn.name));
    if (
      names.size !== captured.functions.length ||
      [...names].some((name) => typeof name !== "string" || !name)
    )
      throw new Error("Function definitions must have unique names");
    const limit = options.maxToolIterations ?? 8;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16)
      throw new Error("Function iteration limit must be between 1 and 16");
    const callOptions = {
      ...options,
      tools: captured.functions.map((fn) => ({
        type: "function",
        function: fn,
      })),
    };
    const execute = executor.execute.bind(executor);
    return await runDesktopModelWorkflow(client, captured, async () => {
      let history = captured.messages;
      const usedIds = new Set();
      for (let iteration = 0; ; iteration++) {
        await hooks.beforeStep?.();
        if (options.signal?.aborted)
          throw new Error("Function workflow aborted");
        const result = await client.chat(history, callOptions);
        await hooks.onModelResult?.(result);
        if (options.signal?.aborted)
          throw new Error("Function workflow aborted");
        const calls = result.message?.tool_calls;
        if (calls == null || (Array.isArray(calls) && calls.length === 0)) {
          if (
            !result.message ||
            result.message.role !== "assistant" ||
            typeof (result.message.content ?? result.text) !== "string"
          )
            throw new Error("Function workflow lacks an assistant result");
          return result;
        }
        if (iteration >= limit)
          throw new Error("Function workflow exhausted its iteration limit");
        if (!Array.isArray(calls) || calls.length > 16)
          throw new Error("Invalid or excessive function call batch");
        // Validate the entire batch before any side effect, including replayed IDs.
        const batch = calls.map((call) => {
          if (
            call.type !== "function" ||
            typeof call.id !== "string" ||
            !call.id ||
            call.id.length > 256 ||
            usedIds.has(call.id) ||
            !names.has(call.function?.name) ||
            typeof call.function.arguments !== "string"
          )
            throw new Error("Unbound or repeated function call");
          usedIds.add(call.id);
          const args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw new Error("Function arguments must be an object");
          return { call, args };
        });
        const toolMessages = [];
        for (const { call, args } of batch) {
          await hooks.beforeStep?.();
          if (options.signal?.aborted)
            throw new Error("Function workflow aborted");
          let output;
          try {
            output = await runDesktopToolExecution(client, call, () =>
              execute(call.function.name, args),
            );
          } catch (error) {
            if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
            output = { error: String(error.message || error) };
          }
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(output ?? null),
          });
        }
        history = [...history, result.message, ...toolMessages];
      }
    });
  } catch (cause) {
    if (cause.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
    const error = new Error("Governed Desktop function workflow failed", {
      cause,
    });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

function bindDesktopModelIngressClient(client, host) {
  if (!hosts.has(host))
    throw new TypeError("A branded Desktop model ingress host is required");
  if (clients.has(client) && clients.get(client) !== host)
    throw new Error("Desktop model client authority cannot be replaced");
  clients.set(client, host);
  return client;
}

async function runDesktopOllamaRequest(client, input, options, onChunk, chat) {
  if (!clients.has(client)) return null;
  try {
    // Ollama context tokens are opaque prior model input. Callers must provide
    // explicit conversation messages so every input can be projected.
    if (options.context != null)
      throw new Error(
        "Governed Ollama requires explicit conversation messages instead of opaque context tokens",
      );
    const streaming = typeof onChunk === "function";
    const prepared = await prepareDesktopModelRequest(client, {
      model: options.model || client.model,
      ...(chat ? { messages: input } : { prompt: input }),
      stream: streaming,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        top_k: options.top_k || 40,
      },
    });
    const response = await client.client.post(
      chat ? "/api/chat" : "/api/generate",
      prepared.body,
      {
        ...(streaming ? { responseType: "stream" } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    let data = response.data;
    if (streaming) {
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      let content = "";
      let terminal = null;
      const accept = (line) => {
        if (!line.trim()) return;
        if (terminal)
          throw new Error("Ollama sent data after its terminal frame");
        const frame = JSON.parse(line);
        if (frame.error) throw new Error("Ollama stream returned an error");
        const delta = chat ? frame.message?.content : frame.response;
        if (delta != null && typeof delta !== "string")
          throw new Error("Invalid Ollama response content");
        if (delta) {
          content += delta;
          onChunk(delta, content);
        }
        if (frame.done === true) terminal = frame;
      };
      for await (const chunk of response.data) {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        let boundary;
        while ((boundary = buffer.indexOf("\n")) !== -1) {
          accept(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 1);
        }
        if (buffer.length > 1024 * 1024)
          throw new Error("Ollama stream frame exceeds limit");
      }
      buffer += decoder.end();
      accept(buffer);
      if (!terminal)
        throw new Error("Ollama stream ended without a terminal frame");
      data = {
        ...terminal,
        ...(chat
          ? { message: { ...terminal.message, role: "assistant", content } }
          : { response: content }),
      };
    }
    if (options.signal?.aborted) throw new Error("Ollama request aborted");
    if (data?.error || data?.done !== true)
      throw new Error("Ollama response is not complete");
    const content = chat ? data.message?.content : data.response;
    if (typeof content !== "string")
      throw new Error("Invalid Ollama response content");
    const result = {
      ...(chat
        ? { message: data.message }
        : { text: content, context: data.context }),
      model: data.model,
      done: data.done,
      total_duration: data.total_duration,
      tokens: data.eval_count || 0,
    };
    await prepared.complete(chat ? data.message : content, result);
    return result;
  } catch (cause) {
    if (cause.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
    const error = new Error(
      "Governed Desktop Ollama request did not complete",
      { cause },
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

async function prepareDesktopModelRequest(client, body, protocol = "openai") {
  const host = clients.get(client);
  if (!host) return null;
  try {
    // Capture the final wire payload, after client-specific tool filtering.
    const captured = JSON.parse(JSON.stringify(body));
    const scope = workflows.getStore();
    const sharedWorkflow = scope?.client === client;
    const ingress = sharedWorkflow
      ? scope.ingress
      : await openDesktopModelRun(host, JSON.stringify(captured));
    const geminiParts = (parts) => {
      if (
        !Array.isArray(parts) ||
        parts.some(
          (part) =>
            !part ||
            Object.keys(part).join() !== "text" ||
            typeof part.text !== "string",
        )
      )
        throw new Error("Unsupported Gemini text part");
      return JSON.stringify(parts.map((part) => part.text));
    };
    const restoreGeminiParts = (content) => {
      const texts = JSON.parse(content);
      if (
        !Array.isArray(texts) ||
        texts.some((text) => typeof text !== "string")
      )
        throw new Error("Invalid projected Gemini parts");
      return texts.map((text) => ({ text }));
    };
    const hasGeminiSystem =
      protocol === "gemini" && captured.systemInstruction != null;
    const messages =
      protocol === "gemini"
        ? captured.contents.map((item) => {
            if (!["user", "model"].includes(item.role))
              throw new Error("Unsupported Gemini role");
            return {
              role: item.role === "model" ? "assistant" : "user",
              content: geminiParts(item.parts),
            };
          })
        : Array.isArray(captured.messages)
          ? [...captured.messages]
          : [{ role: "user", content: captured.prompt }];
    if (hasGeminiSystem)
      messages.unshift({
        role: "system",
        content: geminiParts(captured.systemInstruction.parts),
      });
    const hasSystem = Object.hasOwn(captured, "system");
    const hasStops = Object.hasOwn(captured, "stop_sequences");
    if (hasSystem)
      messages.unshift({ role: "system", content: captured.system });
    if (hasStops)
      messages.push({
        role: "user",
        content: JSON.stringify(captured.stop_sequences),
      });
    const projected = await ingress.prepareModelRequest({
      messages,
      tools: captured.tools || [],
    });
    const projectedMessages = [...projected.messages];
    if (
      projectedMessages.length !== messages.length + 1 ||
      projectedMessages[0]?.role !== "system"
    )
      throw new Error("Unexpected model projection provenance layout");
    const provenance = projectedMessages.shift();
    if (hasSystem) captured.system = projectedMessages.shift().content;
    if (hasStops) {
      const stops = JSON.parse(projectedMessages.pop().content);
      if (
        !Array.isArray(stops) ||
        stops.some((value) => typeof value !== "string")
      )
        throw new Error("Invalid projected stop sequences");
      captured.stop_sequences = stops;
    }
    if (protocol === "gemini") {
      const system = hasGeminiSystem
        ? restoreGeminiParts(projectedMessages.shift().content)
        : [];
      captured.systemInstruction = {
        ...(captured.systemInstruction || {}),
        parts: [{ text: provenance.content }, ...system],
      };
      captured.contents = captured.contents.map((item, index) => ({
        ...item,
        parts: restoreGeminiParts(projectedMessages[index].content),
      }));
    } else if (protocol === "anthropic") {
      captured.system = [provenance.content, captured.system]
        .filter(Boolean)
        .join("\n\n");
      captured.messages = projectedMessages;
    } else if (Array.isArray(captured.messages)) {
      captured.messages = [provenance, ...projectedMessages];
    } else {
      captured.prompt = `${provenance.content}\n\n${projectedMessages[0].content}`;
    }
    if (Object.hasOwn(captured, "tools")) captured.tools = projected.tools;
    return {
      body: captured,
      async complete(message, result) {
        try {
          const desktopResult =
            result === undefined
              ? undefined
              : JSON.parse(JSON.stringify(result));
          await ingress.ingestAgentEvent({
            type: "response-complete",
            content:
              typeof message === "string" ? message : JSON.stringify(message),
            ...(desktopResult === undefined ? {} : { desktopResult }),
          });
          if (sharedWorkflow) scope.result = desktopResult ?? null;
          if (!sharedWorkflow) await ingress.complete();
        } catch (cause) {
          const error = new Error("Desktop model response evidence failed", {
            cause,
          });
          error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
          throw error;
        }
      },
    };
  } catch (cause) {
    const error = new Error("Desktop model request evidence failed", { cause });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

async function consumeDesktopGeminiStream(
  prepared,
  response,
  model,
  onChunk,
  signal,
) {
  try {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let content = "";
    let finishReason = null;
    let usage = {};
    const accept = (event) => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error("Gemini stream returned an error");
      const candidate = parsed.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const text = parts
        .map((part) => {
          if (typeof part.text !== "string")
            throw new Error("Unsupported Gemini response part");
          return part.text;
        })
        .join("");
      if (text && finishReason)
        throw new Error("Gemini returned content after its terminal frame");
      if (text) {
        content += text;
        if (onChunk) onChunk({ content: text, done: false });
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (parsed.usageMetadata) usage = parsed.usageMetadata;
    };
    for await (const chunk of response.data) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        accept(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.end();
    if (buffer.trim()) accept(buffer);
    if (signal?.aborted || !finishReason)
      throw new Error("Gemini stream did not complete");
    await prepared.complete({ role: "assistant", content });
    if (onChunk) onChunk({ content: "", done: true });
    return {
      content,
      text: content,
      message: { role: "assistant", content },
      model,
      finish_reason: finishReason,
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
    };
  } catch (cause) {
    if (cause.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
    const error = new Error("Governed Desktop Gemini stream did not complete", {
      cause,
    });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

function createDesktopModelIngressHost(
  factory,
  { isPackaged = false, resourcesPath } = {},
) {
  if (typeof factory !== "function" || types.isProxy(factory)) {
    throw new TypeError("Desktop model composition factory must be a function");
  }
  if (
    isPackaged &&
    (typeof resourcesPath !== "string" || !path.isAbsolute(resourcesPath))
  ) {
    throw new TypeError(
      "Packaged Desktop model ingress requires an absolute resourcesPath",
    );
  }
  const modulePath = isPackaged
    ? path.join(
        resourcesPath,
        "packages/cli/src/lib/evolution/agent-evolution-runtime-composition-brand.js",
      )
    : path.resolve(
        __dirname,
        "../../../../packages/cli/src/lib/evolution/agent-evolution-runtime-composition-brand.js",
      );
  const host = Object.freeze({});
  hosts.set(host, { factory, moduleUrl: pathToFileURL(modulePath).href });
  return host;
}

function isDesktopModelIngressHost(value) {
  return hosts.has(value);
}

async function openDesktopModelRun(host, content) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError("A branded Desktop model ingress host is required");
  if (typeof content !== "string")
    throw new TypeError("Desktop model source must be text");
  try {
    const { captureAgentEvolutionRuntimeComposition } = await import(
      captured.moduleUrl
    );
    const runId = `desktop-model-${randomUUID()}`;
    const composition = captureAgentEvolutionRuntimeComposition(
      await captured.factory(
        Object.freeze({
          mode: "desktop-model",
          runId,
          taskId: runId,
          cwd: process.cwd(),
        }),
      ),
    );
    const ingress = composition.evolutionIngress;
    if (
      composition.runId !== runId ||
      ingress.runId !== runId ||
      composition.tenantId !== ingress.tenantId
    ) {
      throw new Error(
        "Desktop model composition is not bound to the requested Run",
      );
    }
    await ingress.start();
    await ingress.ingestUserPrompt({ content, source: "desktop-model" });
    return ingress;
  } catch (cause) {
    const error = new Error("Desktop model evolution admission failed", {
      cause,
    });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

/**
 * Opens a Desktop Run for an Agent v3 model request. Unlike openDesktopModelRun
 * this delegates the complete request to the CLI ingress' authenticated
 * prepareModelRequest() path, which can persist opaque image blocks as
 * digest-bound transport commitments before restoring them for a provider.
 * Callers must not dispatch the returned request until this promise resolves.
 */
async function openDesktopMultimodalModelRun(host, request) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError("A branded Desktop model ingress host is required");
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Desktop multimodal model request must be an object");
  }
  try {
    const { captureAgentEvolutionRuntimeComposition } = await import(
      captured.moduleUrl
    );
    const runId = `desktop-multimodal-model-${randomUUID()}`;
    const composition = captureAgentEvolutionRuntimeComposition(
      await captured.factory(
        Object.freeze({
          mode: "desktop-multimodal-model",
          runId,
          taskId: runId,
          cwd: process.cwd(),
        }),
      ),
    );
    const ingress = composition.evolutionIngress;
    if (
      composition.runId !== runId ||
      ingress.runId !== runId ||
      composition.tenantId !== ingress.tenantId ||
      typeof ingress.prepareModelRequest !== "function"
    ) {
      throw new Error(
        "Desktop multimodal composition is not bound to the requested Run",
      );
    }
    await ingress.start();
    const prepared = await ingress.prepareModelRequest(request);
    return Object.freeze({ ingress, request: prepared });
  } catch (cause) {
    const error = new Error("Desktop multimodal evolution admission failed", {
      cause,
    });
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
}

module.exports = {
  createDesktopModelIngressHost,
  isDesktopModelIngressHost,
  openDesktopModelRun,
  openDesktopMultimodalModelRun,
  bindDesktopModelIngressClient,
  prepareDesktopModelRequest,
  runDesktopOllamaRequest,
  consumeDesktopGeminiStream,
  runDesktopModelWorkflow,
  runDesktopToolExecution,
  consumeDesktopToolStream,
  assertDesktopToolLoopComplete,
  runDesktopCachedModelWorkflow,
  runDesktopFunctionWorkflow,
};
