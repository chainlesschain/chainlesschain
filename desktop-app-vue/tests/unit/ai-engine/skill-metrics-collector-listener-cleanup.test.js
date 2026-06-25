/**
 * SkillMetricsCollector — destroy() must remove listeners on injected deps.
 *
 * Bug: initialize() attached anonymous handlers to the injected (shared,
 * long-lived) skillRegistry and pipelineEngine, and destroy() cleared the flush
 * timer but couldn't remove them (anonymous). So after destroy() they kept
 * firing the _onSkill / _onPipeline handlers on a dead collector (pinning it),
 * and each init->destroy->init cycle accumulated 6 more listeners (dup dispatch).
 * Fix stores the bound handlers and off()s them in destroy().
 */

import { describe, it, expect, vi } from "vitest";
import EventEmitter from "events";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  SkillMetricsCollector,
} = require("../../../src/main/ai-engine/cowork/skills/skill-metrics-collector.js");

describe("SkillMetricsCollector listener cleanup", () => {
  it("removes injected-dep listeners on destroy; no accumulation on re-init", () => {
    const skillRegistry = new EventEmitter();
    const pipelineEngine = new EventEmitter();
    const c = new SkillMetricsCollector({ skillRegistry, pipelineEngine });

    c.initialize();
    expect(skillRegistry.listenerCount("skill-started")).toBe(1);
    expect(skillRegistry.listenerCount("skill-failed")).toBe(1);
    expect(pipelineEngine.listenerCount("pipeline:completed")).toBe(1);

    c.destroy();
    expect(skillRegistry.listenerCount("skill-started")).toBe(0); // removed (fix)
    expect(skillRegistry.listenerCount("skill-failed")).toBe(0);
    expect(pipelineEngine.listenerCount("pipeline:completed")).toBe(0);

    // re-init after destroy must not double the listeners
    c.initialize();
    expect(skillRegistry.listenerCount("skill-started")).toBe(1); // not 2
    c.destroy();
  });
});
