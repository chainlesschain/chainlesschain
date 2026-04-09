/**
 * MCP (Model Context Protocol) commands
 * chainlesschain mcp servers|connect|disconnect|tools|call
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { MCPClient, MCPServerConfig } from "../harness/mcp-client.js";

// Singleton MCP client for session reuse
let mcpClient = null;

function getClient() {
  if (!mcpClient) mcpClient = new MCPClient();
  return mcpClient;
}

export function registerMcpCommand(program) {
  const mcp = program
    .command("mcp")
    .description("MCP server management and tool execution");

  // mcp servers — list configured servers
  mcp
    .command("servers")
    .description("List configured MCP servers")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const config = new MCPServerConfig(db);
        const servers = config.list();

        if (options.json) {
          console.log(JSON.stringify(servers, null, 2));
        } else if (servers.length === 0) {
          logger.info("No MCP servers configured. Use 'mcp add' to add one.");
        } else {
          logger.log(chalk.bold(`MCP Servers (${servers.length}):\n`));
          for (const s of servers) {
            const auto = s.autoConnect ? chalk.green(" [auto]") : "";
            logger.log(`  ${chalk.cyan(s.name)}${auto}`);
            logger.log(
              `    ${chalk.gray("Command:")} ${s.command} ${s.args.join(" ")}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp add — add/update a server config
  mcp
    .command("add")
    .description("Add or update an MCP server configuration")
    .argument("<name>", "Server name")
    .requiredOption("-c, --command <cmd>", "Server command to run")
    .option("-a, --args <args>", "Command arguments (comma-separated)")
    .option("--auto-connect", "Auto-connect on startup")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const config = new MCPServerConfig(db);
        const args = options.args
          ? options.args.split(",").map((a) => a.trim())
          : [];

        config.add(name, {
          command: options.command,
          args,
          autoConnect: !!options.autoConnect,
        });

        if (options.json) {
          console.log(
            JSON.stringify({
              name,
              command: options.command,
              args,
              autoConnect: !!options.autoConnect,
            }),
          );
        } else {
          logger.success(`MCP server "${chalk.cyan(name)}" configured`);
          logger.log(
            `  ${chalk.gray("Command:")} ${options.command} ${args.join(" ")}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp remove — remove a server config
  mcp
    .command("remove")
    .description("Remove an MCP server configuration")
    .argument("<name>", "Server name")
    .action(async (name) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const config = new MCPServerConfig(db);
        const removed = config.remove(name);

        if (removed) {
          logger.success(`MCP server "${name}" removed`);
        } else {
          logger.error(`Server "${name}" not found`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp connect — connect to a server
  mcp
    .command("connect")
    .description("Connect to an MCP server")
    .argument("<name>", "Server name (configured or command)")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const config = new MCPServerConfig(db);
        const serverConfig = config.get(name);

        if (!serverConfig) {
          logger.error(`Server "${name}" not configured. Use 'mcp add' first.`);
          process.exit(1);
        }

        const spinner = ora(`Connecting to ${name}...`).start();
        const client = getClient();

        const result = await client.connect(name, serverConfig);
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Connected to ${chalk.cyan(name)}`);
          logger.log(`  ${chalk.gray("Tools:")} ${result.tools.length}`);
          logger.log(
            `  ${chalk.gray("Resources:")} ${result.resources.length}`,
          );
          if (result.serverInfo?.name) {
            logger.log(`  ${chalk.gray("Server:")} ${result.serverInfo.name}`);
          }
        }

        // Don't shutdown — keep connection alive for subsequent calls
      } catch (err) {
        logger.error(`Connection failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp disconnect — disconnect from a server
  mcp
    .command("disconnect")
    .description("Disconnect from an MCP server")
    .argument("<name>", "Server name")
    .action(async (name) => {
      try {
        const client = getClient();
        const ok = await client.disconnect(name);
        if (ok) {
          logger.success(`Disconnected from ${name}`);
        } else {
          logger.error(`Server "${name}" not connected`);
        }
      } catch (err) {
        logger.error(`Disconnect failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp tools — list available tools
  mcp
    .command("tools")
    .description("List available MCP tools")
    .option("-s, --server <name>", "Filter by server name")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const client = getClient();
        const tools = client.listTools(options.server);

        if (options.json) {
          console.log(JSON.stringify(tools, null, 2));
        } else if (tools.length === 0) {
          logger.info("No tools available. Connect to a server first.");
        } else {
          logger.log(chalk.bold(`MCP Tools (${tools.length}):\n`));
          for (const t of tools) {
            logger.log(
              `  ${chalk.cyan(t.name)} ${chalk.gray(`[${t.server}]`)}`,
            );
            if (t.description) {
              logger.log(`    ${chalk.gray(t.description)}`);
            }
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp call — call a tool
  mcp
    .command("call")
    .description("Call an MCP tool")
    .argument("<tool>", "Tool name")
    .option("-s, --server <name>", "Server name")
    .option("-a, --args <json>", "Tool arguments as JSON")
    .option("--json", "Output as JSON")
    .action(async (tool, options) => {
      try {
        const client = getClient();

        // Find which server has this tool
        let serverName = options.server;
        if (!serverName) {
          const allTools = client.listTools();
          const match = allTools.find((t) => t.name === tool);
          if (!match) {
            logger.error(
              `Tool "${tool}" not found. Run 'mcp tools' to see available tools.`,
            );
            process.exit(1);
          }
          serverName = match.server;
        }

        const args = options.args ? JSON.parse(options.args) : {};
        const spinner = ora(`Calling ${tool}...`).start();

        const result = await client.callTool(serverName, tool, args);
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Display content blocks
          if (result?.content) {
            for (const block of result.content) {
              if (block.type === "text") {
                logger.log(block.text);
              } else if (block.type === "image") {
                logger.log(chalk.gray(`[Image: ${block.mimeType || "image"}]`));
              } else {
                logger.log(JSON.stringify(block, null, 2));
              }
            }
          } else {
            logger.log(JSON.stringify(result, null, 2));
          }
        }
      } catch (err) {
        logger.error(`Tool call failed: ${err.message}`);
        process.exit(1);
      }
    });
}
