import { describe, it, expect, vi } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  TransactionManager,
  TransactionStatus,
  StepStatus,
  createTransaction,
} = require("../transaction-manager.js");

describe("TransactionManager", () => {
  it("runs steps, returns results, and tracks status", async () => {
    const tx = createTransaction("t1");
    expect(tx.status).toBe(TransactionStatus.IDLE);

    const id = await tx.step("gen", () => "id-1", null);
    expect(id).toBe("id-1");
    expect(tx.status).toBe(TransactionStatus.RUNNING);

    await tx.step("create", () => "made", null);
    expect(tx.getStepResult("gen")).toBe("id-1");
    expect(tx.getLastResult()).toBe("made");

    await tx.commit();
    expect(tx.status).toBe(TransactionStatus.COMMITTED);
  });

  it("rolls back completed steps in reverse order on failure", async () => {
    const order = [];
    const tx = createTransaction("t2");
    await tx.step(
      "a",
      () => "A",
      () => order.push("rb-a"),
    );
    await tx.step(
      "b",
      () => "B",
      () => order.push("rb-b"),
    );
    await tx.rollback();
    expect(order).toEqual(["rb-b", "rb-a"]); // reverse order
    expect(tx.status).toBe(TransactionStatus.ROLLED_BACK);
  });

  it("does NOT roll back a committed transaction (regression)", async () => {
    const rb = vi.fn();
    const tx = createTransaction("t3");
    await tx.step("a", () => "A", rb);
    await tx.commit();

    await tx.rollback(); // defensive double-call must be a no-op

    expect(rb).not.toHaveBeenCalled(); // committed work was NOT undone
    expect(tx.status).toBe(TransactionStatus.COMMITTED); // status unchanged
  });

  it("rollback is idempotent (second call is a no-op)", async () => {
    const rb = vi.fn();
    const tx = createTransaction("t4");
    await tx.step("a", () => "A", rb);
    await tx.rollback();
    await tx.rollback();
    expect(rb).toHaveBeenCalledTimes(1);
  });

  it("skips rollback for steps with no rollback fn or that never completed", async () => {
    const rbA = vi.fn();
    const tx = createTransaction("t5");
    await tx.step("a", () => "A", rbA); // completed, has rollback
    await tx.step("b", () => "B", null); // completed, no rollback
    await expect(
      tx.step("c", () => {
        throw new Error("boom");
      }, vi.fn()),
    ).rejects.toThrow("boom"); // failed step — its rollback must not run
    await tx.rollback();
    expect(rbA).toHaveBeenCalledTimes(1);
  });

  it("aggregates rollback errors and throws", async () => {
    const tx = createTransaction("t6");
    await tx.step("a", () => "A", () => {
      throw new Error("rb-failed");
    });
    await expect(tx.rollback()).rejects.toThrow(/回滚部分失败/);
    expect(tx.status).toBe(TransactionStatus.ROLLED_BACK);
  });

  it("rejects new steps after commit or rollback", async () => {
    const tx = createTransaction("t7");
    await tx.step("a", () => "A", null);
    await tx.commit();
    await expect(tx.step("b", () => "B", null)).rejects.toThrow(/已提交/);

    const tx2 = createTransaction("t8");
    await tx2.step("a", () => "A", () => {});
    await tx2.rollback();
    await expect(tx2.step("b", () => "B", null)).rejects.toThrow(/已回滚/);
  });

  it("commit only valid from RUNNING", async () => {
    const tx = createTransaction("t9");
    await expect(tx.commit()).rejects.toThrow(/当前状态/); // IDLE → cannot commit
  });

  it("propagates step executor errors and records FAILED status", async () => {
    const tx = createTransaction("t10");
    await expect(
      tx.step("a", async () => {
        throw new Error("exec-fail");
      }, null),
    ).rejects.toThrow("exec-fail");
    expect(tx.steps[0].status).toBe(StepStatus.FAILED);
    expect(tx.getInfo().error).toBe("exec-fail");
  });
});
