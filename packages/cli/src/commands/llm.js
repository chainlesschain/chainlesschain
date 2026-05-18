/**
 * LLM management commands
 * chainlesschain llm models|test|providers|add-provider|switch
 */

import ora from "ora";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  BUILT_IN_PROVIDERS,
  LLMProviderRegistry,
  PROVIDER_MATURITY_V2,
  REQUEST_LIFECYCLE_V2,
  getMaxActiveProfilesPerOwnerV2,
  setMaxActiveProfilesPerOwnerV2,
  getMaxPendingRequestsPerProfileV2,
  setMaxPendingRequestsPerProfileV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getRequestStuckMsV2,
  setRequestStuckMsV2,
  registerProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileStatusV2,
  activateProfileV2,
  suspendProfileV2,
  retireProfileV2,
  touchProfileV2,
  createRequestV2,
  getRequestV2,
  listRequestsV2,
  setRequestStatusV2,
  startRequestV2,
  completeRequestV2,
  failRequestV2,
  cancelRequestV2,
  getActiveProfileCountV2,
  getPendingRequestCountV2,
  autoSuspendIdleProfilesV2,
  autoFailStuckRequestsV2,
  getLlmProvidersStatsV2,
} from "../lib/llm-providers.js";

export function registerLlmCommand(program) {
  const llm = program.command("llm").description("LLM provider management");

  // llm models - list available models
  llm
    .command("models")
    .description("List available models from the current provider")
    .option("--provider <provider>", "LLM provider", "ollama")
    .option("--base-url <url>", "API base URL", "http://localhost:11434")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Fetching models...").start();
      try {
        if (options.provider === "ollama") {
          const response = await fetch(`${options.baseUrl}/api/tags`);
          if (!response.ok) {
            throw new Error(`Ollama not reachable: ${response.status}`);
          }
          const data = await response.json();
          spinner.stop();

          if (options.json) {
            console.log(JSON.stringify(data.models, null, 2));
          } else {
            if (!data.models || data.models.length === 0) {
              logger.info("No models installed. Run: ollama pull qwen2:7b");
            } else {
              logger.log(chalk.bold(`Models (${data.models.length}):\n`));
              for (const m of data.models) {
                const size = m.size
                  ? chalk.gray(`(${(m.size / 1e9).toFixed(1)}GB)`)
                  : "";
                logger.log(`  ${chalk.cyan(m.name.padEnd(30))} ${size}`);
              }
            }
          }
        } else {
          // Show known models for non-Ollama providers
          spinner.stop();
          const provider = BUILT_IN_PROVIDERS[options.provider];
          if (provider) {
            if (options.json) {
              console.log(JSON.stringify(provider.models, null, 2));
            } else {
              logger.log(chalk.bold(`${provider.displayName} Models:\n`));
              for (const m of provider.models) {
                logger.log(`  ${chalk.cyan(m)}`);
              }
            }
          } else {
            logger.error(`Unknown provider: ${options.provider}`);
          }
        }
      } catch (err) {
        spinner.fail(`Failed to list models: ${err.message}`);
        process.exit(1);
      }
    });

  // llm test - test connectivity
  llm
    .command("test")
    .description("Test LLM provider connectivity")
    .option("--provider <provider>", "LLM provider", "ollama")
    .option("--model <model>", "Model to test", "qwen2:7b")
    .option("--base-url <url>", "API base URL", "http://localhost:11434")
    .option("--api-key <key>", "API key")
    .action(async (options) => {
      const spinner = ora(`Testing ${options.provider}...`).start();
      try {
        const start = Date.now();

        if (options.provider === "ollama") {
          const response = await fetch(`${options.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: options.model,
              prompt: "Say hi in one word.",
              stream: false,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const elapsed = Date.now() - start;

          spinner.succeed(
            `${chalk.green("Connected")} to Ollama (${options.model}) in ${elapsed}ms`,
          );
          logger.log(
            `  Response: ${chalk.gray(data.response.trim().substring(0, 100))}`,
          );
        } else if (options.provider === "openai") {
          const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
          if (!apiKey) throw new Error("API key required");

          const url =
            options.baseUrl !== "http://localhost:11434"
              ? options.baseUrl
              : "https://api.openai.com/v1";

          const response = await fetch(`${url}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: options.model || "gpt-4o-mini",
              messages: [{ role: "user", content: "Say hi in one word." }],
              max_tokens: 10,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const elapsed = Date.now() - start;

          spinner.succeed(
            `${chalk.green("Connected")} to OpenAI (${options.model || "gpt-4o-mini"}) in ${elapsed}ms`,
          );
          logger.log(
            `  Response: ${chalk.gray(data.choices[0].message.content.trim())}`,
          );
        } else {
          spinner.fail(`Unknown provider: ${options.provider}`);
        }
      } catch (err) {
        spinner.fail(`Test failed: ${err.message}`);
        process.exit(1);
      }
    });

  // llm providers - list all available providers
  llm
    .command("providers")
    .description("List all available LLM providers")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          // Fall back to built-in list without DB
          const providers = Object.values(BUILT_IN_PROVIDERS);
          if (options.json) {
            console.log(JSON.stringify(providers, null, 2));
          } else {
            logger.log(chalk.bold(`LLM Providers (${providers.length}):\n`));
            for (const p of providers) {
              const hasKey = p.apiKeyEnv
                ? process.env[p.apiKeyEnv]
                  ? chalk.green("✓")
                  : chalk.red("✗")
                : chalk.green("✓");
              logger.log(
                `  ${hasKey} ${chalk.cyan(p.name.padEnd(15))} ${p.displayName}`,
              );
              logger.log(`    ${chalk.gray("Models:")} ${p.models.join(", ")}`);
            }
          }
          await shutdown();
          return;
        }

        const db = ctx.db.getDatabase();
        const registry = new LLMProviderRegistry(db);
        const providers = registry.list();
        const active = registry.getActive();

        if (options.json) {
          console.log(JSON.stringify({ active, providers }, null, 2));
        } else {
          logger.log(chalk.bold(`LLM Providers (${providers.length}):\n`));
          for (const p of providers) {
            const isActive = p.name === active ? chalk.green(" [active]") : "";
            const keyStatus = p.hasApiKey
              ? chalk.green("✓")
              : chalk.red("✗ key missing");
            const custom = p.custom ? chalk.yellow(" [custom]") : "";
            logger.log(
              `  ${keyStatus} ${chalk.cyan(p.name.padEnd(15))} ${p.displayName}${isActive}${custom}`,
            );
            logger.log(`    ${chalk.gray("Models:")} ${p.models.join(", ")}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // llm add-provider - add a custom provider
  llm
    .command("add-provider")
    .description("Add a custom LLM provider")
    .argument("<name>", "Provider name")
    .requiredOption("-u, --base-url <url>", "API base URL")
    .option("-d, --display-name <name>", "Display name")
    .option("-k, --api-key-env <var>", "Environment variable for API key")
    .option("-m, --models <models>", "Comma-separated model names")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const registry = new LLMProviderRegistry(db);
        const provider = registry.addProvider(name, {
          displayName: options.displayName || name,
          baseUrl: options.baseUrl,
          apiKeyEnv: options.apiKeyEnv,
          models: options.models
            ? options.models.split(",").map((m) => m.trim())
            : [],
        });

        if (options.json) {
          console.log(JSON.stringify(provider, null, 2));
        } else {
          logger.success(`Added provider ${chalk.cyan(name)}`);
          logger.log(`  ${chalk.gray("URL:")} ${provider.baseUrl}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // llm switch - switch active provider
  llm
    .command("switch")
    .description("Switch the active LLM provider")
    .argument("<name>", "Provider name")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const registry = new LLMProviderRegistry(db);
        const provider = registry.setActive(name);

        if (options.json) {
          console.log(JSON.stringify({ active: name, provider }, null, 2));
        } else {
          logger.success(`Switched to ${chalk.cyan(provider.displayName)}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─── V2 Governance Layer ──────────────────────────────────────────
  const out = (obj) => console.log(JSON.stringify(obj, null, 2));
  const tryRun = (fn) => {
    try {
      fn();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  };

  llm
    .command("provider-maturities-v2")
    .description("List V2 provider maturity states")
    .action(() => out(Object.values(PROVIDER_MATURITY_V2)));

  llm
    .command("request-lifecycles-v2")
    .description("List V2 request lifecycle states")
    .action(() => out(Object.values(REQUEST_LIFECYCLE_V2)));

  llm
    .command("stats-v2")
    .description("V2 llm-providers stats")
    .action(() => out(getLlmProvidersStatsV2()));

  llm
    .command("get-max-active-profiles-v2")
    .description("Get max active profiles per owner (V2)")
    .action(() =>
      out({ maxActiveProfilesPerOwner: getMaxActiveProfilesPerOwnerV2() }),
    );

  llm
    .command("set-max-active-profiles-v2 <n>")
    .description("Set max active profiles per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveProfilesPerOwnerV2(Number(n));
        out({ maxActiveProfilesPerOwner: getMaxActiveProfilesPerOwnerV2() });
      }),
    );

  llm
    .command("get-max-pending-requests-v2")
    .description("Get max pending requests per profile (V2)")
    .action(() =>
      out({
        maxPendingRequestsPerProfile: getMaxPendingRequestsPerProfileV2(),
      }),
    );

  llm
    .command("set-max-pending-requests-v2 <n>")
    .description("Set max pending requests per profile (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingRequestsPerProfileV2(Number(n));
        out({
          maxPendingRequestsPerProfile: getMaxPendingRequestsPerProfileV2(),
        });
      }),
    );

  llm
    .command("get-profile-idle-ms-v2")
    .description("Get profile idle threshold (V2)")
    .action(() => out({ profileIdleMs: getProfileIdleMsV2() }));

  llm
    .command("set-profile-idle-ms-v2 <ms>")
    .description("Set profile idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setProfileIdleMsV2(Number(ms));
        out({ profileIdleMs: getProfileIdleMsV2() });
      }),
    );

  llm
    .command("get-request-stuck-ms-v2")
    .description("Get request stuck threshold (V2)")
    .action(() => out({ requestStuckMs: getRequestStuckMsV2() }));

  llm
    .command("set-request-stuck-ms-v2 <ms>")
    .description("Set request stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setRequestStuckMsV2(Number(ms));
        out({ requestStuckMs: getRequestStuckMsV2() });
      }),
    );

  llm
    .command("active-profile-count-v2 <ownerId>")
    .description("Active profile count for owner (V2)")
    .action((ownerId) =>
      out({ ownerId, count: getActiveProfileCountV2(ownerId) }),
    );

  llm
    .command("pending-request-count-v2 <profileId>")
    .description("Pending request count for profile (V2)")
    .action((profileId) =>
      out({ profileId, count: getPendingRequestCountV2(profileId) }),
    );

  llm
    .command("register-profile-v2 <id>")
    .description("Register a V2 profile")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-p, --provider <name>", "provider name")
    .option("-m, --model <name>", "model name", "default")
    .action((id, opts) =>
      tryRun(() =>
        out(
          registerProfileV2(id, {
            ownerId: opts.owner,
            provider: opts.provider,
            model: opts.model,
          }),
        ),
      ),
    );

  llm
    .command("get-profile-v2 <id>")
    .description("Get a V2 profile")
    .action((id) => out(getProfileV2(id)));

  llm
    .command("list-profiles-v2")
    .description("List V2 profiles")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .option("-p, --provider <name>", "filter by provider")
    .action((opts) =>
      out(
        listProfilesV2({
          ownerId: opts.owner,
          status: opts.status,
          provider: opts.provider,
        }),
      ),
    );

  llm
    .command("set-profile-status-v2 <id> <next>")
    .description("Set V2 profile status")
    .action((id, next) => tryRun(() => out(setProfileStatusV2(id, next))));

  llm
    .command("activate-profile-v2 <id>")
    .description("Activate a V2 profile")
    .action((id) => tryRun(() => out(activateProfileV2(id))));

  llm
    .command("suspend-profile-v2 <id>")
    .description("Suspend a V2 profile")
    .action((id) => tryRun(() => out(suspendProfileV2(id))));

  llm
    .command("retire-profile-v2 <id>")
    .description("Retire a V2 profile")
    .action((id) => tryRun(() => out(retireProfileV2(id))));

  llm
    .command("touch-profile-v2 <id>")
    .description("Touch a V2 profile")
    .action((id) => tryRun(() => out(touchProfileV2(id))));

  llm
    .command("create-request-v2 <id>")
    .description("Create a V2 request")
    .requiredOption("-p, --profile <id>", "profile id")
    .option("-k, --kind <kind>", "request kind", "completion")
    .action((id, opts) =>
      tryRun(() =>
        out(createRequestV2(id, { profileId: opts.profile, kind: opts.kind })),
      ),
    );

  llm
    .command("get-request-v2 <id>")
    .description("Get a V2 request")
    .action((id) => out(getRequestV2(id)));

  llm
    .command("list-requests-v2")
    .description("List V2 requests")
    .option("-p, --profile <id>", "filter by profile")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listRequestsV2({ profileId: opts.profile, status: opts.status })),
    );

  llm
    .command("set-request-status-v2 <id> <next>")
    .description("Set V2 request status")
    .action((id, next) => tryRun(() => out(setRequestStatusV2(id, next))));

  llm
    .command("start-request-v2 <id>")
    .description("Start a V2 request")
    .action((id) => tryRun(() => out(startRequestV2(id))));

  llm
    .command("complete-request-v2 <id>")
    .description("Complete a V2 request")
    .action((id) => tryRun(() => out(completeRequestV2(id))));

  llm
    .command("fail-request-v2 <id>")
    .description("Fail a V2 request")
    .action((id) => tryRun(() => out(failRequestV2(id))));

  llm
    .command("cancel-request-v2 <id>")
    .description("Cancel a V2 request")
    .action((id) => tryRun(() => out(cancelRequestV2(id))));

  llm
    .command("auto-suspend-idle-profiles-v2")
    .description("Auto-suspend idle V2 profiles")
    .action(() => out(autoSuspendIdleProfilesV2()));

  llm
    .command("auto-fail-stuck-requests-v2")
    .description("Auto-fail stuck V2 requests")
    .action(() => out(autoFailStuckRequestsV2()));
}

// === Iter22 V2 governance overlay ===
export function registerLlmgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "llm");
  if (!parent) return;
  const L = async () => await import("../lib/llm-providers.js");
  parent
    .command("llmgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.LLMGOV_PROFILE_MATURITY_V2,
            completionLifecycle: m.LLMGOV_COMPLETION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("llmgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveLlmgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingLlmgovCompletionsPerProfileV2(),
            idleMs: m.getLlmgovProfileIdleMsV2(),
            stuckMs: m.getLlmgovCompletionStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("llmgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveLlmgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("llmgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingLlmgovCompletionsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("llmgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setLlmgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("llmgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setLlmgovCompletionStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("llmgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--provider <v>", "provider")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerLlmgovProfileV2({ id, owner, provider: o.provider }),
          null,
          2,
        ),
      );
    });
  parent
    .command("llmgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateLlmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-degrade-v2 <id>")
    .description("Degrade profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).degradeLlmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveLlmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchLlmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getLlmgovProfileV2(id), null, 2));
    });
  parent
    .command("llmgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listLlmgovProfilesV2(), null, 2));
    });
  parent
    .command("llmgov-create-completion-v2 <id> <profileId>")
    .description("Create completion")
    .option("--model <v>", "model")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createLlmgovCompletionV2({ id, profileId, model: o.model }),
          null,
          2,
        ),
      );
    });
  parent
    .command("llmgov-inferring-completion-v2 <id>")
    .description("Mark completion as inferring")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).inferringLlmgovCompletionV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-complete-completion-v2 <id>")
    .description("Complete completion")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeCompletionLlmgovV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-fail-completion-v2 <id> [reason]")
    .description("Fail completion")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failLlmgovCompletionV2(id, reason), null, 2),
      );
    });
  parent
    .command("llmgov-cancel-completion-v2 <id> [reason]")
    .description("Cancel completion")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelLlmgovCompletionV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("llmgov-get-completion-v2 <id>")
    .description("Get completion")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getLlmgovCompletionV2(id), null, 2),
      );
    });
  parent
    .command("llmgov-list-completions-v2")
    .description("List completions")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listLlmgovCompletionsV2(), null, 2),
      );
    });
  parent
    .command("llmgov-auto-degrade-idle-v2")
    .description("Auto-degrade idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDegradeIdleLlmgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("llmgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck completions")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckLlmgovCompletionsV2(), null, 2),
      );
    });
  parent
    .command("llmgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getLlmProvidersGovStatsV2(), null, 2),
      );
    });
}

// === Iter27 V2 governance overlay ===
export function registerPoptgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "llm");
  if (!parent) return;
  const L = async () => await import("../lib/provider-options.js");
  parent
    .command("poptgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.POPTGOV_PROFILE_MATURITY_V2,
            resolveLifecycle: m.POPTGOV_RESOLVE_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("poptgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePoptgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPoptgovResolvesPerProfileV2(),
            idleMs: m.getPoptgovProfileIdleMsV2(),
            stuckMs: m.getPoptgovResolveStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("poptgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePoptgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("poptgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPoptgovResolvesPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("poptgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPoptgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("poptgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPoptgovResolveStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("poptgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--provider <v>", "provider")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPoptgovProfileV2({ id, owner, provider: o.provider }),
          null,
          2,
        ),
      );
    });
  parent
    .command("poptgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePoptgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("poptgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).stalePoptgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("poptgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePoptgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("poptgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchPoptgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("poptgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPoptgovProfileV2(id), null, 2));
    });
  parent
    .command("poptgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPoptgovProfilesV2(), null, 2));
    });
  parent
    .command("poptgov-create-resolve-v2 <id> <profileId>")
    .description("Create resolve")
    .option("--option <v>", "option")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPoptgovResolveV2({ id, profileId, option: o.option }),
          null,
          2,
        ),
      );
    });
  parent
    .command("poptgov-resolving-resolve-v2 <id>")
    .description("Mark resolve as resolving")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).resolvingPoptgovResolveV2(id), null, 2),
      );
    });
  parent
    .command("poptgov-complete-resolve-v2 <id>")
    .description("Complete resolve")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeResolvePoptgovV2(id), null, 2),
      );
    });
  parent
    .command("poptgov-fail-resolve-v2 <id> [reason]")
    .description("Fail resolve")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPoptgovResolveV2(id, reason), null, 2),
      );
    });
  parent
    .command("poptgov-cancel-resolve-v2 <id> [reason]")
    .description("Cancel resolve")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPoptgovResolveV2(id, reason), null, 2),
      );
    });
  parent
    .command("poptgov-get-resolve-v2 <id>")
    .description("Get resolve")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPoptgovResolveV2(id), null, 2));
    });
  parent
    .command("poptgov-list-resolves-v2")
    .description("List resolves")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPoptgovResolvesV2(), null, 2));
    });
  parent
    .command("poptgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdlePoptgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("poptgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck resolves")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPoptgovResolvesV2(), null, 2),
      );
    });
  parent
    .command("poptgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getProviderOptionsGovStatsV2(), null, 2),
      );
    });
}
