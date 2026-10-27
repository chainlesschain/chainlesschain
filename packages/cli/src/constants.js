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

// New-connection suggestions are shared with both IDEs. Runtime fallbacks and
// existing persisted models are deliberately independent of this catalog.
const onboardingCatalog = require("./lib/llm-onboarding-catalog.json");
export const LLM_PROVIDERS = Object.fromEntries(
  onboardingCatalog.providers.map((preset) => [
    preset.id,
    {
      name: preset.cliLabel || preset.label,
      defaultBaseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      requiresApiKey: preset.needsKey,
      ...(preset.isProxy ? { isProxy: true } : {}),
    },
  ]),
);

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
  evolution: {
    enabled: false,
  },
  paths: {
    projectRoot: null,
    database: null,
  },
  llm: {
    provider: "volcengine",
    apiKey: null,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "deepseek-v4-1-flash-260910",
    // When true, `cc ask` (provider=ollama only) overrides baseUrl to point at
    // the Android LocalLlmServer (127.0.0.1:18484). User opt-in toggle:
    //   cc config set llm.preferAndroidLocal true
    // Resolution priority in ask.js:
    //   --base-url > CC_HUB_OLLAMA_URL env > --prefer-android-local flag >
    //   this config > config.llm.baseUrl > hardcoded localhost:11434
    preferAndroidLocal: false,
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
  cli: {
    promptSuggestions: true,
    keybindings: {},
  },
  voice: {
    backends: {},
    allowCloud: false,
  },
  advisor: {
    enabled: false,
  },
};

export const MIN_NODE_VERSION = "22.12.0";
