import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { chatWithTools } from "../helpers/test-model-egress.js";
import {
  withModelInputDiagnostics,
  recordLogicalModelInput,
  recordModelInputBody,
} from "../../src/lib/model-input-diagnostics.js";
import {
  providerFetch,
  withFormalBudgetProviderScope,
} from "../../src/lib/formal-budget-provider-scope.js";

afterEach(() => vi.unstubAllGlobals());
const sha = (value) => createHash("sha256").update(value).digest("hex");

describe("model input diagnostics Stop while an observer is pending", () => {
  for (const boundary of [
    "logical-input",
    "request-body",
    "formal-scope",
    "late-rejection",
  ]) {
    it(`settles ${boundary} cancellation before observer release without late dispatch`, async () => {
      let enter, release, rejectObserver, settled;
      const entered = new Promise((resolve) => {
        enter = resolve;
      });
      const held = new Promise((resolve, reject) => {
        release = resolve;
        rejectObserver = reject;
      });
      const controller = new AbortController();
      const reason = new Error("Synthetic diagnostic Stop");
      const fetch = vi.fn(async () => new Response("{}"));
      const observe = (promise) =>
        promise.then(
          (value) => (settled = { value }),
          (error) => (settled = { error }),
        );
      let pending;
      const run = withModelInputDiagnostics(
        {
          ...(boundary === "logical-input"
            ? { signal: controller.signal }
            : {}),
          onModelInputDiagnostic: async () => {
            enter();
            await held;
          },
        },
        async () => {
          if (boundary === "logical-input") {
            pending = observe(
              recordLogicalModelInput({
                messages: [{ role: "user", content: "synthetic" }],
                tools: [],
              }),
            );
          } else if (boundary !== "formal-scope") {
            pending = observe(
              providerFetch(
                "http://unused.invalid",
                { body: "{}", signal: controller.signal },
                fetch,
              ),
            );
          } else {
            await withFormalBudgetProviderScope(
              {
                runId: "pending-diagnostic",
                transport: { createFetch: () => fetch },
              },
              async () => {
                pending = observe(
                  providerFetch("http://unused.invalid", { body: "{}" }),
                );
                await entered;
              },
            );
          }
          await entered;
          if (boundary !== "formal-scope") controller.abort(reason);
          await new Promise((resolve) => setImmediate(resolve));
          return settled;
        },
      );
      try {
        const beforeRelease = await run;
        expect(beforeRelease?.error).toBeDefined();
        if (boundary !== "formal-scope")
          expect(beforeRelease.error).toBe(reason);
        else expect(beforeRelease.error.code).toBe("CC_BUDGET_SCOPE_CLOSED");
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        if (boundary === "late-rejection")
          rejectObserver(new Error("Late synthetic observer failure"));
        else release();
        await pending;
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetch).not.toHaveBeenCalled();
    });
  }
});

