/**
 * SCIM commands
 * chainlesschain scim users|connectors|sync|status
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureSCIMTables,
  listUsers,
  createUser,
  getUser,
  deleteUser,
  listConnectors,
  addConnector,
  syncProvision,
  getStatus,
} from "../lib/scim-manager.js";

export function registerScimCommand(program) {
  const scim = program
    .command("scim")
    .description("SCIM provisioning — user management, connectors, sync");

  // scim users
  const users = scim.command("users").description("SCIM user management");

  users
    .command("list")
    .description("List SCIM users")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const result = listUsers();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.resources.length === 0) {
          logger.info("No SCIM users.");
        } else {
          for (const u of result.resources) {
            logger.log(
              `  ${chalk.cyan(u.id.slice(0, 8))} ${u.userName} (${u.displayName}) active=${u.active}`,
            );
          }
          logger.log(`\n${result.totalResults} user(s) total.`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  users
    .command("create <username>")
    .description("Create a SCIM user")
    .option("-n, --name <display-name>", "Display name")
    .option("-e, --email <email>", "Email address")
    .action(async (username, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const user = createUser(db, username, options.name, options.email);
        logger.success("User created");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(user.id)}`);
        logger.log(`  ${chalk.bold("Username:")} ${user.userName}`);
        logger.log(`  ${chalk.bold("Name:")}     ${user.displayName}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  users
    .command("get <user-id>")
    .description("Get a SCIM user by ID")
    .option("--json", "Output as JSON")
    .action(async (userId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const user = getUser(userId);
        if (!user) {
          logger.error(`User not found: ${userId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(user, null, 2));
        } else {
          logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(user.id)}`);
          logger.log(`  ${chalk.bold("Username:")} ${user.userName}`);
          logger.log(`  ${chalk.bold("Name:")}     ${user.displayName}`);
          logger.log(`  ${chalk.bold("Email:")}    ${user.email || "N/A"}`);
          logger.log(`  ${chalk.bold("Active:")}   ${user.active}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  users
    .command("delete <user-id>")
    .description("Delete a SCIM user")
    .action(async (userId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        deleteUser(db, userId);
        logger.success(`User ${chalk.cyan(userId.slice(0, 8))} deleted`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scim connectors
  scim
    .command("connectors")
    .description("List SCIM connectors")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const connectors = listConnectors();
        if (options.json) {
          console.log(JSON.stringify(connectors, null, 2));
        } else if (connectors.length === 0) {
          logger.info("No SCIM connectors configured.");
        } else {
          for (const c of connectors) {
            logger.log(
              `  ${chalk.cyan(c.id.slice(0, 8))} ${c.name} [${c.provider}] status=${c.status}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scim sync
  scim
    .command("sync <connector-id>")
    .description("Trigger SCIM provisioning sync")
    .action(async (connectorId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const result = syncProvision(db, connectorId);
        logger.success(`Sync completed via ${chalk.cyan(result.connector)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scim status
  scim
    .command("status")
    .description("Show SCIM provisioning status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const status = getStatus();
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Users:")}      ${status.users}`);
          logger.log(`  ${chalk.bold("Connectors:")} ${status.connectors}`);
          logger.log(`  ${chalk.bold("Sync Ops:")}   ${status.syncOperations}`);
          logger.log(
            `  ${chalk.bold("Last Sync:")}  ${status.lastSync || "never"}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
