import { describe, expect, it, vi } from "vitest";
import {
  createPromptInteractionSurface,
  mergeClipboardImageChips,
  PromptInteractionController,
  registerPromptInteractionCommands,
} from "../../src/repl/prompt-interactions.js";
import { SlashCommandRegistry } from "../../src/repl/slash-command-registry.js";
import { PromptSuggestionController } from "../../src/repl/prompt-suggestions.js";

function harness(options = {}) {
  const output = [];
  const errors = [];
  const readline = {
    line: options.line || "",
    cursor: (options.line || "").length,
    _refreshLine: vi.fn(),
  };
  const stashEntries = [];
  const stash = {
    stash: vi.fn((text) => {
      const entry = { id: "x", text, createdAt: 1 };
      stashEntries.push(entry);
      return entry;
    }),
    list: vi.fn(() => stashEntries.slice().reverse()),
    pop: vi.fn(() => stashEntries.pop() || null),
    clear: vi.fn(() => stashEntries.splice(0).length),
  };
  const suggestionController =
    options.suggestionController ||
    new PromptSuggestionController({ enabled: true, debounceMs: 0 });
  const controller = new PromptInteractionController({
    readline,
    stash,
    suggestionController,
    sessionId: "session-1",
    write: (text) => output.push(text),
    writeError: (text) => errors.push(text),
    buildRecap:
      options.buildRecap ||
      ((sessionId) => ({ found: true, sessionId, title: "Recap" })),
    renderRecap: options.renderRecap || ((recap) => `recap:${recap.sessionId}`),
    editPrompt:
      options.editPrompt ||
      ((text) => ({ ok: true, content: `${text} edited`, changed: true })),
    keybindings: options.keybindings,
    clipboardBinding: options.clipboardBinding,
    persistSuggestionEnabled: options.persistSuggestionEnabled,
    getSuggestionContext: options.getSuggestionContext,
    getColumns: options.getColumns,
    screenReader: options.screenReader,
  });
  return { controller, readline, stash, output, errors };
}

