import { afterEach, describe, expect, it, vi } from "vitest";
import { chatWithTools, agentLoop } from "../helpers/test-model-egress.js";
import { compactConversationWithProvider } from "../../src/harness/provider-backed-compaction.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function history() {
  return [
    { role: "system", content: "Preserve task constraints." },
    ...Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      // Fuzzy dedup uses character sets, so keep each entry's alphabet disjoint.
      content: Array.from({ length: 80 }, (_, word) =>
        String.fromCodePoint(0x4e00 + index * 80 + word),
      )
        .join("")
        .repeat(10),
    })),
    { role: "user", content: "Continue with verification." },
  ];
}

function interruptedResponsesFetch() {
  const failure = Object.assign(new TypeError("terminated"), {
    cause: { code: "ECONNRESET" },
  });
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: vi.fn().mockRejectedValue(failure),
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const providerOptions = {
  provider: "openai",
  model: "gpt-6.1-sol",
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  contextMemoryModelWindowTokens: 4096,
  strictUsageTelemetry: true,
};

describe("Responses compaction transport failure", () => {
  it("retains the network diagnosis and makes one request for manual compaction", async () => {
    const fetch = interruptedResponsesFetch();
    const messages = history();
    const original = structuredClone(messages);
    const result = await compactConversationWithProvider(messages, {
      ...providerOptions,
      force: true,
      chatFn: chatWithTools,
      chatOptions: { strictUsageTelemetry: true },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toMatch(/\/responses$/);
    expect(result.stats.summaryProviderError).toEqual({
      category: "network",
      code: "ECONNRESET",
    });
    expect(result.usageUnknownEvent.reason).toBe(
      "provider_transport_outcome_unknown",
    );
    expect(result.usageUnknownEvent.providerError).toEqual({
      category: "network",
      code: "ECONNRESET",
    });
    expect(messages).toEqual(original);
  });

  it("stops automatic compaction without retrying or starting the main model", async () => {
    const fetch = interruptedResponsesFetch();
    const messages = history();
    const original = structuredClone(messages);
    const events = [];
    for await (const event of agentLoop(messages, {
      ...providerOptions,
      onUsageBoundary: () => {},
    }))
      events.push(event);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toMatch(/\/responses$/);
    expect(
      events.find((event) => event.type === "compaction-degraded")?.stats
        .summaryProviderError,
    ).toEqual({
      category: "network",
      code: "ECONNRESET",
    });
    expect(
      events.find((event) => event.type === "compaction-usage-unknown")?.reason,
    ).toBe("provider_transport_outcome_unknown");
    expect(
      events.find((event) => event.type === "compaction-usage-unknown")
        ?.providerError,
    ).toEqual({ category: "network", code: "ECONNRESET" });
    expect(events.at(-1)).toMatchObject({
      type: "run-ended",
      reason: "compaction-usage-unknown",
    });
    expect(messages).toEqual(original);
  });
});
