/**
 * TaskBoard store — report actions
 *
 * Covers the report slice used by TaskReportsPanel:
 *  - loadReports()        → task:get-reports (options must be NESTED — the
 *    handler reads params.options; the old top-level spread silently dropped limit)
 *  - createReport()       → task:create-report (unshift on success)
 *  - generateAISummary()  → task:generate-ai-summary
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTaskBoardStore } from "../taskBoard";

const invokeMock = vi.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
  (window as any).electronAPI = { invoke: invokeMock };
});

describe("taskBoard store — report actions", () => {
  it("loadReports sends { orgId, options } nested (handler reads params.options)", async () => {
    invokeMock.mockResolvedValue({ success: true, reports: [] });
    const store = useTaskBoardStore();

    await store.loadReports("org-1", { limit: 50 });

    expect(invokeMock).toHaveBeenCalledWith("task:get-reports", {
      orgId: "org-1",
      options: { limit: 50 },
    });
  });

  it("loadReports hydrates reports and clears the loading flag", async () => {
    const rows = [
      { id: "r1", reportType: "daily_standup", authorName: "A" },
      { id: "r2", reportType: "weekly", authorName: "B" },
    ];
    invokeMock.mockResolvedValue({ success: true, reports: rows });
    const store = useTaskBoardStore();

    await store.loadReports("org-1");

    expect(store.reports).toEqual(rows);
    expect(store.loading.reports).toBe(false);
  });

  it("loadReports leaves reports empty on failure result", async () => {
    invokeMock.mockResolvedValue({ success: false, error: "nope" });
    const store = useTaskBoardStore();

    await store.loadReports("org-1");

    expect(store.reports).toEqual([]);
  });

  it("createReport unshifts the new report on success", async () => {
    invokeMock.mockResolvedValue({ success: true, reportId: "new-1" });
    const store = useTaskBoardStore();
    store.reports = [{ id: "old" } as any];

    const result = await store.createReport({
      reportType: "daily_standup",
      yesterdayWork: "did things",
    } as any);

    expect(result.success).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      "task:create-report",
      expect.objectContaining({ reportType: "daily_standup" }),
    );
    expect(store.reports[0].id).toBe("new-1");
    expect(store.reports).toHaveLength(2);
  });

  it("generateAISummary invokes the channel with the reportId", async () => {
    invokeMock.mockResolvedValue({ success: true, summary: "ok" });
    const store = useTaskBoardStore();

    const result = await store.generateAISummary("r-9");

    expect(invokeMock).toHaveBeenCalledWith("task:generate-ai-summary", {
      reportId: "r-9",
    });
    expect(result.success).toBe(true);
  });
});
