import { describe, it, expect } from "vitest";
import { webSearch } from "../../src/lib/web-search.js";

/**
 * Live integration tests for the KEYED web_search backends — they hit the real
 * provider APIs with a real query. Each test runs ONLY when its provider's API
 * key is present in the environment, otherwise it is skipped (never failed), so
 * CI / contributors without keys stay green while a keyed run verifies the wire
 * shape end-to-end.
 *
 *   BOCHA_API_KEY=sk-xxx   npx vitest run __tests__/integration/web-search-live.test.js
 *   QIANFAN_API_KEY=bce-v3/...  npx vitest run __tests__/integration/web-search-live.test.js
 *   TAVILY_API_KEY / BRAVE_API_KEY likewise.
 */

const KEYED = [
  { provider: "bocha", env: "BOCHA_API_KEY", query: "人工智能最新进展" },
  { provider: "qianfan", env: "QIANFAN_API_KEY", query: "杭州亚运会" },
  { provider: "tavily", env: "TAVILY_API_KEY", query: "who won the 2022 World Cup" },
  { provider: "brave", env: "BRAVE_API_KEY", query: "latest SpaceX Starship test" },
];

describe("web_search — live keyed backends", () => {
  for (const { provider, env, query } of KEYED) {
    const hasKey = !!process.env[env];
    const t = hasKey ? it : it.skip;
    t(`${provider}: returns real results for a live query (needs ${env})`, async () => {
      const r = await webSearch(query, { provider, maxResults: 5 });
      expect(r.error, r.error || "").toBeUndefined();
      expect(r.provider).toBe(provider);
      expect(Array.isArray(r.results)).toBe(true);
      expect(r.count).toBeGreaterThan(0);
      // every result must carry a usable title + http(s) url
      for (const x of r.results) {
        expect(typeof x.title).toBe("string");
        expect(x.title.length).toBeGreaterThan(0);
        expect(x.url).toMatch(/^https?:\/\//);
      }
      // eslint-disable-next-line no-console
      console.log(`[live ${provider}] ${r.count} results; first: ${r.results[0].title}`);
    }, 30000);
  }
});
