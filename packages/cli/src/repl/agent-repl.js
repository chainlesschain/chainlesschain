/**
 * Agentic REPL - Claude Code / Codex style
 *
 * User speaks naturally → AI understands intent → picks tools → executes → shows result
 *
 * Built-in tools:
 *  - read_file: Read a file
 *  - write_file: Write/create a file
 *  - edit_file: Edit part of a file
 *  - run_shell: Execute a shell command
 *  - search_files: Search for files by name/content
 *  - list_dir: List directory contents
 *  - db_query: Query the ChainlessChain database
 *  - note_add: Add a note
 *  - note_search: Search notes
 *
 * The AI decides which tools to call based on user intent.
 */

import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";
import { getPlanModeManager, PlanState } from "../lib/plan-mode.js";

/**
 * Tool definitions for function calling
 */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file's content",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file (create or overwrite)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace a specific string in a file with new content",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          old_string: {
            type: "string",
            description: "Exact string to find and replace",
          },
          new_string: {
            type: "string",
            description: "Replacement string",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Execute a shell command and return the output. Use for running tests, installing packages, git operations, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          cwd: {
            type: "string",
            description: "Working directory (optional)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for files by name pattern or content",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern or search string",
          },
          directory: {
            type: "string",
            description: "Directory to search in (default: cwd)",
          },
          content_search: {
            type: "boolean",
            description: "If true, search file contents instead of names",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List contents of a directory",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path (default: cwd)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_skill",
      description:
        "Run a built-in ChainlessChain skill. Available skills include: code-review, summarize, translate, refactor, unit-test, debug, explain-code, browser-automation, data-analysis, git-history-analyzer, and 130+ more. Use list_skills first to discover available skills.",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description:
              "Name of the skill to run (e.g. code-review, summarize, translate)",
          },
          input: {
            type: "string",
            description: "Input text or parameters for the skill",
          },
        },
        required: ["skill_name", "input"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description:
        "List available built-in skills, optionally filtered by category or keyword",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "Filter by category (e.g. development, automation, data)",
          },
          query: {
            type: "string",
            description: "Search keyword to filter skills",
          },
        },
      },
    },
  },
];

/**
 * Find and load bundled skills (shared with skill command)
 */
const __agentDirname = path.dirname(fileURLToPath(import.meta.url));

