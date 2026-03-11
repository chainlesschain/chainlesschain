/**
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

const SLASH_COMMANDS = {
  "/exit": "Exit the chat",
  "/quit": "Exit the chat",
  "/model": "Show or change model (/model [name])",
  "/provider": "Show or change provider (/provider [name])",
  "/clear": "Clear conversation history",
  "/history": "Show conversation history",
  "/help": "Show available commands",
};

/**
 * Stream a response from Ollama
 */
async function streamOllama(messages, model, baseUrl, onToken) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullResponse += json.message.content;
          onToken(json.message.content);
        }
      } catch {
        // Partial JSON, skip
      }
    }
  }

  return fullResponse;
}

/**
 * Stream a response from OpenAI-compatible API
 */
async function streamOpenAI(messages, model, baseUrl, apiKey, onToken) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n").filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullResponse += content;
            onToken(content);
          }
        } catch {
          // Partial data
        }
      }
    }
  }

  return fullResponse;
}

/**
 * Start the interactive chat REPL
 * @param {object} options
 */
export async function startChatRepl(options = {}) {
  let model = options.model || "qwen2:7b";
  let provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  const messages = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("you> "),
    terminal: true,
  });

  logger.log(chalk.bold("\nChainlessChain AI Chat"));
  logger.log(chalk.gray(`Model: ${model}  Provider: ${provider}`));
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

    // Add user message
    messages.push({ role: "user", content: trimmed });

    // Stream the response
    process.stdout.write(chalk.blue("ai>  "));

    try {
      let response;
      const onToken = (token) => process.stdout.write(token);

      if (provider === "ollama") {
        response = await streamOllama(messages, model, baseUrl, onToken);
      } else if (provider === "openai") {
        const url =
          baseUrl !== "http://localhost:11434"
            ? baseUrl
            : "https://api.openai.com/v1";
        response = await streamOpenAI(messages, model, url, apiKey, onToken);
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      process.stdout.write("\n\n");
      messages.push({ role: "assistant", content: response });
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
