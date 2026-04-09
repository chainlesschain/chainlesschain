import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUnifiedToolsStore } from "../unified-tools";

describe("useUnifiedToolsStore", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke.mockReset();
    (globalThis as any).window = {
      electronAPI: {
        invoke,
      },
    };
  });

  it("collects canonical categories from tools and skills", async () => {
    const store = useUnifiedToolsStore();

    invoke
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: "read_file",
            description: "Read file",
            inputSchema: { type: "object", properties: {} },
            parameters: { type: "object", properties: {} },
            category: "read",
            skillCategory: null,
            source: "builtin",
            instructions: "",
            examples: [],
            tags: [],
            available: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: "automation-skill",
            displayName: "Automation Skill",
            description: "Automation",
            category: "automation",
            instructions: "",
            examples: [],
            toolNames: ["read_file"],
            source: "builtin-skill",
            version: "1.0.0",
            tags: [],
          },
        ],
      });

    await store.loadAll();

    expect(store.categories).toEqual(["automation", "read"]);
    expect(store.tools[0].category).toBe("read");
    expect(store.tools[0].inputSchema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("filters tools by canonical category with skillCategory fallback", () => {
    const store = useUnifiedToolsStore();
    store.tools = [
      {
        name: "read_file",
        description: "Read file",
        inputSchema: { type: "object", properties: {} },
        parameters: { type: "object", properties: {} },
        category: "read",
        skillName: null,
        skillCategory: null,
        source: "builtin",
        instructions: "",
        examples: [],
        tags: [],
        available: true,
      },
      {
        name: "browser_click",
        description: "Click browser element",
        inputSchema: { type: "object", properties: {} },
        parameters: { type: "object", properties: {} },
        category: "automation",
        skillName: "browser-automation",
        skillCategory: "automation",
        source: "builtin",
        instructions: "",
        examples: [],
        tags: [],
        available: true,
      },
      {
        name: "legacy_tool",
        description: "Legacy grouped tool",
        inputSchema: { type: "object", properties: {} },
        parameters: { type: "object", properties: {} },
        category: null,
        skillName: "legacy-skill",
        skillCategory: "legacy",
        source: "tool-group",
        instructions: "",
        examples: [],
        tags: [],
        available: true,
      },
    ];

    store.setFilterCategory("read");
    expect(store.filteredTools.map((tool) => tool.name)).toEqual(["read_file"]);

    store.setFilterCategory("legacy");
    expect(store.filteredTools.map((tool) => tool.name)).toEqual(["legacy_tool"]);
  });
});
