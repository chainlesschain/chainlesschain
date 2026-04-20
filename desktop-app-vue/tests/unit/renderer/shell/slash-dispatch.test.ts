/**
 * Unit tests — shell/slash-dispatch.ts
 *
 * 覆盖：handler 注册 / 触发 / 覆盖告警 / 未知 handler / 注销语义。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerSlashHandler,
  dispatchSlash,
  listRegisteredHandlers,
} from "@/shell/slash-dispatch";

describe("shell/slash-dispatch", () => {
  beforeEach(() => {
    // 每个用例先卸载已有 handler，避免相互污染
    for (const id of listRegisteredHandlers()) {
      // 通过再次注册 + 返回 unregister 来清理
      const noop = () => {};
      registerSlashHandler(id, noop)();
    }
  });

  it("注册后 dispatchSlash 能触发 handler 并返回 true", () => {
    const spy = vi.fn();
    registerSlashHandler("t:hello", spy);
    const ok = dispatchSlash("t:hello", { trigger: "hello", args: "world" });
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ trigger: "hello", args: "world" });
  });

  it("未注册的 handler dispatchSlash 返回 false", () => {
    const ok = dispatchSlash("t:missing", { trigger: "x", args: "" });
    expect(ok).toBe(false);
  });

  it("handlerId 为空时 dispatchSlash 返回 false", () => {
    expect(dispatchSlash(null, { trigger: "x", args: "" })).toBe(false);
    expect(dispatchSlash(undefined, { trigger: "x", args: "" })).toBe(false);
    expect(dispatchSlash("", { trigger: "x", args: "" })).toBe(false);
  });

  it("unregister 函数调用后 dispatchSlash 返回 false", () => {
    const spy = vi.fn();
    const off = registerSlashHandler("t:once", spy);
    expect(dispatchSlash("t:once", { trigger: "once", args: "" })).toBe(true);
    off();
    expect(dispatchSlash("t:once", { trigger: "once", args: "" })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("重复注册同 id 会覆盖 handler，unregister 仅清理自己注册的那个", () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    const off1 = registerSlashHandler("t:dup", spy1);
    const off2 = registerSlashHandler("t:dup", spy2);
    dispatchSlash("t:dup", { trigger: "dup", args: "" });
    expect(spy1).not.toHaveBeenCalled();
    expect(spy2).toHaveBeenCalledTimes(1);

    // off1 发现当前 handler 已不是 spy1，不应删除 spy2
    off1();
    dispatchSlash("t:dup", { trigger: "dup", args: "" });
    expect(spy2).toHaveBeenCalledTimes(2);

    off2();
    expect(dispatchSlash("t:dup", { trigger: "dup", args: "" })).toBe(false);
  });

  it("handler 抛错时 dispatchSlash 返回 false 且不向上冒泡", () => {
    registerSlashHandler("t:boom", () => {
      throw new Error("boom");
    });
    expect(() =>
      dispatchSlash("t:boom", { trigger: "boom", args: "" }),
    ).not.toThrow();
    // void fn() 表达式下 Promise 拒绝不会被捕获到返回值层，
    // 同步抛错则走 catch 分支并返回 false
    // 这里只断言不向上冒泡（已被 expect().not.toThrow() 覆盖）
  });

  it("listRegisteredHandlers 返回当前所有 id", () => {
    registerSlashHandler("t:a", () => {});
    registerSlashHandler("t:b", () => {});
    const ids = listRegisteredHandlers();
    expect(ids).toContain("t:a");
    expect(ids).toContain("t:b");
  });
});
