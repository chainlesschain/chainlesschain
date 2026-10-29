import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import { chatWithTools } from "../helpers/test-model-egress.js";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";

const temporaryParent = fs.realpathSync.native(os.tmpdir());
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(temporaryParent, "cc-semantic-recall-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (
    path.dirname(directory) !== temporaryParent ||
    !path.basename(directory).startsWith("cc-semantic-recall-")
  )
    throw new Error("Unsafe semantic recall fixture cleanup");
  fs.rmSync(directory, { recursive: true, force: true });
});

function options(overrides = {}) {
  return {
    provider: "ollama",
    model: "qwen2.5:7b",
    baseUrl: "http://semantic-recall.invalid",
    sessionId: "semantic-stop",
    contextMemoryEnv: {
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    },
    contextMemoryFilePath: path.join(directory, "memory.json"),
    contextMemoryModelWindowTokens: 8192,
    contextMemorySelectedToolNames: [],
    ...overrides,
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function observeBeforeNextTurn(promise) {
  const outcome = deferred();
  promise.then(
    (value) => outcome.resolve({ value }),
    (error) => outcome.resolve({ error }),
  );
  return Promise.race([
    outcome.promise,
    new Promise((resolve) => setImmediate(() => resolve({ pending: true }))),
  ]);
}

describe("semantic Memory candidate cancellation", () => {
  it.each(["resolve", "reject"])(
    "rejects Stop while an uncooperative source is pending, before late %s",
    async (late) => {
      const controller = new AbortController();
      const entered = deferred();
      const source = deferred();
      let hostOptions;
      const fetch = vi.fn(() => {
        throw new Error("provider must not run after Stop");
      });
      vi.stubGlobal("fetch", fetch);
      const settings = options({
        signal: controller.signal,
        contextMemorySemanticCandidateProvider: (_request, controls) => {
          hostOptions = controls;
          entered.resolve();
          return source.promise;
        },
      });
      const pending = chatWithTools(
        [{ role: "user", content: "Recall the task rules" }],
        settings,
      );
      // Observe errors immediately, including a prompt cancellation.
      const settled = pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await entered.promise;
      controller.abort();
      const beforeLateSettlement = await observeBeforeNextTurn(settled);
      if (late === "resolve") source.resolve([]);
      else source.reject(new Error("late semantic index failure"));
      const final = await settled;
      expect(beforeLateSettlement.pending).not.toBe(true);
      expect(final.error).toMatchObject({ name: "AbortError" });
      expect(hostOptions?.signal).toBe(controller.signal);
      expect(fetch).not.toHaveBeenCalled();
      expect(fs.existsSync(settings.contextMemoryFilePath)).toBe(false);
    },
  );

  it("observes a rejecting source that synchronously aborts during invocation", async () => {
    const controller = new AbortController();
    const settings = options({
      signal: controller.signal,
      contextMemorySemanticCandidateProvider: (_request, controls) => {
        expect(controls?.signal).toBe(controller.signal);
        controller.abort();
        return Promise.reject(
          new Error("source rejected after synchronous Stop"),
        );
      },
    });
    await expect(
      prepareCanonicalProviderContext(
        [{ role: "user", content: "Recall" }],
        settings,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fs.existsSync(settings.contextMemoryFilePath)).toBe(false);
  });

  it("does not invoke a semantic source when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = vi.fn(async () => []);
    await expect(
      prepareCanonicalProviderContext(
        [],
        options({
          signal: controller.signal,
          contextMemorySemanticCandidateProvider: source,
        }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(source).not.toHaveBeenCalled();
  });
});

describe("canonical Memory revision at provider admission", () => {
  it.each(["delete", "supersede"])(
    "does not send captured rows relabelled after a concurrent %s",
    async (change) => {
      const settings = options();
      const runtime = createCliContextMemoryRuntime({
        env: settings.contextMemoryEnv,
        memoryFilePath: settings.contextMemoryFilePath,
        purgePorts: [],
      });
      const service = new CliCanonicalMemoryService({ runtime });
      const seed = (memoryId, content) =>
        service.addScoped(content, {
          memoryId,
          scope: "user",
          scopeId: "local-user",
          allowedSinks: ["provider.ollama"],
          importance: 0.9,
        });
      await seed("revision-original", "REVISION_TOPIC OLD_REVISION_32751");
      const originalQuery = SegmentedMemoryPort.prototype.query;
      let changed = false,
        captured,
        committedRevision;
      const query = vi
        .spyOn(SegmentedMemoryPort.prototype, "query")
        .mockImplementation(async function (...args) {
          const result = await originalQuery.apply(this, args);
          if (this.filePath === settings.contextMemoryFilePath && !changed) {
            captured = result;
            changed = true;
            if (change === "delete")
              expect((await service.delete("revision-original")).status).toBe(
                "purged",
              );
            else {
              await seed("revision-new", "REVISION_TOPIC NEW_REVISION_32751");
              await runtime.kernel.decideMemory({
                memoryId: "revision-original",
                type: "supersede",
                successorMemoryId: "revision-new",
                expectedRevision: 1,
                authority: "local-user",
              });
            }
            committedRevision = await runtime.memoryPort.getRevision();
          }
          return result;
        });
      const fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "Should not be sent" },
        }),
      }));
      vi.stubGlobal("fetch", fetch);
      const request = [{ role: "user", content: "Use REVISION_TOPIC" }];
      await expect(chatWithTools(request, settings)).rejects.toMatchObject({
        code: "revision_conflict",
        details: { expectedRevision: 1 },
      });
      expect(captured[0].content).toContain("OLD_REVISION_32751");
      expect(committedRevision).toBeGreaterThan(1);
      expect(fetch).not.toHaveBeenCalled();
      query.mockRestore();
      const fresh = await prepareCanonicalProviderContext(request, settings);
      expect(fresh.plan.memoryRevision).toBe(committedRevision);
      expect(JSON.stringify(fresh.messages)).not.toContain(
        "OLD_REVISION_32751",
      );
      if (change === "supersede")
        expect(JSON.stringify(fresh.messages)).toContain("NEW_REVISION_32751");
      else expect(fresh.recall.results).toEqual([]);
    },
  );
});
