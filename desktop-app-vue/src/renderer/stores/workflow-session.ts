/**
 * workflow-session store — Phase D of the canonical coding workflow.
 *
 * Thin read-only Pinia store over the `workflow-session:*` IPC channels
 * (backed by SessionStateManager). The store has no write actions —
 * mutations go through the coding-agent skill handlers so Gates V1/V3/V4
 * stay authoritative.
 */

import { defineStore } from "pinia";
import { createLogger } from "@/utils/logger";

const logger = createLogger("workflow-session-store");

export type CanonicalStage =
  | "intake"
  | "intent"
  | "plan"
  | "execute"
  | "verify"
  | "fix-loop"
  | "complete"
  | "failed"
  | "done"
  | null;

export interface CanonicalSessionSummary {
  sessionId: string;
  stage: CanonicalStage;
  updatedAt: string | null;
  retries: number;
  maxRetries: number | null;
  failureReason: string | null;
}

export interface CanonicalTaskNode {
  id: string;
  title?: string;
  ownerRole?: string;
  scopePaths?: string[];
  dependsOn?: string[];
  verifyCommands?: string[];
  doneWhen?: string[];
  status: "pending" | "running" | "completed" | "failed" | string;
}

export interface CanonicalTasksPayload {
  sessionId: string;
  version: number;
  stage: string;
  tasks: CanonicalTaskNode[];
  updatedAt: string;
}

export interface CanonicalVerifyCheck {
  id: string;
  command: string;
  status: "passed" | "failed" | "partial";
  exitCode?: number;
  durationMs?: number;
  summary?: string;
}

export interface CanonicalVerifyPayload {
  sessionId: string;
  status: "passed" | "failed" | "partial";
  checks: CanonicalVerifyCheck[];
  nextAction: "complete" | "fix-loop" | null;
  updatedAt: string;
}

export interface IntakeClassification {
  decision: "ralph" | "team";
  confidence: "low" | "medium" | "high";
  complexity: "trivial" | "simple" | "moderate" | "complex";
  scopeCount: number;
  boundaries: string[];
  testHeavy: boolean;
  signals: string[];
  reason: string;
  recommendedConcurrency: number;
  suggestedRoles: string[];
}

export interface CanonicalSessionState {
  sessionId: string;
  stage: CanonicalStage;
  mode: {
    stage?: string;
    updatedAt?: string;
    retries?: number;
    maxRetries?: number;
    failureReason?: string | null;
  } | null;
  intent: string | null;
  plan: { approved: boolean; updated: string | null; raw: string } | null;
  tasks: CanonicalTasksPayload | null;
  verify: CanonicalVerifyPayload | null;
  progress: string | null;
  summary: string | null;
  artifacts: string[];
}

interface State {
  sessions: CanonicalSessionSummary[];
  currentSessionId: string | null;
  currentState: CanonicalSessionState | null;
  members: CanonicalSessionSummary[];
  loading: boolean;
  loadingDetail: boolean;
  error: string | null;
  lastClassification: IntakeClassification | null;
}

function api() {
  // Use `any` to avoid forcing a global.d.ts edit; window.electronAPI is
  // untyped in this codebase. The IPC shape is stable (see preload/index.js).
  const bridge = (window as unknown as { electronAPI?: any }).electronAPI;
  if (!bridge?.workflowSession) {
    throw new Error(
      "workflowSession IPC bridge not available (preload not loaded?)",
    );
  }
  return bridge.workflowSession as {
    list: () => Promise<{
      success: boolean;
      sessions?: CanonicalSessionSummary[];
      error?: string;
    }>;
    get: (sessionId: string) => Promise<{
      success: boolean;
      state?: CanonicalSessionState;
      error?: string;
    }>;
    listMembers: (parentId: string) => Promise<{
      success: boolean;
      members?: CanonicalSessionSummary[];
      error?: string;
    }>;
    classifyIntake: (input: {
      request?: string;
      scopePaths?: string[];
      fileHints?: string[];
      sessionId?: string;
      concurrency?: number;
    }) => Promise<{
      success: boolean;
      classification?: IntakeClassification;
      error?: string;
    }>;
  };
}

export const useWorkflowSessionStore = defineStore("workflow-session", {
  state: (): State => ({
    sessions: [],
    currentSessionId: null,
    currentState: null,
    members: [],
    loading: false,
    loadingDetail: false,
    error: null,
    lastClassification: null,
  }),

  getters: {
    hasVerifyResult(state): boolean {
      return state.currentState?.verify != null;
    },
    verifyPassed(state): boolean {
      return state.currentState?.verify?.status === "passed";
    },
    taskReadiness(state): {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    } {
      const tasks = state.currentState?.tasks?.tasks || [];
      return {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending").length,
        running: tasks.filter((t) => t.status === "running").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        failed: tasks.filter((t) => t.status === "failed").length,
      };
    },
  },

  actions: {
    async refreshList(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const res = await api().list();
        if (res.success) {
          this.sessions = res.sessions || [];
        } else {
          this.error = res.error || "failed to list sessions";
          this.sessions = [];
        }
      } catch (err: any) {
        logger.error("refreshList failed", err);
        this.error = err?.message || String(err);
        this.sessions = [];
      } finally {
        this.loading = false;
      }
    },

    async selectSession(sessionId: string): Promise<void> {
      this.currentSessionId = sessionId;
      this.loadingDetail = true;
      this.error = null;
      try {
        const res = await api().get(sessionId);
        if (res.success && res.state) {
          this.currentState = res.state;
        } else {
          this.error = res.error || `failed to load session "${sessionId}"`;
          this.currentState = null;
        }
      } catch (err: any) {
        logger.error(`selectSession(${sessionId}) failed`, err);
        this.error = err?.message || String(err);
        this.currentState = null;
      } finally {
        this.loadingDetail = false;
      }
    },

    async loadMembers(parentId: string): Promise<void> {
      try {
        const res = await api().listMembers(parentId);
        if (res.success) {
          this.members = res.members || [];
        } else {
          this.error = res.error || "failed to list members";
          this.members = [];
        }
      } catch (err: any) {
        logger.error(`loadMembers(${parentId}) failed`, err);
        this.error = err?.message || String(err);
        this.members = [];
      }
    },

    async classifyIntake(input: {
      request?: string;
      scopePaths?: string[];
      fileHints?: string[];
      sessionId?: string;
      concurrency?: number;
    }): Promise<IntakeClassification | null> {
      try {
        const res = await api().classifyIntake(input);
        if (res.success && res.classification) {
          this.lastClassification = res.classification;
          return res.classification;
        }
        this.error = res.error || "classify-intake failed";
        return null;
      } catch (err: any) {
        logger.error("classifyIntake failed", err);
        this.error = err?.message || String(err);
        return null;
      }
    },

    clearSelection(): void {
      this.currentSessionId = null;
      this.currentState = null;
      this.members = [];
    },
  },
});