describe("model input diagnostic correlation", () => {
  it("binds canonical planning, durable signed readback, and governed fetch to one request", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "cc-model-input-composition-"),
    );
    const events = [];
    const dispatches = [];
    let signedReadback = null;
    const observe = async (event) => {
      events.push(event);
      if (event.phase === "logical-input") {
        const receipt = {
          schema: "chainlesschain.model-input-receipt/v1",
          requestId: event.requestId,
          attemptId: `${event.requestId}:attempt-1`,
          logicalDigest: event.logicalDigest,
          signature: sha(`${event.requestId}:${event.logicalDigest}`),
        };
        const receiptPath = join(directory, "receipt.json");
        writeFileSync(receiptPath, JSON.stringify(receipt), "utf8");
        signedReadback = JSON.parse(readFileSync(receiptPath, "utf8"));
      }
      if (event.phase === "body-prepared") {
        expect(signedReadback).toMatchObject({ requestId: event.requestId });
        expect(event.requestId).toBe(signedReadback.requestId);
        expect(event.attempt).toBe(1);
        expect(signedReadback.attemptId).toBe(
          `${event.requestId}:attempt-${event.attempt}`,
        );
      }
    };
    try {
      await withModelInputDiagnostics(
        { onModelInputDiagnostic: observe },
        async () => {
          await recordLogicalModelInput({
            messages: [{ role: "user", content: "composition fixture" }],
            tools: [],
            plan: {
              digest: "sha256:" + "1".repeat(64),
              selectedItemIds: ["task-1"],
              selected: [
                { kind: "message", digest: "sha256:" + "2".repeat(64) },
              ],
              dropped: [],
            },
          });
          await withFormalBudgetProviderScope(
            {
              runId: "model-input-composition",
              transport: {
                createFetch: () => async (_url, init) => {
                  dispatches.push(JSON.parse(init.body));
                  await recordModelInputBody(
                    JSON.stringify(JSON.parse(init.body)),
                    "governed-fetch-body",
                  );
                  return new Response("{}");
                },
              },
            },
            () =>
              providerFetch("http://unused.invalid", {
                body: JSON.stringify({
                  messages: [{ role: "user", content: "composition fixture" }],
                }),
              }),
          );
        },
      );
      expect(dispatches).toHaveLength(1);
      expect(events.map((event) => event.phase || event.stage)).toEqual([
        "logical-input",
        "body-prepared",
        "body-prepared",
      ]);
      expect(events[1].stage).toBe("adapter-body");
      expect(events[2].stage).toBe("governed-fetch-body");
      expect(new Set(events.map((event) => event.requestId))).toEqual(
        new Set([signedReadback.requestId]),
      );
      expect(signedReadback.signature).toBe(
        sha(`${signedReadback.requestId}:${signedReadback.logicalDigest}`),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks governed dispatch when the durable signed readback stage fails", async () => {
    const fetch = vi.fn();
    const events = [];
    await expect(
      withModelInputDiagnostics(
        {
          onModelInputDiagnostic: async (event) => {
            events.push(event);
            if (event.phase === "logical-input")
              throw new Error("signed ingress readback unavailable");
          },
        },
        async () => {
          await recordLogicalModelInput({
            messages: [{ role: "user", content: "blocked" }],
            tools: [],
            plan: { selected: [], dropped: [], selectedItemIds: [] },
          });
          await withFormalBudgetProviderScope(
            {
              runId: "model-input-composition-failure",
              transport: { createFetch: () => fetch },
            },
            () => providerFetch("http://unused.invalid", { body: "{}" }),
          );
        },
      ),
    ).rejects.toThrow("signed ingress readback unavailable");
    expect(fetch).not.toHaveBeenCalled();
    expect(events.map((event) => event.phase || event.stage)).toEqual([
      "logical-input",
    ]);
  });

  it("keeps concurrent request attempts isolated and emits no original content or paths", async () => {
    const groups = [[], []];
    await Promise.all(
      groups.map((events, index) =>
        withModelInputDiagnostics(
          {
            onModelInputDiagnostic: async (event) => {
              await Promise.resolve();
              events.push(event);
            },
          },
          async () => {
            await recordLogicalModelInput({
              messages: [{ role: "user", content: "secret/path/" + index }],
              tools: [],
              plan: {
                digest: "a".repeat(64),
                selectedItemIds: ["private/source"],
                dropped: [
                  { reason: "input_budget", itemId: "private/path" },
                  { reason: "secret-reason" },
                ],
              },
            });
            for (let attempt = 0; attempt < 2; attempt++)
              await providerFetch(
                "http://unused.invalid",
                { body: "secret-" + index },
                async () => new Response("{}"),
              );
          },
        ),
      ),
    );
    expect(groups[0][0].requestId).not.toBe(groups[1][0].requestId);
    for (const events of groups) {
      expect(events.map((e) => e.attempt).filter(Boolean)).toEqual([1, 2]);
      expect(new Set(events.map((e) => e.requestId)).size).toBe(1);
      expect(events[0].planning.dropped).toEqual({
        input_budget: 1,
        unknown: 1,
      });
      expect(JSON.stringify(events)).not.toMatch(/secret|private|unused/);
      expect(events.every((e) => e.billingVerified === false)).toBe(true);
    }
  });

  it("records governed reserialization separately from the adapter body", async () => {
    const events = [];
    const actualBodies = [];
    await withModelInputDiagnostics(
      { onModelInputDiagnostic: (e) => events.push(e) },
      () =>
        withFormalBudgetProviderScope(
          {
            runId: "diagnostic-test",
            transport: {
              createFetch: () => async (_, init) => {
                const body = JSON.stringify(JSON.parse(init.body));
                await recordModelInputBody(body, "governed-fetch-body");
                actualBodies.push(body);
                return new Response("{}");
              },
            },
          },
          () => providerFetch("http://unused.invalid", { body: '{ "x" : 1 }' }),
        ),
    );
    expect(events.map((e) => e.stage)).toEqual([
      "adapter-body",
      "governed-fetch-body",
    ]);
    expect(events.map((e) => e.attempt)).toEqual([1, 1]);
    expect(events[0].bodyDigest).not.toBe(events[1].bodyDigest);
    expect(events[1].bodyDigest).toBe(sha(actualBodies[0]));
  });

  it("prevents dispatch when an async diagnostic sink fails", async () => {
    const fetch = vi.fn();
    await expect(
      withModelInputDiagnostics(
        {
          onModelInputDiagnostic: async () => {
            throw Error("diagnostic append failed");
          },
        },
        () => providerFetch("http://unused.invalid", { body: "{}" }, fetch),
      ),
    ).rejects.toThrow("diagnostic append failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves unsupported streaming bodies unconsumed and marks their coverage unknown", async () => {
    const events = [];
    const body = new ReadableStream();
    await withModelInputDiagnostics(
      { onModelInputDiagnostic: (e) => events.push(e) },
      () =>
        providerFetch(
          "http://unused.invalid",
          { body },
          async () => new Response("{}"),
        ),
    );
    expect(body.locked).toBe(false);
    expect(events[0]).toMatchObject({
      bodyCovered: false,
      bodyDigest: null,
      bytes: null,
    });
  });

  it.each(["openai", "anthropic"])(
    "binds %s planned input to bytes received by a real loopback server",
    async (provider) => {
      const directory = mkdtempSync(
        join(tmpdir(), "cc-model-input-diagnostic-"),
      );
      const events = [],
        bodies = [];
      const server = http.createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        bodies.push(body);
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify(
            provider === "anthropic"
              ? {
                  content: [{ type: "text", text: "done" }],
                  stop_reason: "end_turn",
                }
              : {
                  choices: [
                    { message: { role: "assistant", content: "done" } },
                  ],
                },
          ),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const result = await chatWithTools(
          [
            { role: "system", content: "project-rule-PRIVATE" },
            { role: "user", content: "source-PRIVATE" },
          ],
          {
            provider,
            model:
              provider === "anthropic" ? "claude-sonnet-4-6" : "unit-model",
            baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
            apiKey: "credential-PRIVATE",
            cwd: directory,
            contextMemoryEnv: {
              CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
            },
            contextMemoryFilePath: join(directory, "memory.json"),
            contextMemorySelectedToolNames: [],
            onModelInputDiagnostic: async (e) => {
              events.push(e);
            },
          },
        );
        expect(result.message.content).toBe("done");
        expect(result.usage).toBeUndefined();
        const logical = events.find((e) => e.phase === "logical-input");
        const wire = events.find((e) => e.stage === "fetch-body");
        expect(logical.planning.covered).toBe(true);
        expect(logical.planning.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(logical.projection.covered).toBe(false);
        expect(logical.projection.projectionDigest).toBeNull();
        expect(logical.requestId).toBe(wire.requestId);
        expect(wire.bodyDigest).toBe(sha(bodies[0]));
        expect(wire.bytes).toBe(Buffer.byteLength(bodies[0]));
        expect(wire.providerAcceptanceVerified).toBe(false);
        expect(JSON.stringify(events)).not.toMatch(
          /PRIVATE|credential|127\.0\.0\.1/,
        );
        const parsed = JSON.parse(bodies[0]);
        if (provider === "anthropic") {
          expect(parsed.messages.every((m) => m.role !== "system")).toBe(true);
          expect(parsed.system).toBeTruthy();
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

it("freezes the diagnosed logical request before an asynchronous observer can change its source", async () => {
  const messages = [{ role: "user", content: "original" }];
  const events = [];
  await withModelInputDiagnostics(
    {
      onModelInputDiagnostic: async (event) => {
        events.push(event);
        if (event.phase === "logical-input") {
          await Promise.resolve();
          messages[0].content = "changed";
        }
      },
    },
    async () => {
      const snapshot = await recordLogicalModelInput({ messages, tools: [] });
      expect(snapshot.messages[0].content).toBe("original");
      expect(events[0].logicalDigest).toBe(sha(JSON.stringify(snapshot)));
    },
  );
  expect(messages[0].content).toBe("changed");
});

it("links built-in agent input diagnostics to the persisted usage boundary and preserves unknown usage", async () => {
  const diagnostics = [],
    events = [];
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "done" } }],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const { agentLoop } = await import("../helpers/test-model-egress.js");
  for await (const event of agentLoop([{ role: "user", content: "hello" }], {
    provider: "openai",
    model: "unit-model",
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    autoCompact: false,
    runnableProviderFallback: false,
    onModelInputDiagnostic: (event) => diagnostics.push(event),
  }))
    events.push(event);
  const start = events.find(
    (event) => event.type === "model-usage-started" && event.source === "model",
  );
  expect(start).toBeTruthy();
  expect(
    diagnostics.find((event) => event.phase === "logical-input").usageCallId,
  ).toBe(start.callId);
  expect(
    events.some(
      (event) =>
        event.type === "model-usage-unknown" && event.callId === start.callId,
    ),
  ).toBe(true);
});

it("keeps body and cancellation bound to the captured request while the observer awaits", async () => {
  const controller = new AbortController();
  const init = { body: "original", signal: controller.signal };
  let captured;
  await withModelInputDiagnostics(
    {
      onModelInputDiagnostic: async () => {
        await Promise.resolve();
        init.body = "changed";
        init.signal = new AbortController().signal;
      },
    },
    () =>
      withFormalBudgetProviderScope(
        {
          runId: "signal-snapshot",
          transport: {
            createFetch: () => async (_, snapshot) => {
              captured = snapshot;
              expect(snapshot.signal.aborted).toBe(false);
              controller.abort();
              expect(snapshot.signal.aborted).toBe(true);
              return new Response("{}");
            },
          },
        },
        () => providerFetch("http://unused.invalid", init),
      ),
  );
  expect(captured.body).toBe("original");
  expect(captured.signal.aborted).toBe(true);
});

it("rejects an already stopped request before its diagnostic observer or transport", async () => {
  const controller = new AbortController();
  const reason = new Error("Already stopped synthetic request");
  controller.abort(reason);
  const observer = vi.fn();
  const fetch = vi.fn();
  await expect(
    withModelInputDiagnostics({ onModelInputDiagnostic: observer }, () =>
      providerFetch(
        "http://unused.invalid",
        { body: "{}", signal: controller.signal },
        fetch,
      ),
    ),
  ).rejects.toBe(reason);
  expect(observer).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the ordinary injected transport path when diagnostics are disabled", async () => {
  const controller = new AbortController();
  controller.abort();
  const init = { body: "{}", signal: controller.signal };
  const fetch = vi.fn(async () => new Response("{}"));
  await withModelInputDiagnostics({}, () =>
    providerFetch("http://unused.invalid", init, fetch),
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://unused.invalid", init);
});

it("does not attribute a nested call that disabled diagnostics to its parent's request", async () => {
  const events = [];
  await withModelInputDiagnostics(
    { onModelInputDiagnostic: (event) => events.push(event) },
    async () => {
      await withModelInputDiagnostics({}, () =>
        providerFetch(
          "http://unused.invalid",
          { body: "nested" },
          async () => new Response("{}"),
        ),
      );
      await providerFetch(
        "http://unused.invalid",
        { body: "parent" },
        async () => new Response("{}"),
      );
    },
  );
  expect(events).toHaveLength(1);
  expect(events[0].attempt).toBe(1);
  expect(events[0].bodyDigest).toBe(sha("parent"));
});

it("bounds source details and keeps original identifiers and content out of the report", async () => {
  const events = [];
  const selected = Array.from({ length: 600 }, () => ({
    kind: "message",
    digest: "sha256:" + "a".repeat(64),
    itemId: "private/source",
  }));
  await withModelInputDiagnostics(
    { onModelInputDiagnostic: (e) => events.push(e) },
    () =>
      recordLogicalModelInput({
        messages: [{ role: "user", content: "private-content" }],
        tools: [],
        plan: {
          digest: "sha256:" + "b".repeat(64),
          selected,
          selectedItemIds: [],
          dropped: [],
        },
      }),
  );
  expect(events[0].planning).toMatchObject({
    sourceDetailsCovered: true,
    sourceCount: 600,
    sourcesTruncated: true,
  });
  expect(events[0].planning.sources).toHaveLength(512);
  expect(events[0].projection.redactionCount).toBeNull();
  expect(JSON.stringify(events)).not.toMatch(/private|itemId/);
});

it("retains an excluded source when selected entries exceed the detail limit", async () => {
  const events = [];
  await withModelInputDiagnostics(
    { onModelInputDiagnostic: (e) => events.push(e) },
    () =>
      recordLogicalModelInput({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        plan: {
          selected: Array.from({ length: 512 }, () => ({
            kind: "message",
            digest: "a".repeat(64),
          })),
          selectedItemIds: [],
          dropped: [{ digest: "b".repeat(64), reason: "input_budget" }],
        },
      }),
  );
  expect(events[0].planning.sources[0]).toMatchObject({
    disposition: "excluded",
    digest: "b".repeat(64),
    reason: "input_budget",
  });
  expect(events[0].planning.sources).toHaveLength(512);
  expect(events[0].planning.sourceCount).toBe(513);
  expect(events[0].planning.sourcesTruncated).toBe(true);
});
