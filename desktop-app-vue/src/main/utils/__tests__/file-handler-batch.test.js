/**
 * FileHandler.processBatch 并发批处理正确性测试。
 *
 * 回归点：早先 Promise.race 解析的是「已完成任务的返回值」而非 promise 本身，
 * 导致 findIndex(p === value) 恒为 -1、splice(-1, 1) 误删队尾（往往仍在运行的）
 * 任务，使 processBatch 在任务尚未全部完成时提前返回、结果不完整。
 */

const { FileHandler } = require("../file-handler.js");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

describe("FileHandler.processBatch", () => {
  test("所有文件都被处理（早完成任务不会顶掉仍在运行的任务）", async () => {
    const handler = new FileHandler();
    // 交替的快/慢延时：偶数项 5ms 先完成，奇数项 40ms 仍在运行。并发=2 时，
    // 队首(快)先完成而队尾(慢)仍在飞，正是旧 splice(-1) 误删的场景。
    const files = [
      { id: 0, ms: 5 },
      { id: 1, ms: 40 },
      { id: 2, ms: 5 },
      { id: 3, ms: 40 },
    ];

    const seen = [];
    const result = await handler.processBatch(
      files,
      async (file) => {
        await delay(file.ms);
        seen.push(file.id);
        return file.id;
      },
      { concurrency: 2 },
    );

    expect(result.total).toBe(4);
    expect(result.succeeded).toBe(4); // 旧实现这里会 < 4（提前返回）
    expect(result.failed).toBe(0);
    expect(result.success).toBe(true);
    expect([...result.results].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  test("处理器抛错的文件归入 errors，其余仍成功", async () => {
    const handler = new FileHandler();
    const files = ["a", "boom", "c", "d"];

    const result = await handler.processBatch(
      files,
      async (file) => {
        await delay(file === "boom" ? 30 : 3);
        if (file === "boom") {
          throw new Error("processor failed");
        }
        return file.toUpperCase();
      },
      { concurrency: 2 },
    );

    expect(result.total).toBe(4);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.success).toBe(false);
    expect([...result.results].sort()).toEqual(["A", "C", "D"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("boom");
    expect(result.errors[0].error).toBeInstanceOf(Error);
  });

  test("空输入返回空结果且 success=true", async () => {
    const handler = new FileHandler();
    const result = await handler.processBatch([], async () => 1, {
      concurrency: 2,
    });
    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });

  test("并发数=1 时按序串行处理全部文件", async () => {
    const handler = new FileHandler();
    const order = [];
    const result = await handler.processBatch(
      [1, 2, 3],
      async (n) => {
        await delay(n === 1 ? 20 : 2);
        order.push(n);
        return n * 10;
      },
      { concurrency: 1 },
    );
    expect(result.succeeded).toBe(3);
    expect(order).toEqual([1, 2, 3]); // 串行：即使 1 最慢也先完成
    expect(result.results).toEqual([10, 20, 30]);
  });
});
