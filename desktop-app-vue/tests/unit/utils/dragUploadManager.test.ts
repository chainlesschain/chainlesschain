/**
 * dragUploadManager 测试 — src/renderer/utils/dragUploadManager.ts
 *
 * Default-export singleton that listens on document drag events. We drive it
 * with synthetic Events carrying a stubbed dataTransfer (jsdom can't build a
 * populated DragEvent), exercising the private validate→handler flow. State is
 * reset per test; the private dragCounter is avoided (assert enter→true and
 * drop→reset rather than relying on leave reaching zero).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import dragUploadManager, { useDragUpload } from "@/utils/dragUploadManager";

const unsubs: Array<() => void> = [];
beforeEach(() => {
  dragUploadManager.setAllowedTypes([]);
  dragUploadManager.setMaxFileSize(100 * 1024 * 1024);
  dragUploadManager.isDragging.value = false;
});
afterEach(() => {
  unsubs.splice(0).forEach((u) => u());
});

function fireDragEnter(hasItems = true) {
  const e = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: { items: hasItems ? [{}] : [], files: [] },
    configurable: true,
  });
  document.dispatchEvent(e);
}

async function fireDrop(files: File[]) {
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: { files, items: files.map(() => ({})) },
    configurable: true,
  });
  document.dispatchEvent(e);
  await new Promise((r) => setTimeout(r, 0)); // flush the async handleDrop
}

describe("dragUploadManager — drag state", () => {
  it("dragenter with items sets isDragging true; drop resets it", async () => {
    fireDragEnter(true);
    expect(dragUploadManager.isDragging.value).toBe(true);
    await fireDrop([new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(dragUploadManager.isDragging.value).toBe(false);
  });
});

describe("dragUploadManager — upload handlers", () => {
  it("invokes registered handlers with the dropped files; unregister stops them", async () => {
    const handler = vi.fn();
    unsubs.push(dragUploadManager.onUpload(handler));
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await fireDrop([file]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toHaveLength(1);

    unsubs.splice(0).forEach((u) => u()); // unregister
    await fireDrop([file]);
    expect(handler).toHaveBeenCalledTimes(1); // no further calls
  });
});

describe("dragUploadManager — validation", () => {
  it("filters by allowed extension", async () => {
    const handler = vi.fn();
    unsubs.push(dragUploadManager.onUpload(handler));
    dragUploadManager.setAllowedTypes([".txt"]);
    await fireDrop([new File(["x"], "img.png", { type: "image/png" })]);
    expect(handler).not.toHaveBeenCalled(); // wrong extension → no valid files
    await fireDrop([new File(["x"], "ok.txt", { type: "text/plain" })]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects files over the max size", async () => {
    const handler = vi.fn();
    unsubs.push(dragUploadManager.onUpload(handler));
    dragUploadManager.setMaxFileSize(5);
    await fireDrop([new File(["123456789"], "big.txt", { type: "text/plain" })]);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("dragUploadManager — useDragUpload", () => {
  it("exposes the singleton's ref + methods", () => {
    const d = useDragUpload();
    expect(d.isDragging).toBe(dragUploadManager.isDragging);
    expect(typeof d.onUpload).toBe("function");
    const off = d.onUpload(vi.fn());
    expect(typeof off).toBe("function");
    off();
  });
});
