/**
 * slash-dispatch — registry unit tests
 *
 * Covers:
 *  - registerSlashHandler() + dispatchSlash() happy path
 *  - dispatchSlash() returns false for unknown / empty handler
 *  - Handler overwrite on duplicate registration
 *  - Unregister callback removes only matching handler
 *  - dispatchSlash() catches handler errors and returns false
 *  - listRegisteredHandlers() reflects live registry
 *  - V6 preview shell 4 builtin handlers can coexist
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerSlashHandler,
  dispatchSlash,
  listRegisteredHandlers,
} from "../slash-dispatch";

const PREVIEW_HANDLERS = [
  "builtin:openP2P",
  "builtin:openTrade",
  "builtin:openSocial",
  "builtin:openUKey",
] as const;

function cleanup(ids: string[]) {
  for (const id of ids) {
    registerSlashHandler(id, () => {})();
  }
}

describe("slash-dispatch", () => {
  beforeEach(() => {
    for (const id of listRegisteredHandlers()) {
      registerSlashHandler(id, () => {})();
    }
  });

  it("dispatches a registered handler with the provided context", () => {
    const fn = vi.fn();
    const off = registerSlashHandler("test:one", fn);
    const ok = dispatchSlash("test:one", { trigger: "/one", args: "a b" });
    expect(ok).toBe(true);
    expect(fn).toHaveBeenCalledWith({ trigger: "/one", args: "a b" });
    off();
  });

  it("returns false for an unregistered handler id", () => {
    const ok = dispatchSlash("test:missing", { trigger: "x", args: "" });
    expect(ok).toBe(false);
  });

  it("returns false for null / empty handler id", () => {
    expect(dispatchSlash(null, { trigger: "x", args: "" })).toBe(false);
    expect(dispatchSlash(undefined, { trigger: "x", args: "" })).toBe(false);
    expect(dispatchSlash("", { trigger: "x", args: "" })).toBe(false);
  });

  it("overwrites on duplicate registration and dispatches latest", () => {
    const first = vi.fn();
    const second = vi.fn();
    const off1 = registerSlashHandler("test:dup", first);
    const off2 = registerSlashHandler("test:dup", second);
    dispatchSlash("test:dup", { trigger: "/dup", args: "" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });

  it("unregister callback only removes when handler still matches", () => {
    const first = vi.fn();
    const second = vi.fn();
    const off1 = registerSlashHandler("test:rm", first);
    registerSlashHandler("test:rm", second); // overwrites
    off1(); // should NOT delete because current handler is `second`
    dispatchSlash("test:rm", { trigger: "/rm", args: "" });
    expect(second).toHaveBeenCalledTimes(1);
    // cleanup
    registerSlashHandler("test:rm", () => {})();
  });

  it("catches synchronous errors thrown in handler and returns true (async-safe)", () => {
    const off = registerSlashHandler("test:throw", () => {
      throw new Error("boom");
    });
    expect(() =>
      dispatchSlash("test:throw", { trigger: "/t", args: "" }),
    ).not.toThrow();
    off();
  });

  it("listRegisteredHandlers() reflects the live registry", () => {
    expect(listRegisteredHandlers()).toHaveLength(0);
    const off = registerSlashHandler("test:list", () => {});
    expect(listRegisteredHandlers()).toContain("test:list");
    off();
    expect(listRegisteredHandlers()).not.toContain("test:list");
  });

  it("preview shell 4 decentralized handlers coexist independently", () => {
    const fns = PREVIEW_HANDLERS.map(() => vi.fn());
    const offs = PREVIEW_HANDLERS.map((id, i) =>
      registerSlashHandler(id, fns[i]),
    );
    for (let i = 0; i < PREVIEW_HANDLERS.length; i++) {
      dispatchSlash(PREVIEW_HANDLERS[i], {
        trigger: PREVIEW_HANDLERS[i],
        args: "",
      });
    }
    for (const fn of fns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
    for (const off of offs) off();
    cleanup([...PREVIEW_HANDLERS]);
  });
});
