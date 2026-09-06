"use strict";

const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { StringDecoder } = require("node:string_decoder");

const hosts = new WeakMap();
const clients = new WeakMap();

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

async function prepareDesktopModelRequest(client, body) {
  const host = clients.get(client);
  if (!host) return null;
  try {
    // Capture the final wire payload, after client-specific tool filtering.
    const captured = JSON.parse(JSON.stringify(body));
    const ingress = await openDesktopModelRun(host, JSON.stringify(captured));
    const messages = Array.isArray(captured.messages)
      ? captured.messages
      : [{ role: "user", content: captured.prompt }];
    const projected = await ingress.prepareModelRequest({
      messages,
      tools: captured.tools || [],
    });
    if (Array.isArray(captured.messages))
      captured.messages = projected.messages;
    else captured.prompt = projected.messages[0].content;
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
          await ingress.complete();
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
};
