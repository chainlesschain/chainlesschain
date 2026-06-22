/**
 * resumable-processor 单元测试 —— 检查点保存节奏（含不规则进度回归）、
 * 断点恢复、成功清理、重试后失败检查点、taskId 文件名净化。
 *
 * 全程 stub 掉 fs-backed 的 saveCheckpoint/loadCheckpoint/deleteCheckpoint，
 * 不触磁盘；只验证 processWithRetry 的控制流与检查点判定逻辑。
 */

const ResumableProcessor = require("../resumable-processor.js");

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// retryDelay:0 => 指数退避 delay 恒为 0，重试测试不挂时钟。
const makeProcessor = (config = {}) => {
  const p = new ResumableProcessor({ retryDelay: 0, ...config });
  p.saveCheckpoint = vi.fn().mockResolvedValue(true);
  p.loadCheckpoint = vi.fn().mockResolvedValue(null);
  p.deleteCheckpoint = vi.fn().mockResolvedValue(true);
  return p;
};

const savedProgresses = (p) =>
  p.saveCheckpoint.mock.calls.map(([, data]) => data.progress);

const emitProgress = (sequence) => async (_progress, { onProgress }) => {
  for (const value of sequence) {
    await onProgress(value);
  }
  return "done";
};

describe("ResumableProcessor.processWithRetry checkpoint cadence", () => {
  it("saves on irregular progress once advanced by >= interval (regression)", async () => {
    // Bug was: guard required newProgress % 10 === 0, so 7/14/23/38 saved
    // nothing until 100. Now it saves whenever progress advances >= 10.
    const p = makeProcessor({ checkpointInterval: 10 });
    await p.processWithRetry("t", emitProgress([7, 14, 23, 38, 100]), {
      resumeFromCheckpoint: false,
    });
    // 0->14 (>=10), 14->38 (>=10), then 100.  7 and 23 are skipped.
    expect(savedProgresses(p)).toEqual([14, 38, 100]);
  });

  it("still saves at exact deciles (no regression for clean progress)", async () => {
    const p = makeProcessor({ checkpointInterval: 10 });
    await p.processWithRetry("t", emitProgress([10, 20, 100]), {
      resumeFromCheckpoint: false,
    });
    expect(savedProgresses(p)).toEqual([10, 20, 100]);
  });

  it("honors a custom interval", async () => {
    const p = makeProcessor({ checkpointInterval: 25 });
    await p.processWithRetry("t", emitProgress([10, 26, 40, 60, 100]), {
      resumeFromCheckpoint: false,
    });
    // 0->26 (>=25), 26->60 (>=25 at 60, 40 is only +14), then 100.
    expect(savedProgresses(p)).toEqual([26, 60, 100]);
  });
});

describe("ResumableProcessor.processWithRetry resume", () => {
  it("starts from the checkpoint progress and re-baselines the interval", async () => {
    const p = makeProcessor({ checkpointInterval: 10 });
    p.loadCheckpoint = vi
      .fn()
      .mockResolvedValue({ progress: 30, timestamp: 1, data: { seen: true } });

    let startProgress = null;
    let checkpointData = null;
    await p.processWithRetry(
      "t",
      async (progress, { onProgress, checkpointData: cd }) => {
        startProgress = progress;
        checkpointData = cd;
        // resumed at 30: +5 (35) must NOT save, +11 (41) must save.
        await onProgress(35);
        await onProgress(41);
        await onProgress(100);
        return "ok";
      },
    );

    expect(startProgress).toBe(30);
    expect(checkpointData).toEqual({ seen: true });
    expect(savedProgresses(p)).toEqual([41, 100]);
  });
});

describe("ResumableProcessor.processWithRetry lifecycle", () => {
  it("on success deletes the checkpoint and clears the active task", async () => {
    const p = makeProcessor();
    const result = await p.processWithRetry("t", async () => "value", {
      resumeFromCheckpoint: false,
    });
    expect(result).toBe("value");
    expect(p.deleteCheckpoint).toHaveBeenCalledWith("t");
    expect(p.getActiveTasks()).toHaveLength(0);
  });

  it("retries then succeeds without throwing", async () => {
    const p = makeProcessor({ maxRetries: 2 });
    let attempts = 0;
    const result = await p.processWithRetry(
      "t",
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("transient");
        return "recovered";
      },
      { resumeFromCheckpoint: false },
    );
    expect(attempts).toBe(2);
    expect(result).toBe("recovered");
  });

  it("after exhausting retries saves a failure checkpoint and throws", async () => {
    const p = makeProcessor({ maxRetries: 1 });
    await expect(
      p.processWithRetry(
        "t",
        async () => {
          throw new Error("boom");
        },
        { resumeFromCheckpoint: false },
      ),
    ).rejects.toThrow(/任务失败: t/);
    // last save is the failure checkpoint carrying the error message.
    const last = p.saveCheckpoint.mock.calls.at(-1)[1];
    expect(last.error).toBe("boom");
    expect(p.getActiveTasks()).toHaveLength(0);
  });
});

describe("ResumableProcessor.getCheckpointPath", () => {
  it("sanitizes unsafe characters in the taskId", () => {
    const p = new ResumableProcessor({ checkpointDir: "/cp" });
    const out = p.getCheckpointPath("a/b:c*d");
    expect(out).toMatch(/a_b_c_d\.checkpoint\.json$/);
  });
});
