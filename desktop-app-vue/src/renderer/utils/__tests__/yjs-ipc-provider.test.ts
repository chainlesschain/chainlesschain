import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { YjsIPCProvider } from "../yjs-ipc-provider";

function createBridge(connectResult: any = { success: true, data: {} }) {
  let remoteUpdateListener: ((data: any) => void) | null = null;
  let awarenessListener: ((data: any) => void) | null = null;
  const removeRemoteUpdate = vi.fn();
  const removeAwareness = vi.fn();
  const invoke = vi.fn((channel: string) =>
    Promise.resolve(
      channel === "collab:yjs-connect" ? connectResult : { success: true },
    ),
  );
  const collab = {
    invoke,
    onRemoteUpdate: vi.fn((listener: (data: any) => void) => {
      remoteUpdateListener = listener;
      return removeRemoteUpdate;
    }),
    onAwarenessUpdate: vi.fn((listener: (data: any) => void) => {
      awarenessListener = listener;
      return removeAwareness;
    }),
  };
  (window as any).electronAPI = { collab };

  return {
    collab,
    invoke,
    removeRemoteUpdate,
    removeAwareness,
    getRemoteUpdateListener: () => remoteUpdateListener,
    getAwarenessListener: () => awarenessListener,
  };
}

describe("YjsIPCProvider fixed preload bridge", () => {
  let provider: YjsIPCProvider | null = null;

  afterEach(async () => {
    if (provider?.connected) {
      await provider.disconnect();
    }
    provider = null;
    vi.restoreAllMocks();
  });

  it("connects, exchanges updates, relays awareness, and unsubscribes", async () => {
    const bridge = createBridge();
    const doc = new Y.Doc();
    provider = new YjsIPCProvider("doc-1", doc, { autoReconnect: false });

    await provider.connect();
    expect(provider.connected).toBe(true);
    expect(bridge.collab.onRemoteUpdate).toHaveBeenCalledOnce();
    expect(bridge.collab.onAwarenessUpdate).toHaveBeenCalledOnce();

    doc.getText("content").insert(0, "local");
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith("collab:yjs-update", {
        documentId: "doc-1",
        update: expect.any(Array),
      }),
    );

    const remoteDoc = new Y.Doc();
    remoteDoc.getText("content").insert(0, "remote ");
    bridge.getRemoteUpdateListener()?.({
      documentId: "doc-1",
      update: Array.from(Y.encodeStateAsUpdate(remoteDoc)),
    });
    expect(doc.getText("content").toString()).toContain("remote");

    await provider.setAwarenessState({ cursor: { line: 1, column: 2 } });
    expect(bridge.invoke).toHaveBeenCalledWith(
      "collab:yjs-awareness-update",
      expect.objectContaining({
        documentId: "doc-1",
        clientId: doc.clientID,
      }),
    );
    bridge.getAwarenessListener()?.({
      documentId: "doc-1",
      states: [{ clientId: 99, state: { name: "peer" } }],
    });
    expect(provider.getAwarenessStates().get(99)).toEqual({ name: "peer" });

    await provider.disconnect();
    expect(bridge.removeRemoteUpdate).toHaveBeenCalledOnce();
    expect(bridge.removeAwareness).toHaveBeenCalledOnce();
    expect(bridge.invoke).toHaveBeenCalledWith("collab:yjs-disconnect", {
      documentId: "doc-1",
    });
  });

  it("fails closed and tears down listeners when main rejects the connection", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const bridge = createBridge({ success: false, error: "not initialized" });
    const doc = new Y.Doc();
    provider = new YjsIPCProvider("doc-2", doc, { autoReconnect: false });

    await expect(provider.connect()).rejects.toThrow("not initialized");
    expect(provider.connected).toBe(false);
    expect(bridge.removeRemoteUpdate).toHaveBeenCalledOnce();
    expect(bridge.removeAwareness).toHaveBeenCalledOnce();

    doc.getText("content").insert(0, "must-not-send");
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
