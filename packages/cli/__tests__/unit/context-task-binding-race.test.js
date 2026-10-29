import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProtected } from "@chainlesschain/context-memory-kernel";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";

it.each(["content", "replacement", "moved"])(
  "revalidates task identity after semantic recall waits (%s)",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "task-binding-race-"));
    const task = { role: "user", content: "AUTHORIZED_TASK" };
    const messages = [{ role: "system", content: "Follow the task." }, task];
    const binding = {
      original: task,
      message: structuredClone(task),
      allowContentRelocation: true,
    };
    const options = {
      provider: "ollama",
      model: "fixture",
      contextMemoryRequiredUserBinding: binding,
      contextMemoryEnv: {
        CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
      },
      contextMemoryFilePath: join(root, "memory.json"),
      contextMemoryModelWindowTokens: 1024,
      maxOutputTokens: 256,
      contextMemorySemanticCandidateProvider: async () => {
        await Promise.resolve();
        if (mode === "content") task.content = "UNAUTHORIZED_REPLACEMENT";
        if (mode === "replacement")
          messages[1] = { role: "user", content: "UNAUTHORIZED_REPLACEMENT" };
        if (mode === "moved")
          messages.splice(1, 0, {
            role: "user",
            content: "UNAUTHORIZED_REPLACEMENT",
          });
        return [];
      },
    };
    try {
      if (mode !== "moved") {
        await expect(
          prepareCanonicalProviderContext(messages, options),
        ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
      } else {
        const result = await prepareCanonicalProviderContext(messages, options);
        expect(
          isProtected(
            result.plan.selected.find((item) =>
              item.content.includes("AUTHORIZED_TASK"),
            ),
          ),
        ).toBe(true);
        const other = result.plan.selected.find((item) =>
          item.content.includes("UNAUTHORIZED_REPLACEMENT"),
        );
        if (other) expect(isProtected(other)).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
