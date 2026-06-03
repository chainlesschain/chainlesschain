/**
 * Time Machine Store - Timeline Time Machine state management
 *
 * Manages timeline browsing, memories, sentiment trends,
 * activity stats, heatmaps, and word cloud data.
 *
 * @module stores/timeMachine
 * @version 0.43.0
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

export interface TimelinePost {
  id: string;
  source_type: 'post' | 'message' | 'event';
  source_id: string;
  snapshot_date: string;
  content_preview: string | null;
  media_urls: string[];
  created_at: number;
}

export interface Memory {
  id: string;
  memory_type: 'on_this_day' | 'milestone' | 'annual_report' | 'throwback';
  title: string;
  description: string | null;
  cover_image: string | null;
  related_posts: string[];
  target_date: string | null;
  generated_at: number;
  is_read: number;
}

export interface SentimentTrend {
  date: string;
  avgScore: number;
  count: number;
  minScore: number;
  maxScore: number;
}

export interface ActivityStats {
  period: string;
  totalPosts: number;
  totalMessages: number;
  totalLikes: number;
  totalComments: number;
  totalActivity: number;
  dailyActivity: Array<{ date: string; count: number }>;
}

export interface HeatmapData {
  date: string;
  count: number;
}

export interface WordCloudItem {
  word: string;
  count: number;
}

interface TimeMachineState {
  currentDate: string;
  timelinePosts: TimelinePost[];
  memories: Memory[];
  sentimentTrend: SentimentTrend[];
  activityStats: ActivityStats | null;
  heatmapData: HeatmapData[];
  wordCloud: WordCloudItem[];
  loading: boolean;
}

// ==================== IPC Helper ====================

function getIpcRenderer() {
  return (window as any).electron?.ipcRenderer || null;
}

// ==================== Store ====================

export const useTimeMachineStore = defineStore('timeMachine', {
  state: (): TimeMachineState => ({
    currentDate: new Date().toISOString().split('T')[0],
    timelinePosts: [],
    memories: [],
    sentimentTrend: [],
    activityStats: null,
    heatmapData: [],
    wordCloud: [],
    loading: false,
  }),

  getters: {
    /**
     * Unread memories count
     */
    unreadMemoriesCount(): number {
      return this.memories.filter((m) => m.is_read === 0).length;
    },

    /**
     * Get memories grouped by type
     */
    memoriesByType(): Record<string, Memory[]> {
      const grouped: Record<string, Memory[]> = {};
      for (const memory of this.memories) {
        if (!grouped[memory.memory_type]) {
          grouped[memory.memory_type] = [];
        }
        grouped[memory.memory_type].push(memory);
      }
      return grouped;
    },

    /**
     * Current date parsed components
     */
    currentDateParts(): { year: number; month: number; day: number } {
      const parts = this.currentDate.split('-');
      return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
        day: parseInt(parts[2], 10),
      };
    },

    /**
     * Whether there are any timeline posts
     */
    hasTimelinePosts(): boolean {
      return this.timelinePosts.length > 0;
    },
  },

  actions: {
    /**
     * Set the current browsing date
     */
    setCurrentDate(date: string): void {
      this.currentDate = date;
    },

    /**
     * Load timeline posts for a specific date
     */
    async loadTimeline(year: number, month: number, day: number): Promise<void> {
      this.loading = true;
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        const posts = await ipc.invoke('time-machine:get-timeline', {
          year,
          month,
          day,
        });
        this.timelinePosts = Array.isArray(posts) ? posts : [];
      } catch (error: any) {
        console.error('Failed to load timeline:', error);
        this.timelinePosts = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Load memories
     */
    async loadMemories(limit: number = 20): Promise<void> {
      this.loading = true;
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        const memories = await ipc.invoke('time-machine:get-memories', limit);
        this.memories = Array.isArray(memories) ? memories : [];
      } catch (error: any) {
        console.error('Failed to load memories:', error);
        this.memories = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Load "on this day" content
     */
    async loadOnThisDay(): Promise<TimelinePost[]> {
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return [];

        const now = new Date();
        const posts = await ipc.invoke('time-machine:get-on-this-day', {
          month: now.getMonth() + 1,
          day: now.getDate(),
        });
        return Array.isArray(posts) ? posts : [];
      } catch (error: any) {
        console.error('Failed to load on-this-day:', error);
        return [];
      }
    },

    /**
     * Mark a memory as read
     */
    async markMemoryRead(id: string): Promise<void> {
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        await ipc.invoke('time-machine:mark-read', id);

        // Update local state
        const memory = this.memories.find((m) => m.id === id);
        if (memory) {
          memory.is_read = 1;
        }
      } catch (error: any) {
        console.error('Failed to mark memory read:', error);
        throw error;
      }
    },

    /**
     * Load sentiment trend for a date range
     */
    async loadSentimentTrend(startDate: string, endDate: string): Promise<void> {
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        const trend = await ipc.invoke('sentiment:get-trend', {
          startDate,
          endDate,
        });
        this.sentimentTrend = Array.isArray(trend) ? trend : [];
      } catch (error: any) {
        console.error('Failed to load sentiment trend:', error);
        this.sentimentTrend = [];
      }
    },

    /**
     * Load activity stats for a period
     */
    async loadActivityStats(period: string = 'month'): Promise<void> {
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        const stats = await ipc.invoke('stats:get-activity', period);
        this.activityStats = stats || null;
      } catch (error: any) {
        console.error('Failed to load activity stats:', error);
        this.activityStats = null;
      }
    },

    /**
     * Load heatmap data for a year
     */
    async loadHeatmap(year?: number): Promise<void> {
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        const data = await ipc.invoke(
          'stats:get-heatmap',
          year || new Date().getFullYear(),
        );
        this.heatmapData = Array.isArray(data) ? data : [];
      } catch (error: any) {
        console.error('Failed to load heatmap:', error);
        this.heatmapData = [];
      }
    },

    /**
     * Load word cloud data
     */
    async loadWordCloud(startDate: string, endDate: string): Promise<void> {
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return;

        const data = await ipc.invoke('stats:get-wordcloud', {
          startDate,
          endDate,
        });
        this.wordCloud = Array.isArray(data) ? data : [];
      } catch (error: any) {
        console.error('Failed to load word cloud:', error);
        this.wordCloud = [];
      }
    },

    /**
     * Generate annual report for a year
     */
    async generateAnnualReport(year: number): Promise<Memory | null> {
      this.loading = true;
      try {
        const ipc = getIpcRenderer();
        if (!ipc) return null;

        const memory = await ipc.invoke('memory:generate-annual-report', year);

        if (memory) {
          // Add to local memories list
          this.memories.unshift(memory);
        }

        return memory || null;
      } catch (error: any) {
        console.error('Failed to generate annual report:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
  },
});
