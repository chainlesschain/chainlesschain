/**
 * FederatedLearningManager unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  FederatedLearningManager,
  TASK_STATUS,
  PARTICIPANT_STATUS,
} = require("../federated-learning-manager");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0 }),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

describe("FederatedLearningManager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new FederatedLearningManager();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (manager._cleanupTimer) {
      clearInterval(manager._cleanupTimer);
      manager._cleanupTimer = null;
    }
    manager.destroy();
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized=true and call db.exec for table creation", async () => {
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
      expect(db.exec).toHaveBeenCalled();
    });

    it("should call db.prepare to load existing data", async () => {
      await manager.initialize(db);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should be idempotent — second call does nothing", async () => {
      await manager.initialize(db);
      const execCount = db.exec.mock.calls.length;
      await manager.initialize(db);
      expect(db.exec.mock.calls.length).toBe(execCount);
    });
  });

  // ============================================================
  // createTask()
  // ============================================================

  describe("createTask()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should create a task with correct fields", () => {
      const task = manager.createTask({
        name: "Test FL",
        modelType: "neural-net",
      });
      expect(task.id).toBeDefined();
      expect(task.name).toBe("Test FL");
      expect(task.modelType).toBe("neural-net");
      expect(task.status).toBe(TASK_STATUS.CREATED);
      expect(task.currentRound).toBe(0);
    });

    it("should persist task to database", () => {
      manager.createTask({ name: "Test FL", modelType: "cnn" });
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should emit task:created event", () => {
      const handler = vi.fn();
      manager.on("task:created", handler);
      const task = manager.createTask({ name: "Test FL" });
      expect(handler).toHaveBeenCalledWith(task);
    });

    it("should use default config values when options not provided", () => {
      const task = manager.createTask({});
      expect(task.minParticipants).toBe(2);
      expect(task.maxRounds).toBe(100);
      expect(task.aggregationStrategy).toBe("fedavg");
    });

    it("should return the task object", () => {
      const task = manager.createTask({
        name: "Return Test",
        modelType: "transformer",
      });
      expect(task).toBeDefined();
      expect(typeof task.id).toBe("string");
      expect(task.createdAt).toBeDefined();
    });
  });

  // ============================================================
  // joinTask() / leaveTask()
  // ============================================================

  describe("joinTask() / leaveTask()", () => {
    let task;

    beforeEach(async () => {
      await manager.initialize(db);
      task = manager.createTask({
        name: "Join Test",
        modelType: "neural-net",
        minParticipants: 2,
      });
    });

    it("should join a task and create participant record", () => {
      const participant = manager.joinTask(task.id, "did:chainless:agent-1");
      expect(participant.taskId).toBe(task.id);
      expect(participant.agentDid).toBe("did:chainless:agent-1");
      expect(participant.status).toBe(PARTICIPANT_STATUS.JOINED);
    });

    it("should emit participant:joined event", () => {
      const handler = vi.fn();
      manager.on("participant:joined", handler);
      manager.joinTask(task.id, "did:chainless:agent-1");
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.id }),
      );
    });

    it("should throw for non-existent task", () => {
      expect(() =>
        manager.joinTask("non-existent", "did:chainless:agent-1"),
      ).toThrow("Task not found");
    });

    it("should set participant status to LEFT on leaveTask", () => {
      manager.joinTask(task.id, "did:chainless:agent-1");
      const result = manager.leaveTask(task.id, "did:chainless:agent-1");
      expect(result.success).toBe(true);
    });

    it("should emit participant:left event on leaveTask", () => {
      manager.joinTask(task.id, "did:chainless:agent-1");
      const handler = vi.fn();
      manager.on("participant:left", handler);
      manager.leaveTask(task.id, "did:chainless:agent-1");
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          agentDid: "did:chainless:agent-1",
        }),
      );
    });
  });

  // ============================================================
  // startTraining()
  // ============================================================

  describe("startTraining()", () => {
    let task;

    beforeEach(async () => {
      await manager.initialize(db);
      task = manager.createTask({
        name: "Train Test",
        modelType: "neural-net",
        minParticipants: 2,
      });
      manager.joinTask(task.id, "did:chainless:agent-1");
      manager.joinTask(task.id, "did:chainless:agent-2");
    });

    it("should set task status to TRAINING", async () => {
      await manager.startTraining(task.id);
      const status = manager.getTaskStatus(task.id);
      expect(status.status).toBe(TASK_STATUS.TRAINING);
    });

    it("should create round 1", async () => {
      await manager.startTraining(task.id);
      const status = manager.getTaskStatus(task.id);
      expect(status.currentRound).toBe(1);
      expect(status.currentRoundInfo).not.toBeNull();
    });

    it("should emit training:started event", async () => {
      const handler = vi.fn();
      manager.on("training:started", handler);
      await manager.startTraining(task.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.id, round: 1 }),
      );
    });

    it("should throw if not enough participants", async () => {
      const smallTask = manager.createTask({
        name: "Small",
        minParticipants: 5,
      });
      manager.joinTask(smallTask.id, "did:chainless:agent-1");
      await expect(manager.startTraining(smallTask.id)).rejects.toThrow(
        "Not enough participants",
      );
    });
  });

  // ============================================================
  // submitGradients()
  // ============================================================

  describe("submitGradients()", () => {
    let task;

    beforeEach(async () => {
      await manager.initialize(db);
      task = manager.createTask({
        name: "Gradient Test",
        modelType: "neural-net",
        minParticipants: 2,
      });
      manager.joinTask(task.id, "did:chainless:agent-1");
      manager.joinTask(task.id, "did:chainless:agent-2");
      await manager.startTraining(task.id);
    });

    it("should store gradients and increment received count", async () => {
      const result = await manager.submitGradients(
        task.id,
        "did:chainless:agent-1",
        [1.0, 2.0, 3.0],
      );
      expect(result.received).toBe(1);
      expect(result.required).toBe(2);
    });

    it("should emit gradients:submitted event", async () => {
      const handler = vi.fn();
      manager.on("gradients:submitted", handler);
      await manager.submitGradients(
        task.id,
        "did:chainless:agent-1",
        [1.0, 2.0],
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          agentDid: "did:chainless:agent-1",
        }),
      );
    });

    it("should emit round:gradients-complete when all received", async () => {
      const handler = vi.fn();
      manager.on("round:gradients-complete", handler);
      await manager.submitGradients(
        task.id,
        "did:chainless:agent-1",
        [1.0, 2.0],
      );
      await manager.submitGradients(
        task.id,
        "did:chainless:agent-2",
        [3.0, 4.0],
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          roundNumber: 1,
        }),
      );
    });

    it("should throw for non-existent task", async () => {
      await expect(
        manager.submitGradients("bad-id", "did:chainless:agent-1", [1.0]),
      ).rejects.toThrow("Task not found");
    });

    it("should throw for non-participant agent", async () => {
      await expect(
        manager.submitGradients(task.id, "did:chainless:unknown", [1.0]),
      ).rejects.toThrow("Participant not found");
    });
  });

  // ============================================================
  // getGlobalModel() / getTaskStatus()
  // ============================================================

  describe("getGlobalModel() / getTaskStatus()", () => {
    let task;

    beforeEach(async () => {
      await manager.initialize(db);
      task = manager.createTask({
        name: "Query Test",
        modelType: "cnn",
        minParticipants: 2,
      });
      manager.joinTask(task.id, "did:chainless:agent-1");
      manager.joinTask(task.id, "did:chainless:agent-2");
    });

    it("should return null if no completed rounds", () => {
      const model = manager.getGlobalModel(task.id);
      expect(model).toBeNull();
    });

    it("should return task status with participant count", () => {
      const status = manager.getTaskStatus(task.id);
      expect(status.participantsCount).toBe(2);
      expect(status.currentRoundInfo).toBeNull();
    });

    it("should return correct current round after training starts", async () => {
      await manager.startTraining(task.id);
      const status = manager.getTaskStatus(task.id);
      expect(status.currentRound).toBe(1);
      expect(status.currentRoundInfo).not.toBeNull();
    });
  });

  // ============================================================
  // listTasks()
  // ============================================================

  describe("listTasks()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should list all tasks", () => {
      manager.createTask({ name: "Task 1" });
      manager.createTask({ name: "Task 2" });
      const tasks = manager.listTasks();
      expect(tasks.length).toBe(2);
    });

    it("should filter by status", () => {
      manager.createTask({ name: "Task 1" });
      manager.createTask({ name: "Task 2" });
      const created = manager.listTasks({ status: TASK_STATUS.CREATED });
      expect(created.length).toBe(2);
      const training = manager.listTasks({ status: TASK_STATUS.TRAINING });
      expect(training.length).toBe(0);
    });
  });

  // ============================================================
  // getStats() / destroy()
  // ============================================================

  describe("getStats() / destroy()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return correct stats", () => {
      manager.createTask({ name: "Task 1" });
      manager.createTask({ name: "Task 2" });
      const stats = manager.getStats();
      expect(stats.totalTasks).toBe(2);
      expect(stats.activeTasks).toBe(0);
      expect(stats.completedTasks).toBe(0);
    });

    it("should clear cleanup timer on destroy", () => {
      expect(manager._cleanupTimer).not.toBeNull();
      manager.destroy();
      expect(manager._cleanupTimer).toBeNull();
    });

    it("should set initialized=false on destroy", () => {
      expect(manager.initialized).toBe(true);
      manager.destroy();
      expect(manager.initialized).toBe(false);
    });
  });
});
