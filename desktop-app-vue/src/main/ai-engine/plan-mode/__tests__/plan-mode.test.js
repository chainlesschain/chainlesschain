/**
 * Plan Mode Unit Tests
 *
 * @jest-environment node
 */

const {
  PlanModeManager,
  PlanModeState,
  ToolCategory,
  PlanItem,
  ExecutionPlan,
  TOOL_PERMISSIONS,
  ALLOWED_IN_PLAN_MODE,
} = require('../index');

describe('PlanItem', () => {
  it('should create a plan item with defaults', () => {
    const item = new PlanItem({
      title: 'Test Item',
      description: 'Test description',
    });

    expect(item.title).toBe('Test Item');
    expect(item.description).toBe('Test description');
    expect(item.status).toBe('pending');
    expect(item.order).toBe(0);
    expect(item.id).toMatch(/^step_/);
  });

  it('should create a plan item with tool', () => {
    const item = new PlanItem({
      title: 'File Operation',
      tool: 'file_writer',
      params: { path: '/test/file.txt', content: 'test' },
      estimatedImpact: 'medium',
    });

    expect(item.tool).toBe('file_writer');
    expect(item.params.path).toBe('/test/file.txt');
    expect(item.estimatedImpact).toBe('medium');
  });

  it('should convert to JSON', () => {
    const item = new PlanItem({
      title: 'Test',
      tool: 'Read',
    });

    const json = item.toJSON();

    expect(json.title).toBe('Test');
    expect(json.tool).toBe('Read');
    expect(json.createdAt).toBeDefined();
    expect(json.updatedAt).toBeDefined();
  });
});

describe('ExecutionPlan', () => {
  let plan;

  beforeEach(() => {
    plan = new ExecutionPlan({
      title: 'Test Plan',
      goal: 'Test the plan functionality',
    });
  });

  it('should create a plan with defaults', () => {
    expect(plan.title).toBe('Test Plan');
    expect(plan.goal).toBe('Test the plan functionality');
    expect(plan.status).toBe(PlanModeState.ANALYZING);
    expect(plan.items).toHaveLength(0);
    expect(plan.id).toMatch(/^plan_/);
  });

  it('should add items', () => {
    plan.addItem({ title: 'Step 1' });
    plan.addItem({ title: 'Step 2' });

    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].order).toBe(0);
    expect(plan.items[1].order).toBe(1);
  });

  it('should remove items and reorder', () => {
    plan.addItem({ title: 'Step 1' });
    const item2 = plan.addItem({ title: 'Step 2' });
    plan.addItem({ title: 'Step 3' });

    plan.removeItem(item2.id);

    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].title).toBe('Step 1');
    expect(plan.items[0].order).toBe(0);
    expect(plan.items[1].title).toBe('Step 3');
    expect(plan.items[1].order).toBe(1);
  });

  it('should get item by id', () => {
    const item = plan.addItem({ title: 'Test Item' });
    const found = plan.getItem(item.id);

    expect(found).toBe(item);
  });

  it('should approve plan', () => {
    plan.addItem({ title: 'Step 1' });
    plan.approve('admin');

    expect(plan.status).toBe(PlanModeState.APPROVED);
    expect(plan.approvedBy).toBe('admin');
    expect(plan.approvedAt).toBeDefined();
    expect(plan.items[0].status).toBe('approved');
  });

  it('should reject plan', () => {
    plan.reject('Invalid approach');

    expect(plan.status).toBe(PlanModeState.REJECTED);
    expect(plan.metadata.rejectionReason).toBe('Invalid approach');
  });

  it('should convert to JSON', () => {
    plan.addItem({ title: 'Step 1' });
    const json = plan.toJSON();

    expect(json.id).toBe(plan.id);
    expect(json.title).toBe('Test Plan');
    expect(json.items).toHaveLength(1);
  });
});

