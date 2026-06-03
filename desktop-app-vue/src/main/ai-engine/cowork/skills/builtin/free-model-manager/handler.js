/**
 * Free Model Manager Skill Handler
 */
const { logger } = require("../../../../../utils/logger.js");
const http = require("http");
const https = require("https");

const _deps = { http, https };

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const HF_API = "https://huggingface.co/api";

// Well-known free models catalog for search enrichment
const MODEL_CATALOG = [
  {
    name: "llama3:8b",
    description: "Meta Llama 3 8B - general purpose",
    size: "4.7GB",
    category: "general",
  },
  {
    name: "llama3:70b",
    description: "Meta Llama 3 70B - advanced reasoning",
    size: "39GB",
    category: "general",
  },
  {
    name: "qwen2:7b",
    description: "Alibaba Qwen2 7B - multilingual",
    size: "4.4GB",
    category: "general",
  },
  {
    name: "qwen2:72b",
    description: "Alibaba Qwen2 72B - large multilingual",
    size: "41GB",
    category: "general",
  },
  {
    name: "codellama:7b",
    description: "Code Llama 7B - code generation",
    size: "3.8GB",
    category: "code",
  },
  {
    name: "codellama:13b",
    description: "Code Llama 13B - code generation",
    size: "7.4GB",
    category: "code",
  },
  {
    name: "deepseek-coder:6.7b",
    description: "DeepSeek Coder 6.7B - code specialist",
    size: "3.8GB",
    category: "code",
  },
  {
    name: "deepseek-coder-v2:16b",
    description: "DeepSeek Coder V2 16B - advanced code",
    size: "8.9GB",
    category: "code",
  },
  {
    name: "mistral:7b",
    description: "Mistral 7B - efficient general model",
    size: "4.1GB",
    category: "general",
  },
  {
    name: "mixtral:8x7b",
    description: "Mixtral 8x7B MoE - high quality",
    size: "26GB",
    category: "general",
  },
  {
    name: "phi3:mini",
    description: "Microsoft Phi-3 Mini - compact capable",
    size: "2.3GB",
    category: "general",
  },
  {
    name: "phi3:medium",
    description: "Microsoft Phi-3 Medium 14B",
    size: "7.9GB",
    category: "general",
  },
  {
    name: "gemma:7b",
    description: "Google Gemma 7B - lightweight",
    size: "5.0GB",
    category: "general",
  },
  {
    name: "gemma2:9b",
    description: "Google Gemma 2 9B - improved",
    size: "5.4GB",
    category: "general",
  },
  {
    name: "starcoder2:7b",
    description: "StarCoder2 7B - code generation",
    size: "4.0GB",
    category: "code",
  },
  {
    name: "llava:7b",
    description: "LLaVA 7B - vision + language",
    size: "4.7GB",
    category: "multimodal",
  },
  {
    name: "llava:13b",
    description: "LLaVA 13B - vision + language",
    size: "8.0GB",
    category: "multimodal",
  },
  {
    name: "nomic-embed-text",
    description: "Nomic Embed Text - embeddings",
    size: "274MB",
    category: "embedding",
  },
  {
    name: "all-minilm:l6-v2",
    description: "All-MiniLM-L6-v2 - sentence embeddings",
    size: "45MB",
    category: "embedding",
  },
  {
    name: "wizard-math:7b",
    description: "WizardMath 7B - math reasoning",
    size: "4.1GB",
    category: "math",
  },
];

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[FreeModelManager] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "list-local":
          return await handleListLocal();
        case "pull":
          return await handlePull(parsed.target);
        case "search":
          return await handleSearch(parsed.query, parsed.options);
        case "info":
          return await handleInfo(parsed.target);
        case "remove":
          return await handleRemove(parsed.target);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Available: list-local, pull, search, info, remove`,
          };
      }
    } catch (error) {
      logger.error("[FreeModelManager] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list-local", target: "", query: "", options: {} };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "list-local").toLowerCase();

  const sourceMatch = input.match(/--source\s+(\S+)/);
  const query = parts
    .slice(1)
    .filter((p) => !p.startsWith("--"))
    .join(" ");

  return {
    action,
    target: parts[1] || "",
    query,
    options: { source: sourceMatch ? sourceMatch[1].toLowerCase() : "ollama" },
  };
}

async function handleListLocal() {
  let models;
  try {
    const data = await ollamaRequest("GET", "/api/tags");
    models = data.models || [];
  } catch (err) {
    return {
      success: false,
      error: `Cannot connect to Ollama at ${OLLAMA_HOST}. Is Ollama running? Error: ${err.message}`,
    };
  }

  const formatted = models.map((m) => ({
    name: m.name,
    size: formatBytes(m.size),
    sizeBytes: m.size,
    modified: m.modified_at,
    digest: m.digest ? m.digest.substring(0, 12) : null,
    family: m.details ? m.details.family : null,
    parameterSize: m.details ? m.details.parameter_size : null,
    quantization: m.details ? m.details.quantization_level : null,
  }));

  const totalSize = models.reduce((sum, m) => sum + (m.size || 0), 0);

  return {
    success: true,
    action: "list-local",
    result: {
      models: formatted,
      count: formatted.length,
      totalSize: formatBytes(totalSize),
    },
    message: `${formatted.length} model(s) installed locally (${formatBytes(totalSize)} total).`,
  };
}

async function handlePull(modelName) {
  if (!modelName) {
    return {
      success: false,
      error: "Provide a model name. Example: pull llama3:8b",
    };
  }

  // Verify Ollama is accessible
  try {
    await ollamaRequest("GET", "/api/tags");
  } catch (err) {
    return {
      success: false,
      error: `Cannot connect to Ollama at ${OLLAMA_HOST}. Is Ollama running? Error: ${err.message}`,
    };
  }

  // Start the pull (non-streaming to get final status)
  try {
    const data = await ollamaRequest(
      "POST",
      "/api/pull",
      { name: modelName, stream: false },
      600000,
    );

    return {
      success: true,
      action: "pull",
      result: { model: modelName, status: data.status || "success" },
      message: `Model "${modelName}" pulled successfully.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to pull "${modelName}": ${err.message}`,
    };
  }
}

async function handleSearch(query, options) {
  if (!query) {
    return {
      success: false,
      error: "Provide a search query. Example: search code generation",
    };
  }

  const results = [];
  const lowerQuery = query.toLowerCase();

  // Search local catalog
  const catalogMatches = MODEL_CATALOG.filter(
    (m) =>
      m.name.toLowerCase().includes(lowerQuery) ||
      m.description.toLowerCase().includes(lowerQuery) ||
      m.category.toLowerCase().includes(lowerQuery),
  );

  for (const m of catalogMatches) {
    results.push({
      source: "ollama",
      name: m.name,
      description: m.description,
      size: m.size,
      category: m.category,
    });
  }

  // Search HuggingFace if requested
  if (options.source === "huggingface" || options.source === "hf") {
    try {
      const hfResults = await fetchJSON(
        `${HF_API}/models?search=${encodeURIComponent(query)}&sort=likes&direction=-1&limit=15&filter=text-generation`,
      );
      if (Array.isArray(hfResults)) {
        for (const model of hfResults) {
          results.push({
            source: "huggingface",
            name: model.modelId || model.id,
            description: model.pipeline_tag || "text-generation",
            likes: model.likes || 0,
            downloads: model.downloads || 0,
            url: `https://huggingface.co/${model.modelId || model.id}`,
          });
        }
      }
    } catch (err) {
      logger.warn("[FreeModelManager] HuggingFace search failed:", err.message);
      results.push({
        source: "huggingface",
        name: "search-error",
        description: `HuggingFace API error: ${err.message}`,
      });
    }
  }

  return {
    success: true,
    action: "search",
    result: { query, results, total: results.length },
    message: `Found ${results.length} model(s) matching "${query}".`,
  };
}

