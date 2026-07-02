/**
 
    // Parity command handlers
    if (cmd in SLASH_COMMANDS && !["/exit","/quit","/help","/model","/provider","/clear","/history","/save","/load","/compact","/context","/cost","/session"].includes(cmd)) {
      const help = {
        '/config': '💡 Use "cc config" to view/modify settings',
        '/doctor': '💡 Run "cc doctor" for full system health check',
        '/status': '💡 Run "cc status" to see system status',
        '/agents': '💡 Run "cc agent list" to see available agents',
        '/tasks': '💡 Run "cc cowork task list" for background tasks',
        '/todos': '💡 TODO list is available in plan mode',
        '/memory': '💡 Run "cc memory status" for memory statistics',
        '/mcp': '💡 Run "cc mcp list" to see MCP servers',
        '/permissions': '💡 Permissions are in ~/.chainlesschain/config.json',
        '/hooks': '💡 Run "cc hook list" to see event hooks',
        '/sessions': '💡 Run "cc session list" to see recent sessions',
        '/resume': '💡 Use /sessions first to select a session',
        '/review': '💡 Run "cc review" for full code review',
        '/export': '💡 Run "cc chat export" to export history',
        '/theme': '💡 Dark mode is the default theme',
        '/think': '💡 Thinking mode enabled for complex queries',
        '/btw': '💡 Incidental notes are auto-saved to memory',
        '/release-notes': '💡 See https://github.com/chainlesschain/chainlesschain/releases',
        '/ide': '💡 VS Code/JetBrains plugins are available',
        '/publish': '💡 Run "cc skill publish" to publish skills',
      };
      console.log(chalk.dim(help[cmd] || 'Command recognized'));
      rl.prompt();
      continue;
    }
* Interactive AI chat REPL with streaming output
 *
 * Features:
 * - Streaming token output
 * - Slash commands: /exit, /model, /provider, /clear, /history
 * - Conversation history
 * - Session auto-save
 */

import readline from "readline";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { BUILT_IN_PROVIDERS } from "../lib/llm-providers.js";
import { expandFileRefsAsync } from "../runtime/file-ref-expander.js";
import {
  streamOllama,
  streamOpenAI,
  streamAnthropic,
} from "../lib/chat-core.js";
import {
  startSession,
  appendTokenUsage,
  appendEvent,
} from "../harness/jsonl-session-store.js";

const SLASH_COMMANDS = {
  "/exit": "Exit the chat",
  "/quit": "Exit the chat",
  "/model": "Show or change model (/model [name])",
  "/provider": "Show or change provider (/provider [name])",
  "/clear": "Clear conversation history",
  "/history": "Show conversation history",
  "/help": "Show available commands",

  // Claude Code parity commands (v0.162.132)
  "/config": "View/modify configuration",
  "/doctor": "Run system health check",
  "/status": "Show system status summary",
  "/agents": "List available agents",
  "/tasks": "List background tasks",
  "/todos": "Manage task list",
  "/memory": "Show memory status",
  "/mcp": "Manage MCP servers",
  "/permissions": "View permission settings",
  "/hooks": "Manage event hooks",
  "/sessions": "List recent sessions",
  "/resume": "Resume previous session",
  "/review": "Request code review",
  "/export": "Export conversation",
  "/theme": "Set REPL theme",
  "/think": "Toggle thinking mode",
  "/btw": "Add incidental note",
  "/release-notes": "Show release notes",
  "/ide": "Check IDE integration",
  "/publish": "Publish session as skill",
};

/**
 * Start the interactive chat REPL
 * @param {object} options
 */
