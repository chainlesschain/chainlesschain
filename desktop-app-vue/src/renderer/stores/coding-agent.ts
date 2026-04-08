import { defineStore } from "pinia";
import { createLogger } from "@/utils/logger";
import type {
  CodingAgentBackgroundTask,
  CodingAgentEvent,
  CodingAgentHarnessStatus,
  CodingAgentPermissionPolicy,
  CodingAgentReviewState,
  CodingAgentSessionState,
  CodingAgentStatus,
  CodingAgentSubAgentSnapshot,
  CodingAgentToolDescriptor,
  CodingAgentWorktreeRecord,
} from "@/types/electron.d";

const codingAgentLogger = createLogger("coding-agent-store");

const ASSISTANT_FINAL_EVENT_TYPES = ["assistant.final", "response-complete"];
const APPROVAL_REQUEST_EVENT_TYPES = [
  "approval.requested",
  "approval-requested",
];
const BLOCKED_TOOL_EVENT_TYPES = ["tool.call.failed", "tool-blocked"];
const SERVER_READY_EVENT_TYPES = ["runtime.server.ready", "server-ready"];
const SERVER_STOPPED_EVENT_TYPES = ["runtime.server.stopped", "server-stopped"];
const SESSION_STARTED_EVENT_TYPES = ["session.started", "session-created"];
const SESSION_RESUMED_EVENT_TYPES = ["session.resumed", "session-resumed"];
const SUB_AGENT_STARTED_EVENT_TYPES = ["sub-agent.started"];
const SUB_AGENT_COMPLETED_EVENT_TYPES = ["sub-agent.completed"];
const SUB_AGENT_FAILED_EVENT_TYPES = ["sub-agent.failed"];
const SUB_AGENT_LIFECYCLE_EVENT_TYPES = [
  ...SUB_AGENT_STARTED_EVENT_TYPES,
  ...SUB_AGENT_COMPLETED_EVENT_TYPES,
  ...SUB_AGENT_FAILED_EVENT_TYPES,
];
const REVIEW_REQUESTED_EVENT_TYPES = ["review.requested"];
const REVIEW_UPDATED_EVENT_TYPES = ["review.updated"];
const REVIEW_RESOLVED_EVENT_TYPES = ["review.resolved"];
const REVIEW_STATE_EVENT_TYPES = ["review.state"];
const REVIEW_LIFECYCLE_EVENT_TYPES = [
  ...REVIEW_REQUESTED_EVENT_TYPES,
  ...REVIEW_UPDATED_EVENT_TYPES,
  ...REVIEW_RESOLVED_EVENT_TYPES,
  ...REVIEW_STATE_EVENT_TYPES,
];
const STATUS_REFRESH_EVENT_TYPES = [
  ...SERVER_READY_EVENT_TYPES,
  "plan.updated",
  "plan-generated",
  "plan.approval_required",
  ...APPROVAL_REQUEST_EVENT_TYPES,
  ...BLOCKED_TOOL_EVENT_TYPES,
];

function matchesEventType(
  type: string | undefined,
  candidates: string[],
): boolean {
  return !!type && candidates.includes(type);
}

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

interface CodingAgentSubAgentBucket {
  active: CodingAgentSubAgentSnapshot[];
  history: CodingAgentSubAgentSnapshot[];
  stats?: { active?: number; completed?: number } | null;
}

