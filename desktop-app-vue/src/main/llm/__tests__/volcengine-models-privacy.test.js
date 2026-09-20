import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { logger } = require("../../utils/logger.js");
const { TaskTypes, VolcengineModelSelector } = require("../volcengine-models");

describe("Volcengine model selector privacy", () => {
  let infoSpy;

  beforeEach(() => {
    vi.resetAllMocks();
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects a model without logging task, model, capability or pricing data", () => {
    const selector = new VolcengineModelSelector();
    const selected = selector.selectModel(TaskTypes.CHAT, {
      preferQuality: true,
    });

    expect(selected).toBeDefined();
    expect(infoSpy).toHaveBeenCalledWith("[LLMSelector] internal event", {
      component: "selector",
      event: "task-model-selected",
    });
    const serialized = JSON.stringify(infoSpy.mock.calls);
    expect(serialized).not.toContain(TaskTypes.CHAT);
    expect(serialized).not.toContain(selected.name);
    expect(serialized).not.toContain(JSON.stringify(selected.capabilities));
    expect(serialized).not.toContain(String(selected.pricing.input));
  });

  it("uses a fixed event when an unknown task falls back", () => {
    const selector = new VolcengineModelSelector();
    const selected = selector.selectModel("private-tenant-task");

    expect(selected).toBe(selector.models["doubao-seed-1.6"]);
    expect(infoSpy).toHaveBeenCalledWith("[LLMSelector] internal event", {
      component: "selector",
      event: "task-model-defaulted",
    });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(
      "private-tenant-task",
    );
  });
});
