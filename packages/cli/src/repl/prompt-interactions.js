/**
 * Small integration controller for the REPL's prompt-side interaction tools.
 * It keeps slash/key dispatch outside the large agent driver and exposes a
 * narrow seam that readline, IDE hosts, and tests can share.
 */
import { buildSessionRecap, renderSessionRecap } from "./session-recap.js";
import { PromptStash, runPromptStashCommand } from "./prompt-stash.js";
import { editPromptInExternalEditor } from "./prompt-editor.js";
import {
  PromptSuggestionController,
  renderPromptSuggestions,
  resolvePromptSuggestionsEnabled,
  runPromptSuggestionsCommand,
} from "./prompt-suggestions.js";
import {
  matchReplKeybinding,
  validateReplKeybindings,
} from "./repl-keybindings.js";
import {
  detectClipboardImageCapability,
  MAX_CLIPBOARD_IMAGE_ATTACHMENTS,
  MAX_CLIPBOARD_IMAGE_TOTAL_BYTES,
  readClipboardImageChip,
} from "./clipboard-image.js";
import { layoutTerminalText } from "./terminal-layout.js";
import { SlashCommandRegistry } from "./slash-command-registry.js";

function commandArgs(line, command) {
  const text = String(line || "");
  if (text === command) return "";
  return text.startsWith(`${command} `) ? text.slice(command.length + 1) : null;
}

function safeErrorText(value) {
  return String(value || "Interaction failed")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trimEnd())
    .join("\n");
}

function boundedClipboardQueueLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export const PROMPT_INTERACTION_SLASH_COMMANDS = Object.freeze([
  Object.freeze({
    name: "/recap",
    description: "Show a lightweight recap from the session index",
  }),
  Object.freeze({
    name: "/stash",
    description: "Stash/list/pop/clear draft prompts",
  }),
  Object.freeze({
    name: "/editor",
    description: "Edit a draft prompt in an external editor",
  }),
  Object.freeze({
    name: "/suggestions",
    description: "Control background prompt suggestions",
  }),
  Object.freeze({
    name: "/paste-image",
    description: "Attach a clipboard image when the terminal host supports it",
  }),
]);

/** Register the interaction surface in the shared slash-command registry. */
export function registerPromptInteractionCommands(registry, controller) {
  if (typeof registry?.register !== "function") {
    throw new TypeError("a slash command registry is required");
  }
  if (typeof controller?.handleSlash !== "function") {
    throw new TypeError("a prompt interaction controller is required");
  }
  for (const command of PROMPT_INTERACTION_SLASH_COMMANDS) {
    registry.register(command.name, {
      description: command.description,
      handler: (args) => {
        const suffix = String(args || "").trim();
        return controller.handleSlash(
          `${command.name}${suffix ? ` ${suffix}` : ""}`,
        );
      },
    });
  }
  return PROMPT_INTERACTION_SLASH_COMMANDS.map((command) => command.name);
}

/** Build one session-local controller + registry dispatcher for production. */
export function createPromptInteractionSurface(options = {}) {
  const controller =
    options.controller || new PromptInteractionController(options);
  const registry = options.registry || new SlashCommandRegistry();
  const commandNames = new Set(
    registerPromptInteractionCommands(registry, controller),
  );
  return {
    controller,
    registry,
    commandNames,
    async dispatchSlash(line) {
      const text = String(line || "").trim();
      const commandName = text.split(/\s+/, 1)[0];
      if (!commandNames.has(commandName)) return { handled: false };
      const command = registry.getCommand(commandName);
      const args = text.slice(commandName.length).trim();
      return command.handler(args);
    },
  };
}

