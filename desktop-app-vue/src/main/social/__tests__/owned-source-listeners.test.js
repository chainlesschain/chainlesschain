import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { OwnedSourceListeners } = require("../owned-source-listeners.js");

describe("OwnedSourceListeners", () => {
  it("fails closed when the source cannot detach listeners", () => {
    const owner = new OwnedSourceListeners({ on: vi.fn() });

    expect(() => owner.listen("message", vi.fn())).toThrow(
      /source must support detachable listeners/,
    );
  });

  it("registers one named wrapper per event and detaches it on close", async () => {
    const source = new EventEmitter();
    const handler = vi.fn();
    const owner = new OwnedSourceListeners(source);

    const first = owner.listen("message", handler);
    const second = owner.listen("message", vi.fn());

    expect(second).toBe(first);
    expect(source.listenerCount("message")).toBe(1);

    source.emit("message", { id: 1 });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith({ id: 1 });

    await owner.close();
    await owner.close();
    expect(source.listenerCount("message")).toBe(0);

    source.emit("message", { id: 2 });
    first({ id: 3 });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("owns browser-style EventTarget listeners", async () => {
    const source = new EventTarget();
    const handler = vi.fn();
    const owner = new OwnedSourceListeners(source);

    owner.listen("message", handler);
    source.dispatchEvent(new Event("message"));
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    await owner.close();
    source.dispatchEvent(new Event("message"));
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("waits for already-admitted async delivery before closing", async () => {
    const source = new EventEmitter();
    let release;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const owner = new OwnedSourceListeners(source);
    owner.listen("message", async () => {
      markStarted();
      await pending;
    });

    source.emit("message");
    await started;
    let closed = false;
    const closing = owner.close().then((result) => {
      closed = true;
      return result;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release();
    await expect(closing).resolves.toBe(true);
  });

  it("bounds concurrent source delivery", async () => {
    const source = new EventEmitter();
    const logger = { warn: vi.fn() };
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(() => pending);
    const owner = new OwnedSourceListeners(source, {
      logger,
      label: "bounded-owner",
      maxInFlight: 1,
    });
    owner.listen("message", handler);

    source.emit("message", 1);
    source.emit("message", 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("in-flight limit 1 reached"),
    );

    release();
    await owner.close();
  });

  it("bounds close when an admitted handler never settles", async () => {
    const source = new EventEmitter();
    const logger = { warn: vi.fn() };
    let release;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const owner = new OwnedSourceListeners(source, {
      logger,
      label: "test-owner",
      closeTimeoutMs: 10,
    });
    owner.listen("message", async () => {
      markStarted();
      await pending;
    });

    source.emit("message");
    await started;
    await expect(owner.close()).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("timed out waiting for 1 in-flight handler"),
    );
    release();
  });
});
