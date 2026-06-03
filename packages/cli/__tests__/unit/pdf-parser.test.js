import { describe, it, expect, vi } from "vitest";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "fs";
import { parsePdfText } from "../../src/lib/pdf-parser.js";

describe("PDF Parser", () => {
  describe("parsePdfText", () => {
    it("should return title from filename", async () => {
      readFileSync.mockReturnValue(Buffer.from("minimal pdf content"));

      const result = await parsePdfText("/test/my-document.pdf");
      expect(result.title).toBe("my-document");
    });

    it("should extract text from Tj operators", async () => {
      const pdfContent = `%PDF-1.4
stream
BT
(Hello World) Tj
ET
endstream`;

      readFileSync.mockReturnValue(Buffer.from(pdfContent, "latin1"));

      const result = await parsePdfText("/test/doc.pdf");
      expect(result.content).toContain("Hello World");
    });

    it("should extract text from TJ arrays", async () => {
      const pdfContent = `%PDF-1.4
stream
BT
[(Test) -10 (Document)] TJ
ET
endstream`;

      readFileSync.mockReturnValue(Buffer.from(pdfContent, "latin1"));

      const result = await parsePdfText("/test/doc.pdf");
      expect(result.content).toContain("Test");
      expect(result.content).toContain("Document");
    });

    it("should handle PDF escape sequences", async () => {
      const pdfContent = `%PDF-1.4
stream
BT
(Hello\\nWorld) Tj
ET
endstream`;

      readFileSync.mockReturnValue(Buffer.from(pdfContent, "latin1"));

      const result = await parsePdfText("/test/doc.pdf");
      expect(result.content).toContain("Hello");
      expect(result.content).toContain("World");
    });

    it("should count pages", async () => {
      const pdfContent = `/Type /Page /Contents\n/Type /Page /Contents\n/Type /Pages`;

      readFileSync.mockReturnValue(Buffer.from(pdfContent, "latin1"));

      const result = await parsePdfText("/test/doc.pdf");
      expect(result.pages).toBe(2);
    });

    it("should handle empty PDF", async () => {
      readFileSync.mockReturnValue(Buffer.from("%PDF-1.4\n%%EOF"));

      const result = await parsePdfText("/test/empty.pdf");
      expect(result.content).toBe("");
      expect(result.title).toBe("empty");
    });
  });
});
