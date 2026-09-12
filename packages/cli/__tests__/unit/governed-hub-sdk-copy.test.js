import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGovernedHubLlm,
  captureGovernedHubSdkPorts,
} from "../../src/lib/evolution/governed-hub-llm.js";
import { createTestAgentEvolutionComposition } from "../fixtures/agent-evolution-test-deployment.js";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const sourceSdkRoot = path.join(repositoryRoot, "packages/personal-data-hub");
const sourceMain = path.join(
  repositoryRoot,
  "desktop-app-vue/src/main/evolution/desktop-model-ingress.js",
);
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

async function copiedDesktop(mode) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-hub-sdk-copy-"),
  );
  roots.push(root);
  const appRoot = path.join(root, "app");
  const sdkRoot = path.join(
    appRoot,
    "node_modules/@chainlesschain/personal-data-hub",
  );
  // Real files in a separate physical package directory, not a symlink, mock,
  // shared global brand, or altered SDK. Only unrelated adapters are omitted.
  for (const relative of [
    "package.json",
    "lib/model-egress-guard.js",
    "lib/llm-client.js",
    "lib/bridges/cc-llm-adapter.js",
    "lib/entity-resolver",
    "lib/analysis-skills/base.js",
  ]) {
    const destination = path.join(sdkRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(sourceSdkRoot, relative), destination, {
      recursive: true,
    });
  }
  const mainPath = path.join(
    appRoot,
    "dist/main/evolution/desktop-model-ingress.js",
  );
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.copyFileSync(sourceMain, mainPath);
  const appRequire = createRequire(mainPath);
  const bridge = appRequire(mainPath);
  const guard = appRequire(
    "@chainlesschain/personal-data-hub/model-egress-guard",
  );
  const { OllamaClient } = appRequire(
    "@chainlesschain/personal-data-hub/llm-client",
  );
  const { CcLLMAdapter } = appRequire(
    "@chainlesschain/personal-data-hub/bridges/cc-llm-adapter",
  );
  const sdk = appRequire("@chainlesschain/personal-data-hub/entity-resolver");
  const { AnalysisSkill } = appRequire(
    path.join(sdkRoot, "lib/analysis-skills/base.js"),
  );
  expect(fs.lstatSync(sdkRoot).isSymbolicLink()).toBe(false);
  expect(
    appRequire.resolve("@chainlesschain/personal-data-hub/model-egress-guard"),
  ).not.toBe(
    require.resolve("@chainlesschain/personal-data-hub/model-egress-guard"),
  );
  expect(guard.createAuthenticatedEvolutionModelClient).not.toBe(
    require("@chainlesschain/personal-data-hub/model-egress-guard")
      .createAuthenticatedEvolutionModelClient,
  );

  // The CJS Desktop bridge imports native ESM. Construct the actual composition
  // in that same native realm, preserving its separate private authority brand.
  const native = await require("../helpers/native-evolution-composition.cjs")();
  const runs = [];
  const factory = vi.fn(async (context) => {
    const composition = createTestAgentEvolutionComposition(
      (config) => {
        const issue = config.authorities.sourceEnvelope.issue;
        config.authorities.sourceEnvelope.issue = async (request) => {
          if (
            (mode === "source-denied" && request.kind === "user-prompt") ||
            (mode === "response-denied" &&
              request.kind === "response-completed")
          )
            throw new Error("test source authority denied");
          return issue(request);
        };
        return native.createAgentEvolutionRuntimeComposition(config);
      },
      context,
      path.join(root, "state"),
    );
    runs.push(composition);
    return composition;
  });
  // Exercise the actual packaged-path branch using the existing CLI source
  // tree as resources. Its SDK remains physically distinct from the app copy.
  const host = bridge.createDesktopModelIngressHost(factory, {
    isPackaged: true,
    resourcesPath: repositoryRoot,
  });
  return {
    bridge,
    guard,
    host,
    sdk,
    OllamaClient,
    CcLLMAdapter,
    AnalysisSkill,
    factory,
    runs,
  };
}

async function modelEndpoint() {
  const requests = [];
  let embeddingCalls = 0;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ path: request.url, body });
    const result =
      request.url === "/api/embeddings"
        ? {
            embedding: ++embeddingCalls === 1 ? [1, 0] : [0.7, Math.sqrt(0.51)],
          }
        : request.url === "/api/chat"
          ? {
              done: true,
              message: {
                content: '{"same":true,"confidence":0.9,"reason":"matched"}',
              },
            }
          : { content: "safe commentary" };
    response.writeHead(200, {
      "Content-Type": "application/json",
      Connection: "close",
    });
    response.end(JSON.stringify(result));
  });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

function rendererOptions() {
  const readPorts = vi.fn(() => {
    throw new Error("renderer SDK ports must not be read");
  });
  const options = {};
  Object.defineProperty(options, "sdkPorts", {
    get: readPorts,
    enumerable: true,
  });
  Object.defineProperty(options, "createAuthenticatedEvolutionModelClient", {
    get: readPorts,
    enumerable: true,
  });
  return { options, readPorts };
}

