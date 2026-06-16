/**
 * autonomousOps store 测试 — src/renderer/stores/autonomousOps.ts
 *
 * Pure getters (active incidents / by-priority / alert count) + IPC actions
 * via window.electronAPI.invoke('ops:*') (mocked, channel-dispatched).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAutonomousOpsStore } from "@/stores/autonomousOps";

let invoke: any;
beforeEach(() => {
  setActivePinia(createPinia());
  invoke = vi.fn(async () => ({ success: true, data: [] }));
  (window as any).electronAPI = { invoke };
});

describe("autonomousOps — getters", () => {
  it("activeIncidents excludes resolved/closed", () => {
    const s = useAutonomousOpsStore();
    s.incidents = [
      { id: "a", status: "open", priority: "P1" },
      { id: "b", status: "resolved", priority: "P2" },
      { id: "c", status: "closed", priority: "P3" },
      { id: "d", status: "investigating", priority: "P1" },
    ] as any;
    expect(s.activeIncidents.map((i) => i.id)).toEqual(["a", "d"]);
  });

  it("incidentsByPriority filters by priority", () => {
    const s = useAutonomousOpsStore();
    s.incidents = [
      { id: "a", priority: "P1" },
      { id: "b", priority: "P2" },
      { id: "c", priority: "P1" },
    ] as any;
    expect(s.incidentsByPriority("P1").map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("alertCount counts unacknowledged alerts", () => {
    const s = useAutonomousOpsStore();
    s.alerts = [
      { acknowledged: false },
      { acknowledged: true },
      { acknowledged: false },
    ] as any;
    expect(s.alertCount).toBe(2);
  });
});

describe("autonomousOps — incident actions", () => {
  it("getIncidents stores data and toggles loading", async () => {
    invoke.mockResolvedValue({ success: true, data: [{ id: "i1" }] });
    const s = useAutonomousOpsStore();
    const r = await s.getIncidents();
    expect(invoke).toHaveBeenCalledWith("ops:get-incidents");
    expect(s.incidents).toEqual([{ id: "i1" }]);
    expect(s.loading).toBe(false);
    expect(r.success).toBe(true);
  });

  it("getIncidents returns a failure result when invoke throws", async () => {
    invoke.mockRejectedValue(new Error("ipc fail"));
    const s = useAutonomousOpsStore();
    const r = await s.getIncidents();
    expect(r).toEqual({ success: false, error: "ipc fail" });
    expect(s.loading).toBe(false);
  });

  it("acknowledge re-fetches incidents on success", async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === "ops:get-incidents")
        return { success: true, data: [{ id: "i1" }] };
      return { success: true };
    });
    const s = useAutonomousOpsStore();
    const r = await s.acknowledge("i1");
    expect(r.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ops:acknowledge", "i1");
    expect(invoke).toHaveBeenCalledWith("ops:get-incidents");
    expect(s.incidents).toEqual([{ id: "i1" }]);
  });

  it("getIncidentDetail passes the id through and returns the result", async () => {
    invoke.mockResolvedValue({ success: true, data: { id: "i1", logs: [] } });
    const s = useAutonomousOpsStore();
    const r = await s.getIncidentDetail("i1");
    expect(invoke).toHaveBeenCalledWith("ops:get-incident-detail", "i1");
    expect(r.data.id).toBe("i1");
  });
});

describe("autonomousOps — playbooks + reset", () => {
  it("getPlaybooks stores the list", async () => {
    invoke.mockResolvedValue({ success: true, data: [{ id: "pb1" }] });
    const s = useAutonomousOpsStore();
    await s.getPlaybooks();
    expect(s.playbooks).toEqual([{ id: "pb1" }]);
  });

  it("reset clears state", () => {
    const s = useAutonomousOpsStore();
    s.incidents = [{ id: "x" }] as any;
    s.alerts = [{ acknowledged: false }] as any;
    s.error = "boom";
    s.reset();
    expect(s.incidents).toEqual([]);
    expect(s.alerts).toEqual([]);
    expect(s.error).toBeNull();
  });
});
