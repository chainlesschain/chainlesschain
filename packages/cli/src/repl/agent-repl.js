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
 *  - run_skill: Run a built-in skill
 *  - list_skills: List available skills
 *  - run_code: Write and execute code (Python/Node.js/Bash)
 *
 * The AI decides which tools to call based on user intent.
 */

import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";
import { getPlanModeManager, PlanState } from "../lib/plan-mode.js";
import { CLISkillLoader } from "../lib/skill-loader.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createSession,
  saveMessages,
  getSession,
} from "../lib/session-manager.js";
import { storeMemory, consolidateMemory } from "../lib/hierarchical-memory.js";
import { CLIContextEngineering } from "../lib/cli-context-engineering.js";
import { createChatFn } from "../lib/cowork-adapter.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../lib/task-model-selector.js";
import { executeHooks, HookEvents } from "../lib/hook-manager.js";
import { CLIPermanentMemory } from "../lib/permanent-memory.js";
import { CLIAutonomousAgent, GoalStatus } from "../lib/autonomous-agent.js";

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
  {
    type: "function",
    function: {
      name: "run_code",
      description:
        "Write and execute code in Python, Node.js, or Bash. Use this when the user needs data processing, calculations, file batch operations, API calls, or any task best solved with a script. The code is saved to a temp file and executed.",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["python", "node", "bash"],
            description: "Programming language",
          },
          code: { type: "string", description: "Code to execute" },
          timeout: {
            type: "number",
            description: "Execution timeout in seconds (default: 60, max: 300)",
          },
        },
        required: ["language", "code"],
      },
    },
  },
];

/**
 * Shared multi-layer skill loader
 */
const skillLoader = new CLISkillLoader();

/**
 * Reference to the runtime DB for hook execution (set during startAgentRepl)
 */
let _hookDb = null;

/**
 * Execute a tool call (with plan mode filtering and hook pipeline)
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
        name === "run_shell" || name === "run_code"
          ? "high"
          : name === "write_file"
            ? "medium"
            : "low",
    });
    return {
      error: `[Plan Mode] Tool "${name}" is blocked during planning. It has been added to the plan. Use /plan approve to execute.`,
    };
  }

  // PreToolUse hook
  if (_hookDb) {
    try {
      await executeHooks(_hookDb, HookEvents.PreToolUse, {
        tool: name,
        args,
        timestamp: new Date().toISOString(),
      });
    } catch (_err) {
      // Hook failure should not block tool execution
    }
  }

  let toolResult;
  try {
    toolResult = await _executeToolInner(name, args);
  } catch (err) {
    // ToolError hook
    if (_hookDb) {
      try {
        await executeHooks(_hookDb, HookEvents.ToolError, {
          tool: name,
          args,
          error: err.message,
        });
      } catch (_err) {
        // Non-critical
      }
    }
    throw err;
  }

  // PostToolUse hook
  if (_hookDb) {
    try {
      await executeHooks(_hookDb, HookEvents.PostToolUse, {
        tool: name,
        args,
        result:
          typeof toolResult === "object"
            ? JSON.stringify(toolResult).substring(0, 500)
            : String(toolResult).substring(0, 500),
      });
    } catch (_err) {
      // Non-critical
    }
  }

  return toolResult;
}

/**
 * Inner tool execution logic (separated for hook wrapping)
 */
