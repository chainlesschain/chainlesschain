import { Worker } from "node:worker_threads";
import { channel } from "node:diagnostics_channel";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaProviderFetch } from "../../src/lib/ollama-provider-fetch.js";
import { withFormalBudgetProviderScope } from "../../src/lib/formal-budget-provider-scope.js";

afterEach(() => vi.unstubAllGlobals());

async function loopbackServer({ reset = false } = {}) {
  // An independent event loop must retire idle sockets while the client is
  // blocked in synchronous repository work, just like a real Ollama process.
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const { createServer } = require('node:http');
     let requests = 0;
     const server = createServer((request, response) => {
       request.resume();
       request.on('end', () => {
         requests += 1;
         if (workerData.reset) { request.socket.destroy(); return; }
         response.setHeader('Content-Type', 'application/json');
         response.end(JSON.stringify({ requests }));
       });
     });
     server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
     parentPort.on('message', () => parentPort.postMessage(requests));`,
    { eval: true, workerData: { reset } },
  );
  const [port] = await once(worker, "message");
  return {
    url: `http://127.0.0.1:${port}/api/chat`,
    async requests() {
      const message = once(worker, "message");
      worker.postMessage("count");
      return (await message)[0];
    },
    close: () => worker.terminate(),
  };
}

describe("Ollama provider transport", () => {
  it("keeps global fetch injection and explicit proxy/TLS dispatchers", async () => {
    const dispatcher = { dispatch: vi.fn() };
    const response = {};
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(
      ollamaProviderFetch("http://127.0.0.1/api/chat", {
        method: "POST",
        dispatcher,
        signal,
        body: "{}",
      }),
    ).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1/api/chat", {
      method: "POST",
      dispatcher,
      signal,
      body: "{}",
    });
  });

  it("keeps the formal budget transport authoritative", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const fallback = vi.fn();
    const signal = new AbortController().signal;
    await withFormalBudgetProviderScope(
      {
        transport: { createFetch: () => fetch },
        runId: "ollama-transport-test",
      },
      async () => {
        await ollamaProviderFetch(
          "http://127.0.0.1/api/chat",
          { signal },
          fallback,
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
        expect(fetch.mock.calls[0][1]).not.toHaveProperty("dispatcher");
      },
    );
    expect(fallback).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("preserves cancellation without sending a model request", async () => {
    const server = await loopbackServer();
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(
        ollamaProviderFetch(server.url, {
          method: "POST",
          body: "{}",
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(await server.requests()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("validates expired idle sockets before sending each POST exactly once", async () => {
    const server = await loopbackServer();
    let dispatches = 0;
    const observer = ({ request }) => {
      if (`${request.origin}${request.path}` === server.url) dispatches += 1;
    };
    const requests = channel("undici:request:create");
    requests.subscribe(observer);
    try {
      for (let turn = 1; turn <= 3; turn += 1) {
        const response = await ollamaProviderFetch(server.url, {
          method: "POST",
          body: "{}",
        });
        expect(await response.json()).toEqual({ requests: turn });
        if (turn < 3) {
          // Let the completed request become reusable, then block past the
          // server's default 5s idle timeout (plus Node's optional 1s buffer).
          await new Promise((resolve) => setTimeout(resolve, 10));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6500);
        }
      }
      expect(await server.requests()).toBe(3);
      expect(dispatches).toBe(3);
    } finally {
      requests.unsubscribe(observer);
      await server.close();
    }
  });

  it("does not replay a POST whose response was lost", async () => {
    const server = await loopbackServer({ reset: true });
    try {
      await expect(
        ollamaProviderFetch(server.url, { method: "POST", body: "{}" }),
      ).rejects.toThrow("fetch failed");
      expect(await server.requests()).toBe(1);
    } finally {
      await server.close();
    }
  });
});
