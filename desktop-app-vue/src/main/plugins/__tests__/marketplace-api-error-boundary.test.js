import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { PluginMarketplaceAPI } = require("../marketplace-api.js");

function createApi() {
  return new PluginMarketplaceAPI({
    baseURL: "https://marketplace.invalid/api",
    cacheDir: process.cwd(),
  });
}

describe("PluginMarketplaceAPI error boundary", () => {
  it("does not rethrow third-party error details", async () => {
    const api = createApi();
    const secret = "plugin-marketplace-rethrow-secret";
    api.client = {
      get: vi.fn().mockRejectedValue(
        Object.assign(new Error(secret), {
          response: { status: 503, data: { message: secret } },
        }),
      ),
    };

    const request = api.getPlugin("plugin-id", false);

    await expect(request).rejects.toMatchObject({
      message: "Plugin marketplace request failed",
      code: "PLUGIN_MARKETPLACE_REQUEST_FAILED",
      status: 503,
    });
    await expect(request).rejects.not.toThrow(secret);
  });

  it("drops unsafe status values", async () => {
    const api = createApi();
    api.client = {
      get: vi.fn().mockRejectedValue(
        Object.assign(new Error("secret"), {
          response: { status: "503-secret" },
        }),
      ),
    };

    await expect(api.getPlugin("plugin-id", false)).rejects.not.toHaveProperty(
      "status",
    );
  });

  it("has no raw caught-error rethrows", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/plugins/marketplace-api.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
  });
});
