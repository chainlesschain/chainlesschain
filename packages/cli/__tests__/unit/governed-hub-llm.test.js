import { describe, expect, it, vi } from "vitest";
import { createGovernedHubLlm } from "../../src/lib/evolution/governed-hub-llm.js";

describe("Hub model identity", () => {
  it.each(["locality", "name", "chat"])(
    "rejects changed %s before creating a Run",
    async (field) => {
      const chat = vi.fn();
      const factory = vi.fn();
      const llm = { name: "local:test", isLocal: true, chat };
      const wrapped = createGovernedHubLlm(llm, factory);
      if (field === "locality") llm.isLocal = false;
      else if (field === "name") llm.name = "other:model";
      else llm.chat = vi.fn();
      expect(() => wrapped.isLocal).toThrow(/identity changed/);
      expect(() => wrapped.name).toThrow(/identity changed/);
      await expect(
        wrapped.chat([{ role: "user", content: "private" }]),
      ).rejects.toThrow(/identity changed/);
      expect(factory).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      expect(llm.chat).not.toHaveBeenCalled();
    },
  );
});
