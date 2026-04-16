/**
 * MCP server scaffolder — pure template generator.
 *
 * Turns a `{name, description, transport, author}` spec into a list of
 * `{path, content}` files that together form a runnable boilerplate
 * project built on `@modelcontextprotocol/sdk`. Intentionally pure: the
 * command layer decides where to write the files (and whether to
 * overwrite), so tests can snapshot the output without hitting disk.
 *
 * Two transports are supported:
 *
 *   - **stdio** — default, matches every MCP example under
 *     `@modelcontextprotocol/server-*`. Uses `StdioServerTransport`,
 *     run via `node index.js` and wired into a host's MCP config with
 *     `command: "node"`.
 *   - **http**  — streamable HTTP + SSE. Uses `StreamableHTTPServerTransport`
 *     behind a tiny Express app so `cc mcp add <name> -u http://...`
 *     (or any MCP host) can connect.
 *
 * Every generated project includes:
 *
 *   - package.json     — `type: module`, `start` script, MCP SDK dep
 *   - index.js         — 1 example tool (`echo`) + 1 example resource
 *                        (`hello://world`) wired through the chosen transport
 *   - README.md        — run + wire-up instructions tailored to transport
 *   - .gitignore       — node_modules / logs / `.env`
 *
 * The scaffold stays intentionally tiny — "hello-world MCP server" —
 * rather than trying to demo every SDK feature. Authors clone and extend.
 */

/* ── constants ──────────────────────────────────────────────── */

export const SUPPORTED_TRANSPORTS = Object.freeze(["stdio", "http"]);

export const SDK_VERSION = "^1.0.0";
export const EXPRESS_VERSION = "^4.19.2";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/* ── public API ─────────────────────────────────────────────── */

/**
 * Generate the full file set for a new MCP server project.
 *
 * @param {object} spec
 * @param {string} spec.name         — npm-style kebab-case package name
 * @param {string} [spec.description]
 * @param {"stdio"|"http"} [spec.transport="stdio"]
 * @param {string} [spec.author]
 * @param {number} [spec.port=3333]  — only used for http transport
 * @returns {{ files: Array<{path:string, content:string}>, summary: object }}
 */
export function generateMcpServerScaffold(spec = {}) {
  const name = normalizeName(spec.name);
  const description =
    (typeof spec.description === "string" && spec.description.trim()) ||
    `An MCP server — ${name}`;
  const transport = normalizeTransport(spec.transport);
  const author = typeof spec.author === "string" ? spec.author.trim() : "";
  const port = Number.isInteger(spec.port) && spec.port > 0 ? spec.port : 3333;

  const files = [
    {
      path: "package.json",
      content: renderPackageJson({ name, description, transport, author }),
    },
    {
      path: "index.js",
      content: renderIndexJs({ name, description, transport, port }),
    },
    {
      path: "README.md",
      content: renderReadme({ name, description, transport, port }),
    },
    { path: ".gitignore", content: renderGitignore() },
  ];

  const summary = {
    name,
    description,
    transport,
    port: transport === "http" ? port : null,
    fileCount: files.length,
  };

  return { files, summary };
}

/**
 * Validate a proposed server name. Throws with a concrete reason —
 * callers can surface the message verbatim.
 */
export function normalizeName(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Server name is required.");
  }
  const name = raw.trim().toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid server name "${raw}". ` +
        `Use lowercase letters, digits, or hyphens (e.g. "my-weather").`,
    );
  }
  if (name.length > 60) {
    throw new Error("Server name must be 60 characters or fewer.");
  }
  return name;
}

export function normalizeTransport(raw) {
  const t =
    (typeof raw === "string" ? raw.trim().toLowerCase() : "stdio") || "stdio";
  if (!SUPPORTED_TRANSPORTS.includes(t)) {
    throw new Error(
      `Unknown transport "${raw}". Supported: ${SUPPORTED_TRANSPORTS.join(", ")}.`,
    );
  }
  return t;
}

/* ── renderers ──────────────────────────────────────────────── */

function renderPackageJson({ name, description, transport, author }) {
  const deps = {
    "@modelcontextprotocol/sdk": SDK_VERSION,
  };
  if (transport === "http") deps.express = EXPRESS_VERSION;

  const pkg = {
    name,
    version: "0.1.0",
    description,
    type: "module",
    main: "index.js",
    scripts: {
      start: "node index.js",
    },
    dependencies: deps,
  };
  if (author) pkg.author = author;

  return JSON.stringify(pkg, null, 2) + "\n";
}

function renderIndexJs({ name, description, transport, port }) {
  if (transport === "stdio") return renderStdioIndex({ name, description });
  return renderHttpIndex({ name, description, port });
}

function renderStdioIndex({ name, description }) {
  return `#!/usr/bin/env node
