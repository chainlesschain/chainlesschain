/**
 * Video Editing Store — Pinia state for CutClaw-inspired video editing agent
 *
 * Manages pipeline state, progress events, shot plan, and asset cache.
 * Communicates with main process via electronAPI.videoEditing.* IPC channels.
 */

import { defineStore } from "pinia";

// ==================== 类型定义 ====================

export interface VideoEditingOptions {
  videoPath: string;
  audioPath?: string;
  instruction?: string;
  outputPath?: string;
  srt?: string;
  fps?: number;
  character?: string;
  parallel?: boolean;
  concurrency?: number;
  review?: boolean;
  useMadmom?: boolean;
  snapBeats?: boolean;
  ducking?: boolean;
  requestId?: string;
}

export interface PipelineEvent {
  type: string;
  ts: number;
  phase?: string;
  pct?: number;
  message?: string;
  [key: string]: unknown;
}

export interface ShotPlanSection {
  section_idx: number;
  music_segment?: { start: number; end: number; label?: string };
  shots: Array<{
    shot_idx: number;
    target_duration?: number;
    emotion?: string;
    visual_target?: string;
  }>;
}

export interface ShotPlan {
  sections: ShotPlanSection[];
}

export interface ShotPoint {
  section_idx: number;
  shot_idx: number;
  clips: Array<{ start: number; end: number }>;
  total_duration?: number;
}

export interface AssetEntry {
  hash: string;
  videoPath?: string;
  audioPath?: string;
  modifiedAt?: string;
}

export type PipelinePhase =
  | "idle"
  | "deconstruct"
  | "plan"
  | "assemble"
  | "review"
  | "render"
  | "done"
  | "error";

// ==================== Store ====================

export const useVideoEditingStore = defineStore("videoEditing", {
  state: () => ({
    phase: "idle" as PipelinePhase,
    progress: 0,
    progressMessage: "",
    events: [] as PipelineEvent[],
    assetDir: "",
    shotPlan: null as ShotPlan | null,
    shotPoints: [] as ShotPoint[],
    outputPath: "",
    error: "",
    assets: [] as AssetEntry[],
    activeRequestId: "",
    _unsubscribe: null as (() => void) | null,
  }),

  getters: {
    isRunning: (state) => !["idle", "done", "error"].includes(state.phase),
    totalShots: (state) =>
      state.shotPlan?.sections?.reduce(
        (s, sec) => s + (sec.shots?.length || 0),
        0,
      ) ?? 0,
    eventLog: (state) => state.events.slice(-100),
  },

  actions: {
    _api() {
      return (window as any).electronAPI?.videoEditing;
    },

    subscribeEvents() {
      const api = this._api();
      if (!api) return;
      if (this._unsubscribe) this._unsubscribe();
      this._unsubscribe = api.onEvent((ev: PipelineEvent) => {
        this.events.push(ev);
        if (ev.type === "phase.start" && ev.phase) {
          this.phase = ev.phase as PipelinePhase;
          this.progress = 0;
          this.progressMessage = "";
        }
        if (ev.type === "phase.progress") {
          this.progress = ev.pct ?? 0;
          this.progressMessage = (ev.message as string) ?? "";
        }
        if (ev.type === "phase.end" && ev.phase === "render") {
          this.phase = "done";
        }
      });
    },

    unsubscribeEvents() {
      if (this._unsubscribe) {
        this._unsubscribe();
        this._unsubscribe = null;
      }
    },

    reset() {
      this.phase = "idle";
      this.progress = 0;
      this.progressMessage = "";
      this.events = [];
      this.assetDir = "";
      this.shotPlan = null;
      this.shotPoints = [];
      this.outputPath = "";
      this.error = "";
      this.activeRequestId = "";
    },

    async runFullPipeline(options: VideoEditingOptions) {
      const api = this._api();
      if (!api) {
        this.error = "electronAPI.videoEditing not available";
        this.phase = "error";
        return;
      }

      this.reset();
      this.subscribeEvents();
      this.phase = "deconstruct";
      this.activeRequestId = options.requestId || `ve_${Date.now()}`;

      try {
        const result = await api.edit({
          ...options,
          requestId: this.activeRequestId,
        });

        if (!result.ok) {
          this.error = result.error || "Pipeline failed";
          this.phase = "error";
          return;
        }

        this.assetDir = result.assetDir || "";
        this.shotPlan = result.shotPlan || null;
        this.shotPoints = result.shotPoints || [];
        this.outputPath = result.outputPath || "";
        this.phase = "done";
      } catch (e: any) {
        this.error = e.message || "Unknown error";
        this.phase = "error";
      }
    },

    async runDeconstruct(options: VideoEditingOptions) {
      const api = this._api();
      if (!api) return;
      this.phase = "deconstruct";
      this.subscribeEvents();
      const result = await api.deconstruct(options);
      if (result.ok) this.assetDir = result.assetDir;
      else this.error = result.error;
    },

    async runPlan(options: VideoEditingOptions & { assetDir: string }) {
      const api = this._api();
      if (!api) return;
      this.phase = "plan";
      const result = await api.plan(options);
      if (result.ok) this.shotPlan = result.shotPlan;
      else this.error = result.error;
    },

    async runAssemble(
      options: VideoEditingOptions & { assetDir: string; shotPlan: ShotPlan },
    ) {
      const api = this._api();
      if (!api) return;
      this.phase = "assemble";
      const result = await api.assemble(options);
      if (result.ok) this.shotPoints = result.shotPoints;
      else this.error = result.error;
    },

    async runRender(
      options: VideoEditingOptions & {
        assetDir: string;
        shotPoints: ShotPoint[];
      },
    ) {
      const api = this._api();
      if (!api) return;
      this.phase = "render";
      const result = await api.render(options);
      if (result.ok) {
        this.outputPath = result.outputPath;
        this.phase = "done";
      } else {
        this.error = result.error;
      }
    },

    async cancel() {
      const api = this._api();
      if (!api || !this.activeRequestId) return;
      await api.cancel(this.activeRequestId);
      this.phase = "idle";
    },

    async loadAssets() {
      const api = this._api();
      if (!api) return;
      const result = await api.assetsList();
      if (result.ok) this.assets = result.assets;
    },
  },
});
