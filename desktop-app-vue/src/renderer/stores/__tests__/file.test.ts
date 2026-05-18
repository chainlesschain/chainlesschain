/**
 * useFileStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - loadFiles() action and IPC calls
 *  - uploadFile() action
 *  - deleteFile() action (list removal, currentFile clearing)
 *  - lockFile() / unlockFile() actions
 *  - loadFileVersions() action
 *  - rollbackToVersion() action
 *  - shareFile() action
 *  - loadSharedFiles() action
 *  - openFileDetail() / closeFileDetail()
 *  - updateFilters() / clearFilters()
 *  - Getters: filesByType, lockedFiles, fileStats
 *  - Error handling for IPC failures
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Mock ant-design-vue message
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock identityStore
vi.mock("../identityStore", () => ({
  useIdentityStore: vi.fn(() => ({
    currentUserDID: null,
  })),
}));

import type { ProjectFile, FileVersion } from "../file";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "file-1",
    name: "test.txt",
    file_type: "document",
    size: 1024,
    path: "/files/test.txt",
    created_by: "did:user:1",
    lock_status: "unlocked",
    version: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeVersion(overrides: Partial<FileVersion> = {}): FileVersion {
  return {
    id: "ver-1",
    file_id: "file-1",
    version: 1,
    size: 1024,
    hash: "abc123",
    created_by: "did:user:1",
    created_at: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFileStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue({ success: true });

    (window as any).ipc = {
      invoke: mockInvoke,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("files starts as empty array", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      expect(store.files).toEqual([]);
    });

    it("currentFile starts as null", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      expect(store.currentFile).toBeNull();
    });

    it("loading starts as false", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      expect(store.loading).toBe(false);
    });

    it("filters starts with all null values", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      expect(store.filters).toEqual({
        project_id: null,
        org_id: null,
        workspace_id: null,
        file_type: null,
        locked: null,
      });
    });

    it("fileDetailVisible starts as false", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      expect(store.fileDetailVisible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadFiles
  // -------------------------------------------------------------------------

  describe("loadFiles()", () => {
    it("calls file:list IPC and populates files on success", async () => {
      const fileList = [makeFile({ id: "f1" }), makeFile({ id: "f2" })];
      mockInvoke.mockResolvedValueOnce({ success: true, files: fileList });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.loadFiles();

      expect(mockInvoke).toHaveBeenCalledWith("file:list", {
        filters: expect.objectContaining({ project_id: null }),
      });
      expect(store.files).toHaveLength(2);
      expect(store.files[0].id).toBe("f1");
    });

    it("sets loading to false after completion", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, files: [] });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.loadFiles();

      expect(store.loading).toBe(false);
    });

    it("handles IPC failure gracefully", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, error: "db error" });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.loadFiles();

      expect(store.files).toEqual([]);
      expect(store.loading).toBe(false);
    });

    it("handles IPC exception gracefully", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("network error"));

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.loadFiles();

      expect(store.files).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // uploadFile
  // -------------------------------------------------------------------------

  describe("uploadFile()", () => {
    it("calls file:upload and returns file on success", async () => {
      const uploaded = makeFile({ id: "new-1", name: "uploaded.pdf" });
      // First call: file:upload, second call: file:list (from loadFiles inside uploadFile)
      mockInvoke
        .mockResolvedValueOnce({ success: true, file: uploaded })
        .mockResolvedValueOnce({ success: true, files: [uploaded] });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.uploadFile({
        name: "uploaded.pdf",
        path: "/tmp/uploaded.pdf",
      });

      expect(mockInvoke).toHaveBeenCalledWith("file:upload", {
        fileData: { name: "uploaded.pdf", path: "/tmp/uploaded.pdf" },
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("new-1");
    });

    it("returns null on upload failure", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, error: "too large" });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.uploadFile({
        name: "big.zip",
        path: "/tmp/big.zip",
      });

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // deleteFile
  // -------------------------------------------------------------------------

  describe("deleteFile()", () => {
    it("removes file from list on success", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.files = [makeFile({ id: "f1" }), makeFile({ id: "f2" })];

      mockInvoke.mockResolvedValueOnce({ success: true });
      const result = await store.deleteFile("f1");

      expect(result).toBe(true);
      expect(store.files).toHaveLength(1);
      expect(store.files[0].id).toBe("f2");
    });

    it("clears currentFile if deleted file was open", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const file = makeFile({ id: "f1" });
      store.files = [file];
      store.currentFile = file;
      store.fileDetailVisible = true;

      mockInvoke.mockResolvedValueOnce({ success: true });
      await store.deleteFile("f1");

      expect(store.currentFile).toBeNull();
      expect(store.fileDetailVisible).toBe(false);
    });

    it("returns false on failure", async () => {
      mockInvoke.mockResolvedValueOnce({
        success: false,
        error: "permission denied",
      });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.files = [makeFile({ id: "f1" })];

      const result = await store.deleteFile("f1");
      expect(result).toBe(false);
      expect(store.files).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // lockFile / unlockFile
  // -------------------------------------------------------------------------

  describe("lockFile() / unlockFile()", () => {
    it("lockFile calls file:lock IPC and reloads files", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, files: [] });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.lockFile("f1", 7200000);

      expect(mockInvoke).toHaveBeenCalledWith("file:lock", {
        fileId: "f1",
        expiresIn: 7200000,
      });
      expect(result).toBe(true);
    });

    it("unlockFile calls file:unlock IPC", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, files: [] });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.unlockFile("f1");

      expect(mockInvoke).toHaveBeenCalledWith("file:unlock", { fileId: "f1" });
      expect(result).toBe(true);
    });

    it("lockFile returns false on failure", async () => {
      mockInvoke.mockResolvedValueOnce({
        success: false,
        error: "already locked",
      });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.lockFile("f1");

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadFileVersions / rollbackToVersion
  // -------------------------------------------------------------------------

  describe("Versions", () => {
    it("loadFileVersions populates currentFileVersions", async () => {
      const versions = [
        makeVersion({ version: 1 }),
        makeVersion({ version: 2 }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: true, versions });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.loadFileVersions("f1");

      expect(store.currentFileVersions).toHaveLength(2);
    });

    it("rollbackToVersion calls file:rollback and reloads", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // rollback
        .mockResolvedValueOnce({ success: true, files: [] }) // loadFiles
        .mockResolvedValueOnce({ success: true, versions: [] }); // loadFileVersions

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.rollbackToVersion("f1", 2);

      expect(mockInvoke).toHaveBeenCalledWith("file:rollback", {
        fileId: "f1",
        targetVersion: 2,
      });
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // shareFile / loadSharedFiles
  // -------------------------------------------------------------------------

  describe("Sharing", () => {
    it("shareFile calls file:share and returns share object", async () => {
      const share = {
        id: "s1",
        file_id: "f1",
        shared_by: "u1",
        shared_with: "u2",
        permission: "view",
        created_at: Date.now(),
      };
      mockInvoke.mockResolvedValueOnce({ success: true, share });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      const result = await store.shareFile({
        file_id: "f1",
        shared_with: "u2",
        permission: "view",
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("s1");
    });

    it("loadSharedFiles populates sharedFiles", async () => {
      const shared = [makeFile({ id: "sf1" })];
      mockInvoke.mockResolvedValueOnce({ success: true, files: shared });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.loadSharedFiles("org-1");

      expect(store.sharedFiles).toHaveLength(1);
      expect(mockInvoke).toHaveBeenCalledWith("file:sharedFiles", {
        orgId: "org-1",
      });
    });
  });

  // -------------------------------------------------------------------------
  // openFileDetail / closeFileDetail
  // -------------------------------------------------------------------------

  describe("File detail", () => {
    it("openFileDetail sets currentFile and loads versions", async () => {
      const file = makeFile({ id: "f1" });
      const versions = [makeVersion()];
      mockInvoke
        .mockResolvedValueOnce({ success: true, file }) // file:detail
        .mockResolvedValueOnce({ success: true, versions }); // file:versions

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      await store.openFileDetail("f1");

      expect(store.currentFile).not.toBeNull();
      expect(store.currentFile!.id).toBe("f1");
      expect(store.fileDetailVisible).toBe(true);
      expect(store.currentFileVersions).toHaveLength(1);
    });

    it("closeFileDetail clears state", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.currentFile = makeFile();
      store.fileDetailVisible = true;
      store.currentFileVersions = [makeVersion()];

      store.closeFileDetail();

      expect(store.currentFile).toBeNull();
      expect(store.fileDetailVisible).toBe(false);
      expect(store.currentFileVersions).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("filesByType groups files by file_type", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.files = [
        makeFile({ id: "f1", file_type: "document" }),
        makeFile({ id: "f2", file_type: "image" }),
        makeFile({ id: "f3", file_type: "document" }),
      ];

      expect(store.filesByType["document"]).toHaveLength(2);
      expect(store.filesByType["image"]).toHaveLength(1);
    });

    it("lockedFiles returns only locked files", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.files = [
        makeFile({ id: "f1", lock_status: "unlocked" }),
        makeFile({ id: "f2", lock_status: "locked" }),
        makeFile({ id: "f3", lock_status: "exclusive" }),
      ];

      expect(store.lockedFiles).toHaveLength(2);
    });

    it("fileStats computes correct totals", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.files = [
        makeFile({ id: "f1", file_type: "document", lock_status: "unlocked" }),
        makeFile({ id: "f2", file_type: "image", lock_status: "locked" }),
      ];
      store.sharedFiles = [makeFile({ id: "sf1" })];

      const stats = store.fileStats;
      expect(stats.total).toBe(2);
      expect(stats.locked).toBe(1);
      expect(stats.shared).toBe(1);
      expect(stats.byType["document"]).toBe(1);
      expect(stats.byType["image"]).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  describe("Filters", () => {
    it("updateFilters merges new filters and triggers loadFiles", async () => {
      mockInvoke.mockResolvedValue({ success: true, files: [] });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.updateFilters({ file_type: "image" });

      expect(store.filters.file_type).toBe("image");
      expect(store.filters.project_id).toBeNull();
    });

    it("clearFilters resets all filters to null", async () => {
      mockInvoke.mockResolvedValue({ success: true, files: [] });

      const { useFileStore } = await import("../file");
      const store = useFileStore();
      store.filters = {
        project_id: "p1",
        org_id: "o1",
        workspace_id: "w1",
        file_type: "code",
        locked: true,
      };

      store.clearFilters();

      expect(store.filters).toEqual({
        project_id: null,
        org_id: null,
        workspace_id: null,
        file_type: null,
        locked: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("resets all state to initial values", async () => {
      const { useFileStore } = await import("../file");
      const store = useFileStore();

      // Populate state
      store.files = [makeFile()];
      store.currentFile = makeFile();
      store.currentFileVersions = [makeVersion()];
      store.sharedFiles = [makeFile()];
      store.uploadProgress = { "file-1": 50 };
      store.loading = true;
      store.fileDetailVisible = true;
      store.versionViewerVisible = true;
      store.filters = {
        project_id: "p1",
        org_id: "o1",
        workspace_id: "w1",
        file_type: "code",
        locked: true,
      };

      store.reset();

      expect(store.files).toEqual([]);
      expect(store.currentFile).toBeNull();
      expect(store.currentFileVersions).toEqual([]);
      expect(store.sharedFiles).toEqual([]);
      expect(store.uploadProgress).toEqual({});
      expect(store.loading).toBe(false);
      expect(store.fileDetailVisible).toBe(false);
      expect(store.versionViewerVisible).toBe(false);
      expect(store.filters).toEqual({
        project_id: null,
        org_id: null,
        workspace_id: null,
        file_type: null,
        locked: null,
      });
    });
  });
});