describe('PlanModeManager', () => {
  let manager;

  beforeEach(() => {
    manager = new PlanModeManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('mode control', () => {
    it('should enter plan mode', () => {
      const plan = manager.enterPlanMode({
        title: 'My Plan',
        goal: 'Test goal',
      });

      expect(manager.isActive()).toBe(true);
      expect(manager.getState()).toBe(PlanModeState.ANALYZING);
      expect(plan.title).toBe('My Plan');
    });

    it('should not enter plan mode twice', () => {
      manager.enterPlanMode({ title: 'First' });
      const second = manager.enterPlanMode({ title: 'Second' });

      expect(second.title).toBe('First');
    });

    it('should exit plan mode', () => {
      manager.enterPlanMode({ title: 'Test' });
      const result = manager.exitPlanMode();

      expect(result.success).toBe(true);
      expect(manager.isActive()).toBe(false);
      expect(manager.getState()).toBe(PlanModeState.INACTIVE);
    });

    it('should save plan to history on exit', () => {
      manager.enterPlanMode({ title: 'Historical Plan' });
      manager.addPlanItem({ title: 'Step 1' });
      manager.exitPlanMode();

      const history = manager.getPlansHistory();
      expect(history).toHaveLength(1);
      expect(history[0].title).toBe('Historical Plan');
    });
  });

  describe('plan management', () => {
    beforeEach(() => {
      manager.enterPlanMode({ title: 'Test Plan' });
    });

    it('should add plan items', () => {
      const item = manager.addPlanItem({
        title: 'Test Step',
        tool: 'Read',
      });

      expect(item).not.toBeNull();
      expect(item.title).toBe('Test Step');
      expect(manager.getCurrentPlan().items).toHaveLength(1);
    });

    it('should remove plan items', () => {
      const item = manager.addPlanItem({ title: 'To Remove' });
      const removed = manager.removePlanItem(item.id);

      expect(removed).toBe(true);
      expect(manager.getCurrentPlan().items).toHaveLength(0);
    });

    it('should not add items when not in plan mode', () => {
      manager.exitPlanMode();
      const item = manager.addPlanItem({ title: 'Test' });

      expect(item).toBeNull();
    });

    it('should mark plan ready', () => {
      manager.addPlanItem({ title: 'Step 1' });
      const result = manager.markPlanReady();

      expect(result.success).toBe(true);
      expect(manager.getState()).toBe(PlanModeState.PLAN_READY);
    });

    it('should not mark empty plan as ready', () => {
      const result = manager.markPlanReady();

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Plan has no items');
    });
  });

  describe('approval workflow', () => {
    beforeEach(() => {
      manager.enterPlanMode({ title: 'Approval Test' });
      manager.addPlanItem({ title: 'Step 1' });
      manager.addPlanItem({ title: 'Step 2' });
      manager.markPlanReady();
    });

    it('should approve plan', () => {
      const result = manager.approvePlan({ approvedBy: 'admin' });

      expect(result.success).toBe(true);
      expect(manager.getState()).toBe(PlanModeState.APPROVED);
      expect(result.plan.approvedBy).toBe('admin');
    });

    it('should reject plan', () => {
      const result = manager.rejectPlan({ reason: 'Not acceptable' });

      expect(result.success).toBe(true);
      expect(manager.isActive()).toBe(false);
    });

    it('should not approve when not ready', () => {
      manager.exitPlanMode();
      manager.enterPlanMode({ title: 'New Plan' });
      manager.addPlanItem({ title: 'Step' });
      // Don't mark ready

      const result = manager.approvePlan();
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Plan is not ready for approval');
    });

    it('should support partial approval', () => {
      const items = manager.getCurrentPlan().items;
      const result = manager.approvePlan({
        itemIds: [items[0].id], // Only approve first item
      });

      expect(result.success).toBe(true);
      expect(items[0].status).toBe('approved');
      expect(items[1].status).toBe('rejected');
    });
  });

  describe('tool permissions', () => {
    it('should classify read tools correctly', () => {
      expect(manager.getToolCategory('Read')).toBe(ToolCategory.READ);
      expect(manager.getToolCategory('file_reader')).toBe(ToolCategory.READ);
      expect(manager.getToolCategory('WebFetch')).toBe(ToolCategory.READ);
    });

    it('should classify search tools correctly', () => {
      expect(manager.getToolCategory('Glob')).toBe(ToolCategory.SEARCH);
      expect(manager.getToolCategory('Grep')).toBe(ToolCategory.SEARCH);
      expect(manager.getToolCategory('WebSearch')).toBe(ToolCategory.SEARCH);
    });

    it('should classify write tools correctly', () => {
      expect(manager.getToolCategory('Write')).toBe(ToolCategory.WRITE);
      expect(manager.getToolCategory('Edit')).toBe(ToolCategory.WRITE);
      expect(manager.getToolCategory('file_writer')).toBe(ToolCategory.WRITE);
    });

    it('should classify execute tools correctly', () => {
      expect(manager.getToolCategory('Bash')).toBe(ToolCategory.EXECUTE);
      expect(manager.getToolCategory('execute_command')).toBe(ToolCategory.EXECUTE);
    });

    it('should classify delete tools correctly', () => {
      expect(manager.getToolCategory('delete_file')).toBe(ToolCategory.DELETE);
    });

    it('should allow read tools in plan mode', () => {
      expect(manager.isToolAllowedInPlanMode('Read')).toBe(true);
      expect(manager.isToolAllowedInPlanMode('Glob')).toBe(true);
      expect(manager.isToolAllowedInPlanMode('Grep')).toBe(true);
    });

    it('should block write tools in plan mode', () => {
      expect(manager.isToolAllowedInPlanMode('Write')).toBe(false);
      expect(manager.isToolAllowedInPlanMode('Edit')).toBe(false);
    });

    it('should block execute tools in plan mode', () => {
      expect(manager.isToolAllowedInPlanMode('Bash')).toBe(false);
      expect(manager.isToolAllowedInPlanMode('execute_command')).toBe(false);
    });

    it('should block delete tools in plan mode', () => {
      expect(manager.isToolAllowedInPlanMode('delete_file')).toBe(false);
    });

    it('should default unknown tools to execute category', () => {
      expect(manager.getToolCategory('unknown_tool')).toBe(ToolCategory.EXECUTE);
      expect(manager.isToolAllowedInPlanMode('unknown_tool')).toBe(false);
    });
  });

  describe('events', () => {
    it('should emit enter event', async () => {
      const eventPromise = new Promise((resolve) => {
        manager.on('enter', (data) => {
          resolve(data);
        });
      });

      manager.enterPlanMode({ title: 'Event Test' });

      const data = await eventPromise;
      expect(data.plan).toBeDefined();
      expect(data.state).toBe(PlanModeState.ANALYZING);
    });

    it('should emit exit event', async () => {
      manager.enterPlanMode({ title: 'Exit Test' });

      const eventPromise = new Promise((resolve) => {
        manager.on('exit', (data) => {
          resolve(data);
        });
      });

      manager.exitPlanMode();

      const data = await eventPromise;
      expect(data.plan).toBeDefined();
    });

    it('should emit item-added event', async () => {
      manager.enterPlanMode({ title: 'Item Test' });

      const eventPromise = new Promise((resolve) => {
        manager.on('item-added', (data) => {
          resolve(data);
        });
      });

      manager.addPlanItem({ title: 'New Item' });

      const data = await eventPromise;
      expect(data.item.title).toBe('New Item');
    });

    it('should emit plan-ready event', async () => {
      manager.enterPlanMode({ title: 'Ready Test' });
      manager.addPlanItem({ title: 'Step' });

      const eventPromise = new Promise((resolve) => {
        manager.on('plan-ready', (data) => {
          resolve(data);
        });
      });

      manager.markPlanReady();

      const data = await eventPromise;
      expect(data.plan.status).toBe(PlanModeState.PLAN_READY);
    });

    it('should emit plan-approved event', async () => {
      manager.enterPlanMode({ title: 'Approve Test' });
      manager.addPlanItem({ title: 'Step' });
      manager.markPlanReady();

      const eventPromise = new Promise((resolve) => {
        manager.on('plan-approved', (data) => {
          resolve(data);
        });
      });

      manager.approvePlan({ approvedBy: 'user' });

      const data = await eventPromise;
      expect(data.approvedBy).toBe('user');
    });
  });

  describe('statistics', () => {
    it('should track plans created', () => {
      manager.enterPlanMode({ title: 'Plan 1' });
      manager.exitPlanMode();
      manager.enterPlanMode({ title: 'Plan 2' });

      const stats = manager.getStats();
      expect(stats.plansCreated).toBe(2);
    });

    it('should track approved plans', () => {
      manager.enterPlanMode({ title: 'Test' });
      manager.addPlanItem({ title: 'Step' });
      manager.markPlanReady();
      manager.approvePlan();

      const stats = manager.getStats();
      expect(stats.plansApproved).toBe(1);
    });

    it('should track rejected plans', () => {
      manager.enterPlanMode({ title: 'Test' });
      manager.addPlanItem({ title: 'Step' });
      manager.markPlanReady();
      manager.rejectPlan({ reason: 'Test' });

      const stats = manager.getStats();
      expect(stats.plansRejected).toBe(1);
    });
  });

  describe('plan summary', () => {
    it('should generate summary for active plan', () => {
      manager.enterPlanMode({
        title: 'Summary Test',
        goal: 'Test summary generation',
      });
      manager.addPlanItem({ title: 'Step 1', tool: 'Read' });
      manager.addPlanItem({ title: 'Step 2', tool: 'Grep' });

      const summary = manager.generatePlanSummary();

      expect(summary).toContain('# Plan: Summary Test');
      expect(summary).toContain('Goal: Test summary generation');
      expect(summary).toContain('Step 1');
      expect(summary).toContain('Step 2');
      expect(summary).toContain('Tool: Read');
    });

    it('should return message when no active plan', () => {
      const summary = manager.generatePlanSummary();
      expect(summary).toBe('No active plan.');
    });
  });

  describe('history', () => {
    it('should maintain plans history', () => {
      for (let i = 0; i < 3; i++) {
        manager.enterPlanMode({ title: `Plan ${i}` });
        manager.addPlanItem({ title: `Step ${i}` });
        manager.exitPlanMode();
      }

      const history = manager.getPlansHistory();
      expect(history).toHaveLength(3);
      // Most recent first
      expect(history[0].title).toBe('Plan 2');
    });

    it('should limit history size', () => {
      const manager2 = new PlanModeManager({ maxPlansHistory: 2 });

      for (let i = 0; i < 5; i++) {
        manager2.enterPlanMode({ title: `Plan ${i}` });
        manager2.exitPlanMode();
      }

      const history = manager2.getPlansHistory();
      expect(history).toHaveLength(2);

      manager2.destroy();
    });

    it('should get plan by id', () => {
      manager.enterPlanMode({ title: 'Find Me' });
      const plan = manager.getCurrentPlan();
      const planId = plan.id;
      manager.exitPlanMode();

      const found = manager.getPlan(planId);
      expect(found).not.toBeNull();
      expect(found.title).toBe('Find Me');
    });
  });
});

describe('Constants', () => {
  it('should have correct tool permissions', () => {
    expect(TOOL_PERMISSIONS.Read).toBe(ToolCategory.READ);
    expect(TOOL_PERMISSIONS.Write).toBe(ToolCategory.WRITE);
    expect(TOOL_PERMISSIONS.Bash).toBe(ToolCategory.EXECUTE);
    expect(TOOL_PERMISSIONS.delete_file).toBe(ToolCategory.DELETE);
  });

  it('should have correct allowed categories', () => {
    expect(ALLOWED_IN_PLAN_MODE.has(ToolCategory.READ)).toBe(true);
    expect(ALLOWED_IN_PLAN_MODE.has(ToolCategory.SEARCH)).toBe(true);
    expect(ALLOWED_IN_PLAN_MODE.has(ToolCategory.ANALYZE)).toBe(true);
    expect(ALLOWED_IN_PLAN_MODE.has(ToolCategory.WRITE)).toBe(false);
    expect(ALLOWED_IN_PLAN_MODE.has(ToolCategory.EXECUTE)).toBe(false);
    expect(ALLOWED_IN_PLAN_MODE.has(ToolCategory.DELETE)).toBe(false);
  });
});
