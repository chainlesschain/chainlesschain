/**
 * A2A (Agent-to-Agent) Protocol commands
 * chainlesschain a2a register|discover|submit|status|complete|fail|peers|cards|negotiate
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  registerCard,
  updateCard,
  discoverAgents,
  sendTask,
  completeTask,
  failTask,
  getTaskStatus,
  negotiateCapability,
  listPeers,
  // V2 (Phase 81)
  TASK_STATUS_V2,
  CARD_STATUS_V2,
  SUBSCRIPTION_TYPE,
  NEGOTIATION_RESULT,
  validateAgentCard,
  setCardStatus,
  getCardStatusV2,
  sendTaskV2,
  startWorking,
  requestInput,
  provideInput,
  completeTaskV2,
  failTaskV2,
  cancelTask,
  checkTaskTimeout,
  getTaskV2,
  listTasksV2,
  negotiateCapabilityV2,
  getA2AStatsV2,
} from "../lib/a2a-protocol.js";

export function registerA2aCommand(program) {
  const a2a = program
    .command("a2a")
    .description("A2A Protocol — agent-to-agent communication");

  // a2a register <name>
  a2a
    .command("register")
    .description("Register an agent card")
    .argument("<name>", "Agent name")
    .option("--description <desc>", "Agent description", "")
    .option("--url <url>", "Agent endpoint URL", "")
    .option("--capabilities <csv>", "Comma-separated capabilities", "")
    .option("--skills <csv>", "Comma-separated skills", "")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const card = registerCard(db, {
          name,
          description: options.description,
          url: options.url,
          capabilities: options.capabilities
            ? options.capabilities.split(",").map((s) => s.trim())
            : [],
          skills: options.skills
            ? options.skills.split(",").map((s) => s.trim())
            : [],
        });

        if (options.json) {
          console.log(JSON.stringify(card, null, 2));
        } else {
          logger.success(
            `Agent registered: ${chalk.cyan(card.name)} ${chalk.gray(card.id)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a discover
  a2a
    .command("discover")
    .description("Discover agents by capability or skill")
    .option("--capability <name>", "Filter by capability")
    .option("--skill <name>", "Filter by skill")
    .option("--name <filter>", "Filter by name")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const agents = discoverAgents(db, {
          capability: options.capability,
          skill: options.skill,
          name: options.name,
        });

        if (options.json) {
          console.log(JSON.stringify(agents, null, 2));
        } else if (agents.length === 0) {
          logger.info("No agents found matching criteria");
        } else {
          logger.log(chalk.bold(`Discovered ${agents.length} agents:\n`));
          for (const a of agents) {
            logger.log(`  ${chalk.cyan(a.name)} ${chalk.gray(a.id)}`);
            if (a.description) logger.log(`    ${chalk.white(a.description)}`);
            if (a.capabilities.length)
              logger.log(
                `    Capabilities: ${chalk.yellow(a.capabilities.join(", "))}`,
              );
            if (a.skills.length)
              logger.log(`    Skills: ${chalk.yellow(a.skills.join(", "))}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a submit <agent-id> <input>
  a2a
    .command("submit")
    .description("Submit a task to an agent")
    .argument("<agent-id>", "Target agent ID")
    .argument("<input>", "Task input")
    .option("--json", "Output as JSON")
    .action(async (agentId, input, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = sendTask(db, agentId, input);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Task submitted: ${chalk.gray(result.taskId)} [${chalk.yellow(result.status)}]`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a status <task-id>
  a2a
    .command("status")
    .description("Get task status")
    .argument("<task-id>", "Task ID")
    .option("--json", "Output as JSON")
    .action(async (taskId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const task = getTaskStatus(db, taskId);

        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
        } else {
          logger.log(chalk.bold("Task Status:\n"));
          logger.log(`  ID:     ${chalk.gray(task.id)}`);
          logger.log(`  Agent:  ${chalk.cyan(task.agent_id)}`);
          logger.log(`  Status: ${chalk.yellow(task.status)}`);
          if (task.input)
            logger.log(
              `  Input:  ${chalk.white(task.input.substring(0, 100))}`,
            );
          if (task.output)
            logger.log(
              `  Output: ${chalk.green(task.output.substring(0, 100))}`,
            );
          if (task.error) logger.log(`  Error:  ${chalk.red(task.error)}`);
          if (task.history.length) {
            logger.log("  History:");
            for (const h of task.history) {
              logger.log(
                `    ${chalk.gray(h.timestamp)} → ${chalk.yellow(h.status)}`,
              );
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a complete <task-id> <output>
  a2a
    .command("complete")
    .description("Mark a task as completed")
    .argument("<task-id>", "Task ID")
    .argument("<output>", "Task output")
    .action(async (taskId, output) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = completeTask(db, taskId, output);
        logger.success(
          `Task ${chalk.gray(taskId)} → ${chalk.green(result.status)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a fail <task-id> <error>
  a2a
    .command("fail")
    .description("Mark a task as failed")
    .argument("<task-id>", "Task ID")
    .argument("<error>", "Error message")
    .action(async (taskId, error) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = failTask(db, taskId, error);
        logger.success(
          `Task ${chalk.gray(taskId)} → ${chalk.red(result.status)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a peers
  a2a
    .command("peers")
    .description("List all registered agents")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peers = listPeers(db);

        if (options.json) {
          console.log(JSON.stringify(peers, null, 2));
        } else if (peers.length === 0) {
          logger.info("No agents registered. Use 'a2a register' to add one.");
        } else {
          logger.log(chalk.bold(`${peers.length} registered agents:\n`));
          for (const p of peers) {
            const statusColor =
              p.status === "active" ? chalk.green : chalk.gray;
            logger.log(
              `  ${chalk.cyan(p.name)} ${chalk.gray(p.id)} ${statusColor(p.status)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a cards
  a2a
    .command("cards")
    .description("List all agent cards with details")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peers = listPeers(db);

        if (options.json) {
          console.log(JSON.stringify(peers, null, 2));
        } else if (peers.length === 0) {
          logger.info("No agent cards registered.");
        } else {
          logger.log(chalk.bold(`${peers.length} agent cards:\n`));
          for (const p of peers) {
            logger.log(`  ${chalk.cyan(p.name)} ${chalk.gray(p.id)}`);
            if (p.description) logger.log(`    Description: ${p.description}`);
            if (p.url) logger.log(`    URL: ${chalk.blue(p.url)}`);
            logger.log(`    Auth: ${p.auth_type}`);
            if (p.capabilities.length)
              logger.log(
                `    Capabilities: ${chalk.yellow(p.capabilities.join(", "))}`,
              );
            if (p.skills.length)
              logger.log(`    Skills: ${chalk.yellow(p.skills.join(", "))}`);
            logger.log("");
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a negotiate <agent-id> <capabilities>
  a2a
    .command("negotiate")
    .description("Check if an agent supports required capabilities")
    .argument("<agent-id>", "Agent ID")
    .argument("<capabilities>", "Comma-separated required capabilities")
    .option("--json", "Output as JSON")
    .action(async (agentId, capabilities, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const required = capabilities.split(",").map((s) => s.trim());
        const result = negotiateCapability(db, agentId, required);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.compatible) {
            logger.success("Agent is fully compatible");
          } else {
            logger.warn("Agent is not fully compatible");
          }
          if (result.supported.length) {
            logger.log(
              `  Supported: ${chalk.green(result.supported.join(", "))}`,
            );
          }
          if (result.missing.length) {
            logger.log(`  Missing:   ${chalk.red(result.missing.join(", "))}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════
  // Phase 81 — A2A Protocol V2
  // ═══════════════════════════════════════════════════════════════

  // Enum listings (no DB required)
  a2a
    .command("task-statuses")
    .description("List V2 task statuses (Phase 81)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = Object.values(TASK_STATUS_V2);
      if (options.json) console.log(JSON.stringify(statuses, null, 2));
      else statuses.forEach((s) => logger.log(`  ${s}`));
    });

  a2a
    .command("card-statuses")
    .description("List V2 card statuses (Phase 81)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = Object.values(CARD_STATUS_V2);
      if (options.json) console.log(JSON.stringify(statuses, null, 2));
      else statuses.forEach((s) => logger.log(`  ${s}`));
    });

  a2a
    .command("subscription-types")
    .description("List V2 subscription types (Phase 81)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = Object.values(SUBSCRIPTION_TYPE);
      if (options.json) console.log(JSON.stringify(types, null, 2));
      else types.forEach((t) => logger.log(`  ${t}`));
    });

  a2a
    .command("negotiation-results")
    .description("List V2 negotiation outcomes (Phase 81)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const outcomes = Object.values(NEGOTIATION_RESULT);
      if (options.json) console.log(JSON.stringify(outcomes, null, 2));
      else outcomes.forEach((o) => logger.log(`  ${o}`));
    });

  // validate-card — pure, no DB
  a2a
    .command("validate-card")
    .description("Validate an agent card against the A2A schema")
    .argument("<name>", "Agent name")
    .option("--description <desc>", "Description", "")
    .option("--url <url>", "URL", "")
    .option("--capabilities <csv>", "Capabilities CSV", "")
    .option("--skills <csv>", "Skills CSV", "")
    .option("--card-version <semver>", "Card version (major.minor.patch)")
    .option("--auth-type <t>", "Auth type (none|bearer|basic|oauth2)")
    .option("--json", "Output as JSON")
    .action((name, options) => {
      const card = {
        name,
        description: options.description,
        url: options.url,
        capabilities: options.capabilities
          ? options.capabilities.split(",").map((s) => s.trim())
          : [],
        skills: options.skills
          ? options.skills.split(",").map((s) => s.trim())
          : [],
      };
      if (options.cardVersion) card.version = options.cardVersion;
      if (options.authType) card.auth_type = options.authType;
      const result = validateAgentCard(card);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.valid) {
        logger.success("Card is valid");
      } else {
        logger.warn("Card is invalid");
        result.errors.forEach((e) => logger.log(`  - ${e}`));
        process.exit(1);
      }
    });

  // set-card-status <cardId> <status>
  a2a
    .command("set-card-status")
    .description("Transition a card between active/inactive/expired")
    .argument("<cardId>", "Card ID")
    .argument("<status>", "active|inactive|expired")
    .option("--json", "Output as JSON")
    .action(async (cardId, status, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db?.getDatabase?.() || null;
        const result = setCardStatus(db, cardId, status);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else logger.success(`Card ${cardId} → ${status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // card-status <cardId>
  a2a
    .command("card-status")
    .description("Show a card's V2 status")
    .argument("<cardId>", "Card ID")
    .option("--json", "Output as JSON")
    .action((cardId, options) => {
      const status = getCardStatusV2(cardId);
      if (options.json) console.log(JSON.stringify({ cardId, status }));
      else logger.log(`${cardId}: ${status}`);
    });

  // send-task-v2 <agentId> <input> [--timeout-ms N]
  a2a
    .command("send-task-v2")
    .description("Submit a V2 task (in-memory, with optional timeout)")
    .argument("<agentId>", "Agent ID")
    .argument("<input>", "Task input")
    .option("--timeout-ms <ms>", "Timeout in ms", parseInt)
    .option("--json", "Output as JSON")
    .action((agentId, input, options) => {
      const res = sendTaskV2(null, {
        agentId,
        input,
        timeoutMs: options.timeoutMs,
      });
      if (options.json) console.log(JSON.stringify(res, null, 2));
      else logger.success(`Task ${res.taskId} submitted`);
    });

  a2a
    .command("start-working")
    .description("Transition a V2 task to working")
    .argument("<taskId>", "Task ID")
    .option("--json", "Output as JSON")
    .action((taskId, options) => {
      try {
        const res = startWorking(null, taskId);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else logger.success(`Task ${taskId} → working`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("request-input")
    .description("Request user input while a V2 task is working")
    .argument("<taskId>", "Task ID")
    .argument("<prompt>", "Prompt to surface")
    .option("--json", "Output as JSON")
    .action((taskId, prompt, options) => {
      try {
        const res = requestInput(null, taskId, prompt);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else logger.success(`Task ${taskId} → input-required`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("provide-input")
    .description("Provide input for an input-required V2 task")
    .argument("<taskId>", "Task ID")
    .argument("<input>", "User-provided input")
    .option("--json", "Output as JSON")
    .action((taskId, input, options) => {
      try {
        const res = provideInput(null, taskId, input);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else logger.success(`Task ${taskId} → working`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("complete-task-v2")
    .description("Complete a V2 task (from working only)")
    .argument("<taskId>", "Task ID")
    .argument("[output]", "Task output", "")
    .option("--json", "Output as JSON")
    .action((taskId, output, options) => {
      try {
        const res = completeTaskV2(null, taskId, output);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else logger.success(`Task ${taskId} → completed`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("fail-task-v2")
    .description("Fail a V2 task with an error message")
    .argument("<taskId>", "Task ID")
    .argument("[error]", "Error message", "Unknown error")
    .option("--json", "Output as JSON")
    .action((taskId, error, options) => {
      try {
        const res = failTaskV2(null, taskId, error);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else logger.warn(`Task ${taskId} → failed`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("cancel-task")
    .description("Cancel a non-terminal V2 task")
    .argument("<taskId>", "Task ID")
    .argument("[reason]", "Cancel reason", "user_requested")
    .option("--json", "Output as JSON")
    .action((taskId, reason, options) => {
      try {
        const res = cancelTask(null, taskId, reason);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else logger.log(`Task ${taskId} → canceled`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("check-timeout")
    .description("Check V2 task timeout (auto-fails if past deadline)")
    .argument("<taskId>", "Task ID")
    .option("--json", "Output as JSON")
    .action((taskId, options) => {
      try {
        const res = checkTaskTimeout(null, taskId);
        if (options.json) console.log(JSON.stringify(res, null, 2));
        else if (res.timedOut) logger.warn(`Task ${taskId} timed out`);
        else logger.log(`Task ${taskId} status: ${res.status}`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("task-v2")
    .description("Show a V2 task snapshot")
    .argument("<taskId>", "Task ID")
    .option("--json", "Output as JSON")
    .action((taskId, options) => {
      try {
        const task = getTaskV2(taskId);
        if (options.json) console.log(JSON.stringify(task, null, 2));
        else {
          logger.log(`Task: ${task.taskId}`);
          logger.log(`  Agent:    ${task.agentId}`);
          logger.log(`  Status:   ${task.status}`);
          logger.log(`  History:  ${task.history.length} entries`);
          if (task.deadline)
            logger.log(`  Deadline: ${new Date(task.deadline).toISOString()}`);
          if (task.inputPrompt) logger.log(`  Prompt:   ${task.inputPrompt}`);
          if (task.cancelReason) logger.log(`  Cancel:   ${task.cancelReason}`);
        }
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  a2a
    .command("tasks-v2")
    .description("List V2 tasks")
    .option("--agent-id <id>", "Filter by agent ID")
    .option("--status <s>", "Filter by status")
    .option("--json", "Output as JSON")
    .action((options) => {
      const filter = {};
      if (options.agentId) filter.agentId = options.agentId;
      if (options.status) filter.status = options.status;
      const tasks = listTasksV2(filter);
      if (options.json) console.log(JSON.stringify(tasks, null, 2));
      else {
        if (!tasks.length) {
          logger.log("No V2 tasks");
          return;
        }
        tasks.forEach((t) => {
          logger.log(
            `  ${t.taskId}  [${t.status}]  agent=${t.agentId}  history=${t.history.length}`,
          );
        });
      }
    });

  a2a
    .command("negotiate-v2")
    .description("Phase 81 capability negotiation against an agent card")
    .argument("<cardJson>", "Agent card as JSON string")
    .option("--required <csv>", "Required capabilities CSV", "")
    .option("--preferred <csv>", "Preferred capabilities CSV", "")
    .option("--client-version <semver>", "Client version")
    .option("--json", "Output as JSON")
    .action((cardJson, options) => {
      let card;
      try {
        card = JSON.parse(cardJson);
      } catch (_err) {
        logger.error("cardJson must be valid JSON");
        process.exit(1);
      }
      const result = negotiateCapabilityV2(card, {
        required: options.required
          ? options.required.split(",").map((s) => s.trim())
          : [],
        preferred: options.preferred
          ? options.preferred.split(",").map((s) => s.trim())
          : [],
        version: options.clientVersion,
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        logger.log(`Result: ${result.result}`);
        if (result.missingRequired.length)
          logger.log(
            `  Missing required:  ${result.missingRequired.join(", ")}`,
          );
        if (result.missingPreferred.length)
          logger.log(
            `  Missing preferred: ${result.missingPreferred.join(", ")}`,
          );
        logger.log(`  Version OK:        ${result.versionOk}`);
      }
    });

  a2a
    .command("stats-v2")
    .description("Aggregate V2 stats (tasks + cards + subscriptions)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const s = getA2AStatsV2();
      if (options.json) console.log(JSON.stringify(s, null, 2));
      else {
        logger.log("A2A V2 Stats:");
        logger.log(`  Tasks total:     ${s.tasks.total}`);
        logger.log(`  Tasks by status: ${JSON.stringify(s.tasks.byStatus)}`);
        logger.log(`  With deadline:   ${s.tasks.withDeadline}`);
        logger.log(`  Cards tracked:   ${s.cards.tracked}`);
        logger.log(`  Subs (legacy):   ${s.subscriptions.legacy}`);
        logger.log(`  Subs (typed):    ${s.subscriptions.typed}`);
      }
    });
}
