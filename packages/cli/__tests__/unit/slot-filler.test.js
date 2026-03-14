/**
 * Unit tests for CLISlotFiller
 *
 * Tests parameter slot filling for agentic workflows:
 * context inference, user prompting, LLM inference, validation, and preference learning.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CLISlotFiller } from "../../src/lib/slot-filler.js";

/** Create a mock interaction adapter */
function mockInteraction(overrides = {}) {
  return {
    askInput: vi.fn().mockResolvedValue("user-input-value"),
    askSelect: vi.fn().mockResolvedValue("user-select-value"),
    ...overrides,
  };
}

/** Create a mock database */
function mockDb(overrides = {}) {
  const stmtRun = vi.fn();
  const stmtAll = vi.fn().mockReturnValue([]);
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({ run: stmtRun, all: stmtAll }),
    _stmtRun: stmtRun,
    _stmtAll: stmtAll,
    ...overrides,
  };
}

describe("CLISlotFiller", () => {
  let interaction;
  let db;

  beforeEach(() => {
    interaction = mockInteraction();
    db = mockDb();
  });

  // ─── Constructor ────────────────────────────────────────────────────

  it("constructor sets llmChat, db, interaction", () => {
    const llmChat = vi.fn();
    const filler = new CLISlotFiller({ llmChat, db, interaction });

    expect(filler.llmChat).toBe(llmChat);
    expect(filler.db).toBe(db);
    expect(filler.interaction).toBe(interaction);
  });

  // ─── fillSlots ─────────────────────────────────────────────────────

  it("fillSlots returns entities and validation", async () => {
    const filler = new CLISlotFiller({ interaction });
    const result = await filler.fillSlots(
      { type: "search", entities: { query: "hello" } },
      {},
    );

    expect(result).toHaveProperty("entities");
    expect(result).toHaveProperty("validation");
    expect(result).toHaveProperty("filledSlots");
    expect(result).toHaveProperty("missingRequired");
    expect(result.entities.query).toBe("hello");
    expect(result.validation.valid).toBe(true);
  });

  it("fillSlots infers fileType from context.currentFile", async () => {
    const filler = new CLISlotFiller({ interaction });
    const result = await filler.fillSlots(
      { type: "create_file", entities: { path: "/tmp" } },
      { currentFile: "app.ts" },
    );

    expect(result.entities.fileType).toBe("ts");
    expect(result.filledSlots).toContain("fileType");
  });

  it("fillSlots infers target from context.currentFile", async () => {
    const filler = new CLISlotFiller({ interaction });
    const result = await filler.fillSlots(
      { type: "edit_file", entities: {} },
      { currentFile: "src/index.js" },
    );

    expect(result.entities.target).toBe("src/index.js");
    expect(result.filledSlots).toContain("target");
  });

  it("fillSlots infers platform from context.hasDockerfile", async () => {
    const filler = new CLISlotFiller({ interaction });
    const result = await filler.fillSlots(
      { type: "deploy", entities: {} },
      { hasDockerfile: true },
    );

    expect(result.entities.platform).toBe("docker");
    expect(result.filledSlots).toContain("platform");
  });

  it("fillSlots infers framework from context.hasVitest", async () => {
    const filler = new CLISlotFiller({ interaction });
    const result = await filler.fillSlots(
      { type: "test", entities: { target: "src/" } },
      { hasVitest: true },
    );

    expect(result.entities.framework).toBe("vitest");
    expect(result.filledSlots).toContain("framework");
  });

  it("fillSlots asks user for missing required slots", async () => {
    interaction.askInput.mockResolvedValue("/src/main.js");
    const filler = new CLISlotFiller({ interaction });

    const result = await filler.fillSlots(
      { type: "edit_file", entities: {} },
      {},
    );

    expect(interaction.askInput).toHaveBeenCalled();
    expect(result.entities.target).toBe("/src/main.js");
  });

  it("fillSlots skips already-filled slots", async () => {
    const filler = new CLISlotFiller({ interaction });

    const result = await filler.fillSlots(
      { type: "search", entities: { query: "existing-value" } },
      {},
    );

    expect(interaction.askInput).not.toHaveBeenCalled();
    expect(result.entities.query).toBe("existing-value");
  });

  it("fillSlots uses LLM for optional slots", async () => {
    const llmChat = vi.fn().mockResolvedValue({
      message: { content: '{"directory": "/opt/project", "fileType": "js"}' },
    });
    const filler = new CLISlotFiller({ llmChat, interaction });

    const result = await filler.fillSlots(
      { type: "search", entities: { query: "find bugs" } },
      {},
    );

    expect(llmChat).toHaveBeenCalled();
    expect(result.entities.directory).toBe("/opt/project");
  });

  it("fillSlots handles LLM inference failure gracefully", async () => {
    const llmChat = vi.fn().mockRejectedValue(new Error("LLM down"));
    const filler = new CLISlotFiller({ llmChat, interaction });

    const result = await filler.fillSlots(
      { type: "search", entities: { query: "test" } },
      {},
    );

    // Should not throw, just skip LLM inference
    expect(result.entities.query).toBe("test");
    expect(result.validation.valid).toBe(true);
  });

  it("fillSlots learns from user preferences", async () => {
    // Simulate no user input and a preference learned from DB
    interaction.askInput.mockRejectedValue(new Error("cancelled"));
    db._stmtAll.mockReturnValue([
      { slot_value: "src/" },
      { slot_value: "src/" },
      { slot_value: "lib/" },
    ]);

    const filler = new CLISlotFiller({ db, interaction });

    const result = await filler.fillSlots(
      { type: "edit_file", entities: {} },
      {},
    );

    // Should have learned "src/" as the most common value
    expect(result.entities.target).toBe("src/");
  });

  it("fillSlots emits slot-inferred event for context inference", async () => {
    const filler = new CLISlotFiller({ interaction });
    const events = [];
    filler.on("slot-inferred", (e) => events.push(e));

    await filler.fillSlots(
      { type: "edit_file", entities: {} },
      { currentFile: "main.py" },
    );

    const contextEvent = events.find((e) => e.source === "context");
    expect(contextEvent).toBeDefined();
    expect(contextEvent.slot).toBe("target");
    expect(contextEvent.value).toBe("main.py");
  });

  it("fillSlots emits slot-filled event for user input", async () => {
    interaction.askInput.mockResolvedValue("user-target");
    const filler = new CLISlotFiller({ interaction });
    const events = [];
    filler.on("slot-filled", (e) => events.push(e));

    await filler.fillSlots({ type: "edit_file", entities: {} }, {});

    const userEvent = events.find((e) => e.source === "user");
    expect(userEvent).toBeDefined();
    expect(userEvent.slot).toBe("target");
    expect(userEvent.value).toBe("user-target");
  });

  // ─── validateSlots ─────────────────────────────────────────────────

  it("validateSlots returns valid when all required filled", () => {
    const filler = new CLISlotFiller({ interaction });
    const result = filler.validateSlots("search", { query: "hello" });

    expect(result.valid).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.completeness).toBe(100);
  });

  it("validateSlots returns missingRequired", () => {
    const filler = new CLISlotFiller({ interaction });
    const result = filler.validateSlots("create_file", {});

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("fileType");
    expect(result.missingRequired).toContain("path");
  });

  it("validateSlots returns completeness percentage", () => {
    const filler = new CLISlotFiller({ interaction });
    const result = filler.validateSlots("create_file", { fileType: "js" });

    expect(result.valid).toBe(false);
    expect(result.completeness).toBe(50); // 1 of 2 required filled
  });

  // ─── askUser ───────────────────────────────────────────────────────

  it("askUser uses select for options", async () => {
    const filler = new CLISlotFiller({ interaction });
    await filler.askUser("fileType");

    expect(interaction.askSelect).toHaveBeenCalledWith(
      "What type of file do you want to create?",
      expect.arrayContaining([
        expect.objectContaining({ name: "JavaScript", value: "js" }),
      ]),
    );
  });

  it("askUser uses input for text", async () => {
    const filler = new CLISlotFiller({ interaction });
    await filler.askUser("path");

    expect(interaction.askInput).toHaveBeenCalledWith(
      "Where should the file be created? (path)",
    );
  });

  // ─── inferFromContext ──────────────────────────────────────────────

  it("inferFromContext returns null for unknown slot", () => {
    const filler = new CLISlotFiller({ interaction });
    const result = filler.inferFromContext("nonexistentSlot", {});

    expect(result).toBeNull();
  });

  // ─── recordHistory ─────────────────────────────────────────────────

  it("recordHistory stores to db", () => {
    const filler = new CLISlotFiller({ db, interaction });

    filler.recordHistory("search", { query: "hello", directory: "/tmp" });

    expect(db.exec).toHaveBeenCalled(); // _ensureHistoryTable
    expect(db.prepare).toHaveBeenCalled();
    // Two entities with truthy values → two stmt.run calls
    expect(db._stmtRun).toHaveBeenCalledTimes(2);
    expect(db._stmtRun).toHaveBeenCalledWith("search", "query", "hello");
    expect(db._stmtRun).toHaveBeenCalledWith("search", "directory", "/tmp");
  });

  // ─── learnUserPreference ───────────────────────────────────────────

  it("learnUserPreference returns most common value", async () => {
    db._stmtAll.mockReturnValue([
      { slot_value: "docker" },
      { slot_value: "docker" },
      { slot_value: "vercel" },
      { slot_value: "docker" },
    ]);

    const filler = new CLISlotFiller({ db, interaction });
    const result = await filler.learnUserPreference("deploy", "platform");

    expect(result).toBe("docker");
  });

  // ─── Static methods ────────────────────────────────────────────────

  it("getSlotDefinitions returns required and optional slots", () => {
    const defs = CLISlotFiller.getSlotDefinitions("test");

    expect(defs.required).toContain("target");
    expect(defs.optional).toContain("framework");
    expect(defs.optional).toContain("coverage");
  });

  it("getSupportedIntents returns intent types", () => {
    const intents = CLISlotFiller.getSupportedIntents();

    expect(intents).toContain("create_file");
    expect(intents).toContain("deploy");
    expect(intents).toContain("search");
    expect(intents).toContain("test");
    expect(intents.length).toBeGreaterThanOrEqual(8);
  });
});
