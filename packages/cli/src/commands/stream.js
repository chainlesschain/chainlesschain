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

// === Iter27 V2 governance overlay ===
export function registerPstrmgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "stream");
  if (!parent) return;
  const L = async () => await import("../lib/provider-stream.js");
  parent
    .command("pstrmgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PSTRMGOV_PROFILE_MATURITY_V2,
            chunkLifecycle: m.PSTRMGOV_CHUNK_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pstrmgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePstrmgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPstrmgovChunksPerProfileV2(),
            idleMs: m.getPstrmgovProfileIdleMsV2(),
            stuckMs: m.getPstrmgovChunkStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pstrmgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePstrmgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pstrmgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPstrmgovChunksPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pstrmgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPstrmgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pstrmgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPstrmgovChunkStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pstrmgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--provider <v>", "provider")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPstrmgovProfileV2({ id, owner, provider: o.provider }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pstrmgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePstrmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).stalePstrmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePstrmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchPstrmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getPstrmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listPstrmgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("pstrmgov-create-chunk-v2 <id> <profileId>")
    .description("Create chunk")
    .option("--tokenId <v>", "tokenId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPstrmgovChunkV2({ id, profileId, tokenId: o.tokenId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pstrmgov-streaming-chunk-v2 <id>")
    .description("Mark chunk as streaming")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).streamingPstrmgovChunkV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-complete-chunk-v2 <id>")
    .description("Complete chunk")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeChunkPstrmgovV2(id), null, 2),
      );
    });
  parent
    .command("pstrmgov-fail-chunk-v2 <id> [reason]")
    .description("Fail chunk")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPstrmgovChunkV2(id, reason), null, 2),
      );
    });
  parent
    .command("pstrmgov-cancel-chunk-v2 <id> [reason]")
    .description("Cancel chunk")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPstrmgovChunkV2(id, reason), null, 2),
      );
    });
  parent
    .command("pstrmgov-get-chunk-v2 <id>")
    .description("Get chunk")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPstrmgovChunkV2(id), null, 2));
    });
  parent
    .command("pstrmgov-list-chunks-v2")
    .description("List chunks")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPstrmgovChunksV2(), null, 2));
    });
  parent
    .command("pstrmgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdlePstrmgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("pstrmgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck chunks")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPstrmgovChunksV2(), null, 2),
      );
    });
  parent
    .command("pstrmgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getProviderStreamGovStatsV2(), null, 2),
      );
    });
}
