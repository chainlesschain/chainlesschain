import { describe, expect, it, vi } from "vitest";
import { runMeteredDirectModelCall } from "../../src/lib/direct-model-usage.js";

const BASE = {
  sessionId: "session-1",
  provider: "provider\u0000secret",
  model: "model-1",
  source: "model",
};

describe("direct model usage ledger", () => {
  it("durably records started before the provider and settles canonical usage", async () => {
    const order = [];
    const records = [];
    const result = {
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
        secret: "do-not-persist",
      },
      response: "private response",
    };

    const returned = await runMeteredDirectModelCall({
      ...BASE,
      persist: async (type, event) => {
        order.push(type);
        records.push({ type, event });
        await Promise.resolve();
      },
      call: async () => {
        order.push("provider");
        expect(records).toHaveLength(1);
        expect(records[0].type).toBe("model_usage_started");
        return result;
      },
    });

    expect(returned).toBe(result);
    expect(order).toEqual(["model_usage_started", "provider", "token_usage"]);
    expect(records[0].event.callId).toMatch(/^direct-/);
    expect(records[1]).toEqual({
      type: "token_usage",
      event: {
        provider: "providersecret",
        model: "model-1",
        callId: records[0].event.callId,
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        source: "model",
      },
    });
    expect(JSON.stringify(records)).not.toContain("do-not-persist");
    expect(JSON.stringify(records)).not.toContain("private response");
  });

  it("settles provider failures as unknown before rethrowing the original error", async () => {
    const records = [];
    const providerError = new Error("private provider error");

    let thrown;
    try {
      await runMeteredDirectModelCall({
        ...BASE,
        persist: (type, event) => records.push({ type, event }),
        call: async () => {
          throw providerError;
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(providerError);
    expect(records.map(({ type }) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(records[1].event).toEqual({
      callId: records[0].event.callId,
      provider: "providersecret",
      model: "model-1",
      source: "model",
      code: "provider_call_failed",
    });
    expect(JSON.stringify(records)).not.toContain("private provider error");
  });

  it.each([
    ["missing", {}],
    ["malformed", { usage: { input_tokens: "7" } }],
  ])("settles %s provider usage as unknown", async (_label, result) => {
    const records = [];

    expect(
      await runMeteredDirectModelCall({
        ...BASE,
        persist: (type, event) => records.push({ type, event }),
        call: async () => result,
      }),
    ).toBe(result);
    expect(records.map(({ type }) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(records[1].event.code).toBe("provider_usage_missing");
    expect(records[1].event.callId).toBe(records[0].event.callId);
  });

  it("marks a started persistence failure and never invokes the provider", async () => {
    const persistenceError = new Error("disk full");
    const call = vi.fn();

    let thrown;
    try {
      await runMeteredDirectModelCall({
        ...BASE,
        persist: () => {
          throw persistenceError;
        },
        call,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(persistenceError);
    expect(thrown.runtimeLedgerPersistence).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it.each(["known", "missing", "provider-error"])(
    "marks %s settlement persistence failures",
    async (outcome) => {
      const persistenceError = new Error("ledger unavailable");
      const providerError = new Error("provider unavailable");
      const call = vi.fn(async () => {
        if (outcome === "provider-error") throw providerError;
        if (outcome === "missing") return {};
        return { usage: { input_tokens: 1, output_tokens: 2 } };
      });
      let writes = 0;

      let thrown;
      try {
        await runMeteredDirectModelCall({
          ...BASE,
          persist: () => {
            writes += 1;
            if (writes === 2) throw persistenceError;
          },
          call,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBe(persistenceError);
      expect(thrown.runtimeLedgerPersistence).toBe(true);
      expect(call).toHaveBeenCalledOnce();
    },
  );

  it("wraps non-object persistence failures with a marked error", async () => {
    let thrown;
    try {
      await runMeteredDirectModelCall({
        ...BASE,
        persist: () => Promise.reject("offline"),
        call: vi.fn(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe("runtime usage ledger persistence failed");
    expect(thrown.runtimeLedgerPersistence).toBe(true);
    expect(thrown.cause).toBe("offline");
  });
});