async function _executeToolInner(name, args) {
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
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        return { stdout: output.substring(0, 30000) };
      } catch (err) {
        return {
          error: err.message.substring(0, 2000),
          stderr: (err.stderr || "").substring(0, 2000),
          exitCode: err.status,
        };
      }
    }

    case "run_code": {
      const lang = args.language;
      const code = args.code;
      const timeoutSec = Math.min(Math.max(args.timeout || 60, 1), 300);

      const extMap = { python: ".py", node: ".js", bash: ".sh" };
      const ext = extMap[lang];
      if (!ext) {
        return {
          error: `Unsupported language: ${lang}. Use python, node, or bash.`,
        };
      }

      const tmpFile = path.join(os.tmpdir(), `cc-agent-${Date.now()}${ext}`);

      try {
        fs.writeFileSync(tmpFile, code, "utf8");

        let interpreter;
        if (lang === "python") {
          try {
            execSync("python3 --version", { encoding: "utf8", timeout: 5000 });
            interpreter = "python3";
          } catch {
            interpreter = "python";
          }
        } else if (lang === "node") {
          interpreter = "node";
        } else {
          interpreter = "bash";
        }

        const start = Date.now();
        const output = execSync(`${interpreter} "${tmpFile}"`, {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: timeoutSec * 1000,
          maxBuffer: 5 * 1024 * 1024,
        });
        const duration = Date.now() - start;

        return {
          success: true,
          output: output.substring(0, 50000),
          language: lang,
          duration: `${duration}ms`,
        };
      } catch (err) {
        return {
          error: (err.stderr || err.message || "").substring(0, 5000),
          stderr: (err.stderr || "").substring(0, 5000),
          exitCode: err.status,
          language: lang,
        };
      } finally {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // Cleanup best-effort
        }
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
      const allSkills = skillLoader.getResolvedSkills();
      if (allSkills.length === 0) {
        return {
          error:
            "No skills found. Make sure you're in the ChainlessChain project root or have skills installed.",
        };
      }
      const match = allSkills.find(
        (s) => s.id === args.skill_name || s.dirName === args.skill_name,
      );
      if (!match || !match.hasHandler) {
        return {
          error: `Skill "${args.skill_name}" not found or has no handler. Use list_skills to see available skills.`,
        };
      }
      try {
        const handlerPath = path.join(match.skillDir, "handler.js");
        const imported = await import(
          `file://${handlerPath.replace(/\\/g, "/")}`
        );
        const handler = imported.default || imported;
        if (handler.init) await handler.init(match);
        const task = {
          params: { input: args.input },
          input: args.input,
          action: args.input,
        };
        const context = {
          projectRoot: process.cwd(),
          workspacePath: process.cwd(),
        };
        const result = await handler.execute(task, context, match);
        return result;
      } catch (err) {
        return { error: `Skill execution failed: ${err.message}` };
      }
    }

    case "list_skills": {
      let skills = skillLoader.getResolvedSkills();
      if (skills.length === 0) {
        return { error: "No skills found." };
      }
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
          source: s.source,
          hasHandler: s.hasHandler,
          description: (s.description || "").substring(0, 80),
        })),
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * Send a chat completion request with tools.
 * Supports all 7 providers via cowork-adapter: ollama, anthropic, openai, deepseek, dashscope, gemini, mistral
 */
async function chatWithTools(rawMessages, options) {
  const { provider, model, baseUrl, apiKey, contextEngine: ce } = options;

  // Build optimized messages via context engine (or use raw)
  // Find last user message for relevance matching (not tool/assistant)
  const lastUserMsg = [...rawMessages].reverse().find((m) => m.role === "user");
  const messages = ce
    ? ce.buildOptimizedMessages(rawMessages, {
        userQuery: lastUserMsg?.content,
      })
    : rawMessages;

  if (provider === "ollama") {
    // Ollama supports tool calling natively
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
  }

  if (provider === "anthropic") {
    // Anthropic: extract system messages, use tools format
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY required");

    const systemMsgs = messages.filter((m) => m.role === "system");
    const otherMsgs = messages.filter((m) => m.role !== "system");

    // Convert TOOLS to Anthropic format
    const anthropicTools = TOOLS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body = {
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: otherMsgs,
      tools: anthropicTools,
    };
    if (systemMsgs.length > 0) {
      body.system = systemMsgs.map((m) => m.content).join("\n");
    }

    const url =
      baseUrl && baseUrl !== "http://localhost:11434"
        ? baseUrl
        : "https://api.anthropic.com/v1";

    const response = await fetch(`${url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const data = await response.json();
    // Normalize Anthropic response to Ollama-like format
    return _normalizeAnthropicResponse(data);
  }

  // OpenAI-compatible providers (openai, deepseek, dashscope, mistral, gemini)
  const providerUrls = {
    openai: "https://api.openai.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    mistral: "https://api.mistral.ai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  };

  const providerApiKeyEnvs = {
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    dashscope: "DASHSCOPE_API_KEY",
    mistral: "MISTRAL_API_KEY",
    gemini: "GEMINI_API_KEY",
    volcengine: "VOLCENGINE_API_KEY",
  };

  const url =
    baseUrl && baseUrl !== "http://localhost:11434"
      ? baseUrl
      : providerUrls[provider];

  if (!url) {
    throw new Error(
      `Unsupported provider: ${provider}. Supported: ollama, anthropic, openai, deepseek, dashscope, mistral, gemini, volcengine`,
    );
  }

  const envKey = providerApiKeyEnvs[provider] || "OPENAI_API_KEY";
  const key = apiKey || process.env[envKey];
  if (!key) throw new Error(`${envKey} required for provider ${provider}`);

  const defaultModels = {
    openai: "gpt-4o",
    deepseek: "deepseek-chat",
    dashscope: "qwen-turbo",
    mistral: "mistral-large-latest",
    gemini: "gemini-2.0-flash",
    volcengine: "doubao-seed-1-6-251015",
  };

  const response = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || defaultModels[provider] || "gpt-4o-mini",
      messages,
      tools: TOOLS,
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider} API error: ${response.status}`);
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

/**
 * Normalize Anthropic API response to Ollama-like format for uniform handling
 */
function _normalizeAnthropicResponse(data) {
  const content = data.content || [];
  const textBlocks = content.filter((b) => b.type === "text");
  const toolBlocks = content.filter((b) => b.type === "tool_use");

  const message = {
    role: "assistant",
    content: textBlocks.map((b) => b.text).join("\n") || "",
  };

  if (toolBlocks.length > 0) {
    message.tool_calls = toolBlocks.map((b) => ({
      id: b.id,
      type: "function",
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input),
      },
    }));
  }

  return { message };
}

