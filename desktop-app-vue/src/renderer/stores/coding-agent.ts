import { defineStore } from "pinia";
import { createLogger } from "@/utils/logger";
import type {
  CodingAgentEvent,
  CodingAgentPermissionPolicy,
  CodingAgentSessionState,
  CodingAgentStatus,
  CodingAgentToolDescriptor,
  CodingAgentWorktreeRecord,
} from "@/types/electron.d";

const codingAgentLogger = createLogger("coding-agent-store");

interface CodingAgentSessionSummary {
  id: string;
  type?: string;
  status?: string;
  provider?: string | null;
  model?: string | null;
  messageCount?: number;
  createdAt?: string;
  lastActivity?: string;
  record?: any;
}

interface CodingAgentWorktreeDiffResult {
  sessionId: string;
  branch?: string;
  filePath?: string | null;
  files: any[];
  summary?: any;
  diff?: string | null;
  record?: CodingAgentWorktreeRecord | null;
}

interface CodingAgentWorktreeMergeResult {
  success: boolean;
  previewOnly?: boolean;
  sessionId: string;
  branch?: string;
  baseBranch?: string | null;
  strategy?: string;
  message?: string | null;
  summary?: any;
  conflicts: any[];
  suggestions: string[];
  previewEntrypoints: any[];
  record?: CodingAgentWorktreeRecord | null;
}

interface CodingAgentWorktreeAutomationResult {
  success: boolean;
  sessionId: string;
  branch?: string;
  baseBranch?: string | null;
  filePath?: string | null;
  candidateId?: string | null;
  message?: string | null;
  files: any[];
  summary?: any;
  diff?: string | null;
  record?: CodingAgentWorktreeRecord | null;
}

interface CodingAgentState {
  currentSessionId: string | null;
  currentSession: CodingAgentSessionState | null;
  sessions: CodingAgentSessionSummary[];
  events: CodingAgentEvent[];
  worktrees: CodingAgentWorktreeRecord[];
  latestWorktreeDiff: CodingAgentWorktreeDiffResult | null;
  latestWorktreeMergeResult: CodingAgentWorktreeMergeResult | null;
  status: CodingAgentStatus;
  loading: boolean;
  worktreeLoading: boolean;
  error: string | null;
  unsubscribe: (() => void) | null;
}

