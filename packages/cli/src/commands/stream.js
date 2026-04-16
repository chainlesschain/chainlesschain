/**
 * chainlesschain stream "<prompt>" — scriptable StreamRouter demo.
 *
 * Mirrors Desktop's `agent:stream:start` IPC: feed a provider stream through
 * session-core StreamRouter and emit StreamEvent objects as NDJSON on stdout
 * so downstream scripts can consume them line-by-line.
 *
 * Managed Agents parity Phase H — CLI symmetric entry.
 * Provider adapters live in `../lib/provider-stream.js` so the WS
 * `stream.run` route can reuse them (Phase I).
 */

import { logger } from "../lib/logger.js";
import { loadConfig } from "../lib/config-manager.js";
import { buildProviderSource } from "../lib/provider-stream.js";

export function registerStreamCommand(program) {
  program
    .command("stream")
    .description(
      "Stream a single prompt through session-core StreamRouter (NDJSON on stdout)",
    )
    .argument("<prompt>", "The prompt to stream")
    .option("--model <model>", "Model name")
    .option("--provider <provider>", "LLM provider", "ollama")
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option("--text", "Emit concatenated final text instead of NDJSON events")
    .action(async (prompt, options) => {
      const config = loadConfig();
      const provider = options.provider || config.llm?.provider || "ollama";
      const baseUrl = options.baseUrl || config.llm?.baseUrl;
      const apiKey = options.apiKey || config.llm?.apiKey;
      const model = options.model || config.llm?.model;

      try {
        const { createStreamRouter } =
          await import("../lib/session-core-singletons.js");
        const router = createStreamRouter();
        const source = buildProviderSource(provider, {
          model,
          baseUrl,
          apiKey,
          prompt,
        });

        if (options.text) {
          const out = await router.collect(source);
          if (out.errored) {
            logger.error(`Stream errored: ${out.error?.message || out.error}`);
            process.exit(1);
          }
          process.stdout.write(out.text);
          if (!out.text.endsWith("\n")) process.stdout.write("\n");
          return;
        }

        for await (const ev of router.stream(source)) {
          process.stdout.write(`${JSON.stringify(ev)}\n`);
        }
      } catch (err) {
        const ev = {
          type: "error",
          error: err.message,
          ts: Date.now(),
        };
        if (options.text) {
          logger.error(`Failed: ${err.message}`);
        } else {
          process.stdout.write(`${JSON.stringify(ev)}\n`);
        }
        process.exit(1);
      }
    });
}