interface CodingAgentState {
  currentSessionId: string | null;
  currentSession: CodingAgentSessionState | null;
  sessions: CodingAgentSessionSummary[];
  events: CodingAgentEvent[];
  harnessStatus: CodingAgentHarnessStatus | null;
  backgroundTasks: CodingAgentBackgroundTask[];
  selectedBackgroundTask: CodingAgentBackgroundTask | null;
  selectedBackgroundTaskHistory: any;
  worktrees: CodingAgentWorktreeRecord[];
  latestWorktreeDiff: CodingAgentWorktreeDiffResult | null;
  latestWorktreeMergeResult: CodingAgentWorktreeMergeResult | null;
  subAgents: Record<string, CodingAgentSubAgentBucket>;
  reviewStates: Record<string, CodingAgentReviewState | null>;
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
    harnessStatus: null,
    backgroundTasks: [],
    selectedBackgroundTask: null,
    selectedBackgroundTaskHistory: null,
    worktrees: [],
    latestWorktreeDiff: null,
    latestWorktreeMergeResult: null,
    subAgents: {},
    reviewStates: {},
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
        .find((event) =>
          matchesEventType(event.type, ASSISTANT_FINAL_EVENT_TYPES),
        );
      return response?.payload?.content || null;
    },

    pendingPlanSummary(): string | null {
      return this.currentSession?.lastPlanSummary || null;
    },

    latestApprovalRequest(): CodingAgentEvent | null {
      return (
        [...this.sessionEvents]
          .reverse()
          .find((event) =>
            matchesEventType(event.type, APPROVAL_REQUEST_EVENT_TYPES),
          ) || null
      );
    },

    latestBlockedToolEvent(): CodingAgentEvent | null {
      return (
        [...this.sessionEvents]
          .reverse()
          .find((event) =>
            matchesEventType(event.type, BLOCKED_TOOL_EVENT_TYPES),
          ) || null
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

    currentSessionSubAgents(state): CodingAgentSubAgentBucket {
      const sessionId = state.currentSessionId;
      if (!sessionId) {
        return { active: [], history: [], stats: null };
      }
      return (
        state.subAgents[sessionId] || { active: [], history: [], stats: null }
      );
    },

    currentSessionReviewState(state): CodingAgentReviewState | null {
      const sessionId = state.currentSessionId;
      if (!sessionId) return null;
      return state.reviewStates[sessionId] || null;
    },

    isCurrentSessionBlockedByReview(): boolean {
      const reviewState = this.currentSessionReviewState;
      return (
        !!reviewState &&
        reviewState.status === "pending" &&
        reviewState.blocking === true
      );
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
            harness: result.harness || null,
          };
          this.harnessStatus = result.harness || null;
        }
      } catch (error: any) {
        this.error = error.message;
      }
    },

    async refreshHarnessStatus(): Promise<void> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getHarnessStatus();
        if (result?.success) {
          this.harnessStatus = result.harness || null;
        }
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("refreshHarnessStatus failed:", error);
      }
    },

    async loadBackgroundTasks(filter: Record<string, any> = {}): Promise<void> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.listBackgroundTasks(filter);
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to list coding agent background tasks",
          );
        }
        this.backgroundTasks = result.tasks || [];
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("loadBackgroundTasks failed:", error);
      }
    },

    async fetchBackgroundTask(taskId: string): Promise<void> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getBackgroundTask(taskId);
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to get coding agent background task",
          );
        }
        this.selectedBackgroundTask = result.task || null;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("fetchBackgroundTask failed:", error);
      }
    },

    async fetchBackgroundTaskHistory(
      taskId: string,
      options: Record<string, any> = {},
    ): Promise<void> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getBackgroundTaskHistory({
          taskId,
          ...options,
        });
        if (!result?.success) {
          throw new Error(
            result?.error ||
              "Failed to get coding agent background task history",
          );
        }
        this.selectedBackgroundTaskHistory = result.history || null;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("fetchBackgroundTaskHistory failed:", error);
      }
    },

    async stopBackgroundTask(taskId: string): Promise<void> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.stopBackgroundTask(taskId);
        if (!result?.success) {
          throw new Error(
            result?.error || "Failed to stop coding agent background task",
          );
        }
        await this.loadBackgroundTasks();
        await this.refreshHarnessStatus();
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("stopBackgroundTask failed:", error);
      }
    },

    _ensureSubAgentBucket(sessionId: string): CodingAgentSubAgentBucket {
      if (!this.subAgents[sessionId]) {
        this.subAgents[sessionId] = { active: [], history: [], stats: null };
      }
      return this.subAgents[sessionId];
    },

    _applySubAgentLifecycle(
      eventType: string | undefined,
      snapshot: CodingAgentSubAgentSnapshot,
    ): void {
      const parentId = snapshot.parentId;
      if (!parentId) return;

      const bucket = this._ensureSubAgentBucket(parentId);

      if (matchesEventType(eventType, SUB_AGENT_STARTED_EVENT_TYPES)) {
        const existing = bucket.active.findIndex((a) => a.id === snapshot.id);
        if (existing >= 0) {
          bucket.active[existing] = { ...bucket.active[existing], ...snapshot };
        } else {
          bucket.active.push(snapshot);
        }
        return;
      }

      if (
        matchesEventType(eventType, SUB_AGENT_COMPLETED_EVENT_TYPES) ||
        matchesEventType(eventType, SUB_AGENT_FAILED_EVENT_TYPES)
      ) {
        bucket.active = bucket.active.filter((a) => a.id !== snapshot.id);
        const historyExisting = bucket.history.findIndex(
          (a) => a.id === snapshot.id,
        );
        if (historyExisting >= 0) {
          bucket.history[historyExisting] = {
            ...bucket.history[historyExisting],
            ...snapshot,
          };
        } else {
          bucket.history.unshift(snapshot);
        }
        if (bucket.history.length > 100) {
          bucket.history.length = 100;
        }
      }
    },

    async loadSubAgents(
      sessionId?: string | null,
    ): Promise<CodingAgentSubAgentBucket | null> {
      const targetId = sessionId ?? this.currentSessionId;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.listSubAgents(targetId || null);
        if (!result?.success) {
          throw new Error(result?.error || "Failed to list sub-agents");
        }
        const bucket: CodingAgentSubAgentBucket = {
          active: result.active || [],
          history: result.history || [],
          stats: result.stats || null,
        };
        if (targetId) {
          this.subAgents[targetId] = bucket;
        }
        return bucket;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("loadSubAgents failed:", error);
        return null;
      }
    },

    async fetchSubAgent(
      subAgentId: string,
      sessionId?: string | null,
    ): Promise<CodingAgentSubAgentSnapshot | null> {
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getSubAgent({
          subAgentId,
          sessionId: sessionId ?? this.currentSessionId ?? undefined,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Failed to fetch sub-agent");
        }
        return (result.subAgent as CodingAgentSubAgentSnapshot) || null;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("fetchSubAgent failed:", error);
        return null;
      }
    },

    _applyReviewState(
      sessionId: string,
      reviewState: CodingAgentReviewState | null,
    ): void {
      this.reviewStates[sessionId] = reviewState;
    },

    async enterReview(
      options: {
        sessionId?: string | null;
        reason?: string | null;
        requestedBy?: string;
        checklist?: Array<{ id?: string; title: string; note?: string }>;
        blocking?: boolean;
      } = {},
    ): Promise<CodingAgentReviewState | null> {
      const sessionId = options.sessionId ?? this.currentSessionId;
      if (!sessionId) return null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.enterReview({
          sessionId,
          reason: options.reason ?? null,
          requestedBy: options.requestedBy ?? "user",
          checklist: options.checklist ?? [],
          blocking: options.blocking !== false,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Failed to enter review mode");
        }
        const state = (result.reviewState as CodingAgentReviewState) || null;
        this._applyReviewState(sessionId, state);
        return state;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("enterReview failed:", error);
        return null;
      }
    },

    async submitReviewComment(
      update: {
        sessionId?: string | null;
        comment?: { author?: string; content: string } | null;
        checklistItemId?: string | null;
        checklistItemDone?: boolean;
        checklistItemNote?: string;
      } = {},
    ): Promise<CodingAgentReviewState | null> {
      const sessionId = update.sessionId ?? this.currentSessionId;
      if (!sessionId) return null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.submitReviewComment({
          sessionId,
          comment: update.comment ?? null,
          checklistItemId: update.checklistItemId ?? null,
          checklistItemDone: update.checklistItemDone,
          checklistItemNote: update.checklistItemNote,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Failed to submit review comment");
        }
        const state = (result.reviewState as CodingAgentReviewState) || null;
        this._applyReviewState(sessionId, state);
        return state;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("submitReviewComment failed:", error);
        return null;
      }
    },

    async resolveReview(payload: {
      sessionId?: string | null;
      decision: "approved" | "rejected";
      resolvedBy?: string;
      summary?: string | null;
    }): Promise<CodingAgentReviewState | null> {
      const sessionId = payload.sessionId ?? this.currentSessionId;
      if (!sessionId) return null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.resolveReview({
          sessionId,
          decision: payload.decision,
          resolvedBy: payload.resolvedBy ?? "user",
          summary: payload.summary ?? null,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Failed to resolve review");
        }
        const state = (result.reviewState as CodingAgentReviewState) || null;
        this._applyReviewState(sessionId, state);
        return state;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("resolveReview failed:", error);
        return null;
      }
    },

    async fetchReviewStatus(
      sessionId?: string | null,
    ): Promise<CodingAgentReviewState | null> {
      const targetId = sessionId ?? this.currentSessionId;
      if (!targetId) return null;
      try {
        const result = await (
          window as any
        ).electronAPI.codingAgent.getReviewState({ sessionId: targetId });
        if (!result?.success) {
          throw new Error(result?.error || "Failed to fetch review state");
        }
        const state = (result.reviewState as CodingAgentReviewState) || null;
        this._applyReviewState(targetId, state);
        return state;
      } catch (error: any) {
        this.error = error.message;
        codingAgentLogger.error("fetchReviewStatus failed:", error);
        return null;
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

    async startSession(
      options: Record<string, any> = {},
    ): Promise<string | null> {
      return this.createSession(options);
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

    async sendMessage(content: string): Promise<{
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
      await this.respondApproval({
        approvalType: "plan",
        decision: "granted",
      });
    },

    async respondApproval(payload: {
      decision: string;
      approvalType?: string;
      status?: string;
      action?: string;
    }): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.respondApproval({
        sessionId: this.currentSessionId,
        ...payload,
      });
      await this.fetchSessionState(this.currentSessionId);
    },

    async confirmHighRiskExecution(): Promise<void> {
      if (!this.currentSessionId) return;
      await this.respondApproval({
        approvalType: "high-risk",
        decision: "granted",
      });
    },

    async rejectPlan(): Promise<void> {
      if (!this.currentSessionId) return;
      await this.respondApproval({
        approvalType: "plan",
        decision: "denied",
      });
    },

    async closeCurrentSession(): Promise<void> {
      if (!this.currentSessionId) return;
      const sessionId = this.currentSessionId;
      await (window as any).electronAPI.codingAgent.closeSession(sessionId);
      this.currentSessionId = null;
      this.currentSession = null;
      this._resetWorktreeState();
      delete this.subAgents[sessionId];
      delete this.reviewStates[sessionId];
      this.events = this.events.filter(
        (event) => event.sessionId !== sessionId,
      );
      await this.loadSessions();
    },

    async interrupt(): Promise<void> {
      if (!this.currentSessionId) return;
      await (window as any).electronAPI.codingAgent.interrupt(
        this.currentSessionId,
      );
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
      const subscribe = api?.subscribeEvents || api?.onEvent || null;
      if (typeof subscribe !== "function") {
        codingAgentLogger.warn(
          "codingAgent event subscription API not available",
        );
        return;
      }

      this.unsubscribe = subscribe((event: CodingAgentEvent) => {
        this.events.push(event);
        if (this.events.length > 500) {
          this.events.splice(0, this.events.length - 500);
        }

        if (!event.sessionId) {
          if (matchesEventType(event.type, SERVER_READY_EVENT_TYPES)) {
            this.status.connected = true;
            this.status.host = event.payload?.host;
            this.status.port = event.payload?.port ?? null;
          } else if (matchesEventType(event.type, SERVER_STOPPED_EVENT_TYPES)) {
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

        if (matchesEventType(event.type, STATUS_REFRESH_EVENT_TYPES)) {
          this.refreshStatus().catch((error: any) => {
            codingAgentLogger.warn(
              "refreshStatus after event failed:",
              error?.message || error,
            );
          });
        }

        if (matchesEventType(event.type, REVIEW_LIFECYCLE_EVENT_TYPES)) {
          const payload = event.payload || {};
          const reviewState =
            (payload.reviewState as CodingAgentReviewState | null) || null;
          const targetSessionId = event.sessionId || payload.sessionId;
          if (targetSessionId) {
            this._applyReviewState(targetSessionId, reviewState);
          }
        }

        if (matchesEventType(event.type, SUB_AGENT_LIFECYCLE_EVENT_TYPES)) {
          const payload = event.payload || {};
          const snapshot: CodingAgentSubAgentSnapshot = {
            id: payload.subAgentId || payload.id,
            parentId:
              payload.parentSessionId || payload.parentId || event.sessionId,
            role: payload.role,
            task: payload.task,
            status: matchesEventType(event.type, SUB_AGENT_STARTED_EVENT_TYPES)
              ? "active"
              : matchesEventType(event.type, SUB_AGENT_COMPLETED_EVENT_TYPES)
                ? "completed"
                : "failed",
            summary: payload.summary || payload.error || null,
            durationMs: payload.durationMs ?? null,
            messageCount: payload.messageCount ?? 0,
            toolsUsed: payload.toolsUsed ?? 0,
            tokenCount: payload.tokenCount ?? 0,
            iterationCount: payload.iterationCount ?? 0,
            createdAt: payload.createdAt ?? null,
            completedAt: payload.completedAt ?? null,
            worktree: payload.worktree ?? null,
          } as CodingAgentSubAgentSnapshot;
          if (snapshot.id) {
            this._applySubAgentLifecycle(event.type, snapshot);
          }
        }

        if (
          matchesEventType(event.type, SESSION_STARTED_EVENT_TYPES) ||
          matchesEventType(event.type, SESSION_RESUMED_EVENT_TYPES)
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
