import { describe, expect, it, vi } from "vitest";
import { createGovernedHubLlm } from "../../src/lib/evolution/governed-hub-llm.js";

describe("Hub model identity", () => {
  it("uses the host's disabled mode without requiring an Evolution certificate", async () => {
    const chat = vi.fn().mockResolvedValue({ text: "ordinary answer" });
    const llm = { name: "custom:local-model", isLocal: true, chat };
    expect(() => createGovernedHubLlm(llm, null)).toThrow(
      "factory is required",
    );
    const wrapped = createGovernedHubLlm(llm, null, {
      evolutionDisabled: true,
    });
    const messages = [{ role: "user", content: "hello" }];
    expect(await wrapped.chat(messages)).toEqual({ text: "ordinary answer" });
    expect(chat).toHaveBeenCalledExactlyOnceWith(messages, {});
    expect(wrapped.isLocal).toBe(true);
  });
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
