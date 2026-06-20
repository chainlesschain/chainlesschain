import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { CollaborationManager } = require("../collaboration-manager.js");

describe("CollaborationManager._releaseDocumentIfIdle", () => {
  let mgr;

  beforeEach(() => {
    mgr = new CollaborationManager();
  });

  it("keeps the doc while another connection is still editing it", () => {
    const connA = { documentId: "doc1" };
    const connB = { documentId: "doc1" };
    mgr.connections.set("a", connA);
    mgr.connections.set("b", connB);
    const unsubscribe = vi.fn();
    mgr.documents.set("doc1", { unsubscribe });

    mgr._releaseDocumentIfIdle("doc1", connA); // A leaves, B remains

    expect(mgr.documents.has("doc1")).toBe(true);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("removes the doc and unsubscribes when the last connection leaves", () => {
    const connA = { documentId: "doc1" };
    mgr.connections.set("a", connA);
    const unsubscribe = vi.fn();
    mgr.documents.set("doc1", { unsubscribe });

    mgr._releaseDocumentIfIdle("doc1", connA);

    expect(mgr.documents.has("doc1")).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("removes a doc with no unsubscribe method without throwing", () => {
    mgr.documents.set("doc1", {}); // no unsubscribe
    expect(() =>
      mgr._releaseDocumentIfIdle("doc1", { documentId: "doc1" }),
    ).not.toThrow();
    expect(mgr.documents.has("doc1")).toBe(false);
  });

  it("does not count connections on other documents", () => {
    const connA = { documentId: "doc1" };
    const connOther = { documentId: "doc2" };
    mgr.connections.set("a", connA);
    mgr.connections.set("other", connOther);
    mgr.documents.set("doc1", { unsubscribe: vi.fn() });

    mgr._releaseDocumentIfIdle("doc1", connA);

    expect(mgr.documents.has("doc1")).toBe(false); // doc2's connection is unrelated
  });
});
