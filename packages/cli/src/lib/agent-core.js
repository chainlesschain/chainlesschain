/**
 * Agent Core — transport-independent agentic logic
 *
 * Extracted from agent-repl.js so that both the terminal REPL and the
 * WebSocket session handler can share the same tool definitions,
 * execution logic, and LLM-driven agent loop.
 *
 * Key exports:
 *  - AGENT_TOOLS          — OpenAI function-calling tool definitions
 *  - getBaseSystemPrompt  — system prompt generator
 *  - executeTool          — tool execution with plan-mode + hook pipeline
 *  - chatWithTools        — LLM call with tool definitions injected
 *  - agentLoop            — async generator yielding structured events
 *  - formatToolArgs       — human-readable tool argument formatting
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";
import { getPlanModeManager } from "./plan-mode.js";
import { CLISkillLoader } from "./skill-loader.js";
import { executeHooks, HookEvents } from "./hook-manager.js";

// ─── Tool definitions ────────────────────────────────────────────────────

export const AGENT_TOOLS = [
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

// ─── Shared skill loader ──────────────────────────────────────────────────

const _defaultSkillLoader = new CLISkillLoader();

// ─── System prompt ────────────────────────────────────────────────────────

export function getBaseSystemPrompt(cwd) {
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

Current working directory: ${cwd || process.cwd()}`;
}

// ─── Tool execution ──────────────────────────────────────────────────────

/**
 * Execute a single tool call with plan-mode filtering and hook pipeline.
 *
 * @param {string} name - tool name
 * @param {object} args - tool arguments
 * @param {object} [context] - optional context
 * @param {object} [context.hookDb] - DB for hooks
 * @param {CLISkillLoader} [context.skillLoader] - skill loader instance
 * @param {string} [context.cwd] - working directory override
 * @returns {Promise<object>} tool result
 */
export async function executeTool(name, args, context = {}) {
  const hookDb = context.hookDb || null;
  const skillLoader = context.skillLoader || _defaultSkillLoader;
  const cwd = context.cwd || process.cwd();

  // Plan mode: check if tool is allowed
  const planManager = getPlanModeManager();
  if (planManager.isActive() && !planManager.isToolAllowed(name)) {
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
  if (hookDb) {
    try {
      await executeHooks(hookDb, HookEvents.PreToolUse, {
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
    toolResult = await executeToolInner(name, args, { skillLoader, cwd });
  } catch (err) {
    if (hookDb) {
      try {
        await executeHooks(hookDb, HookEvents.ToolError, {
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
  if (hookDb) {
    try {
      await executeHooks(hookDb, HookEvents.PostToolUse, {
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
 * Inner tool execution — no hooks, no plan-mode checks.
 */
async function executeToolInner(name, args, { skillLoader, cwd }) {
  switch (name) {
    case "read_file": {
      const filePath = path.resolve(cwd, args.path);
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(filePath, "utf8");
      if (content.length > 50000) {
        return {
          content: content.substring(0, 50000) + "\n...(truncated)",
          size: content.length,
        };
      }
      return { content };
    }

    case "write_file": {
      const filePath = path.resolve(cwd, args.path);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, args.content, "utf8");
      return { success: true, path: filePath, size: args.content.length };
    }

    case "edit_file": {
      const filePath = path.resolve(cwd, args.path);
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
          cwd: args.cwd || cwd,
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
          cwd,
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
      const dir = args.directory ? path.resolve(cwd, args.directory) : cwd;
      try {
        if (args.content_search) {
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
      const dirPath = args.path ? path.resolve(cwd, args.path) : cwd;
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
        const taskContext = {
          projectRoot: cwd,
          workspacePath: cwd,
        };
        const result = await handler.execute(task, taskContext, match);
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

// ─── LLM chat with tools ─────────────────────────────────────────────────

/**
 * Send a chat completion request with tool definitions.
 * Supports 8 providers: ollama, anthropic, openai, deepseek, dashscope, gemini, mistral, volcengine
 *
 * @param {Array} rawMessages
 * @param {object} options
 * @returns {Promise<object>} response with .message
 */
export async function chatWithTools(rawMessages, options) {
  const { provider, model, baseUrl, apiKey, contextEngine: ce } = options;

  const lastUserMsg = [...rawMessages].reverse().find((m) => m.role === "user");
  const messages = ce
    ? ce.buildOptimizedMessages(rawMessages, {
        userQuery: lastUserMsg?.content,
      })
    : rawMessages;

  if (provider === "ollama") {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: AGENT_TOOLS,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }
    return await response.json();
  }

  if (provider === "anthropic") {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY required");

    const systemMsgs = messages.filter((m) => m.role === "system");
    const otherMsgs = messages.filter((m) => m.role !== "system");

    const anthropicTools = AGENT_TOOLS.map((t) => ({
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
    return _normalizeAnthropicResponse(data);
  }

  // OpenAI-compatible providers
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
      tools: AGENT_TOOLS,
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider} API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error("Invalid API response: no choices returned");
  }
  const choice = data.choices[0];
  return { message: choice.message };
}

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

// ─── Agent loop (async generator) ─────────────────────────────────────────

/**
 * Async generator that drives the agentic tool-use loop.
 *
 * Yields events:
 *   { type: "tool-executing", tool, args }
 *   { type: "tool-result", tool, result, error }
 *   { type: "response-complete", content }
 *
 * @param {Array} messages - mutable messages array (will be appended to)
 * @param {object} options - provider, model, baseUrl, apiKey, contextEngine, hookDb, skillLoader, cwd
 */
export async function* agentLoop(messages, options) {
  const MAX_ITERATIONS = 15;
  const toolContext = {
    hookDb: options.hookDb || null,
    skillLoader: options.skillLoader || _defaultSkillLoader,
    cwd: options.cwd || process.cwd(),
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const result = await chatWithTools(messages, options);
    const msg = result?.message;

    if (!msg) {
      yield { type: "response-complete", content: "(No response from LLM)" };
      return;
    }

    const toolCalls = msg.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      yield { type: "response-complete", content: msg.content || "" };
      return;
    }

    // Add assistant message with tool calls
    messages.push(msg);

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

      yield { type: "tool-executing", tool: toolName, args: toolArgs };

      let toolResult;
      let toolError = null;
      try {
        toolResult = await executeTool(toolName, toolArgs, toolContext);
      } catch (err) {
        toolResult = { error: err.message };
        toolError = err.message;
      }

      yield {
        type: "tool-result",
        tool: toolName,
        result: toolResult,
        error: toolError,
      };

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult).substring(0, 5000),
        tool_call_id: call.id,
      });
    }
  }

  yield {
    type: "response-complete",
    content: "(Reached max tool call iterations)",
  };
}

// ─── Format helpers ───────────────────────────────────────────────────────

export function formatToolArgs(name, args) {
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
