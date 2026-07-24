"use strict";

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pdh = require("../lib");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(HERE, "../../../docs/internal/pdh-app-data-catalog.json");

function exportedCollectors() {
  const baseOpts = {
    account: {
      uid: "_catalog_test",
      uin: "_catalog_test",
      email: "catalog-test@example.com",
      username: "_catalog_test",
    },
    dbPath: null,
    deps: { chat: async () => ({ text: "" }) },
  };
  const collectors = [];
  const failed = [];
  for (const [exportName, Collector] of Object.entries(pdh)) {
    if (!/Adapter$/u.test(exportName) || exportName === "MockAdapter" || exportName === "CcLLMAdapter") continue;
    if (typeof Collector !== "function" || typeof Collector.prototype?.sync !== "function") continue;
    let instance = null;
    const errors = [];
    for (const opts of [baseOpts, { snapshotMode: true }, { ...baseOpts, account: undefined }, {}]) {
      try {
        instance = new Collector(opts);
        break;
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (!instance || !instance.name) failed.push({ exportName, errors });
    else collectors.push({
      exportName,
      name: instance.name,
      extractMode: instance.extractMode || "web-api",
      capabilities: instance.capabilities || [],
      placeholderFetch:
        typeof instance._fetchFn === "function" && instance._fetchFn.name === "defaultFetch",
    });
  }
  return { collectors, failed };
}

describe("generated app-data catalog completeness", () => {
  it("contains every exported collector exactly once", () => {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    const { collectors, failed } = exportedCollectors();
    const exportedNames = collectors.map((item) => item.name).sort();
    const catalogNames = catalog.adapters.map((item) => item.name).sort();

    expect(failed).toEqual([]);
    expect(new Set(exportedNames).size).toBe(exportedNames.length);
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
    expect(catalog.count).toBe(catalog.adapters.length);
    expect(catalogNames).toEqual(exportedNames);

    const catalogByName = new Map(catalog.adapters.map((item) => [item.name, item]));
    for (const collector of collectors) {
      expect(catalogByName.get(collector.name).extractMode).toBe(
        collector.extractMode,
      );
    }
    for (const collector of collectors.filter((item) => item.placeholderFetch)) {
      const capabilities = catalogByName.get(collector.name).capabilities;
      expect(capabilities).not.toContain("sync:cookie-api");
      if (collector.capabilities.includes("sync:cookie-api")) {
        expect(capabilities).toContain("sync:custom-cookie-api");
      }
    }
  });
});
