import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentEvolutionRuntimeComposition } from "../../src/lib/evolution/agent-evolution-runtime-composition.js";
import { createGovernedHubLlm } from "../../src/lib/evolution/governed-hub-llm.js";
import { createGovernedHubResolver } from "../../src/lib/evolution/governed-hub-resolver.js";
import { createTestAgentEvolutionComposition } from "../fixtures/agent-evolution-test-deployment.js";

// These cases exercise the production brand and projection, never the implicit
// test ingress installed for unrelated legacy model tests.
vi.unmock("../../src/lib/evolution/agent-evolution-ingress.js");
vi.unmock(
  "../../src/lib/evolution/agent-evolution-runtime-composition-brand.js",
);
vi.unmock("../../src/lib/evolution/governed-model-turn.js");

const require = createRequire(import.meta.url);
const {
  OllamaClient,
} = require("@chainlesschain/personal-data-hub/llm-client");
const {
  CcLLMAdapter,
} = require("@chainlesschain/personal-data-hub/bridges/cc-llm-adapter");
const {
  AnalysisEngine,
} = require("@chainlesschain/personal-data-hub/analysis");
const sdk = require("@chainlesschain/personal-data-hub/entity-resolver");
const ERROR_CODE = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
const roots = [];
const servers = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

async function endpoint(respond) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: request.url, body });
    response.writeHead(200, {
      "Content-Type": "application/json",
      Connection: "close",
    });
    response.end(JSON.stringify(respond(request.url, body)));
  });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

function authority(mode, mutate) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-governed-hub-default-"),
  );
  roots.push(root);
  const runs = [];
  const factory = vi.fn(async (context) => {
    if (mode === "unbranded")
      return {
        runId: context.runId,
        tenantId: "unbranded",
        evolutionIngress: {},
      };
    const composition = createTestAgentEvolutionComposition(
      (config) => {
        const issue = config.authorities.sourceEnvelope.issue;
        config.authorities.sourceEnvelope.issue = async (request) => {
          const stage =
            context.mode === "hub-embedding" ? "embedding" : "model";
          if (
            ((mode === "source-denied" || mode === `${stage}-source-denied`) &&
              request.kind === "user-prompt") ||
            ((mode === "response-denied" ||
              mode === `${stage}-response-denied`) &&
              request.kind === "response-completed")
          )
            throw new Error("test evidence authority denied");
          return issue(request);
        };
        if (mode === "wrong-run") config.runId = "borrowed-run";
        return createAgentEvolutionRuntimeComposition(config);
      },
      context,
      root,
    );
    runs.push(composition);
    mutate?.(context);
    return composition;
  });
  return { factory, runs };
}

function analysisVault() {
  return {
    queryEvents: () => [
      {
        id: "note-1",
        type: "event",
        subtype: "note",
        occurredAt: Date.now(),
        content: { title: "private note", text: "owner@example.com" },
        source: {
          adapter: "test",
          adapterVersion: "1",
          capturedAt: Date.now(),
          capturedBy: "test",
        },
      },
    ],
    queryPersons: () => [],
    queryItems: () => [],
    audit: vi.fn(),
  };
}

