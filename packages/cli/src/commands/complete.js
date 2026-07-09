/**
 * `cc complete` — inline code completion (fill-in-the-middle) for IDE ghost-text.
 *
 * Reads a JSON request `{prefix, suffix, language, path}` on stdin and prints the
 * raw code to insert at the cursor (or `--json` for a structured reply). The IDE
 * side (VS Code InlineCompletionItemProvider / JetBrains InlineCompletionProvider)
 * builds the request from the editor context and renders the reply as a ghost
 * suggestion. Backend reuse: the SAME provider routing + config as `cc ask`
 * (queryLLM), so it honors the user's configured LLM/provider/key with no new auth.
 *
 * Manual-trigger v1 (the IDE binds it to a keystroke), so a slow/expensive chat
 * model is acceptable; a fast local FIM model (e.g. ollama qwen2.5-coder) just
 * makes it snappier.
 */
import { loadConfig } from "../lib/config-manager.js";
import { resolveOllamaBaseUrl, queryLLM } from "./ask.js";

/** Hard cap so a runaway model can't flood the editor with a whole file. */
export const MAX_COMPLETION_CHARS = 2000;

/**
 * Build the chat prompt that asks the model to fill in code at the cursor.
 * The cursor is marked with a sentinel between prefix and suffix so a plain
 * chat model (no native FIM) still has the full bidirectional context.
 */
export function buildFimPrompt(prefix, suffix, language) {
  const lang = (language || "").trim() || "the given language";
  const before = prefix == null ? "" : String(prefix);
  const after = suffix == null ? "" : String(suffix);
  return [
    `You are an inline code-completion engine for ${lang}.`,
    "Continue the code at the position marked <CURSOR>.",
    "Output ONLY the raw code that should be inserted at the cursor —",
    "no explanations, no markdown code fences, and do not repeat the",
    "surrounding code. If nothing should be inserted, output nothing.",
    "",
    `${before}<CURSOR>${after}`,
  ].join("\n");
}

/**
 * Turn the model's raw reply into an insertion string: strip an accidental
 * markdown fence, drop any echoed <CURSOR> sentinel, and hard-cap the length.
 *
 * We deliberately do NOT trim a suffix overlap here — a naive "completion ends
 * with the suffix's first line" cut eats legitimate trailing tokens (e.g. an
 * `if`-block's own `}`), so duplication is left to the prompt's "do not repeat
 * the surrounding code" instruction instead.
 */
export function cleanCompletion(raw) {
  if (!raw) return "";
  let s = String(raw);
  // A model that ignored "no fences" wraps the code in ```lang … ```.
  s = s.replace(/^\s*```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
  s = s.replace(/<CURSOR>/g, "");
  if (s.length > MAX_COMPLETION_CHARS) s = s.slice(0, MAX_COMPLETION_CHARS);
  // Trim trailing whitespace only — leading indentation is meaningful.
  return s.replace(/\s+$/, "");
}

/** Read a JSON request from stdin (empty string when nothing is piped in). */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

export function registerCompleteCommand(program) {
  program
    .command("complete")
    .description(
      "Inline code completion (FIM) for IDE ghost-text: reads {prefix,suffix,language} JSON on stdin, prints the code to insert.",
    )
    .option("--provider <provider>", "override the LLM provider")
    .option("--model <model>", "override the model")
    .option("--base-url <url>", "override the provider base URL")
    .option("--api-key <key>", "override the API key")
    .option("--json", "output {completion,model,provider} as JSON")
    .action(async (options) => {
      const config = await loadConfig();
      const rawIn = await readStdin();
      let req = {};
      try {
        req = rawIn.trim() ? JSON.parse(rawIn) : {};
      } catch {
        req = {};
      }
      const prefix = typeof req.prefix === "string" ? req.prefix : "";
      const suffix = typeof req.suffix === "string" ? req.suffix : "";
      const language = req.language || "";

      const emit = (completion, extra = {}) => {
        if (options.json) {
          process.stdout.write(JSON.stringify({ completion, ...extra }));
        } else {
          process.stdout.write(completion);
        }
      };

      if (!prefix && !suffix) {
        emit(""); // nothing to complete around
        return;
      }

      const provider = options.provider || config.llm?.provider || "ollama";
      const resolvedOptions = {
        provider,
        model:
          options.model ||
          config.llm?.model ||
          (provider === "ollama" ? "qwen2.5-coder" : undefined),
        apiKey: options.apiKey || config.llm?.apiKey,
      };
      resolvedOptions.baseUrl =
        provider === "ollama"
          ? resolveOllamaBaseUrl({ options, config })
          : options.baseUrl || config.llm?.baseUrl;

      try {
        const reply = await queryLLM(
          buildFimPrompt(prefix, suffix, language),
          resolvedOptions,
        );
        emit(cleanCompletion(reply), {
          model: resolvedOptions.model,
          provider,
        });
      } catch (e) {
        // Ghost-text must fail quiet: an empty suggestion, not an error dump in
        // the editor. --json carries the reason for debugging.
        if (options.json) {
          emit("", { error: String(e?.message || e) });
        } else {
          process.stderr.write(String(e?.message || e) + "\n");
          process.exitCode = 1;
        }
      }
    });
}
