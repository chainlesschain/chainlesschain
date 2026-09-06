"use strict";

const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
};
