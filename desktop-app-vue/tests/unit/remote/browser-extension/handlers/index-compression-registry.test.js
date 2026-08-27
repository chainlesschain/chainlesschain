import { describe, expect, it } from "vitest";

import { commandHandlerRegistry } from "../../../../../src/main/remote/browser-extension/handlers/index.js";

describe("compression command registry", () => {
  it.each([
    "compression.compress",
    "compression.decompress",
    "compression.getSupportedFormats",
    "compression.isSupported",
  ])("registers %s", (method) => {
    expect(commandHandlerRegistry[method]).toBeTypeOf("function");
  });
});
