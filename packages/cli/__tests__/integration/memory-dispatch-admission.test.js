import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { agentLoop, chatWithTools } from "../helpers/test-model-egress.js";
import * as ingressModule from "../../src/lib/evolution/agent-evolution-ingress.js";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";

const temporaryParent = fs.realpathSync.native(os.tmpdir());
const OLD = "DISPATCH_OLD_42719";
const NEW = "DISPATCH_NEW_42719";
const request = () => [{ role: "user", content: "Use DISPATCH_TOPIC" }];
let directory;

beforeEach(() => {
  directory = fs.mkdtempSync(
    path.join(temporaryParent, "cc-memory-admission-"),
  );
  // Even a setup regression must never reach an external model or network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request in Memory admission fixture");
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (
    path.dirname(directory) !== temporaryParent ||
    !path.basename(directory).startsWith("cc-memory-admission-")
  ) {
    throw new Error("Unsafe Memory admission fixture cleanup");
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

function options(overrides = {}) {
  return {
    provider: "ollama",
    model: "fixture",
    baseUrl: "http://memory-admission.invalid",
    sessionId: "memory-admission-session",
    cwd: directory,
    autoCompact: false,
    runnableProviderFallback: false,
    enabledToolNames: [],
    exactToolNames: true,
    contextMemoryEnv: {
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    },
    contextMemoryFilePath: path.join(directory, "memory.json"),
    contextMemoryModelWindowTokens: 8192,
    contextMemorySelectedToolNames: [],
    maxOutputTokens: 256,
    iterationBudget: new IterationBudget({ limit: 2 }),
    ...overrides,
  };
}

function response() {
  return {
    message: { role: "assistant", content: "Fixture completed." },
    usage: { input_tokens: 2, output_tokens: 1 },
  };
}

function captureProvider(kind, settings) {
  const captures = [];
  if (kind === "chatFn") {
    settings.chatFn = vi.fn(async (messages) => {
      captures.push(structuredClone(messages));
      return response();
    });
  } else {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        expect(String(url)).toBe("http://memory-admission.invalid/api/chat");
        captures.push(JSON.parse(init.body).messages);
        return { ok: true, json: async () => response() };
      }),
    );
  }
  return captures;
}

async function fixture(settings, seedOptions = {}) {
  const runtime = createCliContextMemoryRuntime({
    env: settings.contextMemoryEnv,
    memoryFilePath: settings.contextMemoryFilePath,
    purgePorts: [],
  });
  expect(runtime.memoryPort).toBeInstanceOf(SegmentedMemoryPort);
  const service = new CliCanonicalMemoryService({ runtime });
  const seed = (memoryId, content) =>
    service.addScoped(content, {
      memoryId,
      scope: "user",
      scopeId: "local-user",
      allowedSinks: ["provider.ollama"],
      importance: 0.9,
      ...seedOptions,
    });
  await seed("dispatch-original", `DISPATCH_TOPIC ${OLD}`);
  const before = await prepareCanonicalProviderContext(request(), settings);
  expect(JSON.stringify(before.messages)).toContain(OLD);
  expect(before.plan.memoryRevision).toBe(1);
  return {
    runtime,
    async mutate(change) {
      if (change === "delete") {
        expect((await service.delete("dispatch-original")).status).toBe(
          "purged",
        );
      } else {
        await seed("dispatch-successor", `DISPATCH_TOPIC ${NEW}`);
        await runtime.kernel.decideMemory({
          memoryId: "dispatch-original",
          type: "supersede",
          successorMemoryId: "dispatch-successor",
          expectedRevision: 1,
          authority: "local-user",
        });
      }
      const revision = await runtime.memoryPort.getRevision();
      expect(revision).toBeGreaterThan(1);
      // Reopen the disk authority: do not accept an in-memory mutation alone.
      const fresh = await prepareCanonicalProviderContext(request(), settings);
      expect(fresh.plan.memoryRevision).toBe(revision);
      expect(JSON.stringify(fresh.messages)).not.toContain(OLD);
      if (change === "supersede")
        expect(JSON.stringify(fresh.messages)).toContain(NEW);
      else expect(fresh.recall.results).toEqual([]);
      return revision;
    },
  };
}

