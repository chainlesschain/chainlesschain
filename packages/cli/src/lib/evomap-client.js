/**
 * EvoMap Client — GEP-A2A HTTP client for gene exchange.
 *
 * Communicates with EvoMap Hub servers to search, publish, and download
 * agent capability genes (skills, prompts, tool configs).
 *
 * Lightweight: uses native fetch, no heavy dependencies.
 */

// Exported for test injection
export const _deps = {
  fetch: globalThis.fetch,
};

const DEFAULT_HUB = "https://evomap.chainlesschain.com/api/v1";

export class EvoMapClient {
  /**
   * @param {object} options
   * @param {string} [options.hubUrl] - EvoMap Hub URL
   * @param {string} [options.apiKey] - Optional API key for authenticated endpoints
   * @param {number} [options.timeout] - Request timeout in ms
   */
  constructor({ hubUrl, apiKey, timeout } = {}) {
    this.hubUrl = hubUrl || process.env.EVOMAP_HUB_URL || DEFAULT_HUB;
    this.apiKey = apiKey || process.env.EVOMAP_API_KEY || "";
    this.timeout = timeout || 10000;
  }

  /**
   * Search for genes on the hub.
   * @param {string} query - Search query
   * @param {object} [options]
   * @param {string} [options.category] - Filter by category
   * @param {number} [options.limit] - Max results
   * @returns {Promise<Array<{ id, name, description, author, version, downloads, rating }>>}
   */
  async search(query, { category, limit = 20 } = {}) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (category) params.set("category", category);

    const data = await this._request(`/genes/search?${params}`);
    return data.genes || data.results || [];
  }

  /**
   * Get gene details by ID.
   */
  async getGene(geneId) {
    return this._request(`/genes/${encodeURIComponent(geneId)}`);
  }

  /**
   * Download a gene package.
   * @returns {{ gene: object, content: string }}
   */
  async download(geneId) {
    const data = await this._request(
      `/genes/${encodeURIComponent(geneId)}/download`,
    );
    return data;
  }

  /**
   * Publish a gene to the hub.
   * @param {object} gene - Gene metadata + content
   */
  async publish(gene) {
    if (!this.apiKey) throw new Error("API key required for publishing");
    return this._request("/genes", {
      method: "POST",
      body: JSON.stringify(gene),
    });
  }

  /**
   * List hub information.
   */
  async getHubInfo() {
    return this._request("/info");
  }

  /**
   * List available hubs (returns current hub info).
   */
  async listHubs() {
    try {
      const info = await this.getHubInfo();
      return [{ url: this.hubUrl, ...info }];
    } catch (_err) {
      return [{ url: this.hubUrl, status: "unreachable" }];
    }
  }

  // ─── Internal ───

  async _request(path, options = {}) {
    const url = `${this.hubUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await _deps.fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body || undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `EvoMap API error: ${response.status} ${response.statusText}`,
        );
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error(`EvoMap request timed out after ${this.timeout}ms`);
      }
      throw err;
    }
  }
}
