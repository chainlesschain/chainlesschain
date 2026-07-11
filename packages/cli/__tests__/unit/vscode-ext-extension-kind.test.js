/**
 * extensionKind lock — the IDE bridge spawns the `cc` CLI, reads the repo's
 * files, and binds a local MCP socket, so in Remote-SSH / WSL / Dev Container
 * windows it MUST run on the workspace (repo) host, never on the local UI
 * host where none of those exist. `"extensionKind": ["workspace"]` pins that;
 * without it VS Code may pick `ui` and the bridge silently talks to the wrong
 * machine. This asserts the manifest declaration so the pin can't regress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../vscode-extension/package.json", import.meta.url),
    ),
    "utf-8",
  ),
);

describe("VS Code extension manifest: extensionKind", () => {
  it("pins the extension to the workspace host (Remote/WSL/Container)", () => {
    expect(pkg.extensionKind).toEqual(["workspace"]);
  });
});