async function reach(generator, type) {
  for (let count = 0; count < 100; count += 1) {
    const next = await generator.next();
    if (next.done) throw new Error(`Agent ended before ${type}`);
    if (next.value.type === type) return next.value;
  }
  throw new Error(`Agent did not reach ${type}`);
}

async function settle(operation) {
  try {
    return { value: await operation() };
  } catch (error) {
    return { error };
  }
}

async function drain(generator) {
  return settle(async () => {
    const events = [];
    for await (const event of generator) events.push(event);
    return events;
  });
}

function assertRejectedBeforeDispatch(captures, outcome, details) {
  // A single diagnostic assertion retains proof of stale egress in red JSON.
  const evidence = {
    ...details,
    providerCalls: captures.length,
    oldMarkerCaptured: captures.some((messages) =>
      JSON.stringify(messages).includes(OLD),
    ),
    newMarkerCaptured: captures.some((messages) =>
      JSON.stringify(messages).includes(NEW),
    ),
    errorCode: outcome.error?.code ?? null,
  };
  expect(
    {
      providerCalls: captures.length,
      staleBodyDispatched: captures.some((messages) =>
        JSON.stringify(messages).includes(OLD),
      ),
      errorCode: outcome.error?.code ?? null,
    },
    JSON.stringify(evidence),
  ).toEqual({
    providerCalls: 0,
    staleBodyDispatched: false,
    errorCode: "revision_conflict",
  });
}

describe("canonical Memory final dispatch admission on real disk", () => {
  for (const boundary of ["context.plan.created", "model-usage-started"]) {
    for (const egress of ["chatFn", "fetch"]) {
      it.each(["delete", "supersede"])(
        `rejects %s at ${boundary} before ${egress}`,
        async (change) => {
          const settings = options();
          const memory = await fixture(settings);
          const captures = captureProvider(egress, settings);
          const generator = agentLoop(request(), settings);
          try {
            const event = await reach(generator, boundary);
            if (boundary === "context.plan.created")
              expect(event.plan.memoryRevision).toBe(1);
            expect(captures).toEqual([]);
            const committedRevision = await memory.mutate(change);
            const outcome = await drain(generator);
            assertRejectedBeforeDispatch(captures, outcome, {
              stage: boundary,
              egress,
              change,
              committedRevision,
            });
          } finally {
            await generator.return();
          }
        },
      );
    }
  }

  for (const boundary of ["evolutionIngress", "onProviderCallStart"]) {
    it.each(["delete", "supersede"])(
      `rejects %s during asynchronous ${boundary} before direct chatWithTools fetch`,
      async (change) => {
        const settings = options();
        const memory = await fixture(settings);
        const captures = captureProvider("fetch", settings);
        let entered = 0;
        let committedRevision;
        const mutateOnce = async () => {
          entered += 1;
          await new Promise((resolve) => setImmediate(resolve));
          committedRevision = await memory.mutate(change);
        };
        if (boundary === "onProviderCallStart") {
          settings.onProviderCallStart = mutateOnce;
        } else {
          // The suite's existing ingress is a frozen test sentinel. Instrument
          // only that test seam; use the real adapter, recall and disk authority.
          // This does not claim durable Evolution authentication coverage.
          const sentinel =
            globalThis[
              Symbol.for("chainlesschain.test.agent-evolution-ingress")
            ];
          const capture = ingressModule.captureAgentEvolutionIngress;
          vi.spyOn(
            ingressModule,
            "captureAgentEvolutionIngress",
          ).mockImplementation((value, controls) => {
            const admitted = capture(value, controls);
            if (value !== sentinel) return admitted;
            return {
              ...admitted,
              async prepareModelRequest(input) {
                const projected = await admitted.prepareModelRequest(input);
                expect(JSON.stringify(projected.messages)).toContain(OLD);
                await mutateOnce();
                return projected;
              },
            };
          });
        }
        const outcome = await settle(() => chatWithTools(request(), settings));
        expect(entered).toBe(1);
        assertRejectedBeforeDispatch(captures, outcome, {
          stage: boundary,
          egress: "fetch",
          change,
          committedRevision,
        });
      },
    );
  }
});

