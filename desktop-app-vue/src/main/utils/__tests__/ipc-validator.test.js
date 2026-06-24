/**
 * ipc-validator 测试 —— IPC 入参的 zod schema 校验、校验中间件
 * (withValidation / withMultiValidation) 与错误格式化。
 *
 * 重点覆盖 safePathSchema 的目录遍历防护（拒 `..` / 绝对路径 / 盘符 / UNC，
 * 含曾修过的小写盘符 `c:\` 与正斜杠盘符 `C:/`），以及校验失败时抛 ValidationError
 * 且不调用业务 handler 的契约。
 *
 * 分层：unit（各 schema 边界）+ integration（中间件包裹 handler 的完整流程）+
 * smoke（模块导出形状）。
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const validator = require("../ipc-validator.js");
const { ValidationError } = require("../ipc-error-handler");
const {
  safePathSchema,
  uuidSchema,
  paginationSchema,
  timestampSchema,
  projectCreateSchema,
  withValidation,
  withMultiValidation,
  formatZodError,
} = validator;

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("ipc-validator — smoke", () => {
  it("exports schemas, middleware and prebuilt validators", () => {
    expect(typeof withValidation).toBe("function");
    expect(typeof withMultiValidation).toBe("function");
    expect(typeof validator.validateProjectCreate).toBe("function");
    expect(safePathSchema).toBeTruthy();
  });
});

describe("ipc-validator — safePathSchema (path-traversal guard)", () => {
  it("accepts project-relative paths", () => {
    for (const p of ["src/app.js", "a/b/c.txt", "file.md", "deep/nested/x"]) {
      expect(safePathSchema.safeParse(p).success).toBe(true);
    }
  });

  it("rejects `..` traversal anywhere in the path", () => {
    for (const p of ["..", "../x", "a/../b", "a/b/..", "../../etc/passwd"]) {
      expect(safePathSchema.safeParse(p).success).toBe(false);
    }
  });

  it("rejects absolute, drive and UNC paths (incl. lowercase / forward-slash drive)", () => {
    for (const p of [
      "/etc/passwd",
      "\\windows\\system32",
      "C:\\Users\\x",
      "c:\\users\\x", // lowercase drive
      "C:/Users/x", // forward-slash drive
      "c:/users/x",
      "\\\\server\\share", // backslash UNC
      "//server/share", // forward-slash UNC
    ]) {
      expect(safePathSchema.safeParse(p).success).toBe(false);
    }
  });

  it("rejects the empty string", () => {
    expect(safePathSchema.safeParse("").success).toBe(false);
  });
});

describe("ipc-validator — base schemas", () => {
  it("uuidSchema accepts a UUID and rejects junk", () => {
    expect(uuidSchema.safeParse(UUID).success).toBe(true);
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(uuidSchema.safeParse("").success).toBe(false);
  });

  it("paginationSchema fills defaults and enforces bounds", () => {
    const def = paginationSchema.parse({});
    expect(def).toMatchObject({ offset: 0, limit: 50, sortOrder: "desc" });
    expect(paginationSchema.safeParse({ limit: 1001 }).success).toBe(false); // > max
    expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false); // < min
    expect(paginationSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(paginationSchema.safeParse({ sortOrder: "sideways" }).success).toBe(
      false,
    );
  });

  it("timestampSchema requires a positive integer", () => {
    expect(timestampSchema.safeParse(1700000000000).success).toBe(true);
    expect(timestampSchema.safeParse(0).success).toBe(false);
    expect(timestampSchema.safeParse(-1).success).toBe(false);
    expect(timestampSchema.safeParse(1.5).success).toBe(false);
  });

  it("projectCreateSchema enforces name length and fills projectType default", () => {
    const ok = projectCreateSchema.parse({ name: "My Project" });
    expect(ok.projectType).toBe("web"); // default
    expect(projectCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(
      projectCreateSchema.safeParse({ name: "x".repeat(101) }).success,
    ).toBe(false);
    expect(
      projectCreateSchema.safeParse({ name: "ok", projectType: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("ipc-validator — withValidation middleware", () => {
  const event = { sender: {} };

  it("validates the arg, fills defaults, and calls the handler", async () => {
    const handler = vi.fn(async (_e, arg) => ({ received: arg }));
    const wrapped = withValidation(projectCreateSchema)(handler);
    const result = await wrapped(event, { name: "P" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.received.projectType).toBe("web"); // default filled before handler
  });

  it("throws ValidationError and does NOT call the handler on bad input", async () => {
    const handler = vi.fn();
    const wrapped = withValidation(uuidSchema)(handler);
    await expect(wrapped(event, "bad-id")).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("honors a non-zero argIndex", async () => {
    const handler = vi.fn(async () => "ok");
    const wrapped = withValidation(uuidSchema, { argIndex: 1 })(handler);
    await expect(wrapped(event, "anything", UUID)).resolves.toBe("ok");
    await expect(wrapped(event, "anything", "bad")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("ipc-validator — withMultiValidation + formatZodError", () => {
  const event = {};

  it("validates multiple args and passes all-valid through to the handler", async () => {
    const handler = vi.fn(async () => "ok");
    const wrapped = withMultiValidation({ 0: uuidSchema, 1: timestampSchema })(
      handler,
    );
    await expect(wrapped(event, UUID, 123)).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("aggregates errors from multiple bad args and skips the handler", async () => {
    const handler = vi.fn(async () => "ok");
    const wrapped = withMultiValidation({ 0: uuidSchema, 1: timestampSchema })(
      handler,
    );
    const err = await wrapped(event, "bad", -1).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/参数0/); // both arg positions reported
    expect(err.message).toMatch(/参数1/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("formatZodError joins issue path + message", () => {
    const parsed = projectCreateSchema.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
    const out = formatZodError(parsed.error);
    expect(Array.isArray(out.errors)).toBe(true);
    expect(out.message).toContain("name");
  });
});
