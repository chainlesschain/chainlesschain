"use strict";

const sharedCodingAgentPolicy = require("./coding-agent-policy.cjs");

const { TOOL_POLICY_METADATA } = sharedCodingAgentPolicy;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFunctionToolContract(tool) {
  return Object.freeze({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: cloneValue(
        tool.inputSchema || { type: "object", properties: {} },
      ),
    },
  });
}

const CODING_AGENT_TOOL_CONTRACTS = Object.freeze([
  {
    name: "read_file",
    title: "Read File",
    kind: "filesystem",
    tier: "mvp",
    description:
      "Read a file's content. For a large file, page through it with offset+limit (line range) instead of re-reading the head. Jupyter notebooks (.ipynb) are rendered as a compact cell listing (index/id/type/source, outputs hidden) for use with notebook_edit — pass raw:true for the underlying JSON.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
        offset: {
          type: "integer",
          description:
            "1-based line number to start reading from (omit to read from the top). Use with limit to page a large file.",
        },
        limit: {
          type: "integer",
          description:
            "Maximum number of lines to return starting at offset (omit to read to end, subject to the size cap).",
        },
        hashed: {
          type: "boolean",
          description:
            "Prefix each line with a 6-char content hash for edit_file_hashed anchoring",
        },
        raw: {
          type: "boolean",
          description:
            "For .ipynb: return the raw notebook JSON instead of the rendered cell listing",
        },
      },
      required: ["path"],
    },
    ...TOOL_POLICY_METADATA.read_file,
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:read_file", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "write_file",
    title: "Write File",
    kind: "filesystem",
    tier: "mvp",
    description: "Write content to a file (create or overwrite)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
    ...TOOL_POLICY_METADATA.write_file,
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:write_file", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "notebook_edit",
    title: "Edit Notebook",
    kind: "filesystem",
    tier: "mvp",
    description:
      "Edit a Jupyter notebook (.ipynb) cell. edit_mode 'replace' (default) overwrites a cell's source; 'insert' adds a new cell (after the target cell, or at the top when no target given); 'delete' removes a cell. Identify the target with cell_id (preferred) or 0-based cell_index. cell_type ('code'|'markdown') is required for 'insert'. Source is plain text with newlines preserved; replacing a code cell clears its previous outputs + execution_count.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the .ipynb notebook" },
        new_source: {
          type: "string",
          description: "New cell source text (required for replace/insert)",
        },
        cell_id: {
          type: "string",
          description: "Target cell id (preferred over cell_index)",
        },
        cell_index: {
          type: "number",
          description: "0-based cell index (when cell_id is unknown)",
        },
        cell_type: {
          type: "string",
          enum: ["code", "markdown"],
          description: "Cell type — required for edit_mode 'insert'",
        },
        edit_mode: {
          type: "string",
          enum: ["replace", "insert", "delete"],
          description: "replace (default) | insert | delete",
        },
      },
      required: ["path"],
    },
    ...TOOL_POLICY_METADATA.notebook_edit,
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:notebook_edit", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "edit_file",
    title: "Edit File",
    kind: "filesystem",
    tier: "mvp",
    description:
      "Replace a string in a file. old_string must match EXACTLY ONE place — include enough surrounding context to make it unique, or the edit is rejected. Pass replace_all:true to change every occurrence instead.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        old_string: {
          type: "string",
          description:
            "Exact string to replace; must be unique in the file unless replace_all is true",
        },
        new_string: {
          type: "string",
          description: "Replacement string",
        },
        replace_all: {
          type: "boolean",
          description:
            "Replace every occurrence of old_string instead of requiring a unique match (default false)",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    ...TOOL_POLICY_METADATA.edit_file,
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:edit_file", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "edit_file_hashed",
    title: "Edit File (Hash-Anchored)",
    kind: "filesystem",
    tier: "mvp",
    description:
      "Replace a single line in a file, anchored by its content hash. Use this instead of edit_file for robust edits: each line of read_file output (with hashed:true) is tagged with a 6-char hash like 'a3Kp9Z| const x = ...'. Pass the hash as anchor_hash, the current line as expected_line, and the replacement as new_line. Rejects edits if the line drifted (hash mismatch) — retry by re-reading the file with hashed:true.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        anchor_hash: {
          type: "string",
          description:
            "6-char base64url hash of the line to replace (from read_file with hashed:true)",
        },
        expected_line: {
          type: "string",
          description:
            "Current content of the line — used as a second-layer check against hash collisions. Compared after .trim().",
        },
        new_line: {
          type: "string",
          description:
            "Replacement line content (without the hash tag prefix). Preserve the original indentation.",
        },
      },
      required: ["path", "anchor_hash", "expected_line", "new_line"],
    },
    ...TOOL_POLICY_METADATA.edit_file_hashed,
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:edit_file_hashed", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "run_shell",
    title: "Run Shell",
    kind: "shell",
    tier: "mvp",
    description:
      "Execute a shell command and return the output. Use for running tests, linting, builds, and other non-git workspace commands. For long-running commands (builds, full test suites, dev servers) pass run_in_background:true to return a task_id immediately and poll with check_shell instead of blocking.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: {
          type: "string",
          description: "Working directory (optional)",
        },
        run_in_background: {
          type: "boolean",
          description:
            "Run the command in the background and return a task_id immediately instead of blocking. Use for long-running commands (builds, test suites, dev servers). Poll output and completion with the check_shell tool.",
        },
        timeout: {
          type: "number",
          description:
            "Foreground (synchronous) timeout in milliseconds. Default 60000, max 600000. Ignored when run_in_background is true.",
        },
      },
      required: ["command"],
    },
    ...TOOL_POLICY_METADATA.run_shell,
    runtimeDescriptor: "shell",
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace"],
    },
    telemetry: {
      category: "shell",
      tags: ["tool:run_shell", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "check_shell",
    title: "Check Shell",
    kind: "shell",
    tier: "mvp",
    description:
      "Poll a background run_shell task: returns its status, exit code, and any new stdout/stderr since the last check. Omit task_id to list all background tasks. Pass kill:true to terminate a still-running task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description:
            "The task_id returned by run_shell { run_in_background: true }. Omit to list all known background tasks.",
        },
        kill: {
          type: "boolean",
          description:
            "Terminate the task if it is still running (e.g. a dev server you no longer need).",
        },
      },
      required: [],
    },
    ...TOOL_POLICY_METADATA.check_shell,
    runtimeDescriptor: "shell",
    permissions: {
      level: "readonly",
      scopes: ["process:read"],
    },
    telemetry: {
      category: "shell",
      tags: ["tool:check_shell", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "git",
    title: "Git",
    kind: "git",
    tier: "mvp",
    description:
      "Run a git command inside the workspace. Use this instead of run_shell for git status, diff, log, commit, branch, and related repository operations.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            'Git subcommand to execute, for example "status", "diff --stat", or "log --oneline -5"',
        },
        cwd: {
          type: "string",
          description: "Working directory (optional)",
        },
      },
      required: ["command"],
    },
    ...TOOL_POLICY_METADATA.git,
    runtimeDescriptor: "git",
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace", "vcs:git"],
    },
    telemetry: {
      category: "git",
      tags: ["tool:git", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "search_files",
    title: "Search Files",
    kind: "filesystem",
    tier: "mvp",
    description: "Search for files by name pattern or content",
    inputSchema: {
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
    ...TOOL_POLICY_METADATA.search_files,
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read", "search:content"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:search_files", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "list_dir",
    title: "List Directory",
    kind: "filesystem",
    tier: "mvp",
    description: "List contents of a directory",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path (default: cwd)",
        },
      },
    },
    ...TOOL_POLICY_METADATA.list_dir,
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:list_dir", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "run_skill",
    title: "Run Skill",
    kind: "skill",
    tier: "extension",
    description:
      "Run a built-in ChainlessChain skill. Available skills include: code-review, summarize, translate, refactor, unit-test, debug, explain-code, browser-automation, data-analysis, git-history-analyzer, and 130+ more. Use list_skills first to discover available skills.",
    inputSchema: {
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
    ...TOOL_POLICY_METADATA.run_skill,
    permissions: {
      level: "standard",
      scopes: ["skill:invoke"],
    },
    telemetry: {
      category: "skill",
      tags: ["tool:run_skill", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "list_skills",
    title: "List Skills",
    kind: "skill",
    tier: "extension",
    description:
      "List available built-in skills, optionally filtered by category or keyword",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by category (e.g. development, automation, data)",
        },
        query: {
          type: "string",
          description: "Search keyword to filter skills",
        },
      },
    },
    ...TOOL_POLICY_METADATA.list_skills,
    permissions: {
      level: "readonly",
      scopes: ["skill:read"],
    },
    telemetry: {
      category: "skill",
      tags: ["tool:list_skills", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "run_code",
    title: "Run Code",
    kind: "code",
    tier: "extension",
    description:
      "Write and execute code in Python, Node.js, or Bash. Use this when the user needs data processing, calculations, file batch operations, API calls, or any task best solved with a script. Scripts are saved for reference. Missing Python packages are auto-installed.",
    inputSchema: {
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
        persist: {
          type: "boolean",
          description:
            "If true (default), save script in .chainlesschain/agent-scripts/. If false, use temp file and clean up.",
        },
      },
      required: ["language", "code"],
    },
    ...TOOL_POLICY_METADATA.run_code,
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace", "runtime:script"],
    },
    telemetry: {
      category: "code",
      tags: ["tool:run_code", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "spawn_sub_agent",
    title: "Spawn Sub Agent",
    kind: "agent",
    tier: "extension",
    description:
      "Spawn an isolated sub-agent to handle a subtask. The sub-agent has its own context and message history, and only returns a summary result. Use this for tasks that benefit from focused, independent execution (e.g. code review, summarization, translation). Pass `agent` to delegate to a named, pre-defined subagent (its persona + tool scope come from its .md file); otherwise give an ad-hoc `role`.",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description:
            'Optional name of a pre-defined subagent from .chainlesschain/agents/ or .claude/agents/ (e.g. "review:security"). Loads that file\'s system prompt + tool allow-list. Run `cc agents list` to see them. Explicit `role`/`tools` override the agent\'s values.',
        },
        role: {
          type: "string",
          description:
            "Sub-agent role (e.g. code-review, summarizer, translator, debugger). Required unless `agent` is given.",
        },
        task: {
          type: "string",
          description: "Task description for the sub-agent",
        },
        context: {
          type: "string",
          description:
            "Optional condensed context from the parent agent to pass to the sub-agent",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional tool whitelist for the sub-agent (e.g. ["read_file", "search_files"]). If omitted, all tools are available.',
        },
        profile: {
          type: "string",
          enum: ["explorer", "executor", "design"],
          description:
            "Optional declarative profile (from sub-agent-profiles). When set, seeds systemPrompt / tool allowlist / iteration cap. Explicit `tools` overrides the profile allowlist.",
        },
      },
      required: ["task"],
    },
    ...TOOL_POLICY_METADATA.spawn_sub_agent,
    permissions: {
      level: "elevated",
      scopes: ["agent:spawn"],
    },
    telemetry: {
      category: "agent",
      tags: ["tool:spawn_sub_agent", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "web_fetch",
    title: "Web Fetch",
    kind: "network",
    tier: "extension",
    description:
      "Fetch a web page or API endpoint over HTTP(S). Returns extracted markdown text by default. Honors allowlist from .chainlesschain/config.json:webFetch.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http:// or https:// URL to fetch",
        },
        format: {
          type: "string",
          enum: ["markdown", "text", "html", "json"],
          description: "Output format (default: markdown)",
        },
        maxBytes: {
          type: "number",
          description: "Maximum response size in bytes (default: 2000000)",
        },
        timeout: {
          type: "number",
          description: "Request timeout in ms (default: 15000)",
        },
      },
      required: ["url"],
    },
    ...TOOL_POLICY_METADATA.web_fetch,
    permissions: {
      level: "readonly",
      scopes: ["network:read"],
    },
    telemetry: {
      category: "network",
      tags: ["tool:web_fetch", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "web_search",
    title: "Web Search",
    kind: "network",
    tier: "extension",
    description:
      "Search the web for a query and return ranked results (title, url, snippet) plus an optional synthesized answer. Use this to discover URLs, then web_fetch to read a page. Backend is configured via .chainlesschain/config.json:webSearch (default provider: auto — uses whichever API key is set, else keyless DuckDuckGo).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (natural-language keywords)",
        },
        provider: {
          type: "string",
          enum: ["auto", "tavily", "brave", "bocha", "qianfan", "duckduckgo", "searxng", "baidu"],
          description:
            "Override the configured search backend for this call (default: from config / auto)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default: 8)",
        },
        timeout: {
          type: "number",
          description: "Request timeout in ms (default: 15000)",
        },
      },
      required: ["query"],
    },
    ...TOOL_POLICY_METADATA.web_search,
    permissions: {
      level: "readonly",
      scopes: ["network:read"],
    },
    telemetry: {
      category: "network",
      tags: ["tool:web_search", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "todo_write",
    title: "Todo Write",
    kind: "planning",
    tier: "extension",
    description:
      "Write or update the session's TODO list. Use this to track multi-step work; exactly one item may be in_progress at a time.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Full TODO list (replaces any existing list)",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable identifier" },
              content: { type: "string", description: "TODO description" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
                description: "Item state",
              },
            },
            required: ["id", "content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    ...TOOL_POLICY_METADATA.todo_write,
    permissions: {
      level: "session",
      scopes: ["session:write"],
    },
    telemetry: {
      category: "planning",
      tags: ["tool:todo_write", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "slash_command",
    title: "Slash Command",
    kind: "planning",
    tier: "extension",
    description:
      "Run a user-defined slash command (a reusable prompt macro from " +
      ".claude/commands/*.md or .chainlesschain/commands/*.md) and get back its " +
      "expanded prompt text to act on. The 'command' string is the slash " +
      "command exactly as a user would type it, e.g. '/review' or " +
      "'/git:commit fix the typo' — the leading slash is optional and trailing " +
      "words become $ARGUMENTS / $1..$9. @file references are expanded; " +
      "!`shell` snippets are NOT executed when invoked this way (run them via " +
      "run_shell if needed). Available commands are listed in the system " +
      "prompt; calling with an unknown command returns the list.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The slash command to run, as typed by a user, e.g. '/review' or " +
            "'/git:commit fix the typo'. Leading '/' optional.",
        },
      },
      required: ["command"],
    },
    ...TOOL_POLICY_METADATA.slash_command,
    permissions: {
      level: "readonly",
      scopes: ["session:read"],
    },
    telemetry: {
      category: "planning",
      tags: ["tool:slash_command", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "ask_user_question",
    title: "Ask User Question",
    kind: "interaction",
    tier: "extension",
    description:
      "Pause the agent and ask the user a structured question. In non-interactive contexts (headless, WS gateway), returns an error so the agent can proceed autonomously.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Question to show the user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional multiple-choice options. When provided, user picks one (or many if multiSelect=true)",
        },
        multiSelect: {
          type: "boolean",
          description: "Allow multiple selections (default: false)",
        },
        timeoutMs: {
          type: "number",
          description: "Max wait for user reply in ms (default: 60000)",
        },
      },
      required: ["question"],
    },
    ...TOOL_POLICY_METADATA.ask_user_question,
    permissions: {
      level: "readonly",
      scopes: ["interaction:prompt"],
    },
    telemetry: {
      category: "interaction",
      tags: [
        "tool:ask_user_question",
        "contract:coding-agent",
        "tier:extension",
      ],
    },
  },
  {
    name: "search_sessions",
    title: "Search Sessions",
    kind: "search",
    tier: "extension",
    description:
      "Search across all past agent session conversations using full-text search. Useful for finding prior context, decisions, or code discussed in previous sessions.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (supports natural language keywords)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
    ...TOOL_POLICY_METADATA.search_sessions,
    permissions: {
      level: "readonly",
      scopes: ["session:read"],
    },
    telemetry: {
      category: "search",
      tags: [
        "tool:search_sessions",
        "contract:coding-agent",
        "tier:extension",
      ],
    },
  },
]);