describe("canonical Memory explicit denial at real model entry points", () => {
  it.each([false, true])(
    "honors explicit empty scope admissions: %s",
    async (deny) => {
      const settings = options();
      await fixture(settings);
      if (deny) settings.contextMemoryScopeAdmissions = [];
      const captures = captureProvider("fetch", settings);
      const outcome = await settle(() => chatWithTools(request(), settings));
      if (deny) {
        expect(
          { rejected: Boolean(outcome.error), providerCalls: captures.length },
          JSON.stringify({
            stage: "explicit-empty-admissions",
            oldMarkerCaptured: JSON.stringify(captures).includes(OLD),
          }),
        ).toEqual({ rejected: true, providerCalls: 0 });
      } else {
        expect(outcome.error).toBeUndefined();
        expect(captures).toHaveLength(1);
        expect(JSON.stringify(captures[0])).toContain(OLD);
      }
    },
  );

  it.each([true, false])(
    "honors actual SubAgentContext memoryEnabled=%s",
    async (memoryEnabled) => {
      const settings = options();
      await fixture(settings);
      const captures = captureProvider("fetch", settings);
      const child = SubAgentContext.create({
        role: "memory-admission-fixture",
        task: "Use DISPATCH_TOPIC",
        cwd: directory,
        allowedTools: [],
        useWorktree: false,
        memoryEnabled,
        llmOptions: settings,
      });
      const result = await child.run("Use DISPATCH_TOPIC");
      expect(child.status).toBe("completed");
      expect(result.summary).toContain("Fixture completed.");
      expect(captures).toHaveLength(1);
      expect(
        JSON.stringify(captures[0]).includes(OLD),
        JSON.stringify({
          stage: "actual-SubAgentContext",
          memoryEnabled,
          providerCalls: captures.length,
          oldMarkerCaptured: JSON.stringify(captures[0]).includes(OLD),
        }),
      ).toBe(memoryEnabled);
    },
  );
});

describe("Memory dispatch expiration and physical retry boundaries", () => {
  it("rejects selected Memory expiring after planning without a store revision change", async () => {
    const settings = options();
    const expiresAt = Date.now() + 60_000;
    const memory = await fixture(settings, {
      retentionPolicy: {
        mode: "until_expired",
        expiresAt: new Date(expiresAt).toISOString(),
      },
    });
    const captures = captureProvider("fetch", settings);
    settings.onProviderCallStart = async () => {
      expect(await memory.runtime.memoryPort.getRevision()).toBe(1);
      vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1);
    };
    const outcome = await settle(() => chatWithTools(request(), settings));
    assertRejectedBeforeDispatch(captures, outcome, {
      stage: "selected-memory-expired",
      committedRevision: 1,
    });
    expect(outcome.error.noReplay).toBe(true);
  });

  it("revalidates disk Memory before a physical streaming retry", async () => {
    const settings = options({ onToken: vi.fn(), onStreamRetry: vi.fn() });
    const memory = await fixture(settings);
    const captures = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        captures.push(JSON.parse(init.body));
        // The first physical request was admitted; revoke before its retry.
        await memory.mutate("delete");
        const error = new Error("fixture connection reset");
        error.code = "ECONNRESET";
        throw error;
      }),
    );
    const outcome = await settle(() => chatWithTools(request(), settings));
    expect(settings.onStreamRetry).toHaveBeenCalledTimes(1);
    expect(captures).toHaveLength(1);
    expect(captures[0].stream).toBe(true);
    expect(JSON.stringify(captures[0].messages)).toContain(OLD);
    expect(settings.onToken).not.toHaveBeenCalled();
    expect(outcome.error).toMatchObject({
      code: "revision_conflict",
      noReplay: true,
    });
    expect(await memory.runtime.memoryPort.getRevision()).toBe(5);
  });
});

function testDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function withTestDeadline(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}

it("serializes cross-process deletion at dispatch but releases Memory before HTTP settles", async () => {
  const settings = options();
  const memory = await fixture(settings);
  const runtimeUrl = new URL(
    "../../src/lib/context-memory-kernel/runtime.js",
    import.meta.url,
  ).href;
  const serviceUrl = new URL(
    "../../src/lib/context-memory-kernel/memory-service.js",
    import.meta.url,
  ).href;
  const childSource = `
    const {createCliContextMemoryRuntime} = await import(process.argv[2]);
    const {CliCanonicalMemoryService} = await import(process.argv[3]);
    const runtime = createCliContextMemoryRuntime({
      env: {CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default"},
      memoryFilePath: process.argv[1], purgePorts: [],
    });
    runtime.memoryPort.lockObserver = () => process.send({phase:"acquired"});
    process.on("message", async (message) => {
      if (message !== "delete") return;
      process.send({phase:"started"});
      try {
        const service = new CliCanonicalMemoryService({runtime});
        const result = await service.delete("dispatch-original");
        const revision = await runtime.memoryPort.getRevision();
        process.send({phase:"done",status:result.status,revision}, () => process.disconnect());
      } catch (error) {
        process.exitCode = 1;
        process.send({phase:"failed",code:error.code || error.name}, () => process.disconnect());
      }
    });
    process.send({phase:"ready"});
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      childSource,
      settings.contextMemoryFilePath,
      runtimeUrl,
      serviceUrl,
    ],
    {
      cwd: directory,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    },
  );
  const messages = [];
  const waiters = new Set();
  child.on("message", (message) => {
    messages.push(message);
    for (const notify of waiters) notify();
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  // Attach rejection handling immediately even if fixture setup fails.
  void exit.catch(() => {});
  const phase = async (name) => {
    let notify;
    const message = new Promise((resolve, reject) => {
      notify = () => {
        const failed = messages.find((entry) => entry.phase === "failed");
        if (failed)
          reject(new Error(`Synthetic writer failed: ${failed.code}`));
        const found = messages.find((entry) => entry.phase === name);
        if (found) resolve(found);
      };
      waiters.add(notify);
      notify();
    });
    try {
      return await withTestDeadline(message, `Writer did not reach ${name}`);
    } finally {
      waiters.delete(notify);
    }
  };
  const http = testDeferred();
  let httpSettled = false;
  http.promise.then(() => {
    httpSettled = true;
  });
  let physicalCalls = 0;
  try {
    await phase("ready");
    const guarded = await memory.runtime.memoryPort.withRevisionGuard(
      1,
      async () => {
        child.send("delete");
        await phase("started");
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(messages.some((entry) => entry.phase === "acquired")).toBe(
          false,
        );
        expect(messages.some((entry) => entry.phase === "done")).toBe(false);
        physicalCalls += 1;
        return { value: http.promise };
      },
    );
    expect(guarded.value).toBe(http.promise);
    expect(httpSettled).toBe(false);
    const deleted = await phase("done");
    expect(deleted).toMatchObject({ status: "purged", revision: 5 });
    expect(httpSettled).toBe(false);
    expect(physicalCalls).toBe(1);
    const staleDispatch = vi.fn(() => ({
      value: Promise.resolve("not allowed"),
    }));
    await expect(
      memory.runtime.memoryPort.withRevisionGuard(1, staleDispatch),
    ).rejects.toMatchObject({ code: "revision_conflict", noReplay: true });
    expect(staleDispatch).not.toHaveBeenCalled();
    http.resolve("response");
    expect(await guarded.value).toBe("response");
    expect(await withTestDeadline(exit, "Writer did not exit")).toMatchObject({
      code: 0,
    });
  } finally {
    http.resolve("fixture cleanup");
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await withTestDeadline(exit, "Writer cleanup did not finish");
  }
});
