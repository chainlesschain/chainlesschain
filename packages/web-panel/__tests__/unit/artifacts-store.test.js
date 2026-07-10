import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw,
    onMessage: () => () => {},
    onRuntimeEvent: () => () => {},
  }),
}));

import { useArtifactsStore } from "../../src/stores/artifacts.js";

describe("artifacts store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sendRaw.mockReset();
  });

  it("fetchArtifacts sends artifact-list (with filters) and stores newest first", async () => {
    sendRaw.mockResolvedValueOnce({
      type: "artifact-list",
      artifacts: [
        { id: "art_old", kind: "report" },
        { id: "art_new", kind: "log" },
      ],
    });
    const store = useArtifactsStore();
    await store.fetchArtifacts();
    expect(sendRaw).toHaveBeenCalledWith({ type: "artifact-list" });
    expect(store.artifacts.map((a) => a.id)).toEqual(["art_new", "art_old"]);
    expect(store.kinds).toEqual(["log", "report"]);

    sendRaw.mockResolvedValueOnce({ type: "artifact-list", artifacts: [] });
    store.kindFilter = "report";
    store.sessionFilter = "s1";
    await store.fetchArtifacts();
    expect(sendRaw).toHaveBeenLastCalledWith({
      type: "artifact-list",
      kind: "report",
      session: "s1",
    });
  });

  it("openPreview stores text content; previewImageSrc builds a data URI for images", async () => {
    const store = useArtifactsStore();
    sendRaw.mockResolvedValueOnce({
      type: "artifact-content",
      previewable: true,
      encoding: "utf8",
      content: "# report",
      truncated: false,
    });
    await store.openPreview({ id: "art_1", mime: "text/markdown" });
    expect(sendRaw).toHaveBeenCalledWith({
      type: "artifact-content",
      artifactId: "art_1",
    });
    expect(store.preview.previewable).toBe(true);
    expect(store.preview.content).toBe("# report");
    expect(store.previewImageSrc).toBeNull();

    sendRaw.mockResolvedValueOnce({
      type: "artifact-content",
      previewable: true,
      encoding: "base64",
      content: "aGk=",
    });
    await store.openPreview({ id: "art_2", mime: "image/png" });
    expect(store.previewImageSrc).toBe("data:image/png;base64,aGk=");
  });

  it("openPreview surfaces non-previewable reason; failure is contained", async () => {
    const store = useArtifactsStore();
    sendRaw.mockResolvedValueOnce({
      type: "artifact-content",
      previewable: false,
      reason: "no inline preview",
    });
    await store.openPreview({ id: "art_z", mime: "application/zip" });
    expect(store.preview.previewable).toBe(false);
    expect(store.preview.reason).toBe("no inline preview");

    sendRaw.mockRejectedValueOnce(new Error("boom"));
    await store.openPreview({ id: "art_err", mime: "text/plain" });
    expect(store.preview.previewable).toBe(false);
    expect(store.preview.reason).toBe("boom");
  });

  it("removeArtifact closes an open preview of that id and refreshes", async () => {
    const store = useArtifactsStore();
    sendRaw.mockResolvedValueOnce({
      type: "artifact-content",
      previewable: true,
      encoding: "utf8",
      content: "x",
    });
    await store.openPreview({ id: "art_1", mime: "text/plain" });

    sendRaw
      .mockResolvedValueOnce({ type: "artifact-remove", found: true })
      .mockResolvedValueOnce({ type: "artifact-list", artifacts: [] });
    const ok = await store.removeArtifact("art_1");
    expect(ok).toBe(true);
    expect(store.preview).toBeNull();
    expect(sendRaw).toHaveBeenCalledWith({
      type: "artifact-remove",
      artifactId: "art_1",
    });
  });

  it("cleanExpired returns the removed count and refreshes", async () => {
    const store = useArtifactsStore();
    sendRaw
      .mockResolvedValueOnce({ type: "artifact-clean", removed: 3 })
      .mockResolvedValueOnce({ type: "artifact-list", artifacts: [] });
    await expect(store.cleanExpired()).resolves.toBe(3);
    expect(sendRaw).toHaveBeenCalledWith({ type: "artifact-clean" });
  });

  it("formatSize / kindColor helpers", () => {
    const store = useArtifactsStore();
    expect(store.formatSize(512)).toBe("512 B");
    expect(store.formatSize(2048)).toBe("2.0 KB");
    expect(store.formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(store.kindColor("report")).toBe("blue");
    expect(store.kindColor("mystery")).toBe("default");
  });
});