describe("governed Hub default SDK adapters", () => {
  it.each([
    ["http://LOCALHOST:11434", true],
    ["http://127.17.3.1:11434", true],
    ["http://[::1]:11434", true],
    ["https://provider.example", false],
    ["https://localhost.provider.example", false],
  ])(
    "derives Ollama locality from the parsed endpoint %s",
    (baseUrl, expected) => {
      const original = new OllamaClient({ baseUrl });
      const factory = vi.fn();
      expect(createGovernedHubLlm(original, factory).isLocal).toBe(expected);
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "requires explicit consent before remote Ollama admission (%s)",
    async (acceptNonLocal) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const original = new OllamaClient({
        baseUrl: "https://provider.example",
        model: "test-model",
      });
      const f = authority("source-denied");
      const wrapped = createGovernedHubLlm(original, f.factory);
      const vault = analysisVault();
      const read = vi.spyOn(vault, "queryEvents");
      const engine = new AnalysisEngine({ vault, llm: wrapped });
      expect(original.isLocal).toBe(true);
      expect(wrapped.isLocal).toBe(false);
      const operation = engine.ask("Summarize notes", { acceptNonLocal });
      if (acceptNonLocal) {
        await expect(operation).rejects.toMatchObject({ code: ERROR_CODE });
        expect(f.factory).toHaveBeenCalledOnce();
      } else {
        await expect(operation).rejects.toThrow(/non-local/);
        expect(f.factory).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("rejects default remote embeddings before Run creation or transport", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const factory = vi.fn();
    const vault = {};
    const embeddingStage = new sdk.EntityResolverEmbeddingStage({
      ollamaUrl: "https://provider.example",
    });
    expect(() =>
      createGovernedHubResolver(
        {
          resolver: new sdk.EntityResolver({ vault }),
          embeddingStage,
          EntityResolver: sdk.EntityResolver,
          EmbeddingStage: sdk.EntityResolverEmbeddingStage,
          LLMStage: sdk.EntityResolverLLMStage,
        },
        factory,
      ),
    ).toThrow(expect.objectContaining({ code: ERROR_CODE }));
    expect(factory).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["http://LOCALHOST:11434", true],
    ["http://127.17.3.1:11434", true],
    ["http://[::1]:11434", true],
    ["https://provider.example", false],
    ["https://localhost.provider.example", false],
    [undefined, false],
  ])(
    "derives Desktop locality from its selected client URL %s",
    (baseURL, expected) => {
      const client = { baseURL, client: { defaults: { baseURL } } };
      const llm = new CcLLMAdapter({
        getActiveProvider: () => "ollama",
        getActiveClient: () => client,
        chat: vi.fn(),
      });
      expect(createGovernedHubLlm(llm, vi.fn()).isLocal).toBe(expected);
    },
  );

  it.each(["remote", "no-client", "no-endpoint", "mismatched-http"])(
    "refuses unconsented Desktop egress before vault, Run or transport (%s)",
    async (mode) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const chat = vi.fn();
      const factory = vi.fn();
      const baseURL =
        mode === "no-endpoint" ? undefined : "https://provider.example";
      const client = {
        baseURL:
          mode === "mismatched-http" ? "http://localhost:11434" : baseURL,
        model: "same-model",
        client: { defaults: { baseURL } },
      };
      const llm = new CcLLMAdapter({
        getActiveProvider: () => "ollama",
        getActiveClient: mode === "no-client" ? undefined : () => client,
        chat,
      });
      const vault = analysisVault();
      const read = vi.spyOn(vault, "queryEvents");
      expect(llm.isLocal).toBe(true); // SDK declaration alone is not evidence.
      if (mode === "mismatched-http") {
        expect(() => createGovernedHubLlm(llm, factory)).toThrow(
          /does not match/,
        );
      } else {
        const engine = new AnalysisEngine({
          vault,
          llm: createGovernedHubLlm(llm, factory),
        });
        await expect(
          engine.ask("private question", { acceptNonLocal: false }),
        ).rejects.toThrow(/non-local/);
      }
      expect(read).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(
    ["endpoint", "http-endpoint", "same-name-client", "getter"].flatMap(
      (field) =>
        ["before-prepare", "during-prepare"].map((phase) => [field, phase]),
    ),
  )(
    "rejects Desktop %s mutation %s with zero transport",
    async (field, phase) => {
      let client = {
        baseURL: "http://localhost:11434",
        model: "same-model",
        client: { defaults: { baseURL: "http://localhost:11434" } },
      };
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const chat = vi.fn();
      const llm = new CcLLMAdapter({
        name: "unchanged-identity",
        getActiveProvider: () => "ollama",
        getActiveModel: () => "same-model",
        getActiveClient: () => client,
        chat,
      });
      const mutate = () => {
        if (field === "endpoint") client.baseURL = "https://provider.example";
        if (field === "http-endpoint")
          client.client.defaults.baseURL = "https://provider.example";
        if (field === "same-name-client")
          client = {
            ...client,
            client: { defaults: { ...client.client.defaults } },
          };
        if (field === "getter") llm._getActiveClient = () => client;
      };
      const f = authority(
        "success",
        phase === "during-prepare" ? mutate : null,
      );
      const vault = analysisVault();
      const read = vi.spyOn(vault, "queryEvents");
      const wrapped = createGovernedHubLlm(llm, f.factory);
      const engine = new AnalysisEngine({ vault, llm: wrapped });
      if (phase === "before-prepare") mutate();
      await expect(engine.ask("private question")).rejects.toThrow(
        /identity changed/,
      );
      if (phase === "before-prepare") {
        expect(read).not.toHaveBeenCalled();
        expect(f.factory).not.toHaveBeenCalled();
      } else {
        expect(f.factory).toHaveBeenCalledOnce();
        expect(f.runs[0].loadRun().projection.status).not.toBe("completed");
      }
      expect(chat).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(
    ["ollama", "desktop"].flatMap((adapter) =>
      [
        "success",
        "source-denied",
        "response-denied",
        "wrong-run",
        "unbranded",
        "invalid-response",
        "provider-changed",
      ].map((mode) => [adapter, mode]),
    ),
  )(
    "drives the real %s adapter through a branded Run (%s)",
    async (adapter, mode) => {
      const wire = await endpoint(() =>
        mode === "invalid-response"
          ? { done: false }
          : {
              done: true,
              message: { role: "assistant", content: "safe answer" },
              prompt_eval_count: 4,
              eval_count: 2,
              usage: {
                prompt_tokens: 4,
                completion_tokens: 2,
                total_tokens: 6,
              },
            },
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      let provider = "ollama";
      const selectedClient = { baseURL: wire.baseUrl, model: "test-model" };
      const original =
        adapter === "ollama"
          ? new OllamaClient({ baseUrl: wire.baseUrl, model: "test-model" })
          : new CcLLMAdapter({
              getActiveProvider: () => provider,
              getActiveModel: () => "test-model",
              getActiveClient: () => selectedClient,
              chat: async (messages, options) => {
                expect(options.skipCache).toBe(true);
                const response = await fetch(`${wire.baseUrl}/desktop-chat`, {
                  method: "POST",
                  body: JSON.stringify({ messages }),
                  signal: options.signal,
                });
                return response.json();
              },
            });
      await expect(
        original.chat([{ role: "user", content: "owner@example.com" }]),
      ).rejects.toMatchObject({ code: ERROR_CODE });
      expect(fetchSpy).not.toHaveBeenCalled();

      const f = authority(
        mode,
        mode === "provider-changed"
          ? () => {
              if (adapter === "ollama") original.baseUrl = "http://127.0.0.1:1";
              else provider = "openai";
            }
          : null,
      );
      const wrapped = createGovernedHubLlm(original, f.factory);
      const engine = new AnalysisEngine({
        vault: analysisVault(),
        llm: wrapped,
      });
      const operation = engine.ask("Summarize notes for owner@example.com");
      if (mode === "success") {
        await expect(operation).resolves.toMatchObject({
          answer: "safe answer",
          usage: { totalTokens: 6 },
        });
        expect(f.runs[0].loadRun().projection.status).toBe("completed");
        expect(
          f.runs[0]
            .loadRun()
            .events.map((event) => event.data?.evidenceKind)
            .filter(Boolean),
        ).toEqual(["user-prompt", "model-input", "response-completed"]);
      } else {
        await expect(operation).rejects.toThrow();
        if (f.runs.length)
          expect(f.runs.at(-1).loadRun().projection?.status).not.toBe(
            "completed",
          );
      }
      const expectedCalls = [
        "success",
        "response-denied",
        "invalid-response",
      ].includes(mode)
        ? 1
        : 0;
      expect(fetchSpy).toHaveBeenCalledTimes(expectedCalls);
      expect(wire.requests).toHaveLength(expectedCalls);
      expect(JSON.stringify(wire.requests)).not.toContain("owner@example.com");
      if (expectedCalls)
        expect(wire.requests[0].body.messages[0].role).toBe("system");
      await expect(original.chat([])).rejects.toMatchObject({
        code: ERROR_CODE,
      });
    },
  );

  it.each([
    "success",
    "embedding-source-denied",
    "embedding-response-denied",
    "model-source-denied",
    "model-response-denied",
    "wrong-run",
    "invalid-vector",
    "provider-changed",
  ])(
    "drains with actual Ollama embedding and chat clients (%s)",
    async (mode) => {
      let embeddingCalls = 0;
      const wire = await endpoint((url) => {
        if (url === "/api/embeddings") {
          embeddingCalls += 1;
          return {
            embedding:
              mode === "invalid-vector"
                ? []
                : embeddingCalls === 1
                  ? [1, 0]
                  : [0.7, Math.sqrt(0.51)],
          };
        }
        return {
          done: true,
          message: {
            content: '{"same":true,"confidence":0.9,"reason":"matched"}',
          },
        };
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const people = ["a", "b"].map((id) => ({
        id,
        type: "person",
        names: ["Shared name"],
        identifiers: { email: `${id}@example.com` },
      }));
      const vault = {
        _requireOpen: () => ({ prepare: () => ({ all: () => [{ id: "b" }] }) }),
        claimResolveBatch: () => [{ id: "queue", person_id: "a" }],
        getPerson: (id) => people.find((person) => person.id === id),
        getResolveDecision: () => null,
        queryEvents: () => [],
        recordResolveDecision: vi.fn(),
        mergePair: vi.fn(),
        enqueueReview: vi.fn(),
        completeResolve: vi.fn(),
        errorResolve: vi.fn(),
      };
      const embeddingStage = new sdk.EntityResolverEmbeddingStage({
        vault,
        ollamaUrl: wire.baseUrl,
        model: "nomic-embed-text",
      });
      const llm = new OllamaClient({
        baseUrl: wire.baseUrl,
        model: "test-model",
      });
      await expect(
        embeddingStage.compare(people[0], people[1]),
      ).rejects.toMatchObject({ code: ERROR_CODE });
      expect(fetchSpy).not.toHaveBeenCalled();
      const original = new sdk.EntityResolver({
        vault,
        embeddingStage: embeddingStage.asStageFn(),
        llmStage: new sdk.EntityResolverLLMStage({ llm }).asStageFn(),
      });
      const f = authority(
        mode,
        mode === "provider-changed"
          ? () => {
              embeddingStage._model = "other-model";
            }
          : null,
      );
      const scoped = createGovernedHubResolver(
        {
          resolver: original,
          llm,
          embeddingStage,
          EntityResolver: sdk.EntityResolver,
          EmbeddingStage: sdk.EntityResolverEmbeddingStage,
          LLMStage: sdk.EntityResolverLLMStage,
        },
        f.factory,
      );
      const result = await scoped.drain();
      if (mode === "success") {
        expect(result).toMatchObject({ processed: 1, same: 1, error: 0 });
        expect(vault.mergePair).toHaveBeenCalledOnce();
        expect(f.runs).toHaveLength(3);
        for (const run of f.runs)
          expect(run.loadRun().projection.status).toBe("completed");
      } else {
        expect(result).toMatchObject({ processed: 0, same: 0, error: 1 });
        expect(vault.mergePair).not.toHaveBeenCalled();
        expect(vault.completeResolve).not.toHaveBeenCalled();
        expect(vault.errorResolve).toHaveBeenCalledOnce();
        expect(f.runs.at(-1).loadRun().projection?.status).not.toBe(
          "completed",
        );
      }
      const expectedCalls = [
        "embedding-source-denied",
        "wrong-run",
        "provider-changed",
      ].includes(mode)
        ? 0
        : ["embedding-response-denied", "invalid-vector"].includes(mode)
          ? 1
          : mode === "model-source-denied"
            ? 2
            : 3;
      expect(fetchSpy).toHaveBeenCalledTimes(expectedCalls);
      expect(wire.requests).toHaveLength(expectedCalls);
      expect(JSON.stringify(wire.requests)).not.toContain("@example.com");
      expect(embeddingStage._cache.size).toBe(0);
      await expect(
        embeddingStage._embed("private profile"),
      ).rejects.toMatchObject({ code: ERROR_CODE });
      await expect(llm.chat([])).rejects.toMatchObject({ code: ERROR_CODE });
    },
  );
});