function findSkillsDir() {
  const candidates = [
    path.resolve(
      __agentDirname,
      "../../../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
    ),
    path.resolve(
      process.cwd(),
      "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
    ),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function loadSkillList(skillsDir) {
  const skills = [];
  try {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillMd = path.join(skillsDir, dir.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      try {
        const content = fs.readFileSync(skillMd, "utf8");
        const lines = content.split("\n");
        if (lines[0].trim() !== "---") continue;
        let endIndex = -1;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === "---") {
            endIndex = i;
            break;
          }
        }
        if (endIndex === -1) continue;
        const data = {};
        for (const line of lines.slice(1, endIndex)) {
          const ci = line.indexOf(":");
          if (ci > 0) {
            const key = line.slice(0, ci).trim();
            const val = line
              .slice(ci + 1)
              .trim()
              .replace(/^['"]|['"]$/g, "");
            data[key] = val;
          }
        }
        skills.push({
          id: data.name || dir.name,
          description: data.description || "",
          category: data.category || "uncategorized",
          dirName: dir.name,
          hasHandler: fs.existsSync(
            path.join(skillsDir, dir.name, "handler.js"),
          ),
        });
      } catch {
        // Skip malformed skill files
      }
    }
  } catch {
    // Skills dir unreadable
  }
  return skills;
}

/**
 * Execute a tool call (with plan mode filtering)
 */
async function executeTool(name, args) {
  // Plan mode: check if tool is allowed
  const planManager = getPlanModeManager();
  if (planManager.isActive() && !planManager.isToolAllowed(name)) {
    // In plan mode, log the blocked tool as a plan item
    planManager.addPlanItem({
      title: `${name}: ${formatToolArgs(name, args)}`,
      tool: name,
      params: args,
      estimatedImpact:
        name === "run_shell"
          ? "high"
          : name === "write_file"
            ? "medium"
            : "low",
    });
    return {
      error: `[Plan Mode] Tool "${name}" is blocked during planning. It has been added to the plan. Use /plan approve to execute.`,
    };
  }

  switch (name) {
    case "read_file": {
      const filePath = path.resolve(args.path);
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(filePath, "utf8");
      // Truncate very long files
      if (content.length > 50000) {
        return {
          content: content.substring(0, 50000) + "\n...(truncated)",
          size: content.length,
        };
      }
      return { content };
    }

    case "write_file": {
      const filePath = path.resolve(args.path);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, args.content, "utf8");
      return { success: true, path: filePath, size: args.content.length };
    }

    case "edit_file": {
      const filePath = path.resolve(args.path);
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes(args.old_string)) {
        return { error: "old_string not found in file" };
      }
      const newContent = content.replace(args.old_string, args.new_string);
      fs.writeFileSync(filePath, newContent, "utf8");
      return { success: true, path: filePath };
    }

    case "run_shell": {
      try {
        const output = execSync(args.command, {
          cwd: args.cwd || process.cwd(),
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        return { stdout: output.substring(0, 10000) };
      } catch (err) {
        return {
          error: err.message.substring(0, 2000),
          stderr: (err.stderr || "").substring(0, 2000),
          exitCode: err.status,
        };
      }
    }

    case "search_files": {
      const dir = args.directory ? path.resolve(args.directory) : process.cwd();
      try {
        if (args.content_search) {
          // Use grep/findstr for content search
          const cmd =
            process.platform === "win32"
              ? `findstr /s /i /n "${args.pattern}" *`
              : `grep -r -l -i "${args.pattern}" . --include="*" 2>/dev/null | head -20`;
          const output = execSync(cmd, {
            cwd: dir,
            encoding: "utf8",
            timeout: 10000,
          });
          return { matches: output.trim().split("\n").slice(0, 20) };
        } else {
          // File name search
          const cmd =
            process.platform === "win32"
              ? `dir /s /b *${args.pattern}* 2>NUL`
              : `find . -name "*${args.pattern}*" -type f 2>/dev/null | head -20`;
          const output = execSync(cmd, {
            cwd: dir,
            encoding: "utf8",
            timeout: 10000,
          });
          return {
            files: output.trim().split("\n").filter(Boolean).slice(0, 20),
          };
        }
      } catch {
        return { files: [], message: "No matches found" };
      }
    }

    case "list_dir": {
      const dirPath = args.path ? path.resolve(args.path) : process.cwd();
      if (!fs.existsSync(dirPath)) {
        return { error: `Directory not found: ${dirPath}` };
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return {
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        })),
      };
    }

    case "run_skill": {
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        return {
          error:
            "Skills directory not found. Make sure you're in the ChainlessChain project root.",
        };
      }
      const handlerPath = path.join(skillsDir, args.skill_name, "handler.js");
      if (!fs.existsSync(handlerPath)) {
        // Try fuzzy match
        const skills = loadSkillList(skillsDir);
        const match = skills.find(
          (s) => s.id === args.skill_name || s.dirName === args.skill_name,
        );
        if (match && match.hasHandler) {
          const matchedPath = path.join(skillsDir, match.dirName, "handler.js");
          try {
            const handler = (
              await import(`file://${matchedPath.replace(/\\/g, "/")}`)
            ).default;
            const task = {
              params: { input: args.input },
              input: args.input,
              action: args.input,
            };
            const context = {
              projectRoot: process.cwd(),
              workspacePath: process.cwd(),
            };
            const result = await handler.execute(task, context);
            return result;
          } catch (err) {
            return { error: `Skill execution failed: ${err.message}` };
          }
        }
        return {
          error: `Skill "${args.skill_name}" not found or has no handler. Use list_skills to see available skills.`,
        };
      }
      try {
        const handler = (
          await import(`file://${handlerPath.replace(/\\/g, "/")}`)
        ).default;
        if (handler.init) await handler.init({});
        const task = {
          params: { input: args.input },
          input: args.input,
          action: args.input,
        };
        const context = {
          projectRoot: process.cwd(),
          workspacePath: process.cwd(),
        };
        const result = await handler.execute(task, context);
        return result;
      } catch (err) {
        return { error: `Skill execution failed: ${err.message}` };
      }
    }

    case "list_skills": {
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        return { error: "Skills directory not found." };
      }
      let skills = loadSkillList(skillsDir);
      if (args.category) {
        skills = skills.filter(
          (s) => s.category.toLowerCase() === args.category.toLowerCase(),
        );
      }
      if (args.query) {
        const q = args.query.toLowerCase();
        skills = skills.filter(
          (s) =>
            s.id.includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q),
        );
      }
      return {
        count: skills.length,
        skills: skills.map((s) => ({
          id: s.id,
          category: s.category,
          hasHandler: s.hasHandler,
          description: s.description.substring(0, 80),
        })),
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * Send a chat completion request with tools
 */
async function chatWithTools(messages, options) {
  const { provider, model, baseUrl, apiKey } = options;

  if (provider === "ollama") {
    // Ollama supports tool calling for some models
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    return await response.json();
  } else if (provider === "openai") {
    const url =
      baseUrl && baseUrl !== "http://localhost:11434"
        ? baseUrl
        : "https://api.openai.com/v1";
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("API key required");

    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages,
        tools: TOOLS,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    // Normalize to Ollama-like format
    if (!data.choices || !data.choices[0]) {
      throw new Error("Invalid API response: no choices returned");
    }
    const choice = data.choices[0];
    return {
      message: choice.message,
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Agentic loop - keeps calling tools until the AI gives a final text response
 */
async function agentLoop(messages, options) {
  const MAX_ITERATIONS = 10;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const result = await chatWithTools(messages, options);
    const msg = result?.message;

    if (!msg) {
      return "(No response from LLM)";
    }

    // Check for tool calls
    const toolCalls = msg.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls — final text response
      return msg.content || "";
    }

    // Add assistant message with tool calls
    messages.push(msg);

    // Execute each tool call
    for (const call of toolCalls) {
      const fn = call.function;
      const toolName = fn.name;
      let toolArgs;

      try {
        toolArgs =
          typeof fn.arguments === "string"
            ? JSON.parse(fn.arguments)
            : fn.arguments;
      } catch {
        toolArgs = {};
      }

      // Show what the AI is doing
      process.stdout.write(
        chalk.gray(`  [${toolName}] ${formatToolArgs(toolName, toolArgs)}\n`),
      );

      const toolResult = await executeTool(toolName, toolArgs);

      // Show brief result
      if (toolResult.error) {
        process.stdout.write(chalk.red(`  Error: ${toolResult.error}\n`));
      } else if (toolResult.success) {
        process.stdout.write(chalk.green(`  Done\n`));
      }

      // Add tool result to messages
      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult).substring(0, 5000),
        tool_call_id: call.id,
      });
    }
  }

  return "(Reached max tool call iterations)";
}

