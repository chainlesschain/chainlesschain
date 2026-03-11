/**
 * LLM Provider registry — supports multiple AI providers with a unified interface.
 */

/**
 * Built-in provider definitions.
 */
export const BUILT_IN_PROVIDERS = {
  ollama: {
    name: "ollama",
    displayName: "Ollama (Local)",
    baseUrl: "http://localhost:11434",
    apiKeyEnv: null,
    models: ["qwen2:7b", "llama3:8b", "mistral:7b", "codellama:7b"],
    free: true,
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1"],
    free: false,
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    free: false,
  },
  deepseek: {
    name: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
    free: false,
  },
  dashscope: {
    name: "dashscope",
    displayName: "DashScope (Alibaba)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    models: ["qwen-turbo", "qwen-plus", "qwen-max"],
    free: false,
  },
  gemini: {
    name: "gemini",
    displayName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GEMINI_API_KEY",
    models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-flash"],
    free: false,
  },
  mistral: {
    name: "mistral",
    displayName: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
    ],
    free: false,
  },
};

/**
 * Provider registry — manages available providers and active selection.
 */
export class LLMProviderRegistry {
  constructor(db) {
    this.db = db;
    this.providers = new Map();
    this._ensureTable();
    this._loadBuiltins();
    this._loadCustom();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_providers (
        name TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_env TEXT,
        models TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 0,
        custom INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  _loadBuiltins() {
    for (const [name, def] of Object.entries(BUILT_IN_PROVIDERS)) {
      this.providers.set(name, { ...def, custom: false });
    }
  }

  _loadCustom() {
    const rows = this.db
      .prepare("SELECT * FROM llm_providers WHERE custom = 1")
      .all();
    for (const row of rows) {
      this.providers.set(row.name, {
        name: row.name,
        displayName: row.display_name,
        baseUrl: row.base_url,
        apiKeyEnv: row.api_key_env,
        models: JSON.parse(row.models || "[]"),
        custom: true,
        free: false,
      });
    }
  }

  /**
   * List all providers.
   */
  list() {
    const result = [];
    for (const [name, provider] of this.providers) {
      const hasKey = provider.apiKeyEnv
        ? !!process.env[provider.apiKeyEnv]
        : true;
      result.push({
        name,
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        models: provider.models,
        hasApiKey: hasKey,
        custom: provider.custom || false,
        free: provider.free || false,
      });
    }
    return result;
  }

  /**
   * Get a specific provider.
   */
  get(name) {
    return this.providers.get(name) || null;
  }

  /**
   * Add a custom provider.
   */
  addProvider(name, config) {
    const provider = {
      name,
      displayName: config.displayName || name,
      baseUrl: config.baseUrl,
      apiKeyEnv: config.apiKeyEnv || null,
      models: config.models || [],
      custom: true,
      free: config.free || false,
    };

    this.db
      .prepare(
        "INSERT OR REPLACE INTO llm_providers (name, display_name, base_url, api_key_env, models, custom) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run(
        name,
        provider.displayName,
        provider.baseUrl,
        provider.apiKeyEnv,
        JSON.stringify(provider.models),
      );

    this.providers.set(name, provider);
    return provider;
  }

  /**
   * Remove a custom provider.
   */
  removeProvider(name) {
    const provider = this.providers.get(name);
    if (!provider) return false;
    if (!provider.custom)
      throw new Error(`Cannot remove built-in provider "${name}"`);

    this.db
      .prepare("DELETE FROM llm_providers WHERE name = ? AND custom = 1")
      .run(name);
    this.providers.delete(name);
    return true;
  }

  /**
   * Get/set the active provider.
   */
  getActive() {
    const row = this.db
      .prepare("SELECT name FROM llm_providers WHERE is_active = 1")
      .get();
    return row ? row.name : "ollama";
  }

  setActive(name) {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" not found`);
    }
    // Reset all
    this.db.prepare("UPDATE llm_providers SET is_active = 0 WHERE 1=1").run();
    // Set active
    this.db
      .prepare(
        "INSERT OR REPLACE INTO llm_providers (name, display_name, base_url, api_key_env, models, is_active) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run(
        name,
        this.providers.get(name).displayName,
        this.providers.get(name).baseUrl,
        this.providers.get(name).apiKeyEnv,
        JSON.stringify(this.providers.get(name).models),
      );
    return this.providers.get(name);
  }

  /**
   * Get API key for a provider (from env or config).
   */
  getApiKey(name) {
    const provider = this.providers.get(name);
    if (!provider) return null;
    if (!provider.apiKeyEnv) return null;
    return process.env[provider.apiKeyEnv] || null;
  }

  /**
   * Test provider connectivity.
   */
  async testProvider(name, model) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider "${name}" not found`);

    const start = Date.now();
    const testModel = model || provider.models[0];

    if (name === "ollama") {
      const res = await fetch(`${provider.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: testModel, prompt: "Hi", stream: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        ok: true,
        elapsed: Date.now() - start,
        response: data.response?.trim(),
      };
    }

    if (name === "gemini") {
      const key = this.getApiKey(name);
      if (!key) throw new Error("GEMINI_API_KEY not set");
      const res = await fetch(
        `${provider.baseUrl}/models/${testModel}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { ok: true, elapsed: Date.now() - start, response: text.trim() };
    }

    if (name === "anthropic") {
      const key = this.getApiKey(name);
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      const res = await fetch(`${provider.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      return { ok: true, elapsed: Date.now() - start, response: text.trim() };
    }

    // OpenAI-compatible (openai, deepseek, dashscope, mistral)
    const key = this.getApiKey(name);
    if (!key) throw new Error(`${provider.apiKeyEnv} not set`);
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    return { ok: true, elapsed: Date.now() - start, response: text.trim() };
  }
}
