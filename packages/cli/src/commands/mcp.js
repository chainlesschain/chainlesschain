/**
 * MCP (Model Context Protocol) commands
 * chainlesschain mcp servers|connect|disconnect|tools|call
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  MCPClient,
  MCPServerConfig,
  inferTransport,
} from "../harness/mcp-client.js";
import {
  validateMcpServer,
  annotateMcpCompatibility,
} from "@chainlesschain/session-core";
import {
  generateMcpServerScaffold,
  SUPPORTED_TRANSPORTS,
} from "../lib/mcp-scaffold.js";
import {
  CATALOG as REGISTRY_CATALOG,
  CATEGORIES as REGISTRY_CATEGORIES,
  listServers as registryListServers,
  searchServers as registrySearchServers,
  getServer as registryGetServer,
} from "../lib/mcp-registry.js";

// Singleton MCP client for session reuse
let mcpClient = null;

function getClient() {
  if (!mcpClient) mcpClient = new MCPClient();
  return mcpClient;
}

// Phase 3 (Hosted MCP Policy): resolve runtime mode from --mode > env > local.
function resolveMode(options) {
  return (
    options?.mode ||
    process.env.CHAINLESSCHAIN_MODE ||
    "local"
  ).toLowerCase();
}

// Normalize a stored server row to mcp-policy's server shape.
function toPolicyServer(row) {
  return {
    name: row.name,
    command: row.command,
    args: row.args,
    env: row.env,
    transport: row.transport,
    url: row.url,
    modeCompatibility: row.modeCompatibility,
  };
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
    .option("--mode <mode>", "Runtime mode (local | lan | hosted)")
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
        const mode = resolveMode(options);
        const annotated = servers.map((s) => {
          const { allowed, reason, transport } = validateMcpServer(
            toPolicyServer(s),
            mode,
          );
          const modes = annotateMcpCompatibility(
            toPolicyServer(s),
          )._modeCompatibility;
          return {
            ...s,
            _mode: mode,
            _allowed: allowed,
            _reason: reason,
            _transport: transport,
            _modeCompatibility: modes,
          };
        });

        if (options.json) {
          console.log(JSON.stringify(annotated, null, 2));
        } else if (servers.length === 0) {
          logger.info("No MCP servers configured. Use 'mcp add' to add one.");
        } else {
          logger.log(
            chalk.bold(`MCP Servers (${servers.length}) — mode: ${mode}\n`),
          );
          for (const s of annotated) {
            const auto = s.autoConnect ? chalk.green(" [auto]") : "";
            const flag = s._allowed
              ? chalk.green(" [ok]")
              : chalk.yellow(` [blocked: ${s._reason}]`);
            logger.log(`  ${chalk.cyan(s.name)}${auto}${flag}`);
            if (s.url) {
              logger.log(
                `    ${chalk.gray("URL:")} ${s.url} ${chalk.gray(`[${s.transport || s._transport || "http"}]`)}`,
              );
            } else {
              logger.log(
                `    ${chalk.gray("Command:")} ${s.command} ${s.args.join(" ")}`,
              );
            }
            logger.log(
              `    ${chalk.gray("Compatible:")} ${s._modeCompatibility.join(", ") || "(none)"}`,
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
    .option("-c, --command <cmd>", "Server command to run (stdio transport)")
    .option("-a, --args <args>", "Command arguments (comma-separated)")
    .option(
      "-u, --url <url>",
      "Server URL (http / https / ws / wss transports)",
    )
    .option(
      "-t, --transport <kind>",
      "Transport kind: stdio | http | https | sse | ws | wss",
    )
    .option(
      "-H, --header <header...>",
      "HTTP header to include on requests (KEY=VALUE, repeatable)",
    )
    .option("--auto-connect", "Auto-connect on startup")
    .option(
      "--mode <mode>",
      "Runtime mode to validate against (local | lan | hosted)",
    )
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        if (!options.command && !options.url) {
          logger.error(
            "Provide either -c <command> (stdio) or -u <url> (http/ws).",
          );
          process.exit(1);
        }
        if (options.command && options.url) {
          logger.error("Use either -c <command> or -u <url>, not both.");
          process.exit(1);
        }

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

        // Parse -H KEY=VALUE into { headers }
        const headers = {};
        if (Array.isArray(options.header)) {
          for (const raw of options.header) {
            const eq = raw.indexOf("=");
            if (eq <= 0) {
              logger.warn(
                `Ignored malformed --header "${raw}" (expected KEY=VALUE)`,
              );
              continue;
            }
            headers[raw.slice(0, eq).trim()] = raw.slice(eq + 1);
          }
        }

        const transport =
          options.transport ||
          (options.url ? inferTransport({ url: options.url }) : "stdio");

        if (options.url) {
          try {
            new URL(options.url);
          } catch (_e) {
            logger.error(`Invalid URL: ${options.url}`);
            process.exit(1);
          }
        }

        const mode = resolveMode(options);
        const check = validateMcpServer(
          {
            name,
            command: options.command,
            args,
            url: options.url,
            transport,
          },
          mode,
        );
        if (!check.allowed) {
          logger.warn(
            `Server "${name}" is not compatible with mode "${mode}": ${check.reason}`,
          );
        }

        config.add(name, {
          command: options.command || null,
          args,
          url: options.url || null,
          transport,
          env: {},
          autoConnect: !!options.autoConnect,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
        });

        const payload = {
          name,
          command: options.command || null,
          args,
          url: options.url || null,
          transport,
          autoConnect: !!options.autoConnect,
        };

        if (options.json) {
          console.log(JSON.stringify(payload));
        } else {
          logger.success(`MCP server "${chalk.cyan(name)}" configured`);
          if (options.url) {
            logger.log(
              `  ${chalk.gray("URL:")} ${options.url} ${chalk.gray(`[${transport}]`)}`,
            );
          } else {
            logger.log(
              `  ${chalk.gray("Command:")} ${options.command} ${args.join(" ")}`,
            );
          }
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
    .option("--mode <mode>", "Runtime mode (local | lan | hosted)")
    .option("--force", "Bypass mode compatibility check")
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

        const mode = resolveMode(options);
        const check = validateMcpServer(
          toPolicyServer({ name, ...serverConfig }),
          mode,
        );
        if (!check.allowed && !options.force) {
          logger.error(
            `Server "${name}" blocked in mode "${mode}": ${check.reason}. Use --force to override.`,
          );
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

  // mcp scaffold — generate a boilerplate MCP server project
  mcp
    .command("scaffold <name>")
    .description("Scaffold a new MCP server project (stdio or http+sse)")
    .option("-d, --description <text>", "Short description of the server")
    .option(
      "-t, --transport <kind>",
      `Transport: ${SUPPORTED_TRANSPORTS.join("|")}`,
      "stdio",
    )
    .option("-o, --output <dir>", "Target directory (defaults to ./<name>)")
    .option("-a, --author <name>", "package.json author field")
    .option("-p, --port <n>", "HTTP port (http transport only)", (v) =>
      parseInt(v, 10),
    )
    .option("--force", "Overwrite existing files")
    .option("--dry-run", "Print files that would be written, don't touch disk")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const { files, summary } = generateMcpServerScaffold({
          name,
          description: options.description,
          transport: options.transport,
          author: options.author,
          port: options.port,
        });

        const targetDir = path.resolve(options.output || `./${summary.name}`);

        if (options.dryRun) {
          if (options.json) {
            console.log(JSON.stringify({ targetDir, summary, files }, null, 2));
          } else {
            logger.log(
              `${chalk.bold("Would write")} ${files.length} files to ${chalk.cyan(targetDir)}:`,
            );
            for (const f of files) {
              logger.log(
                `  ${chalk.cyan(f.path)} ` +
                  chalk.dim(`(${f.content.length} bytes)`),
              );
            }
          }
          return;
        }

        // Collision check — refuse to clobber unless --force.
        if (!options.force && fs.existsSync(targetDir)) {
          const clashing = files.filter((f) =>
            fs.existsSync(path.join(targetDir, f.path)),
          );
          if (clashing.length > 0) {
            logger.error(
              `Refusing to overwrite existing files in ${targetDir}: ` +
                clashing.map((f) => f.path).join(", ") +
                `. Re-run with --force to overwrite.`,
            );
            process.exit(1);
          }
        }

        fs.mkdirSync(targetDir, { recursive: true });
        for (const f of files) {
          const full = path.join(targetDir, f.path);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, f.content, "utf-8");
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                targetDir,
                summary,
                files: files.map((f) => f.path),
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `Scaffolded ${chalk.cyan(summary.name)} ` +
              chalk.dim(
                `(${summary.transport}${summary.port ? `, port ${summary.port}` : ""})`,
              ),
          );
          logger.log(`  ${chalk.bold("Path:")}     ${targetDir}`);
          for (const f of files) {
            logger.log(`    ${chalk.dim("+")} ${f.path}`);
          }
          logger.log("");
          logger.log(chalk.bold("Next steps:"));
          logger.log(
            `  ${chalk.dim("$")} cd ${path.relative(process.cwd(), targetDir) || "."}`,
          );
          logger.log(`  ${chalk.dim("$")} npm install`);
          if (summary.transport === "stdio") {
            logger.log(
              `  ${chalk.dim("$")} cc mcp add ${summary.name} -c node -a "./index.js"`,
            );
          } else {
            logger.log(`  ${chalk.dim("$")} npm start`);
            logger.log(
              `  ${chalk.dim("$")} cc mcp add ${summary.name} -u http://localhost:${summary.port}/mcp`,
            );
          }
        }
      } catch (err) {
        logger.error(`Scaffold failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mcp registry — browse + search + one-shot install from the bundled catalog
  const registry = mcp
    .command("registry")
    .description("Browse the curated catalog of community MCP servers");

  registry
    .command("list")
    .description("List catalog entries (filter by category/tag/author)")
    .option("-c, --category <name>", "Filter by category")
    .option("-t, --tags <list>", "Filter by comma-separated tags (any match)")
    .option("--author <name>", "Filter by author (substring, case-insensitive)")
    .option("--sort <field>", "Sort by 'name' | 'rating' | 'category'", "name")
    .option("--order <dir>", "'asc' | 'desc'", "asc")
    .option("--limit <n>", "Max results", (v) => parseInt(v, 10))
    .option("--offset <n>", "Pagination offset", (v) => parseInt(v, 10))
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const tags = options.tags
          ? options.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined;
        const { servers, total } = registryListServers({
          category: options.category,
          tags,
          author: options.author,
          sortBy: options.sort,
          sortOrder: options.order,
          limit: options.limit,
          offset: options.offset,
        });

        if (options.json) {
          console.log(JSON.stringify({ servers, total }, null, 2));
          return;
        }

        if (servers.length === 0) {
          logger.info("No catalog entries match your filters.");
          return;
        }

        logger.log(
          chalk.bold(`MCP Registry — ${servers.length}/${total} servers\n`),
        );
        for (const s of servers) {
          logger.log(
            `  ${chalk.cyan(s.name)} ${chalk.gray(`(${s.id})`)} ` +
              chalk.dim(`★${s.rating ?? "-"} ${s.category}`),
          );
          logger.log(`    ${chalk.gray(s.description)}`);
          if (s.tags?.length) {
            logger.log(
              `    ${chalk.gray("tags:")} ${s.tags.slice(0, 5).join(", ")}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Registry list failed: ${err.message}`);
        process.exit(1);
      }
    });

  registry
    .command("search <keyword>")
    .description("Keyword search across name/description/tags")
    .option("--json", "Output as JSON")
    .action((keyword, options) => {
      try {
        const hits = registrySearchServers(keyword);
        if (options.json) {
          console.log(JSON.stringify({ hits, total: hits.length }, null, 2));
          return;
        }
        if (hits.length === 0) {
          logger.info(`No matches for "${keyword}".`);
          return;
        }
        logger.log(chalk.bold(`${hits.length} matches for "${keyword}":\n`));
        for (const s of hits) {
          logger.log(
            `  ${chalk.cyan(s.name)} ${chalk.gray(`(${s.id})`)} ` +
              chalk.dim(s.category),
          );
          logger.log(`    ${chalk.gray(s.description)}`);
        }
      } catch (err) {
        logger.error(`Registry search failed: ${err.message}`);
        process.exit(1);
      }
    });

  registry
    .command("show <idOrName>")
    .description("Show full catalog entry (id or short name)")
    .option("--json", "Output as JSON")
    .action((idOrName, options) => {
      try {
        const entry = registryGetServer(idOrName);
        if (!entry) {
          logger.error(`Not found: "${idOrName}".`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(entry, null, 2));
          return;
        }
        logger.log(
          `${chalk.bold(entry.displayName)} ${chalk.gray(`(${entry.id})`)}`,
        );
        logger.log(`  ${chalk.gray("Author:")}   ${entry.author}`);
        logger.log(`  ${chalk.gray("Category:")} ${entry.category}`);
        logger.log(`  ${chalk.gray("Version:")}  ${entry.version}`);
        logger.log(`  ${chalk.gray("Rating:")}   ★${entry.rating ?? "-"}`);
        logger.log(`  ${chalk.gray("Package:")}  ${entry.npmPackage}`);
        logger.log(
          `  ${chalk.gray("Command:")}  ${entry.command} ${entry.args.join(" ")}`,
        );
        logger.log(`  ${chalk.gray("Transport:")}${entry.transport}`);
        if (entry.homepage) {
          logger.log(`  ${chalk.gray("Homepage:")} ${entry.homepage}`);
        }
        logger.log(`\n  ${entry.description}`);
        if (entry.tools?.length) {
          logger.log(`\n  ${chalk.bold("Tools:")} ${entry.tools.join(", ")}`);
        }
        logger.log(
          `\n  ${chalk.dim("Install:")} cc mcp registry install ${entry.name}`,
        );
      } catch (err) {
        logger.error(`Registry show failed: ${err.message}`);
        process.exit(1);
      }
    });

  registry
    .command("install <idOrName>")
    .description("Install a catalog entry by registering it as an MCP server")
    .option("--as <name>", "Override the stored server name")
    .option("--auto-connect", "Mark the server to auto-connect on startup")
    .option("--json", "Output as JSON")
    .action(async (idOrName, options) => {
      try {
        const entry = registryGetServer(idOrName);
        if (!entry) {
          logger.error(
            `Not found: "${idOrName}". Try 'cc mcp registry list' or 'search'.`,
          );
          process.exit(1);
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const config = new MCPServerConfig(db);
        const storedName = (options.as || entry.name).trim();

        config.add(storedName, {
          command: entry.command,
          args: entry.args,
          autoConnect: !!options.autoConnect,
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                name: storedName,
                id: entry.id,
                command: entry.command,
                args: entry.args,
                autoConnect: !!options.autoConnect,
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `Installed ${chalk.cyan(storedName)} ` + chalk.dim(`(${entry.id})`),
          );
          logger.log(
            `  ${chalk.gray("Command:")} ${entry.command} ${entry.args.join(" ")}`,
          );
          logger.log(`  ${chalk.gray("Next:")} cc mcp connect ${storedName}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Registry install failed: ${err.message}`);
        process.exit(1);
      }
    });

  registry
    .command("categories")
    .description("List available registry categories")
    .option("--json", "Output as JSON")
    .action((options) => {
      if (options.json) {
        console.log(JSON.stringify(REGISTRY_CATEGORIES, null, 2));
        return;
      }
      logger.log(chalk.bold("Categories:"));
      for (const c of REGISTRY_CATEGORIES) {
        const count = REGISTRY_CATALOG.filter((s) => s.category === c).length;
        logger.log(`  ${chalk.cyan(c)} ${chalk.dim(`(${count})`)}`);
      }
    });

  // ===== V2 governance subcommands (mcp-registry V2) =====
  mcp
    .command("server-maturities-v2")
    .description("List MCP server maturity states (V2)")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.MCP_SERVER_MATURITY_V2, null, 2));
    });
  mcp
    .command("invocation-lifecycle-v2")
    .description("List MCP invocation lifecycle states (V2)")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.MCP_INVOCATION_LIFECYCLE_V2, null, 2));
    });
  mcp
    .command("stats-v2")
    .description("Show MCP registry V2 stats")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.getMcpRegistryStatsV2(), null, 2));
    });
  mcp
    .command("config-v2")
    .description("Show MCP registry V2 config")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(
        JSON.stringify(
          {
            maxActiveServersPerOwner: m.getMaxActiveServersPerOwnerV2(),
            maxPendingInvocationsPerServer:
              m.getMaxPendingInvocationsPerServerV2(),
            serverIdleMs: m.getServerIdleMsV2(),
            invocationStuckMs: m.getInvocationStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  mcp
    .command("register-server-v2 <id> <owner> <endpoint>")
    .description("Register an MCP server (V2)")
    .action(async (id, owner, endpoint) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(
        JSON.stringify(m.registerServerV2({ id, owner, endpoint }), null, 2),
      );
    });
  mcp
    .command("activate-server-v2 <id>")
    .description("Activate an MCP server (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.activateServerV2(id), null, 2));
    });
  mcp
    .command("degrade-server-v2 <id>")
    .description("Degrade an MCP server (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.degradeServerV2(id), null, 2));
    });
  mcp
    .command("retire-server-v2 <id>")
    .description("Retire an MCP server (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.retireServerV2(id), null, 2));
    });
  mcp
    .command("touch-server-v2 <id>")
    .description("Touch an MCP server (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.touchServerV2(id), null, 2));
    });
  mcp
    .command("get-server-v2 <id>")
    .description("Get an MCP server (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.getServerV2(id), null, 2));
    });
  mcp
    .command("list-servers-v2")
    .description("List MCP servers (V2)")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.listServersV2(), null, 2));
    });
  mcp
    .command("create-invocation-v2 <id> <serverId> <tool>")
    .description("Create an MCP invocation (V2)")
    .action(async (id, serverId, tool) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(
        JSON.stringify(m.createInvocationV2({ id, serverId, tool }), null, 2),
      );
    });
  mcp
    .command("dispatch-invocation-v2 <id>")
    .description("Dispatch an MCP invocation (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.dispatchInvocationV2(id), null, 2));
    });
  mcp
    .command("complete-invocation-v2 <id>")
    .description("Complete an MCP invocation (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.completeInvocationV2(id), null, 2));
    });
  mcp
    .command("fail-invocation-v2 <id> [reason]")
    .description("Fail an MCP invocation (V2)")
    .action(async (id, reason) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.failInvocationV2(id, reason), null, 2));
    });
  mcp
    .command("cancel-invocation-v2 <id> [reason]")
    .description("Cancel an MCP invocation (V2)")
    .action(async (id, reason) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.cancelInvocationV2(id, reason), null, 2));
    });
  mcp
    .command("get-invocation-v2 <id>")
    .description("Get an MCP invocation (V2)")
    .action(async (id) => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.getInvocationV2(id), null, 2));
    });
  mcp
    .command("list-invocations-v2")
    .description("List MCP invocations (V2)")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.listInvocationsV2(), null, 2));
    });
  mcp
    .command("auto-degrade-idle-servers-v2")
    .description("Auto-degrade idle MCP servers (V2)")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.autoDegradeIdleServersV2(), null, 2));
    });
  mcp
    .command("auto-fail-stuck-invocations-v2")
    .description("Auto-fail stuck MCP invocations (V2)")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      console.log(JSON.stringify(m.autoFailStuckInvocationsV2(), null, 2));
    });
  mcp
    .command("set-max-active-servers-v2 <n>")
    .description("Set max active servers per owner (V2)")
    .action(async (n) => {
      const m = await import("../lib/mcp-registry.js");
      m.setMaxActiveServersPerOwnerV2(parseInt(n, 10));
      console.log(
        JSON.stringify(
          { maxActiveServersPerOwner: m.getMaxActiveServersPerOwnerV2() },
          null,
          2,
        ),
      );
    });
  mcp
    .command("set-max-pending-invocations-v2 <n>")
    .description("Set max pending invocations per server (V2)")
    .action(async (n) => {
      const m = await import("../lib/mcp-registry.js");
      m.setMaxPendingInvocationsPerServerV2(parseInt(n, 10));
      console.log(
        JSON.stringify(
          {
            maxPendingInvocationsPerServer:
              m.getMaxPendingInvocationsPerServerV2(),
          },
          null,
          2,
        ),
      );
    });
  mcp
    .command("set-server-idle-ms-v2 <n>")
    .description("Set MCP server idle timeout in ms (V2)")
    .action(async (n) => {
      const m = await import("../lib/mcp-registry.js");
      m.setServerIdleMsV2(parseInt(n, 10));
      console.log(
        JSON.stringify({ serverIdleMs: m.getServerIdleMsV2() }, null, 2),
      );
    });
  mcp
    .command("set-invocation-stuck-ms-v2 <n>")
    .description("Set MCP invocation stuck timeout in ms (V2)")
    .action(async (n) => {
      const m = await import("../lib/mcp-registry.js");
      m.setInvocationStuckMsV2(parseInt(n, 10));
      console.log(
        JSON.stringify(
          { invocationStuckMs: m.getInvocationStuckMsV2() },
          null,
          2,
        ),
      );
    });
  mcp
    .command("reset-state-v2")
    .description("Reset MCP registry V2 in-memory state")
    .action(async () => {
      const m = await import("../lib/mcp-registry.js");
      m._resetStateMcpRegistryV2();
      console.log(JSON.stringify({ ok: true }, null, 2));
    });
}
