/**
 * YjsIPCProvider - Custom Yjs provider for Electron IPC bridge
 *
 * Bridges a Y.Doc in the renderer process to the main process
 * via Electron IPC, enabling CRDT sync across peers.
 *
 * This provider handles:
 * - Sending local Y.Doc updates to the main process
 * - Receiving remote updates from the main process (via P2P peers)
 * - Awareness protocol for cursor/presence tracking
 * - Connection lifecycle management (connect, disconnect, destroy)
 *
 * @module utils/yjs-ipc-provider
 * @version 1.0.0
 */

import * as Y from "yjs";
import { Observable } from "lib0/observable";

// ==================== Type Definitions ====================

/**
 * Options for creating a YjsIPCProvider
 */
export interface YjsIPCProviderOptions {
  /** Enable awareness protocol for cursor/presence tracking */
  awareness?: boolean;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds (default: 3000) */
  reconnectDelay?: number;
}

/**
 * Data shape for IPC update messages
 */
export interface YjsIPCUpdateData {
  documentId: string;
  update: number[];
  origin?: string;
}

/**
 * Data shape for IPC awareness messages
 */
export interface YjsIPCAwarenessData {
  documentId: string;
  states?: Array<{ clientId: number; state: Record<string, any> }>;
}

/**
 * Connection result from main process
 */
export interface YjsIPCConnectResult {
  success: boolean;
  data?: {
    documentId: string;
    initialState?: number[];
  };
  error?: string;
}

/**
 * Status event payload
 */
export interface YjsIPCStatusEvent {
  status: "connected" | "disconnected" | "connecting";
}

// ==================== Provider Implementation ====================

/**
 * YjsIPCProvider bridges a Y.Doc in the renderer to the main process
 * via Electron IPC, enabling CRDT sync across peers.
 *
 * Usage:
 * ```typescript
 * const ydoc = new Y.Doc();
 * const provider = new YjsIPCProvider('doc-123', ydoc);
 * await provider.connect();
 *
 * // Later...
 * provider.destroy();
 * ```
 */
export class YjsIPCProvider extends Observable<string> {
  /** The Yjs document being synced */
  public doc: Y.Doc;

  /** Awareness protocol instance (placeholder for cursor/presence data) */
  public awareness: Map<number, Record<string, any>>;

  /** The document ID used to identify this document across peers */
  public documentId: string;

  /** Whether the provider has completed initial sync */
  public synced: boolean = false;

  /** Whether the provider is currently connected to the main process */
  public connected: boolean = false;

  /** Provider configuration options */
  public options: Required<YjsIPCProviderOptions>;

  /** Handler for local Y.Doc updates - sends to main process */
  private _updateHandler: (update: Uint8Array, origin: any) => void;

  /** Handler for remote updates received from main process */
  private _remoteUpdateHandler: (event: any, data: YjsIPCUpdateData) => void;

  /** Handler for awareness updates received from main process */
  private _awarenessHandler: (event: any, data: YjsIPCAwarenessData) => void;

  /** Flag indicating the provider is being destroyed */
  private _destroying: boolean = false;

  /** Timer for auto-reconnect */
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Create a new YjsIPCProvider
   *
   * @param documentId - Unique identifier for the document
   * @param doc - The Yjs document to sync
   * @param options - Optional configuration
   */
  constructor(documentId: string, doc: Y.Doc, options?: YjsIPCProviderOptions) {
    super();
    this.documentId = documentId;
    this.doc = doc;
    this.awareness = new Map();

    // Merge options with defaults
    this.options = {
      awareness: options?.awareness ?? true,
      autoReconnect: options?.autoReconnect ?? true,
      reconnectDelay: options?.reconnectDelay ?? 3000,
    };

    // ---- Local doc update handler ----
    // Captures updates made locally and forwards them to main process via IPC
    this._updateHandler = (update: Uint8Array, origin: any) => {
      // Skip updates that came from the remote (to avoid echo loops)
      if (origin === "remote" || this._destroying) return;

      // Serialize Uint8Array to a plain number array for IPC transport
      const serializedUpdate: number[] = Array.from(update);

      const result = window.electronAPI?.invoke("collab:yjs-update", {
        documentId: this.documentId,
        update: serializedUpdate,
      });
      // invoke 在测试 mock / 未挂载时可能返回 undefined，用 Promise.resolve 包裹
      Promise.resolve(result).catch((err: any) => {
        console.error("[YjsIPC] Failed to send update:", err);
      });
    };

    // ---- Remote update handler ----
    // Receives updates from the main process (originating from other peers)
    this._remoteUpdateHandler = (_event: any, data: YjsIPCUpdateData) => {
      if (this._destroying) return;
      if (data.documentId !== this.documentId) return;

      try {
        const update = new Uint8Array(data.update);
        Y.applyUpdate(this.doc, update, "remote");
      } catch (err) {
        console.error("[YjsIPC] Failed to apply remote update:", err);
      }
    };

    // ---- Awareness update handler ----
    // Receives awareness state changes (cursor positions, user presence)
    this._awarenessHandler = (_event: any, data: YjsIPCAwarenessData) => {
      if (this._destroying) return;
      if (data.documentId !== this.documentId) return;

      // Update local awareness map
      if (data.states) {
        for (const { clientId, state } of data.states) {
          this.awareness.set(clientId, state);
        }
      }

      this.emit("awareness-update", [data]);
    };
  }

