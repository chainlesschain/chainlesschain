import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createLlmSelectorPrivacy } = require("../llm-selector-privacy");

describe("LLM selector diagnostic privacy", () => {
  const sink = { info: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows static events and rejects dynamic selector details", () => {
    const sources = ["llm-selector.js", "volcengine-models.js"].map((file) =>
      fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"),
    );
    const events = sources.flatMap((source) =>
      [...source.matchAll(/selectorPrivacy\.event\("([a-z-]+)"\)/gu)].map(
        (match) => match[1],
      ),
    );
    const privacy = createLlmSelectorPrivacy(sink);

    for (const event of events) {
      privacy.event(event);
      expect(sink.info).toHaveBeenLastCalledWith(
        "[LLMSelector] internal event",
        { component: "selector", event },
      );
    }

    privacy.event("private-provider-score");
    expect(sink.info).toHaveBeenLastCalledWith("[LLMSelector] internal event", {
      component: "selector",
      event: "unknown",
    });
  });

  it("prevents direct logging from the selector", () => {
    for (const file of ["llm-selector.js", "volcengine-models.js"]) {
      const source = fs.readFileSync(
        path.resolve(__dirname, "..", file),
        "utf8",
      );

      expect(source).not.toMatch(/utils\/logger\.js/u);
      expect(source).not.toMatch(
        /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
      );
      expect(source).not.toMatch(
        /console\.(?:debug|info|warn|error|log)\s*\(/u,
      );
    }
  });
});
