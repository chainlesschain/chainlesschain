/**
 * listen-with-port-fallback unit tests.
 *
 * Run: npx vitest run __tests__/unit/lib/listen-with-port-fallback.test.js
 */

import { describe, it, expect, vi } from "vitest";
import { listenWithPortFallback } from "../../../src/lib/listen-with-port-fallback.js";

function eaddrInUse(port) {
  const err = new Error(`bind EADDRINUSE 127.0.0.1:${port}`);
  err.code = "EADDRINUSE";
  err.errno = -4091;
  return err;
}

describe("listenWithPortFallback — happy path", () => {
  it("returns the listenFn result on first-try success", async () => {
    const fn = vi.fn(async (port) => ({ port, label: "ws" }));
    const out = await listenWithPortFallback(fn, 18800);
    expect(out).toEqual({ port: 18800, label: "ws" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(18800);
  });

  it("does not invoke onFallback when the preferred port binds", async () => {
    const onFallback = vi.fn();
    const fn = vi.fn(async (port) => ({ port }));
    await listenWithPortFallback(fn, 18800, { onFallback });
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("listenWithPortFallback — sequential fallback", () => {
  it("walks adjacent ports when the preferred is in use", async () => {
    let attempts = 0;
    const fn = vi.fn(async (port) => {
      attempts++;
      if (attempts < 3) throw eaddrInUse(port);
      return { port };
    });
    const out = await listenWithPortFallback(fn, 18800);
    expect(out.port).toBe(18802);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([18800, 18801, 18802]);
  });

  it("invokes onFallback once when an adjacent port binds", async () => {
    const onFallback = vi.fn();
    let attempts = 0;
    const fn = async (port) => {
      attempts++;
      if (attempts < 4) throw eaddrInUse(port);
      return { port };
    };
    const out = await listenWithPortFallback(fn, 28800, { onFallback });
    expect(out.port).toBe(28803);
    expect(onFallback).toHaveBeenCalledTimes(1);
    const msg = onFallback.mock.calls[0][0];
    expect(msg).toContain("28800");
    expect(msg).toContain("28803");
  });

  it("respects maxAttempts bound on the sequential walk", async () => {
    const fn = vi.fn(async (port) => {
      // Every non-zero port is busy; only OS-assigned (port 0) can bind.
      if (port !== 0) throw eaddrInUse(port);
      return { port: 49200 };
    });
    // Walk preferred..preferred+maxAttempts-1, then OS-assigned (port 0).
    // With maxAttempts=3, sequential = [18800, 18801, 18802], then 0.
    const out = await listenWithPortFallback(fn, 18800, { maxAttempts: 3 });
    expect(fn.mock.calls.map((c) => c[0])).toEqual([18800, 18801, 18802, 0]);
    expect(out.port).toBe(49200);
  });
});

describe("listenWithPortFallback — OS-assigned final fallback", () => {
  it("falls back to port 0 when every adjacent port is busy", async () => {
    const onFallback = vi.fn();
    const fn = vi.fn(async (port) => {
      if (port === 0) return { port: 49152 };
      throw eaddrInUse(port);
    });
    const out = await listenWithPortFallback(fn, 18800, {
      maxAttempts: 5,
      onFallback,
    });
    expect(out.port).toBe(49152);
    // 5 sequential failures + one onFallback for the OS-assigned hop.
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      18800, 18801, 18802, 18803, 18804, 0,
    ]);
    // onFallback fires for the OS-assigned hop (no successful adjacent
    // bind so the in-walk message is skipped).
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0]).toContain("OS-assigned");
  });

  it("throws a descriptive error when even OS-assigned fails", async () => {
    const fn = async (port) => {
      throw eaddrInUse(port);
    };
    await expect(
      listenWithPortFallback(fn, 18800, { maxAttempts: 2 }),
    ).rejects.toThrow(/Could not bind any port.*Tried.*OS-assigned/);
  });

  it("preferred=0 skips the sequential walk and goes straight to OS-assigned", async () => {
    const fn = vi.fn(async (port) => ({ port: port === 0 ? 51234 : port }));
    const out = await listenWithPortFallback(fn, 0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);
    expect(out.port).toBe(51234);
  });
});

describe("listenWithPortFallback — error propagation", () => {
  it("propagates non-EADDRINUSE errors immediately", async () => {
    const fn = async () => {
      const err = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    };
    await expect(listenWithPortFallback(fn, 80)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("does not leak the EADDRINUSE retry chain into other error codes", async () => {
    let n = 0;
    const fn = async (port) => {
      n++;
      if (n === 1) throw eaddrInUse(port);
      const err = new Error("kernel said no");
      err.code = "ENOSYS";
      throw err;
    };
    await expect(listenWithPortFallback(fn, 18800)).rejects.toThrow(
      /kernel said no/,
    );
  });
});

describe("listenWithPortFallback — input validation", () => {
  it("rejects a non-function listenFn", async () => {
    await expect(
      listenWithPortFallback("not a function", 18800),
    ).rejects.toThrow(TypeError);
  });

  it("rejects a non-integer preferred", async () => {
    await expect(
      listenWithPortFallback(async () => ({}), 12.5),
    ).rejects.toThrow(RangeError);
  });

  it("rejects a preferred above 65535", async () => {
    await expect(
      listenWithPortFallback(async () => ({}), 70000),
    ).rejects.toThrow(RangeError);
  });

  it("rejects a negative preferred", async () => {
    await expect(listenWithPortFallback(async () => ({}), -1)).rejects.toThrow(
      RangeError,
    );
  });

  it("survives an onFallback that itself throws (informational only)", async () => {
    const fn = async (port) => {
      if (port < 18802) throw eaddrInUse(port);
      return { port };
    };
    const onFallback = () => {
      throw new Error("logger blew up");
    };
    // Should not surface the onFallback error — bind still succeeded.
    const out = await listenWithPortFallback(fn, 18800, { onFallback });
    expect(out.port).toBe(18802);
  });
});