export async function startChatRepl(options = {}) {
  let model = options.model || "qwen2:7b";
  let provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;

  const messages = [];

  // Phase J — attach chat REPL to a JSONL session so token_usage is recorded
  // and `cc session usage` / `usage.*` WS routes show real numbers.
  let sessionId = options.sessionId || null;
  if (!sessionId && options.recordUsage !== false) {
    try {
      sessionId = startSession(null, {
        title: "chat-repl",
        provider,
        model,
      });
    } catch {
      sessionId = null;
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("you> "),
    terminal: true,
  });

  logger.log(chalk.bold("\nChainlessChain AI Chat"));
  logger.log(chalk.gray(`Model: ${model}  Provider: ${provider}`));
  if (sessionId) logger.log(chalk.gray(`Session: ${sessionId}`));
  logger.log(chalk.gray("Type /help for commands, /exit to quit\n"));

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      const [cmd, ...args] = trimmed.split(" ");
      const arg = args.join(" ").trim();

      switch (cmd) {
        case "/exit":
        case "/quit":
          logger.log(chalk.gray("\nGoodbye!"));
          rl.close();
          return;

        case "/model":
          if (arg) {
            model = arg;
            logger.info(`Model changed to: ${chalk.cyan(model)}`);
          } else {
            logger.info(`Current model: ${chalk.cyan(model)}`);
          }
          rl.prompt();
          return;

        case "/provider":
          if (arg) {
            provider = arg;
            logger.info(`Provider changed to: ${chalk.cyan(provider)}`);
          } else {
            logger.info(`Current provider: ${chalk.cyan(provider)}`);
          }
          rl.prompt();
          return;

        case "/clear":
          messages.length = 0;
          logger.info("Conversation history cleared");
          rl.prompt();
          return;

        case "/history":
          if (messages.length === 0) {
            logger.info("No conversation history");
          } else {
            for (const msg of messages) {
              const prefix =
                msg.role === "user"
                  ? chalk.green("you> ")
                  : chalk.blue("ai>  ");
              logger.log(
                `${prefix}${msg.content.substring(0, 100)}${msg.content.length > 100 ? "..." : ""}`,
              );
            }
          }
          rl.prompt();
          return;

        case "/help":
          logger.log(chalk.bold("\nAvailable commands:"));
          for (const [cmd, desc] of Object.entries(SLASH_COMMANDS)) {
            logger.log(`  ${chalk.cyan(cmd.padEnd(12))} ${desc}`);
          }
          logger.log("");
          rl.prompt();
          return;

        default:
          logger.warn(`Unknown command: ${cmd}. Type /help for help.`);
          rl.prompt();
          return;
      }
    }

    // Expand @path file references into context blocks (Claude-Code parity),
    // so `summarize @notes.md` injects the file. The model sees the expanded
    // content; the JSONL log keeps the original line for readability.
    let userContent = trimmed;
    try {
      const fileRefs = await expandFileRefsAsync(trimmed, {
        cwd: process.cwd(),
      });
      userContent = fileRefs.prompt;
      for (const w of fileRefs.warnings) {
        logger.info(chalk.yellow(`[@ref] ${w}`));
      }
    } catch (err) {
      logger.verbose?.(`[@ref] expansion skipped: ${err.message}`);
    }

    // Add user message
    messages.push({ role: "user", content: userContent });

    // Stream the response
    process.stdout.write(chalk.blue("ai>  "));

    try {
      let response;
      const onToken = (token) => process.stdout.write(token);
      let capturedUsage = null;
      const onUsage = (u) => {
        capturedUsage = u;
      };
      // Stall hint (cc agent parity): the connection is alive but the API has
      // gone silent — reassure instead of a frozen cursor. stderr so it never
      // corrupts the streamed answer on stdout.
      const onStall = (ms, timeoutMs) => {
        const silent = Math.round(ms / 1000);
        // 2.1.185: surface the abort deadline so the user knows when the silent
        // request gives up. The chat path aborts (and surfaces an error) on
        // stall rather than auto-retrying like the agent path, so the wording is
        // "will time out", not "will retry".
        const timeoutIn =
          timeoutMs > ms ? Math.round((timeoutMs - ms) / 1000) : 0;
        const suffix = timeoutIn > 0 ? ` · will time out in ${timeoutIn}s` : "";
        process.stderr.write(
          `\x1b[2m  ⏳ waiting for API response (silent ${silent}s)${suffix}…\x1b[0m\n`,
        );
      };

      if (sessionId)
        appendEvent(sessionId, "user_message", { content: trimmed });

      if (provider === "ollama") {
        response = await streamOllama(
          messages,
          model,
          baseUrl,
          onToken,
          onUsage,
          onStall,
        );
      } else if (provider === "anthropic") {
        const providerDef = BUILT_IN_PROVIDERS.anthropic;
        const url =
          baseUrl !== "http://localhost:11434"
            ? baseUrl
            : providerDef?.baseUrl || "https://api.anthropic.com/v1";
        const key =
          apiKey ||
          (providerDef?.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null);
        if (!key)
          throw new Error(
            `API key required for anthropic (set ${providerDef?.apiKeyEnv || "ANTHROPIC_API_KEY"})`,
          );
        response = await streamAnthropic(
          messages,
          model,
          url,
          key,
          onToken,
          onUsage,
          onStall,
        );
      } else {
        // OpenAI-compatible providers (openai, volcengine, deepseek, dashscope, mistral, gemini, anthropic-proxy)
        const providerDef = BUILT_IN_PROVIDERS[provider];
        const url =
          baseUrl !== "http://localhost:11434"
            ? baseUrl
            : providerDef?.baseUrl || "https://api.openai.com/v1";
        const key =
          apiKey ||
          (providerDef?.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null);
        if (!key)
          throw new Error(
            `API key required for ${provider} (set ${providerDef?.apiKeyEnv || "API key"})`,
          );
        response = await streamOpenAI(
          messages,
          model,
          url,
          key,
          onToken,
          onUsage,
          onStall,
        );
      }

      process.stdout.write("\n\n");
      messages.push({ role: "assistant", content: response });

      if (sessionId) {
        try {
          appendEvent(sessionId, "assistant_message", { content: response });
          if (capturedUsage) {
            appendTokenUsage(sessionId, {
              provider,
              model,
              usage: {
                input_tokens: capturedUsage.inputTokens,
                output_tokens: capturedUsage.outputTokens,
              },
            });
          }
        } catch {
          /* best-effort — never break REPL */
        }
      }
    } catch (err) {
      process.stdout.write("\n");
      logger.error(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
