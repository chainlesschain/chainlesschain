/**
 * ipc-error-handler 测试 —— AppError 体系、classifyError 自动分类（含优先级）、
 * withErrorHandling 中间件（成功透传 / 失败分类后重抛 + 统计）、wrapHandlers、
 * 以及错误统计的累计与重置。
 *
 * 分层：smoke（导出形状）+ unit（错误类 / classifyError / 统计）+
 * integration（中间件包裹真实 handler 的成功与失败两条路径）。
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  ErrorType,
  AppError,
  ValidationError,
  NetworkError,
  TimeoutError,
  DatabaseError,
  classifyError,
  withErrorHandling,
  wrapHandlers,
  getErrorStats,
  resetErrorStats,
} = require("../ipc-error-handler.js");

beforeEach(() => resetErrorStats());

describe("ipc-error-handler — smoke", () => {
  it("exports the error types, classes and middleware", () => {
    expect(ErrorType.VALIDATION).toBe("ValidationError");
    expect(typeof withErrorHandling).toBe("function");
    expect(typeof classifyError).toBe("function");
  });
});

describe("ipc-error-handler — AppError hierarchy", () => {
  it("a subclass carries its type/details and is an Error", () => {
    const e = new ValidationError("bad input", { field: "name" });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AppError);
    expect(e.type).toBe(ErrorType.VALIDATION);
    expect(e.name).toBe("ValidationError");
    expect(e.details).toEqual({ field: "name" });
    expect(typeof e.timestamp).toBe("number");
  });

  it("toJSON exposes a serializable shape (stack hidden outside development)", () => {
    const json = new NetworkError("down").toJSON();
    expect(json).toMatchObject({
      name: "NetworkError",
      type: ErrorType.NETWORK,
      message: "down",
    });
    // NODE_ENV is not "development" under vitest → stack omitted
    expect(json.stack).toBeUndefined();
  });
});

describe("ipc-error-handler — classifyError", () => {
  const cases = [
    ["Request timeout", ErrorType.TIMEOUT],
    ["network timeout", ErrorType.TIMEOUT], // timeout wins over network
    ["SQLITE_BUSY: database is locked", ErrorType.DATABASE],
    ["table not found in database", ErrorType.DATABASE], // database wins over not-found
    ["fetch failed", ErrorType.NETWORK],
    ["ECONNREFUSED 127.0.0.1", ErrorType.NETWORK],
    ["EACCES: permission denied", ErrorType.PERMISSION],
    ["unauthorized request", ErrorType.PERMISSION],
    ["ENOENT: no such entry", ErrorType.NOT_FOUND],
    ["resource already exists", ErrorType.CONFLICT],
    ["directory read failed", ErrorType.FILESYSTEM],
    ["invalid argument", ErrorType.VALIDATION],
    ["something unexpected happened", ErrorType.INTERNAL], // default
  ];

  it.each(cases)("classifies %j → %s", (message, expectedType) => {
    const classified = classifyError(new Error(message));
    expect(classified).toBeInstanceOf(AppError);
    expect(classified.type).toBe(expectedType);
    expect(classified.message).toBe(message); // original message preserved
  });

  it("returns an existing AppError unchanged", () => {
    const original = new DatabaseError("locked");
    expect(classifyError(original)).toBe(original);
  });
});

describe("ipc-error-handler — withErrorHandling middleware", () => {
  const event = {};

  it("passes a successful result straight through", async () => {
    const handler = vi.fn(async (_e, a, b) => a + b);
    const wrapped = withErrorHandling("math:add", handler);
    await expect(wrapped(event, 2, 3)).resolves.toBe(5);
  });

  it("classifies a thrown plain Error and rethrows it as an AppError", async () => {
    const wrapped = withErrorHandling("net:call", async () => {
      throw new Error("socket hang up");
    });
    const err = await wrapped(event).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.type).toBe(ErrorType.NETWORK);
  });

  it("preserves an already-classified AppError", async () => {
    const original = new ValidationError("nope");
    const wrapped = withErrorHandling("v:check", async () => {
      throw original;
    });
    await expect(wrapped(event)).rejects.toBe(original);
  });

  it("records the error in the stats (by channel and type)", async () => {
    const wrapped = withErrorHandling("db:query", async () => {
      throw new Error("sqlite error");
    });
    await wrapped(event).catch(() => {});
    const stats = getErrorStats();
    expect(stats.total).toBe(1);
    expect(stats.byChannel["db:query"].count).toBe(1);
    expect(stats.byType[ErrorType.DATABASE]).toBe(1);
  });
});

describe("ipc-error-handler — wrapHandlers + stats lifecycle", () => {
  it("wraps every handler in a map", async () => {
    const wrapped = wrapHandlers({
      "a:ok": async () => "A",
      "b:fail": async () => {
        throw new Error("timeout");
      },
    });
    expect(Object.keys(wrapped)).toEqual(["a:ok", "b:fail"]);
    await expect(wrapped["a:ok"]({})).resolves.toBe("A");
    await expect(wrapped["b:fail"]({})).rejects.toBeInstanceOf(TimeoutError);
  });

  it("resetErrorStats clears accumulated counts", async () => {
    const wrapped = withErrorHandling("x", async () => {
      throw new Error("boom");
    });
    await wrapped({}).catch(() => {});
    expect(getErrorStats().total).toBe(1);
    resetErrorStats();
    expect(getErrorStats().total).toBe(0);
  });
});
