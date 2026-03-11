import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PlanModeManager,
  PlanItem,
  ExecutionPlan,
  PlanState,
  PlanStatus,
  getPlanModeManager,
  destroyPlanModeManager,
} from "../../src/lib/plan-mode.js";

describe("PlanModeManager", () => {
  let manager;

  beforeEach(() => {
    destroyPlanModeManager();
    manager = new PlanModeManager();
  });

  afterEach(() => {
    manager.removeAllListeners();
    destroyPlanModeManager();
  });

  // ── Lifecycle ──

  describe("lifecycle", () => {
    it("starts in INACTIVE state", () => {
      expect(manager.state).toBe(PlanState.INACTIVE);
      expect(manager.isActive()).toBe(false);
      expect(manager.currentPlan).toBeNull();
    });

    it("enters plan mode with title and goal", () => {
      const result = manager.enterPlanMode({
        title: "Test Plan",
        goal: "Test goal",
      });
      expect(result.plan).toBeDefined();
      expect(result.plan.title).toBe("Test Plan");
      expect(result.plan.goal).toBe("Test goal");
      expect(manager.state).toBe(PlanState.ANALYZING);
      expect(manager.isActive()).toBe(true);
    });

    it("enters plan mode with defaults", () => {
      const result = manager.enterPlanMode();
      expect(result.plan.title).toBe("New Plan");
      expect(result.plan.goal).toBe("");
    });

    it("prevents double entry", () => {
      manager.enterPlanMode();
      const result = manager.enterPlanMode();
      expect(result.error).toBe("Already in plan mode");
    });

    it("exits plan mode", () => {
      manager.enterPlanMode();
      const result = manager.exitPlanMode({ savePlan: true });
      expect(result.plan).toBeDefined();
      expect(manager.state).toBe(PlanState.INACTIVE);
      expect(manager.isActive()).toBe(false);
      expect(manager.currentPlan).toBeNull();
    });

    it("prevents exit when not active", () => {
      const result = manager.exitPlanMode();
      expect(result.error).toBe("Not in plan mode");
    });

    it("saves plan to history on exit with savePlan", () => {
      manager.enterPlanMode({ title: "Saved Plan" });
      manager.exitPlanMode({ savePlan: true });
      expect(manager.getHistory().length).toBe(1);
      expect(manager.getHistory()[0].title).toBe("Saved Plan");
    });

    it("does not save plan to history without savePlan", () => {
      manager.enterPlanMode();
      manager.exitPlanMode({ savePlan: false });
      expect(manager.getHistory().length).toBe(0);
    });

    it("clears blocked tool log on enter", () => {
      manager.enterPlanMode();
      manager.isToolAllowed("write_file");
      expect(manager.blockedToolLog.length).toBe(1);
      manager.exitPlanMode();
      manager.enterPlanMode();
      expect(manager.blockedToolLog.length).toBe(0);
    });
  });

  // ── Plan items ──

  describe("plan items", () => {
    beforeEach(() => {
      manager.enterPlanMode({ title: "Test" });
    });

    it("adds plan items", () => {
      const result = manager.addPlanItem({
        title: "Step 1",
        tool: "write_file",
        estimatedImpact: "medium",
      });
      expect(result.item).toBeDefined();
      expect(result.item.title).toBe("Step 1");
      expect(result.item.tool).toBe("write_file");
      expect(result.item.estimatedImpact).toBe("medium");
      expect(manager.currentPlan.items.length).toBe(1);
    });

    it("auto-increments order", () => {
      manager.addPlanItem({ title: "Step 1" });
      manager.addPlanItem({ title: "Step 2" });
      manager.addPlanItem({ title: "Step 3" });
      expect(manager.currentPlan.items[0].order).toBe(0);
      expect(manager.currentPlan.items[1].order).toBe(1);
      expect(manager.currentPlan.items[2].order).toBe(2);
    });

    it("returns error when no active plan", () => {
      manager.exitPlanMode();
      const result = manager.addPlanItem({ title: "Step" });
      expect(result.error).toBeDefined();
    });

    it("creates items with default status PENDING", () => {
      const result = manager.addPlanItem({ title: "Step 1" });
      expect(result.item.status).toBe(PlanStatus.PENDING);
    });

    it("creates items with default impact LOW", () => {
      const result = manager.addPlanItem({ title: "Step 1" });
      expect(result.item.estimatedImpact).toBe("low");
    });
  });

  // ── Approval flow ──

  describe("approval", () => {
    beforeEach(() => {
      manager.enterPlanMode({ title: "Test" });
      manager.addPlanItem({ title: "Step 1", tool: "write_file" });
      manager.addPlanItem({ title: "Step 2", tool: "run_shell" });
    });

    it("marks plan as ready", () => {
      manager.markPlanReady();
      expect(manager.state).toBe(PlanState.PLAN_READY);
      expect(manager.currentPlan.status).toBe(PlanState.PLAN_READY);
    });

    it("prevents marking ready when not analyzing", () => {
      manager.markPlanReady();
      const result = manager.markPlanReady();
      expect(result.error).toBeDefined();
    });

    it("approves entire plan", () => {
      manager.markPlanReady();
      const result = manager.approvePlan();
      expect(result.approvedCount).toBe(2);
      expect(manager.state).toBe(PlanState.APPROVED);
      expect(manager.currentPlan.items[0].status).toBe(PlanStatus.APPROVED);
      expect(manager.currentPlan.items[1].status).toBe(PlanStatus.APPROVED);
    });

    it("approves from analyzing state too", () => {
      const result = manager.approvePlan();
      expect(result.approvedCount).toBe(2);
      expect(manager.state).toBe(PlanState.APPROVED);
    });

    it("rejects plan", () => {
      manager.markPlanReady();
      const result = manager.rejectPlan("Changed my mind");
      expect(result.plan).toBeDefined();
      expect(manager.isActive()).toBe(false);
    });

    it("reject marks all items as rejected", () => {
      manager.markPlanReady();
      manager.rejectPlan();
      // Plan is saved to history
      const lastPlan = manager.getHistory()[manager.getHistory().length - 1];
      expect(lastPlan.items[0].status).toBe(PlanStatus.REJECTED);
      expect(lastPlan.items[1].status).toBe(PlanStatus.REJECTED);
    });

    it("allows partial approval by item IDs", () => {
      manager.markPlanReady();
      const itemId = manager.currentPlan.items[0].id;
      const result = manager.approvePlan({ itemIds: [itemId] });
      expect(result.approvedCount).toBe(1);
      expect(manager.currentPlan.items[0].status).toBe(PlanStatus.APPROVED);
      expect(manager.currentPlan.items[1].status).toBe(PlanStatus.PENDING);
    });

    it("cannot approve when not ready or analyzing", () => {
      manager.markPlanReady();
      manager.approvePlan();
      // Already approved
      const result = manager.approvePlan();
      expect(result.error).toBeDefined();
    });
  });

  // ── Tool filtering ──

  describe("tool filtering", () => {
    it("allows all tools when not in plan mode", () => {
      expect(manager.isToolAllowed("write_file")).toBe(true);
      expect(manager.isToolAllowed("read_file")).toBe(true);
      expect(manager.isToolAllowed("run_shell")).toBe(true);
      expect(manager.isToolAllowed("edit_file")).toBe(true);
    });

    it("allows read tools during analyzing state", () => {
      manager.enterPlanMode();
      expect(manager.isToolAllowed("read_file")).toBe(true);
      expect(manager.isToolAllowed("search_files")).toBe(true);
      expect(manager.isToolAllowed("list_dir")).toBe(true);
      expect(manager.isToolAllowed("list_skills")).toBe(true);
    });

    it("blocks write tools during analyzing state", () => {
      manager.enterPlanMode();
      expect(manager.isToolAllowed("write_file")).toBe(false);
      expect(manager.isToolAllowed("edit_file")).toBe(false);
      expect(manager.isToolAllowed("run_shell")).toBe(false);
      expect(manager.isToolAllowed("run_skill")).toBe(false);
    });

    it("blocks write tools during plan_ready state", () => {
      manager.enterPlanMode();
      manager.addPlanItem({ title: "x" });
      manager.markPlanReady();
      expect(manager.isToolAllowed("write_file")).toBe(false);
      expect(manager.isToolAllowed("run_shell")).toBe(false);
    });

    it("logs blocked tools", () => {
      manager.enterPlanMode();
      manager.isToolAllowed("write_file");
      manager.isToolAllowed("run_shell");
      manager.isToolAllowed("edit_file");
      expect(manager.blockedToolLog.length).toBe(3);
      expect(manager.blockedToolLog[0].tool).toBe("write_file");
      expect(manager.blockedToolLog[0].timestamp).toBeDefined();
    });

    it("allows all tools after approval", () => {
      manager.enterPlanMode();
      manager.addPlanItem({ title: "Step 1" });
      manager.markPlanReady();
      manager.approvePlan();
      expect(manager.isToolAllowed("write_file")).toBe(true);
      expect(manager.isToolAllowed("run_shell")).toBe(true);
      expect(manager.isToolAllowed("edit_file")).toBe(true);
      expect(manager.isToolAllowed("run_skill")).toBe(true);
    });

    it("blocks unknown tools in plan mode", () => {
      manager.enterPlanMode();
      expect(manager.isToolAllowed("unknown_tool")).toBe(false);
    });

    it("does not log read tools", () => {
      manager.enterPlanMode();
      manager.isToolAllowed("read_file");
      manager.isToolAllowed("search_files");
      expect(manager.blockedToolLog.length).toBe(0);
    });
  });

  // ── Plan summary ──

  describe("plan summary", () => {
    it("generates summary for active plan", () => {
      manager.enterPlanMode({ title: "My Plan", goal: "Test something" });
      manager.addPlanItem({ title: "Read config", estimatedImpact: "low" });
      manager.addPlanItem({ title: "Write output", estimatedImpact: "high" });

      const summary = manager.generatePlanSummary();
      expect(summary).toContain("My Plan");
      expect(summary).toContain("Test something");
      expect(summary).toContain("Read config");
      expect(summary).toContain("Write output");
      expect(summary).toContain("analyzing");
    });

    it("returns message when no active plan", () => {
      expect(manager.generatePlanSummary()).toContain("No active plan");
    });

    it("includes blocked tools in summary", () => {
      manager.enterPlanMode({ title: "Plan" });
      manager.isToolAllowed("write_file");
      manager.isToolAllowed("run_shell");
      const summary = manager.generatePlanSummary();
      expect(summary).toContain("Blocked tools");
      expect(summary).toContain("write_file");
    });

    it("shows item status icons", () => {
      manager.enterPlanMode({ title: "Plan" });
      manager.addPlanItem({ title: "Step" });
      manager.markPlanReady();
      manager.approvePlan();
      const summary = manager.generatePlanSummary();
      // Approved items get checkmark
      expect(summary).toContain("✓");
    });
  });

  // ── Singleton ──

  describe("singleton", () => {
    it("returns same instance", () => {
      const a = getPlanModeManager();
      const b = getPlanModeManager();
      expect(a).toBe(b);
    });

    it("destroys and recreates", () => {
      const a = getPlanModeManager();
      destroyPlanModeManager();
      const b = getPlanModeManager();
      expect(a).not.toBe(b);
    });

    it("new instance is in INACTIVE state", () => {
      const a = getPlanModeManager();
      a.enterPlanMode();
      destroyPlanModeManager();
      const b = getPlanModeManager();
      expect(b.isActive()).toBe(false);
    });
  });

  // ── Events ──

  describe("events", () => {
    it("emits enter event", () => {
      let data = null;
      manager.on("enter", (d) => {
        data = d;
      });
      manager.enterPlanMode({ title: "Test" });
      expect(data).not.toBeNull();
      expect(data.plan).toBeDefined();
      expect(data.state).toBe(PlanState.ANALYZING);
    });

    it("emits exit event", () => {
      let data = null;
      manager.on("exit", (d) => {
        data = d;
      });
      manager.enterPlanMode();
      manager.exitPlanMode({ reason: "test" });
      expect(data).not.toBeNull();
      expect(data.reason).toBe("test");
    });

    it("emits item-added event", () => {
      let data = null;
      manager.on("item-added", (d) => {
        data = d;
      });
      manager.enterPlanMode();
      manager.addPlanItem({ title: "Step" });
      expect(data).not.toBeNull();
      expect(data.item.title).toBe("Step");
    });

    it("emits plan-ready event", () => {
      let emitted = false;
      manager.on("plan-ready", () => {
        emitted = true;
      });
      manager.enterPlanMode();
      manager.markPlanReady();
      expect(emitted).toBe(true);
    });

    it("emits plan-approved event", () => {
      let data = null;
      manager.on("plan-approved", (d) => {
        data = d;
      });
      manager.enterPlanMode();
      manager.addPlanItem({ title: "Step" });
      manager.markPlanReady();
      manager.approvePlan();
      expect(data).not.toBeNull();
      expect(data.approvedCount).toBe(1);
    });

    it("emits tool-blocked event", () => {
      let toolName = null;
      manager.on("tool-blocked", (d) => {
        toolName = d.toolName;
      });
      manager.enterPlanMode();
      manager.isToolAllowed("write_file");
      expect(toolName).toBe("write_file");
    });

    it("does not emit tool-blocked for read tools", () => {
      let emitted = false;
      manager.on("tool-blocked", () => {
        emitted = true;
      });
      manager.enterPlanMode();
      manager.isToolAllowed("read_file");
      expect(emitted).toBe(false);
    });
  });
});

