import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopAppRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("legacy API network interceptor retirement", () => {
  it("keeps the unused global-session interceptor removed", () => {
    const retiredInterceptor = path.resolve(
      desktopAppRoot,
      "src/main/api/network-interceptor.js",
    );
    const activeBrowserInterceptor = path.resolve(
      desktopAppRoot,
      "src/main/browser/actions/network-interceptor.js",
    );

    expect(fs.existsSync(retiredInterceptor)).toBe(false);
    expect(fs.existsSync(activeBrowserInterceptor)).toBe(true);
  });
});
