/**
 * LLMClient — pluggable LLM backend interface used by the AnalysisEngine.
 *
 * Mirrors §8.4 of docs/design/Personal_Data_Hub_Architecture.md. The hub
 * doesn't pick an LLM SDK; consumers inject one of:
 *
 *   - OllamaClient   — HTTP, local-only, default for the privacy promise
 *   - MockLLMClient  — deterministic, for tests and skill development
 *   - (later)          vLLM / Llama.cpp / cloud — explicit user opt-in only
 *
 * Contract: a single async chat(messages, opts) -> { text, usage?, model? }.
 * Messages are { role: "system"|"user"|"assistant", content: string }.
 *
 *   `isLocal`  MUST accurately report whether the backend keeps data on the
 *              user's machine. The AnalysisEngine refuses to run with a
 *              non-local LLM unless `acceptNonLocal: true` is explicitly
 *              passed by the caller. Architecture-doc §11.2 invariant.
 *
 *   `name`     human-readable label surfaced in audit logs.
 *
 * Implementations should treat the messages array as opaque — the hub
 * stitches together (system prompt) + (user question with embedded facts)
 * and hands them off. No silent rewriting.
 */

"use strict";

// ─── MockLLMClient ───────────────────────────────────────────────────────

/**
 * MockLLMClient — deterministic, no network.
 *
 * Constructor takes one of:
 *   { reply: string }                          — always returns the same text
 *   { reply: (messages) => string }            — function of input
 *   { replies: string[] }                      — returns one per call, errors after exhaustion
 *
 * Useful for testing AnalysisEngine end-to-end without an Ollama install.
 */
class MockLLMClient {
  constructor(opts = {}) {
    this.name = opts.name || "mock-llm";
    this.isLocal = true;
    this.calls = []; // each call recorded as { messages, opts } for asserting prompt shape

    if (typeof opts.reply === "function") {
      this._reply = opts.reply;
    } else if (typeof opts.reply === "string") {
      this._reply = () => opts.reply;
    } else if (Array.isArray(opts.replies)) {
      let i = 0;
      this._reply = () => {
        if (i >= opts.replies.length) {
          throw new Error(`MockLLMClient: exhausted replies (${opts.replies.length} provided)`);
        }
        return opts.replies[i++];
      };
    } else {
      this._reply = () => "(mock empty reply)";
    }
  }

  async chat(messages, opts = {}) {
    this.calls.push({ messages: messages.slice(), opts: { ...opts } });
    const text = this._reply(messages, opts);
    return {
      text,
      model: this.name,
      usage: {
        promptTokens: messages.reduce((n, m) => n + (m.content ? m.content.length : 0), 0) / 4 | 0,
        completionTokens: (text || "").length / 4 | 0,
        totalTokens: 0, // sum below
      },
    };
  }
}

// ─── OllamaClient ────────────────────────────────────────────────────────

/**
 * OllamaClient — talks to a local Ollama HTTP server.
 *
 * Default endpoint http://localhost:11434, default model qwen2.5:7b-instruct
 * (per §8.4 recommendation). Uses /api/chat which expects:
 *
 *   POST /api/chat
 *   { "model": "...", "messages": [...], "stream": false, "options": { ... } }
 *
 * Response: { message: { role: "assistant", content: "..." }, ... }
 *
 * No external dep — uses global fetch (Node 22+). If a request fails (network
 * error / Ollama not running / model not pulled) the error surfaces to the
 * caller with `cause` preserved, never silently downgrades to cloud.
 */
class OllamaClient {
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || "http://localhost:11434").replace(/\/$/, "");
    this.model = opts.model || "qwen2.5:7b-instruct";
    this.name = opts.name || `ollama:${this.model}`;
    this.isLocal = true; // Ollama is always local-only by construction
    this.timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 60_000;
    this._fetch = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!this._fetch) {
      throw new Error("OllamaClient: no fetch available. Node 22+ required, or pass opts.fetch.");
    }
  }

  async chat(messages, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);

    let resp;
    try {
      resp = await this._fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          options: {
            temperature: typeof opts.temperature === "number" ? opts.temperature : 0.2,
            ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
          },
        }),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(t);
      const wrapped = new Error(`OllamaClient.chat: request failed — ${err && err.message ? err.message : err}`);
      wrapped.cause = err;
      throw wrapped;
    }
    clearTimeout(t);

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`OllamaClient.chat: HTTP ${resp.status} ${resp.statusText} — ${body.slice(0, 200)}`);
    }

    const json = await resp.json();
    const text = json && json.message && typeof json.message.content === "string"
      ? json.message.content
      : "";
    return {
      text,
      model: this.model,
      usage: {
        promptTokens: json.prompt_eval_count || 0,
        completionTokens: json.eval_count || 0,
        totalTokens: (json.prompt_eval_count || 0) + (json.eval_count || 0),
      },
      raw: json,
    };
  }

  /** Lightweight health check — pings /api/tags. */
  async health() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const resp = await this._fetch(`${this.baseUrl}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      return { ok: resp.ok, status: resp.status };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }
}

module.exports = { MockLLMClient, OllamaClient };