  /**
   * Connect to the main process document session.
   *
   * This will:
   * 1. Register the local Y.Doc update listener
   * 2. Set up IPC listeners for remote updates and awareness
   * 3. Send a connect request to the main process
   * 4. Apply the initial document state if available
   *
   * @throws Error if the connection fails
   */
  async connect(): Promise<void> {
    if (this._destroying) return;

    this.emit("status", [{ status: "connecting" } as YjsIPCStatusEvent]);

    // 1. Register local doc update listener
    this.doc.on("update", this._updateHandler);

    // 2. Listen for remote updates from main process
    window.electronAPI?.on?.(
      "collab:yjs-remote-update",
      this._remoteUpdateHandler,
    );
    window.electronAPI?.on?.(
      "collab:yjs-awareness-update",
      this._awarenessHandler,
    );

    // 3. Connect to main process document session
    try {
      const result: YjsIPCConnectResult = await window.electronAPI?.invoke(
        "collab:yjs-connect",
        { documentId: this.documentId },
      );

      if (result?.success && result.data?.initialState) {
        // Apply initial state from main process
        const state = new Uint8Array(result.data.initialState);
        Y.applyUpdate(this.doc, state, "remote");
      }

      this.connected = true;
      this.synced = true;
      this.emit("synced", [this]);
      this.emit("status", [{ status: "connected" } as YjsIPCStatusEvent]);
    } catch (error) {
      console.error("[YjsIPC] Connect failed:", error);
      this.emit("status", [{ status: "disconnected" } as YjsIPCStatusEvent]);

      // Schedule auto-reconnect if enabled
      if (this.options.autoReconnect && !this._destroying) {
        this._scheduleReconnect();
      }

      throw error;
    }
  }

  /**
   * Disconnect from the main process document session.
   *
   * This will:
   * 1. Remove local Y.Doc update listener
   * 2. Remove IPC listeners for remote updates and awareness
   * 3. Send a disconnect request to the main process
   * 4. Clear connection state
   */
  async disconnect(): Promise<void> {
    this._destroying = true;

    // Cancel any pending reconnect
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Remove local doc listener
    this.doc.off("update", this._updateHandler);

    // Remove IPC listeners
    window.electronAPI?.removeListener?.(
      "collab:yjs-remote-update",
      this._remoteUpdateHandler,
    );
    window.electronAPI?.removeListener?.(
      "collab:yjs-awareness-update",
      this._awarenessHandler,
    );

    // Notify main process of disconnect
    try {
      await window.electronAPI?.invoke("collab:yjs-disconnect", {
        documentId: this.documentId,
      });
    } catch (e) {
      // Ignore disconnect errors - the main process may already be gone
    }

    // Update state
    this.connected = false;
    this.synced = false;
    this.awareness.clear();
    this.emit("status", [{ status: "disconnected" } as YjsIPCStatusEvent]);
  }

  /**
   * Update the local user's awareness state (cursor, selection, etc.)
   *
   * @param state - The awareness state to broadcast
   */
  async setAwarenessState(state: Record<string, any>): Promise<void> {
    if (!this.connected || this._destroying) return;

    // Store locally
    this.awareness.set(this.doc.clientID, state);

    // Send to main process for broadcasting
    try {
      await window.electronAPI?.invoke("collab:yjs-update", {
        documentId: this.documentId,
        awarenessState: state,
      });
    } catch (err) {
      console.error("[YjsIPC] Failed to update awareness state:", err);
    }
  }

  /**
   * Get all current awareness states (all connected users)
   *
   * @returns Map of clientId to awareness state
   */
  getAwarenessStates(): Map<number, Record<string, any>> {
    return new Map(this.awareness);
  }

  /**
   * Destroy the provider and clean up all resources.
   * After calling destroy, the provider cannot be reconnected.
   */
  destroy(): void {
    this.disconnect();
    super.destroy();
  }

  /**
   * Schedule an auto-reconnect attempt
   */
  private _scheduleReconnect(): void {
    if (this._reconnectTimer || this._destroying) return;

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroying) return;

      this._destroying = false; // Reset flag for reconnect attempt
      try {
        await this.connect();
      } catch (e) {
        // connect() will schedule another reconnect if needed
      }
    }, this.options.reconnectDelay);
  }
}

export default YjsIPCProvider;
