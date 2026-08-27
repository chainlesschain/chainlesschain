import { describe, expect, it } from "vitest";

import { consoleHandlers } from "../../../../../src/main/remote/browser-extension/handlers/console.js";
import { pageHandlers } from "../../../../../src/main/remote/browser-extension/handlers/page.js";

describe("page console ownership", () => {
  it("keeps page.getConsole in the bounded console domain", () => {
    expect(pageHandlers["page.getConsole"]).toBeUndefined();
    expect(consoleHandlers["page.getConsole"]).toBeTypeOf("function");
  });
});
