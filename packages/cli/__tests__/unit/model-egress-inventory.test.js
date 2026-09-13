import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
);

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listSourceFiles(filePath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [filePath] : [];
  });
}

function sourcePath(filePath) {
  return relative(sourceRoot, filePath).replaceAll("\\", "/");
}

function importsSourceModule(source, basename) {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:\\bfrom\\s+["'][^"']*${escaped}["']|\\bimport\\(\\s*["'][^"']*${escaped}["']\\s*\\))`,
    "u",
  ).test(source);
}

const ENDPOINT_CANDIDATES = new Set([
  "commands/ask.js",
  "commands/llm.js",
  "harness/remote-session-push-fcm.js",
  "harness/remote-session-push-huawei.js",
  "lib/chat-core.js",
  "lib/cowork-adapter.js",
  "lib/evolution/governed-hub-llm.js",
  "lib/hub-llm-client.js",
  "lib/llm-connection-probe.js",
  "lib/llm-providers.js",
  "lib/provider-stream.js",
  "runtime/agent-core.js",
]);

const DIRECT_BOUNDARIES = new Map([
  ["commands/ask.js", "captureAgentEvolutionIngress"],
  ["lib/cowork-adapter.js", "captureAgentEvolutionIngress"],
  ["lib/evolution/governed-hub-llm.js", "prepareGovernedModelTurn"],
  [
    "lib/evolution/governed-skill-synthesis-provider-chat.js",
    "evolutionIngress: options.evolutionIngress",
  ],
  ["runtime/agent-core.js", "evolutionIngress.prepareModelRequest"],
]);

const RAW_TRANSPORT_IMPORTERS = new Map([
  [
    "lib/chat-core.js",
    new Map([
      ["commands/chat.js", "chatgov-enums-v2"],
      ["gateways/ws/llm-chat-protocol.js", "prepareGovernedModelTurn"],
      ["lib/chat-intent-service.js", "prepareGovernedModelTurn"],
      ["lib/ws-chat-handler.js", "prepareGovernedModelTurn"],
      ["repl/chat-repl.js", "evolutionIngress.prepareModelRequest"],
    ]),
  ],
  [
    "lib/hub-llm-client.js",
    new Map([
      ["commands/hub.js", "isCloudHubConfigured"],
      ["lib/personal-data-hub-wiring.js", "createGovernedHubLlm"],
    ]),
  ],
  [
    "lib/provider-stream.js",
    new Map([
      ["commands/stream.js", "prepareGovernedModelTurn"],
      ["gateways/ws/session-core-protocol.js", "prepareGovernedModelTurn"],
    ]),
  ],
]);

const PROBE_ONLY = new Set([
  "commands/llm.js",
  "lib/llm-connection-probe.js",
  "lib/llm-providers.js",
]);

const NON_MODEL_ENDPOINTS = new Set([
  "harness/remote-session-push-fcm.js",
  "harness/remote-session-push-huawei.js",
]);

const MODEL_EGRESS = new Set([
  ...ENDPOINT_CANDIDATES,
  "lib/evolution/governed-skill-synthesis-provider-chat.js",
]);

describe("CLI model egress inventory", () => {
  const sourceFiles = listSourceFiles(sourceRoot);

  it("registers every source file that combines fetch with a model-shaped endpoint", () => {
    const endpoints = [
      "/api/chat",
      "/api/generate",
      "/chat/completions",
      "/messages",
      "/responses",
      ":generateContent",
    ];
    const actual = sourceFiles
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        const fetches =
          source.includes("fetch(") ||
          source.includes("fetchImpl(") ||
          source.includes("_fetchWithTimeout(");
        return (
          fetches && endpoints.some((endpoint) => source.includes(endpoint))
        );
      })
      .map(sourcePath)
      .sort();
    expect(actual).toEqual([...ENDPOINT_CANDIDATES].sort());
  });

  it("keeps direct content-bearing egress behind an authenticated ingress", () => {
    for (const [relativePath, boundary] of DIRECT_BOUNDARIES) {
      const source = readFileSync(join(sourceRoot, relativePath), "utf8");
      expect(source, relativePath).toContain(boundary);
    }
  });

  it("keeps raw transports private to audited governed callers", () => {
    for (const [transport, expectedImporters] of RAW_TRANSPORT_IMPORTERS) {
      const basename = transport.slice(transport.lastIndexOf("/") + 1);
      const importers = sourceFiles
        .filter((filePath) => sourcePath(filePath) !== transport)
        .filter((filePath) =>
          importsSourceModule(readFileSync(filePath, "utf8"), basename),
        )
        .map(sourcePath)
        .sort();
      expect(importers, transport).toEqual(
        [...expectedImporters.keys()].sort(),
      );
      for (const [importer, boundary] of expectedImporters) {
        const source = readFileSync(join(sourceRoot, importer), "utf8");
        expect(source, importer).toContain(boundary);
        if (importer === "commands/chat.js") {
          expect(source).not.toMatch(
            /\b(?:chatStream|chatWithStreaming|streamOllama|streamOpenAI|streamAnthropic)\s*\(/u,
          );
        }
        if (importer === "commands/hub.js") {
          expect(source).not.toMatch(
            /\b(?:openAiCompatChat|anthropicChat|buildCliHubLLM)\s*\(/u,
          );
        }
      }
    }
  });

  it("classifies every endpoint candidate as governed, raw, probe-only, or non-model", () => {
    const classified = new Set([
      ...DIRECT_BOUNDARIES.keys(),
      ...RAW_TRANSPORT_IMPORTERS.keys(),
      ...PROBE_ONLY,
      ...NON_MODEL_ENDPOINTS,
    ]);
    expect([...classified].sort()).toEqual([...MODEL_EGRESS].sort());
  });

  it("keeps connection probes on fixed non-user prompts", () => {
    expect(
      readFileSync(join(sourceRoot, "lib/llm-connection-probe.js"), "utf8"),
    ).toContain('content: "Say hi in one word."');
    expect(
      readFileSync(join(sourceRoot, "lib/llm-providers.js"), "utf8"),
    ).toContain('prompt: "Hi"');
  });
});
