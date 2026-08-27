import { describe, expect, it } from "vitest";

import { commandHandlerRegistry } from "../../../../../src/main/remote/browser-extension/handlers/index.js";

describe("console command registry", () => {
  it("routes page and console commands through the extracted bounded handler", () => {
    for (const method of [
      "page.getConsole",
      "console.enable",
      "console.disable",
      "console.getLogs",
      "console.clear",
    ]) {
      expect(commandHandlerRegistry[method], method).toBeTypeOf("function");
    }
  });
});