const CODING_AGENT_MVP_TOOL_NAMES = Object.freeze(
  CODING_AGENT_TOOL_CONTRACTS.filter((tool) => tool.tier === "mvp").map(
    (tool) => tool.name,
  ),
);

const CODING_AGENT_EXTENSION_TOOL_NAMES = Object.freeze(
  CODING_AGENT_TOOL_CONTRACTS.filter((tool) => tool.tier === "extension").map(
    (tool) => tool.name,
  ),
);

const TOOL_CONTRACT_MAP = new Map(
  CODING_AGENT_TOOL_CONTRACTS.map((tool) => [tool.name, tool]),
);

function getCodingAgentToolContract(name) {
  const tool = TOOL_CONTRACT_MAP.get(name);
  return tool ? cloneValue(tool) : null;
}

function getCodingAgentToolContracts(options = {}) {
  const { tier = null } = options;
  return CODING_AGENT_TOOL_CONTRACTS.filter((tool) => {
    if (tier && tool.tier !== tier) {
      return false;
    }
    return true;
  }).map(cloneValue);
}

function listCodingAgentToolNames(options = {}) {
  return getCodingAgentToolContracts(options).map((tool) => tool.name);
}

function isCodingAgentMvpTool(name) {
  return CODING_AGENT_MVP_TOOL_NAMES.includes(name);
}

