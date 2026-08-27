import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("broadcast handler extraction", () => {
  it("removes the legacy unbounded background implementation", () => {
    const background = readFileSync(
      resolve(process.cwd(), "src/main/remote/browser-extension/background.js"),
      "utf8",
    );
    const registry = readFileSync(
      resolve(
        process.cwd(),
        "src/main/remote/browser-extension/handlers/index.js",
      ),
      "utf8",
    );

    expect(background).not.toContain('case "broadcast.create"');
    expect(background).not.toContain('case "broadcast.postMessage"');
    expect(background).not.toContain("async function createBroadcastChannel(");
    expect(background).not.toContain("async function broadcastMessage(");
    expect(background).not.toContain("async function closeBroadcastChannel(");
    expect(background).not.toContain("async function listBroadcastChannels(");
    expect(registry).toContain(
      'import { broadcastHandlers } from "./broadcast.js"',
    );
    expect(registry).toContain("...broadcastHandlers");
  });
});
