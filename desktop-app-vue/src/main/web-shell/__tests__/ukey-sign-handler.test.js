/**
 * Phase 2 ukey.sign — unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { createUkeySignHandler } from "../handlers/ukey-sign-handler.js";

function makeStubManager(signResult) {
  return {
    sign: vi.fn(async () => signResult),
  };
}

async function drain(gen) {
  const chunks = [];
  let final;
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      final = step.value;
      break;
    }
    chunks.push(step.value);
  }
  return { chunks, final };
}

describe("createUkeySignHandler — happy path", () => {
  it("yields pre_check + signing stage markers, then returns the manager result", async () => {
    const ukeyManager = makeStubManager({
      success: true,
      signature: "ABC123",
      algorithm: "SM2",
    });
    const handler = createUkeySignHandler({ ukeyManager });
    const gen = handler({ data: "hello" });
    const { chunks, final } = await drain(gen);
    expect(chunks).toEqual([{ stage: "pre_check" }, { stage: "signing" }]);
    expect(final).toEqual({
      success: true,
      signature: "ABC123",
      algorithm: "SM2",
    });
    expect(ukeyManager.sign).toHaveBeenCalledWith("hello");
  });

  it("passes driver_not_initialized through as a non-throwing result", async () => {
    const ukeyManager = makeStubManager({
      success: false,
      reason: "driver_not_initialized",
      message: "U-Key driver not available on this platform (Windows only)",
    });
    const handler = createUkeySignHandler({ ukeyManager });
    const { chunks, final } = await drain(handler({ data: "x" }));
    // Stage markers still emit — the SPA shows "checking" briefly even
    // when the manager will reject — that's intentional UX feedback.
    expect(chunks).toHaveLength(2);
    expect(final.success).toBe(false);
    expect(final.reason).toBe("driver_not_initialized");
  });

  it("passes device_locked through verbatim", async () => {
    const ukeyManager = makeStubManager({
      success: false,
      reason: "device_locked",
      message: "U-Key device is locked",
    });
    const handler = createUkeySignHandler({ ukeyManager });
    const { final } = await drain(handler({ data: "x" }));
    expect(final.reason).toBe("device_locked");
  });
});

describe("createUkeySignHandler — frame validation", () => {
  it("throws data_required when data is missing", async () => {
    const handler = createUkeySignHandler({ ukeyManager: makeStubManager({}) });
    const gen = handler({});
    await expect(gen.next()).rejects.toThrow("data_required");
  });

  it("throws data_required when data is the empty string", async () => {
    const handler = createUkeySignHandler({ ukeyManager: makeStubManager({}) });
    const gen = handler({ data: "" });
    await expect(gen.next()).rejects.toThrow("data_required");
  });

  it("throws data_required when data is non-string", async () => {
    const handler = createUkeySignHandler({ ukeyManager: makeStubManager({}) });
    const gen = handler({ data: 42 });
    await expect(gen.next()).rejects.toThrow("data_required");
    const gen2 = handler({ data: { obj: 1 } });
    await expect(gen2.next()).rejects.toThrow("data_required");
  });

  it("rejects oversized payloads with data_too_large", async () => {
    const handler = createUkeySignHandler({ ukeyManager: makeStubManager({}) });
    const gen = handler({ data: "a".repeat(64 * 1024 + 1) });
    await expect(gen.next()).rejects.toThrow("data_too_large");
  });

  it("does NOT call the manager when input is invalid", async () => {
    const ukeyManager = makeStubManager({});
    const handler = createUkeySignHandler({ ukeyManager });
    await expect(handler({}).next()).rejects.toThrow();
    expect(ukeyManager.sign).not.toHaveBeenCalled();
  });
});

describe("createUkeySignHandler — manager unavailable", () => {
  it("throws ukey_unavailable when ukeyManager is null", async () => {
    const handler = createUkeySignHandler({ ukeyManager: null });
    const gen = handler({ data: "x" });
    await expect(gen.next()).rejects.toThrow("ukey_unavailable");
  });

  it("throws ukey_unavailable when manager has no sign method", async () => {
    const handler = createUkeySignHandler({ ukeyManager: { foo: 1 } });
    const gen = handler({ data: "x" });
    await expect(gen.next()).rejects.toThrow("ukey_unavailable");
  });

  it("throws ukey_unavailable when option is missing entirely", async () => {
    const handler = createUkeySignHandler();
    const gen = handler({ data: "x" });
    await expect(gen.next()).rejects.toThrow("ukey_unavailable");
  });
});
