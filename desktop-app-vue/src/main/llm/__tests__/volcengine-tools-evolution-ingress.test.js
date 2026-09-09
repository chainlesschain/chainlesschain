import { afterEach, describe, expect, it, vi } from "vitest";

const {
  VolcengineToolsClient,
  _deps,
} = require("../volcengine-tools.js");

describe("Volcengine knowledge-base evolution ingress", () => {
  const originalFetch = _deps.fetch;

  afterEach(() => {
    _deps.fetch = originalFetch;
  });

  it("rejects raw document upload before the transport is called", async () => {
    const fetch = vi.fn();
    _deps.fetch = fetch;
    const client = new VolcengineToolsClient({ apiKey: "test-key" });

    await expect(
      client.setupKnowledgeBase("tenant-private-kb", [
        { title: "private", content: "credential=canary-secret" },
      ]),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(fetch).not.toHaveBeenCalled();
  });
});
