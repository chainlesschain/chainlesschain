import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { logger } = require("../../utils/logger.js");
const { createLlmRuntimePrivacy } = require("../llm-runtime-privacy");
const { LLMStateBus, Events } = require("../llm-state-bus");
const { StreamController } = require("../stream-controller");

describe("LLM runtime privacy", () => {
  let infoSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records only allowlisted component and event identifiers", () => {
    const sink = { info: vi.fn() };
    const privacy = createLlmRuntimePrivacy("state-bus", sink);

    privacy.event("listener-failed");
    privacy.event("private-event-name");

    expect(sink.info).toHaveBeenNthCalledWith(
      1,
      "[LLMRuntime] internal event",
      { component: "state-bus", event: "listener-failed" },
    );
    expect(sink.info).toHaveBeenNthCalledWith(
      2,
      "[LLMRuntime] internal event",
      { component: "state-bus", event: "unknown" },
    );
  });

  it("does not disclose listener errors or custom event names", () => {
    const bus = new LLMStateBus();
    bus.on("tenant-private-event", () => {
      throw new Error("private listener failure");
    });

    expect(() => bus.dispatch("tenant-private-event", {})).not.toThrow();
    expect(infoSpy).toHaveBeenCalledWith("[LLMRuntime] internal event", {
      component: "state-bus",
      event: "listener-failed",
    });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(
      "tenant-private-event",
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(
      "private listener failure",
    );
  });

  it("uses fixed events when stream transitions are rejected", () => {
    const controller = new StreamController();

    controller.pause();
    controller.start();
    controller.resume();

    expect(infoSpy).toHaveBeenCalledWith("[LLMRuntime] internal event", {
      component: "stream-controller",
      event: "pause-rejected",
    });
    expect(infoSpy).toHaveBeenCalledWith("[LLMRuntime] internal event", {
      component: "stream-controller",
      event: "resume-rejected",
    });
  });

  it("returns frozen allowlisted stream receipts", () => {
    const privacy = createLlmRuntimePrivacy("stream-controller", {
      info: vi.fn(),
    });

    const receipt = privacy.publicEvent("chunk");
    const unknown = privacy.publicEvent("private-stream-event");

    expect(receipt).toEqual({
      code: "CC_LLM_STREAM_EVENT",
      component: "stream-controller",
      event: "chunk",
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(unknown.event).toBe("unknown");
  });

  it("does not publish stream content, results, reasons or errors", async () => {
    const secret = "private-stream-content-result-reason-error";
    const controller = new StreamController();
    const observed = [];
    for (const event of ["chunk", "cancel", "complete", "stream-error"]) {
      controller.on(event, (receipt) => observed.push(receipt));
    }

    controller.start();
    await controller.processChunk({ content: secret });
    controller.complete({ result: secret });
    controller.reset();
    controller.start();
    controller.cancel(secret);
    controller.reset();
    controller.error(new Error(secret));

    expect(JSON.stringify(observed)).not.toContain(secret);
    expect(controller.signal.reason).toBeUndefined();
    expect(observed).toEqual([
      expect.objectContaining({ event: "chunk" }),
      expect.objectContaining({ event: "complete" }),
      expect.objectContaining({ event: "cancel" }),
      expect.objectContaining({ event: "stream-error" }),
    ]);
  });

  it("keeps direct logger, console and error-message access out of consumers", () => {
    for (const file of ["llm-state-bus.js", "stream-controller.js"]) {
      const source = fs.readFileSync(
        path.resolve(__dirname, "..", file),
        "utf8",
      );
      expect(source).not.toMatch(/logger\.(?:debug|info|warn|error|fatal)/);
      expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)/);
      expect(source).not.toContain("error.message");
      expect(source).not.toContain("err.message");
    }
  });

  it("preserves state-bus dispatch and stream state contracts", () => {
    const bus = new LLMStateBus();
    const listener = vi.fn();
    bus.on(Events.PROVIDER_CHANGED, listener);
    bus.dispatch(Events.PROVIDER_CHANGED, { provider: "private-provider" });

    const controller = new StreamController();
    controller.start();
    controller.pause();

    expect(listener).toHaveBeenCalledWith({ provider: "private-provider" });
    expect(controller.isPaused).toBe(true);
  });
});
