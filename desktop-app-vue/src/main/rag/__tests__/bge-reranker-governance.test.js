import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { BGERerankerClient } = await import("../bge-reranker-client.js");

describe("BGERerankerClient governance", () => {
  it("rejects before creating a reranking request", async () => {
    const post = vi.fn();
    const createClient = vi.fn(() => ({ post }));
    const client = new BGERerankerClient({}, { createClient });

    await expect(
      client.rerank("private query", [{ id: "1", text: "private document" }]),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(post).not.toHaveBeenCalled();
  });
});
