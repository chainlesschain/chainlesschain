/**
 * Social Collab Store - Pinia State Management
 *
 * Manages the state for social collaborative editing features,
 * including documents, invites, versions, and cursor awareness.
 *
 * @module stores/socialCollab
 * @version 0.41.0
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

/**
 * Content type for collaborative documents
 */
export type ContentType = 'markdown' | 'richtext' | 'table' | 'whiteboard';

/**
 * Document visibility level
 */
export type DocVisibility = 'private' | 'friends' | 'invited';

/**
 * Document status
 */
export type DocStatus = 'active' | 'archived';

/**
 * Invite permission level
 */
export type InvitePermission = 'editor' | 'commenter' | 'viewer';

/**
 * Invite status
 */
export type InviteStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Collaborative document
 */
export interface CollabDocument {
  id: string;
  title: string;
  contentType: ContentType;
  ownerDid: string;
  visibility: DocVisibility;
  status: DocStatus;
  createdAt: number;
  updatedAt: number;
  invitePermission?: InvitePermission;
  inviterDid?: string;
}

/**
 * Collaboration invite
 */
export interface CollabInvite {
  id: string;
  docId: string;
  docTitle?: string;
  contentType?: ContentType;
  inviterDid: string;
  inviteeDid: string;
  ownerDid?: string;
  permission: InvitePermission;
  status: InviteStatus;
  createdAt: number;
}

/**
 * Document version snapshot
 */
export interface DocVersion {
  id: string;
  docId: string;
  versionNumber: number;
  description: string;
  creatorDid: string;
  createdAt: number;
  hasSnapshot: boolean;
}

/**
 * Remote cursor position
 */
export interface RemoteCursor {
  did: string;
  name: string;
  color: string;
  position: {
    line: number;
    column: number;
    offset?: number;
  };
  selection: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  } | null;
  lastActivity: number;
  isLocal?: boolean;
}

/**
 * Social Collab store state
 */
export interface SocialCollabState {
  documents: CollabDocument[];
  sharedDocuments: CollabDocument[];
  currentDoc: CollabDocument | null;
  collaborators: string[];
  remoteCursors: RemoteCursor[];
  versions: DocVersion[];
  pendingInvites: CollabInvite[];
  loading: boolean;
  error: string | null;
}

// ==================== IPC Helper ====================

const ipcRenderer = (window as any).electron?.ipcRenderer || (window as any).electronAPI;

async function invokeIPC(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer || !ipcRenderer.invoke) {
    console.warn(`[SocialCollabStore] IPC not available for channel: ${channel}`);
    return { success: false, error: 'IPC not available' };
  }
  return await ipcRenderer.invoke(channel, ...args);
}

// ==================== Store ====================

