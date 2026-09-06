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
    await prepared.complete(chat ? data.message : content);
    return {
      ...(chat
        ? { message: data.message }
        : { text: content, context: data.context }),
      model: data.model,
      done: data.done,
      total_duration: data.total_duration,
      tokens: data.eval_count || 0,
    };
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
      async complete(message) {
        try {
          await ingress.ingestAgentEvent({
            type: "response-complete",
            content:
              typeof message === "string" ? message : JSON.stringify(message),
          });
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

module.exports = {
  createDesktopModelIngressHost,
  isDesktopModelIngressHost,
  openDesktopModelRun,
  bindDesktopModelIngressClient,
  prepareDesktopModelRequest,
  runDesktopOllamaRequest,
  consumeDesktopGeminiStream,
  runDesktopModelWorkflow,
  runDesktopToolExecution,
  consumeDesktopToolStream,
  assertDesktopToolLoopComplete,
};