async function handleInfo(modelName) {
  if (!modelName) {
    return {
      success: false,
      error: "Provide a model name. Example: info llama3:8b",
    };
  }

  // Try Ollama first (local model)
  try {
    const data = await ollamaRequest("POST", "/api/show", { name: modelName });

    const info = {
      name: modelName,
      source: "ollama-local",
      modelfile: data.modelfile || null,
      parameters: data.parameters || null,
      template: data.template || null,
      details: data.details || {},
      license: data.license || null,
    };

    return {
      success: true,
      action: "info",
      result: info,
      message: `Model "${modelName}" info retrieved from Ollama.`,
    };
  } catch (_err) {
    // Not installed locally, check catalog
    const catalogEntry = MODEL_CATALOG.find(
      (m) => m.name === modelName || m.name.startsWith(modelName),
    );
    if (catalogEntry) {
      return {
        success: true,
        action: "info",
        result: { ...catalogEntry, source: "catalog", installed: false },
        message: `Model "${modelName}" found in catalog (not installed locally). Use "pull ${modelName}" to download.`,
      };
    }

    return {
      success: false,
      error: `Model "${modelName}" not found locally or in catalog. Try "search ${modelName}" to find it.`,
    };
  }
}

async function handleRemove(modelName) {
  if (!modelName) {
    return {
      success: false,
      error: "Provide a model name. Example: remove llama3:8b",
    };
  }

  try {
    await ollamaRequest("DELETE", "/api/delete", { name: modelName });
    return {
      success: true,
      action: "remove",
      result: { model: modelName, removed: true },
      message: `Model "${modelName}" removed successfully.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to remove "${modelName}": ${err.message}`,
    };
  }
}

function ollamaRequest(method, path, body = null, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(OLLAMA_HOST);
    const transport = parsed.protocol === "https:" ? _deps.https : _deps.http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ChainlessChain/1.2.0",
      },
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          // Ollama streaming responses are newline-delimited JSON; take the last complete object
          if (data.includes("\n")) {
            const lines = data.trim().split("\n").filter(Boolean);
            const lastLine = lines[lines.length - 1];
            resolve(JSON.parse(lastLine));
          } else {
            resolve(JSON.parse(data));
          }
        } catch (_parseErr) {
          logger.warn(
            "[FreeModelManager] Failed to parse JSON response from %s",
            path,
          );
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: "success", raw: data });
          } else {
            reject(
              new Error(
                `Ollama returned status ${res.statusCode}: ${data.substring(0, 200)}`,
              ),
            );
          }
        }
      });
    });

    req.on("error", (err) =>
      reject(new Error(`Ollama connection failed: ${err.message}`)),
    );
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error("Ollama request timed out"));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    _deps.https
      .get(
        url,
        { headers: { "User-Agent": "ChainlessChain/1.2.0" } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (_err) {
              reject(new Error(`Failed to parse response from ${url}`));
            }
          });
        },
      )
      .on("error", (err) => reject(err));
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