/**
 * Agentic loop - keeps calling tools until the AI gives a final text response
 */
async function agentLoop(messages, options) {
  const MAX_ITERATIONS = 15;

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
    case "run_code":
      return `${args.language} (${(args.code || "").length} chars)`;
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}

function getBaseSystemPrompt() {
  return `You are ChainlessChain AI Assistant, a powerful agentic coding assistant running in the terminal.

You have access to tools that let you read files, write files, edit files, run shell commands, and search the codebase. When the user asks you to do something, USE THE TOOLS to actually do it — don't just describe what should be done.

Key behaviors:
- When asked to modify code, read the file first, then edit it
- When asked to create something, use write_file to create it
- When asked to run/test something, use run_shell to execute it
- When asked about files or code, use read_file and search_files to find information
- You have multi-layer skills (built-in, marketplace, global, project-level) — use list_skills to discover them and run_skill to execute them
- Always explain what you're doing and show results
- Be concise but thorough

When the user's problem involves data processing, calculations, file operations, text parsing, API calls, web scraping, or any task that can be solved programmatically:
- Proactively write and execute code using run_code tool
- Choose the best language: Python for data/math/scraping, Node.js for JSON/API, Bash for system tasks
- Show the results and explain them clearly
- If the first attempt fails, debug and retry with a different approach

You are not just a chatbot — you are a capable coding agent. Think step by step, write code when needed, and deliver real results.

Current working directory: ${process.cwd()}`;
}

/**
 * Start the agentic REPL
 */
