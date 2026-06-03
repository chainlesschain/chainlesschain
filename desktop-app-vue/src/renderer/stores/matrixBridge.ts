import { defineStore } from 'pinia';

export interface MatrixRoom {
  id: string;
  room_id: string;
  name: string;
  topic: string;
  is_encrypted: number;
  member_count: number;
  last_event_at: number | null;
  joined_at: number;
  status: string;
}

export interface MatrixMessage {
  id: string;
  event_id: string;
  room_id: string;
  sender: string;
  event_type: string;
  content: any;
  origin_server_ts: number;
  is_encrypted: number;
  decrypted_content: any;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useMatrixBridgeStore = defineStore('matrixBridge', {
  state: () => ({
    rooms: [] as MatrixRoom[],
    messages: [] as MatrixMessage[],
    loginState: 'logged_out' as string,
    userId: null as string | null,
    homeserver: 'https://matrix.org',
    loading: false,
    error: null as string | null,
  }),

  getters: {
    isLoggedIn: (state) => state.loginState === 'logged_in',
    encryptedRooms: (state) => state.rooms.filter(r => r.is_encrypted === 1),
    roomCount: (state) => state.rooms.length,
  },

  actions: {
    async login(homeserver: string, userId: string, password: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('matrix:login', { homeserver, userId, password });
        if (result.success) {
          this.loginState = 'logged_in';
          this.userId = result.userId;
          this.homeserver = result.homeserver;
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchRooms() {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('matrix:list-rooms');
        if (result.success) this.rooms = result.rooms || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async sendMessage(roomId: string, body: string, msgtype?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('matrix:send-message', { roomId, body, msgtype });
        if (result.success) await this.fetchMessages(roomId);
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchMessages(roomId: string, limit?: number, since?: number) {
      try {
        const result = await invoke('matrix:get-messages', { roomId, limit, since });
        if (result.success) this.messages = result.messages || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async joinRoom(roomIdOrAlias: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('matrix:join-room', { roomIdOrAlias });
        if (result.success) await this.fetchRooms();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },
  },
});
