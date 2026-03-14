import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(join(__dirname, "..", "package.json"));

export const VERSION = pkg.version;

export const GITHUB_OWNER = "chainlesschain";
export const GITHUB_REPO = "chainlesschain";
export const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_RELEASES_URL = `${GITHUB_API_BASE}/releases`;

export const DEFAULT_PORTS = {
  vite: 5173,
  signaling: 9001,
  ollama: 11434,
  qdrant: 6333,
  postgresql: 5432,
  redis: 6379,
  projectService: 9090,
  aiService: 8001,
  wsServer: 18800,
};

export const LLM_PROVIDERS = {
  ollama: {
    name: "Ollama (Local)",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "qwen2:7b",
    requiresApiKey: false,
  },
  openai: {
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
  },
  dashscope: {
    name: "DashScope (Alibaba)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    defaultModel: "qwen-max",
    requiresApiKey: true,
  },
  deepseek: {
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    requiresApiKey: true,
  },
  custom: {
    name: "Custom Provider",
    defaultBaseUrl: "",
    defaultModel: "",
    requiresApiKey: true,
  },
};

export const EDITIONS = {
  personal: {
    name: "Personal",
    description: "For individual use with local AI and privacy-first design",
  },
  enterprise: {
    name: "Enterprise",
    description: "For teams with SSO, RBAC, audit logging, and org management",
  },
};

// Asset matching is now done by platform patterns in downloader.js

export const CONFIG_DIR_NAME = ".chainlesschain";

export const DEFAULT_CONFIG = {
  setupCompleted: false,
  completedAt: null,
  edition: "personal",
  paths: {
    projectRoot: null,
    database: null,
  },
  llm: {
    provider: "ollama",
    apiKey: null,
    baseUrl: "http://localhost:11434",
    model: "qwen2:7b",
  },
  enterprise: {
    serverUrl: null,
    apiKey: null,
    tenantId: null,
  },
  services: {
    autoStart: false,
    dockerComposePath: null,
  },
  update: {
    channel: "stable",
    autoCheck: true,
  },
};

export const MIN_NODE_VERSION = "22.12.0";
