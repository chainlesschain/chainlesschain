/**
 * Albums Store - Pinia State Management
 * Manages shared photo albums state, photos, and members.
 *
 * @module albums-store
 * @version 0.40.0
 */

import { defineStore } from 'pinia';
import { createRetryableIPC } from '../utils/ipc';
import { logger } from '@/utils/logger';

// ==================== Type Definitions ====================

/**
 * Album visibility
 */
export type AlbumVisibility = 'private' | 'friends' | 'public';

/**
 * Album member role
 */
export type AlbumMemberRole = 'owner' | 'editor' | 'viewer';

/**
 * Shared Album
 */
export interface Album {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  owner_did: string;
  visibility: AlbumVisibility;
  photo_count?: number;
  member_count?: number;
  member_role?: AlbumMemberRole;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * Album Photo
 */
export interface AlbumPhoto {
  id: string;
  album_id: string;
  uploader_did: string;
  file_path: string | null;
  thumbnail_path: string | null;
  caption: string | null;
  file_size: number;
  mime_type: string;
  width: number;
  height: number;
  is_encrypted: number;
  created_at: number;
  [key: string]: any;
}

/**
 * Album Member
 */
export interface AlbumMember {
  id: string;
  album_id: string;
  member_did: string;
  role: AlbumMemberRole;
  joined_at: number;
  [key: string]: any;
}

/**
 * Create Album params
 */
export interface CreateAlbumParams {
  name: string;
  description?: string;
  coverUrl?: string;
  visibility?: AlbumVisibility;
}

/**
 * Add Photo params
 */
export interface AddPhotoParams {
  albumId: string;
  rawFilePath?: string;
  filePath?: string;
  thumbnailPath?: string;
  caption?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  isEncrypted?: boolean;
  quality?: number;
  thumbnailSize?: number;
}

/**
 * Albums Store state
 */
export interface AlbumsState {
  albums: Album[];
  currentAlbum: Album | null;
  currentPhotos: AlbumPhoto[];
  members: AlbumMember[];
  uploadProgress: number;
  loading: boolean;
}

// ==================== IPC Setup ====================

const ipcRenderer = createRetryableIPC((window as any).electron?.ipcRenderer, {
  silentErrors: true,
});

// ==================== Store ====================

export const useAlbumsStore = defineStore('albums', {
  state: (): AlbumsState => ({
    albums: [],
    currentAlbum: null,
    currentPhotos: [],
    members: [],
    uploadProgress: 0,
    loading: false,
  }),

  getters: {
    /**
     * Albums owned by the current user
     */
    myAlbums(): Album[] {
      return this.albums.filter(
        (a) => a.member_role === 'owner',
      );
    },

    /**
     * Albums shared with the current user
     */
    sharedWithMe(): Album[] {
      return this.albums.filter(
        (a) => a.member_role && a.member_role !== 'owner',
      );
    },

    /**
     * Total photo count across all albums
     */
    totalPhotoCount(): number {
      return this.albums.reduce(
        (sum, a) => sum + (a.photo_count || 0),
        0,
      );
    },

    /**
     * Current album photo count
     */
    currentPhotoCount(): number {
      return this.currentPhotos.length;
    },

    /**
     * Current album member count
     */
    currentMemberCount(): number {
      return this.members.length;
    },

    /**
     * Whether the current user is the owner of the current album
     */
    isCurrentAlbumOwner(): boolean {
      return this.currentAlbum?.member_role === 'owner';
    },

    /**
     * Whether the current user can edit the current album
     */
    canEditCurrentAlbum(): boolean {
      const role = this.currentAlbum?.member_role;
      return role === 'owner' || role === 'editor';
    },
  },

  actions: {
    // ========== Album CRUD ==========

    /**
     * Load all albums
     */
    async loadAlbums(options?: {
      limit?: number;
      offset?: number;
      visibility?: AlbumVisibility;
    }): Promise<void> {
      this.loading = true;
      try {
        const albums = await ipcRenderer.invoke('album:get-list', options);
        this.albums = Array.isArray(albums) ? albums : [];
      } catch (error: any) {
        if (error?.message !== 'IPC not available') {
          logger.error('Failed to load albums:', error);
        }
        this.albums = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Create a new album
     */
    async createAlbum(params: CreateAlbumParams): Promise<Album> {
      try {
        const album = await ipcRenderer.invoke('album:create', params);
        this.albums.unshift(album);
        return album;
      } catch (error) {
        logger.error('Failed to create album:', error as any);
        throw error;
      }
    },

    /**
     * Delete an album
     */
    async deleteAlbum(albumId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('album:delete', albumId);
        this.albums = this.albums.filter((a) => a.id !== albumId);

        if (this.currentAlbum?.id === albumId) {
          this.currentAlbum = null;
          this.currentPhotos = [];
          this.members = [];
        }
      } catch (error) {
        logger.error('Failed to delete album:', error as any);
        throw error;
      }
    },

    /**
     * Update an album
     */
    async updateAlbum(
      albumId: string,
      updates: Partial<Album>,
    ): Promise<Album> {
      try {
        const updated = await ipcRenderer.invoke(
          'album:update',
          albumId,
          updates,
        );

        const index = this.albums.findIndex((a) => a.id === albumId);
        if (index !== -1) {
          this.albums[index] = { ...this.albums[index], ...updated };
        }

        if (this.currentAlbum?.id === albumId) {
          this.currentAlbum = { ...this.currentAlbum, ...updated };
        }

        return updated;
      } catch (error) {
        logger.error('Failed to update album:', error as any);
        throw error;
      }
    },

    /**
     * Load a specific album and set it as current
     */
    async selectAlbum(albumId: string): Promise<void> {
      this.loading = true;
      try {
        const album = await ipcRenderer.invoke('album:get-by-id', albumId);
        this.currentAlbum = album;

        if (album) {
          await Promise.all([
            this.loadPhotos(albumId),
            this.loadMembers(albumId),
          ]);
        }
      } catch (error) {
        logger.error('Failed to select album:', error as any);
        this.currentAlbum = null;
      } finally {
        this.loading = false;
      }
    },

    // ========== Photo Management ==========

    /**
     * Load photos for an album
     */
    async loadPhotos(
      albumId: string,
      options?: { limit?: number; offset?: number },
    ): Promise<void> {
      try {
        const photos = await ipcRenderer.invoke(
          'album:get-photos',
          albumId,
          options,
        );
        this.currentPhotos = Array.isArray(photos) ? photos : [];
      } catch (error) {
        logger.error('Failed to load photos:', error as any);
        this.currentPhotos = [];
      }
    },

    /**
     * Add a photo to the current album
     */
    async addPhoto(params: AddPhotoParams): Promise<AlbumPhoto> {
      try {
        this.uploadProgress = 0;

        const photo = await ipcRenderer.invoke('album:add-photo', params);

        this.currentPhotos.unshift(photo);
        this.uploadProgress = 100;

        // Update album photo count
        if (this.currentAlbum) {
          this.currentAlbum.photo_count =
            (this.currentAlbum.photo_count || 0) + 1;
        }

        const albumIndex = this.albums.findIndex(
          (a) => a.id === params.albumId,
        );
        if (albumIndex !== -1) {
          this.albums[albumIndex].photo_count =
            (this.albums[albumIndex].photo_count || 0) + 1;
        }

        return photo;
      } catch (error) {
        logger.error('Failed to add photo:', error as any);
        this.uploadProgress = 0;
        throw error;
      }
    },

    /**
     * Remove a photo from the current album
     */
    async removePhoto(photoId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('album:remove-photo', photoId);

        const photo = this.currentPhotos.find((p) => p.id === photoId);
        this.currentPhotos = this.currentPhotos.filter(
          (p) => p.id !== photoId,
        );

        // Update album photo count
        if (photo && this.currentAlbum) {
          this.currentAlbum.photo_count = Math.max(
            (this.currentAlbum.photo_count || 0) - 1,
            0,
          );
        }

        if (photo) {
          const albumIndex = this.albums.findIndex(
            (a) => a.id === photo.album_id,
          );
          if (albumIndex !== -1) {
            this.albums[albumIndex].photo_count = Math.max(
              (this.albums[albumIndex].photo_count || 0) - 1,
              0,
            );
          }
        }
      } catch (error) {
        logger.error('Failed to remove photo:', error as any);
        throw error;
      }
    },

    // ========== Member Management ==========

    /**
     * Load members for an album
     */
    async loadMembers(albumId: string): Promise<void> {
      try {
        const members = await ipcRenderer.invoke(
          'album:get-members',
          albumId,
        );
        this.members = Array.isArray(members) ? members : [];
      } catch (error) {
        logger.error('Failed to load members:', error as any);
        this.members = [];
      }
    },

    /**
     * Add a member to the current album
     */
    async addMember(
      albumId: string,
      memberDid: string,
      role: AlbumMemberRole = 'viewer',
    ): Promise<void> {
      try {
        await ipcRenderer.invoke(
          'album:add-member',
          albumId,
          memberDid,
          role,
        );

        // Reload members to get the updated list
        await this.loadMembers(albumId);

        // Update album member count
        if (this.currentAlbum?.id === albumId) {
          this.currentAlbum.member_count =
            (this.currentAlbum.member_count || 0) + 1;
        }
      } catch (error) {
        logger.error('Failed to add member:', error as any);
        throw error;
      }
    },

    /**
     * Remove a member from the current album
     */
    async removeMember(albumId: string, memberDid: string): Promise<void> {
      try {
        await ipcRenderer.invoke(
          'album:remove-member',
          albumId,
          memberDid,
        );

        this.members = this.members.filter(
          (m) => m.member_did !== memberDid,
        );

        // Update album member count
        if (this.currentAlbum?.id === albumId) {
          this.currentAlbum.member_count = Math.max(
            (this.currentAlbum.member_count || 0) - 1,
            0,
          );
        }
      } catch (error) {
        logger.error('Failed to remove member:', error as any);
        throw error;
      }
    },

    // ========== Album Sharing ==========

    /**
     * Share an album via P2P
     */
    async shareAlbum(
      albumId: string,
      targetDids?: string[],
    ): Promise<{ success: boolean; sharedTo: number }> {
      try {
        const result = await ipcRenderer.invoke(
          'album:share',
          albumId,
          targetDids,
        );
        return result;
      } catch (error) {
        logger.error('Failed to share album:', error as any);
        throw error;
      }
    },

    // ========== UI Helpers ==========

    /**
     * Clear current album selection
     */
    clearSelection(): void {
      this.currentAlbum = null;
      this.currentPhotos = [];
      this.members = [];
      this.uploadProgress = 0;
    },

    /**
     * Reset upload progress
     */
    resetUploadProgress(): void {
      this.uploadProgress = 0;
    },
  },
});