/**
 * ${name} — ${description}
 *
 * An MCP server over stdio. Registered by an MCP host via:
 *
 *   { "command": "node", "args": ["./index.js"] }
 *
 * (Or via \`cc mcp add ${name} -c node -a "./index.js"\`.)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "${name}", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

// ── Example tool ─────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo back the supplied message.",
      inputSchema: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", description: "Text to echo." },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name: tool, arguments: args } = req.params;
  if (tool === "echo") {
    return {
      content: [{ type: "text", text: String(args?.message ?? "") }],
    };
  }
  throw new Error(\`Unknown tool: \${tool}\`);
});

// ── Example resource ─────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "hello://world",
      name: "Hello world",
      description: "A trivial resource you can read to test connectivity.",
      mimeType: "text/plain",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === "hello://world") {
    return {
      contents: [
        { uri: req.params.uri, mimeType: "text/plain", text: "Hello, MCP!" },
      ],
    };
  }
  throw new Error(\`Unknown resource: \${req.params.uri}\`);
});

// ── Start ────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
`;
}

function renderHttpIndex({ name, description, port }) {
  return `#!/usr/bin/env node
/**
 * ${name} — ${description}
 *
 * An MCP server over Streamable HTTP + SSE. Started with:
 *
 *   npm start               # listens on 0.0.0.0:${port}
 *   PORT=9001 npm start     # override port
 *
 * Hosts connect by URL — with this CLI:
 *
 *   cc mcp add ${name} -u http://localhost:${port}/mcp
 */
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function makeServer() {
  const server = new Server(
    { name: "${name}", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo back the supplied message.",
        inputSchema: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", description: "Text to echo." },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name: tool, arguments: args } = req.params;
    if (tool === "echo") {
      return {
        content: [{ type: "text", text: String(args?.message ?? "") }],
      };
    }
    throw new Error(\`Unknown tool: \${tool}\`);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "hello://world",
        name: "Hello world",
        description: "A trivial resource you can read to test connectivity.",
        mimeType: "text/plain",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri === "hello://world") {
      return {
        contents: [
          { uri: req.params.uri, mimeType: "text/plain", text: "Hello, MCP!" },
        ],
      };
    }
    throw new Error(\`Unknown resource: \${req.params.uri}\`);
  });

  return server;
}

const app = express();
app.use(express.json());

app.all("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const server = makeServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number(process.env.PORT) || ${port};
app.listen(port, () => {
  console.log(\`[${name}] MCP server listening on http://localhost:\${port}/mcp\`);
});
`;
}

function renderReadme({ name, description, transport, port }) {
  const wireUp =
    transport === "stdio"
      ? `cc mcp add ${name} -c node -a "./index.js"`
      : `cc mcp add ${name} -u http://localhost:${port}/mcp`;

  const run =
    transport === "stdio"
      ? "An MCP host invokes the server on demand — there's no long-running process. Use `node index.js` only to sanity-check that the file parses."
      : `\`\`\`bash\nnpm install\nnpm start    # listens on http://localhost:${port}/mcp\n\`\`\``;

  return `# ${name}

${description}

Transport: **${transport}**${transport === "http" ? ` (port ${port})` : ""}

## Install

\`\`\`bash
npm install
\`\`\`

## Run

${run}

## Wire into a host

${transport === "stdio" ? "" : ""}\`\`\`bash
${wireUp}
cc mcp tools      # list discovered tools
cc mcp call ${name} echo --args '{"message":"hi"}'
\`\`\`

## What's in the box

- \`echo\` tool — accepts \`{message}\`, returns it verbatim.
- \`hello://world\` resource — a trivial plain-text resource you can read
  to confirm the server is reachable.

Extend \`index.js\` with your own \`Set*RequestHandler\` calls; the MCP SDK
docs at https://modelcontextprotocol.io/docs cover every request type.
`;
}

function renderGitignore() {
  return `node_modules/
*.log
.env
.env.*
!.env.example
`;
}
