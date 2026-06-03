import { defineStore } from "pinia";

/** FAMILY-26 家长端家庭守护仪表板 store（只读 telemetry 镜像）。 */

export interface ChildSummary {
  childDid: string;
  eventCount: number;
  lastEventMs: number;
}

export interface ChildEvent {
  resourceId: string;
  childDid: string;
  source: string;
  kind: string;
  payload: string;
  package: string | null;
  timestampMs: number;
  durationMs: number;
  level: string;
  deviceId: string;
}

export interface AppUsage {
  package: string;
  totalMs: number;
  count: number;
}

export interface UsageSummary {
  totalMs: number;
  apps: AppUsage[];
}

interface FamilyGuardState {
  children: ChildSummary[];
  selectedChildDid: string | null;
  events: ChildEvent[];
  summary: UsageSummary;
  loading: boolean;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fgApi = () => (window as any).electronAPI?.familyGuard;

export const useFamilyGuardStore = defineStore("familyGuard", {
  state: (): FamilyGuardState => ({
    children: [],
    selectedChildDid: null,
    events: [],
    summary: { totalMs: 0, apps: [] },
    loading: false,
    error: null,
  }),

  getters: {
    hasChildren(): boolean {
      return this.children.length > 0;
    },
    totalMinutes(): number {
      return Math.round(this.summary.totalMs / 60000);
    },
  },

  actions: {
    /** 拉取有数据的孩子；首次默认选中最近活跃的那个并加载其明细。 */
    async fetchChildren(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const res = await fgApi()?.listChildren();
        if (res?.success) {
          this.children = res.data || [];
          if (!this.selectedChildDid && this.children.length > 0) {
            await this.selectChild(this.children[0].childDid);
          }
        } else {
          this.error = res?.error || "加载孩子列表失败";
        }
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      } finally {
        this.loading = false;
      }
    },

    /** 选中某孩子，并行加载其事件 + 使用聚合。 */
    async selectChild(childDid: string, sinceMs = 0): Promise<void> {
      this.selectedChildDid = childDid;
      await Promise.all([
        this.fetchEvents(sinceMs),
        this.fetchSummary(sinceMs),
      ]);
    },

    async fetchEvents(sinceMs = 0, limit = 200): Promise<void> {
      if (!this.selectedChildDid) {
        return;
      }
      const res = await fgApi()?.listChildEvents({
        childDid: this.selectedChildDid,
        sinceMs,
        limit,
      });
      if (res?.success) {
        this.events = res.data || [];
      }
    },

    async fetchSummary(sinceMs = 0): Promise<void> {
      if (!this.selectedChildDid) {
        return;
      }
      const res = await fgApi()?.appUsageSummary({
        childDid: this.selectedChildDid,
        sinceMs,
      });
      if (res?.success) {
        this.summary = res.data || { totalMs: 0, apps: [] };
      }
    },
  },
});