describe("Desktop Hub with physically distinct SDK copies", () => {
  it.each(["success", "source-denied", "response-denied", "foreign-host"])(
    "runs the app-copy skill with main-owned SDK ports (%s)",
    async (mode) => {
      const f = await copiedDesktop(mode);
      const wire = await modelEndpoint();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const selectedClient = { baseURL: wire.baseUrl, model: "test-model" };
      const llm = new f.CcLLMAdapter({
        getActiveProvider: () => "ollama",
        getActiveModel: () => "test-model",
        getActiveClient: () => selectedClient,
        chat: async (messages, options) => {
          expect(options.skipCache).toBe(true);
          return (
            await fetch(`${wire.baseUrl}/desktop-chat`, {
              method: "POST",
              body: JSON.stringify({ messages }),
            })
          ).json();
        },
      });
      expect(llm).not.toBeInstanceOf(
        require("@chainlesschain/personal-data-hub/bridges/cc-llm-adapter")
          .CcLLMAdapter,
      );
      await expect(llm.chat([])).rejects.toMatchObject({ code: ERROR_CODE });
      const wrongCopyClient = createGovernedHubLlm(llm, f.factory);
      expect(() =>
        f.guard.assertAuthenticatedEvolutionModelEgress(wrongCopyClient),
      ).toThrow(expect.objectContaining({ code: ERROR_CODE }));
      expect(f.factory).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      const { options, readPorts } = rendererOptions();
      const runSkill = async ({ vault, llm: scoped }) => {
        f.guard.assertAuthenticatedEvolutionModelEgress(scoped);
        const skill = new f.AnalysisSkill({ vault, llm: scoped });
        return {
          answer: await skill.callLlmCommentary(
            [{ role: "user", content: "Summarize owner@example.com" }],
            { skipCache: true },
          ),
        };
      };
      const host =
        mode === "foreign-host"
          ? require(sourceMain).createDesktopModelIngressHost(f.factory)
          : f.host;
      const operation = f.bridge.runDesktopGovernedHubSkill(
        host,
        { vault: {}, llm },
        runSkill,
        "test",
        options,
      );
      if (mode === "success") {
        await expect(operation).resolves.toEqual({ answer: "safe commentary" });
        expect(f.runs[0].loadRun().projection.status).toBe("completed");
      } else {
        await expect(operation).rejects.toThrow();
        if (f.runs.length)
          expect(f.runs.at(-1).loadRun().projection?.status).not.toBe(
            "completed",
          );
      }
      const count = ["success", "response-denied"].includes(mode) ? 1 : 0;
      expect(fetchSpy).toHaveBeenCalledTimes(count);
      expect(wire.requests).toHaveLength(count);
      expect(readPorts).not.toHaveBeenCalled();
      expect(JSON.stringify(wire.requests)).not.toContain("owner@example.com");
      await expect(llm.chat([])).rejects.toMatchObject({ code: ERROR_CODE });
    },
  );

  it.each(["success", "source-denied", "response-denied", "foreign-host"])(
    "uses app-copy embedding and LLM brands for resolver drain (%s)",
    async (mode) => {
      const f = await copiedDesktop(mode);
      const wire = await modelEndpoint();
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
      const embeddingStage = new f.sdk.EntityResolverEmbeddingStage({
        vault,
        ollamaUrl: wire.baseUrl,
      });
      const llm = new f.OllamaClient({
        baseUrl: wire.baseUrl,
        model: "test-model",
      });
      await expect(embeddingStage.compare(...people)).rejects.toMatchObject({
        code: ERROR_CODE,
      });
      await expect(llm.chat([])).rejects.toMatchObject({ code: ERROR_CODE });
      const ports = {
        resolver: new f.sdk.EntityResolver({
          vault,
          embeddingStage: embeddingStage.asStageFn(),
          llmStage: new f.sdk.EntityResolverLLMStage({ llm }).asStageFn(),
        }),
        llm,
        embeddingStage,
        EntityResolver: f.sdk.EntityResolver,
        EmbeddingStage: f.sdk.EntityResolverEmbeddingStage,
        LLMStage: f.sdk.EntityResolverLLMStage,
      };
      const { options, readPorts } = rendererOptions();
      const host =
        mode === "foreign-host"
          ? require(sourceMain).createDesktopModelIngressHost(f.factory)
          : f.host;
      const operation = f.bridge.runDesktopGovernedHubResolverDrain(
        host,
        ports,
        options,
      );
      if (mode === "foreign-host")
        await expect(operation).rejects.toThrow(/branded/);
      else if (mode === "success") {
        await expect(operation).resolves.toMatchObject({
          processed: 1,
          same: 1,
          error: 0,
        });
        expect(vault.mergePair).toHaveBeenCalledOnce();
        expect(f.runs).toHaveLength(3);
        for (const run of f.runs)
          expect(run.loadRun().projection.status).toBe("completed");
      } else {
        await expect(operation).resolves.toMatchObject({
          processed: 0,
          same: 0,
          error: 1,
        });
        expect(vault.mergePair).not.toHaveBeenCalled();
        expect(vault.completeResolve).not.toHaveBeenCalled();
        expect(f.runs.at(-1).loadRun().projection?.status).not.toBe(
          "completed",
        );
      }
      const count = mode === "success" ? 3 : mode === "response-denied" ? 1 : 0;
      expect(fetchSpy).toHaveBeenCalledTimes(count);
      expect(wire.requests).toHaveLength(count);
      expect(readPorts).not.toHaveBeenCalled();
      expect(JSON.stringify(wire.requests)).not.toContain("@example.com");
      await expect(embeddingStage._embed("private")).rejects.toMatchObject({
        code: ERROR_CODE,
      });
      await expect(llm.chat([])).rejects.toMatchObject({ code: ERROR_CODE });
    },
  );

  it("rejects accessor or proxy SDK ports without invoking them", () => {
    const getter = vi.fn();
    expect(() =>
      captureGovernedHubSdkPorts(
        Object.defineProperty({}, "createAuthenticatedEvolutionModelClient", {
          get: getter,
        }),
      ),
    ).toThrow(/data property/);
    expect(() => captureGovernedHubSdkPorts(new Proxy({}, {}))).toThrow(
      /SDK ports/,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
