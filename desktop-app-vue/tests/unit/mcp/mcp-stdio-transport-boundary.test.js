import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(currentDirectory, "../../..");
const mcpRoot = path.join(desktopRoot, "src", "main", "mcp");

function productionJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "examples") return [];
      return productionJavaScriptFiles(path.join(directory, entry.name));
    }
    return entry.isFile() && entry.name.endsWith(".js")
      ? [path.join(directory, entry.name)]
      : [];
  });
}

describe("MCP stdio transport boundary", () => {
  it("keeps the legacy direct-spawn transport removed", () => {
    expect(
      fs.existsSync(path.join(mcpRoot, "transports", "stdio-transport.js")),
    ).toBe(false);
  });

  it("routes the production client manager through the brokered transport", () => {
    const managerSource = fs.readFileSync(
      path.join(mcpRoot, "mcp-client-manager.js"),
      "utf8",
    );

    expect(managerSource).toContain(
      'require("./transports/brokered-stdio-client-transport.js")',
    );
    expect(managerSource).toMatch(
      /deps\.mcpStdio\?\.StdioClientTransport\s*\|\|\s*BrokeredStdioClientTransport/,
    );
  });

  it("forbids direct child_process imports in production MCP code", () => {
    const directProcessImport =
      /(?:require\(\s*|from\s+|import\(\s*)["'](?:node:)?child_process["']/;
    const offenders = productionJavaScriptFiles(mcpRoot)
      .filter((file) => directProcessImport.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(desktopRoot, file));

    expect(offenders).toEqual([]);
  });
});
