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
  volcengine: {
    name: "Volcengine (火山引擎/豆包)",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-1-6-251015",
    requiresApiKey: true,
  },
  openai: {
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
  },
  anthropic: {
    name: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    requiresApiKey: true,
  },
  deepseek: {
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    requiresApiKey: true,
  },
  dashscope: {
    name: "DashScope (阿里通义)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-max",
    requiresApiKey: true,
  },
  gemini: {
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    requiresApiKey: true,
  },
  kimi: {
    name: "Kimi (月之暗面)",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-auto",
    requiresApiKey: true,
  },
  minimax: {
    name: "MiniMax (海螺AI)",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    requiresApiKey: true,
  },
  mistral: {
    name: "Mistral AI",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    requiresApiKey: true,
  },
  ollama: {
    name: "Ollama (本地部署)",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "qwen2:7b",
    requiresApiKey: false,
  },
  "openai-proxy": {
    name: "OpenAI 中转站 (API2D/CloseAI等)",
    defaultBaseUrl: "",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    isProxy: true,
  },
  "anthropic-proxy": {
    name: "Anthropic 中转站 (Claude代理)",
    defaultBaseUrl: "",
    defaultModel: "claude-sonnet-4-6",
    requiresApiKey: true,
    isProxy: true,
  },
  "gemini-proxy": {
    name: "Gemini 中转站 (Google代理)",
    defaultBaseUrl: "",
    defaultModel: "gemini-2.0-flash",
    requiresApiKey: true,
    isProxy: true,
  },
  custom: {
    name: "自定义 Provider (自建服务/vLLM/TGI等)",
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
  features: {},
  paths: {
    projectRoot: null,
    database: null,
  },
  llm: {
    provider: "volcengine",
    apiKey: null,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-251015",
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
