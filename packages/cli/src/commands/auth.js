/**
 * Auth / RBAC commands
 * chainlesschain auth roles|grant|revoke|check|permissions|users
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getRoles,
  createRole,
  deleteRole,
  grantRole,
  revokeRole,
  grantPermission,
  revokePermission,
  getUserPermissions,
  checkPermission,
  listUserRoles,
  PERMISSION_SCOPES,
} from "../lib/permission-engine.js";

export function registerAuthCommand(program) {
  const auth = program
    .command("auth")
    .description("RBAC permission management");

  // auth roles
  auth
    .command("roles", { isDefault: true })
    .description("List all roles")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const roles = getRoles(db);

        if (options.json) {
          console.log(JSON.stringify(roles, null, 2));
        } else if (roles.length === 0) {
          logger.info("No roles defined");
        } else {
          logger.log(chalk.bold(`Roles (${roles.length}):\n`));
          for (const role of roles) {
            const tag = role.isBuiltin
              ? chalk.gray(" [built-in]")
              : chalk.blue(" [custom]");
            logger.log(
              `  ${chalk.cyan(role.name.padEnd(15))}${tag}  ${role.description || ""}`,
            );
            logger.log(
              `    ${chalk.gray("permissions:")} ${role.permissions.join(", ")}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth create-role
  auth
    .command("create-role")
    .description("Create a custom role")
    .argument("<name>", "Role name")
    .option("-d, --description <desc>", "Role description")
    .option("-p, --permissions <perms>", "Comma-separated permissions")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const perms = options.permissions
          ? options.permissions.split(",").map((s) => s.trim())
          : [];
        const role = createRole(db, name, options.description, perms);

        logger.success(`Role created: ${role.name}`);
        if (role.permissions.length > 0) {
          logger.log(
            `  ${chalk.bold("Permissions:")} ${role.permissions.join(", ")}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth delete-role
  auth
    .command("delete-role")
    .description("Delete a custom role")
    .argument("<name>", "Role name")
    .option("--force", "Skip confirmation")
    .action(async (name, options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete role "${name}"? All grants for this role will be removed.`,
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = deleteRole(db, name);

        if (ok) {
          logger.success(`Role deleted: ${name}`);
        } else {
          logger.error(`Role not found or is built-in: ${name}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth grant
  auth
    .command("grant")
    .description("Grant a role to a user")
    .argument("<user-did>", "User DID")
    .argument("<role>", "Role name")
    .option("--expires <date>", "Expiration date (ISO 8601)")
    .action(async (userDid, role, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const grant = grantRole(db, userDid, role, null, options.expires);

        logger.success(`Granted role "${role}" to ${userDid}`);
        if (grant.expiresAt) {
          logger.log(`  ${chalk.bold("Expires:")} ${grant.expiresAt}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth revoke
  auth
    .command("revoke")
    .description("Revoke a role from a user")
    .argument("<user-did>", "User DID")
    .argument("<role>", "Role name")
    .action(async (userDid, role) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = revokeRole(db, userDid, role);

        if (ok) {
          logger.success(`Revoked role "${role}" from ${userDid}`);
        } else {
          logger.error("Grant not found");
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth grant-permission (direct permission)
  auth
    .command("grant-permission")
    .description("Grant a direct permission to a user")
    .argument("<user-did>", "User DID")
    .argument("<permission>", "Permission scope (e.g., note:read)")
    .action(async (userDid, permission) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        grantPermission(db, userDid, permission);
        logger.success(`Granted permission "${permission}" to ${userDid}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth revoke-permission
  auth
    .command("revoke-permission")
    .description("Revoke a direct permission from a user")
    .argument("<user-did>", "User DID")
    .argument("<permission>", "Permission scope")
    .action(async (userDid, permission) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = revokePermission(db, userDid, permission);

        if (ok) {
          logger.success(`Revoked permission "${permission}" from ${userDid}`);
        } else {
          logger.error("Permission grant not found");
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth check
  auth
    .command("check")
    .description("Check if a user has a specific permission")
    .argument("<user-did>", "User DID")
    .argument("<permission>", "Permission to check")
    .option("--json", "Output as JSON")
    .action(async (userDid, permission, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const allowed = checkPermission(db, userDid, permission);

        if (options.json) {
          console.log(
            JSON.stringify({ userDid, permission, allowed }, null, 2),
          );
        } else if (allowed) {
          logger.success(
            `${chalk.green("ALLOWED")} — ${userDid} has permission: ${permission}`,
          );
        } else {
          logger.log(
            `${chalk.red("DENIED")} — ${userDid} does not have permission: ${permission}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth permissions
  auth
    .command("permissions")
    .description("Show all permissions for a user")
    .argument("<user-did>", "User DID")
    .option("--json", "Output as JSON")
    .action(async (userDid, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const perms = getUserPermissions(db, userDid);

        if (options.json) {
          console.log(JSON.stringify(perms, null, 2));
        } else {
          logger.log(chalk.bold(`Permissions for ${chalk.cyan(userDid)}:\n`));
          if (perms.isAdmin) {
            logger.log(`  ${chalk.green("ADMIN")} — Full access (wildcard *)`);
          }
          if (perms.roles.length > 0) {
            logger.log(`  ${chalk.bold("Roles:")} ${perms.roles.join(", ")}`);
          }
          if (perms.directPermissions.length > 0) {
            logger.log(
              `  ${chalk.bold("Direct:")} ${perms.directPermissions.join(", ")}`,
            );
          }
          if (perms.effectivePermissions.length > 0) {
            logger.log(
              `  ${chalk.bold("Effective:")} ${perms.effectivePermissions.join(", ")}`,
            );
          } else {
            logger.log(`  ${chalk.gray("No permissions assigned")}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth users
  auth
    .command("users")
    .description("List all users with role assignments")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const users = listUserRoles(db);

        if (options.json) {
          console.log(JSON.stringify(users, null, 2));
        } else if (users.length === 0) {
          logger.info("No role assignments yet");
        } else {
          logger.log(chalk.bold(`Users with roles (${users.length}):\n`));
          for (const u of users) {
            logger.log(`  ${chalk.cyan(u.userDid)}`);
            logger.log(`    ${chalk.gray("roles:")} ${u.roles.join(", ")}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // auth scopes
  auth
    .command("scopes")
    .description("List all available permission scopes")
    .action(async () => {
      logger.log(chalk.bold("Available Permission Scopes:\n"));
      for (const scope of PERMISSION_SCOPES) {
        const [resource, action] = scope.split(":");
        logger.log(
          `  ${chalk.cyan(resource.padEnd(12))}:${chalk.white(action)}`,
        );
      }
    });
}