describe("prompt interaction controller", () => {
  it("registers the interaction commands in the shared slash registry shape", async () => {
    const h = harness();
    const commands = new Map();
    const registered = registerPromptInteractionCommands(
      {
        register: (name, definition) => commands.set(name, definition),
      },
      h.controller,
    );
    expect(registered).toEqual([
      "/recap",
      "/stash",
      "/editor",
      "/suggestions",
      "/paste-image",
    ]);
    await commands.get("/recap").handler("");
    expect(h.output.join("")).toContain("recap:session-1");
  });

  it("builds a session-local production surface backed by SlashCommandRegistry", async () => {
    const h = harness();
    const surface = createPromptInteractionSurface({
      controller: h.controller,
    });
    expect(surface.registry).toBeInstanceOf(SlashCommandRegistry);
    await expect(
      surface.dispatchSlash("/recap live-session"),
    ).resolves.toMatchObject({ handled: true, action: "recap" });
    expect(h.output.join("")).toContain("recap:live-session");
    await expect(surface.dispatchSlash("/model x")).resolves.toEqual({
      handled: false,
    });
  });

  it("routes recap without reading or mutating the live message array", async () => {
    const buildRecap = vi.fn((sessionId) => ({ found: true, sessionId }));
    const h = harness({ buildRecap });
    const result = await h.controller.handleSlash("/recap");
    expect(result).toMatchObject({ handled: true, action: "recap" });
    expect(buildRecap).toHaveBeenCalledWith("session-1");
    expect(h.output.join("")).toContain("recap:session-1");
  });

  it("supports stash/list/pop/clear and restores popped prompts for editing", async () => {
    const h = harness();
    await h.controller.handleSlash("/stash first prompt");
    expect(h.stash.stash).toHaveBeenCalledWith("first prompt");
    const listed = await h.controller.handleSlash("/stash list");
    expect(listed.entries).toHaveLength(1);
    await h.controller.handleSlash("/stash pop");
    expect(h.readline.line).toBe("first prompt");
    expect(h.readline.cursor).toBe(12);
    const cleared = await h.controller.handleSlash("/stash clear");
    expect(cleared.count).toBe(0);
  });

  it("leaves editor output in the input buffer instead of submitting it", async () => {
    const editPrompt = vi.fn((text) => ({
      ok: true,
      content: `${text} edited`,
      changed: true,
    }));
    const h = harness({ editPrompt });
    const result = await h.controller.handleSlash("/editor draft");
    expect(result.handled).toBe(true);
    expect(editPrompt).toHaveBeenCalledWith("draft");
    expect(h.readline.line).toBe("draft edited");
  });

  it("dispatches custom keybindings to prompt actions", () => {
    const persistSuggestionEnabled = vi.fn();
    const h = harness({
      line: "hotkey draft",
      keybindings: {
        "prompt.edit": [],
        "prompt.stash": "alt+x",
        "prompt.pop": "alt+y",
        "session.recap": [],
        "suggestions.toggle": "alt+n",
      },
      persistSuggestionEnabled,
    });
    expect(h.controller.handleKeypress("x", { name: "x", meta: true })).toBe(
      true,
    );
    expect(h.stash.stash).toHaveBeenCalledWith("hotkey draft");
    expect(h.readline.line).toBe("");
    expect(h.controller.handleKeypress("y", { name: "y", meta: true })).toBe(
      true,
    );
    expect(h.readline.line).toBe("hotkey draft");
    expect(h.controller.handleKeypress("n", { name: "n", meta: true })).toBe(
      true,
    );
    expect(persistSuggestionEnabled).toHaveBeenCalledWith(false);
  });

  it("surfaces a truthful clipboard fallback and queues host image chips", async () => {
    const unsupported = harness();
    const fallback = await unsupported.controller.handleSlash("/paste-image");
    expect(fallback).toMatchObject({
      handled: true,
      ok: false,
      mode: "path-fallback",
    });
    expect(unsupported.errors.join("")).toContain("paste its png/jpg");

    const supported = harness({
      clipboardBinding: {
        supportsImagePaste: true,
        readImage: async () => ({
          mediaType: "image/png",
          data: Buffer.from("image"),
        }),
      },
    });
    expect(
      await supported.controller.handleSlash("/paste-image"),
    ).toMatchObject({
      ok: true,
    });
    expect(supported.controller.takeClipboardImageChips()).toHaveLength(1);
    expect(supported.controller.takeClipboardImageChips()).toEqual([]);
  });

  it("merges only local data-image chips into multimodal turn content", () => {
    const valid = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,aW1hZ2U=" },
    };
    const remote = {
      type: "image_url",
      image_url: { url: "https://example.test/private.png" },
    };
    expect(mergeClipboardImageChips("inspect this", [valid, remote])).toEqual({
      attached: 1,
      content: [{ type: "text", text: "inspect this" }, valid],
    });
    expect(mergeClipboardImageChips("plain", [remote])).toEqual({
      attached: 0,
      content: "plain",
    });
  });

  it("refreshes suggestions with the live assistant message context", async () => {
    const generate = vi.fn(async () => ["continue from the live answer"]);
    const suggestionController = new PromptSuggestionController({
      generate,
      debounceMs: 0,
    });
    const messages = [{ role: "assistant", content: "live answer" }];
    const h = harness({
      suggestionController,
      getSuggestionContext: () => ({ messages }),
    });
    const refresh = await h.controller.handleSlash("/suggestions refresh");
    await expect(refresh.promise).resolves.toMatchObject({ status: "ready" });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        messages,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("falls back to safe defaults when configured keybindings are invalid", () => {
    const h = harness({
      line: "draft",
      keybindings: {
        "prompt.edit": "ctrl+c",
      },
    });
    expect(h.controller.diagnostics().keybindingErrors[0]).toContain(
      "reserved",
    );
    expect(h.controller.handleKeypress("g", { name: "g", ctrl: true })).toBe(
      true,
    );
    expect(h.readline.line).toBe("draft edited");
  });

  it("does not bypass a persisted settings lock from the toggle key", () => {
    const suggestionController = new PromptSuggestionController({
      enabled: true,
    });
    const h = harness({
      suggestionController,
      keybindings: {
        "prompt.edit": [],
        "prompt.stash": [],
        "prompt.pop": [],
        "session.recap": [],
        "suggestions.toggle": "alt+n",
      },
      persistSuggestionEnabled: () => {
        throw new Error("managed setting is locked");
      },
    });
    expect(h.controller.handleKeypress("n", { name: "n", meta: true })).toBe(
      true,
    );
    expect(suggestionController.status().enabled).toBe(true);
    expect(h.errors.join("")).toContain("managed setting is locked");
  });

  it("returns unrecognized slash input to the main dispatcher", async () => {
    const h = harness();
    await expect(h.controller.handleSlash("/model x")).resolves.toEqual({
      handled: false,
    });
  });

  it("contains storage errors and strips terminal control characters", async () => {
    const h = harness();
    h.stash.list.mockImplementation(() => {
      throw new Error("bad\u001b[31m stash");
    });
    await expect(
      h.controller.handleSlash("/stash list"),
    ).resolves.toMatchObject({
      handled: true,
      ok: false,
      action: "error",
    });
    expect(h.errors.join("")).toContain("bad [31m stash");
    expect(h.errors.join("")).not.toContain(String.fromCharCode(27));
  });

  it("re-reads terminal columns for each output and keeps screen-reader lines stable", async () => {
    let columns = 12;
    const narrow = harness({ getColumns: () => columns });
    await narrow.controller.handleSlash("/recap");
    expect(narrow.output.join("")).toContain("recap:sessio\nn-1");
    columns = 80;
    await narrow.controller.handleSlash("/recap");
    expect(narrow.output.at(-1)).toContain("recap:session-1");

    const reader = harness({ getColumns: () => 8, screenReader: true });
    await reader.controller.handleSlash("/recap");
    expect(reader.output.join("")).toContain("recap:session-1");
  });
});
