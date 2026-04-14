/**
 * Multi-agent collaboration commands
 * chainlesschain cowork debate|compare|analyze|status
 */

import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";

export function registerCoworkCommand(program) {
  const cowork = program
    .command("cowork")
    .description(
      "Multi-agent collaboration (debate review, A/B comparison, analysis)",
    );

  // cowork debate — multi-perspective code review
  cowork
    .command("debate")
    .description("Multi-agent debate review of a file or topic")
    .argument("<file-or-topic>", "File path to review, or a topic/question")
    .option(
      "--perspectives <list>",
      "Comma-separated perspectives (performance,security,maintainability,correctness,architecture)",
      "performance,security,maintainability",
    )
    .option("--provider <name>", "LLM provider to use")
    .option("--model <name>", "LLM model to use")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      const { startDebate, DEFAULT_PERSPECTIVES } =
        await import("../lib/cowork/debate-review-cli.js");

      const perspectives = options.perspectives
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      // Read file content if target is a file path
      let code = target;
      let targetLabel = target;
      const resolved = path.resolve(target);
      if (fs.existsSync(resolved)) {
        try {
          code = fs.readFileSync(resolved, "utf-8");
          targetLabel = resolved;
          if (code.length > 15000) {
            code = code.substring(0, 15000) + "\n... (truncated)";
          }
        } catch (err) {
          logger.error(`Cannot read file: ${err.message}`);
          process.exit(1);
        }
      }

      const spinner = ora(
        `Running debate review with ${perspectives.length} perspectives...`,
      ).start();

      try {
        const llmOptions = {};
        if (options.provider) llmOptions.provider = options.provider;
        if (options.model) llmOptions.model = options.model;

        const result = await startDebate({
          target: targetLabel,
          code,
          perspectives,
          llmOptions,
        });
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Display results
        logger.log(chalk.bold(`\nDebate Review: ${targetLabel}\n`));

        for (const review of result.reviews) {
          const verdictColor =
            review.verdict === "APPROVE"
              ? chalk.green
              : review.verdict === "REJECT"
                ? chalk.red
                : chalk.yellow;
          logger.log(
            chalk.bold(`  ${review.role}: `) + verdictColor(review.verdict),
          );
          // Show first few lines of the review
          const lines = review.review.split("\n").slice(0, 8);
          for (const line of lines) {
            logger.log(chalk.gray(`    ${line}`));
          }
          if (review.review.split("\n").length > 8) {
            logger.log(chalk.gray("    ..."));
          }
          logger.log("");
        }

        logger.log(chalk.bold("Final Verdict"));
        const verdictColor =
          result.verdict === "APPROVE"
            ? chalk.green
            : result.verdict === "REJECT"
              ? chalk.red
              : chalk.yellow;
        logger.log(`  Verdict:    ${verdictColor(result.verdict)}`);
        logger.log(`  Consensus:  ${result.consensusScore}%`);
        logger.log("");

        // Show moderator summary
        const summaryLines = result.summary.split("\n").slice(0, 15);
        for (const line of summaryLines) {
          logger.log(chalk.gray(`  ${line}`));
        }
        logger.log("");
      } catch (err) {
        spinner.fail(`Debate review failed: ${err.message}`);
        if (program.opts().verbose) console.error(err.stack);
        process.exit(1);
      }
    });

  // cowork compare — A/B solution comparison
  cowork
    .command("compare")
    .description("Generate and compare multiple solution variants")
    .argument("<prompt>", "Task or problem description")
    .option("--variants <n>", "Number of variants to generate (max 4)", "3")
    .option(
      "--criteria <list>",
      "Comma-separated evaluation criteria",
      "quality,performance,readability",
    )
    .option("--provider <name>", "LLM provider to use")
    .option("--model <name>", "LLM model to use")
    .option("--json", "Output as JSON")
    .action(async (prompt, options) => {
      const { compare } = await import("../lib/cowork/ab-comparator-cli.js");

      const variants = parseInt(options.variants, 10) || 3;
      const criteria = options.criteria
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      const spinner = ora(
        `Generating ${variants} solution variants...`,
      ).start();

      try {
        const llmOptions = {};
        if (options.provider) llmOptions.provider = options.provider;
        if (options.model) llmOptions.model = options.model;

        const result = await compare({
          prompt,
          variants,
          criteria,
          llmOptions,
        });
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        logger.log(chalk.bold(`\nA/B Comparison: ${prompt}\n`));
        logger.log(chalk.gray(`Criteria: ${criteria.join(", ")}\n`));

        for (const v of result.variants) {
          logger.log(
            chalk.bold(`  Variant: ${chalk.cyan(v.name)}`) +
              chalk.gray(` (total: ${v.totalScore})`),
          );

          // Show scores
          if (v.scores && Object.keys(v.scores).length > 0) {
            const scoreStr = Object.entries(v.scores)
              .map(([k, val]) => `${k}=${val}`)
              .join(", ");
            logger.log(chalk.gray(`    Scores: ${scoreStr}`));
          }

          // Show first lines of solution
          const lines = v.solution.split("\n").slice(0, 6);
          for (const line of lines) {
            logger.log(chalk.gray(`    ${line}`));
          }
          if (v.solution.split("\n").length > 6) {
            logger.log(chalk.gray("    ..."));
          }
          logger.log("");
        }

        logger.log(chalk.bold("Result"));
        logger.log(`  Winner:  ${chalk.green(result.winner)}`);
        logger.log(`  Reason:  ${chalk.gray(result.reason)}`);
        if (result.ranking.length > 0) {
          logger.log(
            `  Ranking: ${result.ranking.map((r, i) => (i === 0 ? chalk.green(r) : chalk.gray(r))).join(" > ")}`,
          );
        }
        logger.log("");
      } catch (err) {
        spinner.fail(`Comparison failed: ${err.message}`);
        if (program.opts().verbose) console.error(err.stack);
        process.exit(1);
      }
    });

  // cowork analyze — code analysis (Phase 4B placeholder, delegates to knowledge modules)
  cowork
    .command("analyze")
    .description("Analyze code structure, style, or knowledge graph")
    .argument("<path>", "File or directory to analyze")
    .option(
      "--type <type>",
      "Analysis type (style, knowledge-graph, decisions)",
      "style",
    )
    .option("--provider <name>", "LLM provider to use")
    .option("--model <name>", "LLM model to use")
    .option("--json", "Output as JSON")
    .action(async (targetPath, options) => {
      const resolved = path.resolve(targetPath);
      if (!fs.existsSync(resolved)) {
        logger.error(`Path not found: ${resolved}`);
        process.exit(1);
      }

      const spinner = ora(`Analyzing (${options.type})...`).start();

      try {
        let result;

        if (options.type === "style") {
          const { analyzeProjectStyle } =
            await import("../lib/cowork/project-style-analyzer-cli.js");
          const llmOptions = {};
          if (options.provider) llmOptions.provider = options.provider;
          if (options.model) llmOptions.model = options.model;
          result = await analyzeProjectStyle({
            targetPath: resolved,
            llmOptions,
          });
        } else if (options.type === "knowledge-graph") {
          const { buildKnowledgeGraph } =
            await import("../lib/cowork/code-knowledge-graph-cli.js");
          result = await buildKnowledgeGraph({ targetPath: resolved });
        } else if (options.type === "decisions") {
          const { extractDecisions } =
            await import("../lib/cowork/decision-kb-cli.js");
          const llmOptions = {};
          if (options.provider) llmOptions.provider = options.provider;
          if (options.model) llmOptions.model = options.model;
          result = await extractDecisions({
            targetPath: resolved,
            llmOptions,
          });
        } else {
          spinner.fail(`Unknown analysis type: ${options.type}`);
          process.exit(1);
        }

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            chalk.bold(`\nAnalysis (${options.type}): ${targetPath}\n`),
          );
          if (result.summary) {
            logger.log(result.summary);
          } else {
            console.log(JSON.stringify(result, null, 2));
          }
          logger.log("");
        }
      } catch (err) {
        spinner.fail(`Analysis failed: ${err.message}`);
        if (program.opts().verbose) console.error(err.stack);
        process.exit(1);
      }
    });

  // cowork template — marketplace subcommands
  const tpl = cowork
    .command("template")
    .description("Cowork template marketplace (search/install/publish via EvoMap)");

  tpl
    .command("search [query]")
    .description("Search for Cowork templates on the EvoMap hub")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      const [{ searchTemplates, _deps: mpDeps }, { EvoMapClient }] =
        await Promise.all([
          import("../lib/cowork-template-marketplace.js"),
          import("../lib/evomap-client.js"),
        ]);
      mpDeps.evomapClient = new EvoMapClient();
      try {
        const results = await searchTemplates(query || "", {
          limit: parseInt(options.limit, 10) || 20,
        });
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }
        if (results.length === 0) {
          logger.info("No templates found.");
          return;
        }
        logger.log(chalk.bold(`\n${results.length} template(s) found:\n`));
        for (const g of results) {
          logger.log(
            `  ${chalk.cyan(g.id)} ${chalk.gray("v" + (g.version || "?"))} by ${g.author || "unknown"}`,
          );
          if (g.description) {
            logger.log(chalk.gray(`    ${g.description.slice(0, 100)}`));
          }
          logger.log(
            chalk.gray(
              `    downloads: ${g.downloads || 0}  rating: ${g.rating || "N/A"}`,
            ),
          );
        }
        logger.log("");
      } catch (err) {
        logger.error(`Search failed: ${err.message}`);
        process.exit(1);
      }
    });

  tpl
    .command("install <geneId>")
    .description("Install a Cowork template from the EvoMap hub")
    .action(async (geneId) => {
      const [{ installTemplate, _deps: mpDeps }, { EvoMapClient }] =
        await Promise.all([
          import("../lib/cowork-template-marketplace.js"),
          import("../lib/evomap-client.js"),
        ]);
      mpDeps.evomapClient = new EvoMapClient();
      try {
        const template = await installTemplate(process.cwd(), geneId);
        logger.log(
          chalk.green(`✓ Installed template '${template.id}' (${template.name})`),
        );
      } catch (err) {
        logger.error(`Install failed: ${err.message}`);
        process.exit(1);
      }
    });

  tpl
    .command("list")
    .description("List locally installed Cowork templates")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const { listUserTemplates } = await import(
        "../lib/cowork-template-marketplace.js"
      );
      const templates = listUserTemplates(process.cwd());
      if (options.json) {
        console.log(JSON.stringify(templates, null, 2));
        return;
      }
      if (templates.length === 0) {
        logger.info("No user templates installed.");
        return;
      }
      logger.log(chalk.bold(`\n${templates.length} installed template(s):\n`));
      for (const t of templates) {
        logger.log(
          `  ${chalk.cyan(t.id)} — ${t.name} ${chalk.gray("[" + t.category + "]")}`,
        );
      }
      logger.log("");
    });

  tpl
    .command("remove <id>")
    .description("Remove an installed Cowork template")
    .action(async (id) => {
      const { removeUserTemplate } = await import(
        "../lib/cowork-template-marketplace.js"
      );
      if (removeUserTemplate(process.cwd(), id)) {
        logger.log(chalk.green(`✓ Removed '${id}'`));
      } else {
        logger.error(`Template not installed: ${id}`);
        process.exit(1);
      }
    });

  tpl
    .command("publish <templateId>")
    .description("Publish a built-in or installed Cowork template to EvoMap")
    .requiredOption("--author <name>", "Author name for the published gene")
    .option("--version <v>", "Gene version", "1.0.0")
    .option("--description <text>", "Gene description")
    .option("--tags <list>", "Comma-separated tags")
    .action(async (templateId, options) => {
      const [
        { publishTemplate, toShareableTemplate, _deps: mpDeps },
        { getTemplate },
        { EvoMapClient },
      ] = await Promise.all([
        import("../lib/cowork-template-marketplace.js"),
        import("../lib/cowork-task-templates.js"),
        import("../lib/evomap-client.js"),
      ]);
      mpDeps.evomapClient = new EvoMapClient();

      const template = getTemplate(templateId);
      if (template.id === "free") {
        logger.error(`Unknown template: ${templateId}`);
        process.exit(1);
      }
      const shareable = toShareableTemplate(template);
      try {
        const result = await publishTemplate(shareable, {
          author: options.author,
          version: options.version,
          description: options.description,
          tags: options.tags ? options.tags.split(",").map((t) => t.trim()) : [],
        });
        logger.log(
          chalk.green(`✓ Published ${result?.id || shareable.id}`),
        );
      } catch (err) {
        logger.error(`Publish failed: ${err.message}`);
        process.exit(1);
      }
    });

  // cowork cron — schedule daily tasks
  const cron = cowork
    .command("cron")
    .description("Schedule Cowork tasks on a cron expression");

  cron
    .command("list")
    .description("List all scheduled Cowork tasks")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const { loadSchedules } = await import("../lib/cowork-cron.js");
      const schedules = loadSchedules(process.cwd());
      if (options.json) {
        console.log(JSON.stringify(schedules, null, 2));
        return;
      }
      if (schedules.length === 0) {
        logger.log(chalk.gray("No scheduled tasks."));
        return;
      }
      logger.log(chalk.bold(`\n${schedules.length} scheduled task(s):\n`));
      for (const s of schedules) {
        const flag = s.enabled ? chalk.green("✓") : chalk.gray("✗");
        logger.log(
          `  ${flag} ${chalk.cyan(s.id)}  ${chalk.yellow(s.cron)}  [${s.templateId || "free"}]`,
        );
        logger.log(chalk.gray(`    ${s.userMessage.slice(0, 80)}`));
        if (s.lastRunAt) {
          logger.log(
            chalk.gray(`    last run: ${s.lastRunAt} (${s.lastStatus})`),
          );
        }
      }
      logger.log("");
    });

  cron
    .command("add")
    .description("Add a scheduled Cowork task")
    .requiredOption("--cron <expr>", "5-field cron expression (e.g. '0 9 * * 1-5')")
    .requiredOption("--message <text>", "Task prompt / user message")
    .option("--template <id>", "Template id (e.g. doc-convert); omit for free mode")
    .option("--files <list>", "Comma-separated absolute file paths", "")
    .action(async (options) => {
      const { addSchedule } = await import("../lib/cowork-cron.js");
      try {
        const entry = addSchedule(process.cwd(), {
          cron: options.cron,
          templateId: options.template || null,
          userMessage: options.message,
          files: options.files
            ? options.files.split(",").map((f) => f.trim()).filter(Boolean)
            : [],
        });
        logger.log(chalk.green(`✓ Added schedule ${entry.id}`));
        logger.log(chalk.gray(`  cron: ${entry.cron}`));
        logger.log(chalk.gray(`  template: ${entry.templateId || "free"}`));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  cron
    .command("remove <id>")
    .description("Remove a scheduled task by id")
    .action(async (id) => {
      const { removeSchedule } = await import("../lib/cowork-cron.js");
      if (removeSchedule(process.cwd(), id)) {
        logger.log(chalk.green(`✓ Removed ${id}`));
      } else {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
    });

  cron
    .command("enable <id>")
    .description("Enable a scheduled task")
    .action(async (id) => {
      const { setScheduleEnabled } = await import("../lib/cowork-cron.js");
      if (setScheduleEnabled(process.cwd(), id, true)) {
        logger.log(chalk.green(`✓ Enabled ${id}`));
      } else {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
    });

  cron
    .command("disable <id>")
    .description("Disable a scheduled task (keeps the record)")
    .action(async (id) => {
      const { setScheduleEnabled } = await import("../lib/cowork-cron.js");
      if (setScheduleEnabled(process.cwd(), id, false)) {
        logger.log(chalk.yellow(`✓ Disabled ${id}`));
      } else {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
    });

  cron
    .command("run")
    .description(
      "Start the cron scheduler in the foreground (Ctrl-C to stop)",
    )
    .option("--interval <ms>", "Tick interval in ms (default 60000)", "60000")
    .action(async (options) => {
      const [{ CoworkCronScheduler, _deps: cronDeps }, { runCoworkTask }] =
        await Promise.all([
          import("../lib/cowork-cron.js"),
          import("../lib/cowork-task-runner.js"),
        ]);
      // Inject the runner so the scheduler doesn't require a circular import
      cronDeps.runTask = runCoworkTask;

      const scheduler = new CoworkCronScheduler({
        cwd: process.cwd(),
        intervalMs: parseInt(options.interval, 10) || 60_000,
        onEvent: (e) => {
          const ts = new Date().toISOString();
          logger.log(chalk.gray(`[${ts}] ${JSON.stringify(e)}`));
        },
      });
      scheduler.start();
      logger.log(
        chalk.green("Cowork cron scheduler running. Press Ctrl-C to stop."),
      );
      process.on("SIGINT", () => {
        scheduler.stop();
        process.exit(0);
      });
    });

  // cowork status — show collaboration state
  cowork
    .command("status")
    .description("Show cowork collaboration status")
    .action(async () => {
      logger.log(chalk.bold("\nCowork Status\n"));
      logger.log(`  Available commands:`);
      logger.log(
        `    ${chalk.cyan("cowork debate <file>")}     Multi-perspective code review`,
      );
      logger.log(
        `    ${chalk.cyan("cowork compare <prompt>")}  A/B solution comparison`,
      );
      logger.log(
        `    ${chalk.cyan("cowork analyze <path>")}    Code analysis (style/knowledge-graph/decisions)`,
      );
      logger.log(
        `    ${chalk.cyan("cowork cron list|add|remove|run")}  Schedule recurring Cowork tasks`,
      );
      logger.log("");
      logger.log(
        chalk.gray(
          "  All commands use the configured LLM provider. Override with --provider/--model.",
        ),
      );
      logger.log("");
    });
}