export class PromptInteractionController {
  constructor(options = {}) {
    this.readline = options.readline || null;
    this.write =
      options.write || ((text) => process.stdout.write(String(text)));
    this.writeError =
      options.writeError || ((text) => process.stderr.write(String(text)));
    this.refresh =
      options.refresh ||
      (() => {
        this.readline?._refreshLine?.();
      });
    this.getSessionId =
      typeof options.getSessionId === "function"
        ? options.getSessionId
        : () => options.sessionId || null;
    this.getSuggestionContext =
      typeof options.getSuggestionContext === "function"
        ? options.getSuggestionContext
        : () => ({});
    this.screenReader = options.screenReader === true;
    this.getColumns =
      typeof options.getColumns === "function"
        ? options.getColumns
        : () => this.readline?.output?.columns || process.stdout.columns || 80;
    this.stash = options.stash || new PromptStash(options.stashOptions);
    this.editPrompt = options.editPrompt || editPromptInExternalEditor;
    this.buildRecap = options.buildRecap || buildSessionRecap;
    this.renderRecap = options.renderRecap || renderSessionRecap;
    this.persistSuggestionEnabled = options.persistSuggestionEnabled;
    this.clipboardBinding = options.clipboardBinding || null;
    this.clipboardImageChips = [];
    this.clipboardImageBytes = 0;
    this.maxClipboardImageAttachments = boundedClipboardQueueLimit(
      options.maxClipboardImageAttachments,
      MAX_CLIPBOARD_IMAGE_ATTACHMENTS,
      MAX_CLIPBOARD_IMAGE_ATTACHMENTS,
    );
    this.maxClipboardImageTotalBytes = boundedClipboardQueueLimit(
      options.maxClipboardImageTotalBytes,
      MAX_CLIPBOARD_IMAGE_TOTAL_BYTES,
      MAX_CLIPBOARD_IMAGE_TOTAL_BYTES,
    );

    const validated = validateReplKeybindings(options.keybindings || {});
    this.keybindingDiagnostics = validated.errors.slice();
    this.keybindings = validated.valid
      ? validated
      : validateReplKeybindings({});

    const enabled = resolvePromptSuggestionsEnabled({
      config: options.config || {},
      env: options.env || process.env,
    });
    this.suggestions =
      options.suggestionController ||
      new PromptSuggestionController({
        enabled,
        generate: options.generateSuggestions,
        debounceMs: options.suggestionDebounceMs ?? 120,
        onUpdate: (suggestions) => this._showSuggestionUpdate(suggestions),
      });
  }

  _line() {
    return String(this.readline?.line || "");
  }

  _replaceLine(value) {
    if (!this.readline) return false;
    const text = String(value ?? "");
    this.readline.line = text;
    this.readline.cursor = text.length;
    this.refresh();
    return true;
  }

  _print(message, { error = false, refresh = false } = {}) {
    if (message) {
      const rawContent = error ? safeErrorText(message) : String(message);
      const content = layoutTerminalText(rawContent, {
        columns: this.getColumns(),
        screenReader: this.screenReader,
      });
      const output = `${content.replace(/\n?$/, "\n")}`;
      (error ? this.writeError : this.write)(output);
    }
    if (refresh) this.refresh();
  }

  _showSuggestionUpdate(suggestions) {
    if (this.screenReader || !suggestions.length) return;
    this._print(`\n${renderPromptSuggestions(suggestions)}`, { refresh: true });
  }

  _suggestionContext(overrides = {}) {
    let live = {};
    try {
      const value = this.getSuggestionContext();
      if (value && typeof value === "object") live = value;
    } catch {
      // Suggestion context is optional polish and cannot break prompt input.
    }
    return {
      ...live,
      ...overrides,
      sessionId:
        overrides.sessionId || live.sessionId || this.getSessionId() || null,
    };
  }

  diagnostics() {
    return {
      keybindingErrors: this.keybindingDiagnostics.slice(),
      clipboardImage: detectClipboardImageCapability(this.clipboardBinding),
      suggestions: this.suggestions.status(),
    };
  }

  /** Returns `{ handled }`; popped/edited prompts stay editable, never submit. */
  async handleSlash(line) {
    try {
      return await this._handleSlash(line);
    } catch (error) {
      const message = `Prompt interaction failed: ${safeErrorText(error.message)}`;
      this._print(message, { error: true });
      return { handled: true, ok: false, action: "error", message };
    }
  }

  async _handleSlash(line) {
    const recapArgs = commandArgs(line, "/recap");
    if (recapArgs !== null) {
      const sessionId = recapArgs.trim() || this.getSessionId();
      const recap = this.buildRecap(sessionId || "");
      this._print(this.renderRecap(recap));
      return { handled: true, action: "recap", recap };
    }

    const stashArgs = commandArgs(line, "/stash");
    if (stashArgs !== null) {
      const result = runPromptStashCommand(stashArgs, { stash: this.stash });
      if (result.prompt != null) this._replaceLine(result.prompt);
      this._print(result.message, { error: !result.ok });
      return { handled: true, ...result };
    }

    let editorArgs = commandArgs(line, "/editor");
    if (editorArgs === null) editorArgs = commandArgs(line, "/edit-prompt");
    if (editorArgs !== null) {
      const seed = editorArgs || this._line();
      const result = this.editPrompt(seed);
      if (result.ok) {
        this._replaceLine(result.content);
        this._print(
          result.changed
            ? "Edited prompt restored to the input buffer."
            : "Editor closed; prompt was unchanged.",
        );
      } else {
        this._print(result.reason, { error: true });
      }
      return { handled: true, action: "editor", ...result };
    }

    const suggestionArgs = commandArgs(line, "/suggestions");
    if (suggestionArgs !== null) {
      const result = runPromptSuggestionsCommand(suggestionArgs, {
        controller: this.suggestions,
        persistEnabled: this.persistSuggestionEnabled,
        context: this._suggestionContext(),
      });
      this._print(result.message, { error: !result.ok });
      return { handled: true, ...result };
    }

    const imageArgs = commandArgs(line, "/paste-image");
    if (imageArgs !== null) {
      if (imageArgs.trim()) {
        const result = {
          ok: false,
          reason: "Usage: /paste-image (the command takes no arguments)",
        };
        this._print(result.reason, { error: true });
        return { handled: true, action: "paste-image", ...result };
      }
      if (
        this.clipboardImageChips.length >= this.maxClipboardImageAttachments
      ) {
        const result = {
          ok: false,
          supported: true,
          mode: detectClipboardImageCapability(this.clipboardBinding).mode,
          reason: `Clipboard attachment queue is limited to ${this.maxClipboardImageAttachments} images.`,
        };
        this._print(result.reason, { error: true });
        return { handled: true, action: "paste-image", ...result };
      }
      let result = await readClipboardImageChip(this.clipboardBinding);
      if (result.ok) {
        if (
          this.clipboardImageBytes + result.bytes >
          this.maxClipboardImageTotalBytes
        ) {
          result = {
            ok: false,
            supported: true,
            mode: result.mode,
            reason: `Clipboard attachment queue exceeds ${this.maxClipboardImageTotalBytes} bytes.`,
          };
          this._print(result.reason, { error: true });
        } else {
          this.clipboardImageChips.push(result.chip);
          this.clipboardImageBytes += result.bytes;
          this._print(
            `Image attached from clipboard (${result.mediaType}, ${result.bytes} bytes).`,
          );
        }
      } else {
        this._print(result.reason, { error: true });
      }
      return { handled: true, action: "paste-image", ...result };
    }

    return { handled: false };
  }