export const useCodingAgentStore = defineStore("coding-agent", {
  state: (): CodingAgentState => ({
    currentSessionId: null,
    currentSession: null,
    sessions: [],
    events: [],
    worktrees: [],
    latestWorktreeDiff: null,
    latestWorktreeMergeResult: null,
    status: {
      connected: false,
      port: null,
      tools: [],
      toolSummary: null,
      permissionPolicy: null,
    },
    loading: false,
    worktreeLoading: false,
    error: null,
    unsubscribe: null,
  }),

  getters: {
    sessionEvents(state): CodingAgentEvent[] {
      if (!state.currentSessionId) {
        return [];
      }
      return state.events.filter(
        (event) => event.sessionId === state.currentSessionId,
      );
    },

    latestAssistantMessage(): string | null {
      const response = [...this.sessionEvents]
        .reverse()
        .find((event) => event.type === "response-complete");
      return response?.payload?.content || null;
    },

    pendingPlanSummary(): string | null {
      return this.currentSession?.lastPlanSummary || null;
    },

    latestApprovalRequest(): CodingAgentEvent | null {
      return (
        [...this.sessionEvents]
          .reverse()
          .find((event) => event.type === "approval-requested") || null
      );
    },

    latestBlockedToolEvent(): CodingAgentEvent | null {
      return (
        [...this.sessionEvents]
          .reverse()
          .find((event) => event.type === "tool-blocked") || null
      );
    },

    availableTools(state): CodingAgentToolDescriptor[] {
      return state.status.tools || [];
    },

    permissionPolicy(state): CodingAgentPermissionPolicy | null {
      return state.status.permissionPolicy || null;
    },

    requiresHighRiskConfirmation(): boolean {
      return (
        this.currentSession?.requiresHighRiskConfirmation === true &&
        this.currentSession?.highRiskConfirmationGranted !== true
      );
    },

    currentSessionWorktreeDiff(): CodingAgentWorktreeDiffResult | null {
      if (!this.currentSessionId) {
        return null;
      }
      if (this.latestWorktreeDiff?.sessionId !== this.currentSessionId) {
        return null;
      }
      return this.latestWorktreeDiff;
    },

    currentSessionWorktreeMergeResult(): CodingAgentWorktreeMergeResult | null {
      if (!this.currentSessionId) {
        return null;
      }
      if (this.latestWorktreeMergeResult?.sessionId !== this.currentSessionId) {
        return null;
      }
      return this.latestWorktreeMergeResult;
    },
  },

  actions: {
    _resetWorktreeState(): void {
      this.worktrees = [];
      this.latestWorktreeDiff = null;
      this.latestWorktreeMergeResult = null;
    },

    async refreshStatus(): Promise<void> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getStatus();
        if (result?.success) {
          this.status = {
            connected: result.server?.connected ?? this.status.connected,
            host: result.server?.host ?? this.status.host,
            port: result.server?.port ?? this.status.port ?? null,
            tools: result.tools || [],
            toolSummary: result.toolSummary || null,
            permissionPolicy: result.permissionPolicy || null,
          };
        }
      } catch (error: any) {
        this.error = error.message;
      }
    },

    async loadSessions(): Promise<void> {
      this.loading = true;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.listSessions();
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to list coding agent sessions",
          );
        }
        this.sessions = result.sessions || [];
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("loadSessions failed:", error);
      } finally {
        this.loading = false;
      }
    },

    async createSession(
      options: Record<string, any> = {},
    ): Promise<string | null> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.createSession(options);
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to create coding agent session",
          );
        }

        const sessionId = result.sessionId as string;
        this.currentSessionId = sessionId;
        this.currentSession = result.session || {
          sessionId,
          status: "ready",
          history: [],
        };
        this._resetWorktreeState();
        await this.loadSessions();
        return sessionId;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("createSession failed:", error);
        return null;
      } finally {
        this.loading = false;
      }
    },

    async resumeSession(sessionId: string): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.resumeSession(sessionId);
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to resume coding agent session",
          );
        }
        this.currentSessionId = sessionId;
        this._resetWorktreeState();
        await this.fetchSessionState(sessionId);
        await this.fetchSessionEvents(sessionId);
        return true;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("resumeSession failed:", error);
        return false;
      } finally {
        this.loading = false;
      }
    },

    async sendMessage(
      content: string,
    ): Promise<{
      success: boolean;
      requestId?: string;
      sessionId?: string;
      error?: string;
    }> {
      if (!this.currentSessionId) {
        this.error = "No active coding agent session";
        return {
          success: false,
          error: this.error,
        };
      }

      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.sendMessage({
          sessionId: this.currentSessionId,
          content,
        });
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to send coding agent message",
          );
        }
        return {
          success: true,
          requestId: result.requestId,
          sessionId: result.sessionId || this.currentSessionId,
        };
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("sendMessage failed:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },

    async enterPlanMode(): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.enterPlanMode(
        this.currentSessionId,
      );
    },

    async showPlan(): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.showPlan(
        this.currentSessionId,
      );
    },

    async approvePlan(): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.approvePlan(
        this.currentSessionId,
      );
    },

    async confirmHighRiskExecution(): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.confirmHighRiskExecution(
        this.currentSessionId,
      );
      await this.fetchSessionState(this.currentSessionId);
    },

    async rejectPlan(): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.rejectPlan(
        this.currentSessionId,
      );
    },

    async closeCurrentSession(): Promise<void> {
      if (!this.currentSessionId) return;
      const sessionId = this.currentSessionId;
      await (window as any).electronAPI.codingAgent.closeSession(sessionId);
      this.currentSessionId = null;
      this.currentSession = null;
      this._resetWorktreeState();
      this.events = this.events.filter(
        (event) => event.sessionId !== sessionId,
      );
      await this.loadSessions();
    },

    async listWorktrees(): Promise<CodingAgentWorktreeRecord[]> {
      this.worktreeLoading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.listWorktrees();
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to list coding agent worktrees",
          );
        }
        this.worktrees = result.worktrees || [];
        return this.worktrees;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("listWorktrees failed:", error);
        throw error;
      } finally {
        this.worktreeLoading = false;
      }
    },

    async loadCurrentWorktreeDiff(
      options: {
        branch?: string;
        baseBranch?: string | null;
        filePath?: string | null;
      } = {},
    ): Promise<CodingAgentWorktreeDiffResult> {
      if (!this.currentSessionId) {
        throw new Error("No active coding agent session");
      }

      this.worktreeLoading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getWorktreeDiff({
          sessionId: this.currentSessionId,
          ...options,
        });
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to load coding agent worktree diff",
          );
        }

        this.latestWorktreeDiff = {
          sessionId: result.sessionId || this.currentSessionId,
          branch: result.branch,
          filePath: result.filePath || null,
          files: result.files || [],
          summary: result.summary || null,
          diff: result.diff || null,
          record: result.record || null,
        };
        await this.fetchSessionState(this.currentSessionId);
        return this.latestWorktreeDiff;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("loadCurrentWorktreeDiff failed:", error);
        throw error;
      } finally {
        this.worktreeLoading = false;
      }
    },

    async loadWorktreePreview(
      options: {
        branch?: string;
        baseBranch?: string | null;
        filePath?: string | null;
      } = {},
    ): Promise<CodingAgentWorktreeDiffResult> {
      if (!this.currentSessionId) {
        throw new Error("No active coding agent session");
      }

      this.worktreeLoading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getWorktreeDiff({
          sessionId: this.currentSessionId,
          ...options,
        });
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to load coding agent worktree preview",
          );
        }

        return {
          sessionId: result.sessionId || this.currentSessionId,
          branch: result.branch,
          filePath: result.filePath || null,
          files: result.files || [],
          summary: result.summary || null,
          diff: result.diff || null,
          record: result.record || null,
        };
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("loadWorktreePreview failed:", error);
        throw error;
      } finally {
        this.worktreeLoading = false;
      }
    },

    async mergeCurrentWorktree(
      options: {
        branch?: string;
        strategy?: string;
        commitMessage?: string | null;
      } = {},
    ): Promise<CodingAgentWorktreeMergeResult> {
      if (!this.currentSessionId) {
        throw new Error("No active coding agent session");
      }

      this.worktreeLoading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.mergeWorktree({
          sessionId: this.currentSessionId,
          ...options,
        });
        if (!result?.success && !Array.isArray(result?.conflicts)) {
          throw new Error(
            result?.error || "Failed to merge coding agent worktree",
          );
        }

        this.latestWorktreeMergeResult = {
          success: result.success !== false,
          previewOnly: result.previewOnly === true,
          sessionId: result.sessionId || this.currentSessionId,
          branch: result.branch,
          baseBranch: result.baseBranch || null,
          strategy: result.strategy,
          message: result.message || null,
          summary: result.summary || null,
          conflicts: result.conflicts || [],
          suggestions: result.suggestions || [],
          previewEntrypoints: result.previewEntrypoints || [],
          record: result.record || null,
        };
        await this.fetchSessionState(this.currentSessionId);
        return this.latestWorktreeMergeResult;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("mergeCurrentWorktree failed:", error);
        throw error;
      } finally {
        this.worktreeLoading = false;
      }
    },

    async previewCurrentWorktreeMerge(
      options: {
        branch?: string;
        baseBranch?: string | null;
        strategy?: string;
      } = {},
    ): Promise<CodingAgentWorktreeMergeResult> {
      if (!this.currentSessionId) {
        throw new Error("No active coding agent session");
      }

      this.worktreeLoading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.previewWorktreeMerge({
          sessionId: this.currentSessionId,
          ...options,
        });
        if (!result?.success && !Array.isArray(result?.conflicts)) {
          throw new Error(
            result?.error || "Failed to preview coding agent worktree merge",
          );
        }

        this.latestWorktreeMergeResult = {
          success: result.success !== false,
          previewOnly: result.previewOnly === true,
          sessionId: result.sessionId || this.currentSessionId,
          branch: result.branch,
          baseBranch: result.baseBranch || null,
          strategy: result.strategy,
          message: result.message || null,
          summary: result.summary || null,
          conflicts: result.conflicts || [],
          suggestions: result.suggestions || [],
          previewEntrypoints: result.previewEntrypoints || [],
          record: result.record || null,
        };
        await this.fetchSessionState(this.currentSessionId);
        return this.latestWorktreeMergeResult;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("previewCurrentWorktreeMerge failed:", error);
        throw error;
      } finally {
        this.worktreeLoading = false;
      }
    },

    async applyWorktreeAutomationCandidate(options: {
      branch?: string;
      baseBranch?: string | null;
      filePath: string;
      candidateId: string;
      conflictType?: string | null;
    }): Promise<CodingAgentWorktreeAutomationResult> {
      if (!this.currentSessionId) {
        throw new Error("No active coding agent session");
      }

      this.worktreeLoading = true;
      this.error = null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.applyWorktreeAutomation({
          sessionId: this.currentSessionId,
          ...options,
        });
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to apply worktree automation",
          );
        }

        this.latestWorktreeDiff = {
          sessionId: result.sessionId || this.currentSessionId,
          branch: result.branch,
          filePath: result.filePath || null,
          files: result.files || [],
          summary: result.summary || null,
          diff: result.diff || null,
          record: result.record || null,
        };
        this.latestWorktreeMergeResult = null;
        await this.fetchSessionState(this.currentSessionId);

        return {
          success: true,
          sessionId: result.sessionId || this.currentSessionId,
          branch: result.branch,
          baseBranch: result.baseBranch || null,
          filePath: result.filePath || null,
          candidateId: result.candidateId || null,
          message: result.message || null,
          files: result.files || [],
          summary: result.summary || null,
          diff: result.diff || null,
          record: result.record || null,
        };
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error(
          "applyWorktreeAutomationCandidate failed:",
          error,
        );
        throw error;
      } finally {
        this.worktreeLoading = false;
      }
    },

    async fetchSessionState(sessionId?: string): Promise<void> {
      const targetId = sessionId || this.currentSessionId;
      if (!targetId) return;

      const result = await (
        window as any
      ).electronAPI.codingAgent.getSessionState(targetId);
      if (result?.success && result.session) {
        this.currentSession = result.session;
        this.currentSessionId = result.session.sessionId;
      }
    },

    async fetchSessionEvents(sessionId?: string): Promise<void> {
      const targetId = sessionId || this.currentSessionId;
      if (!targetId) return;

      const result = await (
        window as any
      ).electronAPI.codingAgent.getSessionEvents(targetId);
      if (result?.success && Array.isArray(result.events)) {
        this.events = [
          ...this.events.filter((event) => event.sessionId !== targetId),
          ...result.events,
        ];
      }
    },

    initEventListeners(): void {
      if (this.unsubscribe) {
        return;
      }

      const api = (window as any).electronAPI?.codingAgent;
      if (!api?.onEvent) {
        codingAgentLogger.warn("codingAgent.onEvent not available");
        return;
      }

      this.unsubscribe = api.onEvent((event: CodingAgentEvent) => {
        this.events.push(event);
        if (this.events.length > 500) {
          this.events.splice(0, this.events.length - 500);
        }

        if (!event.sessionId) {
          if (event.type === "server-ready") {
            this.status.connected = true;
            this.status.host = event.payload?.host;
            this.status.port = event.payload?.port ?? null;
          } else if (event.type === "server-stopped") {
            this.status.connected = false;
          }
          return;
        }

        if (event.sessionId === this.currentSessionId) {
          this.fetchSessionState(event.sessionId).catch((error: any) => {
            codingAgentLogger.warn(
              "fetchSessionState after event failed:",
              error?.message || error,
            );
          });
        }

        if (
          event.type === "server-ready" ||
          event.type === "plan-generated" ||
          event.type === "approval-requested" ||
          event.type === "tool-blocked"
        ) {
          this.refreshStatus().catch((error: any) => {
            codingAgentLogger.warn(
              "refreshStatus after event failed:",
              error?.message || error,
            );
          });
        }

        if (
          event.type === "session-created" ||
          event.type === "session-resumed"
        ) {
          this.loadSessions().catch((error: any) => {
            codingAgentLogger.warn(
              "loadSessions after event failed:",
              error?.message || error,
            );
          });
        }
      });
    },

    disposeEventListeners(): void {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    },

    reset(): void {
      this.disposeEventListeners();
      this.$reset();
    },
  },
});
