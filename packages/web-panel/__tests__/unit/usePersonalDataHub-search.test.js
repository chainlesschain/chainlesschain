/**
 * Phase 16 Vault Browser — composable wrappers for the 2 search topics.
 * Mocks useWsStore so the test runs with no real WS connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 16 Vault Browser search", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("searchEvents routes to personal-data-hub.search-events with full filter set", async () => {
    sendRaw.mockResolvedValueOnce({
      result: { rows: [], nextCursor: null, mode: "fts5", shortQuery: false },
    });
    const hub = usePersonalDataHub();

    const r = await hub.searchEvents({
      q: "支付宝",
      adapter: "social-bilibili",
      category: "social",
      subtype: "social.video.play",
      since: 1700000000000,
      until: 1700001000000,
      cursor: { occurredAt: 1700000500000, id: "ev-abc" },
      limit: 50,
    });

    expect(sendRaw).toHaveBeenCalledOnce();
    const [payload, timeoutMs] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.search-events",
      q: "支付宝",
      adapter: "social-bilibili",
      category: "social",
      subtype: "social.video.play",
      since: 1700000000000,
      until: 1700001000000,
      cursor: { occurredAt: 1700000500000, id: "ev-abc" },
      limit: 50,
    });
    expect(timeoutMs).toBe(15_000);
    expect(r.mode).toBe("fts5");
    expect(r.rows).toEqual([]);
  });

  it("searchEvents defaults to empty object when called with no args", async () => {
    sendRaw.mockResolvedValueOnce({
      result: { rows: [], nextCursor: null, mode: "like", shortQuery: false },
    });
    const hub = usePersonalDataHub();

    await hub.searchEvents();

    const [payload] = sendRaw.mock.calls[0];
    expect(payload).toEqual({ type: "personal-data-hub.search-events" });
  });

  it("facetCounts routes to personal-data-hub.facet-counts with q/since/until only", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        byCategory: { chat: 12, social: 8 },
        byAdapter: { wechat: 12, "social-bilibili": 8 },
        bySubtype: { "chat.message": 12, "social.video.play": 8 },
        total: 20,
        mode: "fts5",
        shortQuery: false,
      },
    });
    const hub = usePersonalDataHub();

    const r = await hub.facetCounts({
      q: "kotlin",
      since: 1700000000000,
      until: 1700001000000,
    });

    expect(sendRaw).toHaveBeenCalledOnce();
    const [payload, timeoutMs] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.facet-counts",
      q: "kotlin",
      since: 1700000000000,
      until: 1700001000000,
    });
    expect(timeoutMs).toBe(10_000);
    expect(r.total).toBe(20);
    expect(r.byCategory.chat).toBe(12);
  });

  it("facetCounts defaults to empty filters", async () => {
    sendRaw.mockResolvedValueOnce({
      result: { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0, mode: "fts5", shortQuery: false },
    });
    const hub = usePersonalDataHub();

    await hub.facetCounts();

    const [payload] = sendRaw.mock.calls[0];
    expect(payload).toEqual({ type: "personal-data-hub.facet-counts" });
  });
});
