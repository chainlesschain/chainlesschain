/**
 * transaction-manager 单元测试 —— 多步骤 saga：执行/提交/逆序回滚、
 * 部分回滚失败聚合、失败步骤跳过、幂等回滚、状态守卫、信息查询。
 */

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  TransactionManager,
  TransactionStatus,
  StepStatus,
  createTransaction,
} = require("../transaction-manager.js");

describe("TransactionManager.step / commit", () => {
  it("runs a step, returns its result, and tracks status", async () => {
    const tx = new TransactionManager("t");
    expect(tx.status).toBe(TransactionStatus.IDLE);
    const r = await tx.step("gen", async () => 42);
    expect(r).toBe(42);
    expect(tx.status).toBe(TransactionStatus.RUNNING);
    expect(tx.getLastResult()).toBe(42);
    expect(tx.getStepResult("gen")).toBe(42);
  });

  it("commits and refuses further steps", async () => {
    const tx = createTransaction("t");
    await tx.step("a", async () => 1);
    await tx.commit();
    expect(tx.status).toBe(TransactionStatus.COMMITTED);
    await expect(tx.step("b", async () => 2)).rejects.toThrow(/已提交/);
  });

  it("commit from a non-running state throws", async () => {
    const tx = new TransactionManager("t");
    await expect(tx.commit()).rejects.toThrow(/无法提交事务/);
  });

  it("emits step lifecycle events", async () => {
    const tx = new TransactionManager("t");
    const events = [];
    tx.on("step-start", () => events.push("start"));
    tx.on("step-complete", () => events.push("complete"));
    tx.on("step-error", () => events.push("error"));
    await tx.step("ok", async () => 1);
    await expect(
      tx.step("bad", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(events).toEqual(["start", "complete", "start", "error"]);
  });
});

describe("TransactionManager.rollback", () => {
  it("rolls back completed steps in reverse order, skipping those without a rollback fn", async () => {
    const tx = new TransactionManager("t");
    const order = [];
    await tx.step("one", async () => 1, async () => order.push("undo-one"));
    await tx.step("two", async () => 2, null); // no rollback fn
    await tx.step("three", async () => 3, async () => order.push("undo-three"));
    await tx.rollback();
    expect(tx.status).toBe(TransactionStatus.ROLLED_BACK);
    // reverse of completed-with-rollback: three then one (two skipped)
    expect(order).toEqual(["undo-three", "undo-one"]);
  });

  it("does not roll back a failed step's executor", async () => {
    const tx = new TransactionManager("t");
    const undo = vi.fn();
    await tx.step("ok", async () => 1, undo);
    await expect(
      tx.step(
        "fails",
        async () => {
          throw new Error("boom");
        },
        vi.fn(), // rollback that must NOT run (step never completed)
      ),
    ).rejects.toThrow("boom");
    const failedUndo = tx.steps[1].rollback;
    await tx.rollback();
    expect(undo).toHaveBeenCalledTimes(1); // completed step rolled back
    expect(failedUndo).not.toHaveBeenCalled(); // failed step skipped
    expect(tx.error.message).toBe("boom");
  });

  it("aggregates rollback failures, still runs the rest, and throws", async () => {
    const tx = new TransactionManager("t");
    const undoA = vi.fn();
    await tx.step("a", async () => 1, undoA);
    await tx.step("b", async () => 2, async () => {
      throw new Error("rollback-b-failed");
    });
    const errors = [];
    tx.on("step-rollback-error", (e) => errors.push(e.name));
    let completePayload = null;
    tx.on("rollback-complete", (p) => (completePayload = p));

    await expect(tx.rollback()).rejects.toThrow(/事务回滚部分失败/);
    // b (reverse-first) fails, a still rolled back
    expect(errors).toEqual(["b"]);
    expect(undoA).toHaveBeenCalledTimes(1);
    expect(tx.status).toBe(TransactionStatus.ROLLED_BACK);
    expect(completePayload).toMatchObject({ success: false });
  });

  it("is idempotent: a second rollback is a no-op", async () => {
    const tx = new TransactionManager("t");
    const undo = vi.fn();
    await tx.step("a", async () => 1, undo);
    await tx.rollback();
    await tx.rollback(); // should warn + return, not undo again
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("refuses new steps after rollback", async () => {
    const tx = new TransactionManager("t");
    await tx.step("a", async () => 1);
    await tx.rollback();
    await expect(tx.step("b", async () => 2)).rejects.toThrow(/已回滚/);
  });
});

describe("TransactionManager.getInfo / accessors", () => {
  it("reports step counts and per-step info", async () => {
    const tx = new TransactionManager("t");
    await tx.step("a", async () => 1);
    await expect(
      tx.step("b", async () => {
        throw new Error("e");
      }),
    ).rejects.toThrow("e");
    const info = tx.getInfo();
    expect(info.stepCount).toBe(2);
    expect(info.completedSteps).toBe(1);
    expect(info.steps.map((s) => s.status)).toEqual([
      StepStatus.COMPLETED,
      StepStatus.FAILED,
    ]);
    expect(info.error).toBe("e");
  });

  it("returns null for unknown / empty step results", () => {
    const tx = new TransactionManager("t");
    expect(tx.getLastResult()).toBeNull();
    expect(tx.getStepResult("nope")).toBeNull();
  });
});