export async function startAgentRepl(options = {}) {
  let model = options.model || "qwen2.5:7b";
  let provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;

  // Bootstrap runtime (best-effort, DB not required)
  let db = null;
  let contextEngine = null;
  let sessionId = null;

  try {
    const ctx = await bootstrap({ verbose: false });
    db = ctx.db || null;
  } catch (_err) {
    // Continue without DB — static prompt fallback
  }

  // Initialize permanent memory
  let permanentMemory = null;
  try {
    const dataDir = process.env.CHAINLESSCHAIN_DATA_DIR || process.cwd();
    const memoryDir = path.join(dataDir, "memory");
    permanentMemory = new CLIPermanentMemory({ db, memoryDir });
    permanentMemory.initialize();
  } catch (_err) {
    // Non-critical
  }

  contextEngine = new CLIContextEngineering({ db, permanentMemory });

  // Initialize autonomous agent
  const autonomousAgent = new CLIAutonomousAgent();

  // Set hook DB reference for tool pipeline
  _hookDb = db;

  // Resume existing session or create new one
  if (db && options.sessionId) {
    try {
      const existing = getSession(db, options.sessionId);
      if (existing && existing.messages) {
        sessionId = existing.id;
      }
    } catch (_err) {
      // Non-critical — will create new session
    }
  }

  if (db && !sessionId) {
    try {
      const session = createSession(db, {
        title: `Agent ${new Date().toISOString().slice(0, 10)}`,
        provider,
        model,
      });
      sessionId = session.id;
    } catch (_err) {
      // Non-critical
    }
  }

  const messages = [{ role: "system", content: getBaseSystemPrompt() }];

  // Load resumed session messages
  if (db && options.sessionId && sessionId) {
    try {
      const existing = getSession(db, sessionId);
      if (existing && existing.messages) {
        const parsed =
          typeof existing.messages === "string"
            ? JSON.parse(existing.messages)
            : existing.messages;
        messages.push(...parsed.filter((m) => m.role !== "system"));
        logger.info(`Resumed session ${sessionId} (${parsed.length} messages)`);
      }
    } catch (_err) {
      // Non-critical
    }
  }

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
  if (sessionId) {
    logger.log(chalk.gray(`Session: ${sessionId}`));
  }
  if (db) {
    logger.log(chalk.gray("Context: instinct + memory + notes (DB connected)"));
  }
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
      logger.log(
        `  ${chalk.cyan("/compact")}    Smart compact (importance-based)`,
      );
      logger.log(
        `  ${chalk.cyan("/task")}       Set task objective (/task <objective>)`,
      );
      logger.log(`  ${chalk.cyan("/task clear")} Clear current task`);
      logger.log(`  ${chalk.cyan("/session")}    Show current session info`);
      logger.log(
        `  ${chalk.cyan("/reindex")}    Reindex notes for BM25 search`,
      );
      logger.log(
        `  ${chalk.cyan("/stats")}      Show context engine statistics`,
      );
      logger.log(
        `  ${chalk.cyan("/auto")}       Autonomous goal execution (ReAct loop)`,
      );
      logger.log(
        `  ${chalk.cyan("/cowork")}     Multi-agent collaboration (debate, compare)`,
      );
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
      logger.log("  Plan mode: analyze first, execute after approval");
      logger.log(
        "  Context engineering: instinct + memory + notes injection\n",
      );
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
        const supported = [
          "ollama",
          "anthropic",
          "openai",
          "deepseek",
          "dashscope",
          "mistral",
          "gemini",
          "volcengine",
        ];
        if (supported.includes(arg)) {
          provider = arg;
          logger.info(`Provider: ${chalk.cyan(provider)}`);
        } else {
          logger.info(
            `Unsupported provider. Available: ${supported.join(", ")}`,
          );
        }
      } else {
        logger.info(`Current provider: ${chalk.cyan(provider)}`);
        logger.info(
          chalk.gray(
            "Available: ollama, anthropic, openai, deepseek, dashscope, mistral, gemini, volcengine",
          ),
        );
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
      if (contextEngine && messages.length > 5) {
        const compacted = contextEngine.smartCompact(messages);
        messages.length = 0;
        messages.push(...compacted);
        logger.info(
          `Compacted to ${messages.length} messages (importance-based)`,
        );
      } else if (messages.length > 5) {
        // Fallback: original logic
        const systemMsg = messages[0];
        const recent = messages.slice(-4);
        messages.length = 0;
        messages.push(systemMsg, ...recent);
        logger.info("Compacted to last 4 messages");
      }
      prompt();
      return;
    }

    // Task commands
    if (trimmed.startsWith("/task")) {
      const taskArg = trimmed.slice(5).trim();
      if (taskArg === "clear") {
        contextEngine.clearTask();
        logger.info("Task cleared");
      } else if (taskArg) {
        contextEngine.setTask(taskArg);
        logger.info(`Task set: ${chalk.cyan(taskArg)}`);
      } else {
        if (contextEngine.taskContext) {
          logger.info(
            `Current task: ${chalk.cyan(contextEngine.taskContext.objective)}`,
          );
        } else {
          logger.info("No task set. Usage: /task <objective>");
        }
      }
      prompt();
      return;
    }

    // Session info
    if (trimmed.startsWith("/session")) {
      const sessionArg = trimmed.slice(8).trim();
      if (sessionArg.startsWith("resume ")) {
        const resumeId = sessionArg.slice(7).trim();
        if (!db) {
          logger.info("No database available for session resume");
        } else {
          try {
            const existing = getSession(db, resumeId);
            if (existing && existing.messages) {
              const parsed =
                typeof existing.messages === "string"
                  ? JSON.parse(existing.messages)
                  : existing.messages;
              messages.length = 1; // keep system prompt
              messages.push(...parsed.filter((m) => m.role !== "system"));
              sessionId = existing.id;
              logger.info(
                `Resumed session ${sessionId} (${parsed.length} messages)`,
              );
            } else {
              logger.info(`Session not found: ${resumeId}`);
            }
          } catch (err) {
            logger.error(`Resume failed: ${err.message}`);
          }
        }
      } else {
        logger.info(`Session ID: ${sessionId || "none"}`);
        logger.info(`Messages: ${messages.length}`);
        logger.info(`DB: ${db ? "connected" : "not available"}`);
      }
      prompt();
      return;
    }

    // Reindex notes
    if (trimmed === "/reindex") {
      if (contextEngine) {
        contextEngine.reindexNotes();
        const stats = contextEngine.getStats();
        logger.info(`Notes reindexed: ${stats.notesIndexed} documents`);
      } else {
        logger.info("Context engine not available");
      }
      prompt();
      return;
    }

    // Stats
    if (trimmed === "/stats") {
      if (contextEngine) {
        const stats = contextEngine.getStats();
        logger.info(`DB connected: ${stats.hasDb}`);
        logger.info(`Notes indexed: ${stats.notesIndexed}`);
        logger.info(`Error history: ${stats.errorCount}`);
        logger.info(`Active task: ${stats.hasTask}`);
      } else {
        logger.info("Context engine not available");
      }
      prompt();
      return;
    }

    // Cowork commands
    if (trimmed.startsWith("/cowork")) {
      const coworkArgs = trimmed.slice(7).trim();
      const [subCmd, ...rest] = coworkArgs.split(/\s+/);
      const coworkInput = rest.join(" ");

      if (!subCmd || subCmd === "help") {
        logger.log(chalk.bold("\nCowork Commands:"));
        logger.log(
          `  ${chalk.cyan("/cowork debate <file>")}      Multi-perspective code review`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork compare <prompt>")}   A/B solution comparison`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork graph <path>")}       Code knowledge graph (ASCII)`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork decision <topic>")}   Architecture decision tracking`,
        );
        logger.log("");
      } else if (subCmd === "debate" && coworkInput) {
        try {
          const { startDebate } =
            await import("../lib/cowork/debate-review-cli.js");
          let code = coworkInput;
          let targetLabel = coworkInput;
          const resolved = path.resolve(coworkInput);
          if (fs.existsSync(resolved)) {
            code = fs.readFileSync(resolved, "utf-8");
            targetLabel = resolved;
            if (code.length > 15000) {
              code = code.substring(0, 15000) + "\n... (truncated)";
            }
          }
          process.stdout.write(chalk.gray("\n  Running debate review...\n"));
          const result = await startDebate({
            target: targetLabel,
            code,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          for (const review of result.reviews) {
            const vc =
              review.verdict === "APPROVE"
                ? chalk.green
                : review.verdict === "REJECT"
                  ? chalk.red
                  : chalk.yellow;
            process.stdout.write(
              `  ${chalk.bold(review.role)}: ${vc(review.verdict)}\n`,
            );
          }
          process.stdout.write(
            `\n  ${chalk.bold("Verdict:")} ${result.verdict}  Consensus: ${result.consensusScore}%\n\n`,
          );
          // Add summary to conversation for context
          messages.push({
            role: "assistant",
            content: `[Cowork Debate Result] ${result.verdict} (consensus: ${result.consensusScore}%)\n${result.summary.substring(0, 500)}`,
          });
        } catch (err) {
          logger.error(`Debate failed: ${err.message}`);
        }
      } else if (subCmd === "compare" && coworkInput) {
        try {
          const { compare } =
            await import("../lib/cowork/ab-comparator-cli.js");
          process.stdout.write(chalk.gray("\n  Generating variants...\n"));
          const result = await compare({
            prompt: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          for (const v of result.variants) {
            process.stdout.write(
              `  ${chalk.cyan(v.name)}: score ${v.totalScore}\n`,
            );
          }
          process.stdout.write(
            `\n  ${chalk.bold("Winner:")} ${chalk.green(result.winner)}\n\n`,
          );
          messages.push({
            role: "assistant",
            content: `[Cowork Compare Result] Winner: ${result.winner}. ${result.reason}`,
          });
        } catch (err) {
          logger.error(`Compare failed: ${err.message}`);
        }
      } else if (subCmd === "graph" && coworkInput) {
        try {
          const { analyzeCodeKnowledgeGraph } =
            await import("../lib/cowork/code-knowledge-graph-cli.js");
          process.stdout.write(chalk.gray("\n  Analyzing code graph...\n"));
          const result = await analyzeCodeKnowledgeGraph({
            target: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          // ASCII dependency graph
          if (result.entities && result.entities.length > 0) {
            process.stdout.write(chalk.bold("  Code Knowledge Graph:\n"));
            for (const entity of result.entities.slice(0, 15)) {
              const deps = (entity.dependencies || []).slice(0, 3).join(", ");
              process.stdout.write(
                `  ${chalk.cyan(entity.name)} [${entity.type}]${deps ? ` → ${deps}` : ""}\n`,
              );
            }
            if (result.relationships && result.relationships.length > 0) {
              process.stdout.write(chalk.bold("\n  Relationships:\n"));
              for (const rel of result.relationships.slice(0, 10)) {
                process.stdout.write(
                  `  ${rel.source} ${chalk.gray(`—${rel.type}→`)} ${rel.target}\n`,
                );
              }
            }
          } else {
            process.stdout.write(
              `  ${JSON.stringify(result).substring(0, 500)}\n`,
            );
          }
          process.stdout.write("\n");
          messages.push({
            role: "assistant",
            content: `[Cowork Graph] Analyzed ${(result.entities || []).length} entities with ${(result.relationships || []).length} relationships.`,
          });
        } catch (err) {
          logger.error(`Graph analysis failed: ${err.message}`);
        }
      } else if (subCmd === "decision" && coworkInput) {
        try {
          const { analyzeDecisions } =
            await import("../lib/cowork/decision-kb-cli.js");
          process.stdout.write(chalk.gray("\n  Analyzing decisions...\n"));
          const result = await analyzeDecisions({
            target: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          if (result.decisions && result.decisions.length > 0) {
            process.stdout.write(chalk.bold("  Architecture Decisions:\n"));
            for (const d of result.decisions) {
              const statusColor =
                d.status === "accepted"
                  ? chalk.green
                  : d.status === "rejected"
                    ? chalk.red
                    : chalk.yellow;
              process.stdout.write(
                `  ${statusColor(`[${d.status || "proposed"}]`)} ${chalk.cyan(d.title || d.id)}\n`,
              );
              if (d.rationale) {
                process.stdout.write(
                  `    ${chalk.gray(d.rationale.substring(0, 100))}\n`,
                );
              }
            }
          } else {
            process.stdout.write(
              `  ${JSON.stringify(result).substring(0, 500)}\n`,
            );
          }
          process.stdout.write("\n");
          messages.push({
            role: "assistant",
            content: `[Cowork Decision] Found ${(result.decisions || []).length} architecture decisions.`,
          });
        } catch (err) {
          logger.error(`Decision analysis failed: ${err.message}`);
        }
      } else {
        logger.info(
          "Usage: /cowork debate <file> | compare <prompt> | graph <path> | decision <topic>",
        );
      }

      prompt();
      return;
    }

    // Autonomous agent commands
    if (trimmed.startsWith("/auto")) {
      const autoArg = trimmed.slice(5).trim();

      if (!autoArg || autoArg === "help") {
        logger.log(chalk.bold("\nAutonomous Agent Commands:"));
        logger.log(
          `  ${chalk.cyan("/auto <goal>")}      Submit a goal for autonomous execution`,
        );
        logger.log(
          `  ${chalk.cyan("/auto status")}      Show current goal status`,
        );
        logger.log(
          `  ${chalk.cyan("/auto pause")}       Pause the running goal`,
        );
        logger.log(`  ${chalk.cyan("/auto resume")}      Resume a paused goal`);
        logger.log(
          `  ${chalk.cyan("/auto cancel")}      Cancel the running goal`,
        );
        logger.log(`  ${chalk.cyan("/auto list")}        List all goals`);
        logger.log("");
      } else if (autoArg === "status") {
        const goals = autonomousAgent.listGoals();
        const running = goals.find(
          (g) =>
            g.status === GoalStatus.RUNNING || g.status === GoalStatus.PAUSED,
        );
        if (running) {
          const detail = autonomousAgent.getGoalStatus(running.id);
          logger.info(`Goal: ${chalk.cyan(detail.description)}`);
          logger.info(
            `Status: ${detail.status}  Steps: ${detail.steps.length}  Iterations: ${detail.iterations}`,
          );
          for (const step of detail.steps) {
            const icon =
              step.status === "completed"
                ? "✓"
                : step.status === "running"
                  ? "→"
                  : step.status === "failed"
                    ? "✗"
                    : "○";
            logger.log(
              `  ${icon} ${step.description} ${step.error ? chalk.red(`(${step.error})`) : ""}`,
            );
          }
        } else {
          logger.info("No active goal. Use /auto <goal> to submit one.");
        }
      } else if (autoArg === "pause") {
        const goals = autonomousAgent.listGoals();
        const running = goals.find((g) => g.status === GoalStatus.RUNNING);
        if (running) {
          autonomousAgent.pauseGoal(running.id);
          logger.info(`Paused goal: ${running.description}`);
        } else {
          logger.info("No running goal to pause.");
        }
      } else if (autoArg === "resume") {
        const goals = autonomousAgent.listGoals();
        const paused = goals.find((g) => g.status === GoalStatus.PAUSED);
        if (paused) {
          autonomousAgent.resumeGoal(paused.id);
          logger.info(`Resumed goal: ${paused.description}`);
        } else {
          logger.info("No paused goal to resume.");
        }
      } else if (autoArg === "cancel") {
        const goals = autonomousAgent.listGoals();
        const active = goals.find(
          (g) =>
            g.status === GoalStatus.RUNNING || g.status === GoalStatus.PAUSED,
        );
        if (active) {
          autonomousAgent.cancelGoal(active.id);
          logger.info(`Cancelled goal: ${active.description}`);
        } else {
          logger.info("No active goal to cancel.");
        }
      } else if (autoArg === "list") {
        const goals = autonomousAgent.listGoals();
        if (goals.length === 0) {
          logger.info("No goals submitted yet.");
        } else {
          for (const g of goals) {
            logger.log(
              `  [${g.status}] ${g.description} (${g.steps} steps, ${g.iterations} iterations)`,
            );
          }
        }
      } else {
        // Submit new goal
        // Lazy-init autonomous agent with LLM chat function
        if (!autonomousAgent._initialized) {
          const chatFn = createChatFn({ provider, model, baseUrl, apiKey });
          autonomousAgent.initialize({
            llmChat: chatFn,
            toolExecutor: executeTool,
          });
        }

        // Set up event listeners for live output
        const goalListener = (evt) => {
          if (evt.goalId) {
            if (evt.result)
              process.stdout.write(
                chalk.green(`  Goal completed: ${evt.result}\n`),
              );
            if (evt.error)
              process.stdout.write(chalk.red(`  Goal failed: ${evt.error}\n`));
          }
        };
        const stepListener = (evt) => {
          process.stdout.write(chalk.gray(`  [step] ${evt.step}\n`));
        };

        autonomousAgent.on("goal:completed", goalListener);
        autonomousAgent.on("goal:failed", goalListener);
        autonomousAgent.on("step:started", stepListener);
        autonomousAgent.on("step:completed", (evt) => {
          process.stdout.write(chalk.green(`  [done] ${evt.step}\n`));
        });

        logger.info(`Submitting goal: ${chalk.cyan(autoArg)}`);
        try {
          const { goalId } = await autonomousAgent.submitGoal(autoArg);
          logger.info(
            `Goal ${goalId} submitted. Use /auto status to track progress.`,
          );
        } catch (err) {
          logger.error(`Failed to submit goal: ${err.message}`);
        }
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
      } else if (subCmd === "risk") {
        if (!planManager.isActive() || !planManager.currentPlan) {
          logger.info("No active plan to assess.");
        } else {
          const risk = planManager.getRiskAssessment();
          logger.log(
            `\nRisk Level: ${chalk.bold(risk.level.toUpperCase())} (total: ${risk.totalScore}, max: ${risk.maxScore}, avg: ${risk.averageScore})`,
          );
          for (const item of risk.itemScores) {
            const color =
              item.score >= 6
                ? chalk.red
                : item.score >= 3
                  ? chalk.yellow
                  : chalk.green;
            logger.log(`  ${color(`[${item.score}]`)} ${item.title}`);
          }
          logger.log("");
        }
      } else if (subCmd === "execute") {
        if (!planManager.isActive()) {
          logger.info("No active plan.");
        } else if (planManager.state !== PlanState.APPROVED) {
          logger.info("Plan must be approved first. Use /plan approve.");
        } else {
          logger.info("Executing plan items in DAG order...");
          try {
            const { results, success } = await planManager.executePlan(
              async (item) => {
                if (item.tool && item.params) {
                  process.stdout.write(
                    chalk.gray(`  [${item.tool}] ${item.title}\n`),
                  );
                  return await executeTool(item.tool, item.params);
                }
                return { skipped: true };
              },
            );
            for (const r of results) {
              const icon = r.success ? chalk.green("✓") : chalk.red("✗");
              logger.log(
                `  ${icon} ${r.item.title}${r.error ? ` — ${r.error}` : ""}`,
              );
            }
            logger.info(
              `Plan execution ${success ? "completed" : "finished with errors"}.`,
            );
            planManager.exitPlanMode({ savePlan: true });
          } catch (err) {
            logger.error(`Plan execution failed: ${err.message}`);
          }
        }
      } else if (subCmd === "exit") {
        if (planManager.isActive()) {
          planManager.exitPlanMode({ savePlan: true });
          logger.info("Exited plan mode.");
        } else {
          logger.info("Not in plan mode.");
        }
      } else if (subCmd.startsWith("interactive")) {
        // Interactive planning with LLM-generated plan + skill recommendations
        const planRequest =
          subCmd.slice(11).trim() || "Help me with the current task";
        try {
          const { CLIInteractivePlanner } =
            await import("../lib/interactive-planner.js");
          const { TerminalInteractionAdapter } =
            await import("../lib/interaction-adapter.js");
          const chatFn = createChatFn({ provider, model, baseUrl, apiKey });
          const planner = new CLIInteractivePlanner({
            llmChat: chatFn,
            db,
            interaction: new TerminalInteractionAdapter(),
          });

          logger.info("Generating interactive plan...");
          const result = await planner.startPlanSession(planRequest, {
            cwd: process.cwd(),
          });

          if (result.plan) {
            logger.log(
              chalk.bold(
                `\n  Plan: ${result.plan.overview?.title || "Untitled"}`,
              ),
            );
            logger.log(
              chalk.gray(`  ${result.plan.overview?.description || ""}\n`),
            );
            for (const step of result.plan.steps || []) {
              const toolStr = step.tool ? chalk.cyan(` [${step.tool}]`) : "";
              logger.log(`  ${step.step}. ${step.title}${toolStr}`);
            }
            if (result.plan.recommendations?.skills?.length > 0) {
              logger.log(chalk.bold("\n  Recommended skills:"));
              for (const s of result.plan.recommendations.skills) {
                logger.log(`    - ${chalk.cyan(s.id)}: ${s.description}`);
              }
            }
            logger.log("");
            logger.info(
              "Use /plan interactive:confirm, /plan interactive:cancel, or /plan interactive:regenerate",
            );
          } else {
            logger.info(result.message || "Failed to generate plan");
          }
        } catch (err) {
          logger.error(`Interactive plan failed: ${err.message}`);
        }
      } else {
        logger.info(
          "Unknown /plan subcommand. Try: /plan, /plan show, /plan approve, /plan reject, /plan exit, /plan interactive <request>",
        );
      }

      prompt();
      return;
    }

    // Add user message
    messages.push({ role: "user", content: trimmed });

    // Auto-select best model based on task type
    let activeModel = model;
    const taskDetection = detectTaskType(trimmed);
    if (taskDetection.confidence > 0.3) {
      const recommended = selectModelForTask(provider, taskDetection.taskType);
      if (recommended && recommended !== activeModel) {
        activeModel = recommended;
        logger.info(
          chalk.gray(`[auto] ${taskDetection.name} → ${activeModel}`),
        );
      }
    }

    try {
      process.stdout.write("\n");
      const response = await agentLoop(messages, {
        provider,
        model: activeModel,
        baseUrl,
        apiKey,
        contextEngine,
      });

      if (response) {
        process.stdout.write(`\n${response}\n\n`);
        messages.push({ role: "assistant", content: response });
      } else {
        process.stdout.write("\n");
      }

      // Auto-save session
      if (db && sessionId) {
        try {
          saveMessages(db, sessionId, messages);
        } catch (_e) {
          // Non-critical
        }
      }
      // Store as episodic memory
      if (db) {
        try {
          storeMemory(db, trimmed, { importance: 0.3, type: "episodic" });
        } catch (_e) {
          // Non-critical
        }
      }
    } catch (err) {
      logger.error(`Error: ${err.message}`);

      // Record error for context injection
      if (contextEngine) {
        contextEngine.recordError({
          step: "agent-loop",
          message: err.message,
        });
      }

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

  rl.on("close", async () => {
    // Save session on exit
    if (db && sessionId) {
      try {
        saveMessages(db, sessionId, messages);
      } catch (_e) {
        // Non-critical
      }
    }
    // Auto-summarize session into permanent memory
    if (permanentMemory && messages.length > 4) {
      try {
        permanentMemory.autoSummarize(messages);
      } catch (_e) {
        // Non-critical
      }
    }
    // Consolidate memory
    if (db) {
      try {
        consolidateMemory(db);
      } catch (_e) {
        // Non-critical
      }
    }
    // Shutdown runtime
    try {
      await shutdown();
    } catch (_e) {
      // Non-critical
    }
    process.exit(0);
  });
}
