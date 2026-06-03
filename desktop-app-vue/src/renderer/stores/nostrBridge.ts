import { defineStore } from "pinia";

export interface NostrRelay {
  id: string;
  url: string;
  status: string;
  last_connected: number | null;
  event_count: number;
  read_enabled: boolean;
  write_enabled: boolean;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  sig: string;
  created_at: number;
  relay_url: string;
}

export interface NostrKeyPair {
  npub: string;
  nsec: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

const electronAPI =
  (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error("IPC not available"));
}

export const useNostrBridgeStore = defineStore("nostrBridge", {
  state: () => ({
    relays: [] as NostrRelay[],
    events: [] as NostrEvent[],
    keyPair: null as NostrKeyPair | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    connectedRelays: (state) =>
      state.relays.filter((r) => r.status === "connected"),
    relayCount: (state) => state.relays.length,
  },

  actions: {
    async fetchRelays() {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("nostr:list-relays");
        if (result.success) this.relays = result.relays || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async addRelay(url: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("nostr:add-relay", { url });
        if (result.success) await this.fetchRelays();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async publishEvent(kind: number, content: string, tags: string[][] = []) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("nostr:publish-event", {
          kind,
          content,
          tags,
        });
        if (!result.success) this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchEvents(kinds?: number[], limit = 50, since?: number) {
      this.loading = true;
      try {
        const result = await invoke("nostr:get-events", {
          kinds,
          limit,
          since,
        });
        if (result.success) this.events = result.events || [];
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async generateKeyPair() {
      try {
        const result = await invoke("nostr:generate-keypair");
        if (result.success) this.keyPair = result.keyPair;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async mapDID(did: string, npub: string, nsec: string) {
      try {
        return await invoke("nostr:map-did", { did, npub, nsec });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    // ── NIP-04 / NIP-09 / NIP-25 extensions ──────────────────────────────

    async publishDirectMessage(params: {
      senderPrivkey: string;
      senderPubkey: string;
      recipientPubkey: string;
      plaintext: string;
    }) {
      try {
        return await invoke("nostr:publish-dm", params);
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async decryptDirectMessage(params: {
      event: NostrEvent;
      recipientPrivkey: string;
    }) {
      try {
        return await invoke("nostr:decrypt-dm", params);
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async publishDeletion(params: {
      eventIds: string[];
      reason?: string;
      pubkey?: string;
    }) {
      try {
        return await invoke("nostr:publish-deletion", params);
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async publishReaction(params: {
      targetEventId: string;
      targetPubkey: string;
      content?: string;
      pubkey?: string;
    }) {
      try {
        return await invoke("nostr:publish-reaction", params);
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
