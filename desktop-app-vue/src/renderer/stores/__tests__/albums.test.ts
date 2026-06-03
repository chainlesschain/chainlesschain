/**
 * useAlbumsStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: myAlbums / sharedWithMe / totalPhotoCount / currentPhotoCount /
 *    currentMemberCount / isCurrentAlbumOwner / canEditCurrentAlbum (role-based)
 *  - IPC action (mocked): loadAlbums (sets albums) — exercises createRetryableIPC mock
 *  - Pure actions: clearSelection / resetUploadProgress
 *
 * NB: albums.ts builds ipcRenderer at MODULE LOAD via createRetryableIPC, and
 * imports it from "../utils/ipc" (= renderer/utils/ipc). From this test file
 * (stores/__tests__/) that resolves as "../../utils/ipc". Use vi.hoisted so
 * mockInvoke exists when the factory captures it. (See memory
 * vitest-vimock-path-relative-to-testfile.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../utils/ipc", () => ({
  createRetryableIPC: () => ({ invoke: mockInvoke }),
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useAlbumsStore } from "../albums";
import type { Album, AlbumMemberRole } from "../albums";

function album(
  id: string,
  role: AlbumMemberRole | undefined,
  overrides: Partial<Album> = {},
): Album {
  return {
    id,
    name: `Album ${id}`,
    description: null,
    cover_url: null,
    owner_did: "did:me",
    visibility: "private",
    member_role: role,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

describe("useAlbumsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useAlbumsStore();
      expect(store.albums).toEqual([]);
      expect(store.currentAlbum).toBeNull();
      expect(store.currentPhotos).toEqual([]);
      expect(store.members).toEqual([]);
      expect(store.uploadProgress).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("myAlbums vs sharedWithMe split by member_role", () => {
      const store = useAlbumsStore();
      store.albums = [
        album("a", "owner"),
        album("b", "editor"),
        album("c", "viewer"),
        album("d", undefined), // no role → neither
      ];
      expect(store.myAlbums.map((a) => a.id)).toEqual(["a"]);
      expect(store.sharedWithMe.map((a) => a.id)).toEqual(["b", "c"]);
    });

    it("totalPhotoCount sums photo_count (treating missing as 0)", () => {
      const store = useAlbumsStore();
      store.albums = [
        album("a", "owner", { photo_count: 5 }),
        album("b", "viewer", { photo_count: 3 }),
        album("c", "owner"), // undefined → 0
      ];
      expect(store.totalPhotoCount).toBe(8);
    });

    it("currentPhotoCount + currentMemberCount mirror arrays", () => {
      const store = useAlbumsStore();
      store.currentPhotos = [{ id: "p1" } as any, { id: "p2" } as any];
      store.members = [{ did: "m1" } as any];
      expect(store.currentPhotoCount).toBe(2);
      expect(store.currentMemberCount).toBe(1);
    });

    it("isCurrentAlbumOwner is true only for owner role", () => {
      const store = useAlbumsStore();
      expect(store.isCurrentAlbumOwner).toBe(false); // no current album
      store.currentAlbum = album("a", "editor");
      expect(store.isCurrentAlbumOwner).toBe(false);
      store.currentAlbum = album("a", "owner");
      expect(store.isCurrentAlbumOwner).toBe(true);
    });

    it("canEditCurrentAlbum allows owner + editor, not viewer", () => {
      const store = useAlbumsStore();
      store.currentAlbum = album("a", "viewer");
      expect(store.canEditCurrentAlbum).toBe(false);
      store.currentAlbum = album("a", "editor");
      expect(store.canEditCurrentAlbum).toBe(true);
      store.currentAlbum = album("a", "owner");
      expect(store.canEditCurrentAlbum).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // loadAlbums (IPC)
  // -------------------------------------------------------------------------

  describe("loadAlbums", () => {
    it("sets albums from the IPC array result", async () => {
      const store = useAlbumsStore();
      mockInvoke.mockResolvedValueOnce([
        album("a", "owner"),
        album("b", "viewer"),
      ]);
      await store.loadAlbums();
      expect(mockInvoke).toHaveBeenCalledWith("album:get-list", undefined);
      expect(store.albums.map((a) => a.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("falls back to an empty array on a non-array result", async () => {
      const store = useAlbumsStore();
      mockInvoke.mockResolvedValueOnce(null);
      await store.loadAlbums();
      expect(store.albums).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("clearSelection resets current album context", () => {
      const store = useAlbumsStore();
      store.currentAlbum = album("a", "owner");
      store.currentPhotos = [{ id: "p1" } as any];
      store.members = [{ did: "m1" } as any];
      store.uploadProgress = 50;
      store.clearSelection();
      expect(store.currentAlbum).toBeNull();
      expect(store.currentPhotos).toEqual([]);
      expect(store.members).toEqual([]);
      expect(store.uploadProgress).toBe(0);
    });

    it("resetUploadProgress zeroes the progress", () => {
      const store = useAlbumsStore();
      store.uploadProgress = 80;
      store.resetUploadProgress();
      expect(store.uploadProgress).toBe(0);
    });
  });
});
