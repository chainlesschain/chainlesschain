/**
 * Yjs Collab IPC Handler Tests
 *
 * Tests the three Yjs IPC bridge handlers registered by
 * registerRealtimeCollabIPC():
 *
 *   - collab:yjs-connect   – connects a renderer Y.Doc; returns success + documentId
 *   - collab:yjs-update    – applies an update, persists to DB, broadcasts to peer windows
 *   - collab:yjs-disconnect – cleanly disconnects a renderer from a document session
 *
 * Architecture:
 *   - The source is a CJS module that does `const { ipcMain } = require('electron')`.
 *   - We use vi.hoisted() to create capturedHandlers and config BEFORE any vi.mock()
 *     factories run (vi.mock is hoisted to the top of the file by vitest).
 *   - vi.mock('electron', ...) provides a controlled ipcMain whose handle() directly
 *     writes into capturedHandlers, and BrowserWindow.getAllWindows() reads config.allWindows.
 *   - This avoids the fragile vi.spyOn(electronMock.ipcMain, 'handle') pattern, which
 *     failed due to ESM/CJS interop: the source's require('electron') did not reliably
 *     return the same ipcMain object reference as the test's ESM import.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

// ---------------------------------------------------------------------------
// Shared mutable state for per-test behaviour control.
// Plain module-level const — no vi.hoisted needed since we no longer use
// vi.mock('electron', factory).  registerRealtimeCollabIPC() now accepts
// { ipcMain, BrowserWindow } as an injectable _deps parameter, so we pass
// our mock implementations directly instead of relying on module-level mocking.
// ---------------------------------------------------------------------------
const capturedHandlers = {};

const config = {
  allWindows: [],
  docToReturn: null,
  yjsManagerActive: true,
};

// ipcMain mock: captures channel→handler pairs for direct invocation in tests.
const mockIpcMain = {
  handle: (channel, handler) => {
    capturedHandlers[channel] = handler;
  },
};

// BrowserWindow mock: getAllWindows() reads config.allWindows at call-time so
// individual tests can control the window list (including Object.defineProperty
// overrides for error-injection tests).
const mockBrowserWindow = {
  getAllWindows: () => config.allWindows,
};

let lastApplyUpdateCall = null;
let encodeStateAsUpdateImpl = () => new Uint8Array([10, 20, 30]);

// ---------------------------------------------------------------------------
// Mock modules that are required inside the source
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// vi.mock() does not intercept require() calls from CJS server.deps.inline modules
// in Vitest's fork pool. Both yjs and realtime-collab-manager are injected via _deps
// instead, so these vi.mock() declarations are kept only as safety nets for any
// ESM import paths that might be added in the future.
vi.mock("../realtime-collab-manager.js", () => ({
  getRealtimeCollabManager: () => ({
    get yjsCollabManager() {
      return { getDocument: () => null };
    },
  }),
}));

// yjs is ESM-only; injected via _deps.Y to bypass require() interop failure.
const mockY = {
  encodeStateAsUpdate: (...a) => encodeStateAsUpdateImpl(...a),
  applyUpdate: (...a) => {
    lastApplyUpdateCall = a;
  },
};

// getYjsManager is injected via _deps to bypass require() interop failure.
const mockGetYjsManager = () => {
  if (!config.yjsManagerActive) return null;
  return { getDocument: () => config.docToReturn };
};

vi.mock("uuid", () => ({
  v4: () => "uuid-test",
}));

vi.mock("../yjs-collab-manager.js", () => ({}));

// ---------------------------------------------------------------------------
// Load and register handlers once in beforeAll.
// capturedHandlers is already populated when registerRealtimeCollabIPC() calls
// ipcMain.handle() via the mock above.
// ---------------------------------------------------------------------------
function makeMockDb() {
  const stmtRun = vi.fn();
  const prepare = vi.fn(() => ({ run: stmtRun }));
  return { prepare, _stmtRun: stmtRun };
}

let baseDb;

const mockDeps = {
  ipcMain: mockIpcMain,
  BrowserWindow: mockBrowserWindow,
  Y: mockY,
  getYjsManager: mockGetYjsManager,
};

beforeAll(async () => {
  baseDb = makeMockDb();
  const { registerRealtimeCollabIPC } =
    await import("../realtime-collab-ipc.js");
  registerRealtimeCollabIPC(baseDb, mockDeps);
});

beforeEach(() => {
  config.allWindows = [];
  config.docToReturn = null;
  config.yjsManagerActive = true;
  lastApplyUpdateCall = null;
  encodeStateAsUpdateImpl = () => new Uint8Array([10, 20, 30]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Yjs Collab IPC Handlers", () => {
  // -------------------------------------------------------------------------
  // Handler registration
  // -------------------------------------------------------------------------

  describe("Handler registration", () => {
    it("registers collab:yjs-connect handler", () => {
      expect(capturedHandlers["collab:yjs-connect"]).toBeDefined();
      expect(typeof capturedHandlers["collab:yjs-connect"]).toBe("function");
    });

    it("registers collab:yjs-update handler", () => {
      expect(capturedHandlers["collab:yjs-update"]).toBeDefined();
      expect(typeof capturedHandlers["collab:yjs-update"]).toBe("function");
    });

    it("registers collab:yjs-disconnect handler", () => {
      expect(capturedHandlers["collab:yjs-disconnect"]).toBeDefined();
      expect(typeof capturedHandlers["collab:yjs-disconnect"]).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // collab:yjs-connect
  // -------------------------------------------------------------------------

  describe("collab:yjs-connect", () => {
    it("returns success:true with the requested documentId", async () => {
      const result = await capturedHandlers["collab:yjs-connect"](
        {},
        { documentId: "doc-alpha" },
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("documentId", "doc-alpha");
    });

    it("returns initialState:null when no existing Y.Doc is found", async () => {
      config.docToReturn = null;
      const result = await capturedHandlers["collab:yjs-connect"](
        {},
        { documentId: "new-doc" },
      );
      expect(result.success).toBe(true);
      expect(result.data.initialState).toBeNull();
    });

    it("returns initialState as an array when an existing Y.Doc is found", async () => {
      config.docToReturn = {}; // truthy → encodeStateAsUpdate will be called
      const result = await capturedHandlers["collab:yjs-connect"](
        {},
        { documentId: "existing" },
      );
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.initialState)).toBe(true);
      expect(result.data.initialState).toHaveLength(3);
    });

    it("returns success:false with non-empty error when documentId is missing", async () => {
      const result = await capturedHandlers["collab:yjs-connect"]({}, {});
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    });

    it("swallows encode errors and returns success:true with null initialState", async () => {
      config.docToReturn = {}; // non-null so encode is attempted
      encodeStateAsUpdateImpl = () => {
        throw new Error("encode failed");
      };
      const result = await capturedHandlers["collab:yjs-connect"](
        {},
        { documentId: "doc-err" },
      );
      expect(result.success).toBe(true);
      expect(result.data.initialState).toBeNull();
    });

    it("returns the verbatim documentId in the response data", async () => {
      const result = await capturedHandlers["collab:yjs-connect"](
        {},
        { documentId: "MY-DOC-999" },
      );
      expect(result.data.documentId).toBe("MY-DOC-999");
    });

    it("returns success:true when yjsCollabManager is null on the manager", async () => {
      config.yjsManagerActive = false;
      const result = await capturedHandlers["collab:yjs-connect"](
        {},
        { documentId: "robust" },
      );
      expect(result.success).toBe(true);
      expect(result.data.initialState).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // collab:yjs-update
  // -------------------------------------------------------------------------

  describe("collab:yjs-update", () => {
    it("returns success:true when valid documentId and update are provided", async () => {
      const result = await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-1", update: [1, 2, 3, 4] },
      );
      expect(result.success).toBe(true);
    });

    it("returns success:false with string error when documentId is missing", async () => {
      const result = await capturedHandlers["collab:yjs-update"](
        {},
        { update: [1, 2, 3] },
      );
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    });

    it("returns success:false with string error when update is missing", async () => {
      const result = await capturedHandlers["collab:yjs-update"](
        {},
        { documentId: "doc-x" },
      );
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    });

    it("broadcasts the update to peer windows", async () => {
      const peerSend = vi.fn();
      config.allWindows = [{ webContents: { id: 99, send: peerSend } }];

      await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-broadcast", update: [7, 8] },
      );

      expect(peerSend).toHaveBeenCalledWith(
        "collab:yjs-remote-update",
        expect.objectContaining({ documentId: "doc-broadcast" }),
      );
    });

    it("does NOT echo the update back to the originating window", async () => {
      const senderSend = vi.fn();
      config.allWindows = [{ webContents: { id: 42, send: senderSend } }];

      await capturedHandlers["collab:yjs-update"](
        { sender: { id: 42 } }, // same id → skip
        { documentId: "doc-echo", update: [1] },
      );

      expect(senderSend).not.toHaveBeenCalled();
    });

    it("calls Y.applyUpdate on the main Y.Doc when one is found", async () => {
      const fakeDoc = { _test: true };
      config.docToReturn = fakeDoc;

      await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-apply", update: [9, 8, 7] },
      );

      expect(lastApplyUpdateCall).not.toBeNull();
      expect(lastApplyUpdateCall[0]).toBe(fakeDoc);
      expect(lastApplyUpdateCall[1]).toBeInstanceOf(Uint8Array);
      expect(lastApplyUpdateCall[2]).toBe("renderer");
    });

    it('broadcast payload has correct shape: documentId, update array, origin="peer"', async () => {
      const peerSend = vi.fn();
      config.allWindows = [{ webContents: { id: 77, send: peerSend } }];

      await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "shape-doc", update: [3, 2, 1] },
      );

      const [channel, payload] = peerSend.mock.calls[0];
      expect(channel).toBe("collab:yjs-remote-update");
      expect(payload).toHaveProperty("documentId", "shape-doc");
      expect(Array.isArray(payload.update)).toBe(true);
      expect(payload).toHaveProperty("origin", "peer");
    });

    it("returns success:true when BrowserWindow.getAllWindows throws", async () => {
      // Override allWindows via a property getter that throws
      const originalAllWindows = config.allWindows;
      Object.defineProperty(config, "allWindows", {
        get: () => {
          throw new Error("getAllWindows exploded");
        },
        configurable: true,
      });

      const result = await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-boom", update: [0] },
      );

      Object.defineProperty(config, "allWindows", {
        value: originalAllWindows,
        writable: true,
        configurable: true,
      });

      expect(result.success).toBe(true);
    });

    it("persists the update to the database via prepare().run()", async () => {
      const freshDb = makeMockDb();
      const { registerRealtimeCollabIPC } =
        await import("../realtime-collab-ipc.js");
      registerRealtimeCollabIPC(freshDb, mockDeps);

      await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-persist", update: [5, 6, 7] },
      );

      expect(freshDb.prepare).toHaveBeenCalled();
      expect(freshDb._stmtRun).toHaveBeenCalled();

      // Re-register with original db to restore state for remaining tests
      registerRealtimeCollabIPC(baseDb, mockDeps);
    });

    it("SQL statement contains INSERT INTO collab_yjs_updates", async () => {
      const freshDb = makeMockDb();
      const { registerRealtimeCollabIPC } =
        await import("../realtime-collab-ipc.js");
      registerRealtimeCollabIPC(freshDb, mockDeps);

      await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-sql", update: [1] },
      );

      const prepareArg = freshDb.prepare.mock.calls[0][0];
      expect(prepareArg).toMatch(/INSERT INTO collab_yjs_updates/i);

      registerRealtimeCollabIPC(baseDb, mockDeps);
    });

    it("still returns success:true when database is null", async () => {
      const { registerRealtimeCollabIPC } =
        await import("../realtime-collab-ipc.js");
      registerRealtimeCollabIPC(null, mockDeps);

      const result = await capturedHandlers["collab:yjs-update"](
        { sender: { id: 1 } },
        { documentId: "doc-nodb", update: [1, 2] },
      );

      registerRealtimeCollabIPC(baseDb, mockDeps);
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // collab:yjs-disconnect
  // -------------------------------------------------------------------------

  describe("collab:yjs-disconnect", () => {
    it("returns success:true for a valid documentId", async () => {
      const result = await capturedHandlers["collab:yjs-disconnect"](
        {},
        { documentId: "bye" },
      );
      expect(result.success).toBe(true);
    });

    it("returns success:false with non-empty error when documentId is missing", async () => {
      const result = await capturedHandlers["collab:yjs-disconnect"]({}, {});
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    });

    it("does not broadcast to any windows on disconnect", async () => {
      const windowSend = vi.fn();
      config.allWindows = [{ webContents: { id: 5, send: windowSend } }];
      await capturedHandlers["collab:yjs-disconnect"](
        {},
        { documentId: "doc-silent" },
      );
      expect(windowSend).not.toHaveBeenCalled();
    });

    it("does not perform database operations on disconnect", async () => {
      const freshDb = makeMockDb();
      const { registerRealtimeCollabIPC } =
        await import("../realtime-collab-ipc.js");
      registerRealtimeCollabIPC(freshDb, mockDeps);

      await capturedHandlers["collab:yjs-disconnect"](
        {},
        { documentId: "doc-clean" },
      );

      registerRealtimeCollabIPC(baseDb, mockDeps);
      expect(freshDb.prepare).not.toHaveBeenCalled();
    });
  });
});
