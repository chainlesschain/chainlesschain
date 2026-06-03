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

// ===== V2 Surface: MCP Scaffold governance overlay (CLI v0.142.0) =====
export const MSCAF_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const MSCAF_GENERATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  GENERATING: "generating",
  GENERATED: "generated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _mscafPTrans = new Map([
  [
    MSCAF_PROFILE_MATURITY_V2.PENDING,
    new Set([
      MSCAF_PROFILE_MATURITY_V2.ACTIVE,
      MSCAF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MSCAF_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      MSCAF_PROFILE_MATURITY_V2.STALE,
      MSCAF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MSCAF_PROFILE_MATURITY_V2.STALE,
    new Set([
      MSCAF_PROFILE_MATURITY_V2.ACTIVE,
      MSCAF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [MSCAF_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _mscafPTerminal = new Set([MSCAF_PROFILE_MATURITY_V2.ARCHIVED]);
const _mscafGTrans = new Map([
  [
    MSCAF_GENERATION_LIFECYCLE_V2.QUEUED,
    new Set([
      MSCAF_GENERATION_LIFECYCLE_V2.GENERATING,
      MSCAF_GENERATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    MSCAF_GENERATION_LIFECYCLE_V2.GENERATING,
    new Set([
      MSCAF_GENERATION_LIFECYCLE_V2.GENERATED,
      MSCAF_GENERATION_LIFECYCLE_V2.FAILED,
      MSCAF_GENERATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MSCAF_GENERATION_LIFECYCLE_V2.GENERATED, new Set()],
  [MSCAF_GENERATION_LIFECYCLE_V2.FAILED, new Set()],
  [MSCAF_GENERATION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _mscafPsV2 = new Map();
const _mscafGsV2 = new Map();
let _mscafMaxActive = 6,
  _mscafMaxPending = 15,
  _mscafIdleMs = 30 * 24 * 60 * 60 * 1000,
  _mscafStuckMs = 60 * 1000;
function _mscafPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _mscafCheckP(from, to) {
  const a = _mscafPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid mscaf profile transition ${from} → ${to}`);
}
function _mscafCheckG(from, to) {
  const a = _mscafGTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid mscaf generation transition ${from} → ${to}`);
}
export function setMaxActiveMscafProfilesPerOwnerV2(n) {
  _mscafMaxActive = _mscafPos(n, "maxActiveMscafProfilesPerOwner");
}
export function getMaxActiveMscafProfilesPerOwnerV2() {
  return _mscafMaxActive;
}
export function setMaxPendingMscafGenerationsPerProfileV2(n) {
  _mscafMaxPending = _mscafPos(n, "maxPendingMscafGenerationsPerProfile");
}
export function getMaxPendingMscafGenerationsPerProfileV2() {
  return _mscafMaxPending;
}
export function setMscafProfileIdleMsV2(n) {
  _mscafIdleMs = _mscafPos(n, "mscafProfileIdleMs");
}
export function getMscafProfileIdleMsV2() {
  return _mscafIdleMs;
}
export function setMscafGenerationStuckMsV2(n) {
  _mscafStuckMs = _mscafPos(n, "mscafGenerationStuckMs");
}
export function getMscafGenerationStuckMsV2() {
  return _mscafStuckMs;
}
export function _resetStateMcpScaffoldV2() {
  _mscafPsV2.clear();
  _mscafGsV2.clear();
  _mscafMaxActive = 6;
  _mscafMaxPending = 15;
  _mscafIdleMs = 30 * 24 * 60 * 60 * 1000;
  _mscafStuckMs = 60 * 1000;
}
export function registerMscafProfileV2({
  id,
  owner,
  transport,
  metadata,
} = {}) {
  if (!id) throw new Error("mscaf profile id required");
  if (!owner) throw new Error("mscaf profile owner required");
  if (_mscafPsV2.has(id))
    throw new Error(`mscaf profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    transport: transport || "stdio",
    status: MSCAF_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _mscafPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _mscafCountActive(owner) {
  let n = 0;
  for (const p of _mscafPsV2.values())
    if (p.owner === owner && p.status === MSCAF_PROFILE_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activateMscafProfileV2(id) {
  const p = _mscafPsV2.get(id);
  if (!p) throw new Error(`mscaf profile ${id} not found`);
  _mscafCheckP(p.status, MSCAF_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === MSCAF_PROFILE_MATURITY_V2.STALE;
  if (!recovery && _mscafCountActive(p.owner) >= _mscafMaxActive)
    throw new Error(`max active mscaf profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = MSCAF_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleMscafProfileV2(id) {
  const p = _mscafPsV2.get(id);
  if (!p) throw new Error(`mscaf profile ${id} not found`);
  _mscafCheckP(p.status, MSCAF_PROFILE_MATURITY_V2.STALE);
  p.status = MSCAF_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveMscafProfileV2(id) {
  const p = _mscafPsV2.get(id);
  if (!p) throw new Error(`mscaf profile ${id} not found`);
  _mscafCheckP(p.status, MSCAF_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = MSCAF_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchMscafProfileV2(id) {
  const p = _mscafPsV2.get(id);
  if (!p) throw new Error(`mscaf profile ${id} not found`);
  if (_mscafPTerminal.has(p.status))
    throw new Error(`cannot touch terminal mscaf profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getMscafProfileV2(id) {
  const p = _mscafPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listMscafProfilesV2() {
  return [..._mscafPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
function _mscafCountPending(profileId) {
  let n = 0;
  for (const g of _mscafGsV2.values())
    if (
      g.profileId === profileId &&
      (g.status === MSCAF_GENERATION_LIFECYCLE_V2.QUEUED ||
        g.status === MSCAF_GENERATION_LIFECYCLE_V2.GENERATING)
    )
      n++;
  return n;
}
export function createMscafGenerationV2({
  id,
  profileId,
  target,
  metadata,
} = {}) {
  if (!id) throw new Error("mscaf generation id required");
  if (!profileId) throw new Error("mscaf generation profileId required");
  if (_mscafGsV2.has(id))
    throw new Error(`mscaf generation ${id} already exists`);
  if (!_mscafPsV2.has(profileId))
    throw new Error(`mscaf profile ${profileId} not found`);
  if (_mscafCountPending(profileId) >= _mscafMaxPending)
    throw new Error(
      `max pending mscaf generations for profile ${profileId} reached`,
    );
  const now = Date.now();
  const g = {
    id,
    profileId,
    target: target || "",
    status: MSCAF_GENERATION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _mscafGsV2.set(id, g);
  return { ...g, metadata: { ...g.metadata } };
}
export function generatingMscafGenerationV2(id) {
  const g = _mscafGsV2.get(id);
  if (!g) throw new Error(`mscaf generation ${id} not found`);
  _mscafCheckG(g.status, MSCAF_GENERATION_LIFECYCLE_V2.GENERATING);
  const now = Date.now();
  g.status = MSCAF_GENERATION_LIFECYCLE_V2.GENERATING;
  g.updatedAt = now;
  if (!g.startedAt) g.startedAt = now;
  return { ...g, metadata: { ...g.metadata } };
}
export function generateMscafGenerationV2(id) {
  const g = _mscafGsV2.get(id);
  if (!g) throw new Error(`mscaf generation ${id} not found`);
  _mscafCheckG(g.status, MSCAF_GENERATION_LIFECYCLE_V2.GENERATED);
  const now = Date.now();
  g.status = MSCAF_GENERATION_LIFECYCLE_V2.GENERATED;
  g.updatedAt = now;
  if (!g.settledAt) g.settledAt = now;
  return { ...g, metadata: { ...g.metadata } };
}
export function failMscafGenerationV2(id, reason) {
  const g = _mscafGsV2.get(id);
  if (!g) throw new Error(`mscaf generation ${id} not found`);
  _mscafCheckG(g.status, MSCAF_GENERATION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  g.status = MSCAF_GENERATION_LIFECYCLE_V2.FAILED;
  g.updatedAt = now;
  if (!g.settledAt) g.settledAt = now;
  if (reason) g.metadata.failReason = String(reason);
  return { ...g, metadata: { ...g.metadata } };
}
export function cancelMscafGenerationV2(id, reason) {
  const g = _mscafGsV2.get(id);
  if (!g) throw new Error(`mscaf generation ${id} not found`);
  _mscafCheckG(g.status, MSCAF_GENERATION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  g.status = MSCAF_GENERATION_LIFECYCLE_V2.CANCELLED;
  g.updatedAt = now;
  if (!g.settledAt) g.settledAt = now;
  if (reason) g.metadata.cancelReason = String(reason);
  return { ...g, metadata: { ...g.metadata } };
}
export function getMscafGenerationV2(id) {
  const g = _mscafGsV2.get(id);
  if (!g) return null;
  return { ...g, metadata: { ...g.metadata } };
}
export function listMscafGenerationsV2() {
  return [..._mscafGsV2.values()].map((g) => ({
    ...g,
    metadata: { ...g.metadata },
  }));
}
export function autoStaleIdleMscafProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _mscafPsV2.values())
    if (
      p.status === MSCAF_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _mscafIdleMs
    ) {
      p.status = MSCAF_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckMscafGenerationsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const g of _mscafGsV2.values())
    if (
      g.status === MSCAF_GENERATION_LIFECYCLE_V2.GENERATING &&
      g.startedAt != null &&
      t - g.startedAt >= _mscafStuckMs
    ) {
      g.status = MSCAF_GENERATION_LIFECYCLE_V2.FAILED;
      g.updatedAt = t;
      if (!g.settledAt) g.settledAt = t;
      g.metadata.failReason = "auto-fail-stuck";
      flipped.push(g.id);
    }
  return { flipped, count: flipped.length };
}
export function getMcpScaffoldGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(MSCAF_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _mscafPsV2.values()) profilesByStatus[p.status]++;
  const generationsByStatus = {};
  for (const v of Object.values(MSCAF_GENERATION_LIFECYCLE_V2))
    generationsByStatus[v] = 0;
  for (const g of _mscafGsV2.values()) generationsByStatus[g.status]++;
  return {
    totalMscafProfilesV2: _mscafPsV2.size,
    totalMscafGenerationsV2: _mscafGsV2.size,
    maxActiveMscafProfilesPerOwner: _mscafMaxActive,
    maxPendingMscafGenerationsPerProfile: _mscafMaxPending,
    mscafProfileIdleMs: _mscafIdleMs,
    mscafGenerationStuckMs: _mscafStuckMs,
    profilesByStatus,
    generationsByStatus,
  };
}