export const useSocialCollabStore = defineStore('socialCollab', {
  state: (): SocialCollabState => ({
    /** Documents owned by current user */
    documents: [],

    /** Documents shared with current user */
    sharedDocuments: [],

    /** Currently open document */
    currentDoc: null,

    /** DID list of collaborators in the current document */
    collaborators: [],

    /** Remote cursor positions */
    remoteCursors: [],

    /** Version history for the current document */
    versions: [],

    /** Pending collaboration invites */
    pendingInvites: [],

    /** Global loading state */
    loading: false,

    /** Last error message */
    error: null,
  }),

  getters: {
    /**
     * Total number of documents (owned + shared)
     */
    totalDocumentCount(): number {
      return this.documents.length + this.sharedDocuments.length;
    },

    /**
     * Whether a document is currently open
     */
    hasOpenDocument(): boolean {
      return this.currentDoc !== null;
    },

    /**
     * Number of remote collaborators (excluding local user)
     */
    remoteCollaboratorCount(): number {
      return this.remoteCursors.length;
    },

    /**
     * Whether there are pending invites
     */
    hasPendingInvites(): boolean {
      return this.pendingInvites.length > 0;
    },

    /**
     * Latest version number for the current document
     */
    latestVersionNumber(): number {
      if (this.versions.length === 0) return 0;
      return Math.max(...this.versions.map((v) => v.versionNumber));
    },
  },

  actions: {
    // ========================================
    // Document Actions
    // ========================================

    /**
     * Load documents owned by the current user
     */
    async loadMyDocs(options?: { status?: DocStatus; limit?: number; offset?: number }): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await invokeIPC('social-collab:get-my-docs', options || {});

        if (result.success) {
          this.documents = result.documents || [];
        } else {
          this.error = result.error || 'Failed to load documents';
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] loadMyDocs failed:', err);
        this.error = err.message;
        this.documents = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Load documents shared with the current user
     */
    async loadSharedDocs(options?: { limit?: number; offset?: number }): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await invokeIPC('social-collab:get-shared-docs', options || {});

        if (result.success) {
          this.sharedDocuments = result.documents || [];
        } else {
          this.error = result.error || 'Failed to load shared documents';
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] loadSharedDocs failed:', err);
        this.error = err.message;
        this.sharedDocuments = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Create a new collaborative document
     */
    async createDocument(options: {
      title: string;
      contentType?: ContentType;
      visibility?: DocVisibility;
    }): Promise<CollabDocument | null> {
      this.loading = true;
      this.error = null;

      try {
        const result = await invokeIPC('social-collab:create-doc', options);

        if (result.success && result.document) {
          this.documents.unshift(result.document);
          return result.document;
        }

        this.error = result.error || 'Failed to create document';
        return null;
      } catch (err: any) {
        console.error('[SocialCollabStore] createDocument failed:', err);
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Open a document for collaborative editing
     */
    async openDocument(docId: string): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await invokeIPC('social-collab:open-doc', docId);

        if (result.success) {
          this.currentDoc = result.document || null;
          this.collaborators = result.collaborators || [];

          // Load version history for this document
          if (this.currentDoc) {
            await this.loadVersions(this.currentDoc.id);
          }
        } else {
          this.error = result.error || 'Failed to open document';
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] openDocument failed:', err);
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Close the currently open document
     */
    async closeDocument(): Promise<void> {
      if (!this.currentDoc) return;

      try {
        await invokeIPC('social-collab:close-doc', this.currentDoc.id);

        this.currentDoc = null;
        this.collaborators = [];
        this.remoteCursors = [];
        this.versions = [];
      } catch (err: any) {
        console.error('[SocialCollabStore] closeDocument failed:', err);
        this.error = err.message;
      }
    },

    /**
     * Archive a document
     */
    async archiveDocument(docId: string): Promise<void> {
      try {
        const result = await invokeIPC('social-collab:archive-doc', docId);

        if (result.success) {
          // Remove from documents list
          this.documents = this.documents.filter((d) => d.id !== docId);

          // Clear current doc if it's the archived one
          if (this.currentDoc?.id === docId) {
            this.currentDoc = null;
            this.collaborators = [];
            this.remoteCursors = [];
            this.versions = [];
          }
        } else {
          this.error = result.error || 'Failed to archive document';
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] archiveDocument failed:', err);
        this.error = err.message;
        throw err;
      }
    },

    // ========================================
    // Invite Actions
    // ========================================

    /**
     * Invite a user to collaborate on a document
     */
    async inviteUser(options: {
      docId: string;
      inviteeDid: string;
      permission?: InvitePermission;
    }): Promise<void> {
      try {
        const result = await invokeIPC('social-collab:invite', options);

        if (!result.success) {
          this.error = result.error || 'Failed to send invite';
          throw new Error(this.error as string);
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] inviteUser failed:', err);
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Load pending invites for the current user
     */
    async loadPendingInvites(): Promise<void> {
      try {
        const result = await invokeIPC('social-collab:get-pending-invites');

        if (result.success) {
          this.pendingInvites = result.invites || [];
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] loadPendingInvites failed:', err);
        this.pendingInvites = [];
      }
    },

    /**
     * Accept a collaboration invite
     */
    async acceptInvite(inviteId: string): Promise<void> {
      try {
        const result = await invokeIPC('social-collab:accept-invite', inviteId);

        if (result.success) {
          this.pendingInvites = this.pendingInvites.filter((i) => i.id !== inviteId);
          // Reload shared docs to include the newly accepted document
          await this.loadSharedDocs();
        } else {
          this.error = result.error || 'Failed to accept invite';
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] acceptInvite failed:', err);
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Reject a collaboration invite
     */
    async rejectInvite(inviteId: string): Promise<void> {
      try {
        const result = await invokeIPC('social-collab:reject-invite', inviteId);

        if (result.success) {
          this.pendingInvites = this.pendingInvites.filter((i) => i.id !== inviteId);
        } else {
          this.error = result.error || 'Failed to reject invite';
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] rejectInvite failed:', err);
        this.error = err.message;
        throw err;
      }
    },

    // ========================================
    // Version Actions
    // ========================================

    /**
     * Create a new version snapshot
     */
    async createVersion(options: {
      docId: string;
      description?: string;
    }): Promise<DocVersion | null> {
      try {
        const result = await invokeIPC('social-collab:create-version', options);

        if (result.success && result.version) {
          this.versions.unshift(result.version);
          return result.version;
        }

        this.error = result.error || 'Failed to create version';
        return null;
      } catch (err: any) {
        console.error('[SocialCollabStore] createVersion failed:', err);
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Load version history for a document
     */
    async loadVersions(docId: string, options?: { limit?: number; offset?: number }): Promise<void> {
      try {
        const result = await invokeIPC('social-collab:get-versions', {
          docId,
          ...(options || {}),
        });

        if (result.success) {
          this.versions = result.versions || [];
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] loadVersions failed:', err);
        this.versions = [];
      }
    },

    /**
     * Rollback to a specific version
     */
    async rollback(docId: string, versionNumber: number): Promise<void> {
      this.loading = true;

      try {
        const result = await invokeIPC('social-collab:rollback', {
          docId,
          versionNumber,
        });

        if (result.success) {
          // Reload versions to reflect the new backup snapshot
          await this.loadVersions(docId);
        } else {
          this.error = result.error || 'Rollback failed';
          throw new Error(this.error as string);
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] rollback failed:', err);
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    // ========================================
    // Awareness / Cursor Actions
    // ========================================

    /**
     * Refresh remote cursors for the current document
     */
    async refreshCursors(): Promise<void> {
      if (!this.currentDoc) return;

      try {
        const result = await invokeIPC('social-collab:get-cursors', this.currentDoc.id);

        if (result.success) {
          this.remoteCursors = result.cursors || [];
        }
      } catch (err: any) {
        console.error('[SocialCollabStore] refreshCursors failed:', err);
      }
    },

    /**
     * Update the local cursor position
     */
    async updateLocalCursor(
      position: { line: number; column: number; offset?: number },
      selection?: { start: any; end: any } | null,
    ): Promise<void> {
      if (!this.currentDoc) return;

      try {
        await invokeIPC('social-collab:update-cursor', {
          docId: this.currentDoc.id,
          position,
          selection: selection || null,
        });
      } catch (err: any) {
        // Cursor updates are fire-and-forget; don't throw
        console.warn('[SocialCollabStore] updateLocalCursor failed:', err);
      }
    },

    /**
     * Set remote cursors directly (from event listeners)
     */
    setRemoteCursors(cursors: RemoteCursor[]): void {
      this.remoteCursors = cursors;
    },

    // ========================================
    // Utility Actions
    // ========================================

    /**
     * Clear the error state
     */
    clearError(): void {
      this.error = null;
    },

    /**
     * Reset all state
     */
    reset(): void {
      this.$reset();
    },
  },
});