function getCodingAgentToolPolicy(name) {
  const tool = TOOL_CONTRACT_MAP.get(name);
  if (!tool) {
    return null;
  }

  return {
    tier: tool.tier,
    riskLevel: tool.riskLevel,
    availableInPlanMode: tool.availableInPlanMode,
    planModeBehavior: tool.planModeBehavior || "standard",
    requiresPlanApproval: tool.requiresPlanApproval,
    approvalFlow: tool.approvalFlow,
    permissions: cloneValue(tool.permissions),
  };
}

function getCodingAgentFunctionToolDefinition(name) {
  const tool = TOOL_CONTRACT_MAP.get(name);
  return tool ? createFunctionToolContract(tool) : null;
}

function getCodingAgentFunctionToolDefinitions(options = {}) {
  const { tier = null, names = null } = options;
  const allowedNames =
    Array.isArray(names) && names.length > 0 ? new Set(names) : null;

  return CODING_AGENT_TOOL_CONTRACTS.filter((tool) => {
    if (tier && tool.tier !== tier) {
      return false;
    }
    if (allowedNames && !allowedNames.has(tool.name)) {
      return false;
    }
    return true;
  }).map(createFunctionToolContract);
}

module.exports = {
  CODING_AGENT_TOOL_CONTRACTS,
  CODING_AGENT_MVP_TOOL_NAMES,
  CODING_AGENT_EXTENSION_TOOL_NAMES,
  getCodingAgentFunctionToolDefinition,
  getCodingAgentFunctionToolDefinitions,
  getCodingAgentToolContract,
  getCodingAgentToolContracts,
  getCodingAgentToolPolicy,
  isCodingAgentMvpTool,
  listCodingAgentToolNames,
};