// ── PlanItem ──

describe("PlanItem", () => {
  it("creates with defaults", () => {
    const item = new PlanItem();
    expect(item.id).toBeDefined();
    expect(item.status).toBe(PlanStatus.PENDING);
    expect(item.estimatedImpact).toBe("low");
    expect(item.order).toBe(0);
    expect(item.tool).toBeNull();
    expect(item.params).toEqual({});
    expect(item.dependencies).toEqual([]);
    expect(item.result).toBeNull();
    expect(item.error).toBeNull();
  });

  it("creates with custom data", () => {
    const item = new PlanItem({
      title: "Custom",
      tool: "write_file",
      estimatedImpact: "high",
      params: { path: "/tmp/test" },
      dependencies: ["item-1"],
    });
    expect(item.title).toBe("Custom");
    expect(item.tool).toBe("write_file");
    expect(item.estimatedImpact).toBe("high");
    expect(item.params).toEqual({ path: "/tmp/test" });
    expect(item.dependencies).toEqual(["item-1"]);
  });

  it("generates unique IDs", () => {
    const a = new PlanItem();
    const b = new PlanItem();
    expect(a.id).not.toBe(b.id);
  });
});

// ── ExecutionPlan ──

describe("ExecutionPlan", () => {
  it("creates with defaults", () => {
    const plan = new ExecutionPlan();
    expect(plan.id).toBeDefined();
    expect(plan.title).toBe("Untitled Plan");
    expect(plan.items).toEqual([]);
    expect(plan.status).toBe(PlanState.ANALYZING);
    expect(plan.createdAt).toBeDefined();
  });

  it("creates with custom data", () => {
    const plan = new ExecutionPlan({
      title: "My Plan",
      description: "A test plan",
      goal: "Test goal",
    });
    expect(plan.title).toBe("My Plan");
    expect(plan.description).toBe("A test plan");
    expect(plan.goal).toBe("Test goal");
  });

  it("adds items", () => {
    const plan = new ExecutionPlan();
    const item = plan.addItem({ title: "Step 1" });
    expect(plan.items.length).toBe(1);
    expect(item).toBeInstanceOf(PlanItem);
    expect(item.order).toBe(0);
  });

  it("removes items and re-orders", () => {
    const plan = new ExecutionPlan();
    plan.addItem({ title: "Step 1" });
    const item2 = plan.addItem({ title: "Step 2" });
    plan.addItem({ title: "Step 3" });

    plan.removeItem(item2.id);
    expect(plan.items.length).toBe(2);
    expect(plan.items[0].order).toBe(0);
    expect(plan.items[1].order).toBe(1);
  });

  it("gets item by id", () => {
    const plan = new ExecutionPlan();
    const item = plan.addItem({ title: "Step 1" });
    expect(plan.getItem(item.id)).toBe(item);
    expect(plan.getItem("nonexistent")).toBeUndefined();
  });

  it("initializes items from constructor data", () => {
    const plan = new ExecutionPlan({
      items: [{ title: "Step 1" }, { title: "Step 2" }],
    });
    expect(plan.items.length).toBe(2);
    expect(plan.items[0]).toBeInstanceOf(PlanItem);
  });
});
