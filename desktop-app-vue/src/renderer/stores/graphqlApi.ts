import { defineStore } from "pinia";

const electronAPI =
  (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error("IPC not available"));
}

export interface APIKey {
  id: string;
  name: string;
  permissions: string[];
  rateLimit: number;
  requestsToday: number;
  status: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface QueryLogEntry {
  id: string;
  apiKeyId?: string;
  operationType: string;
  operationName?: string;
  durationMs: number;
  status: string;
  error?: string;
  createdAt: string;
}

export interface GraphQLStats {
  totalQueries: number;
  queriesByType: Record<string, number>;
  avgDurationMs: number;
  totalApiKeys: number;
  activeApiKeys: number;
  totalSubscriptions: number;
}

export const useGraphQLApiStore = defineStore("graphqlApi", {
  state: () => ({
    schema: "" as string,
    apiKeys: [] as APIKey[],
    queryLog: [] as QueryLogEntry[],
    queryResult: null as unknown,
    stats: null as GraphQLStats | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeKeys: (state) => state.apiKeys.filter((k) => k.status === "active"),
    recentQueries: (state) => state.queryLog.slice(0, 20),
  },

  actions: {
    async executeQuery(query: string, variables: Record<string, unknown> = {}) {
      this.loading = true;
      try {
        const result = await invoke("graphql:execute-query", {
          query,
          variables,
          context: {},
        });
        if (result.success) {
          this.queryResult = result.data;
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async loadSchema() {
      try {
        const result = await invoke("graphql:get-schema", {});
        if (result.success) this.schema = result.data;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },

    async createAPIKey(name: string, permissions: string[] = ["query"]) {
      try {
        const result = await invoke("graphql:create-api-key", {
          name,
          options: { permissions },
        });
        if (result.success) {
          await this.loadAPIKeys();
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },

    async revokeAPIKey(keyId: string) {
      try {
        const result = await invoke("graphql:revoke-api-key", { keyId });
        if (result.success) await this.loadAPIKeys();
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },

    async loadAPIKeys() {
      try {
        const result = await invoke("graphql:list-api-keys", {});
        if (result.success) this.apiKeys = result.data;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },

    async loadQueryLog(filter: Record<string, unknown> = {}) {
      try {
        const result = await invoke("graphql:get-query-log", { filter });
        if (result.success) this.queryLog = result.data;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },

    async loadStats() {
      try {
        const result = await invoke("graphql:get-stats", {});
        if (result.success) this.stats = result.data;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },

    clearError() {
      this.error = null;
    },
  },
});