/**
 * Format tool args for display
 */
function formatToolArgs(name, args) {
  switch (name) {
    case "read_file":
      return args.path;
    case "write_file":
      return `${args.path} (${args.content?.length || 0} chars)`;
    case "edit_file":
      return args.path;
    case "run_shell":
      return args.command;
    case "search_files":
      return args.pattern;
    case "list_dir":
      return args.path || ".";
    case "run_skill":
      return `${args.skill_name}: ${(args.input || "").substring(0, 50)}`;
    case "list_skills":
      return args.category || args.query || "all";
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}

const SYSTEM_PROMPT = `You are ChainlessChain AI Assistant, a powerful agentic coding assistant running in the terminal.

You have access to tools that let you read files, write files, edit files, run shell commands, and search the codebase. When the user asks you to do something, USE THE TOOLS to actually do it — don't just describe what should be done.

Key behaviors:
- When asked to modify code, read the file first, then edit it
- When asked to create something, use write_file to create it
- When asked to run/test something, use run_shell to execute it
- When asked about files or code, use read_file and search_files to find information
- You have 138 built-in skills (code-review, summarize, translate, refactor, etc.) — use list_skills to discover them and run_skill to execute them
- Always explain what you're doing and show results
- Be concise but thorough

Current working directory: ${process.cwd()}`;

/**
 * Start the agentic REPL
 */
export async function startAgentRepl(options = {}) {
  let model = options.model || "qwen2:7b";
  let provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  const getPrompt = () => {
    const planManager = getPlanModeManager();
    if (planManager.isActive()) {
      const state = planManager.state;
      if (state === PlanState.APPROVED || state === PlanState.EXECUTING) {
        return chalk.green("[plan:exec] > ");
      }
      return chalk.yellow("[plan] > ");
    }
    return chalk.green("> ");
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    terminal: true,
  });

  logger.log(chalk.bold("\nChainlessChain Agent"));
  logger.log(
    chalk.gray(`Model: ${model}  Provider: ${provider}  CWD: ${process.cwd()}`),
  );
  logger.log(
    chalk.gray(
      "Describe what you want to do. I can read/write files, run commands, and more.",
    ),
  );
  logger.log(chalk.gray("Type /exit to quit, /help for commands\n"));

  const prompt = () => {
    rl.setPrompt(getPrompt());
    rl.prompt();
  };
  prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    // Slash commands
    if (trimmed === "/exit" || trimmed === "/quit") {
      logger.log(chalk.gray("\nGoodbye!"));
      rl.close();
      return;
    }

    if (trimmed === "/help") {
      logger.log(chalk.bold("\nCommands:"));
      logger.log(`  ${chalk.cyan("/exit")}       Exit the agent`);
      logger.log(
        `  ${chalk.cyan("/model")}      Show/change model (/model <name>)`,
      );
      logger.log(`  ${chalk.cyan("/provider")}   Show/change provider`);
      logger.log(`  ${chalk.cyan("/clear")}      Clear conversation`);
      logger.log(`  ${chalk.cyan("/compact")}    Keep only last 4 messages`);
      logger.log(
        `  ${chalk.cyan("/plan")}       Enter plan mode (read-only analysis first)`,
      );
      logger.log(`  ${chalk.cyan("/plan show")}  Show current plan`);
      logger.log(
        `  ${chalk.cyan("/plan approve")} Approve and execute the plan`,
      );
      logger.log(`  ${chalk.cyan("/plan reject")}  Reject the plan`);
      logger.log(chalk.bold("\nCapabilities:"));
      logger.log("  Read, write, and edit files");
      logger.log("  Run shell commands (git, npm, etc.)");
      logger.log("  Search codebase by filename or content");
      logger.log("  Run 138 built-in skills (code-review, summarize, etc.)");
      logger.log("  Plan mode: analyze first, execute after approval\n");
      prompt();
      return;
    }

    if (trimmed.startsWith("/model")) {
      const arg = trimmed.slice(6).trim();
      if (arg) {
        model = arg;
        logger.info(`Model: ${chalk.cyan(model)}`);
      } else {
        logger.info(`Current model: ${chalk.cyan(model)}`);
      }
      prompt();
      return;
    }

    if (trimmed.startsWith("/provider")) {
      const arg = trimmed.slice(9).trim();
      if (arg) {
        provider = arg;
        logger.info(`Provider: ${chalk.cyan(provider)}`);
      } else {
        logger.info(`Current provider: ${chalk.cyan(provider)}`);
      }
      prompt();
      return;
    }

    if (trimmed === "/clear") {
      messages.length = 1; // Keep system prompt
      logger.info("Conversation cleared");
      prompt();
      return;
    }

    if (trimmed === "/compact") {
      // Keep system prompt + last 4 messages
      if (messages.length > 5) {
        const systemMsg = messages[0];
        const recent = messages.slice(-4);
        messages.length = 0;
        messages.push(systemMsg, ...recent);
        logger.info("Conversation compacted to last 4 messages");
      }
      prompt();
      return;
    }

    // Plan mode commands
    if (trimmed.startsWith("/plan")) {
      const planManager = getPlanModeManager();
      const subCmd = trimmed.slice(5).trim();

      if (!subCmd || subCmd === "enter") {
        if (planManager.isActive()) {
          logger.info(
            "Already in plan mode. Use /plan show, /plan approve, or /plan reject.",
          );
        } else {
          planManager.enterPlanMode({ title: "Agent Plan" });
          logger.success(
            "Entered plan mode. Write tools are blocked until you approve the plan.",
          );
          logger.info(
            "The AI can still read files and search. Blocked tools become plan items.",
          );
          logger.info(
            "Use /plan show to see the plan, /plan approve to execute.",
          );
          // Inject plan mode context into system prompt
          messages.push({
            role: "system",
            content:
              "[PLAN MODE ACTIVE] You are now in plan mode. You can read files, search, and analyze — but write/execute tools are blocked. Any blocked tool calls will be recorded as plan items. Analyze the task thoroughly, then the user will approve your plan.",
          });
        }
      } else if (subCmd === "show") {
        if (!planManager.isActive()) {
          logger.info("Not in plan mode. Use /plan to enter.");
        } else {
          logger.log("\n" + planManager.generatePlanSummary() + "\n");
        }
      } else if (subCmd === "approve" || subCmd === "yes") {
        if (!planManager.isActive()) {
          logger.info("No plan to approve.");
        } else if (planManager.currentPlan.items.length === 0) {
          logger.info(
            "Plan has no items yet. Let the AI analyze the task first.",
          );
        } else {
          planManager.approvePlan();
          logger.success(
            `Plan approved! ${planManager.currentPlan.items.length} items ready for execution.`,
          );
          logger.info(
            "Write/execute tools are now unlocked. The AI can proceed.",
          );
          messages.push({
            role: "system",
            content: `[PLAN APPROVED] The user has approved your plan with ${planManager.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, and run_skill. Execute the plan items in order.`,
          });
        }
      } else if (subCmd === "reject" || subCmd === "no") {
        if (!planManager.isActive()) {
          logger.info("No plan to reject.");
        } else {
          planManager.rejectPlan("User rejected");
          logger.info("Plan rejected. Exited plan mode.");
        }
      } else if (subCmd === "exit") {
        if (planManager.isActive()) {
          planManager.exitPlanMode({ savePlan: true });
          logger.info("Exited plan mode.");
        } else {
          logger.info("Not in plan mode.");
        }
      } else {
        logger.info(
          "Unknown /plan subcommand. Try: /plan, /plan show, /plan approve, /plan reject, /plan exit",
        );
      }

      prompt();
      return;
    }

    // Add user message
    messages.push({ role: "user", content: trimmed });

    try {
      process.stdout.write("\n");
      const response = await agentLoop(messages, {
        provider,
        model,
        baseUrl,
        apiKey,
      });

      if (response) {
        process.stdout.write(`\n${response}\n\n`);
        messages.push({ role: "assistant", content: response });
      } else {
        process.stdout.write("\n");
      }
    } catch (err) {
      logger.error(`Error: ${err.message}`);

      // If connection error, provide helpful message
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed")
      ) {
        logger.info(`Make sure ${provider} is running at ${baseUrl}`);
        if (provider === "ollama") {
          logger.info("Start Ollama: ollama serve");
        }
      }
    }

    prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