  /** Handle only declared custom chords. Returns true when consumed. */
  handleKeypress(input, key) {
    try {
      return this._handleKeypress(input, key);
    } catch (error) {
      this._print(
        `Prompt interaction failed: ${safeErrorText(error.message)}`,
        {
          error: true,
          refresh: true,
        },
      );
      return true;
    }
  }

  _handleKeypress(input, key) {
    const action = matchReplKeybinding(this.keybindings, input, key);
    if (!action) return false;
    if (action === "prompt.edit") {
      const result = this.editPrompt(this._line());
      if (result.ok) this._replaceLine(result.content);
      else this._print(result.reason, { error: true, refresh: true });
      return true;
    }
    if (action === "prompt.stash") {
      const current = this._line();
      if (!current.trim()) {
        this._print("Nothing to stash.", { error: true, refresh: true });
        return true;
      }
      const result = runPromptStashCommand("", {
        stash: this.stash,
        currentPrompt: current,
      });
      this._replaceLine("");
      this._print(result.message, { refresh: true });
      return true;
    }
    if (action === "prompt.pop") {
      const result = runPromptStashCommand("pop", { stash: this.stash });
      if (result.prompt != null) this._replaceLine(result.prompt);
      this._print(result.message, { error: !result.ok, refresh: true });
      return true;
    }
    if (action === "session.recap") {
      const recap = this.buildRecap(this.getSessionId() || "");
      this._print(this.renderRecap(recap), { refresh: true });
      return true;
    }
    if (action === "suggestions.toggle") {
      const enabled = !this.suggestions.status().enabled;
      try {
        this.persistSuggestionEnabled?.(enabled);
      } catch (error) {
        this._print(`Could not update prompt suggestions: ${error.message}`, {
          error: true,
          refresh: true,
        });
        return true;
      }
      this.suggestions.setEnabled(enabled);
      this._print(`Prompt suggestions ${enabled ? "enabled" : "disabled"}.`, {
        refresh: true,
      });
      return true;
    }
    return false;
  }

  scheduleSuggestions(context = {}) {
    return this.suggestions.schedule(this._suggestionContext(context));
  }

  takeClipboardImageChips() {
    const chips = this.clipboardImageChips.slice();
    this.clipboardImageChips.length = 0;
    this.clipboardImageBytes = 0;
    return chips;
  }

  clearClipboardImageChips() {
    const cleared = this.clipboardImageChips.length;
    this.clipboardImageChips.length = 0;
    this.clipboardImageBytes = 0;
    return cleared;
  }

  dispose() {
    this.suggestions.dispose();
    this.clearClipboardImageChips();
  }
}

/**
 * Merge host-provided clipboard image chips into a prepared user message.
 * Only bounded data-image blocks produced by clipboard-image.js are accepted;
 * a host cannot smuggle a remote URL into the model through this seam.
 */
export function mergeClipboardImageChips(content, chips = []) {
  const accepted = (Array.isArray(chips) ? chips : []).filter(
    (chip) =>
      chip?.type === "image_url" &&
      /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(
        String(chip.image_url?.url || ""),
      ),
  );
  if (!accepted.length) return { content, attached: 0 };
  const parts = Array.isArray(content)
    ? content.slice()
    : String(content || "")
      ? [{ type: "text", text: String(content) }]
      : [];
  parts.push(...accepted);
  return { content: parts, attached: accepted.length };
}
